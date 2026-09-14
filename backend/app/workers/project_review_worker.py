"""Fan-out worker for project reviews (docs/PROJECT_ZIP_REVIEW_PLAN.md §4.8).
Same fire-and-forget asyncio-task shape as review_worker.py, on its own
in-process queue so a large project can never head-of-line-block single-file
reviews sitting in pubsub_service's separate queue.

Scope note: unlike review_worker.py/pubsub_service.py, this queue has no
real-Pub/Sub counterpart yet -- it's an in-process asyncio.Queue in both
LOCAL_MODE and real mode. That's fine for correctness within one backend
process (which is what actually runs project analysis, in both modes,
exactly like review_worker.py's own task does), but it means a project job
queued right before the process restarts is lost rather than redelivered.
A real deployment wanting that durability should route this through Pub/Sub
the same way review jobs already are -- not built here to keep this
feature's scope to what docs/PROJECT_ZIP_REVIEW_PLAN.md actually specifies.
"""

import asyncio
import logging

from app.config import settings
from app.services import code_storage_service, firestore_service, project_queue_service, project_review_service

logger = logging.getLogger("project_review_worker")

RETRY_BACKOFF_SCHEDULE = [2, 5]  # seconds, indexed by attempt number (§4.8)


async def _analyze_one_file_with_retry(user_id: str, project_id: str, file_id: str) -> None:
    attempt = 0
    while True:
        attempt += 1
        try:
            await project_review_service.analyze_project_file(user_id, project_id, file_id)
            return
        except project_review_service.StagedFailure as exc:
            transient = exc.transient
            reason = exc.reason
            origin = exc.__cause__ or exc
        except Exception as exc:  # noqa: BLE001 -- an unclassified failure is treated as permanent
            transient = False
            reason = "REVIEW_SERVICE_ERROR"
            origin = exc

        logger.error(
            "project file analysis failed projectId=%s fileId=%s attempt=%s transient=%s errorType=%s",
            project_id, file_id, attempt, transient, type(origin).__name__,
        )

        if not transient or attempt > settings.project_file_max_retries:
            await project_review_service.mark_project_file_failed(
                user_id, project_id, file_id, reason,
                "Analysis failed after multiple attempts" if transient else str(origin),
            )
            return

        backoff = RETRY_BACKOFF_SCHEDULE[min(attempt - 1, len(RETRY_BACKOFF_SCHEDULE) - 1)]
        await asyncio.sleep(backoff)


async def _run_project(user_id: str, project_id: str) -> None:
    project = await firestore_service.get_project_review(user_id, project_id, include_files=True)
    if not project:
        logger.warning("project not found projectId=%s", project_id)
        return

    if project.status == "CANCELLING":
        # Cancelled after submission but before this worker actually
        # dequeued the job -- a window the responsiveness fix above made
        # much wider in practice (project creation now returns in ~1s
        # instead of tens of seconds, so a user can realistically cancel
        # before the worker even starts). Unconditionally overwriting
        # status to "ANALYZING" below would silently clobber this and make
        # the cancel a no-op, which is exactly what was observed. Every
        # file here is still QUEUED (nothing has run yet), so this is a
        # clean full cancellation -- skip everything without ever claiming
        # ANALYZING.
        for pf in project.files:
            await project_review_service.mark_project_file_skipped(user_id, project_id, pf.id)
            await project_review_service.increment_files_analyzed(user_id, project_id)
        await project_review_service.finalize_project(user_id, project_id, cancelled=True)
        return

    await firestore_service.update_project_review(user_id, project_id, status="ANALYZING")

    pending = project_review_service.get_pending_upload(project_id)
    if pending is not None:
        try:
            zip_uri = await code_storage_service.put_original_zip(user_id, project_id, pending.rawZip)
            await firestore_service.update_project_review(user_id, project_id, zipStorageUri=zip_uri)
        except Exception:  # noqa: BLE001 -- the original zip is an audit convenience (§7), never worth failing the whole project over
            logger.warning("failed to store original zip projectId=%s", project_id, exc_info=True)

    semaphore = asyncio.Semaphore(settings.project_review_concurrency)

    async def _run_one(file_id: str) -> bool:
        """Returns True if this file was skipped due to cancellation.

        Cross-check correction: the cancellation check previously lived in
        the dispatch loop below, before creating each task -- but that loop
        runs to completion in a handful of milliseconds regardless of the
        concurrency limit (creating a Task doesn't block), so by the time a
        user's cancel request reached the server, every file was already
        dispatched. The check has to live inside the semaphore-guarded work
        itself so at most `concurrency` files are ever "past the check" at
        once -- a file still waiting for a semaphore slot when CANCELLING
        is set will see it the moment its turn comes up, which is what
        actually stops new work (§4.8's intent, now actually enforced).
        """
        async with semaphore:
            current = await firestore_service.get_project_review(user_id, project_id, include_files=False)
            if current and current.status == "CANCELLING":
                await project_review_service.mark_project_file_skipped(user_id, project_id, file_id)
                await project_review_service.increment_files_analyzed(user_id, project_id)
                return True
            await _analyze_one_file_with_retry(user_id, project_id, file_id)
            await project_review_service.increment_files_analyzed(user_id, project_id)
            return False

    tasks = [asyncio.create_task(_run_one(pf.id)) for pf in project.files]
    results = await asyncio.gather(*tasks) if tasks else []
    cancelled = any(results)

    if not cancelled:
        final = await firestore_service.get_project_review(user_id, project_id, include_files=False)
        cancelled = bool(final and final.status == "CANCELLING")

    await project_review_service.finalize_project(user_id, project_id, cancelled=cancelled)


async def run_worker() -> None:
    """Mirrors review_worker.run_worker()'s shape: this task is fire-and-forget
    (asyncio.create_task in main.py's lifespan, nothing ever awaits it), so a
    project job's own failure must never escape this loop -- that would
    silently stop all future project processing with no visible error."""
    while True:
        try:
            user_id, project_id = await project_queue_service.consume()
        except Exception:  # noqa: BLE001 -- must never let this loop die
            logger.error("failed to consume from project queue, retrying", exc_info=True)
            await asyncio.sleep(2)
            continue
        try:
            await _run_project(user_id, project_id)
        except Exception:  # noqa: BLE001 -- must never let this loop die
            logger.error("project worker failed projectId=%s", project_id, exc_info=True)
        finally:
            project_queue_service.task_done()
