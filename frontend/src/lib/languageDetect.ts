import type { LanguageDetection } from '../types';

const EXTENSION_MAP: Record<string, string> = {
  py: 'python',
  js: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  java: 'java',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  hpp: 'cpp',
  go: 'go',
  rs: 'rust',
  rb: 'ruby',
  php: 'php',
  sql: 'sql',
};

// Lightweight client-side heuristic. The backend re-validates authoritatively.
const SIGNATURES: { language: string; patterns: RegExp[] }[] = [
  { language: 'python', patterns: [/^\s*def\s+\w+\(.*\):/m, /^\s*import\s+\w+/m, /^\s*#!.*python/, /:\s*$/m, /^\s*elif\b/m] },
  { language: 'ruby', patterns: [/^\s*def\s+\w+/m, /\bend\b\s*$/m, /^\s*require\s+['"]/m, /^\s*#!.*ruby/] },
  { language: 'typescript', patterns: [/:\s*(string|number|boolean|void|any)\b/, /\binterface\s+\w+/, /\bimport\s+.*\bfrom\b/] },
  { language: 'javascript', patterns: [/\bconst\s+\w+\s*=/, /\bfunction\s+\w+\(/, /=>\s*{/, /\bconsole\.log\(/] },
  { language: 'java', patterns: [/\bpublic\s+class\s+\w+/, /\bSystem\.out\.println\(/, /\bpublic\s+static\s+void\s+main\(/] },
  { language: 'go', patterns: [/^\s*package\s+\w+/m, /\bfunc\s+\w+\(/, /:=\s*/] },
  { language: 'rust', patterns: [/\bfn\s+\w+\(/, /^\s*use\s+\w+::/m, /\blet\s+mut\b/] },
  { language: 'cpp', patterns: [/#include\s*<\w+>/, /\bstd::/, /\bcout\s*<</] },
  { language: 'c', patterns: [/#include\s*<\w+\.h>/, /\bprintf\(/] },
  { language: 'php', patterns: [/^<\?php/, /\becho\s+/] },
  { language: 'sql', patterns: [/^\s*(SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM|CREATE\s+TABLE|ALTER\s+TABLE|DROP\s+TABLE)\b/im, /\bFROM\s+\w+/i, /\bWHERE\b/i, /\bJOIN\b/i] },
];

function scoreByContent(code: string) {
  const scores: Record<string, number> = {};
  for (const { language, patterns } of SIGNATURES) {
    const hits = patterns.filter((p) => p.test(code)).length;
    if (hits > 0) scores[language] = hits / patterns.length;
  }
  return scores;
}

export function detectLanguage(code: string, filename?: string): LanguageDetection {
  const ext = filename?.split('.').pop()?.toLowerCase();
  const extLanguage = ext ? EXTENSION_MAP[ext] : undefined;

  const contentScores = scoreByContent(code);
  if (extLanguage) {
    contentScores[extLanguage] = (contentScores[extLanguage] ?? 0) + 0.5;
  }

  const ranked = Object.entries(contentScores)
    .map(([language, raw]) => ({ language, raw }))
    .sort((a, b) => b.raw - a.raw);

  if (ranked.length === 0) {
    return { language: extLanguage ?? 'plaintext', confidence: extLanguage ? 0.5 : 0, method: extLanguage ? 'extension' : 'none', alternates: [] };
  }

  const total = ranked.reduce((sum, r) => sum + r.raw, 0) || 1;
  const normalized = ranked.map((r) => ({ language: r.language, confidence: Math.round((r.raw / total) * 100) / 100 }));

  return {
    language: normalized[0].language,
    confidence: normalized[0].confidence,
    method: extLanguage ? 'extension + syntax' : 'syntax + keywords',
    alternates: normalized.slice(1, 3),
  };
}

export const SUPPORTED_LANGUAGES = [
  'python', 'javascript', 'typescript', 'java', 'c', 'cpp', 'go', 'rust', 'ruby', 'php', 'sql',
];

// Capitalizing the raw language code gets most languages right (python ->
// Python) but mangles the ones with non-standard casing in their real name.
const LABEL_OVERRIDES: Record<string, string> = { cpp: 'C++', sql: 'SQL', php: 'PHP' };

export function languageLabel(lang: string): string {
  return LABEL_OVERRIDES[lang] ?? lang.charAt(0).toUpperCase() + lang.slice(1);
}
