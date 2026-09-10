/**
 * SLF-05 remediation (D-2xx, Block 0 - docs/architecture/reviews/screen-spec-audit-2026-09-09/
 * system-level-findings.md). The guest surface (G01/G02, `p0-screen-inventory-plan.md` §2.5) is
 * validated only by an opaque token/credential in the URL, never by a `Role` - several distinct
 * INTERNAL failure causes (an invalid, expired, revoked, or not-found token; an already-used
 * single-use link; for G02 also an unstarted/expired guest session or a bad CSRF token) MUST
 * always collapse into exactly ONE generic EXTERNAL message. This is a deliberate
 * anti-enumeration security property, not a missing feature - the audit found neither guest
 * screen actually specified this collapse (G01 distinguished "reused" from other failures; G02
 * had no failure copy at all), and flagged it as a shared component both screens should use
 * rather than two independently-worded, independently-driftable copies of the same security
 * requirement.
 *
 * Deliberately NOT built on top of `EmptyState` (`AsyncStates.tsx`): that component's `title`
 * varies per `kind` and its `message` is caller-suppliable, both correct for a component whose
 * whole job is flexibility - exactly the wrong shape here. This component hardcodes the title
 * and body; the ONLY thing a caller may vary is `requestedItem` ("documento" for G01, "evidência"
 * for G02 - the spec's own one sanctioned wording difference, about WHAT was requested, never
 * about WHICH internal cause applied). No other prop exists, on purpose: a future caller cannot
 * accidentally reintroduce a distinguishing message/icon/tone by passing one in.
 *
 * No action button (`p0-screen-inventory-plan.md` / both screens' specs: "sem botão de ação -
 * não há 'tentar novamente', o problema é o próprio link") - a retry affordance here would imply
 * the guest can do something about it, which they cannot.
 */
export interface GuestLinkUnavailableProps {
  /** What the guest was being asked for - the one sanctioned per-screen wording difference. */
  requestedItem: "documento" | "evidência";
}

export function GuestLinkUnavailable({ requestedItem }: GuestLinkUnavailableProps) {
  return (
    <div className="ui-async-block" data-guest-state="unavailable">
      {/* Decorative, neutral - never an error/warning glyph, which would itself suggest "something
          went wrong with YOUR action" rather than "this link, whatever its history, cannot be used". */}
      <svg
        aria-hidden="true"
        focusable="false"
        width="40"
        height="40"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        className="ui-async-block__icon"
      >
        <circle cx="12" cy="12" r="9" />
        <path d="M9.5 9.5a2.5 2.5 0 0 1 4.6-1.4M12 12v3.5" strokeLinecap="round" />
        <circle cx="12" cy="17.25" r="0.1" fill="currentColor" stroke="none" />
      </svg>
      <p className="ui-async-block__title">Este link não está disponível</p>
      <p className="ui-async-block__message">
        O link pode ter expirado, sido revogado, já utilizado, ou não existir mais. Solicite um novo link a quem pediu {requestedItem === "documento" ? "o documento" : "a evidência"}.
      </p>
    </div>
  );
}
