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

export interface Review {
  id: string;
  language: string;
  status: ReviewStatus;
  codeSize: number;
  lines: number;
  secretsDetected: boolean;
  createdAt: string;
  completedAt?: string;
  score?: number;
  result?: ReviewResult;
  error?: string;
}

export interface LanguageDetection {
  language: string;
  confidence: number;
  method: string;
  alternates: { language: string; confidence: number }[];
}
