import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ProjectFile, ProjectFileStatus } from '../types';

type SortKey = 'path' | 'score' | 'issues';

// Mirrors StatusBadge/ProjectReviewCard's tinted-pill treatment -- a plain
// .badge with no override falls back to var(--surface-raised), the exact
// color of the card this table sits in, so the pill had no visible fill.
const FILE_STATUS_COLORS: Record<ProjectFileStatus, string> = {
  QUEUED: 'var(--text-muted)', ANALYZING: 'var(--accent)', COMPLETED: 'var(--success)',
  FAILED: 'var(--danger)', SKIPPED: 'var(--text-muted)',
};
const FILE_STATUS_BACKGROUNDS: Record<ProjectFileStatus, string> = {
  QUEUED: 'var(--neutral-bg)', ANALYZING: 'var(--accent-muted)', COMPLETED: 'var(--success-bg)',
  FAILED: 'var(--danger-bg)', SKIPPED: 'var(--neutral-bg)',
};

export default function ProjectScoreTable({
  projectId,
  files,
  onRetryFile,
}: {
  projectId: string;
  files: ProjectFile[];
  onRetryFile?: (fileId: string) => void;
}) {
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('score');
  const [sortAsc, setSortAsc] = useState(true);
  const navigate = useNavigate();

  const rows = useMemo(() => {
    const filtered = files.filter((f) => f.path.toLowerCase().includes(search.toLowerCase()));
    const sorted = [...filtered].sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'path') cmp = a.path.localeCompare(b.path);
      else if (sortKey === 'score') cmp = (a.score ?? -1) - (b.score ?? -1);
      else cmp = (a.result?.issues.length ?? 0) - (b.result?.issues.length ?? 0);
      return sortAsc ? cmp : -cmp;
    });
    return sorted;
  }, [files, search, sortKey, sortAsc]);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) setSortAsc((v) => !v);
    else { setSortKey(key); setSortAsc(key === 'path'); }
  };

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 10, alignItems: 'center' }}>
        <h2 style={{ fontSize: 15, margin: 0, flex: 1 }}>All files</h2>
        <input
          type="text"
          placeholder="Search files…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ padding: '6px 10px', fontSize: 13, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)' }}
        />
      </div>
      <div style={{ display: 'flex', padding: '8px 18px', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-faint)', borderBottom: '1px solid var(--border)' }}>
        <button className="btn-ghost" style={{ flex: 1, textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', font: 'inherit' }} onClick={() => toggleSort('path')}>
          Path {sortKey === 'path' && (sortAsc ? '▴' : '▾')}
        </button>
        <button className="btn-ghost" style={{ width: 70, textAlign: 'right', background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', font: 'inherit' }} onClick={() => toggleSort('score')}>
          Score {sortKey === 'score' && (sortAsc ? '▴' : '▾')}
        </button>
        <button className="btn-ghost" style={{ width: 90, textAlign: 'right', background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', font: 'inherit' }} onClick={() => toggleSort('issues')}>
          Issues {sortKey === 'issues' && (sortAsc ? '▴' : '▾')}
        </button>
        <span style={{ width: 24 }} />
      </div>
      <div style={{ maxHeight: 480, overflowY: 'auto' }}>
        {rows.map((f) => (
          <div
            key={f.id}
            role="button"
            tabIndex={0}
            onClick={() => navigate(`/projects/${projectId}/files/${f.id}`)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(`/projects/${projectId}/files/${f.id}`); }
            }}
            style={{
              display: 'flex', width: '100%', alignItems: 'center', gap: 10, padding: '10px 18px',
              borderBottom: '1px solid var(--border)', background: 'none', border: 'none', borderTop: 'none',
              cursor: 'pointer', fontSize: 13, color: 'inherit', textAlign: 'left',
            }}
          >
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.path}</span>
            <span style={{ width: 70, textAlign: 'right', flexShrink: 0 }}>
              {f.status === 'COMPLETED' && f.score != null ? (
                f.score.toFixed(1)
              ) : (
                <span className="badge" style={{ background: FILE_STATUS_BACKGROUNDS[f.status], color: FILE_STATUS_COLORS[f.status], borderColor: 'transparent' }}>
                  {f.status.toLowerCase()}
                </span>
              )}
            </span>
            <span style={{ width: 90, textAlign: 'right', color: 'var(--text-muted)', flexShrink: 0 }}>
              {f.result ? `${f.result.issues.length} issue${f.result.issues.length === 1 ? '' : 's'}` : ''}
            </span>
            {f.status === 'FAILED' && onRetryFile ? (
              <button
                className="btn btn-ghost"
                style={{ padding: '3px 9px', fontSize: 12 }}
                onClick={(e) => { e.stopPropagation(); onRetryFile(f.id); }}
              >
                Retry
              </button>
            ) : (
              <span style={{ width: 24, textAlign: 'right', color: 'var(--text-faint)', flexShrink: 0 }}>→</span>
            )}
          </div>
        ))}
        {rows.length === 0 && (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-faint)', fontSize: 13 }}>No files match your search.</div>
        )}
      </div>
    </div>
  );
}
