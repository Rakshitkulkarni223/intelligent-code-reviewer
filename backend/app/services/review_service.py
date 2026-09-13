import hashlib
import logging
import re
import uuid

from app.config import settings
from app.schemas.gemini_response import HistoricalMatch, Issue
from app.schemas.review import Review, ReviewComparison
from app.security.validation import contains_likely_secret, validate_code
from app.services import firestore_service, gemini_service, historical_data, language_detector, pubsub_service

logger = logging.getLogger("review_service")


def _code_hash(code: str, language: str) -> str:
    return hashlib.sha256(f"{code}:{language}".encode("utf-8")).hexdigest()


def _issue_key(issue: Issue) -> tuple[str, str]:
    """Stable-ish identity for an issue across two review runs. Gemini isn't
    guaranteed to word the same underlying problem identically between calls,
    so this compares category + a normalized title (lowercased, punctuation
    collapsed to spaces) rather than exact text -- close enough to tolerate
    minor rewording while still telling genuinely different issues apart."""
    normalized_title = re.sub(r"[^a-z0-9]+", " ", issue.title.lower()).strip()
    return (issue.category.lower(), normalized_title)


def _compare_issues(previous: list[Issue], current: list[Issue]) -> tuple[int, int, int]:
    previous_keys = {_issue_key(i) for i in previous}
    current_keys = {_issue_key(i) for i in current}
    resolved = len(previous_keys - current_keys)
    new_issues = len(current_keys - previous_keys)
    remaining = len(current_keys & previous_keys)
    return resolved, new_issues, remaining


class _StagedFailure(Exception):
    """Wraps an exception with the FailureReason its call site implies.
    Guessing a failure's origin from the exception's own type/message is
    unreliable (a network error from the Gemini SDK and one from Vector
    Search can look identical), so each stage in process_review that can
    fail is wrapped individually via `raise _StagedFailure(reason, exc) from
    exc` instead -- the original exception is still the one logged and
    chained, this just carries which stage raised it."""

    def __init__(self, reason: str, cause: Exception) -> None:
        super().__init__(str(cause))
        self.reason = reason


def _classify_failure(exc: Exception) -> str:
    """Fallback for a failure that didn't come from a wrapped stage (e.g.
    language detection, or an unexpected error in process_review itself)."""
    if isinstance(exc, TimeoutError) or "timeout" in type(exc).__name__.lower():
        return "TIMEOUT"
    return "REVIEW_SERVICE_ERROR"


