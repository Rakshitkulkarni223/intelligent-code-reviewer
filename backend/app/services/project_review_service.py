"""Create/list/get/cancel + per-file analysis + aggregation for project
reviews (docs/PROJECT_ZIP_REVIEW_PLAN.md). Mirrors review_service.py's shape
for the single-file flow: this is the "what happens," project_review_worker.py
owns "when/how many at once/how many retries."
"""

import asyncio
import logging
import time
import uuid
from dataclasses import dataclass, field

from app.config import settings
from app.schemas.project_review import (
    SCORE_EXCLUDED_TIERS,
    ExcludedEntry as ManifestExcludedEntry,
    ManifestFile,
    ProjectFile,
    ProjectManifest,
    ProjectProfile,
    ProjectReview,
    ProjectReviewSummary,
    ReviewMode,
    WorstFile,
)
from app.security.validation import ValidationError, validate_code
from app.services import (
    code_storage_service,
    file_prioritizer,
    firestore_service,
    gemini_service,
    project_detector,
    project_queue_service,
)
from app.services.zip_extraction import ExtractedFile, ZipValidationError, extract_project

logger = logging.getLogger("project_review_service")

UPLOAD_CACHE_TTL_SECONDS = 15 * 60


class NoReviewableFilesError(Exception):
    """Archive was valid but nothing ended up selected/reviewable -- a 422,
    distinct from ZipValidationError's 400 (§4.1)."""


class UploadNotFoundError(Exception):
    """The upload token is missing, expired, or belongs to another user."""


class StagedFailure(Exception):
    """Same shape as review_service.StagedFailure -- wraps an exception with
    whether it's transient (worth retrying) and the FailureReason it implies."""

    def __init__(self, reason: str, transient: bool, cause: Exception) -> None:
        super().__init__(str(cause))
        self.reason = reason
        self.transient = transient


# §4.8 cross-check correction: review_worker.py has no transient/permanent
# distinction today (every failure retries identically via redelivery) --
# this classification is new, built specifically for per-file project retry.
_TRANSIENT_EXCEPTION_NAMES = {
    "TimeoutError", "ResourceExhausted", "ServiceUnavailable",
    "InternalServerError", "DeadlineExceeded", "TooManyRequests", "GatewayTimeout",
}


def is_transient_failure(exc: Exception) -> bool:
    if isinstance(exc, ValidationError):
        return False
    if type(exc).__name__ in _TRANSIENT_EXCEPTION_NAMES:
        return True
    status_code = getattr(exc, "code", None) or getattr(exc, "status_code", None)
    if isinstance(status_code, int) and (status_code == 429 or 500 <= status_code < 600):
        return True
    return False


@dataclass
class _CachedUpload:
    userId: str
    filename: str
    raw_zip: bytes
    files: list[ExtractedFile]
    profile: ProjectProfile
    excluded: list[ManifestExcludedEntry]
    expiresAt: float
    files_by_path: dict[str, ExtractedFile] = field(default_factory=dict)

    def __post_init__(self) -> None:
        self.files_by_path = {f.path: f for f in self.files}


# In-process, short-TTL cache of a validated extraction, keyed by an opaque
# upload token -- lets the frontend preview the file tree (§5.2) and then
# submit a selection (§5.3) without re-uploading the zip bytes a second
# time. This is a deliberate, documented deviation from §5.3's literal
# "sends the original zip bytes again" wording: the security invariant it
# was protecting -- "the client's tree is a preview, never the security
# boundary" -- is preserved because every guard in zip_extraction.py already
# ran once during the upload that created this cache entry, and
# create_project_review() below only ever selects from this cache's own
# files_by_path, never from an arbitrary client-supplied path. A restart
# drops the cache, which just means an in-flight upload has to be redone --
# acceptable for a 15-minute preview window.
_upload_cache: dict[str, _CachedUpload] = {}
_upload_cache_lock = asyncio.Lock()


def _prune_expired_uploads() -> None:
    now = time.monotonic()
    expired = [token for token, entry in _upload_cache.items() if entry.expiresAt < now]
    for token in expired:
        del _upload_cache[token]


