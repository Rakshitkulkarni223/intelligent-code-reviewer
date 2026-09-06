import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.reviews import router as reviews_router
from app.config import settings
from app.services import historical_data
from app.workers.review_worker import run_worker

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger("main")

DEFAULT_DATA_PATH = Path(__file__).resolve().parents[2] / "data" / "historical-review-rules.csv"


@asynccontextmanager
async def lifespan(app: FastAPI):
    data_path = Path(settings.historical_data_path) if settings.historical_data_path else DEFAULT_DATA_PATH
    summary = historical_data.load(data_path)
    logger.info("historical rules loaded indexed=%s skipped=%s", summary["indexed"], summary["skipped"])

    worker_task = asyncio.create_task(run_worker())
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


@app.get("/health")
async def health():
    return {"status": "ok", "localMode": settings.local_mode}
