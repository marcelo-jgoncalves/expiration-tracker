/**
 * A20 — Editor de campos de metadados de um tipo de documento (Block 4, D-2xx). Field-editor
 * half of the two-route spec (see `DocumentTypesCollection.tsx`'s header comment for the
 * catalog half and the shared named gaps).
 *
 * `docarchive:documenttype-read` (READ_ONLY_ROLES) opens this screen for every role; only
 * ADMIN_ROLES (`docarchive:documenttype-metadata-manage`) can add a field or mutate one
 * (rename/required/archive/reactivate/options) — MEMBER/VIEWER get an explicit read-only
 * `InlineNotice`, never a silently-disabled form. `FieldCard`'s "Editar campo" (rename/
 * required) and per-option add/archive/reactivate (Codex block-review finding: these were
 * promised by this very comment in an earlier revision but not actually implemented — only
 * archive/reactivate of the whole field existed) are real now, both funneled through the same
 * single `useUpdateMetadataField` PATCH per D-218 Decision 7.
 *
 * Named gap (investigated directly against the domain/service layer, not assumed): the spec's
 * "▲"/"▼" field-reorder affordance has NO backend capability at all —
 * `UpdateDocumentTypeMetadataFieldInput` has no position/order field, and
 * `DocumentTypeMetadataFieldDefinition` itself carries no `position` (unlike
 * `RequirementTemplateItem`, which does). Fields are rendered in the array order the backend
 * returns (real insertion order) with no reorder control, same graceful-degradation precedent
 * as A11's CSV-export omission — never a fabricated reorder UI wired to nothing.
 */
import { useState, type FormEvent } from "react";
import { useParams } from "react-router-dom";
import { useDocumentType } from "../../hooks/useDocumentType.js";
import { useCreateMetadataField } from "../../hooks/useCreateMetadataField.js";
import { useUpdateMetadataField } from "../../hooks/useUpdateMetadataField.js";
import { useCurrentMembershipRole } from "../../hooks/useCurrentMembershipRole.js";
import { InitialLoading, ErrorState } from "../../components/AsyncStates.js";
import { InlineNotice } from "../../components/ui/InlineNotice.js";
import { StatusBadge } from "../../components/ui/StatusBadge.js";
import { PageHeader, Section } from "../../components/ui/Layout.js";
import { Button } from "../../components/ui/Button.js";
import { TextField } from "../../components/forms/TextField.js";
import { SelectField } from "../../components/forms/SelectField.js";
import { Checkbox } from "../../components/ui/Checkbox.js";
import { FormErrorSummary } from "../../components/forms/FormErrorSummary.js";
import { ApiError, isConflict } from "../../api/errors.js";
import { presentDocumentTypeStatus } from "../../api/presentation.js";
import type { DocumentTypeFieldOption, DocumentTypeFieldValueType, DocumentTypeMetadataFieldDefinition } from "../../api/types.js";

const VALUE_TYPE_OPTIONS: { value: DocumentTypeFieldValueType; label: string }[] = [
  { value: "TEXT", label: "Texto" },
  { value: "NUMBER", label: "Número" },
  { value: "DECIMAL", label: "Decimal" },
  { value: "DATE", label: "Data" },
  { value: "BOOLEAN", label: "Sim/Não" },
  { value: "SINGLE_SELECT", label: "Opção única" },
];