async def preview_project(user_id: str, filename: str, data: bytes) -> ProjectManifest:
    """§5.2/§5.3's manifest step. Raises ZipValidationError (400) on an
    archive-level violation; the caller (api/projects.py) maps that to the
    right HTTP status."""
    extraction = extract_project(data)  # raises ZipValidationError

    profile = project_detector.detect_project(extraction.files)

    manifest_files: list[ManifestFile] = []
    for f in extraction.files:
        tier = file_prioritizer.assign_tier(f.path)
        language = file_prioritizer.detect_language_for_path(f.path, f.text)
        manifest_files.append(
            ManifestFile(
                path=f.path,
                language=language,
                tier=tier,
                size=f.size,
                lines=f.text.count("\n") + 1,
                defaultSelected=file_prioritizer.default_selected(tier, "standard"),
            )
        )

    excluded = [ManifestExcludedEntry(path=e.path, reason=e.reason) for e in extraction.excluded]

    upload_token = uuid.uuid4().hex
    async with _upload_cache_lock:
        _prune_expired_uploads()
        _upload_cache[upload_token] = _CachedUpload(
            userId=user_id,
            filename=filename,
            raw_zip=data,
            files=extraction.files,
            profile=profile,
            excluded=excluded,
            expiresAt=time.monotonic() + UPLOAD_CACHE_TTL_SECONDS,
        )

    return ProjectManifest(
        uploadToken=upload_token,
        originalFilename=filename,
        profile=profile,
        files=manifest_files,
        excluded=excluded,
        totalLines=sum(f.lines for f in manifest_files),
        totalSize=sum(f.size for f in manifest_files),
    )


@dataclass
class _PendingUpload:
    """Content the worker still needs to materialize into object storage --
    kept in-process rather than written during create_project_review() so
    that request stays fast (§4.8/§8 cross-check: writing 82 files' worth of
    real Cloud Storage blobs synchronously inside the API call is exactly
    the kind of thing that made submission look "stuck" with no feedback).
    Popped once by the worker at the start of _run_project(); each file's
    text is peeked (not popped) by analyze_project_file() on its first
    attempt, since a retry needs it again if codeStorageUri isn't set yet."""

    rawZip: bytes
    fileTexts: dict[str, str]  # file_id -> text, only for files not yet stored


_pending_uploads: dict[str, _PendingUpload] = {}
_pending_uploads_lock = asyncio.Lock()


async def create_project_review(
    user_id: str, upload_token: str, selected_paths: list[str], review_mode: ReviewMode
) -> ProjectReview:
    async with _upload_cache_lock:
        _prune_expired_uploads()
        cached = _upload_cache.get(upload_token)
        if not cached or cached.userId != user_id:
            raise UploadNotFoundError("Upload not found or expired -- please re-upload the archive")
        # One-shot: once submitted, the same manifest shouldn't be resubmitted
        # into a second project by replaying an old token.
        del _upload_cache[upload_token]

    # Never trust client-supplied paths beyond what this server itself
    # already validated and cached (§5.3) -- selection is an intersection,
    # never a union, with the cached, already-guarded file list.
    selected = [cached.files_by_path[p] for p in dict.fromkeys(selected_paths) if p in cached.files_by_path]
    if not selected:
        raise NoReviewableFilesError("No files selected for review")

    now = firestore_service.now()
    project_id = uuid.uuid4().hex

    # Metadata only here -- no object-storage writes. Each ProjectFile doc
    # exists up front (codeStorageUri=None) so the worker's per-file
    # cancellation check still has a stable file list to enumerate; the
    # actual content upload happens lazily, one file at a time, in the
    # worker (analyze_project_file), which is also what makes "processing
    # file N of M" visible on the progress page instead of every file
    # appearing QUEUED at once with no sense of what's actually happening.
    project_files: list[ProjectFile] = []
    pending_texts: dict[str, str] = {}
    total_lines = 0
    total_size = 0
    for f in selected:
        tier = file_prioritizer.assign_tier(f.path)
        language = file_prioritizer.detect_language_for_path(f.path, f.text)
        file_id = uuid.uuid4().hex
        lines = f.text.count("\n") + 1
        total_lines += lines
        total_size += f.size
        pf = ProjectFile(
            id=file_id,
            path=f.path,
            language=language,
            tier=tier,
            status="QUEUED",
            codeStorageUri=None,
            codeSize=f.size,
            lines=lines,
        )
        project_files.append(pf)
        pending_texts[file_id] = f.text

    # Independent per-file doc creates -- fired concurrently rather than
    # one at a time, since a real Firestore round-trip per file (even for a
    # small metadata-only doc) still adds up meaningfully at 80+ files.
    await asyncio.gather(*(firestore_service.create_project_file(user_id, project_id, pf) for pf in project_files))

    async with _pending_uploads_lock:
        _pending_uploads[project_id] = _PendingUpload(rawZip=cached.raw_zip, fileTexts=pending_texts)

    project = ProjectReview(
        id=project_id,
        userId=user_id,
        status="QUEUED",
        originalFilename=cached.filename,
        zipStorageUri=None,
        profile=cached.profile,
        reviewMode=review_mode,
        fileCount=len(project_files),
        excludedCount=len(cached.excluded),
        filesAnalyzed=0,
        totalLines=total_lines,
        totalSize=total_size,
        createdAt=now,
    )
    await firestore_service.create_project_review(project)
    await project_queue_service.publish(user_id, project_id)
    logger.info("project review submitted projectId=%s fileCount=%s", project_id, len(project_files))
    return project


