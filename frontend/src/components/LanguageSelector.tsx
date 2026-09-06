import { SUPPORTED_LANGUAGES } from '../lib/languageDetect';

interface Props {
  value: string;
  onChange: (language: string) => void;
}

export default function LanguageSelector({ value, onChange }: Props) {
  return (
    <select
      className="select"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label="Programming language"
    >
      {SUPPORTED_LANGUAGES.map((lang) => (
        <option key={lang} value={lang}>
          {lang}
        </option>
      ))}
    </select>
  );
}
