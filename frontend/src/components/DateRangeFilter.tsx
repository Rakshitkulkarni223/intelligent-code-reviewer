import { useEffect, useRef, useState } from 'react';

interface Props {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
}

function formatLabel(from: string, to: string): string {
  if (!from && !to) return 'Date range';
  const fmt = (d: string) => new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  if (from && to) return `${fmt(from)} – ${fmt(to)}`;
  if (from) return `From ${fmt(from)}`;
  return `Until ${fmt(to)}`;
}

export default function DateRangeFilter({ from, to, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [draftFrom, setDraftFrom] = useState(from);
  const [draftTo, setDraftTo] = useState(to);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setDraftFrom(from);
    setDraftTo(to);
  }, [from, to]);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  const active = Boolean(from || to);

  return (
    <div className="date-range-filter" ref={containerRef}>
      <button
        type="button"
        className={`select date-range-trigger${active ? ' active' : ''}`}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        {formatLabel(from, to)}
      </button>
      {open && (
        <div className="date-range-popover" role="dialog" aria-label="Filter by date range">
          <label className="date-range-field">
            <span>From</span>
            <input
              type="date"
              className="date-input"
              value={draftFrom}
              onChange={(e) => setDraftFrom(e.target.value)}
              max={draftTo || undefined}
            />
          </label>
          <label className="date-range-field">
            <span>To</span>
            <input
              type="date"
              className="date-input"
              value={draftTo}
              onChange={(e) => setDraftTo(e.target.value)}
              min={draftFrom || undefined}
            />
          </label>
          <div className="date-range-actions">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setDraftFrom('');
                setDraftTo('');
                onChange('', '');
                setOpen(false);
              }}
            >
              Clear
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                onChange(draftFrom, draftTo);
                setOpen(false);
              }}
            >
              Apply
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
