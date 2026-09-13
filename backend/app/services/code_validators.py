"""Pre-review syntax/completeness validation, independent of Gemini.

Important: a `valid=True` result is a syntax judgment only -- it means the
code parses (or, for heuristic validators, isn't obviously unfinished). It is
never a claim that the code is safe, correct, well-designed, or bug-free, and
a `valid=False` result (or one this module can't produce at all, see below)
must never block the user from still requesting a full Gemini review -- see
review_service.py's caller, which only skips Gemini for status "empty" and
"incomplete"/"syntax_error", not for "validation_unavailable".

No validator here executes, imports, or shells out to run the submitted
code -- see SECURITY.md-equivalent notes inline. Two tiers exist, and each
validator's `validator` name says which it is (never claim more than we do):

  * Real parser-backed: Python via `ast.parse` (stdlib, in-process, safe).
  * Heuristic: JavaScript/TypeScript/Java/SQL/HTML get a hand-written
    delimiter-balance + "obviously still typing this" checker, not a real
    grammar. This project has no JS/TS parser, Java compiler, or SQL parser
    available server-side (the frontend's TypeScript devDependency lives in
    frontend/node_modules, which the backend container never has -- shelling
    out to it would silently break in any deployment that doesn't co-locate
    the two). ponytail: a real parser per language (e.g. an embedded
    tree-sitter grammar) would remove the heuristic's known blind spots
    (invalid type annotations, semantically-wrong-but-delimiter-balanced
    code) -- swap in per language as a real parser becomes available rather
    than trying to perfect regex heuristics further.

C and C++ need an actual compiler for a real syntax check (`gcc`/`g++
-fsyntax-only`) and this environment has neither installed, so they report
"validation_unavailable" rather than a heuristic that would be too unreliable
for a grammar this complex to be worth pretending at. Go/Rust/Ruby/PHP (real
languages this app otherwise supports) have no validator implemented yet and
also report "validation_unavailable" -- see PLAN.md.
"""

import ast
import re
from typing import Protocol

from app.schemas.validation import ValidationResult

# Same ceiling as review submission (app/security/validation.py) -- no reason
# for the pre-review check to allow a larger payload than review itself does.
MAX_CODE_BYTES = 500 * 1024

# Chars that read as "nothing typed" to a human but aren't caught by str.strip()
# -- zero-width space/joiners, BOM, no-break space, etc. Written as explicit
# \uXXXX escapes rather than literal characters since invisible characters in
# source are exactly the kind of thing impossible to verify by reading and
# easy to silently mangle via copy/paste or re-encoding.
_INVISIBLE_WHITESPACE = re.compile(
    "[\\s"
    "\\u200b\\u200c\\u200d"  # zero-width space/joiners
    "\\u200e\\u200f"  # LTR/RTL marks
    "\\ufeff"  # BOM / zero-width no-break space
    "\\xa0"  # no-break space
    "\\u2028\\u2029"  # line/paragraph separator
    "]+"
)


def _is_blank(code: str) -> bool:
    return _INVISIBLE_WHITESPACE.sub("", code) == ""


class LanguageValidator(Protocol):
    def __call__(self, code: str) -> ValidationResult: ...


def _empty_result(validator: str) -> ValidationResult:
    return ValidationResult(
        valid=False,
        status="empty",
        message="Please enter a complete code snippet before continuing.",
        errorCode="EMPTY_CODE",
        validator=validator,
    )


def _unavailable_result(language: str) -> ValidationResult:
    return ValidationResult(
        valid=False,
        status="validation_unavailable",
        message="Automatic syntax validation is not available for this language. You can still request an AI review.",
        errorCode="VALIDATOR_UNAVAILABLE",
        validator=f"{language}-unavailable",
    )


# ---- Python: real parser (ast.parse), in-process, never executes the code ----

# CPython's SyntaxError.msg wording for these cases has been stable since the
# 3.10 fine-grained-error-location work (PEP 657) but isn't a documented,
# guaranteed-stable API -- this is a pragmatic best-effort classification,
# not something to depend on being exact across every future Python version.
_INCOMPLETE_MSG_MARKERS = ("expected an indented block", "expected ':'", "incomplete input")
_UNBALANCED_MSG_MARKERS = ("was never closed", "unexpected eof")


