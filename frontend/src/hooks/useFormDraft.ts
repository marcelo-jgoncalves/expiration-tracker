/**
 * sessionStorage-backed form draft (mission §49 - session interruption): a user filling
 * Create/Renew whose session expires mid-form is redirected through a real full-page
 * navigation (BFF login, D-053) and back - any in-memory React state is gone regardless of
 * how carefully it's held. Persisting the draft to sessionStorage (never localStorage - a
 * draft is scoped to this submission attempt, not meant to outlive the tab) lets the same
 * form rehydrate with the user's entered values once they land back on it. Read/write
 * failures (private browsing, disabled storage) degrade to an in-memory-only draft rather
 * than throwing - same convention as api/client.ts's readCookie.
 */
import { useCallback, useState } from "react";

function readDraft<T>(storageKey: string): T | undefined {
  try {
    const raw = window.sessionStorage.getItem(storageKey);
    return raw ? (JSON.parse(raw) as T) : undefined;
  } catch {
    return undefined;
  }
}

function writeDraft<T>(storageKey: string, value: T): void {
  try {
    window.sessionStorage.setItem(storageKey, JSON.stringify(value));
  } catch {
    // Degrade silently - the draft still works in-memory for this render tree's lifetime.
  }
}

function clearDraft(storageKey: string): void {
  try {
    window.sessionStorage.removeItem(storageKey);
  } catch {
    // Nothing to do - if it couldn't be written, it doesn't need clearing either.
  }
}

export interface FormDraft<T> {
  draft: T;
  update: (next: T) => void;
  clear: () => void;
}

export function useFormDraft<T>(storageKey: string, initial: T): FormDraft<T> {
  const [draft, setDraft] = useState<T>(() => readDraft<T>(storageKey) ?? initial);

  const update = useCallback(
    (next: T) => {
      setDraft(next);
      writeDraft(storageKey, next);
    },
    [storageKey],
  );

  const clear = useCallback(() => {
    setDraft(initial);
    clearDraft(storageKey);
  }, [storageKey, initial]);

  return { draft, update, clear };
}
