import { Link } from 'react-router-dom';
import type { ProjectReviewSummary } from '../types';
import { formatDateTime } from '../lib/reviewStatus';

const STATUS_LABELS: Record<ProjectReviewSummary['status'], string> = {
  QUEUED: 'Queued', ANALYZING: 'Analyzing', CANCELLING: 'Cancelling',
  CANCELLED: 'Cancelled', COMPLETED: 'Completed', FAILED: 'Failed',
};

const STATUS_COLORS: Record<ProjectReviewSummary['status'], string> = {
  QUEUED: 'var(--text-muted)', ANALYZING: 'var(--accent)', CANCELLING: 'var(--text-muted)',
  CANCELLED: 'var(--text-faint)', COMPLETED: 'var(--success)', FAILED: 'var(--danger)',
};

const inProgress = new Set(['QUEUED', 'ANALYZING', 'CANCELLING']);

// §5.6 -- project reviews get their own distinct row type in History rather
// than being mixed into ReviewCard's per-review list; a folder icon and
// "N files" stand in for the language badge a single review shows.
export default function ProjectReviewCard({ project }: { project: ProjectReviewSummary }) {
  const linkTo = inProgress.has(project.status) ? `/projects/${project.id}/progress` : `/projects/${project.id}`;

  return (
    <div className="review-card">
      <div className="review-card-top">
        <span className="badge">📁 {project.fileCount} files</span>
        <span className="badge" style={{ color: STATUS_COLORS[project.status], borderColor: 'transparent' }}>
          {STATUS_LABELS[project.status]}
        </span>
      </div>

      <p className="review-card-summary">
        {project.originalFilename} &middot; {project.profile.projectType}
      </p>

      <div className="review-card-footer">
        <div className="review-card-metrics">
          {project.status === 'COMPLETED' && project.overallScore != null && (
            <span className="review-card-metric"><strong>{project.overallScore.toFixed(1)}</strong>/10</span>
          )}
          <span className="review-card-metric">{project.filesAnalyzed}/{project.fileCount} analyzed</span>
          <span className="review-card-date">{formatDateTime(project.createdAt)}</span>
        </div>
        <div className="review-card-actions">
          <Link className="btn btn-primary" to={linkTo}>
            {inProgress.has(project.status) ? 'View Progress →' : 'View Results →'}
          </Link>
        </div>
      </div>
    </div>
  );
}
