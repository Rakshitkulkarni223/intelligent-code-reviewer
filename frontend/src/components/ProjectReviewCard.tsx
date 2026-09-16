import { Link } from 'react-router-dom';
import type { ProjectReviewSummary } from '../types';
import { formatDateTime } from '../lib/reviewStatus';
import { TrashIcon } from './icons';

const STATUS_LABELS: Record<ProjectReviewSummary['status'], string> = {
  QUEUED: 'Queued', ANALYZING: 'Analyzing', CANCELLING: 'Cancelling',
  CANCELLED: 'Cancelled', COMPLETED: 'Completed', PARTIAL: 'Partially completed', FAILED: 'Failed',
};

const STATUS_COLORS: Record<ProjectReviewSummary['status'], string> = {
  QUEUED: 'var(--text-muted)', ANALYZING: 'var(--accent)', CANCELLING: 'var(--text-muted)',
  CANCELLED: 'var(--text-muted)', COMPLETED: 'var(--success)', PARTIAL: 'var(--warning)', FAILED: 'var(--danger)',
};

// Tinted background pairing with STATUS_COLORS above, mirroring
// StatusBadge's own pill treatment for single-file reviews -- every status
// gets a visible tint here (including the neutral ones), since falling back
// to var(--surface-raised) is the exact color of the card itself, so that
// pill had no visible fill and just looked like floating text.
const STATUS_BACKGROUNDS: Record<ProjectReviewSummary['status'], string> = {
  QUEUED: 'var(--neutral-bg)', ANALYZING: 'var(--accent-muted)', CANCELLING: 'var(--neutral-bg)',
  CANCELLED: 'var(--neutral-bg)', COMPLETED: 'var(--success-bg)', PARTIAL: 'var(--warning-bg)', FAILED: 'var(--danger-bg)',
};

const inProgress = new Set(['QUEUED', 'ANALYZING', 'CANCELLING']);

// §5.6 -- project reviews get their own distinct row type in History rather
// than being mixed into ReviewCard's per-review list; a folder icon and
// "N files" stand in for the language badge a single review shows.
export default function ProjectReviewCard({
  project,
  onDelete,
}: {
  project: ProjectReviewSummary;
  onDelete?: (id: string) => void;
}) {
  const linkTo = inProgress.has(project.status) ? `/projects/${project.id}/progress` : `/projects/${project.id}`;

  return (
    <div className="review-card">
      <div className="review-card-top">
        <span className="badge">📁 {project.fileCount} files</span>
        <div className="review-card-top-right">
          <span className="badge" style={{ background: STATUS_BACKGROUNDS[project.status], color: STATUS_COLORS[project.status], borderColor: 'transparent' }}>
            {STATUS_LABELS[project.status]}
          </span>
          {onDelete && (
            <button className="icon-btn icon-btn-sm" onClick={() => onDelete(project.id)} aria-label="Delete project review" title="Delete project review">
              <TrashIcon />
            </button>
          )}
        </div>
      </div>

      <p className="review-card-summary">
        {project.originalFilename} &middot; {project.profile.projectType}
      </p>

      <div className="review-card-footer">
        <div className="review-card-metrics">
          {(project.status === 'COMPLETED' || project.status === 'PARTIAL') && project.overallScore != null && (
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
