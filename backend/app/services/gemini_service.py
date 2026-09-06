import re

from app.schemas.gemini_response import GeminiAnalysis, Issue, ScoreDimensions

# ponytail: this is a deterministic, rule-based stand-in for the real Vertex AI
# Gemini call (Phase 4/10 -- needs GOOGLE_CLOUD_PROJECT credentials this sandbox
# doesn't have yet). It exists so the rest of the pipeline (async processing,
# scoring, historical RAG, persistence, UI) can be built and demoed end-to-end
# now. When wiring up real Gemini: build a prompt from (system instructions +
# language + code + historical rules), explicitly tell the model the code is
# untrusted data whose embedded instructions must never override the system
# prompt, call the model, then validate its JSON response against
# GeminiAnalysis before trusting it -- exactly like this function's return
# value is already validated by its callers.

_DETECTORS: list[tuple[str, str, re.Pattern, str, str]] = [
    # (category, severity, pattern, title, suggestion)
    ("security", "high", re.compile(r"""(f['"]|\.format\(|%\s*\()[^\n]*?\b(SELECT|INSERT|UPDATE|DELETE)\b""", re.I),
     "Potential SQL injection", "Use parameterized queries or an ORM instead of building SQL from interpolated strings."),
    ("security", "high", re.compile(r"""(?i)(api[_-]?key|secret|password|token)\s*[:=]\s*['"][^'"]{6,}['"]"""),
     "Hardcoded credential", "Move secrets to environment variables or a secret manager; never commit them to source."),
    ("security", "high", re.compile(r"\b(eval|exec)\s*\("),
     "Use of eval()/exec() on potentially untrusted input", "Avoid evaluating dynamic code; use safe parsing or an explicit allowlist of operations."),
    ("quality", "medium", re.compile(r"^\s*except\s*:\s*$", re.M),
     "Bare except clause", "Catch specific exception types so unexpected errors aren't silently swallowed."),
    ("quality", "low", re.compile(r"^\s*(console\.log|print)\s*\(", re.M),
     "Debug statement left in code", "Remove debug prints/console.log calls before merging, or use a logger with levels."),
    ("quality", "low", re.compile(r"#\s*(TODO|FIXME)", re.I),
     "Unresolved TODO/FIXME", "Resolve or track this in an issue tracker rather than leaving it in source."),
    ("performance", "medium", re.compile(r"for\s+.+:\s*\n(\s+).*for\s+.+:", re.M),
     "Nested loop over collections", "Check whether the inner loop can be replaced with a lookup (dict/set) to avoid O(n²) behavior."),
]

_DIMENSION_BY_CATEGORY = {
    "security": "security",
    "performance": "performance",
    "quality": "quality",
    "correctness": "correctness",
    "architecture": "architecture",
}

_SEVERITY_PENALTY = {"high": 3.0, "medium": 1.5, "low": 0.5}

_WEIGHTS = {"correctness": 0.30, "security": 0.25, "quality": 0.20, "performance": 0.15, "architecture": 0.10}


def _find_line(code: str, match: re.Match) -> int:
    return code.count("\n", 0, match.start()) + 1


def analyze_code(code: str, language: str) -> tuple[GeminiAnalysis, set[str]]:
    issues: list[Issue] = []
    for category, severity, pattern, title, suggestion in _DETECTORS:
        match = pattern.search(code)
        if match:
            issues.append(Issue(
                category=category,
                severity=severity,  # type: ignore[arg-type]
                title=title,
                line=_find_line(code, match),
                description=f"Detected a pattern consistent with: {title.lower()}.",
                suggestion=suggestion,
            ))

    dimensions = {dim: 10.0 for dim in _WEIGHTS}
    for issue in issues:
        dim = _DIMENSION_BY_CATEGORY.get(issue.category, "quality")
        dimensions[dim] = max(1.0, dimensions[dim] - _SEVERITY_PENALTY[issue.severity])

    overall = sum(dimensions[d] * w for d, w in _WEIGHTS.items())
    overall = round(min(10.0, max(1.0, overall)), 1)

    high_count = sum(1 for i in issues if i.severity == "high")
    if not issues:
        summary = f"No notable issues detected in this {language} submission."
    elif high_count:
        summary = f"Found {len(issues)} issue(s), including {high_count} high-severity item(s) that should be addressed before merging."
    else:
        summary = f"Found {len(issues)} issue(s), mostly minor. No high-severity problems detected."

    strengths = []
    if not any(i.category == "security" for i in issues):
        strengths.append("No obvious security anti-patterns detected")
    if not any(i.severity == "high" for i in issues):
        strengths.append("No high-severity issues found")
    if not strengths:
        strengths.append("Code compiles conceptually and follows a clear control flow")

    recommendations = list({i.suggestion for i in issues})[:5]
    categories = {i.category for i in issues}

    analysis = GeminiAnalysis(
        score=overall,
        summary=summary,
        strengths=strengths,
        issues=issues,
        recommendations=recommendations,
        dimensions=ScoreDimensions(**dimensions),
        historicalMatches=[],
    )
    return analysis, categories
