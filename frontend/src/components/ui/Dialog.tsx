/**
 * Dialog (design-system.md §47/§48) — first real usage in this codebase, added for A14 (Block
 * 6, D-2xx): two short creation forms (avulsa/série) and an edit/cancel flow all need it. Every
 * prior screen that needed a confirmation built its own local `role="alertdialog"` div
 * (SubjectHub.tsx's `DeleteConfirmDialog`) — this generalizes that same minimal shape (no
 * portal, inline in the DOM, a backdrop + centered panel) rather than reaching for a heavier
 * library, per implementation-sequencing-plan.md §2's "extend the design system only when a
 * journey demonstrates the need".
 *
 * Per design-system.md §47: short forms/confirmations/small details only — never a long
 * workflow. `A14-solicitacoes-recorrencia.md`'s own keyboard/focus section is the concrete
 * contract this satisfies: Escape closes, a backdrop click closes, and — critically — focus
 * returns to the element that opened the dialog (never the top of the page) on close, whether
 * that close was success or cancellation. The caller owns "was this a success or a cancel" and
 * always calls the SAME `onClose`; this component does not distinguish the two, matching the
 * spec's own "Ao fechar um dialog (sucesso ou cancelamento)..." wording.
 */
import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import "./Dialog.css";

const FOCUSABLE_SELECTOR = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface DialogProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** `dialog` (default) for a form/detail; `alertdialog` for a destructive confirmation
   * (design-system.md §48) — the ARIA role assistive tech uses to decide how interruptive to
   * treat it. */
  variant?: "dialog" | "alertdialog";
}

export function Dialog({ title, onClose, children, variant = "dialog" }: DialogProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  // The element focus returns to on close - captured once, at mount, before this component ever
  // moves focus itself (A14's own keyboard/focus contract: "o foco retorna ao elemento que abriu
  // o dialog").
  const triggerRef = useRef<Element | null>(null);

  useEffect(() => {
    triggerRef.current = document.activeElement;
    const panel = panelRef.current;
    const firstFocusable = panel?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
    // Design-system.md §48 / SubjectHub.tsx's DeleteConfirmDialog precedent: initial focus never
    // lands on a destructive/primary confirm control by accident - the first focusable element
    // in DOM order is always Cancel/the least-destructive control in this codebase's own form
    // layout convention (cancel before confirm).
    firstFocusable?.focus();

    return () => {
      const trigger = triggerRef.current;
      if (trigger instanceof HTMLElement) trigger.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const panel = panelRef.current;
    if (!panel) return;
    const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }

  return (
    // The backdrop itself is not a keyboard-operable control (it has no independent action a
    // keyboard/AT user needs to reach) - it is a pointer-only convenience equivalent to the
    // Escape key, which `handleKeyDown` on the panel below already provides as the real
    // keyboard-accessible way to close. No `role`/tabIndex is added here on purpose - that would
    // falsely announce it as an interactive element with nothing for a keyboard user to do.
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div className="ui-dialog-backdrop" onMouseDown={(event) => (event.target === event.currentTarget ? onClose() : undefined)}>
      <div ref={panelRef} className="ui-dialog" role={variant} aria-modal="true" aria-labelledby={titleId} onKeyDown={handleKeyDown}>
        <h2 id={titleId} className="ui-dialog__title">
          {title}
        </h2>
        <div className="ui-dialog__body">{children}</div>
      </div>
    </div>
  );
}