def validate_python(code: str) -> ValidationResult:
    try:
        tree = ast.parse(code)
        # ast.parse alone only checks grammar -- "return outside function",
        # "continue not in loop", "nonlocal name not found in enclosing
        # scope" etc. are semantic checks CPython does during compile() and
        # ast.parse never runs them, so `return 5` at module level would
        # otherwise pass as "valid" despite being a real SyntaxError.
        # compile()-ing to a code object never executes anything -- only
        # exec()/eval()-ing that object would; this stays a pure syntax check.
        compile(code, "<validated>", "exec")
    except SyntaxError as exc:
        line = exc.lineno or 1
        column = exc.offset or 1
        msg = exc.msg or "Invalid syntax"
        lowered = msg.lower()

        if any(marker in lowered for marker in _UNBALANCED_MSG_MARKERS):
            status, error_code = "syntax_error", "UNBALANCED_DELIMITER"
        elif any(marker in lowered for marker in _INCOMPLETE_MSG_MARKERS):
            status, error_code = "incomplete", "INCOMPLETE_CODE"
        elif isinstance(exc, (IndentationError, TabError)):
            status, error_code = "syntax_error", "INDENTATION_ERROR"
        else:
            status, error_code = "syntax_error", "SYNTAX_ERROR"

        verb = "incomplete" if status == "incomplete" else "a syntax error"
        return ValidationResult(
            valid=False,
            status=status,
            message=f"Line {line}: the code is {verb} -- {msg}.",
            line=line,
            column=column,
            endLine=getattr(exc, "end_lineno", None),
            endColumn=getattr(exc, "end_offset", None),
            errorCode=error_code,
            validator="python-ast",
        )
    except ValueError:
        # ast.parse raises plain ValueError for a few malformed-source cases
        # (e.g. embedded null bytes) that aren't SyntaxError but are just as
        # unparseable.
        return ValidationResult(
            valid=False,
            status="syntax_error",
            message="The code could not be parsed.",
            errorCode="SYNTAX_ERROR",
            validator="python-ast",
        )

    if not tree.body:
        return _empty_result("python-ast")

    return ValidationResult(valid=True, status="valid", message="Your code is syntactically valid.", validator="python-ast")


# ---- Shared heuristic engine for brace/string/comment-based languages ----
# Not a parser: tracks delimiter nesting and comment/string state character
# by character so braces *inside* a string or comment don't count, then flags
# whatever is still open at end-of-input as "incomplete" (a heuristic can't
# reliably tell "you made a mistake" from "you're not done typing" the way a
# real parser's error recovery can, so it deliberately reports the friendlier
# of the two -- see module docstring).

_PAIRS = {")": "(", "}": "{", "]": "["}


class _HeuristicSpec:
    def __init__(self, name: str, bare_incomplete_tokens: set[str], line_comment: str | None, block_comment: tuple[str, str] | None, has_template_literals: bool):
        self.name = name
        self.bare_incomplete_tokens = bare_incomplete_tokens
        self.line_comment = line_comment
        self.block_comment = block_comment
        self.has_template_literals = has_template_literals


def _strip_comments_for_emptiness_check(code: str, spec: _HeuristicSpec) -> str:
    """Best-effort removal of comments/strings so an all-comments input can be
    told apart from real code, without needing a real tokenizer."""
    out = []
    i, n = 0, len(code)
    in_line_comment = False
    block_close = spec.block_comment[1] if spec.block_comment else None
    in_block_comment = False
    while i < n:
        ch = code[i]
        if in_line_comment:
            if ch == "\n":
                in_line_comment = False
            i += 1
            continue
        if in_block_comment:
            if block_close and code.startswith(block_close, i):
                in_block_comment = False
                i += len(block_close)
            else:
                i += 1
            continue
        if spec.line_comment and code.startswith(spec.line_comment, i):
            in_line_comment = True
            i += len(spec.line_comment)
            continue
        if spec.block_comment and code.startswith(spec.block_comment[0], i):
            in_block_comment = True
            i += len(spec.block_comment[0])
            continue
        out.append(ch)
        i += 1
    return "".join(out)


