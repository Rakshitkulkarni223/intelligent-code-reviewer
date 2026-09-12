import hashlib
import logging
import uuid

from app.config import settings
from app.schemas.gemini_response import HistoricalMatch
from app.schemas.review import Review
from app.security.validation import contains_likely_secret, validate_code
from app.services import firestore_service, gemini_service, historical_data, language_detector, pubsub_service

logger = logging.getLogger("review_service")


def _code_hash(code: str, language: str) -> str:
    return hashlib.sha256(f"{code}:{language}".encode("utf-8")).hexdigest()


async def create_review(user_id: str, code: str, requested_language: str, idempotency_key: str | None) -> Review:
    if idempotency_key:
        existing_id = await firestore_service.get_idempotent_review_id(user_id, idempotency_key)
        if existing_id:
            existing = await firestore_service.get_review(user_id, existing_id)
            if existing:
                return existing

    validate_code(code)
    language = language_detector.resolve_language(requested_language, code)
    secrets_detected = contains_likely_secret(code)

    review = Review(
        id=uuid.uuid4().hex,
        userId=user_id,
        status="QUEUED",
        language=language,
        codeHash=_code_hash(code, language),
        code=code,
        codeSize=len(code.encode("utf-8")),
        lines=code.count("\n") + 1,
        secretsDetected=secrets_detected,
        attempts=0,
        createdAt=firestore_service.now(),
    )
    await firestore_service.create_review(review)
    if idempotency_key:
        await firestore_service.set_idempotency_key(user_id, idempotency_key, review.id)

    await pubsub_service.publish(user_id, review.id)
    # Never log the code itself -- only that the pattern-based scan flagged it.
    if secrets_detected:
        logger.warning("review submitted with likely secret reviewId=%s language=%s", review.id, language)
    else:
        logger.info("review submitted reviewId=%s language=%s", review.id, language)
    return review


async def retry_review(user_id: str, review_id: str) -> Review | None:
    review = await firestore_service.get_review(user_id, review_id)
    if not review or review.status != "FAILED":
        return None
    updated = await firestore_service.update_review(user_id, review_id, status="QUEUED", error=None)
    await pubsub_service.publish(user_id, review_id)
    return updated


async def process_review(user_id: str, review_id: str, delivery_attempt: int) -> None:
    review = await firestore_service.get_review(user_id, review_id)
    if not review:
        logger.warning("review not found reviewId=%s", review_id)
        return

    await firestore_service.update_review(user_id, review_id, status="ANALYZING", attempts=delivery_attempt)

    try:
        language = language_detector.resolve_language(review.language, review.code)
        if settings.local_mode:
            # Mock retrieval needs the categories Gemini's mock already found,
            # so it must run after analysis; the real pipeline below reverses
            # this since Vector Search retrieval feeds the Gemini prompt.
            analysis, categories = await gemini_service.analyze_code(review.code, language)
            hint_text = " ".join(f"{i.title} {i.suggestion}" for i in analysis.issues)
            matches = await historical_data.find_matches(review.code, language, categories=categories, hint_text=hint_text)
        else:
            matches = await historical_data.find_matches(review.code, language)
            analysis, _categories = await gemini_service.analyze_code(review.code, language, historical_rules=matches)
        analysis.historicalMatches = [
            HistoricalMatch(type=r.type, description=r.description) for r in matches
        ]
        await firestore_service.update_review(
            user_id, review_id,
            status="COMPLETED",
            score=analysis.score,
            result=analysis,
            completedAt=firestore_service.now(),
        )
        logger.info("review completed reviewId=%s score=%s", review_id, analysis.score)
    except Exception as exc:  # noqa: BLE001 -- any analysis failure must not crash the worker
        logger.error("review analysis failed reviewId=%s attempt=%s errorType=%s", review_id, delivery_attempt, type(exc).__name__)
        if delivery_attempt >= settings.max_delivery_attempts:
            await firestore_service.update_review(user_id, review_id, status="FAILED", error="Analysis failed after multiple attempts")
        else:
            await firestore_service.update_review(user_id, review_id, status="QUEUED")
            raise