async def create_review(
    user_id: str, code: str, requested_language: str, idempotency_key: str | None, based_on_review_id: str | None = None
) -> Review:
    if idempotency_key:
        existing_id = await firestore_service.get_idempotent_review_id(user_id, idempotency_key)
        if existing_id:
            existing = await firestore_service.get_review(user_id, existing_id)
            if existing:
                return existing

    validate_code(code)
    language = language_detector.resolve_language(requested_language, code)
    secrets_detected = contains_likely_secret(code)
    code_hash = _code_hash(code, language)
    now = firestore_service.now()

    # Byte-identical resubmission of code this user already got a completed
    # review for -- reusing that result instead of re-running Gemini +
    # Vector Search is safe because the input can't produce a different
    # answer, and it avoids a wasted API call every time someone clicks
    # "Review Again" on code they haven't actually changed. A real code
    # change (different codeHash) always gets a fresh review, same as before.
    # excludeFromMetrics mirrors `reuse` here: resubmitting code that already
    # has a completed review is never new information, so it must never
    # change Reviews/Average/Latest/Best/Improvement -- only genuinely new or
    # changed code can.
    previous_completed = await firestore_service.find_latest_completed_by_hash(user_id, code_hash)
    reuse = previous_completed is not None
    version = await firestore_service.assign_code_version(user_id, code_hash)

    review = Review(
        id=uuid.uuid4().hex,
        userId=user_id,
        status="COMPLETED" if reuse else "QUEUED",
        language=language,
        codeHash=code_hash,
        code=code,
        codeSize=len(code.encode("utf-8")),
        lines=code.count("\n") + 1,
        secretsDetected=secrets_detected,
        score=previous_completed.score if reuse else None,
        result=previous_completed.result if reuse else None,
        attempts=0,
        createdAt=now,
        completedAt=now if reuse else None,
        isResubmission=reuse,
        previousReviewId=previous_completed.id if reuse else None,
        version=version,
        excludeFromMetrics=reuse,
        basedOnReviewId=based_on_review_id,
    )
    await firestore_service.create_review(review)
    if idempotency_key:
        await firestore_service.set_idempotency_key(user_id, idempotency_key, review.id)

    if reuse:
        logger.info(
            "review resubmission reviewId=%s previousReviewId=%s language=%s", review.id, previous_completed.id, language
        )
        return review

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
    updated = await firestore_service.update_review(user_id, review_id, status="QUEUED", error=None, failureReason=None)
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
            try:
                analysis, categories = await gemini_service.analyze_code(review.code, language)
            except Exception as exc:
                raise _StagedFailure("GEMINI_ERROR", exc) from exc
            hint_text = " ".join(f"{i.title} {i.suggestion}" for i in analysis.issues)
            try:
                matches = await historical_data.find_matches(review.code, language, categories=categories, hint_text=hint_text)
            except Exception as exc:
                raise _StagedFailure("REVIEW_SERVICE_ERROR", exc) from exc
            analysis.historicalMatches = [
                HistoricalMatch(type=r.type, description=r.description) for r in matches
            ]
        else:
            # Retrieve more candidates than we intend to show -- Vector Search
            # is a similarity search, not a relevance judgment, so it will
            # surface topically-related rules that don't actually apply (e.g.
            # "avoid bare except" for code with no exception handling at all).
            # gemini_service filters these down to the ones Gemini itself
            # confirms are relevant, with full view of the actual code, and
            # sets analysis.historicalMatches directly -- nothing to do here.
            try:
                candidates = await historical_data.find_matches(review.code, language, limit=8)
            except Exception as exc:
                raise _StagedFailure("REVIEW_SERVICE_ERROR", exc) from exc
            try:
                analysis, _categories = await gemini_service.analyze_code(review.code, language, historical_rules=candidates)
            except Exception as exc:
                raise _StagedFailure("GEMINI_ERROR", exc) from exc

        # Baseline for the score/issue delta shown on the result page -- only
        # the specific review this submission explicitly declared itself a
        # revision of (via "Edit Code"), never guessed as "whatever you last
        # successfully reviewed": two unrelated pieces of code have nothing
        # meaningful to compare, so no declared lineage means no comparison.
        baseline = None
        if review.basedOnReviewId:
            candidate = await firestore_service.get_review(user_id, review.basedOnReviewId)
            if candidate is not None and candidate.status == "COMPLETED":
                baseline = candidate
        comparison = None
        if baseline is not None and baseline.result is not None and baseline.score is not None:
            resolved, new_issues, remaining = _compare_issues(baseline.result.issues, analysis.issues)
            comparison = ReviewComparison(
                previousReviewId=baseline.id,
                previousScore=baseline.score,
                scoreChange=analysis.score - baseline.score,
                issuesResolved=resolved,
                newIssues=new_issues,
                remainingIssues=remaining,
            )

        await firestore_service.update_review(
            user_id, review_id,
            status="COMPLETED",
            score=analysis.score,
            result=analysis,
            completedAt=firestore_service.now(),
            previousSuccessfulReviewId=baseline.id if baseline is not None else None,
            comparison=comparison,
        )
        logger.info("review completed reviewId=%s score=%s", review_id, analysis.score)
    except Exception as exc:  # noqa: BLE001 -- any analysis failure must not crash the worker
        origin = exc.__cause__ if isinstance(exc, _StagedFailure) else exc
        logger.error("review analysis failed reviewId=%s attempt=%s errorType=%s", review_id, delivery_attempt, type(origin).__name__)
        if delivery_attempt >= settings.max_delivery_attempts:
            reason = exc.reason if isinstance(exc, _StagedFailure) else _classify_failure(exc)
            await firestore_service.update_review(
                user_id, review_id,
                status="FAILED",
                error="Analysis failed after multiple attempts",
                failureReason=reason,
            )
        else:
            await firestore_service.update_review(user_id, review_id, status="QUEUED")
            raise