def _heuristic_validate(code: str, spec: _HeuristicSpec) -> ValidationResult:
    stripped = code.strip()
    if stripped in spec.bare_incomplete_tokens:
        return ValidationResult(
            valid=False,
            status="incomplete",
            message=f"The code appears incomplete after `{stripped}`. Add the rest of the declaration and a body.",
            line=1,
            column=1,
            errorCode="INCOMPLETE_CODE",
            validator=f"{spec.name}-heuristic",
        )

    if _is_blank(_strip_comments_for_emptiness_check(code, spec)):
        return _empty_result(f"{spec.name}-heuristic")

    stack: list[tuple[str, int, int]] = []  # (char, line, column)
    line, col = 1, 1
    in_line_comment = False
    in_block_comment = False
    string_char: str | None = None  # ', ", or ` currently open
    string_start: tuple[int, int] | None = None
    escaped = False

    i, n = 0, len(code)
    while i < n:
        ch = code[i]

        if ch == "\n":
            line += 1
            col = 1
            if in_line_comment:
                in_line_comment = False
            i += 1
            continue

        if in_line_comment:
            i += 1
            col += 1
            continue

        if in_block_comment:
            if spec.block_comment and code.startswith(spec.block_comment[1], i):
                in_block_comment = False
                i += len(spec.block_comment[1])
                col += len(spec.block_comment[1])
            else:
                i += 1
                col += 1
            continue

        if string_char is not None:
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == string_char:
                string_char = None
                string_start = None
            i += 1
            col += 1
            continue

        if spec.line_comment and code.startswith(spec.line_comment, i):
            in_line_comment = True
            i += len(spec.line_comment)
            col += len(spec.line_comment)
            continue
        if spec.block_comment and code.startswith(spec.block_comment[0], i):
            in_block_comment = True
            i += len(spec.block_comment[0])
            col += len(spec.block_comment[0])
            continue
        if ch in ("'", '"') or (spec.has_template_literals and ch == "`"):
            string_char = ch
            string_start = (line, col)
            i += 1
            col += 1
            continue
        if ch in "({[":
            stack.append((ch, line, col))
        elif ch in ")}]":
            if stack and stack[-1][0] == _PAIRS[ch]:
                stack.pop()
            # A stray closing delimiter with nothing open is a real mistake,
            # not "still typing" -- but heuristically distinguishing that
            # from, say, a closing brace belonging to an outer block we
            # haven't seen (impossible in a single-snippet check) is out of
            # scope; only unclosed-at-EOF is reported below.
        i += 1
        col += 1

    if string_char is not None and string_start is not None:
        kind = "template literal" if string_char == "`" else "string"
        return ValidationResult(
            valid=False,
            status="incomplete",
            message=f"Line {string_start[0]}: an unclosed {kind} starting here needs a matching `{string_char}`.",
            line=string_start[0],
            column=string_start[1],
            errorCode="INCOMPLETE_CODE",
            validator=f"{spec.name}-heuristic",
        )

    if in_block_comment:
        return ValidationResult(
            valid=False,
            status="incomplete",
            message="An unclosed comment runs to the end of the code.",
            errorCode="INCOMPLETE_CODE",
            validator=f"{spec.name}-heuristic",
        )

    if stack:
        ch, oline, ocol = stack[-1]
        closer = {v: k for k, v in _PAIRS.items()}[ch]
        return ValidationResult(
            valid=False,
            status="incomplete",
            message=f"Line {oline}: `{ch}` opened here is never closed with `{closer}`.",
            line=oline,
            column=ocol,
            errorCode="INCOMPLETE_CODE",
            validator=f"{spec.name}-heuristic",
        )

    if re.search(r"(=>|[=+\-*/%&|^])\s*$", stripped) and not re.search(r"(==|!=|>=|<=)\s*$", stripped):
        return ValidationResult(
            valid=False,
            status="incomplete",
            message="The code ends with an incomplete expression -- something is expected after the trailing operator.",
            errorCode="INCOMPLETE_CODE",
            validator=f"{spec.name}-heuristic",
        )

    return ValidationResult(
        valid=True,
        status="valid",
        message=f"No obvious syntax issues found for {spec.name} (heuristic check, not a full parser).",
        validator=f"{spec.name}-heuristic",
    )


