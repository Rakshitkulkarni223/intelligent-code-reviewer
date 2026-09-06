import re

from app.config import settings

SECRET_PATTERNS = [
    re.compile(r"AKIA[0-9A-Z]{16}"),  # AWS access key id
    re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
    re.compile(r"(?i)(api[_-]?key|secret|token|password)\s*[:=]\s*['\"][^'\"]{8,}['\"]"),
]


class ValidationError(Exception):
    pass


def validate_code(code: str) -> None:
    if not code or not code.strip():
        raise ValidationError("Code cannot be empty")

    size = len(code.encode("utf-8"))
    if size > settings.max_code_bytes:
        raise ValidationError(f"Code exceeds the {settings.max_code_bytes // 1024} KB limit")

    lines = code.count("\n") + 1
    if lines > settings.max_code_lines:
        raise ValidationError(f"Code exceeds the {settings.max_code_lines} line limit")

    if "\x00" in code:
        raise ValidationError("Binary content is not supported")


def contains_likely_secret(code: str) -> bool:
    return any(pattern.search(code) for pattern in SECRET_PATTERNS)
