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
export default function SelectMenu<T extends string>({ value, options, onChange, ariaLabel }: Props<T>) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

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

  const current = options.find((o) => o.value === value);

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
        <ul className="dropdown-menu" role="listbox" aria-label={ariaLabel}>
          {options.map((o) => (
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
          ))}
        </ul>
      )}
    </div>
  );
}
