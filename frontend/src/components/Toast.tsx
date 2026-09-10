/**
 * Toast (design-system.md §46) — first real usage in this codebase, added for A14 (Block 6,
 * D-2xx): "Solicitação criada"/"Solicitação gerada" confirmations that close a dialog and stay
 * on the same screen (never a navigation, so the existing `navigate(path, { state })` post-
 * success-banner convention CreateItem/RenewItem use doesn't apply here — see
 * `routing/useOrgPath.ts`'s own header comment for why that convention exists).
 *
 * Deliberately transient/best-effort feedback only (§46: "Não usar toast como única
 * representação de erro que exige ação") — every call site that needs this MUST already show a
 * durable `InlineNotice`/error state for anything the user must act on; toast is additive
 * confirmation, never load-bearing. One toast at a time (a queue would be over-engineering for
 * the single-confirmation-per-action shape every current call site has).
 */
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import "./Toast.css";

const TOAST_DURATION_MS = 4000;

interface ToastContextValue {
  showToast: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | undefined>();
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>();

  const showToast = useCallback((next: string) => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setMessage(next);
    timeoutRef.current = setTimeout(() => setMessage(undefined), TOAST_DURATION_MS);
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {/* Always mounted (never conditionally), so the live region is registered with assistive
          tech before the first announcement - a region that appears at the same moment as its
          own content is not reliably announced by every screen reader. `position: fixed` is
          applied only via the `--active` modifier, WHILE a toast is actually showing (Toast.css)
          - an every-route-always-fixed region, even empty/invisible, would fail every existing
          block's "no sticky/fixed element" SC 2.4.11 probe (e2e/block3-5's own a11y suites) for a
          reason that never actually obscures anything (nothing to obscure while empty). */}
      <div className={message ? "ui-toast-region ui-toast-region--active" : "ui-toast-region"} role="status" aria-live="polite">
        {message ? <div className="ui-toast">{message}</div> : null}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast() must be used within a ToastProvider.");
  return ctx;
}
