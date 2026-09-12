import type { ScoreDimensions } from '../types';

function scoreLabel(score: number) {
  if (score >= 9) return 'Excellent';
  if (score >= 7) return 'Good';
  if (score >= 5) return 'Fair';
  return 'Needs work';
}

function scoreColor(score: number) {
  if (score >= 7) return 'var(--success)';
  if (score >= 5) return 'var(--warning)';
  return 'var(--danger)';
}

const DIMENSION_LABELS: Record<keyof ScoreDimensions, string> = {
  security: 'Security',
  correctness: 'Correctness',
  performance: 'Performance',
  quality: 'Quality',
  architecture: 'Architecture',
};

const RING_RADIUS = 54;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

export default function ScoreCard({ score, dimensions }: { score: number; dimensions: ScoreDimensions }) {
  const color = scoreColor(score);
  const offset = RING_CIRCUMFERENCE * (1 - score / 10);

  return (
    <div className="card">
      <div className="score-hero">
        <div className="score-ring-wrap" role="img" aria-label={`Overall score: ${score.toFixed(1)} out of 10, ${scoreLabel(score)}`}>
          <svg width="132" height="132" viewBox="0 0 132 132">
            <circle cx="66" cy="66" r={RING_RADIUS} fill="none" stroke="var(--border)" strokeWidth="9" />
            <circle
              cx="66" cy="66" r={RING_RADIUS} fill="none"
              stroke={color} strokeWidth="9" strokeLinecap="round"
              strokeDasharray={RING_CIRCUMFERENCE}
              strokeDashoffset={offset}
              transform="rotate(-90 66 66)"
              style={{ transition: 'stroke-dashoffset 0.6s cubic-bezier(0.22, 1, 0.36, 1)' }}
            />
          </svg>
          <div className="score-ring-center">
            <div className="score-number">{score.toFixed(1)}</div>
            <div className="score-max">/ 10</div>
          </div>
        </div>
        <div className="score-label" style={{ color }}>{scoreLabel(score)}</div>
      </div>
      <div>
        {(Object.keys(DIMENSION_LABELS) as (keyof ScoreDimensions)[]).map((key) => (
          <div className="score-bar-row" key={key}>
            <span className="score-bar-label">{DIMENSION_LABELS[key]}</span>
            <span
              className="score-bar-track"
              role="img"
              aria-label={`${DIMENSION_LABELS[key]}: ${dimensions[key].toFixed(1)} out of 10`}
            >
              <span className="score-bar-fill" style={{ width: `${(dimensions[key] / 10) * 100}%` }} />
            </span>
            <span className="score-bar-value">{dimensions[key].toFixed(1)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
