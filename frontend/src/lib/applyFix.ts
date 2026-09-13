const CONTEXT_LINES = 2;

/**
 * Replaces lines `line`..`endLine` (1-based, inclusive) of `code` with `fix`.
 * Returns null if the range doesn't exist in the current code -- callers
 * must fall back to "copy only" rather than splice blindly, since the code
 * shown may have drifted from what the fix's line numbers were computed
 * against (e.g. the user already edited it).
 */
export function applyFix(code: string, line: number, endLine: number, fix: string): string | null {
  const lines = code.split('\n');
  if (line < 1 || endLine < line || endLine > lines.length) return null;
  const before = lines.slice(0, line - 1);
  const after = lines.slice(endLine);
  return [...before, ...fix.split('\n'), ...after].join('\n');
}

/**
 * A before/after preview of just the affected region plus a little
 * surrounding context, for a diff modal that doesn't force scrolling
 * through the whole file. The context lines are identical in both (they
 * aren't part of the replacement) -- only the middle section differs.
 */
export function buildFixPreview(code: string, line: number, endLine: number, fix: string): { before: string; after: string } | null {
  const lines = code.split('\n');
  if (line < 1 || endLine < line || endLine > lines.length) return null;
  const startLine = Math.max(1, line - CONTEXT_LINES);
  const stopLine = Math.min(lines.length, endLine + CONTEXT_LINES);
  const leadContext = lines.slice(startLine - 1, line - 1);
  const trailContext = lines.slice(endLine, stopLine);
  const originalMiddle = lines.slice(line - 1, endLine);
  return {
    before: [...leadContext, ...originalMiddle, ...trailContext].join('\n'),
    after: [...leadContext, ...fix.split('\n'), ...trailContext].join('\n'),
  };
}
