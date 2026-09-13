import { SUPPORTED_LANGUAGES, languageLabel } from '../lib/languageDetect';
import SelectMenu from './SelectMenu';

interface Props {
  value: string;
  onChange: (language: string) => void;
}

// "plaintext" isn't in SUPPORTED_LANGUAGES (that list is real programming
// languages the backend can review/validate), but detectLanguage() falls
// back to it when it can't identify anything -- listed here so that value
// is actually selectable instead of matching no option.
const LANGUAGE_OPTIONS = [
  { value: 'plaintext', label: 'Plain Text' },
  ...SUPPORTED_LANGUAGES.map((lang) => ({ value: lang, label: languageLabel(lang) })),
];

export default function LanguageSelector({ value, onChange }: Props) {
  return <SelectMenu value={value} options={LANGUAGE_OPTIONS} onChange={onChange} ariaLabel="Programming language" />;
}
