import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { getReview } from '../services/reviews';
import type { Review } from '../types';
import LanguageBadge from '../components/LanguageBadge';
import ScoreCard from '../components/ScoreCard';
import CodeEditor from '../components/CodeEditor';
import IssueList from '../components/IssueList';
import HistoricalInsight from '../components/HistoricalInsight';
import ErrorState from '../components/ErrorState';

type TabKey = 'overview' | 'issues' | 'code' | 'history';

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
  const [activeTab, setActiveTab] = useState<TabKey>('overview');
  const [bannerDismissed, setBannerDismissed] = useState(() => (reviewId ? isResubmissionBannerDismissed(reviewId) : false));
  const navigate = useNavigate();

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
        </div>
      </div>

      {review.secretsDetected && (
        <div className="confidence-picker" style={{ marginBottom: 20 }} role="alert">
          This submission appears to contain a hardcoded credential or API key. Consider rotating it
          and removing it from source control.
        </div>
      )}

      {review.isResubmission && !bannerDismissed && (
        <div
          className="validation-banner validation-pending"
          style={{ margin: '0 0 20px', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}
          role="status"
        >
          <span>
            This code was already reviewed —{' '}
            {review.previousReviewId ? (
              <Link to={`/reviews/${review.previousReviewId}`}>showing that earlier result</Link>
            ) : (
              'showing the earlier result'
            )}{' '}
            instead of running Gemini again on unchanged code. Its score isn't counted again in your dashboard averages.
          </span>
          <button
            onClick={handleDismissBanner}
            aria-label="Dismiss"
            style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: 2, flexShrink: 0 }}
          >
            ✕
          </button>
        </div>
      )}

      <div className="result-layout">
        <div className="result-sidebar">
          <ScoreCard score={result.score} dimensions={result.dimensions} />
        </div>

        <div>
          <div className="tab-bar" role="tablist">
            <button role="tab" aria-selected={activeTab === 'overview'} className={`tab-button${activeTab === 'overview' ? ' active' : ''}`} onClick={() => setActiveTab('overview')}>
              Overview
            </button>
            <button role="tab" aria-selected={activeTab === 'issues'} className={`tab-button${activeTab === 'issues' ? ' active' : ''}`} onClick={() => setActiveTab('issues')}>
              Issues <span className="tab-count">{result.issues.length}</span>
            </button>
            {review.code && (
              <button role="tab" aria-selected={activeTab === 'code'} className={`tab-button${activeTab === 'code' ? ' active' : ''}`} onClick={() => setActiveTab('code')}>
                Code
              </button>
            )}
            <button role="tab" aria-selected={activeTab === 'history'} className={`tab-button${activeTab === 'history' ? ' active' : ''}`} onClick={() => setActiveTab('history')}>
              History <span className="tab-count">{result.historicalMatches.length}</span>
            </button>
          </div>

          {activeTab === 'overview' && (
            <div>
              {review.comparison && (
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
              )}
              <div className="card" style={{ marginBottom: 20 }}>
                <h2 style={{ fontSize: 15, marginTop: 0 }}>Summary</h2>
                <p style={{ color: 'var(--text-muted)', margin: 0, lineHeight: 1.6 }}>{result.summary}</p>
                {result.strengths.length > 0 && (
                  <ul style={{ marginTop: 14, marginBottom: 0, paddingLeft: 20, color: 'var(--text-muted)', fontSize: 14, lineHeight: 1.6 }}>
                    {result.strengths.map((s, i) => <li key={i}>{s}</li>)}
                  </ul>
                )}
              </div>

              {result.recommendations.length > 0 && (
                <div className="card">
                  <h2 style={{ fontSize: 15, marginTop: 0 }}>Recommendations</h2>
                  <ul style={{ margin: 0, paddingLeft: 20, color: 'var(--text-muted)', fontSize: 14, lineHeight: 1.6 }}>
                    {result.recommendations.map((r, i) => <li key={i}>{r}</li>)}
                  </ul>
                </div>
              )}
            </div>
          )}

          {activeTab === 'issues' && <IssueList issues={result.issues} />}

          {activeTab === 'code' && review.code && (
            <div className="editor-panel">
              <CodeEditor value={review.code} language={review.language} readOnly height="520px" />
            </div>
          )}

          {activeTab === 'history' && <HistoricalInsight matches={result.historicalMatches} />}
        </div>
      </div>
    </div>
  );
}