def get_pending_upload(project_id: str) -> _PendingUpload | None:
    """Peeked (never popped here) -- fileTexts stays available for whichever
    file gets analyzed last. The worker reads .rawZip once at the start of a
    run; cleanup_pending_upload() below is what actually releases this."""
    return _pending_uploads.get(project_id)


def get_pending_file_text(project_id: str, file_id: str) -> str | None:
    """Peeked by analyze_project_file -- a retry after a transient failure
    needs the same text again if the first attempt never got far enough to
    set codeStorageUri."""
    pending = _pending_uploads.get(project_id)
    return pending.fileTexts.get(file_id) if pending else None


async def cleanup_pending_upload(project_id: str) -> None:
    """Releases this project's in-memory pending text/zip once every file is
    terminal (called from finalize_project) -- otherwise it would leak for
    the lifetime of the process."""
    async with _pending_uploads_lock:
        _pending_uploads.pop(project_id, None)


async def get_project_review(user_id: str, project_id: str) -> ProjectReview | None:
    return await firestore_service.get_project_review(user_id, project_id, include_files=True)


async def list_project_reviews(user_id: str) -> list[ProjectReviewSummary]:
    projects = await firestore_service.list_project_reviews(user_id)
    return [
        ProjectReviewSummary(
            id=p.id, status=p.status, originalFilename=p.originalFilename, profile=p.profile,
            fileCount=p.fileCount, filesAnalyzed=p.filesAnalyzed, overallScore=p.overallScore,
            mostCommonIssueCategory=p.mostCommonIssueCategory,
            createdAt=p.createdAt, completedAt=p.completedAt,
        )
        for p in projects
    ]


async def get_project_file_detail(user_id: str, project_id: str, file_id: str) -> tuple[ProjectFile, str] | None:
    project = await firestore_service.get_project_review(user_id, project_id, include_files=False)
    if not project:
        return None
    pf = await firestore_service.get_project_file(user_id, project_id, file_id)
    if not pf:
        return None
    code = await code_storage_service.get(pf.codeStorageUri) if pf.codeStorageUri else ""
    return pf, code


