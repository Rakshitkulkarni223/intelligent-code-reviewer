import logging

from fastapi import APIRouter, Depends, HTTPException

from app.schemas.validation import ValidateCodeRequest, ValidateCodeResponse
from app.security.auth import get_current_user_id
from app.services.code_validators import MAX_CODE_BYTES, validate_code

router = APIRouter(prefix="/api/code", tags=["code-validation"])
logger = logging.getLogger("code_validation")


@router.post("/validate", response_model=ValidateCodeResponse)
async def validate(body: ValidateCodeRequest, user_id: str = Depends(get_current_user_id)) -> ValidateCodeResponse:
    # Same size ceiling as review submission, checked up front so a huge
    # payload never reaches a validator (some of which scan character by
    # character). 413, not 400 -- this is specifically a payload-size
    # rejection, matching HTTP's own semantics for it.
    if len(body.code.encode("utf-8")) > MAX_CODE_BYTES:
        raise HTTPException(status_code=413, detail=f"Code exceeds the {MAX_CODE_BYTES // 1024} KB validation limit")

    # \r\n / \r -> \n so line/column counting is consistent regardless of the
    # client's line-ending convention.
    normalized = body.code.replace("\r\n", "\n").replace("\r", "\n")

    try:
        result = validate_code(normalized, body.language)
    except Exception:  # noqa: BLE001 -- never let a validator bug surface a raw traceback to the client
        logger.error("code validation crashed language=%s", body.language, exc_info=True)
        return ValidateCodeResponse(
            valid=False,
            status="validation_unavailable",
            message="Automatic syntax validation hit an internal error for this code. You can still request an AI review.",
            errorCode="INTERNAL_VALIDATION_ERROR",
            validator="error",
            language=body.language,
        )

    # Never log the submitted source -- same policy as review submission
    # (app/services/review_service.py). status/validator/language are safe.
    logger.info("code validated language=%s status=%s validator=%s", body.language, result.status, result.validator)

    return ValidateCodeResponse(**result.model_dump(), language=body.language)
