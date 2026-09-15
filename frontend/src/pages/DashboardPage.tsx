import { useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { deleteReview, listReviews, retryReview } from '../services/reviews';
import { deleteProjectReview, listProjectReviews } from '../services/projects';
import type { ProjectReviewSummary, Review } from '../types';
import { queryKeys } from '../lib/queryKeys';
import CategoryPieChart from '../components/CategoryPieChart';
import ConfirmModal from '../components/ConfirmModal';
import DistributionBar from '../components/DistributionBar';
import EmptyState from '../components/EmptyState';
import ErrorState from '../components/ErrorState';
import ReviewCard from '../components/ReviewCard';
import ProjectReviewCard from '../components/ProjectReviewCard';
import ReviewTimeline, { type TimelinePoint } from '../components/ReviewTimeline';
import { useToast } from '../hooks/useToast';

function countBy<T>(items: T[], key: (item: T) => string): [string, number][] {
  const counts: Record<string, number> = {};
  for (const item of items) counts[key(item)] = (counts[key(item)] ?? 0) + 1;
  return Object.entries(counts).sort((a, b) => b[1] - a[1]);
}

// Sums counts for the same label across two independently-tallied lists --
// used only for the combined "Most Common Issue" summary stat. The two
// analytics panels below keep their own separate tallies (Code Review
// Analytics vs. Project Review Analytics) -- this merge is deliberately
// not reused there, per the "don't mix per-file findings into the
// single-file chart" rule.
function mergeCounts(...lists: [string, number][][]): [string, number][] {
  const merged: Record<string, number> = {};
  for (const list of lists) for (const [k, v] of list) merged[k] = (merged[k] ?? 0) + v;
  return Object.entries(merged).sort((a, b) => b[1] - a[1]);
}

function BreakdownCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="card">
      <div className="stat-label" style={{ marginBottom: 14 }}>{title}</div>
      {children}
    </div>
  );
}

interface ScoredItem {
  score: number;
  createdAt: string;
  kind: 'review' | 'project';
  label: string;
}

type PendingDelete = { id: string; kind: 'review' | 'project' };

