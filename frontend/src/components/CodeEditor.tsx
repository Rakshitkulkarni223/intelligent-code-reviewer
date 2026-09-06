import Editor from '@monaco-editor/react';

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
  plaintext: 'plaintext',
};

interface Props {
  value: string;
  language: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  height?: string;
}

export default function CodeEditor({ value, language, onChange, readOnly, height = '420px' }: Props) {
  return (
    <Editor
      height={height}
      theme="vs-dark"
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
      }}
    />
  );
}