async def cancel_project_review(user_id: str, project_id: str) -> ProjectReview | None:
    """Known residual race, narrower than the one project_review_worker's
    CANCELLING-check fixes: this call's own read-then-write here isn't
    atomic with the worker's read-then-write of status="ANALYZING" in
    _run_project. If the worker's "ANALYZING" write happens to land in
    Firestore *after* this call's "CANCELLING" write (both read the old
    status independently, then race to write), last-write-wins means the
    cancellation is silently lost -- not just delayed, since nothing re-
    reads "what the user asked for," only "what's currently persisted."
    In practice this requires the two writes to interleave within a very
    narrow window (the worker's read and its very next write, with no
    other awaits between them), so it's far less likely to bite than the
    now-fixed "dispatched before the worker started at all" case. A fully
    correct fix needs a conditional/transactional update (e.g. a Firestore
    transaction that only writes "ANALYZING" if the read status is still
    "QUEUED"); not done here to keep this fix scoped to the bug actually
    reported, but worth doing before relying on cancel under real load."""
    project = await firestore_service.get_project_review(user_id, project_id, include_files=False)
    if not project:
        return None
    if project.status not in ("QUEUED", "ANALYZING"):
        return project
    return await firestore_service.update_project_review(user_id, project_id, status="CANCELLING")


# --- Per-file analysis, called once per attempt by project_review_worker.py ---


def _budget_text(text: str) -> tuple[str, bool, str | None]:
    lines = text.split("\n")
    total_lines = len(lines)
    if total_lines <= settings.project_file_max_lines:
        return text, False, None
    truncated_text = "\n".join(lines[: settings.project_file_max_lines])
    note = (
        f"Reviewed the first {settings.project_file_max_lines} of {total_lines} lines -- "
        f"this file exceeded the per-file analysis limit."
    )
    return truncated_text, True, note


async def analyze_project_file(user_id: str, project_id: str, file_id: str) -> None:
    """One attempt at analyzing one file. Raises StagedFailure (carrying
    whether it's transient) on failure -- never swallows an error, since
    project_review_worker.py's retry/backoff loop needs to see it.

    codeStorageUri starts unset (create_project_review no longer uploads
    content synchronously, see _PendingUpload) -- the first attempt at a
    file materializes it here, one file at a time, from the in-process
    pending text the API request stashed. This is deliberately what makes
    "processing file N of M" observable on the progress page instead of
    every file's content silently uploading inside the original request."""
    pf = await firestore_service.get_project_file(user_id, project_id, file_id)
    if not pf:
        raise StagedFailure("REVIEW_SERVICE_ERROR", False, ValueError("project file not found"))

    await firestore_service.update_project_file(user_id, project_id, file_id, status="ANALYZING")

    if pf.codeStorageUri is None:
        code = get_pending_file_text(project_id, file_id)
        if code is None:
            raise StagedFailure("REVIEW_SERVICE_ERROR", False, ValueError("pending file text missing"))
        try:
            code_uri = await code_storage_service.put(user_id, project_id, file_id, code)
        except Exception as exc:  # noqa: BLE001
            raise StagedFailure("REVIEW_SERVICE_ERROR", is_transient_failure(exc), exc) from exc
        await firestore_service.update_project_file(user_id, project_id, file_id, codeStorageUri=code_uri)
    else:
        try:
            code = await code_storage_service.get(pf.codeStorageUri)
        except Exception as exc:  # noqa: BLE001
            raise StagedFailure("REVIEW_SERVICE_ERROR", is_transient_failure(exc), exc) from exc

    budgeted_code, truncated, truncated_note = _budget_text(code)

    try:
        validate_code(budgeted_code)
    except ValidationError as exc:
        raise StagedFailure("VALIDATION_ERROR", False, exc) from exc

    try:
        analysis, _categories = await gemini_service.analyze_code(budgeted_code, pf.language)
    except Exception as exc:  # noqa: BLE001
        raise StagedFailure("GEMINI_ERROR", is_transient_failure(exc), exc) from exc

    await firestore_service.update_project_file(
        user_id, project_id, file_id,
        status="COMPLETED", score=analysis.score, result=analysis,
        truncated=truncated, truncatedNote=truncated_note, error=None, failureReason=None,
    )


async def mark_project_file_failed(user_id: str, project_id: str, file_id: str, reason: str, message: str) -> None:
    await firestore_service.update_project_file(
        user_id, project_id, file_id, status="FAILED", error=message, failureReason=reason,
    )


