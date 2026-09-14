import { useState, type ReactNode } from 'react';
import type { ProjectFile, ProjectFileStatus } from '../types';

const CHEVRON = (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
    <polyline points="9,5 16,12 9,19" />
  </svg>
);

const CHECK_ICON = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20,6 9,17 4,12" />
  </svg>
);
const FAIL_ICON = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);
const QUEUED_ICON = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--text-faint)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9" />
  </svg>
);
const SKIPPED_ICON = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--text-faint)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9" /><line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

// Every status is its own standalone card -- same modern treatment
// (icon-led rows, scrollable when long) regardless of which status it is,
// rather than singling "Currently Analyzing" out with a different look
// and cramming everything else into plain numeric tiles + one shared
// collapsible list.
const GROUP_ORDER: { status: ProjectFileStatus; label: string; icon: ReactNode; countColor?: string }[] = [
  { status: 'ANALYZING', label: 'Currently Analyzing', icon: <span className="spinner" style={{ width: 13, height: 13, borderWidth: 1.5, color: 'var(--accent)', margin: 0 }} />, countColor: 'var(--accent)' },
  { status: 'FAILED', label: 'Failed', icon: FAIL_ICON, countColor: 'var(--danger)' },
  { status: 'COMPLETED', label: 'Completed', icon: CHECK_ICON, countColor: 'var(--success)' },
  { status: 'QUEUED', label: 'Queued', icon: QUEUED_ICON },
  { status: 'SKIPPED', label: 'Skipped', icon: SKIPPED_ICON },
];

// Long lists (a big Queued group especially) scroll inside their own card
// instead of stretching the page indefinitely.
const SCROLL_THRESHOLD = 8;

export default function ProjectFileStatusList({ files }: { files: ProjectFile[] }) {
  const [collapsed, setCollapsed] = useState<Set<ProjectFileStatus>>(new Set(['QUEUED', 'SKIPPED']));

  const groups = GROUP_ORDER
    .map((g) => ({ ...g, items: files.filter((f) => f.status === g.status) }))
    .filter((g) => g.items.length > 0);

  if (groups.length === 0) return null;

  const toggle = (status: ProjectFileStatus) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });
  };

  return (
    <>
      {groups.map(({ status, label, icon, countColor, items }) => {
        const isCollapsed = collapsed.has(status);
        const rows = (
          <>
            {items.map((f) => (
              <div key={f.id} className="status-card-row">
                {status === 'ANALYZING'
                  ? <span className="spinner" style={{ width: 11, height: 11, borderWidth: 1.5, color: 'var(--accent)', margin: 0 }} aria-hidden="true" />
                  : <span className="status-card-icon" aria-hidden="true">
                      {status === 'COMPLETED' ? CHECK_ICON : status === 'FAILED' ? FAIL_ICON : status === 'SKIPPED' ? SKIPPED_ICON : QUEUED_ICON}
                    </span>}
                <span className="status-card-path">{f.path}</span>
                <span className="status-card-meta" style={{ color: status === 'FAILED' ? 'var(--danger)' : undefined }}>
                  {status === 'COMPLETED' && f.score != null ? f.score.toFixed(1) : status === 'FAILED' ? (f.error ?? 'Failed') : ''}
                </span>
              </div>
            ))}
          </>
        );
        return (
          <div key={status} className="card status-card">
            <button className="status-card-header" onClick={() => toggle(status)}>
              <span className="status-card-icon" aria-hidden="true">{icon}</span>
              {label} <span className="status-card-count" style={{ color: countColor }}>({items.length})</span>
              <span className={`status-card-chevron${!isCollapsed ? ' open' : ''}`} aria-hidden="true">{CHEVRON}</span>
            </button>
            {!isCollapsed && (
              items.length > SCROLL_THRESHOLD
                ? <div className="status-card-scroll">{rows}</div>
                : <div style={{ borderTop: '1px solid var(--border)' }}>{rows}</div>
            )}
          </div>
        );
      })}
    </>
  );
}
