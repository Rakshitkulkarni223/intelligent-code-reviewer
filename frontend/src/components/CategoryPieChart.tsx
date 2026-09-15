import { useEffect, useState } from 'react';
import { CATEGORY_PALETTE as PALETTE } from '../lib/chartColors';

const RADIUS = 52;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export default function CategoryPieChart({
  entries,
  emptyText,
}: {
  entries: [string, number][];
  emptyText: string;
}) {
  // Starts each slice at zero length and grows it to its real size right
  // after mount, so the donut visibly sweeps in instead of just appearing --
  // requestAnimationFrame (rather than setting it synchronously) guarantees
  // the browser paints the zero-length state first, so the CSS transition
  // below actually has a "from" value to animate away from.
  const [grown, setGrown] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setGrown(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  const total = entries.reduce((sum, [, n]) => sum + n, 0);

  if (total === 0) {
    return <p style={{ color: 'var(--text-faint)', fontSize: 13, margin: 0 }}>{emptyText}</p>;
  }

  let cumulative = 0;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
      <svg width="132" height="132" viewBox="0 0 132 132" style={{ flexShrink: 0 }} role="img" aria-label="Issue frequency by category">
        <circle cx="66" cy="66" r={RADIUS} fill="none" stroke="var(--border)" strokeWidth="18" />
        {entries.map(([label, value], i) => {
          const fraction = value / total;
          const dashLength = fraction * CIRCUMFERENCE;
          const dashOffset = -cumulative * CIRCUMFERENCE;
          cumulative += fraction;
          return (
            <circle
              key={label}
              cx="66"
              cy="66"
              r={RADIUS}
              fill="none"
              stroke={PALETTE[i % PALETTE.length]}
              strokeWidth="18"
              strokeDasharray={`${grown ? dashLength : 0} ${CIRCUMFERENCE}`}
              strokeDashoffset={dashOffset}
              transform="rotate(-90 66 66)"
              style={{ transition: `stroke-dasharray 0.7s cubic-bezier(0.22, 1, 0.36, 1) ${i * 80}ms` }}
            />
          );
        })}
      </svg>
      <div style={{ flex: 1, minWidth: 140, ...(entries.length > 6 ? { maxHeight: 6 * 31, overflowY: 'auto', paddingRight: 4 } : {}) }}>
        {entries.map(([label, value], i) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 13, marginBottom: 9 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: PALETTE[i % PALETTE.length], flexShrink: 0 }} aria-hidden="true" />
            <span style={{ textTransform: 'capitalize', color: 'var(--text-muted)' }}>{label}</span>
            <span style={{ marginLeft: 'auto', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
