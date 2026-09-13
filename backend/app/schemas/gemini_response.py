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
    # A concrete replacement snippet for lines `line`..`endLine` (inclusive),
    # only when the fix is a mechanical code change Gemini can state directly
    # -- e.g. "use parameterized queries" gets one, "reconsider this
    # architecture" doesn't. Never populated without `line`: the frontend
    # can't safely splice a fix it can't locate. `endLine` defaults to `line`
    # itself (single-line fix) when omitted.
    suggestedFix: str | None = None
    endLine: int | None = None


class ScoreDimensions(BaseModel):
    correctness: float = Field(ge=0, le=10)
    security: float = Field(ge=0, le=10)
    performance: float = Field(ge=0, le=10)
    quality: float = Field(ge=0, le=10)
    architecture: float = Field(ge=0, le=10)


class HistoricalMatch(BaseModel):
    type: str
    description: str


class GeminiModelOutput(BaseModel):
    """Shape Gemini itself is asked to produce, via response_schema. Excludes
    historicalMatches -- those aren't a field the model fills in directly;
    relevantHistoricalRuleIds below is how it participates in building them.

    Vector Search's retrieval is by semantic similarity, not proof of
    relevance -- it can easily surface a rule that's topically related but
    doesn't actually apply (see historical_data._find_matches_vertex's
    docstring). relevantHistoricalRuleIds is Gemini's own judgment, made with
    full view of the actual code, of which of the candidate rules it was
    shown genuinely apply; the caller filters the candidates down to only
    those ids before showing anything to the user as a "match".
    """

    score: float = Field(ge=1, le=10)
    summary: str
    strengths: list[str] = []
    issues: list[Issue] = []
    recommendations: list[str] = []
    dimensions: ScoreDimensions
    relevantHistoricalRuleIds: list[str] = []


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
