/**
 * A08 (Block 3, D-2xx) — create/edit form for a Fornecedor (TrackedSubject). Two routes share
 * this component (`/subjects/new`, `/subjects/:subjectId/edit`) rather than folding creation
 * into the Subject Hub (A09) as that screen's spec literally describes — a deliberate,
 * time-boxed simplification for this block: the Hub (SubjectHub.tsx) stays a pure detail/review
 * surface, and this dedicated form covers both create and edit with one RBAC-checked component,
 * same separation CreateItem/ItemDetail already use for A04/A05. Revisit only if a future audit
 * names the merged-hub-as-create-form pattern as load-bearing for a real journey.
 */
import { useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useOrgPath } from "../../routing/useOrgPath.js";
import { useSubject } from "../../hooks/useSubject.js";
import { useCreateSubject } from "../../hooks/useCreateSubject.js";
import { useUpdateSubject } from "../../hooks/useUpdateSubject.js";
import { useCurrentMembershipRole } from "../../hooks/useCurrentMembershipRole.js";
import { InitialLoading, ErrorState, EmptyState } from "../../components/AsyncStates.js";
import { TextField } from "../../components/forms/TextField.js";
import { SelectField } from "../../components/forms/SelectField.js";
import { FormErrorSummary, type SummaryFieldError } from "../../components/forms/FormErrorSummary.js";
import { PageHeader } from "../../components/ui/Layout.js";
import { Button, ButtonLink } from "../../components/ui/Button.js";
import { ApiError, isConflict } from "../../api/errors.js";
import { presentSubjectType } from "../../api/presentation.js";
import type { TrackedSubjectType } from "../../api/types.js";

const TYPE_OPTIONS: TrackedSubjectType[] = ["COMPANY", "VENDOR", "CLIENT", "EMPLOYEE", "ASSET", "LOCATION", "CUSTOM"];

export function SubjectForm() {
  const { subjectId } = useParams<{ subjectId: string }>();
  const isEdit = Boolean(subjectId);
  const orgPath = useOrgPath();
  const navigate = useNavigate();

  const subjectQuery = useSubject(subjectId ?? "");
  const createMutation = useCreateSubject();
  const updateMutation = useUpdateSubject(subjectId ?? "");
  const role = useCurrentMembershipRole();
  // Screen->action->role conformance: the backend is the real enforcement boundary (subject:
  // create/update are WRITE_ROLES), but this route must not RENDER a functional form to a role
  // that has no path to submit it successfully - hiding the "Editar"/"Novo fornecedor" entry
  // points elsewhere is not sufficient on its own (Codex Block 3 review round 1 finding 10).
  const canWrite = role === undefined || role === "OWNER" || role === "ADMIN" || role === "MEMBER";

  const [displayName, setDisplayName] = useState("");
  const [type, setType] = useState<TrackedSubjectType>("VENDOR");
  const [externalId, setExternalId] = useState("");
  const [notes, setNotes] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [generalErrors, setGeneralErrors] = useState<string[]>([]);
  // Field-level association (mission §40/VL-G10, same pattern as CreateItem.tsx): a required-
  // field failure must be reachable via aria-invalid/aria-describedby on the control itself,
  // not only as an unlinked general error (E2E/accessibility gap closure, D-2xx - the prior
  // version of this form only ever called setGeneralErrors, which TextField never renders as a
  // per-field error, so "Nome" never got aria-invalid when submitted blank).
  const [nameError, setNameError] = useState<string | undefined>();

  if (isEdit && subjectQuery.isPending) {
    return <InitialLoading label="Carregando fornecedor…" />;
  }
  if (isEdit && subjectQuery.isError) {
    const message = subjectQuery.error instanceof ApiError ? subjectQuery.error.message : "Não foi possível carregar este fornecedor.";
    return <ErrorState message={message} onRetry={() => void subjectQuery.refetch()} />;
  }
  if (role !== undefined && !canWrite) {
    return <EmptyState kind="permission-limited" />;
  }
  if (isEdit && subjectQuery.data && !hydrated) {
    setDisplayName(subjectQuery.data.subject.displayName);
    setType(subjectQuery.data.subject.type);
    setExternalId(subjectQuery.data.subject.externalId ?? "");
    setNotes(subjectQuery.data.subject.notes ?? "");
    setHydrated(true);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!displayName.trim()) {
      setNameError("Informe o nome do fornecedor.");
      return;
    }
    setNameError(undefined);
    setGeneralErrors([]);
    try {
      if (isEdit && subjectId && subjectQuery.data) {
        await updateMutation.mutateAsync({
          input: { displayName: displayName.trim(), notes: notes.trim() || undefined },
          expectedVersion: subjectQuery.data.subject.version,
        });
        navigate(orgPath(`/subjects/${subjectId}`));
      } else {
        const result = await createMutation.mutateAsync({
          type,
          displayName: displayName.trim(),
          notes: notes.trim() || undefined,
          externalId: externalId.trim() || undefined,
        });
        createMutation.newIntent();
        navigate(orgPath(`/subjects/${result.subject.subjectId}`));
      }
    } catch (err) {
      // OCC (stale `expectedVersion`) only exists on the EDIT path - `updateMutation.isConflict`
      // already renders that case above. On CREATE, a CONFLICT means the duplicate-externalId
      // business rule (`SubjectExternalIdPointer`), which must reach the user, never be silently
      // swallowed (Codex Block 3 review round 1 finding 4 - a prior version of this catch
      // returned early for every CONFLICT regardless of which path threw it).
      if (isEdit && isConflict(err)) return;
      const message = err instanceof ApiError ? err.message : "Não foi possível salvar este fornecedor.";
      // A08 spec's "identificador duplicado" state: the backend enforces external-id
      // uniqueness via SubjectExternalIdPointer and returns a CONFLICT/VALIDATION error whose
      // message already names the field — surfaced verbatim, never replaced with a generic one.
      setGeneralErrors([message]);
    }
  }

  const pending = createMutation.isPending || updateMutation.isPending;
  const isConflictState = isEdit ? updateMutation.isConflict : false;
  const fieldErrors: SummaryFieldError[] = nameError ? [{ fieldId: "subject-name", label: "Nome", message: nameError }] : [];

  return (
    <div>
      <PageHeader above={<ButtonLink variant="secondary" size="sm" to={orgPath(isEdit && subjectId ? `/subjects/${subjectId}` : "/subjects")}>← Voltar</ButtonLink>} title={isEdit ? "Editar fornecedor" : "Novo fornecedor"} />
      <form onSubmit={(event) => void handleSubmit(event)} noValidate>
        <FormErrorSummary errors={generalErrors} fieldErrors={fieldErrors} />
        {isConflictState ? <p role="alert">Este fornecedor mudou desde que a página carregou — recarregue antes de salvar de novo.</p> : null}
        <TextField id="subject-name" label="Nome" value={displayName} onChange={setDisplayName} error={nameError} required />
        {isEdit ? null : (
          <>
            <SelectField
              id="subject-type"
              label="Tipo"
              value={type}
              onChange={(v) => setType(v as TrackedSubjectType)}
              required
              options={TYPE_OPTIONS.map((t) => ({ value: t, label: presentSubjectType(t) }))}
            />
            <TextField id="subject-external-id" label="CNPJ/identificador externo" value={externalId} onChange={setExternalId} hint="Não pode ser alterado depois de criado." />
          </>
        )}
        <TextField id="subject-notes" label="Observações" value={notes} onChange={setNotes} multiline />
        <Button type="submit" variant="primary" pending={pending}>
          {pending ? "Salvando…" : "Salvar"}
        </Button>
      </form>
    </div>
  );
}
