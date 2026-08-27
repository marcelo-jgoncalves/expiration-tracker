/**
 * Renew Expiration (mission §36-40/§93): renewing is NOT editing - the current cycle is
 * preserved (marked RENEWED) and a new cycle is created (ExpirationService.renewItem, never
 * mutating the source's dueDate in place). The always-visible notice below states that
 * consequence before submission (mission §37's "confirmation of consequence") without a
 * separate modal step, consistent with this stage's "no new UI chrome" constraint.
 *
 * OCC (mission §39-40): a 409 is never shown as a generic failure. `isConflict(mutation.error)`
 * drives a dedicated recovery affordance - "Recarregar" refetches the item (picking up its
 * current version) AND resets the mutation (`mutation.reset()`) so the derived conflict flag
 * clears and the form becomes submittable again with the freshly-fetched version, never a
 * blind retry of the stale one.
 */
import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useItem } from "../../hooks/useItem.js";
import { useRenewItem } from "../../hooks/useRenewItem.js";
import { formatAbsoluteDate, formatRelativeDueDate } from "../../api/presentation.js";
import { InitialLoading, ErrorState } from "../../components/AsyncStates.js";
import { ApiError, isConflict, isUnknownOutcome } from "../../api/errors.js";
import { TextField } from "../../components/forms/TextField.js";
import { FormErrorSummary } from "../../components/forms/FormErrorSummary.js";
import { PageHeader } from "../../components/ui/Layout.js";
import { Button, ButtonLink } from "../../components/ui/Button.js";
import { InlineNotice } from "../../components/ui/InlineNotice.js";

export function RenewItem() {
  const { itemId } = useParams<{ itemId: string }>();
  const navigate = useNavigate();
  const itemQuery = useItem(itemId ?? "");
  const [newDueDate, setNewDueDate] = useState("");
  const [generalErrors, setGeneralErrors] = useState<string[]>([]);
  const mutation = useRenewItem(itemId ?? "");

  if (!itemId) return null; // unreachable - the route always supplies :itemId

  if (itemQuery.isPending) {
    return <InitialLoading label="Carregando vencimento…" />;
  }
  if (itemQuery.isError) {
    const message = itemQuery.error instanceof ApiError ? itemQuery.error.message : "Não foi possível carregar este vencimento.";
    return <ErrorState message={message} onRetry={() => void itemQuery.refetch()} />;
  }

  const item = itemQuery.data.item;
  const conflict = isConflict(mutation.error);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mutation.isPending || conflict) return;
    if (!newDueDate) {
      setGeneralErrors(["Informe a nova data de vencimento."]);
      return;
    }
    setGeneralErrors([]);
    try {
      const response = await mutation.mutateAsync({ newDueDate: `${newDueDate}T00:00:00.000Z`, expectedVersion: item.version });
      mutation.newIntent();
      navigate(`/items/${response.item.itemId}`, { state: { justRenewed: true, copiedReminderPolicyIds: response.copiedReminderPolicyIds } });
    } catch (err) {
      if (isConflict(err)) return; // surfaced by the derived `conflict` flag below, no separate copy needed
      if (isUnknownOutcome(err)) {
        setGeneralErrors(["Não foi possível confirmar se esta renovação foi concluída. Recarregue este vencimento antes de tentar novamente."]);
        return;
      }
      setGeneralErrors([err instanceof ApiError ? err.message : "Não foi possível renovar este vencimento."]);
    }
  }

  return (
    <div>
      <PageHeader
        above={<Link to={`/items/${item.itemId}`}>← Voltar para o vencimento</Link>}
        title="Renovar vencimento"
        description={
          <>
            <strong>{item.name}</strong> - ciclo atual: {formatRelativeDueDate(item.dueDate, new Date())}
          </>
        }
      />
      {/* The consequence of the action, stated before submission (Core Expiration slice §37).
          `info`, not `warning`: renewing is a normal, expected operation - toning it as a
          hazard would be crying wolf. */}
      <InlineNotice tone="info">
        <p>
          Renovar cria um novo ciclo de vencimento: o ciclo atual (vencimento em {formatAbsoluteDate(item.dueDate)}) será marcado como <strong>renovado</strong> e
          um novo vencimento ativo será criado com a nova data. Isso não é o mesmo que editar a data deste vencimento.
        </p>
      </InlineNotice>
      {conflict ? (
        // OCC conflict (mission §48): the record changed, the system did not break. Its own
        // visual pattern with its own recovery action - never the generic error treatment,
        // and never the critical tone, which would read as "something went wrong".
        <InlineNotice
          tone="warning"
          announce="alert"
          title="Este vencimento mudou desde que você o abriu"
          actions={
            <Button
              variant="secondary"
              onClick={() => {
                mutation.reset();
                void itemQuery.refetch();
              }}
            >
              Recarregar
            </Button>
          }
        >
          <p>Recarregue para ver o estado atual antes de renovar novamente.</p>
        </InlineNotice>
      ) : null}
      <form className="ui-form" onSubmit={(event) => void handleSubmit(event)} noValidate>
        <FormErrorSummary errors={generalErrors} />
        <TextField id="renew-due-date" label="Nova data de vencimento" type="date" value={newDueDate} onChange={setNewDueDate} required />
        <div className="ui-form__actions">
          <Button type="submit" variant="primary" pending={mutation.isPending} disabled={conflict}>
            {mutation.isPending ? "Renovando…" : "Confirmar renovação"}
          </Button>
          <ButtonLink to={`/items/${item.itemId}`} variant="tertiary">
            Cancelar
          </ButtonLink>
        </div>
      </form>
    </div>
  );
}
