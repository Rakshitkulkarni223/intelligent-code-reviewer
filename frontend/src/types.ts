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