export function DocumentTypeEditor() {
  const { documentTypeId = "" } = useParams<{ documentTypeId: string }>();
  const role = useCurrentMembershipRole();
  const isAdmin = role === "OWNER" || role === "ADMIN";
  const [showAddField, setShowAddField] = useState(false);

  const query = useDocumentType(documentTypeId);

  if (query.isPending) {
    return <InitialLoading label="Carregando tipo de documento…" />;
  }
  if (query.isError) {
    const message = query.error instanceof ApiError ? query.error.message : "Não foi possível carregar este tipo de documento.";
    return <ErrorState message={message} onRetry={() => void query.refetch()} />;
  }

  const documentType = query.data.documentType;
  const fields = documentType.metadataFields ?? [];

  return (
    <div>
      <PageHeader title={documentType.displayName} description={<StatusBadge presentation={presentDocumentTypeStatus(documentType.status)} />} />
      {!isAdmin ? <InlineNotice tone="neutral">Modo leitura — apenas administradores editam este catálogo.</InlineNotice> : null}
      {documentType.status === "DEPRECATED" ? (
        <InlineNotice tone="neutral">Tipo descontinuado — pode ainda estar referenciado por documentos existentes, que continuam acessíveis normalmente.</InlineNotice>
      ) : null}
      <Section heading="Campos de metadados" headingId="metadata-fields-heading" annotation={`(${fields.length})`}>
        {fields.length === 0 ? (
          <p>Nenhum campo definido ainda.</p>
        ) : (
          <ul className="doctype-field-list">
            {fields.map((field) => (
              <FieldCard key={field.fieldId} documentTypeId={documentTypeId} field={field} documentTypeVersion={documentType.version} isAdmin={isAdmin} />
            ))}
          </ul>
        )}
        <p>
          Marcar um campo como obrigatório nunca invalida retroativamente Documentos já existentes que não o preenchem — a obrigatoriedade vale apenas para novos uploads a
          partir de agora.
        </p>
        {isAdmin ? (
          showAddField ? (
            <AddFieldForm documentTypeId={documentTypeId} documentTypeVersion={documentType.version} onClose={() => setShowAddField(false)} />
          ) : (
            <Button variant="primary" onClick={() => setShowAddField(true)}>
              Adicionar campo
            </Button>
          )
        ) : null}
      </Section>
    </div>
  );
}

