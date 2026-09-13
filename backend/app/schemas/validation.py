from typing import Literal

from pydantic import BaseModel, Field

ValidationStatus = Literal[
    "valid", "empty", "incomplete", "syntax_error", "unsupported_language", "validation_unavailable",
]

ErrorCode = Literal[
    "EMPTY_CODE", "INCOMPLETE_CODE", "SYNTAX_ERROR", "INDENTATION_ERROR", "UNBALANCED_DELIMITER",
    "UNSUPPORTED_LANGUAGE", "VALIDATOR_UNAVAILABLE", "INTERNAL_VALIDATION_ERROR",
]


class ValidateCodeRequest(BaseModel):
    code: str
    language: str


class ValidationResult(BaseModel):
    """Returned by every validator (app/services/code_validators.py) and, with
    `language` attached, sent to the client as-is. `valid=False` for `status`
    "empty" too -- there's nothing to review either way. A `valid=True` result
    is a syntax judgment only; see code_validators.py's module docstring for
    why that must never be read as "safe" or "good"."""

    valid: bool
    status: ValidationStatus
    message: str
    line: int | None = None
    column: int | None = None
    endLine: int | None = None
    endColumn: int | None = None
    errorCode: ErrorCode | None = None
    warnings: list[str] = Field(default_factory=list)
    validator: str


class ValidateCodeResponse(ValidationResult):
    language: str
