import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listReviews } from '../services/reviews';
import type { Review } from '../types';
import EmptyState from '../components/EmptyState';
import ErrorState from '../components/ErrorState';
import LanguageBadge from '../components/LanguageBadge';
import ReviewTimeline from '../components/ReviewTimeline';
import { formatStatus, reviewLinkTo, statusColor } from '../lib/reviewStatus';

function countBy<T>(items: T[], key: (item: T) => string): [string, number][] {
  const counts: Record<string, number> = {};
  for (const item of items) counts[key(item)] = (counts[key(item)] ?? 0) + 1;
  return Object.entries(counts).sort((a, b) => b[1] - a[1]);
}

function BreakdownBars({ title, entries, emptyText }: { title: string; entries: [string, number][]; emptyText: string }) {
  const max = Math.max(1, ...entries.map(([, n]) => n));
  return (
    <div className="card">
      <div className="stat-label" style={{ marginBottom: 10 }}>{title}</div>
      {entries.length === 0 ? (
        <p style={{ color: 'var(--text-faint)', fontSize: 13, margin: 0 }}>{emptyText}</p>
      ) : (
        entries.map(([label, count]) => (
          <div className="score-bar-row" key={label}>
            <span className="score-bar-label" style={{ textTransform: 'capitalize' }}>{label}</span>
            <span className="score-bar-track" role="img" aria-label={`${label}: ${count}`}>
              <span className="score-bar-fill" style={{ width: `${(count / max) * 100}%` }} />
            </span>
            <span className="score-bar-value">{count}</span>
          </div>
        ))
      )}
    </div>
  );
}

export default function DashboardPage() {
  const [reviews, setReviews] = useState<Review[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setError(null);
    setReviews(null);
    listReviews().then(setReviews).catch((e) => setError(e.message));
  };

  useEffect(load, []);

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
  const categoryCounts = countBy(completed.flatMap((r) => r.result?.issues ?? []), (i) => i.category);
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
          <div className={`stat-value ${improvement === undefined ? '' : improvement >= 0 ? 'positive' : 'negative'}`}>
            {improvement === undefined ? 'Not enough data yet' : `${improvement >= 0 ? '+' : ''}${improvement.toFixed(1)}`}
          </div>
        </div>
        {topCategory && (
          <div className="stat-card">
            <div className="stat-label">Most common issue</div>
            <div className="stat-value" style={{ fontSize: 18, textTransform: 'capitalize' }}>{topCategory}</div>
          </div>
        )}
      </div>

      {scoresOldestFirst.length >= 2 && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="stat-label" style={{ marginBottom: 10 }}>Score trend</div>
          <ReviewTimeline scores={scoresOldestFirst} />
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 28 }}>
        <BreakdownBars title="Language distribution" entries={languageCounts} emptyText="No submissions yet." />
        <BreakdownBars title="Issue frequency by category" entries={categoryCounts} emptyText="No issues found across your reviews." />
      </div>

      <h2 style={{ fontSize: 16, marginBottom: 12 }}>Recent reviews</h2>
      {reviews.slice(0, 5).map((r) => (
        <Link key={r.id} to={reviewLinkTo(r)} className="review-row">
          <LanguageBadge language={r.language} />
          <span style={{ color: statusColor(r.status), fontWeight: 500 }}>{formatStatus(r.status)}</span>
          <span className="review-score">{r.score != null ? r.score.toFixed(1) : '—'}</span>
          <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>{new Date(r.createdAt).toLocaleDateString()}</span>
        </Link>
      ))}
    </div>
  );
}
