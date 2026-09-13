import type { FailureReason, ReviewStatus } from '../types';

const LABELS: Record<ReviewStatus, string> = {
  DRAFT: 'Draft',
  SUBMITTED: 'Submitted',
  QUEUED: 'Queued',
  ANALYZING: 'Analyzing',
  COMPLETED: 'Completed',
  FAILED: 'Failed',
  CANCELLED: 'Cancelled',
};

const COLORS: Record<ReviewStatus, string> = {
  DRAFT: 'var(--text-faint)',
  SUBMITTED: 'var(--text-muted)',
  QUEUED: 'var(--text-muted)',
  ANALYZING: 'var(--accent)',
  COMPLETED: 'var(--success)',
  FAILED: 'var(--danger)',
  CANCELLED: 'var(--text-faint)',
};

// Tinted background to pair with COLORS above for a pill-style status badge
// (see StatusBadge) -- neutral statuses fall back to the app's standard
// pill background rather than a color-specific tint.
const BACKGROUNDS: Record<ReviewStatus, string> = {
  DRAFT: 'var(--surface-raised)',
  SUBMITTED: 'var(--surface-raised)',
  QUEUED: 'var(--surface-raised)',
  ANALYZING: 'var(--accent-muted)',
  COMPLETED: 'var(--success-bg)',
  FAILED: 'var(--danger-bg)',
  CANCELLED: 'var(--surface-raised)',
};

export function formatStatus(status: ReviewStatus): string {
  return LABELS[status];
}

export function statusColor(status: ReviewStatus): string {
  return COLORS[status];
}

export function statusBg(status: ReviewStatus): string {
  return BACKGROUNDS[status];
}

export function reviewLinkTo(review: { id: string; status: ReviewStatus }): string {
  return review.status === 'COMPLETED' ? `/reviews/${review.id}` : `/reviews/${review.id}/progress`;
}

// Mirrors backend/app/schemas/review.py FailureReason -- keep in sync.
const FAILURE_MESSAGES: Record<FailureReason, string> = {
  SYNTAX_ERROR: 'Your code has a syntax error and could not be analyzed.',
  VALIDATION_ERROR: 'Your code failed validation before it could be reviewed.',
  COMPILE_ERROR: 'Your code could not be compiled.',
  RUNTIME_ERROR: 'Your code raised an error while running.',
  REVIEW_SERVICE_ERROR: 'The review service ran into a problem processing your code.',
  GEMINI_ERROR: 'The AI reviewer could not complete this review.',
  TIMEOUT: 'The review took too long and timed out.',
  INTERNAL_ERROR: 'Something went wrong on our end.',
};

export function failureMessage(reason: FailureReason | undefined, fallback?: string): string {
  return (reason && FAILURE_MESSAGES[reason]) ?? fallback ?? 'The review could not be completed.';
}

// "Sep 13, 2026 · 2:15 PM" -- friendlier than a bare locale date for a card
// that already has plenty of other short numeric fields (score, issue count).
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const datePart = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  const timePart = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${datePart} · ${timePart}`;
}
