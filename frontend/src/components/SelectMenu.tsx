import { useEffect, useRef, useState } from 'react';

export interface SelectMenuOption<T extends string> {
  value: T;
  label: string;
}

interface Props<T extends string> {
  value: T;
  options: SelectMenuOption<T>[];
  onChange: (value: T) => void;
  ariaLabel: string;
  // Adds a filter box inside the popover -- opt-in since it only earns its
  // keep on a list that can genuinely grow long (e.g. GitHub's repo
  // picker); a small fixed list like a status/sort filter doesn't need it.
  searchable?: boolean;
}

const CheckIcon = () => (
  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

// A custom dropdown that looks and behaves consistently with the rest of the
// app's dark theme -- a native <select>'s open menu is drawn by the OS/
// browser and can't be styled, which looks jarring next to a custom popover
// like DateRangeFilter's.
export default function SelectMenu<T extends string>({ value, options, onChange, ariaLabel, searchable }: Props<T>) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (open && searchable) {
      setSearch('');
      // Popover isn't in the DOM yet on the same tick it opens.
      requestAnimationFrame(() => searchInputRef.current?.focus());
    }
  }, [open, searchable]);

  const current = options.find((o) => o.value === value);
  const filtered = searchable && search.trim()
    ? options.filter((o) => o.label.toLowerCase().includes(search.trim().toLowerCase()))
    : options;

  const items = (
    <>
      {filtered.length === 0 ? (
        <li style={{ padding: '10px', fontSize: 13, color: 'var(--text-faint)' }}>No matches</li>
      ) : (
        filtered.map((o) => (
          <li key={o.value} role="option" aria-selected={o.value === value}>
            <button
              type="button"
              className={`dropdown-item${o.value === value ? ' selected' : ''}`}
              onClick={() => {
                onChange(o.value);
                setOpen(false);
              }}
            >
              {o.label}
              {o.value === value && <CheckIcon />}
            </button>
          </li>
        ))
      )}
    </>
  );

  return (
    <div className="dropdown" ref={containerRef}>
      <button
        type="button"
        className="select dropdown-trigger"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
      >
        {current?.label ?? ariaLabel}
      </button>
      {open && (
        searchable ? (
          <div className="dropdown-menu" style={{ padding: 0, maxHeight: 320, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: 8, borderBottom: '1px solid var(--border)' }}>
              <input
                ref={searchInputRef}
                className="search-input"
                style={{ width: '100%' }}
                placeholder={`Search ${ariaLabel.toLowerCase()}…`}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <ul role="listbox" aria-label={ariaLabel} style={{ listStyle: 'none', margin: 0, padding: 6, overflowY: 'auto' }}>
              {items}
            </ul>
          </div>
        ) : (
          <ul className="dropdown-menu" role="listbox" aria-label={ariaLabel}>
            {items}
          </ul>
        )
      )}
    </div>
  );
}
