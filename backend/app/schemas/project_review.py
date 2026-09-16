from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict

from app.schemas.gemini_response import GeminiAnalysis
from app.schemas.review import FailureReason

ProjectReviewStatus = Literal["QUEUED", "ANALYZING", "CANCELLING", "CANCELLED", "COMPLETED", "FAILED"]
ProjectFileStatus = Literal["QUEUED", "ANALYZING", "COMPLETED", "FAILED", "SKIPPED"]
ReviewMode = Literal["standard", "comprehensive"]
EstimatedComplexity = Literal["small", "medium", "large"]

# Ordered first-match-wins tiers -- see file_prioritizer.py. Tuple order here
# IS the priority order the heuristics are checked in, not just a type list.
PriorityTier = Literal["auth", "api", "data", "source", "util", "config", "test", "docs"]

# Tiers pre-checked by default under "standard" review mode (§4.4). Every
# tier not in this set defaults to unchecked but remains fully selectable --
# the mode only sets the tree's starting state, never what's excludable.
STANDARD_DEFAULT_TIERS: frozenset[PriorityTier] = frozenset({"auth", "api", "data", "source", "util"})

# Tiers excluded from the headline overallScore even when COMPLETED and
# included in the review -- reviewing a README under Comprehensive mode is
# still useful, it just shouldn't dilute the score of the code that matters.
SCORE_EXCLUDED_TIERS: frozenset[PriorityTier] = frozenset({"config", "test", "docs"})

# Tiers analyzed with the stronger/slower Gemini model (settings.
# project_review_pro_model); every other tier uses the fast one (settings.
# project_review_flash_model). Calling the strongest model for every file in
# a project doesn't scale -- latency and cost multiply by file count with no
# quality gain for a config file or a test fixture. "auth" (security-
# sensitive) and "api" (the project's external-facing surface, most
# architecturally significant) are the two tiers where the stronger model's
# reasoning is actually worth the extra latency; everything else -- data,
# source, util, config, test, docs -- gets the fast model.
PRO_MODEL_TIERS: frozenset[PriorityTier] = frozenset({"auth", "api"})


class ProjectProfile(BaseModel):
    projectType: str = "Unknown"
    languages: list[str] = []
    frameworks: list[str] = []
    entryPoints: list[str] = []
    estimatedComplexity: EstimatedComplexity = "small"


class ExcludedEntry(BaseModel):
    """One archive entry that never became a reviewable ProjectFile, with a
    specific reason -- shown to the user in the file tree so nothing is ever
    a silent drop (§8/§5.2)."""

    path: str
    reason: str


class ManifestFile(BaseModel):
    """One included, reviewable file as returned in the upload manifest,
    before the user has made any include/exclude selection."""

    path: str
    language: str
    tier: PriorityTier
    size: int
    lines: int
    defaultSelected: bool


class ProjectManifest(BaseModel):
    """Response of POST /api/projects/manifest -- the preview step described
    in §5.2/§5.3, run before the user commits to a review. The client's own
    copy of this is a convenience only; §5.3's submit re-derives it
    server-side from the same zip bytes, never trusting what the client
    echoes back."""

    uploadToken: str
    originalFilename: str
    profile: ProjectProfile
    files: list[ManifestFile]
    excluded: list[ExcludedEntry]
    totalLines: int
    totalSize: int


class ProjectFile(BaseModel):
    id: str
    path: str
    language: str
    tier: PriorityTier
    status: ProjectFileStatus = "QUEUED"
    codeStorageUri: str | None = None
    codeSize: int = 0
    lines: int = 0
    truncated: bool = False
    truncatedNote: str | None = None
    score: float | None = None
    result: GeminiAnalysis | None = None
    attempts: int = 0
    error: str | None = None
    failureReason: FailureReason | None = None

    model_config = ConfigDict(extra="ignore")


class WorstFile(BaseModel):
    fileId: str
    path: str
    score: float
    issueCount: int


class ProjectReview(BaseModel):
    id: str
    userId: str
    status: ProjectReviewStatus
    originalFilename: str
    zipStorageUri: str | None = None
    profile: ProjectProfile
    reviewMode: ReviewMode = "standard"
    fileCount: int = 0
    excludedCount: int = 0
    filesAnalyzed: int = 0
    totalLines: int = 0
    totalSize: int = 0
    overallScore: float | None = None
    worstFiles: list[WorstFile] = []
    mostCommonIssueCategory: str | None = None
    summary: str | None = None
    recommendations: list[str] = []
    createdAt: datetime
    completedAt: datetime | None = None
    cancelledAt: datetime | None = None
    error: str | None = None
    failureReason: FailureReason | None = None

    # Populated only on GET /api/projects/{id} -- lightweight per-file
    # summaries (no code, no full result), the same "list is light, detail is
    # not" split /api/reviews already uses (§4.1).
    files: list[ProjectFile] = []

    model_config = ConfigDict(extra="ignore")


class ProjectReviewSummary(BaseModel):
    """GET /api/projects list item -- no files at all, matching GET
    /api/reviews's own summary-list shape."""

    id: str
    status: ProjectReviewStatus
    originalFilename: str
    profile: ProjectProfile
    fileCount: int
    filesAnalyzed: int
    overallScore: float | None = None
    # A project-level aggregate (already computed once in finalize_project),
    # not a per-file breakdown -- the dashboard's "Important metric rule" is
    # project overallScore/aggregates feed global metrics, individual file
    # scores/issues stay inside that project's own detail view.
    mostCommonIssueCategory: str | None = None
    createdAt: datetime
    completedAt: datetime | None = None


class CreateProjectRequest(BaseModel):
    uploadToken: str
    selectedPaths: list[str]
    reviewMode: ReviewMode = "standard"


class CreateProjectResponse(BaseModel):
    projectId: str
    status: ProjectReviewStatus
    fileCount: int
    excludedCount: int
