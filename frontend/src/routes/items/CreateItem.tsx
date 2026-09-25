import { useState, useEffect, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useOrgPath } from "../../routing/useOrgPath.js";
import { useCreateItem } from "../../hooks/useCreateItem.js";
import { useFormDraft } from "../../hooks/useFormDraft.js";
import { useMembers } from "../../hooks/useMembers.js";
import { useCurrentMembershipRole } from "../../hooks/useCurrentMembershipRole.js";
import { SelectField } from "../../components/forms/SelectField.js";
import { EmptyState } from "../../components/AsyncStates.js";
import { UnsavedChangesGuard } from "../../components/UnsavedChangesGuard.js";
import { ApiError, isUnknownOutcome } from "../../api/errors.js";
import {
  EMPTY_CREATE_ITEM_DRAFT,
  draftToCreateItemInput,
  isValidationError,
  parseValidationErrors,
  validateCreateItemDraft,
  type CreateItemDraft,
} from "../../api/validation.js";
import { Check, List, Plus } from "lucide-react";
import { TextField } from "../../components/forms/TextField.js";
import { FormErrorSummary, type SummaryFieldError } from "../../components/forms/FormErrorSummary.js";
import { PageHeader, Panel, Section } from "../../components/ui/Layout.js";
import { Button, ButtonLink } from "../../components/ui/Button.js";
import "./CreateItem.css";



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

/** Session-interruption recovery (mission §49): the draft (sessionStorage, `useFormDraft`) and
 * the idempotency key (`useCreateItem`'s `CREATE_ITEM_IDEMPOTENCY_STORAGE_KEY`) must back each
 * other up as a pair - a session expiring mid-submit takes the user through a real full-page
 * navigation (BFF login), which clears any in-memory-only React state. */
const DRAFT_STORAGE_KEY = "expiration-tracker:create-item:draft";

function toSummaryFieldErrors(fieldErrors: Record<string, string>): SummaryFieldError[] {
  return Object.entries(fieldErrors)
    .filter(([field]) => FIELD_LABELS[field] !== undefined)
    .map(([field, message]) => ({ fieldId: fieldId(field), label: FIELD_LABELS[field] as string, message }));
}