_JS_SPEC = _HeuristicSpec(
    name="javascript",
    bare_incomplete_tokens={"function", "const", "let", "var", "class", "async", "if", "for", "while", "switch", "import", "export", "{", "("},
    line_comment="//",
    block_comment=("/*", "*/"),
    has_template_literals=True,
)
_TS_SPEC = _HeuristicSpec(
    name="typescript",
    bare_incomplete_tokens=_JS_SPEC.bare_incomplete_tokens | {"interface", "type", "enum"},
    line_comment="//",
    block_comment=("/*", "*/"),
    has_template_literals=True,
)
_JAVA_SPEC = _HeuristicSpec(
    name="java",
    bare_incomplete_tokens={"public", "private", "class", "public class", "interface", "if", "for", "while", "{"},
    line_comment="//",
    block_comment=("/*", "*/"),
    has_template_literals=False,
)


def validate_javascript(code: str) -> ValidationResult:
    return _heuristic_validate(code, _JS_SPEC)


def validate_typescript(code: str) -> ValidationResult:
    return _heuristic_validate(code, _TS_SPEC)


def validate_java(code: str) -> ValidationResult:
    result = _heuristic_validate(code, _JAVA_SPEC)
    if result.warnings == []:
        result = result.model_copy(update={"warnings": ["Java syntax checking is heuristic (brace/string balance only) -- it is not a real compiler and cannot catch every error a javac run would."]})
    return result


# ---- SQL: heuristic (no SQL parser dependency in this project) ----

_SQL_LINE_COMMENT = "--"
_SQL_BLOCK_COMMENT = ("/*", "*/")
_SQL_STATEMENT_STARTS = ("SELECT", "INSERT", "UPDATE", "DELETE", "CREATE", "ALTER", "DROP", "WITH", "MERGE")


def validate_sql(code: str) -> ValidationResult:
    spec = _HeuristicSpec("sql", bare_incomplete_tokens=set(), line_comment=_SQL_LINE_COMMENT, block_comment=_SQL_BLOCK_COMMENT, has_template_literals=False)
    stripped_of_comments = _strip_comments_for_emptiness_check(code, spec)
    if _is_blank(stripped_of_comments):
        return _empty_result("sql-heuristic")

    body = stripped_of_comments.strip().rstrip(";").strip()
    upper = body.upper()

    if not upper.startswith(_SQL_STATEMENT_STARTS):
        return ValidationResult(
            valid=False,
            status="incomplete",
            message="This doesn't start with a recognizable SQL statement (SELECT, INSERT, UPDATE, DELETE, ...).",
            line=1,
            column=1,
            errorCode="INCOMPLETE_CODE",
            validator="sql-heuristic",
        )

    first_word = upper.split(None, 1)[0]
    rest = body[len(first_word):].strip()
    if not rest:
        return ValidationResult(
            valid=False,
            status="incomplete",
            message=f"`{first_word}` needs the rest of the statement.",
            line=1,
            column=1,
            errorCode="INCOMPLETE_CODE",
            validator="sql-heuristic",
        )

    if first_word == "SELECT" and re.search(r"\bWHERE\b|\bJOIN\b", upper) and not re.search(r"\bFROM\b", upper):
        return ValidationResult(
            valid=False,
            status="incomplete",
            message="A WHERE/JOIN clause is present but there's no FROM to apply it to.",
            errorCode="INCOMPLETE_CODE",
            validator="sql-heuristic",
        )

    if first_word == "INSERT" and "VALUES" not in upper and "SELECT" not in upper:
        return ValidationResult(
            valid=False,
            status="incomplete",
            message="INSERT is missing a VALUES (or SELECT) clause.",
            errorCode="INCOMPLETE_CODE",
            validator="sql-heuristic",
        )

    quote_count_single = body.count("'") - body.count("\\'")
    if quote_count_single % 2 != 0:
        return ValidationResult(
            valid=False,
            status="incomplete",
            message="An unclosed quoted string was found.",
            errorCode="INCOMPLETE_CODE",
            validator="sql-heuristic",
        )

    if body.count("(") != body.count(")"):
        return ValidationResult(
            valid=False,
            status="incomplete",
            message="Parentheses are not balanced.",
            errorCode="INCOMPLETE_CODE",
            validator="sql-heuristic",
        )

    return ValidationResult(valid=True, status="valid", message="No obvious syntax issues found for SQL (heuristic check, not a full parser).", validator="sql-heuristic")