async def mark_project_file_skipped(user_id: str, project_id: str, file_id: str) -> None:
    await firestore_service.update_project_file(user_id, project_id, file_id, status="SKIPPED")


async def increment_files_analyzed(user_id: str, project_id: str) -> ProjectReview | None:
    project = await firestore_service.get_project_review(user_id, project_id, include_files=False)
    if not project:
        return None
    return await firestore_service.update_project_review(
        user_id, project_id, filesAnalyzed=project.filesAnalyzed + 1
    )


# --- Aggregation (§4.5) + summary pass (§4.7), run once every file is terminal ---


def _aggregate(files: list[ProjectFile]) -> tuple[float | None, list[WorstFile], str | None]:
    eligible = [f for f in files if f.status == "COMPLETED" and f.tier not in SCORE_EXCLUDED_TIERS and f.score is not None]
    if not eligible:
        return None, [], None

    overall_score = round(sum(f.score for f in eligible) / len(eligible), 1)

    worst_sorted = sorted(eligible, key=lambda f: (f.score, -(len(f.result.issues) if f.result else 0)))
    worst_files = [
        WorstFile(fileId=f.id, path=f.path, score=f.score, issueCount=len(f.result.issues) if f.result else 0)
        for f in worst_sorted[:3]
    ]

    category_counts: dict[str, int] = {}
    for f in eligible:
        if not f.result:
            continue
        for issue in f.result.issues:
            key = issue.category.lower()
            category_counts[key] = category_counts.get(key, 0) + 1
    most_common = max(category_counts.items(), key=lambda kv: kv[1])[0] if category_counts else None

    return overall_score, worst_files, most_common


async def _run_summary_pass(project: ProjectReview, files: list[ProjectFile]) -> tuple[str | None, list[str]]:
    file_summaries = [
        {
            "path": f.path, "tier": f.tier, "score": f.score,
            "topIssues": [i.title for i in (f.result.issues[:3] if f.result else [])],
        }
        for f in files if f.status == "COMPLETED"
    ]
    if not file_summaries:
        return None, []
    try:
        summary, recommendations = await gemini_service.summarize_project(project.profile.model_dump(), file_summaries)
        return summary, recommendations
    except Exception:  # noqa: BLE001 -- never blocks COMPLETED; every file's own result is already the substance
        logger.warning("project summary pass failed projectId=%s", project.id, exc_info=True)
        return None, []


async def finalize_project(user_id: str, project_id: str, cancelled: bool) -> None:
    project = await firestore_service.get_project_review(user_id, project_id, include_files=False)
    if not project:
        return
    files = await firestore_service.list_project_files(user_id, project_id)
    # Every file is terminal at this point (COMPLETED/FAILED/SKIPPED) -- any
    # pending text this project's request stashed has either been
    # materialized into storage or never will be, so it's safe to release.
    await cleanup_pending_upload(project_id)

    overall_score, worst_files, most_common = _aggregate(files)
    eligible_exists = any(f.status == "COMPLETED" and f.tier not in SCORE_EXCLUDED_TIERS for f in files)
    any_completed_at_all = any(f.status == "COMPLETED" for f in files)

    if cancelled:
        await firestore_service.update_project_review(
            user_id, project_id, status="CANCELLED", cancelledAt=firestore_service.now(),
            overallScore=overall_score, worstFiles=worst_files, mostCommonIssueCategory=most_common,
        )
        return

    if not eligible_exists and not any_completed_at_all and files:
        await firestore_service.update_project_review(
            user_id, project_id, status="FAILED", completedAt=firestore_service.now(),
            error="Every file failed analysis", failureReason="REVIEW_SERVICE_ERROR",
        )
        return

    summary, recommendations = await _run_summary_pass(project, files)
    await firestore_service.update_project_review(
        user_id, project_id, status="COMPLETED", completedAt=firestore_service.now(),
        overallScore=overall_score, worstFiles=worst_files, mostCommonIssueCategory=most_common,
        summary=summary, recommendations=recommendations,
    )
    logger.info("project review completed projectId=%s overallScore=%s", project_id, overall_score)
