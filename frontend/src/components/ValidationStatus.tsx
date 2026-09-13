import type { ValidationPhase } from '../hooks/useCodeValidation';
import type { ValidationResult } from '../types';

const STATUS_LABEL: Record<ValidationResult['status'], string> = {
  valid: 'Valid',
  empty: 'Nothing to validate',
  incomplete: 'Incomplete',
  syntax_error: 'Syntax error',
  unsupported_language: 'Language not recognized',
  validation_unavailable: 'Syntax check unavailable',
};

interface Props {
  phase: ValidationPhase;
  result: ValidationResult | null;
  errorMessage: string | null;
}

export default function ValidationStatus({ phase, result, errorMessage }: Props) {
  if (phase === 'validating') {
    return (
      <div className="validation-banner validation-pending" role="status">
        Validating code…
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div className="validation-banner validation-fail" role="alert">
        {errorMessage ?? 'Could not validate the code right now.'}
      </div>
    );
  }

  if (!result) return null;

  if (result.status === 'valid') {
    return (
      <div className="validation-banner validation-ok" role="status">
        ✓ {result.message}
      </div>
    );
  }

  if (result.status === 'validation_unavailable' || result.status === 'unsupported_language') {
    return (
      <div className="validation-banner validation-warn" role="status">
        ⚠ {result.message}
      </div>
    );
  }

  // empty / incomplete / syntax_error -- all block Review Code
  return (
    <div className="validation-banner validation-fail" role="alert">
      <strong>{STATUS_LABEL[result.status]}</strong>
      {result.line != null && (
        <span className="validation-location">
          {' '}
          Line {result.line}
          {result.column != null ? `, Column ${result.column}` : ''}:
        </span>
      )}
      <div>{result.message}</div>
    </div>
  );
}
