import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { createReview, getReview } from '../services/reviews';
import type { Review } from '../types';
import LanguageBadge from '../components/LanguageBadge';
import ScoreCard from '../components/ScoreCard';
import CodeEditor from '../components/CodeEditor';
import IssueList from '../components/IssueList';
import HistoricalInsight from '../components/HistoricalInsight';
import ErrorState from '../components/ErrorState';
import { useToast } from '../hooks/useToast';

type TabKey = 'overview' | 'issues' | 'code' | 'history';

export default function ReviewResultPage() {
  const { reviewId } = useParams<{ reviewId: string }>();
  const [review, setReview] = useState<Review | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reviewingAgain, setReviewingAgain] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>('overview');
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

  const handleReviewAgain = async () => {
    if (!review.code) return;
    setReviewingAgain(true);
    try {
      const { reviewId: newId } = await createReview(review.code, review.language, crypto.randomUUID());
      navigate(`/reviews/${newId}/progress`);
    } catch (e) {
      show(e instanceof Error ? e.message : 'Failed to submit review', 'error');
      setReviewingAgain(false);
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
          <button className="btn btn-primary" onClick={handleReviewAgain} disabled={reviewingAgain || !review.code}>
            {reviewingAgain ? 'Submitting…' : 'Review Again'}
          </button>
        </div>
      </div>

      {review.secretsDetected && (
        <div className="confidence-picker" style={{ marginBottom: 20 }} role="alert">
          This submission appears to contain a hardcoded credential or API key. Consider rotating it
          and removing it from source control.
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
