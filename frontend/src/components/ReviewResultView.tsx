import { useState, type ReactNode } from 'react';
import type { ReviewResult } from '../types';
import ScoreCard from './ScoreCard';
import CodeEditor from './CodeEditor';
import IssueList from './IssueList';
import HistoricalInsight from './HistoricalInsight';

type TabKey = 'overview' | 'issues' | 'code' | 'history';

interface Props {
  result: ReviewResult;
  code?: string;
  language: string;
  // Passed through to IssueList/IssueCard as `reviewId` -- purely the id an
  // "Apply Fix" navigation declares itself a revision of (basedOnReviewId).
  // For a ProjectFile this won't resolve to an actual Review server-side, so
  // the fix flow still works but shows no before/after comparison -- expected
  // per docs/PROJECT_ZIP_REVIEW_PLAN.md §6 (fixing one file re-enters the
  // ordinary single-file flow, not a project-aware version of itself).
  fixBaseId: string;
  // Generic slot for chrome specific to the caller's own record type (e.g.
  // ReviewResultPage's comparison-against-previous-review card) -- kept
  // generic here rather than naming "comparison" so this component stays
  // ignorant of what a Review is.
  overviewTopSlot?: ReactNode;
}

// Extracted out of ReviewResultPage (docs/PROJECT_ZIP_REVIEW_PLAN.md §5.5
// cross-check correction) so a project file's drill-down view can render
// the same tabs/ScoreCard/IssueList/fix-flow without ReviewResultPage's own
// Review-only chrome (resubmission banner, comparison card, redirect-while-
// pending) leaking into it. Each caller renders its own chrome around this.
export default function ReviewResultView({ result, code, language, fixBaseId, overviewTopSlot }: Props) {
  const [activeTab, setActiveTab] = useState<TabKey>('overview');

  return (
    <div className="result-layout">
      <div className="result-sidebar">
        <ScoreCard score={result.score} dimensions={result.dimensions} />
      </div>

      <div>
        <div className="tab-bar" role="tablist">
          <button role="tab" aria-selected={activeTab === 'overview'} className={`tab-button${activeTab === 'overview' ? ' active' : ''}`} onClick={() => setActiveTab('overview')}>
            Overview
          </button>
          <button role="tab" aria-selected={activeTab === 'issues'} className={`tab-button${activeTab === 'issues' ? ' active' : ''}`} onClick={() => setActiveTab('issues')}>
            Issues <span className="tab-count">{result.issues.length}</span>
          </button>
          {code && (
            <button role="tab" aria-selected={activeTab === 'code'} className={`tab-button${activeTab === 'code' ? ' active' : ''}`} onClick={() => setActiveTab('code')}>
              Code
            </button>
          )}
          <button role="tab" aria-selected={activeTab === 'history'} className={`tab-button${activeTab === 'history' ? ' active' : ''}`} onClick={() => setActiveTab('history')}>
            History <span className="tab-count">{result.historicalMatches.length}</span>
          </button>
        </div>

        {activeTab === 'overview' && (
          <div>
            {overviewTopSlot}
            <div className="card" style={{ marginBottom: 20 }}>
              <h2 style={{ fontSize: 15, marginTop: 0 }}>Summary</h2>
              <p style={{ color: 'var(--text-muted)', margin: 0, lineHeight: 1.6 }}>{result.summary}</p>
              {result.strengths.length > 0 && (
                <ul style={{ marginTop: 14, marginBottom: 0, paddingLeft: 20, color: 'var(--text-muted)', fontSize: 14, lineHeight: 1.6 }}>
                  {result.strengths.map((s, i) => <li key={i}>{s}</li>)}
                </ul>
              )}
            </div>

            {result.recommendations.length > 0 && (
              <div className="card">
                <h2 style={{ fontSize: 15, marginTop: 0 }}>Recommendations</h2>
                <ul style={{ margin: 0, paddingLeft: 20, color: 'var(--text-muted)', fontSize: 14, lineHeight: 1.6 }}>
                  {result.recommendations.map((r, i) => <li key={i}>{r}</li>)}
                </ul>
              </div>
            )}
          </div>
        )}

        {activeTab === 'issues' && (
          <IssueList issues={result.issues} code={code} language={language} reviewId={fixBaseId} />
        )}

        {activeTab === 'code' && code && (
          <div className="editor-panel">
            <CodeEditor value={code} language={language} readOnly height="520px" />
          </div>
        )}

        {activeTab === 'history' && <HistoricalInsight matches={result.historicalMatches} />}
      </div>
    </div>
  );
}