export function CreateItem() {
  const navigate = useNavigate();
  const orgPath = useOrgPath();
  const { draft, update, clear: clearDraft } = useFormDraft<CreateItemDraft>(DRAFT_STORAGE_KEY, EMPTY_CREATE_ITEM_DRAFT);
  const [saved, setSaved] = useState(false);
  const members = useMembers();
  const role = useCurrentMembershipRole();
  useEffect(() => { document.title = "Novo vencimento · OmniVence"; }, []);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [generalErrors, setGeneralErrors] = useState<string[]>([]);
  const mutation = useCreateItem();

  function setField<K extends keyof CreateItemDraft>(field: K, value: CreateItemDraft[K]) {
    update({ ...draft, [field]: value });
    setFieldErrors(previous => { const next = { ...previous }; delete next[field]; return next; });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mutation.isPending) return; // belt-and-suspenders alongside the disabled submit button - the idempotency key makes even a genuine double-fire safe, this just avoids a redundant request

    const clientErrors = validateCreateItemDraft(draft);
    if (Object.keys(clientErrors.fields).length > 0) {
      setFieldErrors(clientErrors.fields);
      setGeneralErrors(["Preencha os campos obrigatórios para continuar."]);
      document.getElementById(fieldId(Object.keys(clientErrors.fields)[0]!))?.focus();
      return;
    }

    setFieldErrors({});
    setGeneralErrors([]);
    try {
      const response = await mutation.mutateAsync(draftToCreateItemInput(draft));
      setSaved(true);
      clearDraft();
      mutation.newIntent();
      navigate(orgPath(`/items/${response.item.itemId}`), { state: { justCreated: true } });
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

  if (role === "VIEWER") return <EmptyState kind="permission-limited" action={<ButtonLink to={orgPath("/items")}>Voltar para Vencimentos</ButtonLink>} />;

  return (
    <div className="ov-create-item">
      <UnsavedChangesGuard dirty={!saved && Object.values(draft).some(value => value !== "")} />
      <PageHeader
        above={<Link to={orgPath("/items")}>← Voltar para Vencimentos</Link>}
        title="Novo vencimento"
        description="Só nome, categoria e data de vencimento são obrigatórios. O resto pode ser preenchido depois."
      />
      <form className="ui-form" onSubmit={(event) => void handleSubmit(event)} noValidate>
        <FormErrorSummary errors={generalErrors} fieldErrors={toSummaryFieldErrors(fieldErrors)} />
        <Panel padded>
          <Section heading="O essencial" headingId="create-item-essential" description="O que é, de que tipo é, e quando vence." icon={Plus}>
            <div className="create-item__grid">
              <TextField id={fieldId("name")} label="Nome" placeholder="Ex.: Licença Ambiental — Unidade Norte" value={draft.name} onChange={(value) => setField("name", value)} error={fieldErrors["name"]} required maxLength={200} />
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
            </div>
          </Section>
        </Panel>
        <Panel padded>
          <Section heading="Complementos" headingId="create-item-complement" description="Tudo aqui é opcional e pode ser preenchido depois." icon={List}>
            <div className="create-item__grid">
              <div className="create-item__grid-full">
                <TextField
                  id={fieldId("description")}
                  label="Descrição"
                  value={draft.description}
                  onChange={(value) => setField("description", value)}
                  error={fieldErrors["description"]}
                  maxLength={2000}
                  multiline
                />
              </div>
              <TextField id={fieldId("issuer")} label="Emissor" placeholder="Ex.: Secretaria de Meio Ambiente" value={draft.issuer} onChange={(value) => setField("issuer", value)} error={fieldErrors["issuer"]} maxLength={200} />
              <TextField id={fieldId("number")} label="Número" value={draft.number} onChange={(value) => setField("number", value)} error={fieldErrors["number"]} maxLength={100} />
              <TextField
                id={fieldId("periodicity")}
                label="Periodicidade"
                value={draft.periodicity}
                onChange={(value) => setField("periodicity", value)}
                error={fieldErrors["periodicity"]}
                maxLength={50}
              />
              <TextField
                id={fieldId("issueDate")}
                label="Data de emissão"
                type="date"
                value={draft.issueDate}
                onChange={(value) => setField("issueDate", value)}
                error={fieldErrors["issueDate"]}
              />
              <div>
                <SelectField id={fieldId("assigneeUserId")} label="Responsável" value={draft.assigneeUserId} onChange={value => setField("assigneeUserId", value)} disabled={members.isPending || members.isError}
                  options={[{ value: "", label: members.isPending ? "Carregando membros…" : "Selecione, se aplicável" }, ...(members.data?.members.filter(member => member.status === "ACTIVE").map(member => ({ value: member.userId, label: member.displayName || member.email || member.userId })) ?? [])]} />
                {members.isError && <p role="alert">Não foi possível carregar os responsáveis. <button type="button" onClick={() => void members.refetch()}>Tentar novamente</button></p>}
                {fieldErrors["assigneeUserId"] && <p role="alert">{fieldErrors["assigneeUserId"]}</p>}
              </div>
              <TextField id={fieldId("priority")} label="Prioridade" value={draft.priority} onChange={(value) => setField("priority", value)} error={fieldErrors["priority"]} maxLength={50} />
              <div className="create-item__grid-full">
                <TextField
                  id={fieldId("tags")}
                  label="Tags"
                  value={draft.tags}
                  onChange={(value) => setField("tags", value)}
                  error={fieldErrors["tags"]}
                  hint="Separadas por vírgula. Ex.: financeiro, contrato"
                />
              </div>
            </div>
          </Section>
        </Panel>
        <div className="ui-form__actions">
          <Button type="submit" variant="primary" icon={Check} pending={mutation.isPending}>
            {mutation.isPending ? "Criando…" : "Criar vencimento"}
          </Button>
          <ButtonLink to={orgPath("/items")} variant="tertiary">
            Cancelar
          </ButtonLink>
        </div>
      </form>
    </div>
  );
}
