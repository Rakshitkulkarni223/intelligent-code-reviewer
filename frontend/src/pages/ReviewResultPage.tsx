import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { deleteReview, getReview } from '../services/reviews';
import type { Review } from '../types';
import ConfirmModal from '../components/ConfirmModal';
import LanguageBadge from '../components/LanguageBadge';
import ReviewResultView from '../components/ReviewResultView';
import ErrorState from '../components/ErrorState';
import { useToast } from '../hooks/useToast';

// A dismissal is per-review and meant to stick across refreshes -- without
// persisting it, the banner (backed by a stored field on the review, not
// transient state) would just reappear every time this page reloads.
function isResubmissionBannerDismissed(reviewId: string): boolean {
  try {
    return localStorage.getItem(`icr_dismissed_resubmission_banner_${reviewId}`) === '1';
  } catch {
    return false;
  }
}

function dismissResubmissionBanner(reviewId: string): void {
  try {
    localStorage.setItem(`icr_dismissed_resubmission_banner_${reviewId}`, '1');
  } catch {
    // localStorage can throw (private browsing, blocked storage) -- the
    // banner just won't stay dismissed across a refresh in that case.
  }
}

export default function ReviewResultPage() {
  const { reviewId } = useParams<{ reviewId: string }>();
  const [review, setReview] = useState<Review | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bannerDismissed, setBannerDismissed] = useState(() => (reviewId ? isResubmissionBannerDismissed(reviewId) : false));
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const navigate = useNavigate();
  const { show } = useToast();

  useEffect(() => {
    if (!reviewId) return;
    getReview(reviewId).then(setReview).catch((e) => setError(e.message));
  }, [reviewId]);

  useEffect(() => {
    if (review && (review.status !== 'COMPLETED' || !review.result)) {
      navigate(`/reviews/${reviewId}/progress`, { replace: true });
    }
  }, [review, reviewId, navigate]);

  if (error) return <ErrorState message={error} />;
  if (!review || review.status !== 'COMPLETED' || !review.result) {
    return (
      <div className="card" style={{ maxHeight: 300 }}>
        <div className="skeleton" style={{ height: 200 }} />
      </div>
    );
  }

  const { result } = review;

  const handleEditCode = () => {
    if (!review.code) return;
    navigate('/reviews/new', { state: { code: review.code, language: review.language, basedOnReviewId: review.id } });
  };

  const handleDismissBanner = () => {
    if (!reviewId) return;
    dismissResubmissionBanner(reviewId);
    setBannerDismissed(true);
  };

  const handleConfirmDelete = async () => {
    if (!reviewId) return;
    setConfirmingDelete(false);
    try {
      await deleteReview(reviewId);
      show('Review deleted', 'success');
      // Dashboard/history both derive their metrics from a fresh
      // GET /api/reviews on mount, so navigating there reflects this
      // deletion automatically -- nothing to update in place here.
      navigate('/history');
    } catch (e) {
      show(e instanceof Error ? e.message : 'Delete failed', 'error');
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Code Review</h1>
          <div style={{ marginTop: 6 }}>
            <LanguageBadge language={review.language} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Link className="btn" to="/history">Back to history</Link>
          <button className="btn btn-primary" onClick={handleEditCode} disabled={!review.code}>Edit Code</button>
          <button className="btn btn-danger" onClick={() => setConfirmingDelete(true)}>Delete</button>
        </div>
      </div>

      {confirmingDelete && (
        <ConfirmModal
          title="Delete this review?"
          body="This permanently deletes the review and its result, and updates your dashboard metrics. This can't be undone."
          confirmLabel="Delete"
          danger
          onConfirm={handleConfirmDelete}
          onCancel={() => setConfirmingDelete(false)}
        />
      )}

      {review.secretsDetected && (
        <div className="confidence-picker" style={{ marginBottom: 20 }} role="alert">
          This submission appears to contain a hardcoded credential or API key. Consider rotating it
          and removing it from source control.
        </div>
      )}

      {review.isResubmission && !bannerDismissed && (
        <div className="info-banner" role="status">
          <div className="info-banner-main">
            <svg className="info-banner-icon" width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="9" />
              <line x1="12" y1="11" x2="12" y2="16.5" />
              <circle cx="12" cy="7.5" r="0.25" fill="currentColor" />
            </svg>
            <p className="info-banner-text">
              This exact code was already reviewed
              {review.previousReviewId && <> as <code>{review.previousReviewId.slice(0, 8)}</code></>}. Gemini wasn't run
              again, and this result isn't counted twice in your dashboard averages.
            </p>
          </div>
          <div className="info-banner-actions">
            {review.previousReviewId && (
              <Link className="btn" to={`/reviews/${review.previousReviewId}`}>View Review →</Link>
            )}
            <button className="info-banner-dismiss" onClick={handleDismissBanner} aria-label="Dismiss">✕</button>
          </div>
        </div>
      )}

      <ReviewResultView
        result={result}
        code={review.code}
        language={review.language}
        fixBaseId={review.id}
        overviewTopSlot={
          review.comparison && (
            <div className="card" style={{ marginBottom: 20 }}>
              <h2 style={{ fontSize: 15, marginTop: 0 }}>Compared to your previous review</h2>
              <div className="stat-grid" style={{ marginBottom: 0 }}>
                <div className="stat-card">
                  <div className="stat-label">Score Change</div>
                  <div className={`stat-value ${review.comparison.scoreChange >= 0 ? 'positive' : 'negative'}`}>
                    {review.comparison.scoreChange >= 0 ? '+' : ''}
                    {review.comparison.scoreChange.toFixed(1)}
                  </div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">Issues Resolved</div>
                  <div className={`stat-value ${review.comparison.issuesResolved > 0 ? 'positive' : ''}`}>
                    {review.comparison.issuesResolved}
                  </div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">New Issues</div>
                  <div className={`stat-value ${review.comparison.newIssues > 0 ? 'negative' : ''}`}>
                    {review.comparison.newIssues}
                  </div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">Remaining Issues</div>
                  <div className="stat-value">{review.comparison.remainingIssues}</div>
                </div>
              </div>
            </div>
          )
        }
      />
    </div>
  );
}

