import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { getReview, retryReview } from '../services/reviews';
import type { Review } from '../types';
import ReviewStatus from '../components/ReviewStatus';
import CodeEditor from '../components/CodeEditor';
import LanguageBadge from '../components/LanguageBadge';
import ErrorState from '../components/ErrorState';
import { useToast } from '../hooks/useToast';

const POLL_MS = 1500;

export default function ReviewProgressPage() {
  const { reviewId } = useParams<{ reviewId: string }>();
  const [review, setReview] = useState<Review | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Bumped on retry to restart the polling effect below -- the poll loop
  // deliberately stops recursing once a review reaches FAILED (no point
  // polling a dead end), so without this, clicking Retry updated the status
  // optimistically once but then nothing ever polled for what happened next.
  const [pollGeneration, setPollGeneration] = useState(0);
  const navigate = useNavigate();
  const { show } = useToast();

  useEffect(() => {
    if (!reviewId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const poll = async () => {
      try {
        const r = await getReview(reviewId);
        if (cancelled) return;
        setReview(r);
        if (r.status === 'COMPLETED') {
          navigate(`/reviews/${reviewId}`, { replace: true });
          return;
        }
        if (r.status !== 'FAILED' && r.status !== 'CANCELLED') {
          timer = setTimeout(poll, POLL_MS);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load review');
      }
    };
    poll();

    return () => { cancelled = true; clearTimeout(timer); };
  }, [reviewId, navigate, pollGeneration]);

  const handleRetry = async () => {
    if (!reviewId) return;
    try {
      await retryReview(reviewId);
      setReview((r) => (r ? { ...r, status: 'QUEUED', error: undefined } : r));
      setPollGeneration((g) => g + 1);
      show('Review resubmitted', 'success');
    } catch (e) {
      show(e instanceof Error ? e.message : 'Retry failed', 'error');
    }
  };

  if (error) return <ErrorState message={error} />;

  if (!review) {
    return (
      <div className="result-layout">
        <div className="result-sidebar">
          <div className="card" style={{ minHeight: 360 }}>
            <div className="skeleton" style={{ height: 20, width: '60%', margin: '0 auto 20px' }} />
            <div className="skeleton" style={{ height: 260 }} />
          </div>
        </div>
        <div className="card" style={{ minHeight: 420 }}>
          <div className="skeleton" style={{ height: '100%' }} />
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Reviewing Code</h1>
          <div style={{ marginTop: 6 }}>
            <LanguageBadge language={review.language} />
          </div>
        </div>
      </div>

      <div className="result-layout">
        <div className="result-sidebar">
          <div className="card">
            <h2 style={{ textAlign: 'center', fontSize: 16, marginTop: 0 }}>Reviewing your code…</h2>
            <ReviewStatus status={review.status} />
            {review.status === 'FAILED' && (
              <div style={{ textAlign: 'center', marginTop: 24 }}>
                <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>{review.error ?? 'The review could not be completed.'}</p>
                <button className="btn btn-primary" onClick={handleRetry}>Retry review</button>
              </div>
            )}
          </div>
        </div>

        {review.code && (
          <div className="editor-panel">
            <CodeEditor value={review.code} language={review.language} readOnly height="560px" />
          </div>
        )}
      </div>
    </div>
  );
}