# ---- HTML: heuristic tag-balance checker ----

_VOID_ELEMENTS = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}
_TAG_RE = re.compile(r"<(/?)([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^<>]*?)?)(/?)>")


def validate_html(code: str) -> ValidationResult:
    if _is_blank(re.sub(r"<!--.*?-->", "", code, flags=re.S)):
        return _empty_result("html-heuristic")

    if "<!--" in code and "-->" not in code[code.index("<!--"):]:
        return ValidationResult(valid=False, status="incomplete", message="An HTML comment is never closed with `-->`.", errorCode="INCOMPLETE_CODE", validator="html-heuristic")

    stack: list[str] = []
    for match in _TAG_RE.finditer(code):
        is_closing, tag, _attrs, self_closing = match.group(1), match.group(2).lower(), match.group(3), match.group(4)
        if is_closing:
            if stack and stack[-1] == tag:
                stack.pop()
            elif tag in stack:
                # Mismatched close for a tag that's open further up -- treat
                # the intervening tags as implicitly unclosed rather than
                # guessing which one the author meant.
                while stack and stack[-1] != tag:
                    stack.pop()
                if stack:
                    stack.pop()
        elif tag not in _VOID_ELEMENTS and not self_closing:
            stack.append(tag)

    if stack:
        return ValidationResult(
            valid=False,
            status="incomplete",
            message=f"`<{stack[-1]}>` is never closed with `</{stack[-1]}>`.",
            errorCode="INCOMPLETE_CODE",
            validator="html-heuristic",
        )

    open_quotes = len(re.findall(r'="[^"]*$', code, flags=re.M))
    if open_quotes:
        return ValidationResult(valid=False, status="incomplete", message="An attribute value's quote is never closed.", errorCode="INCOMPLETE_CODE", validator="html-heuristic")

    return ValidationResult(valid=True, status="valid", message="No obvious syntax issues found for HTML (heuristic check, not a full parser).", validator="html-heuristic")


_REGISTRY: dict[str, LanguageValidator] = {
    "python": validate_python,
    "javascript": validate_javascript,
    "typescript": validate_typescript,
    "java": validate_java,
    "sql": validate_sql,
    "html": validate_html,
}

# Real app languages (app/services/language_detector.py) with no validator
# implemented yet. c/cpp need an actual compiler to check syntax honestly
# (none installed here); the rest just haven't been built yet.
_KNOWN_BUT_UNAVAILABLE = {"c", "cpp", "go", "rust", "ruby", "php"}


def validate_code(code: str, language: str) -> ValidationResult:
    """The one entry point api/code_validation.py calls. Never raises for a
    malformed-but-parseable request -- returns a ValidationResult describing
    what's wrong instead, matching every other status this function returns."""
    if _is_blank(code):
        return _empty_result("pre-check")

    validator = _REGISTRY.get(language)
    if validator is not None:
        try:
            return validator(code)
        except Exception:  # noqa: BLE001 -- a validator bug must never 500 the endpoint or block review
            return ValidationResult(
                valid=False,
                status="validation_unavailable",
                message="Automatic syntax validation hit an internal error for this code. You can still request an AI review.",
                errorCode="INTERNAL_VALIDATION_ERROR",
                validator=f"{language}-error",
            )

    if language in _KNOWN_BUT_UNAVAILABLE or language == "plaintext":
        return _unavailable_result(language)

    return ValidationResult(
        valid=False,
        status="unsupported_language",
        message="This language isn't recognized. You can still request an AI review.",
        errorCode="UNSUPPORTED_LANGUAGE",
        validator="unsupported",
    )
