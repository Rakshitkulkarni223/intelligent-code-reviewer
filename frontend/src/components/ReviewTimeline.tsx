import { useEffect, useRef, useState } from 'react';

export interface TimelinePoint {
  score: number;
  kind: 'review' | 'project';
  version: number;
  label: string; // e.g. "Python" or "CompareAI.zip"
}

interface Props {
  points: TimelinePoint[];
}

const HEIGHT = 180;
const PAD_LEFT = 26;
const PAD_RIGHT = 14;
const PAD_TOP = 12;
const PAD_BOTTOM = 12;
const MAX_SCORE = 10;
const GRID_VALUES = [0, 5, 10];

// Full-width, height-fixed trend chart -- dots + native <title> tooltips so
// hovering any point shows what it actually was (single-file review vs.
// project, its version, and score) without pulling in a charting library
// just for this. Width is measured via ResizeObserver (rather than a
// stretched viewBox) so the dots stay perfectly round at any card width.
export default function ReviewTimeline({ points }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setWidth(w);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  if (points.length < 2) return null;

  const plotWidth = Math.max(width - PAD_LEFT - PAD_RIGHT, 0);
  const plotHeight = HEIGHT - PAD_TOP - PAD_BOTTOM;
  const yFor = (score: number) => PAD_TOP + plotHeight - (score / MAX_SCORE) * plotHeight;

  const coords = points.map((p, i) => ({
    x: PAD_LEFT + (plotWidth * i) / (points.length - 1),
    y: yFor(p.score),
    point: p,
  }));
  const linePoints = coords.map((c) => `${c.x},${c.y}`).join(' ');
  const areaPoints = `${PAD_LEFT},${PAD_TOP + plotHeight} ${linePoints} ${PAD_LEFT + plotWidth},${PAD_TOP + plotHeight}`;

  return (
    <div ref={containerRef} style={{ width: '100%', height: HEIGHT }}>
      {width > 0 && (
        <svg
          width={width}
          height={HEIGHT}
          role="img"
          aria-label={`Score trend across last ${points.length} successful reviews`}
        >
          <defs>
            <linearGradient id="timeline-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.2" />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
            </linearGradient>
          </defs>

          {GRID_VALUES.map((v) => {
            const y = yFor(v);
            return (
              <g key={v}>
                <line x1={PAD_LEFT} y1={y} x2={width - PAD_RIGHT} y2={y} stroke="var(--border)" strokeWidth={1} />
                <text x={0} y={y + 3.5} fontSize={10} fill="var(--text-faint)">{v}</text>
              </g>
            );
          })}

          <polygon points={areaPoints} fill="url(#timeline-fill)" stroke="none" />
          <polyline points={linePoints} fill="none" stroke="var(--accent)" strokeWidth={2} className="timeline-line" />

          {coords.map(({ x, y, point }, i) => (
            <circle
              key={i}
              cx={x}
              cy={y}
              r={4.5}
              fill={point.kind === 'project' ? 'var(--success)' : 'var(--accent)'}
              stroke="var(--surface)"
              strokeWidth={1.5}
            >
              <title>{`${point.kind === 'project' ? 'Project Review' : 'Code Review'}\nVersion ${point.version}\n${point.label}\nScore: ${point.score.toFixed(1)}`}</title>
            </circle>
          ))}
        </svg>
      )}
    </div>
  );
}
