import type { ReviewStatus } from '../types';

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
