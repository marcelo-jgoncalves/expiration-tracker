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
 */
import { useState, type FormEvent } from "react";
import { useActiveOrganization } from "../auth/ActiveOrganizationContext.js";
import { useCreateOrganization } from "../hooks/useCreateOrganization.js";
import { InlineNotice } from "../components/ui/InlineNotice.js";
import { PageHeader, Panel } from "../components/ui/Layout.js";
import { Button } from "../components/ui/Button.js";
import { TextField } from "../components/forms/TextField.js";

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
        <PageHeader title="Escolha uma organização" description="Sua conta pertence a mais de uma organização - selecione qual usar agora." />
        <Panel>
          <ul className="ui-onboarding-org-list">
            {usableOrganizations.map((org) => (
              <li key={org.organizationId}>
                <Button variant="secondary" disabled={switching} onClick={() => select(org.organizationId)}>
                  {org.displayName}
                </Button>
              </li>
            ))}
          </ul>
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
