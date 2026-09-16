export type ReviewStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'QUEUED'
  | 'ANALYZING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export type Severity = 'high' | 'medium' | 'low';

export interface Issue {
  category: string;
  severity: Severity;
  title: string;
  line?: number;
  description: string;
  suggestion: string;
  // Replacement code for lines `line`..`endLine` (inclusive) -- only present
  // when the backend could locate a concrete, mechanical fix. Never present
  // without `line`. See lib/applyFix.ts for how this gets spliced in.
  suggestedFix?: string;
  endLine?: number;
}

export interface HistoricalMatch {
  type: string;
  description: string;
}

export interface ScoreDimensions {
  correctness: number;
  security: number;
  performance: number;
  quality: number;
  architecture: number;
}

export interface ReviewResult {
  score: number;
  summary: string;
  strengths: string[];
  issues: Issue[];
  recommendations: string[];
  historicalMatches: HistoricalMatch[];
  dimensions: ScoreDimensions;
}

// Mirrors backend/app/schemas/review.py FailureReason -- keep in sync.
export type FailureReason =
  | 'SYNTAX_ERROR'
  | 'VALIDATION_ERROR'
  | 'COMPILE_ERROR'
  | 'RUNTIME_ERROR'
  | 'REVIEW_SERVICE_ERROR'
  | 'GEMINI_ERROR'
  | 'TIMEOUT'
  | 'INTERNAL_ERROR';

export interface ReviewComparison {
  previousReviewId: string;
  previousScore: number;
  scoreChange: number;
  issuesResolved: number;
  newIssues: number;
  remainingIssues: number;
}

export interface Review {
  id: string;
  language: string;
  status: ReviewStatus;
  code?: string;
  codeSize: number;
  lines: number;
  secretsDetected: boolean;
  createdAt: string;
  completedAt?: string;
  score?: number;
  result?: ReviewResult;
  error?: string;
  failureReason?: FailureReason;
  isResubmission?: boolean;
  previousReviewId?: string;
  excludeFromMetrics?: boolean;
  version?: number;
  basedOnReviewId?: string;
  previousSuccessfulReviewId?: string;
  comparison?: ReviewComparison;
}

export interface LanguageDetection {
  language: string;
  confidence: number;
  method: string;
  alternates: { language: string; confidence: number }[];
}

// Mirrors backend/app/schemas/validation.py -- keep in sync.
export type ValidationStatus =
  | 'valid'
  | 'empty'
  | 'incomplete'
  | 'syntax_error'
  | 'unsupported_language'
  | 'validation_unavailable';

export type ValidationErrorCode =
  | 'EMPTY_CODE'
  | 'INCOMPLETE_CODE'
  | 'SYNTAX_ERROR'
  | 'INDENTATION_ERROR'
  | 'UNBALANCED_DELIMITER'
  | 'UNSUPPORTED_LANGUAGE'
  | 'VALIDATOR_UNAVAILABLE'
  | 'INTERNAL_VALIDATION_ERROR';

export interface ValidationResult {
  valid: boolean;
  status: ValidationStatus;
  message: string;
  line?: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
  errorCode?: ValidationErrorCode;
  warnings: string[];
  language: string;
  validator: string;
}

// Mirrors backend/app/schemas/project_review.py -- keep in sync.
// docs/PROJECT_ZIP_REVIEW_PLAN.md

export type ProjectReviewStatus = 'QUEUED' | 'ANALYZING' | 'CANCELLING' | 'CANCELLED' | 'COMPLETED' | 'FAILED';
export type ProjectFileStatus = 'QUEUED' | 'ANALYZING' | 'COMPLETED' | 'FAILED' | 'SKIPPED';
export type ReviewMode = 'standard' | 'comprehensive';
export type PriorityTier = 'auth' | 'api' | 'data' | 'source' | 'util' | 'config' | 'test' | 'docs';

export interface ProjectProfile {
  projectType: string;
  languages: string[];
  frameworks: string[];
  entryPoints: string[];
  estimatedComplexity: 'small' | 'medium' | 'large';
}

export interface ExcludedEntry {
  path: string;
  reason: string;
}

export interface ManifestFile {
  path: string;
  language: string;
  tier: PriorityTier;
  size: number;
  lines: number;
  defaultSelected: boolean;
}

export interface ProjectManifest {
  uploadToken: string;
  originalFilename: string;
  profile: ProjectProfile;
  files: ManifestFile[];
  excluded: ExcludedEntry[];
  totalLines: number;
  totalSize: number;
}

export interface ProjectFile {
  id: string;
  path: string;
  language: string;
  tier: PriorityTier;
  status: ProjectFileStatus;
  codeSize: number;
  lines: number;
  truncated: boolean;
  truncatedNote?: string;
  score?: number;
  result?: ReviewResult;
  code?: string; // only present on the per-file detail fetch
  attempts: number;
  error?: string;
  failureReason?: FailureReason;
}

export interface WorstFile {
  fileId: string;
  path: string;
  score: number;
  issueCount: number;
}

export interface ProjectReview {
  id: string;
  status: ProjectReviewStatus;
  originalFilename: string;
  profile: ProjectProfile;
  reviewMode: ReviewMode;
  fileCount: number;
  excludedCount: number;
  filesAnalyzed: number;
  totalLines: number;
  totalSize: number;
  overallScore?: number;
  worstFiles: WorstFile[];
  mostCommonIssueCategory?: string;
  summary?: string;
  recommendations: string[];
  createdAt: string;
  completedAt?: string;
  cancelledAt?: string;
  error?: string;
  failureReason?: FailureReason;
  files: ProjectFile[];
}

// Mirrors backend/app/api/github.py -- keep in sync.
export interface GithubStatus {
  connected: boolean;
  githubUsername?: string;
}

export interface GithubRepo {
  fullName: string;
  defaultBranch: string;
  private: boolean;
}

export interface GithubBranch {
  name: string;
}

export interface GithubImportResult {
  manifest: ProjectManifest;
  repoFullName: string;
  branch: string;
  commitSha: string;
}

export interface ProjectReviewSummary {
  id: string;
  status: ProjectReviewStatus;
  originalFilename: string;
  profile: ProjectProfile;
  fileCount: number;
  filesAnalyzed: number;
  overallScore?: number;
  mostCommonIssueCategory?: string;
  createdAt: string;
  completedAt?: string;
}
