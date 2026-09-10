/**
 * Organization onboarding (roadmap-evolution/17 §36's "Organization onboarding" - part of the
 * originally-scoped minimal UI, never built by Wave B2B-10, found missing only by Wave B2B-14's
 * real operational evidence pass: a freshly-bootstrapped identity with zero Memberships had no
 * screen to get out of that state, and every org-scoped query's `enabled: Boolean(organizationId)`
 * left every other route stuck on its loading skeleton forever).
 *
 * Rendered by `OnboardingGate` (App.tsx) INSTEAD of `AppShell` whenever the session has no
 * active organization yet - never inside the shell (no sidebar/nav makes sense before an
 * Organization exists to scope them to). Two cases, both reachable from
 * `organizationSelectionRequired` (GET /bff/session, Wave B2B-6/D-102):
 *   - zero usable Organizations -> create the first one (POST /bff/organizations, B2B-5/D-096)
 *   - 1+ usable Organizations but none currently selected -> pick one (POST
 *     /bff/organization/select, reuses the exact same `select()` the switcher already uses)
 *
 * A02 spec reconciliation (D-255/D-256): `docs/frontend/prototype-screen-specs/A02-onboarding.md`
 * (V7 tese visual) calls for a per-org operational note ("N vencimentos em atenção"), a
 * `StatusBadge` for suspended Memberships, and a session-level pending-invitation banner. None
 * of those 3 exist in `organizationSelectionRequired.organizations` (`UsableOrganization`:
 * `organizationId`/`displayName`/`role`/`version` only) or anywhere else the BFF returns today -
 * investigated directly against `resolveActiveMembership`/`listUsableOrganizations`
 * (organization/application/resolve-active-membership.ts) and the Invitation store. This is NOT
 * a D-248-style "already modeled, just not wired" gap:
 *   - suspended visibility needs a SEPARATE read path from `resolveActiveMembership`, which is
 *     shared with `RequestContextResolver`'s authorization-critical "exactly one ACTIVE
 *     Membership" assertion - not safe to loosen for a display concern;
 *   - the attention count needs a new cross-module aggregate (GSI1 scan per organization) with
 *     an undefined "attention" threshold - a genuine product/design decision, not a DTO field;
 *   - the pending-invitation banner needs querying Invitation by invitee email across tenants -
 *     no such index exists.
 * All three are real new backend capabilities, recorded as pending (decisions-log D-256), not
 * silently dropped. This screen therefore renders ONLY data the BFF actually returns today - a
 * card grid (name + role, per spec structure #4 minus the two unavailable fields) rather than a
 * fabricated badge/note, which would violate this codebase's epistemic-integrity rule
 * (`StatusBadge.tsx` header comment) the same way a fake `StatusBadge` tone would.
 */
import { useState, type FormEvent } from "react";
import { useActiveOrganization } from "../auth/ActiveOrganizationContext.js";
import { useCreateOrganization } from "../hooks/useCreateOrganization.js";
import { InlineNotice } from "../components/ui/InlineNotice.js";
import { PageHeader, Panel } from "../components/ui/Layout.js";
import { Button } from "../components/ui/Button.js";
import { TextField } from "../components/forms/TextField.js";
import type { UsableOrganization } from "../api/session.js";
import "./Onboarding.css";

// Same English role labels as Members.tsx's ROLE_OPTIONS - one label vocabulary for role names
// across the app, never re-translated per screen.
const ROLE_LABEL: Record<UsableOrganization["role"], string> = {
  OWNER: "Owner",
  ADMIN: "Admin",
  MEMBER: "Member",
  VIEWER: "Viewer",
};

function detectedTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "America/Sao_Paulo";
  }
}

export function Onboarding() {
  const { organizationSelectionRequired, switching, select } = useActiveOrganization();
  const create = useCreateOrganization();
  const [displayName, setDisplayName] = useState("");
  const [timezone, setTimezone] = useState(detectedTimezone());

  const usableOrganizations = organizationSelectionRequired?.organizations ?? [];

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    create.mutate({ displayName, timezone });
  }

  if (usableOrganizations.length > 0) {
    return (
      <>
        <PageHeader title="Suas organizações" description="Escolha uma organização para continuar, ou crie uma nova." />
        <ul className="ui-onboarding-org-grid">
          {usableOrganizations.map((org) => (
            <li key={org.organizationId}>
              <button
                type="button"
                className="ui-onboarding-org-card"
                // Codex block-review finding (D-256): selecting a card and submitting the create
                // form are two independent mutations of the same org-selection context - gating
                // each control ONLY on its own pending state let a user start both nearly
                // simultaneously. Cross-gating on `create.isPending` too closes that race.
                disabled={switching || create.isPending}
                onClick={() => select(org.organizationId)}
              >
                <span className="ui-onboarding-org-card__name" title={org.displayName}>
                  {org.displayName}
                </span>
                <span className="ui-onboarding-org-card__role">{ROLE_LABEL[org.role]}</span>
              </button>
            </li>
          ))}
        </ul>
        <Panel>
          <p className="ui-onboarding-org-grid__footer-note">
            Criar uma organização nova cria também sua primeira Membership como Owner.
          </p>
          <form onSubmit={handleSubmit}>
            <TextField label="Nome da organização" value={displayName} onChange={setDisplayName} required />
            <TextField label="Fuso horário" value={timezone} onChange={setTimezone} required />
            <Button type="submit" variant="secondary" pending={create.isPending} disabled={switching}>
              {create.isPending ? "Criando…" : "Criar organização"}
            </Button>
            {create.isError ? (
              <InlineNotice tone="critical" announce="alert">
                Não foi possível criar a organização. Tente novamente.
              </InlineNotice>
            ) : null}
          </form>
        </Panel>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Crie sua organização" description="Antes de continuar, crie a organização que vai usar para controlar seus vencimentos." />
      <Panel>
        <form onSubmit={handleSubmit}>
          <TextField label="Nome da organização" value={displayName} onChange={setDisplayName} required />
          <TextField label="Fuso horário" value={timezone} onChange={setTimezone} required />
          <Button type="submit" variant="primary" pending={create.isPending}>
            {create.isPending ? "Criando…" : "Criar organização"}
          </Button>
          {create.isError ? (
            <InlineNotice tone="critical" announce="alert">
              Não foi possível criar a organização. Tente novamente.
            </InlineNotice>
          ) : null}
        </form>
      </Panel>
    </>
  );
}
