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
import { useNavigate } from "react-router-dom";
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
import { FormErrorSummary } from "../../components/forms/FormErrorSummary.js";

const DRAFT_STORAGE_KEY = "expiration-tracker:create-item:draft";

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
      <h1>Novo vencimento</h1>
      <form onSubmit={(event) => void handleSubmit(event)} noValidate>
        <FormErrorSummary errors={generalErrors} />
        <TextField label="Nome" value={draft.name} onChange={(value) => setField("name", value)} error={fieldErrors["name"]} required maxLength={200} />
        <TextField
          label="Categoria"
          value={draft.category}
          onChange={(value) => setField("category", value)}
          error={fieldErrors["category"]}
          required
          maxLength={100}
        />
        <TextField
          label="Data de vencimento"
          type="date"
          value={draft.dueDate}
          onChange={(value) => setField("dueDate", value)}
          error={fieldErrors["dueDate"]}
          required
        />
        <TextField
          label="Descrição (opcional)"
          value={draft.description}
          onChange={(value) => setField("description", value)}
          error={fieldErrors["description"]}
          maxLength={2000}
          multiline
        />
        <TextField label="Emissor (opcional)" value={draft.issuer} onChange={(value) => setField("issuer", value)} error={fieldErrors["issuer"]} maxLength={200} />
        <TextField label="Número (opcional)" value={draft.number} onChange={(value) => setField("number", value)} error={fieldErrors["number"]} maxLength={100} />
        <TextField
          label="Periodicidade (opcional)"
          value={draft.periodicity}
          onChange={(value) => setField("periodicity", value)}
          error={fieldErrors["periodicity"]}
          maxLength={50}
        />
        <TextField label="Data de emissão (opcional)" type="date" value={draft.issueDate} onChange={(value) => setField("issueDate", value)} error={fieldErrors["issueDate"]} />
        <TextField
          label="Responsável (opcional)"
          value={draft.assigneeUserId}
          onChange={(value) => setField("assigneeUserId", value)}
          error={fieldErrors["assigneeUserId"]}
          maxLength={100}
        />
        <TextField label="Prioridade (opcional)" value={draft.priority} onChange={(value) => setField("priority", value)} error={fieldErrors["priority"]} maxLength={50} />
        <TextField
          label="Tags (separadas por vírgula, opcional)"
          value={draft.tags}
          onChange={(value) => setField("tags", value)}
          error={fieldErrors["tags"]}
          hint="Ex.: financeiro, contrato"
        />
        <button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? "Criando…" : "Criar vencimento"}
        </button>
      </form>
    </div>
  );
}
