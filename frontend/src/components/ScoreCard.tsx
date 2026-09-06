import type { ScoreDimensions } from '../types';

function scoreLabel(score: number) {
  if (score >= 9) return 'Excellent';
  if (score >= 7) return 'Good';
  if (score >= 5) return 'Fair';
  return 'Needs work';
}

const DIMENSION_LABELS: Record<keyof ScoreDimensions, string> = {
  security: 'Security',
  correctness: 'Correctness',
  performance: 'Performance',
  quality: 'Quality',
  architecture: 'Architecture',
};

export default function ScoreCard({ score, dimensions }: { score: number; dimensions: ScoreDimensions }) {
  return (
    <div className="card">
      <div className="score-hero">
        <div className="score-number">{score.toFixed(1)} / 10</div>
        <div className="score-label">{scoreLabel(score)}</div>
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
