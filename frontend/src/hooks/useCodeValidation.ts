import { useCallback, useEffect, useRef, useState } from 'react';
import { validateCode } from '../services/validation';
import type { ValidationResult } from '../types';

export type ValidationPhase = 'idle' | 'validating' | 'done' | 'error';

export interface CodeValidationState {
  phase: ValidationPhase;
  result: ValidationResult | null;
  errorMessage: string | null;
  /** Runs validation for the code/language given at call time. Aborts
   * whatever request was previously in flight first, so an old response can
   * never land after a newer one (or overwrite the result of a request for
   * different code) -- callers should also disable their "Validate" button
   * while phase === 'validating' to avoid spawning requests a user didn't
   * ask for, but this is safe even if they don't. */
  validate: (code: string, language: string) => void;
}

export function useCodeValidation(code: string, language: string): CodeValidationState {
  const [phase, setPhase] = useState<ValidationPhase>('idle');
  const [result, setResult] = useState<ValidationResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const resultKeyRef = useRef<{ code: string; language: string } | null>(null);

  // The code or language changed since the last validation -- that result no
  // longer describes what's in the editor, so drop it rather than show a
  // stale verdict next to different code. Also cancels a request that's
  // still in flight for the old code, so its response can't land later and
  // overwrite whatever comes next.
  useEffect(() => {
    if (resultKeyRef.current && (resultKeyRef.current.code !== code || resultKeyRef.current.language !== language)) {
      abortRef.current?.abort();
      resultKeyRef.current = null;
      setPhase('idle');
      setResult(null);
      setErrorMessage(null);
    }
  }, [code, language]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const validate = useCallback((requestedCode: string, requestedLanguage: string) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setPhase('validating');
    setErrorMessage(null);

    validateCode(requestedCode, requestedLanguage, controller.signal)
      .then((r) => {
        if (controller.signal.aborted) return;
        resultKeyRef.current = { code: requestedCode, language: requestedLanguage };
        setResult(r);
        setPhase('done');
      })
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;
        setPhase('error');
        setErrorMessage(e instanceof Error ? e.message : 'Validation failed');
      });
  }, []);

  return { phase, result, errorMessage, validate };
}
