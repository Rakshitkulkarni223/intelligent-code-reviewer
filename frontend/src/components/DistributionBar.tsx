import { useEffect, useState } from 'react';
import { LANGUAGE_PALETTE as PALETTE } from '../lib/chartColors';

export default function DistributionBar({
  entries,
  emptyText,
}: {
  entries: [string, number][];
  emptyText: string;
}) {
  // Starts every segment at 0 width and grows it to its real share right
  // after mount, so the bar visibly fills in instead of just appearing.
  const [grown, setGrown] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setGrown(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  const total = entries.reduce((sum, [, n]) => sum + n, 0);

  if (total === 0) {
    return <p style={{ color: 'var(--text-faint)', fontSize: 13, margin: 0 }}>{emptyText}</p>;
  }

  return (
    <div>
      <div
        style={{ display: 'flex', height: 14, borderRadius: 999, overflow: 'hidden', marginBottom: 18 }}
        role="img"
        aria-label={entries.map(([label, value]) => `${label}: ${value}`).join(', ')}
      >
        {entries.map(([label, value], i) => (
          <div
            key={label}
            title={`${label}: ${value}`}
            style={{
              width: `${grown ? (value / total) * 100 : 0}%`,
              background: PALETTE[i % PALETTE.length],
              transition: `width 0.6s cubic-bezier(0.22, 1, 0.36, 1) ${i * 80}ms`,
            }}
          />
        ))}
      </div>
      <div>
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
