/**
 * Structural loading/error/empty primitives (mission §42-44) - functional and neutral, NOT a
 * visual design system (mission §80-82: "FOUNDATION / PROVISIONAL", "aparência neutra e
 * funcional, não gastar esforço em polish"). Semantic HTML + landmark roles from the start
 * (mission §49-50: accessibility primitives must be born correct, never added later).
 */
import type { ReactNode } from "react";

export function InitialLoading({ label = "Carregando…" }: { label?: string }) {
  return (
    <div role="status" aria-live="polite">
      {label}
    </div>
  );
}

/** For a background refresh of already-visible data (mission §42: "background refresh"
 * distinct from "initial loading") - visually and semantically lighter, never replacing the
 * existing content while it refreshes. */
export function BackgroundRefreshIndicator({ label = "Atualizando…" }: { label?: string }) {
  return (
    <span role="status" aria-live="polite">
      {label}
    </span>
  );
}

export interface ErrorStateProps {
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
}

export function ErrorState({ message, onRetry, retryLabel = "Tentar novamente" }: ErrorStateProps) {
  return (
    <div role="alert">
      <p>{message}</p>
      {onRetry ? (
        <button type="button" onClick={onRetry}>
          {retryLabel}
        </button>
      ) : null}
    </div>
  );
}

/**
 * The 5 empty-state semantics the mission requires (§43), kept structurally distinct so a
 * caller never collapses "genuinely nothing yet" into the same copy as "your filter matched
 * nothing" - the same distinction the approved interface planning docs established
 * (EMPTY_TRUE vs. EMPTY_FILTERED) carried into real component code.
 */
export type EmptyStateKind = "true-empty" | "filtered-empty" | "not-ready" | "unavailable" | "permission-limited";

const EMPTY_STATE_DEFAULT_MESSAGE: Record<EmptyStateKind, string> = {
  "true-empty": "Nada cadastrado ainda.",
  "filtered-empty": "Nenhum resultado para este filtro.",
  "not-ready": "Ainda não há nada aqui.",
  unavailable: "Não é possível carregar isto agora.",
  "permission-limited": "Você não tem acesso a este conteúdo.",
};

export interface EmptyStateProps {
  kind: EmptyStateKind;
  message?: string;
  action?: ReactNode;
}

export function EmptyState({ kind, message, action }: EmptyStateProps) {
  return (
    <div>
      <p>{message ?? EMPTY_STATE_DEFAULT_MESSAGE[kind]}</p>
      {action}
    </div>
  );
}

/**
 * Async processing/mutation state (mission §44's PENDING/PROCESSING/COMPLETED/FAILED/UNKNOWN)
 * as a single presentational component, mirroring the prototype's `feedback()` convention
 * (prototype/app.js) rather than inventing a new visual language for the same concept.
 */
export type AsyncActionState = "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED" | "UNKNOWN";

export function AsyncFeedback({ state, message }: { state: AsyncActionState; message: string }) {
  const role = state === "FAILED" || state === "UNKNOWN" ? "alert" : "status";
  return (
    <div role={role} aria-live="polite">
      {message}
    </div>
  );
}
