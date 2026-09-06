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

export default function ReviewResultPage() {
  const { reviewId } = useParams<{ reviewId: string }>();
  const [review, setReview] = useState<Review | null>(null);
  const [error, setError] = useState<string | null>(null);
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
          <Link className="btn btn-primary" to="/reviews/new">Review Again</Link>
        </div>
      </div>

      {review.secretsDetected && (
        <div className="confidence-picker" style={{ marginBottom: 20 }} role="alert">
          This submission appears to contain a hardcoded credential or API key. Consider rotating it
          and removing it from source control.
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 340px) 1fr', gap: 24, alignItems: 'start' }}>
        <ScoreCard score={result.score} dimensions={result.dimensions} />

        <div>
          <div className="card" style={{ marginBottom: 20 }}>
            <h2 style={{ fontSize: 15, marginTop: 0 }}>Summary</h2>
            <p style={{ color: 'var(--text-muted)', margin: 0 }}>{result.summary}</p>
            {result.strengths.length > 0 && (
              <ul style={{ marginTop: 14, marginBottom: 0, paddingLeft: 20, color: 'var(--text-muted)', fontSize: 14 }}>
                {result.strengths.map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            )}
          </div>

          {review.code && (
            <>
              <h2 style={{ fontSize: 15, marginBottom: 12 }}>Reviewed Code</h2>
              <div className="editor-panel" style={{ marginBottom: 20 }}>
                <CodeEditor value={review.code} language={review.language} readOnly height="320px" />
              </div>
            </>
          )}

          <h2 style={{ fontSize: 15, marginBottom: 12 }}>Issues</h2>
          <IssueList issues={result.issues} />

          {result.recommendations.length > 0 && (
            <div className="card" style={{ marginTop: 20, marginBottom: 20 }}>
              <h2 style={{ fontSize: 15, marginTop: 0 }}>Recommendations</h2>
              <ul style={{ margin: 0, paddingLeft: 20, color: 'var(--text-muted)', fontSize: 14 }}>
                {result.recommendations.map((r, i) => <li key={i}>{r}</li>)}
              </ul>
            </div>
          )}

          <h2 style={{ fontSize: 15, marginBottom: 12 }}>Historical Insight</h2>
          <HistoricalInsight matches={result.historicalMatches} />
        </div>
      </div>
    </div>
  );
}
