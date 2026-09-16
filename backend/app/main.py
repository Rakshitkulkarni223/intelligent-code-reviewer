import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.code_validation import router as code_validation_router
from app.api.github import router as github_router
from app.api.projects import router as projects_router
from app.api.reviews import router as reviews_router
from app.config import settings
from app.services import historical_data, project_review_service
from app.workers.project_review_worker import run_worker as run_project_worker
from app.workers.review_worker import run_worker

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger("main")

DEFAULT_DATA_PATH = Path(__file__).resolve().parents[2] / "data" / "historical-review-rules.csv"


def _on_worker_done(task: asyncio.Task) -> None:
    # run_worker()'s own while loop should never exit on its own -- every
    # error path inside it is caught and retried. This callback exists as a
    # backstop: if it ever does die anyway (a bug we haven't hit yet, or a
    # future regression), that's otherwise completely silent -- the task is
    # fire-and-forget, so nothing would notice reviews had stopped processing
    # until someone investigated hours of unprocessed reviews by hand (as
    # happened once already; see PLAN.md Phase 5). Cancellation at shutdown
    # is the one expected way this task ends and isn't logged as an error.
    if task.cancelled():
        return
    exc = task.exception()
    if exc is not None:
        logger.critical("review worker died -- no reviews will be processed until the process restarts", exc_info=exc)
    else:
        logger.critical("review worker exited its loop unexpectedly -- no reviews will be processed until the process restarts")


@asynccontextmanager
async def lifespan(app: FastAPI):
    data_path = Path(settings.historical_data_path) if settings.historical_data_path else DEFAULT_DATA_PATH
    summary = historical_data.load(data_path)
    logger.info("historical rules loaded indexed=%s skipped=%s", summary["indexed"], summary["skipped"])

    worker_task = asyncio.create_task(run_worker())
    worker_task.add_done_callback(_on_worker_done)
    project_worker_task = asyncio.create_task(run_project_worker())
    project_worker_task.add_done_callback(_on_worker_done)

    # project_review_worker.py's queue has no Pub/Sub-backed persistence
    # (see its own module docstring) -- a project mid-run when this process
    # last stopped is otherwise abandoned forever, stuck in ANALYZING or
    # CANCELLING with every file already finished but no worker left to
    # ever finalize it. Best-effort: a query failure here (e.g. a missing
    # Firestore composite index for the collection_group filter) must never
    # block the app from starting.
    try:
        recovered = await project_review_service.recover_stuck_projects()
        if recovered:
            logger.info("recovered %s project review(s) stuck by a previous restart", recovered)
    except Exception:  # noqa: BLE001
        logger.warning("failed to recover stuck project reviews on startup", exc_info=True)

    yield
    worker_task.cancel()
    project_worker_task.cancel()


app = FastAPI(title="Intelligent Code Reviewer API", lifespan=lifespan)

# Cross-check correction (docs/PROJECT_ZIP_REVIEW_PLAN.md §8): max_request_bytes
# was declared in config.py but never actually enforced anywhere in this
# backend before this feature -- fixed here for every route except
# /api/projects, which enforces its own (larger) max_zip_bytes limit itself
# after reading the body, since a zip upload is expected to exceed the
# JSON-request limit.
@app.middleware("http")
async def enforce_max_request_bytes(request: Request, call_next):
    if not request.url.path.startswith("/api/projects"):
        content_length = request.headers.get("content-length")
        if content_length is not None and int(content_length) > settings.max_request_bytes:
            return JSONResponse(
                status_code=413,
                content={"detail": f"Request exceeds the {settings.max_request_bytes // 1024} KB limit"},
            )
    return await call_next(request)


app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(reviews_router)
app.include_router(code_validation_router)
app.include_router(projects_router)
app.include_router(github_router)


@app.get("/health")
async def health():
    return {"status": "ok", "localMode": settings.local_mode}
