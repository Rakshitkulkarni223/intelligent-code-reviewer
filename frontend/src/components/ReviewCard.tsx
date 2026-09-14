import { Link } from 'react-router-dom';
import type { Review } from '../types';
import { failureMessage, formatDateTime, reviewLinkTo } from '../lib/reviewStatus';
import LanguageBadge from './LanguageBadge';
import StatusBadge from './StatusBadge';

export default function ReviewCard({
  review,
  onRetry,
  onDelete,
}: {
  review: Review;
  onRetry: (id: string) => void;
  onDelete?: (id: string) => void;
}) {
  const issueCount = review.result?.issues.length;

  return (
    <div className="review-card">
      <div className="review-card-top">
        <LanguageBadge language={review.language} />
        <StatusBadge status={review.status} />
      </div>

      <p className="review-card-summary">
        {review.status === 'FAILED'
          ? failureMessage(review.failureReason, review.error)
          : review.status === 'COMPLETED'
            ? (review.result?.summary ?? '—')
            : 'This review is still in progress.'}
      </p>

      <div className="review-card-footer">
        <div className="review-card-metrics">
          {review.status === 'COMPLETED' && review.score != null && (
            <>
              <span className="review-card-metric">
                <strong>{review.score.toFixed(1)}</strong>/10
              </span>
              {issueCount != null && (
                <span className="review-card-metric">{issueCount} issue{issueCount === 1 ? '' : 's'}</span>
              )}
              {review.comparison && (
                <span className={`review-card-metric ${review.comparison.scoreChange >= 0 ? 'positive' : 'negative'}`}>
                  {review.comparison.scoreChange >= 0 ? '+' : ''}
                  {review.comparison.scoreChange.toFixed(1)}
                </span>
              )}
            </>
          )}
          <span className="review-card-date">{formatDateTime(review.createdAt)}</span>
        </div>
        <div className="review-card-actions">
          {review.status === 'FAILED' ? (
            <>
              <button className="btn" onClick={() => onRetry(review.id)}>Retry Review</button>
              <Link className="btn btn-ghost" to={`/reviews/${review.id}/progress`}>View Details →</Link>
            </>
          ) : (
            <Link className="btn btn-primary" to={reviewLinkTo(review)}>
              {review.status === 'COMPLETED' ? 'View Review →' : 'View Progress →'}
            </Link>
          )}
          {onDelete && (
            <button className="btn btn-danger" onClick={() => onDelete(review.id)} aria-label="Delete review">
              Delete
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
