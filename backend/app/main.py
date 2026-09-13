import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.code_validation import router as code_validation_router
from app.api.reviews import router as reviews_router
from app.config import settings
from app.services import historical_data
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
    yield
    worker_task.cancel()


app = FastAPI(title="Intelligent Code Reviewer API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(reviews_router)
app.include_router(code_validation_router)


@app.get("/health")
async def health():
    return {"status": "ok", "localMode": settings.local_mode}
