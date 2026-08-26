/**
 * Create Expiration (mission §26-35/§92): the smallest correct path to put something under
 * tracking - only name/category/dueDate are required, matching CreateItemInput exactly.
 *
 * Session-interruption recovery (mission §49): the draft (sessionStorage, useFormDraft) and
 * the idempotency key (sessionStorage, useIdempotentMutation's persistenceKey) are both keyed
 * independently but rehydrate together on remount - a user who gets redirected through a BFF
 * reauthentication mid-submission lands back on this same form, values intact, ready to
 * resubmit under the SAME key (mission §29: a retry of the same logical submission never gets
 * a fresh key) - safe either way per CREATE-IDEMPOTENCY-01, whether the original attempt
 * never reached the backend or already succeeded.
 */
import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useCreateItem } from "../../hooks/useCreateItem.js";
import { useFormDraft } from "../../hooks/useFormDraft.js";
import { ApiError, isUnknownOutcome } from "../../api/errors.js";
import {
  EMPTY_CREATE_ITEM_DRAFT,
  draftToCreateItemInput,
  isValidationError,
  parseValidationErrors,
  validateCreateItemDraft,
  type CreateItemDraft,
} from "../../api/validation.js";
import { TextField } from "../../components/forms/TextField.js";
import { FormErrorSummary, type SummaryFieldError } from "../../components/forms/FormErrorSummary.js";
import { PageHeader } from "../../components/ui/Layout.js";
import { Button, ButtonLink } from "../../components/ui/Button.js";

const DRAFT_STORAGE_KEY = "expiration-tracker:create-item:draft";

/** Stable control ids so the ErrorSummary can link straight to the offending field
 * (mission §40), plus the human label the summary quotes. Keyed by the same field name the
 * validator reports, so a new validation error can never end up unlinkable by accident. */
const FIELD_LABELS: Record<string, string> = {
  name: "Nome",
  category: "Categoria",
  dueDate: "Data de vencimento",
  description: "Descrição",
  issuer: "Emissor",
  number: "Número",
  periodicity: "Periodicidade",
  issueDate: "Data de emissão",
  assigneeUserId: "Responsável",
  priority: "Prioridade",
  tags: "Tags",
};

function fieldId(field: string): string {
  return `create-item-${field}`;
}

function toSummaryFieldErrors(fieldErrors: Record<string, string>): SummaryFieldError[] {
  return Object.entries(fieldErrors)
    .filter(([field]) => FIELD_LABELS[field] !== undefined)
    .map(([field, message]) => ({ fieldId: fieldId(field), label: FIELD_LABELS[field] as string, message }));
}

export function CreateItem() {
  const navigate = useNavigate();
  const { draft, update, clear } = useFormDraft<CreateItemDraft>(DRAFT_STORAGE_KEY, EMPTY_CREATE_ITEM_DRAFT);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [generalErrors, setGeneralErrors] = useState<string[]>([]);
  const mutation = useCreateItem();

  function setField<K extends keyof CreateItemDraft>(field: K, value: CreateItemDraft[K]) {
    update({ ...draft, [field]: value });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mutation.isPending) return; // belt-and-suspenders alongside the disabled submit button - the idempotency key makes even a genuine double-fire safe, this just avoids a redundant request

    const clientErrors = validateCreateItemDraft(draft);
    if (Object.keys(clientErrors.fields).length > 0) {
      setFieldErrors(clientErrors.fields);
      setGeneralErrors([]);
      return;
    }

    setFieldErrors({});
    setGeneralErrors([]);
    try {
      const response = await mutation.mutateAsync(draftToCreateItemInput(draft));
      clear();
      mutation.newIntent();
      navigate(`/items/${response.item.itemId}`, { state: { justCreated: true } });
    } catch (err) {
      if (isValidationError(err)) {
        const parsed = parseValidationErrors(err);
        setFieldErrors(parsed.fields);
        setGeneralErrors(parsed.general);
        return;
      }
      if (isUnknownOutcome(err)) {
        setGeneralErrors([
          "Não foi possível confirmar se este vencimento foi criado. Verifique a lista de Vencimentos antes de tentar novamente - se ele já aparecer lá, não é necessário reenviar.",
        ]);
        return;
      }
      setGeneralErrors([err instanceof ApiError ? err.message : "Não foi possível criar o vencimento."]);
    }
  }

  return (
    <div>
      <PageHeader
        above={<Link to="/items">← Voltar para Vencimentos</Link>}
        title="Novo vencimento"
        description="Só nome, categoria e data de vencimento são obrigatórios. O resto pode ser preenchido depois."
      />
      <form className="ui-form" onSubmit={(event) => void handleSubmit(event)} noValidate>
        <FormErrorSummary errors={generalErrors} fieldErrors={toSummaryFieldErrors(fieldErrors)} />
        <TextField id={fieldId("name")} label="Nome" value={draft.name} onChange={(value) => setField("name", value)} error={fieldErrors["name"]} required maxLength={200} />
        <TextField
          id={fieldId("category")}
          label="Categoria"
          value={draft.category}
          onChange={(value) => setField("category", value)}
          error={fieldErrors["category"]}
          required
          maxLength={100}
        />
        <TextField
          id={fieldId("dueDate")}
          label="Data de vencimento"
          type="date"
          value={draft.dueDate}
          onChange={(value) => setField("dueDate", value)}
          error={fieldErrors["dueDate"]}
          required
        />
        <TextField
          id={fieldId("description")}
          label="Descrição"
          value={draft.description}
          onChange={(value) => setField("description", value)}
          error={fieldErrors["description"]}
          maxLength={2000}
          multiline
        />
        <TextField id={fieldId("issuer")} label="Emissor" value={draft.issuer} onChange={(value) => setField("issuer", value)} error={fieldErrors["issuer"]} maxLength={200} />
        <TextField id={fieldId("number")} label="Número" value={draft.number} onChange={(value) => setField("number", value)} error={fieldErrors["number"]} maxLength={100} />
        <TextField
          id={fieldId("periodicity")}
          label="Periodicidade"
          value={draft.periodicity}
          onChange={(value) => setField("periodicity", value)}
          error={fieldErrors["periodicity"]}
          maxLength={50}
        />
        <TextField id={fieldId("issueDate")} label="Data de emissão" type="date" value={draft.issueDate} onChange={(value) => setField("issueDate", value)} error={fieldErrors["issueDate"]} />
        <TextField
          id={fieldId("assigneeUserId")}
          label="Responsável"
          value={draft.assigneeUserId}
          onChange={(value) => setField("assigneeUserId", value)}
          error={fieldErrors["assigneeUserId"]}
          maxLength={100}
        />
        <TextField id={fieldId("priority")} label="Prioridade" value={draft.priority} onChange={(value) => setField("priority", value)} error={fieldErrors["priority"]} maxLength={50} />
        <TextField
          id={fieldId("tags")}
          label="Tags"
          value={draft.tags}
          onChange={(value) => setField("tags", value)}
          error={fieldErrors["tags"]}
          hint="Separadas por vírgula. Ex.: financeiro, contrato"
        />
        <div className="ui-form__actions">
          <Button type="submit" variant="primary" pending={mutation.isPending}>
            {mutation.isPending ? "Criando…" : "Criar vencimento"}
          </Button>
          <ButtonLink to="/items" variant="tertiary">
            Cancelar
          </ButtonLink>
        </div>
      </form>
    </div>
  );
}
