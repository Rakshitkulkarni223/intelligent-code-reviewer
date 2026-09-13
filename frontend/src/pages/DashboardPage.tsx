import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { listReviews, retryReview } from '../services/reviews';
import type { Review } from '../types';
import CategoryPieChart from '../components/CategoryPieChart';
import DistributionBar from '../components/DistributionBar';
import EmptyState from '../components/EmptyState';
import ErrorState from '../components/ErrorState';
import ReviewCard from '../components/ReviewCard';
import ReviewTimeline from '../components/ReviewTimeline';
import { useToast } from '../hooks/useToast';

function countBy<T>(items: T[], key: (item: T) => string): [string, number][] {
  const counts: Record<string, number> = {};
  for (const item of items) counts[key(item)] = (counts[key(item)] ?? 0) + 1;
  return Object.entries(counts).sort((a, b) => b[1] - a[1]);
}

function BreakdownCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="card">
      <div className="stat-label" style={{ marginBottom: 14 }}>{title}</div>
      {children}
    </div>
  );
}

export default function DashboardPage() {
  const [reviews, setReviews] = useState<Review[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const { show } = useToast();

  const load = () => {
    setError(null);
    setReviews(null);
    listReviews().then(setReviews).catch((e) => setError(e.message));
  };

  useEffect(load, []);

  const handleRetry = async (reviewId: string) => {
    try {
      await retryReview(reviewId);
      show('Review resubmitted', 'success');
      navigate(`/reviews/${reviewId}/progress`);
    } catch (e) {
      show(e instanceof Error ? e.message : 'Retry failed', 'error');
    }
  };

  if (error) return <ErrorState message={error} onRetry={load} />;

  if (!reviews) {
    return (
      <div>
        <div className="page-header">
          <div>
            <h1 className="page-title">Welcome back</h1>
          </div>
        </div>
        <div className="stat-grid">
          {[1, 2, 3].map((i) => (
            <div className="stat-card" key={i}><div className="skeleton" style={{ height: 46 }} /></div>
          ))}
        </div>
      </div>
    );
  }

  // excludeFromMetrics marks a deliberate "Review Again Anyway" re-run of
  // code that already had a completed review -- counting its score again
  // would let re-running unchanged code on purpose inflate these numbers.
  const completed = reviews.filter((r) => r.status === 'COMPLETED' && r.score != null && !r.excludeFromMetrics);
  // completed[0] is the newest (reviews come back newest-first) -- these are
  // per-user trend metrics across all code, not per-code-version. A separate
  // "same code, later attempt" comparison would need to key off codeHash
  // instead, which isn't what these answer.
  const avgScore = completed.length ? completed.reduce((s, r) => s + (r.score ?? 0), 0) / completed.length : undefined;
  const latestScore = completed[0]?.score ?? undefined;
  const bestScore = completed.length ? Math.max(...completed.map((r) => r.score ?? 0)) : undefined;
  const improvement = completed.length >= 2 ? (completed[0].score ?? 0) - (completed[completed.length - 1].score ?? 0) : undefined;
  // Gemini doesn't always return a category with consistent casing ("Security"
  // vs "security") between calls -- normalize before grouping so those don't
  // count as two different categories on the dashboard.
  const categoryCounts = countBy(completed.flatMap((r) => r.result?.issues ?? []), (i) => i.category.toLowerCase());
  const topCategory = categoryCounts[0]?.[0];
  const languageCounts = countBy(reviews, (r) => r.language);
  const scoresOldestFirst = [...completed].reverse().map((r) => r.score ?? 0);

  if (reviews.length === 0) {
    return (
      <div>
        <h1 className="page-title">Welcome back</h1>
        <EmptyState
          icon="🧑‍💻"
          title="No reviews yet"
          description="Submit your first code review to see your dashboard come to life."
          action={<Link className="btn btn-primary" to="/reviews/new" style={{ marginTop: 12 }}>New Review</Link>}
        />
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Welcome back</h1>
          <p className="page-subtitle">Here's how your code has been trending.</p>
        </div>
        <Link className="btn btn-primary" to="/reviews/new">New Review</Link>
      </div>

      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-label">Reviews</div>
          <div className="stat-value">{completed.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Overall Average</div>
          <div className="stat-value">{avgScore !== undefined ? avgScore.toFixed(1) : '—'}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Latest Score</div>
          <div className="stat-value">{latestScore !== undefined ? latestScore.toFixed(1) : '—'}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Best Score</div>
          <div className="stat-value">{bestScore !== undefined ? bestScore.toFixed(1) : '—'}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Improvement</div>
          {improvement === undefined ? (
            <div className="stat-value" style={{ fontSize: 15, fontWeight: 500, color: 'var(--text-muted)' }}>Not enough data yet</div>
          ) : (
            <div className={`stat-value ${improvement >= 0 ? 'positive' : 'negative'}`}>
              {improvement >= 0 ? '+' : ''}{improvement.toFixed(1)}
            </div>
          )}
        </div>
        <div className="stat-card">
          <div className="stat-label">Most common issue</div>
          <div className="stat-value" style={{ fontSize: 18, textTransform: 'capitalize' }}>{topCategory ?? '—'}</div>
        </div>
      </div>

      {scoresOldestFirst.length >= 2 && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="stat-label" style={{ marginBottom: 10 }}>Score trend</div>
          <ReviewTimeline scores={scoresOldestFirst} />
        </div>
      )}

      <div className="dashboard-split">
        <BreakdownCard title="Language distribution">
          <DistributionBar entries={languageCounts} emptyText="No submissions yet." />
        </BreakdownCard>
        <BreakdownCard title="Issue frequency by category">
          <CategoryPieChart entries={categoryCounts} emptyText="No issues found across your reviews." />
        </BreakdownCard>
      </div>

      <h2 style={{ fontSize: 16, marginBottom: 12 }}>Recent reviews</h2>
      {reviews.slice(0, 5).map((r) => (
        <ReviewCard key={r.id} review={r} onRetry={handleRetry} />
      ))}
    </div>
  );
}
