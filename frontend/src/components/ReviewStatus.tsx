import type { ReviewStatus as Status } from '../types';

const STEP_LABELS = [
  'Code received',
  'Language detected',
  'Historical patterns retrieved',
  'Gemini is analyzing your code',
  'Generating recommendations',
];

// doneCount = how many steps are fully complete for this status; active = index
// of the in-progress step, or -1 when nothing is currently running.
const PROGRESS_BY_STATUS: Record<Status, { doneCount: number; active: number }> = {
  DRAFT: { doneCount: 0, active: -1 },
  SUBMITTED: { doneCount: 0, active: 0 },
  QUEUED: { doneCount: 1, active: 1 },
  ANALYZING: { doneCount: 3, active: 3 },
  COMPLETED: { doneCount: 5, active: -1 },
  FAILED: { doneCount: 2, active: -1 },
  CANCELLED: { doneCount: 1, active: -1 },
};

export default function ReviewStatus({ status }: { status: Status }) {
  const { doneCount, active } = PROGRESS_BY_STATUS[status];

  return (
    <div className="progress-steps" role="list" aria-label="Review progress">
      {STEP_LABELS.map((label, i) => {
        const done = i < doneCount;
        const isActive = i === active;
        return (
          <div key={label} className={`progress-step${done ? ' done' : ''}${isActive ? ' active' : ''}`} role="listitem">
            <span className="step-icon" aria-hidden="true">{done ? '✓' : isActive ? '●' : '○'}</span>
            {label}
          </div>
        );
      })}
      {status === 'FAILED' && (
        <div className="progress-step" style={{ color: 'var(--danger)' }} role="listitem">
          <span className="step-icon" style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }} aria-hidden="true">!</span>
          Review failed — you can retry it
        </div>
      )}
    </div>
  );
}
