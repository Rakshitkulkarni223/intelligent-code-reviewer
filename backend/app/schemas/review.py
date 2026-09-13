from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict

from app.schemas.gemini_response import GeminiAnalysis

ReviewStatus = Literal[
    "DRAFT", "SUBMITTED", "QUEUED", "ANALYZING", "COMPLETED", "FAILED", "CANCELLED"
]

# Coarse reason a review ended in FAILED, surfaced to the user instead of a
# raw exception message and used to decide whether a retry is even sensible.
# SYNTAX_ERROR/VALIDATION_ERROR are reserved for a future pre-Gemini
# validation gate; everything this service can currently fail on is
# classified in review_service._classify_failure.
FailureReason = Literal[
    "SYNTAX_ERROR",
    "VALIDATION_ERROR",
    "COMPILE_ERROR",
    "RUNTIME_ERROR",
    "REVIEW_SERVICE_ERROR",
    "GEMINI_ERROR",
    "TIMEOUT",
    "INTERNAL_ERROR",
]


class CreateReviewRequest(BaseModel):
    code: str
    language: str = "auto"
    # Set when this submission is an explicit revision of an earlier review
    # (the "Edit Code" action carries the review it started from) -- see
    # review_service.create_review. Comparison against a previous score is
    # only ever computed against this specific review, never guessed from
    # "whatever you last successfully reviewed", since two unrelated pieces
    # of code have nothing meaningful to compare.
    basedOnReviewId: str | None = None


class CreateReviewResponse(BaseModel):
    reviewId: str
    status: ReviewStatus


class ReviewComparison(BaseModel):
    """Delta against the user's previous successful review, computed once a
    fresh review completes. Issue matching uses a stable (category,
    normalized title) key rather than exact text, since Gemini can reword the
    same underlying issue between two runs -- see review_service._issue_key."""

    previousReviewId: str
    previousScore: float
    scoreChange: float
    issuesResolved: int
    newIssues: int
    remainingIssues: int


class Review(BaseModel):
    id: str
    userId: str
    status: ReviewStatus
    language: str
    codeHash: str
    code: str
    codeSize: int
    lines: int
    secretsDetected: bool = False
    score: float | None = None
    result: GeminiAnalysis | None = None
    error: str | None = None
    failureReason: FailureReason | None = None
    attempts: int = 0
    createdAt: datetime
    completedAt: datetime | None = None
    # Set when this review's codeHash matches a prior COMPLETED review of the
    # same user's -- see review_service.create_review. previousReviewId
    # points at the review whose result was reused (no Gemini/Vector Search
    # call was made for this one).
    isResubmission: bool = False
    previousReviewId: str | None = None
    # Always equal to isResubmission -- kept as its own field since it's the
    # one DashboardPage's `completed` filter actually checks, so resubmitting
    # unchanged code (never new information) can't inflate a user's
    # Reviews/Average/Best/Improvement metrics.
    excludeFromMetrics: bool = False
    # 1-based index of this codeHash among the distinct code identities this
    # user has ever submitted, in first-submission order. Resubmitting a hash
    # seen before keeps the version it was first assigned -- version tracks
    # code identity, not review attempts.
    version: int = 1
    # What the client declared this submission as a revision of (from the
    # "Edit Code" action), if anything -- see CreateReviewRequest. Distinct
    # from previousReviewId, which specifically means "the result reused
    # instead of calling Gemini".
    basedOnReviewId: str | None = None
    # Set to basedOnReviewId once that review is confirmed to be this user's
    # own COMPLETED, scored review -- the baseline `comparison` was computed
    # against. Never set otherwise: comparing against an arbitrary unrelated
    # past review would be misleading, so no explicit lineage means no
    # comparison at all, not a guessed one.
    previousSuccessfulReviewId: str | None = None
    comparison: ReviewComparison | None = None

    # `code` is a real field (the reviewer needs to show what was reviewed) but
    # must never appear in a log line -- only reviewId/language/score/etc do.
    model_config = ConfigDict(extra="ignore")
