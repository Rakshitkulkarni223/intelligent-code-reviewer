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
  DRAFT: 'var(--text-muted)',
  SUBMITTED: 'var(--text-muted)',
  QUEUED: 'var(--text-muted)',
  ANALYZING: 'var(--accent)',
  COMPLETED: 'var(--success)',
  FAILED: 'var(--danger)',
  CANCELLED: 'var(--text-muted)',
};

// Tinted background to pair with COLORS above for a pill-style status badge
// (see StatusBadge) -- every status gets a visible tint here, including the
// neutral ones, since var(--surface-raised) (the card's own background) made
// those pills blend invisibly into the card instead of reading as a badge.
const BACKGROUNDS: Record<ReviewStatus, string> = {
  DRAFT: 'var(--neutral-bg)',
  SUBMITTED: 'var(--neutral-bg)',
  QUEUED: 'var(--neutral-bg)',
  ANALYZING: 'var(--accent-muted)',
  COMPLETED: 'var(--success-bg)',
  FAILED: 'var(--danger-bg)',
  CANCELLED: 'var(--neutral-bg)',
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

// Mirrors ProjectReviewCard's own inProgress Set -- used to disable (not
// hide) the delete action while a review is actively being worked on by
// the backend, since deleting mid-flight can race the worker's own writes
// to that same review doc. DRAFT is deliberately excluded: it was never
// submitted, so there's no backend job to race with.
const IN_PROGRESS_STATUSES = new Set<ReviewStatus>(['SUBMITTED', 'QUEUED', 'ANALYZING']);

export function isReviewInProgress(status: ReviewStatus): boolean {
  return IN_PROGRESS_STATUSES.has(status);
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
