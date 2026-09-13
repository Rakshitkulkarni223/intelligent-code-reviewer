import { useEffect, useRef } from 'react';
import Editor, { type BeforeMount, type Monaco, type OnMount } from '@monaco-editor/react';

type MonacoEditorInstance = Parameters<OnMount>[0];

export interface EditorMarker {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
  message: string;
  severity: 'error' | 'warning';
}

const THEME_NAME = 'code-reviewer-dark';

// A custom theme instead of the stock 'vs-dark' so the editor reads as part
// of this app's own dark palette (styles.css's CSS custom properties) rather
// than a generic foreign code-editor box dropped into it.
const defineTheme: BeforeMount = (monaco) => {
  monaco.editor.defineTheme(THEME_NAME, {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '5b6478', fontStyle: 'italic' },
      { token: 'keyword', foreground: '7c87ff' },
      { token: 'keyword.sql', foreground: '7c87ff' },
      { token: 'string', foreground: '3ecf8e' },
      { token: 'number', foreground: 'e6b450' },
      { token: 'constant', foreground: 'e6b450' },
      { token: 'type', foreground: '5ec8d8' },
      { token: 'type.identifier', foreground: '5ec8d8' },
      { token: 'function', foreground: '9aa3ff' },
      { token: 'identifier', foreground: 'c7cede' },
      { token: 'delimiter', foreground: '8f98ab' },
      { token: 'operator', foreground: '8f98ab' },
      { token: 'tag', foreground: '7c87ff' },
      { token: 'attribute.name', foreground: '9aa3ff' },
      { token: 'variable', foreground: 'c7cede' },
    ],
    colors: {
      'editor.background': '#12161f',
      'editor.foreground': '#c7cede',
      'editorLineNumber.foreground': '#5b6478',
      'editorLineNumber.activeForeground': '#7c87ff',
      'editor.lineHighlightBackground': '#181d29',
      'editor.selectionBackground': '#7c87ff40',
      'editor.selectionHighlightBackground': '#7c87ff20',
      'editor.inactiveSelectionBackground': '#7c87ff20',
      'editorCursor.foreground': '#7c87ff',
      'editorIndentGuide.background': '#232a38',
      'editorIndentGuide.activeBackground': '#333d52',
      'editorIndentGuide.background1': '#232a38',
      'editorIndentGuide.activeBackground1': '#333d52',
      'editorWhitespace.foreground': '#232a38',
      'editorBracketMatch.background': '#7c87ff26',
      'editorBracketMatch.border': '#7c87ff',
      'editorGutter.background': '#12161f',
      'scrollbarSlider.background': '#333d5280',
      'scrollbarSlider.hoverBackground': '#5b6478a0',
      'scrollbarSlider.activeBackground': '#5b6478c0',
    },
  });
};

const MONACO_LANGUAGE_MAP: Record<string, string> = {
  cpp: 'cpp',
  c: 'c',
  python: 'python',
  javascript: 'javascript',
  typescript: 'typescript',
  java: 'java',
  go: 'go',
  rust: 'rust',
  ruby: 'ruby',
  php: 'php',
  sql: 'sql',
  plaintext: 'plaintext',
};

interface Props {
  value: string;
  language: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  height?: string;
  ariaLabel?: string;
  /** Inline error/warning squiggles, e.g. from a validation result. Cleared
   * automatically whenever this prop becomes empty/undefined -- callers
   * don't need to clear them manually on code or language change. */
  markers?: EditorMarker[];
}

const MARKER_OWNER = 'code-validation';

export default function CodeEditor({ value, language, onChange, readOnly, height = '420px', ariaLabel, markers }: Props) {
  const editorRef = useRef<MonacoEditorInstance | null>(null);
  const monacoRef = useRef<Monaco | null>(null);

  const handleMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
  };

  useEffect(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    const model = editor?.getModel();
    if (!editor || !monaco || !model) return;

    monaco.editor.setModelMarkers(
      model,
      MARKER_OWNER,
      (markers ?? []).map((m) => ({
        ...m,
        severity: m.severity === 'error' ? monaco.MarkerSeverity.Error : monaco.MarkerSeverity.Warning,
      })),
    );
  }, [markers]);

  return (
    <Editor
      height={height}
      theme={THEME_NAME}
      beforeMount={defineTheme}
      onMount={handleMount}
      language={MONACO_LANGUAGE_MAP[language] ?? 'plaintext'}
      value={value}
      onChange={(v) => onChange?.(v ?? '')}
      options={{
        fontSize: 13,
        minimap: { enabled: false },
        automaticLayout: true,
        scrollBeyondLastLine: false,
        tabSize: 2,
        wordWrap: 'on',
        readOnly,
        domReadOnly: readOnly,
        ariaLabel,
      }}
    />
  );
}
