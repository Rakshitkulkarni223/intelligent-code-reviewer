from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict

from app.schemas.gemini_response import GeminiAnalysis

ReviewStatus = Literal[
    "DRAFT", "SUBMITTED", "QUEUED", "ANALYZING", "COMPLETED", "FAILED", "CANCELLED"
]


class CreateReviewRequest(BaseModel):
    code: str
    language: str = "auto"


class CreateReviewResponse(BaseModel):
    reviewId: str
    status: ReviewStatus


class Review(BaseModel):
    id: str
    userId: str
    status: ReviewStatus
    language: str
    codeHash: str
    codeSize: int
    lines: int
    secretsDetected: bool = False
    score: float | None = None
    result: GeminiAnalysis | None = None
    error: str | None = None
    attempts: int = 0
    createdAt: datetime
    completedAt: datetime | None = None

    # code itself is intentionally never a field on this model -- it must
    # never be persisted verbatim into logs/responses beyond what's needed to
    # run the analysis.
    model_config = ConfigDict(extra="ignore")
