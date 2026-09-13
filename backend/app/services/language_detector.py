import re
from dataclasses import dataclass, field

SUPPORTED_LANGUAGES = [
    "python", "javascript", "typescript", "java", "c", "cpp", "go", "rust", "ruby", "php", "sql",
]

# Server-side authoritative detection. Mirrors frontend/src/lib/languageDetect.ts
# but is the source of truth -- the client's guess is only a UX hint.
_SIGNATURES: list[tuple[str, list[re.Pattern]]] = [
    ("python", [re.compile(p, re.M) for p in [r"^\s*def\s+\w+\(.*\):", r"^\s*import\s+\w+", r"^\s*#!.*python", r":\s*$", r"^\s*elif\b"]]),
    ("ruby", [re.compile(p, re.M) for p in [r"^\s*def\s+\w+", r"\bend\b\s*$", r"^\s*require\s+['\"]", r"^\s*#!.*ruby"]]),
    ("typescript", [re.compile(p) for p in [r":\s*(string|number|boolean|void|any)\b", r"\binterface\s+\w+", r"\bimport\s+.*\bfrom\b"]]),
    ("javascript", [re.compile(p) for p in [r"\bconst\s+\w+\s*=", r"\bfunction\s+\w+\(", r"=>\s*\{", r"\bconsole\.log\("]]),
    ("java", [re.compile(p) for p in [r"\bpublic\s+class\s+\w+", r"\bSystem\.out\.println\(", r"\bpublic\s+static\s+void\s+main\("]]),
    ("go", [re.compile(p, re.M) for p in [r"^\s*package\s+\w+", r"\bfunc\s+\w+\(", r":=\s*"]]),
    ("rust", [re.compile(p, re.M) for p in [r"\bfn\s+\w+\(", r"^\s*use\s+\w+::", r"\blet\s+mut\b"]]),
    ("cpp", [re.compile(p) for p in [r"#include\s*<\w+>", r"\bstd::", r"\bcout\s*<<"]]),
    ("c", [re.compile(p) for p in [r"#include\s*<\w+\.h>", r"\bprintf\("]]),
    ("php", [re.compile(p) for p in [r"^<\?php", r"\becho\s+"]]),
    ("sql", [re.compile(p, re.I | re.M) for p in [r"^\s*(SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM|CREATE\s+TABLE|ALTER\s+TABLE|DROP\s+TABLE)\b", r"\bFROM\s+\w+", r"\bWHERE\b", r"\bJOIN\b"]]),
]

_EXTENSION_MAP = {
    "py": "python", "js": "javascript", "jsx": "javascript", "ts": "typescript",
    "tsx": "typescript", "java": "java", "c": "c", "h": "c", "cpp": "cpp",
    "cc": "cpp", "hpp": "cpp", "go": "go", "rs": "rust", "rb": "ruby", "php": "php",
    "sql": "sql",
}


@dataclass
class Detection:
    language: str
    confidence: float
    method: str
    alternates: list[dict] = field(default_factory=list)


def detect_language(code: str, filename: str | None = None) -> Detection:
    ext = filename.rsplit(".", 1)[-1].lower() if filename and "." in filename else None
    ext_language = _EXTENSION_MAP.get(ext) if ext else None

    scores: dict[str, float] = {}
    for language, patterns in _SIGNATURES:
        hits = sum(1 for p in patterns if p.search(code))
        if hits:
            scores[language] = hits / len(patterns)

    if ext_language:
        scores[ext_language] = scores.get(ext_language, 0) + 0.5

    if not scores:
        if ext_language:
            return Detection(ext_language, 0.5, "extension", [])
        return Detection("plaintext", 0.0, "none", [])

    ranked = sorted(scores.items(), key=lambda kv: kv[1], reverse=True)
    total = sum(v for _, v in ranked) or 1
    normalized = [{"language": lang, "confidence": round(v / total, 2)} for lang, v in ranked]

    return Detection(
        language=normalized[0]["language"],
        confidence=normalized[0]["confidence"],
        method="extension + syntax" if ext_language else "syntax + keywords",
        alternates=normalized[1:3],
    )


def resolve_language(requested: str, code: str, filename: str | None = None) -> str:
    """Authoritative language resolution for a review request. 'auto' defers
    entirely to server-side detection; an explicit request is trusted only if
    it's one of the supported languages."""
    if requested and requested != "auto" and requested in SUPPORTED_LANGUAGES:
        return requested
    return detect_language(code, filename).language
