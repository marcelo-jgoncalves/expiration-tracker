/**
 * Idempotency-key lifecycle (mission §33-35): one logical user submission = one key. A retry
 * of the SAME submission (the mutation function throwing, user clicks "try again" without
 * changing anything) reuses the SAME key - only calling `newIntent()` (after a genuine
 * success, or when the user deliberately starts a new/different submission) generates a
 * fresh one. Never regenerate on every call, which would silently defeat the backend's
 * idempotency protection (src/modules/expiration/application/expiration-service.ts's
 * createItem) - mission §36 is explicit: "Não usar random key em cada retry".
 */
import { useMutation, type UseMutationOptions, type UseMutationResult } from "@tanstack/react-query";
import { useRef } from "react";

export interface IdempotentMutationOptions<TData, TVariables> extends Omit<UseMutationOptions<TData, unknown, TVariables>, "mutationFn"> {
  mutationFn: (variables: TVariables, idempotencyKey: string) => Promise<TData>;
  /** When provided, the key survives a full-page reload (e.g. the BFF login redirect during a
   * session interruption mid-submission, mission §49) by persisting it to sessionStorage under
   * this key - never localStorage, this key is submission-scoped, not meant to outlive the tab.
   * Read/write failures (private browsing, disabled storage) degrade to a purely in-memory key
   * rather than throwing - the same "unavailable browser API degrades gracefully" convention as
   * api/client.ts's readCookie. Omitting this option preserves the exact prior in-memory-only
   * behavior. */
  persistenceKey?: string;
}

export type IdempotentMutationResult<TData, TVariables> = UseMutationResult<TData, unknown, TVariables> & {
  /** Call after a successful submission is fully acknowledged (e.g. the user navigates away
   * or explicitly starts filling a new form) - never call this just to "clear" a failed
   * attempt the user might still retry as the SAME intent. */
  newIntent: () => void;
};

function readPersistedKey(storageKey: string): string | undefined {
  try {
    return window.sessionStorage.getItem(storageKey) ?? undefined;
  } catch {
    return undefined;
  }
}

function writePersistedKey(storageKey: string, value: string): void {
  try {
    window.sessionStorage.setItem(storageKey, value);
  } catch {
    // Storage unavailable - the key still works, it just won't survive a reload.
  }
}

export function useIdempotentMutation<TData, TVariables>(options: IdempotentMutationOptions<TData, TVariables>): IdempotentMutationResult<TData, TVariables> {
  const keyRef = useRef<string>();
  if (keyRef.current === undefined) {
    const persisted = options.persistenceKey ? readPersistedKey(options.persistenceKey) : undefined;
    keyRef.current = persisted ?? crypto.randomUUID();
    if (options.persistenceKey && !persisted) {
      writePersistedKey(options.persistenceKey, keyRef.current);
    }
  }

  const mutation = useMutation<TData, unknown, TVariables>({
    ...options,
    mutationFn: (variables: TVariables) => options.mutationFn(variables, keyRef.current as string),
  });

  return {
    ...mutation,
    newIntent: () => {
      const fresh = crypto.randomUUID();
      keyRef.current = fresh;
      if (options.persistenceKey) writePersistedKey(options.persistenceKey, fresh);
    },
  };
}
