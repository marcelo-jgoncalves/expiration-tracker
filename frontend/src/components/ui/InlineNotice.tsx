/**
 * InlineNotice (mission §41) — persistent page/section feedback.
 *
 * The tone set is intentionally five, and `unknown` is NOT one of them: an unconfirmed
 * outcome is rendered as `warning`, never `critical` (mission §47 / checklist item 12 —
 * `UNKNOWN_OUTCOME` must not look like `FAILED`). The marker glyph reinforces the tone
 * without color, and is `aria-hidden` because the notice's own role + copy already carry the
 * meaning (mission §49).
 */
import type { ReactNode } from "react";
import "./InlineNotice.css";

export type NoticeTone = "neutral" | "info" | "success" | "warning" | "critical";

const MARKER: Record<NoticeTone, string> = {
  neutral: "•",
  info: "i",
  success: "✓",
  warning: "!",
  critical: "×",
};

export interface InlineNoticeProps {
  tone: NoticeTone;
  title?: string;
  children?: ReactNode;
  actions?: ReactNode;
  /**
   * ARIA live semantics. `alert` interrupts and is reserved for something that has just gone
   * wrong and blocks the user; `status` is polite; `none` renders no live region at all — the
   * right choice for a notice that is present on first paint (announcing it would be noise,
   * the user is about to read the page anyway).
   */
  announce?: "alert" | "status" | "none";
}

export function InlineNotice({ tone, title, children, actions, announce = "none" }: InlineNoticeProps) {
  const role = announce === "none" ? undefined : announce;
  return (
    <div className={`ui-notice ui-notice--${tone}`} role={role} aria-live={announce === "status" ? "polite" : undefined}>
      <span className="ui-notice__marker" aria-hidden="true">
        {MARKER[tone]}
      </span>
      <div className="ui-notice__body">
        {title ? <p className="ui-notice__title">{title}</p> : null}
        {children}
        {actions ? <div className="ui-notice__actions">{actions}</div> : null}
      </div>
    </div>
  );
}
