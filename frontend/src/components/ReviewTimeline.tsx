interface Props {
  scores: number[];
}

// Simple inline sparkline (no charting dependency needed for a handful of points).
export default function ReviewTimeline({ scores }: Props) {
  if (scores.length < 2) return null;
  const width = 280;
  const height = 48;
  const max = 10;
  const points = scores
    .map((s, i) => {
      const x = (i / (scores.length - 1)) * width;
      const y = height - (s / max) * height;
      return `${x},${y}`;
    })
    .join(' ');

  return (
    <svg width={width} height={height} role="img" aria-label={`Score trend across last ${scores.length} reviews`}>
      <polyline points={points} fill="none" stroke="var(--accent)" strokeWidth={2} className="timeline-line" />
    </svg>
  );
}