export default function DashboardPage() {
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const navigate = useNavigate();
  const { show } = useToast();
  const queryClient = useQueryClient();

  // React Query keeps whatever was last fetched in cache, so navigating back
  // to this page renders that immediately instead of blanking to a skeleton
  // -- it revalidates in the background (staleTime: 30s, set globally) and
  // only re-renders if the data actually changed.
  const { data: reviews, error: reviewsError, refetch: refetchReviews } = useQuery({ queryKey: queryKeys.reviews, queryFn: listReviews });
  const { data: projects, error: projectsError, refetch: refetchProjects } = useQuery({ queryKey: queryKeys.projectReviews, queryFn: listProjectReviews });

  const handleRetry = async (reviewId: string) => {
    try {
      await retryReview(reviewId);
      queryClient.invalidateQueries({ queryKey: queryKeys.reviews });
      show('Review resubmitted', 'success');
      navigate(`/reviews/${reviewId}/progress`);
    } catch (e) {
      show(e instanceof Error ? e.message : 'Retry failed', 'error');
    }
  };

  const handleConfirmDelete = async () => {
    if (!pendingDelete || isDeleting) return;
    const { id, kind } = pendingDelete;
    // Keeps the modal open (with a spinner) for the whole request instead of
    // closing right away -- a project delete cleans up every file's storage
    // object and can take a few seconds, and closing immediately let people
    // re-open the modal and fire a second delete for the same item before
    // the first had even finished.
    setIsDeleting(true);
    try {
      if (kind === 'review') {
        await deleteReview(id);
        // All the stats below are recomputed from `reviews` on every render,
        // so dropping the deleted one from the cache here is what makes them
        // update -- also keeps History's copy of this same cache entry in sync.
        queryClient.setQueryData<Review[]>(queryKeys.reviews, (prev) => (prev ? prev.filter((r) => r.id !== id) : prev));
        show('Review deleted', 'success');
      } else {
        await deleteProjectReview(id);
        queryClient.setQueryData<ProjectReviewSummary[]>(queryKeys.projectReviews, (prev) => (prev ? prev.filter((p) => p.id !== id) : prev));
        show('Project review deleted', 'success');
      }
      setPendingDelete(null);
    } catch (e) {
      show(e instanceof Error ? e.message : 'Delete failed', 'error');
    } finally {
      setIsDeleting(false);
    }
  };

  const error = reviewsError ?? projectsError;
  if (error) {
    return <ErrorState message={error instanceof Error ? error.message : 'Failed to load'} onRetry={() => { refetchReviews(); refetchProjects(); }} />;
  }

  if (!reviews || !projects) {
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

  if (reviews.length === 0 && projects.length === 0) {
    return (
      <div>
        <h1 className="page-title">Welcome back</h1>
        <EmptyState
          icon="🧑‍💻"
          title="No reviews yet"
          description="Submit your first code or project review to see your dashboard come to life."
          action={<Link className="btn btn-primary" to="/reviews/new" style={{ marginTop: 12 }}>New Review</Link>}
        />
      </div>
    );
  }

  // excludeFromMetrics marks a deliberate "Review Again Anyway" re-run of
  // code that already had a completed review -- counting its score again
  // would let re-running unchanged code on purpose inflate these numbers.
  // Important metric rule: a project's own overallScore (already an
  // aggregate across its files) feeds these global numbers; individual
  // project-file scores never do -- those stay inside that project's own
  // detail view.
  const completedReviews = reviews.filter((r) => r.status === 'COMPLETED' && r.score != null && !r.excludeFromMetrics);
  const completedProjects = projects.filter((p) => p.status === 'COMPLETED' && p.overallScore != null);

  const combinedScored: ScoredItem[] = [
    ...completedReviews.map((r): ScoredItem => ({ score: r.score!, createdAt: r.createdAt, kind: 'review', label: r.language })),
    ...completedProjects.map((p): ScoredItem => ({ score: p.overallScore!, createdAt: p.createdAt, kind: 'project', label: p.originalFilename })),
  ].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()); // oldest first, for the trend + "improvement" delta

  const avgScore = combinedScored.length ? combinedScored.reduce((s, i) => s + i.score, 0) / combinedScored.length : undefined;
  const latestScore = combinedScored.at(-1)?.score;
  const bestScore = combinedScored.length ? Math.max(...combinedScored.map((i) => i.score)) : undefined;
  const improvement = combinedScored.length >= 2 ? combinedScored.at(-1)!.score - combinedScored[0].score : undefined;

  // Code Review Analytics -- unchanged, single-file data only.
  const languageCounts = countBy(reviews, (r) => r.language);
  const codeCategoryCounts = countBy(completedReviews.flatMap((r) => r.result?.issues ?? []), (i) => i.category.toLowerCase());

  // Project Review Analytics -- project data only, never mixed into the
  // charts above. Technology distribution uses every project regardless of
  // status (the stack is knowable even for one still running or failed);
  // issue frequency uses each completed project's own already-aggregated
  // mostCommonIssueCategory, one vote per project, not a per-file tally.
  const techCounts = countBy(projects.flatMap((p) => [...p.profile.languages, ...p.profile.frameworks]), (t) => t.toLowerCase());
  const projectCategoryCounts = countBy(
    projects.filter((p): p is ProjectReviewSummary & { mostCommonIssueCategory: string } => !!p.mostCommonIssueCategory),
    (p) => p.mostCommonIssueCategory.toLowerCase()
  );

  // The only place code-review and project-review category tallies mix --
  // a single combined "what needs attention most" headline stat.
  const combinedCategoryCounts = mergeCounts(codeCategoryCounts, projectCategoryCounts);
  const topCategory = combinedCategoryCounts[0]?.[0];

  // Keeps the chart readable no matter how much history piles up -- past
  // this many points, evenly-spaced dots on a fixed-width chart start
  // overlapping each other, so we show only the most recent slice (their
  // real version numbers are preserved, not renumbered from 1).
  const MAX_TIMELINE_POINTS = 20;
  const timelinePoints: TimelinePoint[] = combinedScored
    .map((item, i) => ({ score: item.score, kind: item.kind, version: i + 1, label: item.label }))
    .slice(-MAX_TIMELINE_POINTS);

  const recentActivity = [
    ...reviews.map((r) => ({ kind: 'review' as const, createdAt: r.createdAt, data: r })),
    ...projects.map((p) => ({ kind: 'project' as const, createdAt: p.createdAt, data: p })),
  ]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 5);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Welcome back</h1>
          <p className="page-subtitle">Here's how your code and projects have been trending.</p>
        </div>
        <Link className="btn btn-primary" to="/reviews/new">New Review</Link>
      </div>

      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-label">Total Reviews</div>
          <div className="stat-value">{completedReviews.length + completedProjects.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Code Reviews</div>
          <div className="stat-value">{completedReviews.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Project Reviews</div>
          <div className="stat-value">{completedProjects.length}</div>
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
          <div className="stat-label">Most Common Issue</div>
          <div className="stat-value" style={{ fontSize: 18, textTransform: 'capitalize' }}>{topCategory ?? '—'}</div>
        </div>
      </div>

      {timelinePoints.length >= 2 && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="stat-label" style={{ marginBottom: 10 }}>
            Score trend
            {combinedScored.length > MAX_TIMELINE_POINTS && (
              <span style={{ textTransform: 'none', letterSpacing: 'normal', fontWeight: 400 }}>
                {' '}· last {MAX_TIMELINE_POINTS} of {combinedScored.length}
              </span>
            )}
          </div>
          <ReviewTimeline points={timelinePoints} />
        </div>
      )}

      {(completedReviews.length > 0 || completedProjects.length > 0) && (
        <BreakdownCard title="Review distribution">
          <DistributionBar
            entries={[['Code Reviews', completedReviews.length], ['Project Reviews', completedProjects.length]]}
            emptyText="No completed reviews yet."
            colors={['var(--accent)', 'var(--success)']}
          />
        </BreakdownCard>
      )}

      <div style={{ height: 20 }} />

      <div className="dashboard-split">
        <div>
          <h2 style={{ fontSize: 15, marginBottom: 12 }}>Code Review Analytics</h2>
          <BreakdownCard title="Language distribution">
            <DistributionBar entries={languageCounts} emptyText="No submissions yet." />
          </BreakdownCard>
          <div style={{ height: 16 }} />
          <BreakdownCard title="Issue frequency">
            <CategoryPieChart entries={codeCategoryCounts} emptyText="No issues found across your reviews." />
          </BreakdownCard>
        </div>
        <div>
          <h2 style={{ fontSize: 15, marginBottom: 12 }}>Project Review Analytics</h2>
          <BreakdownCard title="Technology distribution">
            <DistributionBar entries={techCounts} emptyText="No project reviews yet." />
          </BreakdownCard>
          <div style={{ height: 16 }} />
          <BreakdownCard title="Project issue frequency">
            <CategoryPieChart entries={projectCategoryCounts} emptyText="No issues found across your projects." />
          </BreakdownCard>
        </div>
      </div>

      <div className="page-header" style={{ marginTop: 8 }}>
        <h2 style={{ fontSize: 16, margin: 0 }}>Recent activity</h2>
        <Link className="btn btn-ghost" to="/history">View all →</Link>
      </div>
      {recentActivity.map((item) =>
        item.kind === 'review'
          ? <ReviewCard key={`review-${item.data.id}`} review={item.data} onRetry={handleRetry} onDelete={(id) => setPendingDelete({ id, kind: 'review' })} />
          : <ProjectReviewCard key={`project-${item.data.id}`} project={item.data} onDelete={(id) => setPendingDelete({ id, kind: 'project' })} />
      )}

      {pendingDelete && (
        <ConfirmModal
          title={pendingDelete.kind === 'review' ? 'Delete this review?' : 'Delete this project review?'}
          body={
            pendingDelete.kind === 'review'
              ? "This permanently deletes the review and its result, and updates your dashboard metrics. This can't be undone."
              : "This permanently deletes the project review and every analyzed file in it, and updates your dashboard metrics. This can't be undone."
          }
          confirmLabel="Delete"
          danger
          loading={isDeleting}
          onConfirm={handleConfirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}
