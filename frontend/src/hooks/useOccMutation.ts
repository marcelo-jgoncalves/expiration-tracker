/**
 * OCC as its own explicit state (mission §16/§31) - a 409 CONFLICT must never be presented
 * the same way as a generic failure ("resource changed" is actionable and recoverable in a
 * specific way: reload the current state and let the user decide, never a blind retry with
 * the same stale expectedVersion).
 */
import { useMutation, type UseMutationOptions, type UseMutationResult } from "@tanstack/react-query";
import { isConflict } from "../api/errors.js";

export type OccMutationResult<TData, TVariables> = UseMutationResult<TData, unknown, TVariables> & {
  /** True exactly when the most recent failure was a version conflict - distinct from
   * `result.isError`, which is also true for every other failure category. */
  isConflict: boolean;
};

export function useOccMutation<TData, TVariables>(options: UseMutationOptions<TData, unknown, TVariables>): OccMutationResult<TData, TVariables> {
  const mutation = useMutation<TData, unknown, TVariables>(options);
  return { ...mutation, isConflict: mutation.isError && isConflict(mutation.error) };
}