function FieldCard({
  documentTypeId,
  field,
  documentTypeVersion,
  isAdmin,
}: {
  documentTypeId: string;
  field: DocumentTypeMetadataFieldDefinition;
  documentTypeVersion: number;
  isAdmin: boolean;
}) {
  const mutation = useUpdateMetadataField(documentTypeId);
  const [error, setError] = useState<string | undefined>();
  const [showConflict, setShowConflict] = useState(false);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(field.name);
  const [required, setRequired] = useState(field.required);
  const [newOptionLabel, setNewOptionLabel] = useState("");
  const isArchived = field.status === "ARCHIVED";

  // `isConflict(err)` from the caught error, never `mutation.isConflict` read synchronously
  // right after `mutateAsync` rejects (Codex block-review finding: that read is a stale-closure
  // bug — this handler's closure still holds the mutation object from the render BEFORE the
  // rejection, so it can lag or be wrong).
  async function runUpdate(input: Parameters<typeof mutation.mutateAsync>[0]["input"], onOk?: () => void) {
    setError(undefined);
    setShowConflict(false);
    try {
      await mutation.mutateAsync({ fieldId: field.fieldId, input, expectedDocumentTypeVersion: documentTypeVersion });
      onOk?.();
    } catch (err) {
      if (isConflict(err)) {
        setShowConflict(true);
        return;
      }
      setError(err instanceof ApiError ? err.message : "Não foi possível atualizar este campo.");
    }
  }

  function toggleArchive() {
    void runUpdate({ status: isArchived ? "ACTIVE" : "ARCHIVED" });
  }

  function saveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) {
      setError("Informe o nome do campo.");
      return;
    }
    void runUpdate({ name: name.trim(), required }, () => setEditing(false));
  }

  function addOption(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!newOptionLabel.trim()) return;
    void runUpdate({ optionsPatch: [{ op: "ADD", label: newOptionLabel.trim() }] }, () => setNewOptionLabel(""));
  }

  function toggleOption(option: DocumentTypeFieldOption) {
    const op = option.status === "ARCHIVED" ? "REACTIVATE" : "ARCHIVE";
    void runUpdate({ optionsPatch: [{ op, optionId: option.optionId }] });
  }

  if (editing) {
    return (
      <li className="doctype-field-card">
        <form onSubmit={saveEdit} noValidate>
          <FormErrorSummary errors={error ? [error] : []} />
          {showConflict ? <p role="alert">Este tipo foi alterado por outra pessoa — recarregue antes de salvar de novo.</p> : null}
          <TextField id={`field-edit-name-${field.fieldId}`} label="Nome do campo" value={name} onChange={setName} required />
          <Checkbox label="Obrigatório" checked={required} onChange={setRequired} />
          <Button type="submit" variant="primary" pending={mutation.isPending}>
            {mutation.isPending ? "Salvando…" : "Salvar"}
          </Button>{" "}
          <Button type="button" variant="secondary" onClick={() => setEditing(false)}>
            Cancelar
          </Button>
        </form>
      </li>
    );
  }

  return (
    <li className={isArchived ? "doctype-field-card doctype-field-card--archived" : "doctype-field-card"}>
      <strong>{field.name}</strong> — {VALUE_TYPE_OPTIONS.find((o) => o.value === field.valueType)?.label ?? field.valueType}
      {field.required ? " · Obrigatório" : null}
      {isArchived ? (
        <>
          {" "}
          <StatusBadge presentation={{ label: "Arquivado", tone: "neutral" }} />
        </>
      ) : null}
      {field.valueType === "SINGLE_SELECT" && field.options && field.options.length > 0 ? (
        <ul className="doctype-field-options">
          {field.options.map((option) => (
            <li key={option.optionId}>
              {option.label}
              {option.status === "ARCHIVED" ? " (arquivada)" : null}
              {isAdmin && !isArchived ? (
                <Button size="sm" variant="ghost" pending={mutation.isPending} onClick={() => toggleOption(option)}>
                  {option.status === "ARCHIVED" ? "Reativar opção" : "Arquivar opção"}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {isAdmin && !isArchived && field.valueType === "SINGLE_SELECT" ? (
        <form onSubmit={addOption} noValidate>
          <TextField id={`field-add-option-${field.fieldId}`} label="Nova opção" value={newOptionLabel} onChange={setNewOptionLabel} />
          <Button type="submit" size="sm" variant="secondary" pending={mutation.isPending}>
            Adicionar opção
          </Button>
        </form>
      ) : null}
      {isAdmin ? (
        <div>
          {!isArchived ? (
            <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
              Editar campo
            </Button>
          ) : null}{" "}
          <Button size="sm" variant="ghost" pending={mutation.isPending} onClick={toggleArchive}>
            {isArchived ? "Reativar campo" : "Arquivar campo"}
          </Button>
          {showConflict ? <span role="alert"> Este tipo foi alterado por outra pessoa — recarregue antes de salvar de novo.</span> : null}
          {error ? <span role="alert"> {error}</span> : null}
        </div>
      ) : null}
    </li>
  );
}

function AddFieldForm({ documentTypeId, documentTypeVersion, onClose }: { documentTypeId: string; documentTypeVersion: number; onClose: () => void }) {
  const mutation = useCreateMetadataField(documentTypeId);
  const [name, setName] = useState("");
  const [valueType, setValueType] = useState<DocumentTypeFieldValueType>("TEXT");
  const [required, setRequired] = useState(false);
  const [optionsText, setOptionsText] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [showConflict, setShowConflict] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) {
      setErrors(["Informe o nome do campo."]);
      return;
    }
    const options = valueType === "SINGLE_SELECT" ? optionsText.split(",").map((o) => o.trim()).filter(Boolean) : undefined;
    setErrors([]);
    setShowConflict(false);
    try {
      await mutation.mutateAsync({
        input: { name: name.trim(), valueType, required, ...(options ? { options } : {}) },
        expectedDocumentTypeVersion: documentTypeVersion,
      });
      onClose();
    } catch (err) {
      // `isConflict(err)`, not `mutation.isConflict` (Codex block-review finding - stale
      // closure, see `FieldCard.runUpdate`'s identical comment).
      if (isConflict(err)) {
        setShowConflict(true);
        return;
      }
      setErrors([err instanceof ApiError ? err.message : "Não foi possível adicionar este campo."]);
    }
  }

  return (
    <form onSubmit={(event) => void handleSubmit(event)} noValidate>
      <FormErrorSummary errors={errors} />
      {showConflict ? <p role="alert">Este tipo foi alterado por outra pessoa desde que a página carregou — recarregue antes de salvar.</p> : null}
      <TextField id="field-name" label="Nome do campo" value={name} onChange={setName} required />
      <SelectField id="field-value-type" label="Tipo de valor" value={valueType} onChange={(v) => setValueType(v as DocumentTypeFieldValueType)} options={VALUE_TYPE_OPTIONS} required />
      <Checkbox label="Obrigatório" checked={required} onChange={setRequired} />
      {valueType === "SINGLE_SELECT" ? (
        <TextField id="field-options" label="Opções (separadas por vírgula)" value={optionsText} onChange={setOptionsText} hint="Ex.: Baixo, Médio, Alto" />
      ) : null}
      <Button type="submit" variant="primary" pending={mutation.isPending}>
        {mutation.isPending ? "Adicionando…" : "Adicionar campo"}
      </Button>{" "}
      <Button type="button" variant="secondary" onClick={onClose}>
        Cancelar
      </Button>
    </form>
  );
}
