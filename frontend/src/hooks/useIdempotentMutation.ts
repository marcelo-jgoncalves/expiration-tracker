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
}

export type IdempotentMutationResult<TData, TVariables> = UseMutationResult<TData, unknown, TVariables> & {
  /** Call after a successful submission is fully acknowledged (e.g. the user navigates away
   * or explicitly starts filling a new form) - never call this just to "clear" a failed
   * attempt the user might still retry as the SAME intent. */
  newIntent: () => void;
};

export function useIdempotentMutation<TData, TVariables>(options: IdempotentMutationOptions<TData, TVariables>): IdempotentMutationResult<TData, TVariables> {
  const keyRef = useRef<string>(crypto.randomUUID());

  const mutation = useMutation<TData, unknown, TVariables>({
    ...options,
    mutationFn: (variables: TVariables) => options.mutationFn(variables, keyRef.current),
  });

  return {
    ...mutation,
    newIntent: () => {
      keyRef.current = crypto.randomUUID();
    },
  };
}
