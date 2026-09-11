/**
 * A22 — Configuração de entrega de solicitação (Block 7, D-2xx). `tenant:configure-document-
 * request-delivery` is OWNER_ROLES exclusive - per the audited spec, this is stronger than the
 * "hide, never just disable" nav rule alone: a direct visit by a non-OWNER must redirect away,
 * never render an in-page "sem permissão" message (unlike `ActivityLog.tsx`'s softer
 * ADMIN/OWNER-only convention) - the backend independently re-checks via `authorize()` regardless
 * of what this screen does, but the spec is explicit that the route itself must not resolve for
 * a non-OWNER.
 *
 * ONE real, confirmed deviation from the spec (investigated directly against the backend, never
 * silent): `setDocumentRequestDeliveryPreference` (`document-request-service.ts`) accepts no
 * CLIENT-supplied `expectedVersion` - it reads the current row and computes the expected version
 * server-side, in the same call. A genuine `ConflictError` (409) is still possible if that
 * server-side read-then-write races a concurrent save (see `updateDocumentRequestDeliveryPreference`'s
 * own doc comment in `api/subjects.ts`) - narrower window than client-supplied OCC, never an
 * absent one, so the spec's "Conflito de concorrência (OCC)" InlineNotice IS rendered here,
 * driven by `isConflict(error)`.
 */
import { useState } from "react";
import { Navigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useCurrentMembershipRole } from "../../hooks/useCurrentMembershipRole.js";
import { useDocumentRequestDeliveryPreference } from "../../hooks/useDocumentRequestDeliveryPreference.js";
import { useUpdateDocumentRequestDeliveryPreference } from "../../hooks/useUpdateDocumentRequestDeliveryPreference.js";
import { useOrgPath } from "../../routing/useOrgPath.js";
import { useActiveOrganization } from "../../auth/ActiveOrganizationContext.js";
import { queryKeys } from "../../api/queryKeys.js";
import { useToast } from "../../components/Toast.js";
import { InitialLoading } from "../../components/AsyncStates.js";
import { PageHeader, Panel } from "../../components/ui/Layout.js";
import { RadioGroup } from "../../components/ui/RadioGroup.js";
import { InlineNotice } from "../../components/ui/InlineNotice.js";
import { Button } from "../../components/ui/Button.js";
import { isConflict } from "../../api/errors.js";
import type { DocumentRequestDeliveryMode } from "../../api/types.js";

const DELIVERY_OPTIONS = [
  { value: "EMAIL", label: "E-mail automático", hint: "O link é enviado por e-mail no momento da criação da solicitação." },
  { value: "MANUAL", label: "Entrega manual", hint: "O link é gerado, mas quem criou a solicitação o compartilha por fora." },
];

export function RequestDeliverySettings() {
  const role = useCurrentMembershipRole();
  const orgPath = useOrgPath();
  const isOwner = role === "OWNER";

  // `role === undefined` means the session role hasn't resolved yet - never redirect on that
  // (would bounce every OWNER on first paint too), same "don't block on pending" convention as
  // ActivityLog.tsx's own `canViewActivity` gate.
  if (role !== undefined && !isOwner) {
    return <Navigate to={orgPath("/settings")} replace />;
  }

  return (
    <>
      <PageHeader title="Entrega de solicitação" description="Política de toda a organização para o convite inicial do fluxo de rastreamento legado." />
      {role === undefined ? <InitialLoading label="Carregando…" /> : <DeliveryPreferencePanel enabled={isOwner} />}
    </>
  );
}

function DeliveryPreferencePanel({ enabled }: { enabled: boolean }) {
  const query = useDocumentRequestDeliveryPreference(enabled);
  const mutation = useUpdateDocumentRequestDeliveryPreference();
  const { showToast } = useToast();
  const { organizationId } = useActiveOrganization();
  const queryClient = useQueryClient();
  const [selection, setSelection] = useState<DocumentRequestDeliveryMode | null>(null);
  const [conflict, setConflict] = useState(false);

  if (query.isPending) {
    return (
      <Panel>
        <InitialLoading label="Carregando configuração atual…" />
      </Panel>
    );
  }

  if (query.isError) {
    return (
      <Panel>
        <InlineNotice tone="critical" announce="alert" actions={<Button size="sm" variant="secondary" onClick={() => void query.refetch()}>Tentar novamente</Button>}>
          Não foi possível carregar a configuração atual.
        </InlineNotice>
      </Panel>
    );
  }

  const current = selection ?? query.data.initialInviteDeliveryDefault;

  async function handleSave() {
    setConflict(false);
    try {
      await mutation.mutateAsync(current);
      showToast("Padrão de entrega atualizado.");
    } catch (err) {
      if (isConflict(err)) {
        setConflict(true);
        // Reload the current server value so it's visible for comparison, per spec - never
        // overwrite the user's own in-progress selection silently.
        if (organizationId) void queryClient.invalidateQueries({ queryKey: queryKeys.subjects.documentRequestDeliveryPreference(organizationId) });
        return;
      }
      // Any other failure surfaces via mutation.isError below - selection is preserved (spec:
      // "não reverte para o valor anterior automaticamente").
    }
  }

  return (
    <Panel>
      <RadioGroup legend="Modo de entrega padrão" options={DELIVERY_OPTIONS} value={current} onChange={(value) => setSelection(value as DocumentRequestDeliveryMode)} required />
      <InlineNotice tone="neutral">Alterar este padrão afeta apenas novos convites — nunca revoga um link já emitido.</InlineNotice>
      {conflict ? (
        <InlineNotice tone="warning" announce="alert">
          Este padrão foi alterado por outra pessoa enquanto você editava. Revise o valor atual ({query.data.initialInviteDeliveryDefault === "EMAIL" ? "E-mail automático" : "Entrega manual"}) antes de salvar novamente.
        </InlineNotice>
      ) : mutation.isError ? (
        <InlineNotice tone="critical" announce="alert">
          Não foi possível salvar. Tente novamente.
        </InlineNotice>
      ) : null}
      <Button variant="primary" pending={mutation.isPending} onClick={() => void handleSave()}>
        {mutation.isPending ? "Salvando…" : "Salvar padrão"}
      </Button>
    </Panel>
  );
}
