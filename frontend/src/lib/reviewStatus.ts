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

export function formatStatus(status: ReviewStatus): string {
  return LABELS[status];
}

export function statusColor(status: ReviewStatus): string {
  return COLORS[status];
}

export function reviewLinkTo(review: { id: string; status: ReviewStatus }): string {
  return review.status === 'COMPLETED' ? `/reviews/${review.id}` : `/reviews/${review.id}/progress`;
}
