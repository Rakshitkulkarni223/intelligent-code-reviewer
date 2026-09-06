from typing import Literal

from pydantic import BaseModel, Field

Severity = Literal["high", "medium", "low"]


class Issue(BaseModel):
    category: str
    severity: Severity
    title: str
    line: int | None = None
    description: str
    suggestion: str


class ScoreDimensions(BaseModel):
    correctness: float = Field(ge=0, le=10)
    security: float = Field(ge=0, le=10)
    performance: float = Field(ge=0, le=10)
    quality: float = Field(ge=0, le=10)
    architecture: float = Field(ge=0, le=10)


class HistoricalMatch(BaseModel):
    type: str
    description: str


class GeminiAnalysis(BaseModel):
    """Validated shape of the AI analysis, whether produced by the real Gemini
    call or the local mock analyzer. Anything that doesn't fit this schema is
    rejected rather than passed through to the client."""

    score: float = Field(ge=1, le=10)
    summary: str
    strengths: list[str] = []
    issues: list[Issue] = []
    recommendations: list[str] = []
    dimensions: ScoreDimensions
    historicalMatches: list[HistoricalMatch] = []
