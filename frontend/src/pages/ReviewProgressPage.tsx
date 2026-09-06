import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { getReview, retryReview } from '../services/reviews';
import type { Review } from '../types';
import ReviewStatus from '../components/ReviewStatus';
import ErrorState from '../components/ErrorState';
import { useToast } from '../hooks/useToast';

const POLL_MS = 1500;

export default function ReviewProgressPage() {
  const { reviewId } = useParams<{ reviewId: string }>();
  const [review, setReview] = useState<Review | null>(null);
  const [error, setError] = useState<string | null>(null);
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
  }, [reviewId, navigate]);

  const handleRetry = async () => {
    if (!reviewId) return;
    try {
      await retryReview(reviewId);
      setReview((r) => (r ? { ...r, status: 'QUEUED' } : r));
      show('Review resubmitted', 'success');
    } catch (e) {
      show(e instanceof Error ? e.message : 'Retry failed', 'error');
    }
  };

  if (error) return <ErrorState message={error} />;
  if (!review) {
    return (
      <div className="card" style={{ maxWidth: 480, margin: '60px auto' }}>
        <div className="skeleton" style={{ height: 20, width: '60%', margin: '0 auto 20px' }} />
        <div className="skeleton" style={{ height: 200 }} />
      </div>
    );
  }

  return (
    <div className="card" style={{ maxWidth: 480, margin: '60px auto', padding: 40 }}>
      <h1 style={{ textAlign: 'center', fontSize: 18, marginTop: 0 }}>Reviewing your code…</h1>
      <ReviewStatus status={review.status} />
      {review.status === 'FAILED' && (
        <div style={{ textAlign: 'center', marginTop: 24 }}>
          <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>{review.error ?? 'The review could not be completed.'}</p>
          <button className="btn btn-primary" onClick={handleRetry}>Retry review</button>
        </div>
      )}
    </div>
  );
}
