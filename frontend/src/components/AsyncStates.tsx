/**
 * Loading / empty / error primitives.
 *
 * Originally structural-only ("FOUNDATION / PROVISIONAL"); as of the Visual Language +
 * Design System Foundation these carry the real visual treatment while keeping every
 * accessibility property they were born with (role/aria-live semantics, the five distinct
 * empty-state kinds, the FAILED-vs-UNKNOWN role split). The public API is unchanged on
 * purpose — this milestone restyles, it does not redesign behaviour (mission §109/VL-G14).
 *
 * Four distinct loading patterns (mission §43), never one global spinner:
 *   InitialLoading            — first paint, structure unknown
 *   CollectionSkeleton        — first paint, structure KNOWN (a table of rows)
 *   BackgroundRefreshIndicator— data already on screen, quietly refreshing
 *   Button `pending`          — a mutation in flight (see ui/Button.tsx)
 */
import type { ReactNode } from "react";
import { Button } from "./ui/Button.js";
import "./AsyncStates.css";

export function InitialLoading({ label = "Carregando…" }: { label?: string }) {
  return (
    <div className="ui-inline-loading" role="status" aria-live="polite">
      {label}
    </div>
  );
}

/**
 * Skeleton for a collection whose row structure is known in advance (mission §44: skeletons
 * only where they represent real structure). Reserving the rows' height also keeps the page
 * from jumping when the data lands (checklist item 36).
 *
 * `aria-hidden` on the bars plus a single polite live region: a screen reader user gets one
 * "Carregando…" announcement, not eight decorative placeholders.
 */
export function CollectionSkeleton({ rows = 6, label = "Carregando…" }: { rows?: number; label?: string }) {
  return (
    <div className="ui-skeleton">
      <span className="u-visually-hidden" role="status" aria-live="polite">
        {label}
      </span>
      <div aria-hidden="true">
        {Array.from({ length: rows }, (_, index) => (
          <div className="ui-skeleton__row" key={index}>
            <span className="ui-skeleton__bar ui-skeleton__bar--wide" />
            <span className="ui-skeleton__bar ui-skeleton__bar--medium" />
            <span className="ui-skeleton__bar ui-skeleton__bar--narrow" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** For a background refresh of already-visible data (mission §43: "background refresh"
 * distinct from "initial loading") - visually and semantically lighter, never replacing the
 * existing content while it refreshes. */
export function BackgroundRefreshIndicator({ label = "Atualizando…" }: { label?: string }) {
  return (
    <span className="ui-refresh-indicator" role="status" aria-live="polite">
      <span className="ui-refresh-indicator__dot" aria-hidden="true" />
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
    <div className="ui-async-block ui-async-block--error" role="alert">
      <p className="ui-async-block__title">Não foi possível concluir esta ação</p>
      <p className="ui-async-block__message">{message}</p>
      {onRetry ? (
        <div className="ui-async-block__actions">
          <Button variant="secondary" onClick={onRetry}>
            {retryLabel}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The 5 empty-state semantics the mission requires (§43), kept structurally distinct so a
 * caller never collapses "genuinely nothing yet" into the same copy as "your filter matched
 * nothing" - the same distinction the approved interface planning docs established
 * (EMPTY_TRUE vs. EMPTY_FILTERED) carried into real component code.
 *
 * The visual treatment reinforces the distinction rather than flattening it: only
 * `true-empty` gets an inviting title, because only `true-empty` is an invitation to create
 * something. `unavailable` and `permission-limited` deliberately do NOT claim "there is
 * nothing here" — the system cannot observe that (mission §45).
 */
export type EmptyStateKind = "true-empty" | "filtered-empty" | "not-ready" | "unavailable" | "permission-limited";

const EMPTY_STATE_DEFAULT_MESSAGE: Record<EmptyStateKind, string> = {
  "true-empty": "Nada cadastrado ainda.",
  "filtered-empty": "Nenhum resultado para este filtro.",
  "not-ready": "Ainda não há nada aqui.",
  unavailable: "Não é possível carregar isto agora.",
  "permission-limited": "Você não tem acesso a este conteúdo.",
};

const EMPTY_STATE_TITLE: Partial<Record<EmptyStateKind, string>> = {
  "true-empty": "Comece por aqui",
  "filtered-empty": "Nenhum resultado",
  unavailable: "Conteúdo indisponível",
  "permission-limited": "Acesso restrito",
};

export interface EmptyStateProps {
  kind: EmptyStateKind;
  message?: string;
  action?: ReactNode;
}

export function EmptyState({ kind, message, action }: EmptyStateProps) {
  const title = EMPTY_STATE_TITLE[kind];
  return (
    <div className="ui-async-block" data-empty-kind={kind}>
      {title ? <p className="ui-async-block__title">{title}</p> : null}
      <p className="ui-async-block__message">{message ?? EMPTY_STATE_DEFAULT_MESSAGE[kind]}</p>
      {action ? <div className="ui-async-block__actions">{action}</div> : null}
    </div>
  );
}

/**
 * Async processing/mutation state (mission §44's PENDING/PROCESSING/COMPLETED/FAILED/UNKNOWN)
 * as a single presentational component, mirroring the prototype's `feedback()` convention
 * (prototype/app.js) rather than inventing a new visual language for the same concept.
 *
 * UNKNOWN is rendered `warning`, never `critical` — it is not a failure, it is an
 * unconfirmed outcome (mission §47).
 */
export type AsyncActionState = "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED" | "UNKNOWN";

const ASYNC_TONE: Record<AsyncActionState, "neutral" | "info" | "success" | "warning" | "critical"> = {
  PENDING: "neutral",
  PROCESSING: "info",
  COMPLETED: "success",
  FAILED: "critical",
  UNKNOWN: "warning",
};

export function AsyncFeedback({ state, message }: { state: AsyncActionState; message: string }) {
  const role = state === "FAILED" || state === "UNKNOWN" ? "alert" : "status";
  return (
    <div className={`ui-notice ui-notice--${ASYNC_TONE[state]}`} role={role} aria-live="polite">
      <div className="ui-notice__body">{message}</div>
    </div>
  );
}
