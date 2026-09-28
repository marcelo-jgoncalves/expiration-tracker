---
status: draft
owner: Marcelo
authority: proposta Rodada 4 do protocolo Claude↔Codex (AGENTS.md §4) — nível 5, não normativo até convergência
---

# Transferência de titularidade (OWNER) de organização — Rodada 4

Responde aos achados restantes da Rodada 3 (A: 3 apontamentos; F.1: 4 apontamentos; F.2: 4
apontamentos). B e E permanecem fechados, sem mudança.

## Correção do achado A (3 apontamentos)

**Linha 19 (auditoria/D-097) corrigida** — removida a citação de D-097 (não sustenta a exigência de
auditoria desta ação especificamente). Fundamento correto: convenção de código já existente e
verificável — TODA mutação de `Membership` neste projeto já produz um `MembershipAuditEvent` na
mesma transação (`ROLE_CHANGED`, `MEMBER_REMOVED`, `MEMBER_LEFT`, `audit-event.ts`) — a transferência
de titularidade muda DUAS Memberships na mesma operação, então precisa de dois eventos pela mesma
convenção já em vigor, não por uma justificativa externa nova.

**Linha 16 (Notion/elegibilidade do sucessor) corrigida** — "Confirmado pelas 4" → **"evidência
direta de 3 fontes (GitHub, Slack, Google Workspace) + evidência indireta de 1 (Notion, que
confirma exigência de usuário/membro existente para fins de billing/acesso, não especificamente
para elegibilidade de sucessão de ownership)"**. Peso mantido em 20% (o critério em si continua
válido, só a contagem de confirmação plena muda de 4 para 3+1 indireta).

**Linha 21 (`TenantLifecycleRecord`) corrigida de volta à formulação da Rodada 2** — reafirmando
explicitamente o que havia sido corrigido lá e se perdeu na reescrita da Rodada 3:

> Não introduz `TenantLifecycleRecord` como mecanismo de transferência ou de representação de
> billing — a operação não escreve nele em nenhuma circunstância. A leitura que já acontece via
> `resolveWorkingOrganization`/`resolve-request-context.ts` para validar que o tenant está ACTIVE
> continua acontecendo normalmente, ANTES desta operação ser autorizada — não é o algoritmo de
> `TransferOwnershipService` que a invoca de novo, é a resolução de contexto padrão que já roda
> para toda requisição autenticada deste sistema.

Tabela completa reconciliada (pesos inalterados, somam 100%):

| Afirmação | Fonte real | Peso | Status |
|---|---|---:|---|
| Alvo já deve ser membro/usuário existente do workspace/org | GitHub, Slack, Google Workspace — evidência direta; Notion — evidência indireta (billing/acesso, não elegibilidade de sucessão especificamente) | 20% | Evidência direta de 3, indireta de 1 |
| Só o próprio OWNER que cede pode iniciar | GitHub, Slack, Google Workspace — 3 fontes | 15% | Confirmado pelas 3 |
| Ação de altíssima irreversibilidade merece fricção extra de autenticação | OWASP (norma) + Slack exige senha explicitamente para ESTA ação | 20% | Confirmado |
| Trilha de auditoria distinguível para a ação | Nenhuma das 4 fontes documenta seu modelo interno | 10% | Decisão interna, ancorada na convenção de código já existente (todo `MembershipAuditEvent` audita toda mutação de `Membership`) — não em D-097 |
| Antigo OWNER vira ADMIN, não é removido | Nenhuma das 4 fontes confirma | 15% | Decisão interna do OmniVence, proposta nova desta rodada, sem precedente documentado |
| Não introduz `TenantLifecycleRecord` como mecanismo de transferência/billing (leitura normal de contexto continua) | Decisão de escopo interna | 10% | Decisão interna |
| Transação atômica (não sequencial) | Decisão interna, justificada só pela infraestrutura já disponível (`TransactWriteItems`) | 10% | Decisão interna |

## Correção do achado F.1 (4 apontamentos) — classificador por categoria, não por índice cego

```
function isTransactionCanceled(err: unknown): boolean {
  return err instanceof Error && err.name === "TransactionCanceledException";
}

function classifyTransferCancellation(err: unknown): TransferCancellationOutcome {
  if (!isTransactionCanceled(err)) {
    throw err; // não é cancelamento de transação — relançar sem reinterpretar (achado 1: nunca
               // inferir "não é cancelamento" a partir de `reasons` undefined; checar o TIPO
               // da exceção primeiro, separado da extração das razões)
  }
  const reasons = getCancellationReasonCodes(err); // pode ser undefined mesmo sendo
    // TransactionCanceledException (razões ausentes/não reportadas) — tratado explicitamente
    // abaixo, nunca confundido com "não cancelou"

  const PERMANENT = new Set(["ValidationException", "ItemCollectionSizeLimitExceededException"]);
  const TRANSIENT = new Set(["TransactionConflict", "ThrottlingException",
    "ProvisionedThroughputExceededException"]); // achado 4: capacidade é transitória, não INTERNAL

  // Achado 2/3: precedência por CATEGORIA de falha, nunca por índice cego — um erro permanente
  // em QUALQUER índice sempre domina sobre uma mensagem de retry de outro índice, porque dizer
  // "tente novamente" para um bug real de validação é pior que uma mensagem genérica de erro
  // interno. Resolve o caso ambíguo [TransactionConflict, None, ValidationException, None]:
  // ValidationException (permanente) vence TransactionConflict (transitório), sempre.
  if (!reasons || reasons.every(r => r === "None")) {
    // TransactionCanceledException confirmado mas sem razão identificável em nenhum índice —
    // postura conservadora: não presumir seguro, nunca oferecer retry automático sem entender
    // a causa.
    return { kind: "InternalError" };
  }
  if (reasons.some(r => PERMANENT.has(r))) {
    return { kind: "InternalError" }; // domina sobre qualquer ConditionalCheckFailed/transitório
                                        // presente em outros índices (achado 2)
  }
  if (reasons[0] === "ConditionalCheckFailed") {
    return { kind: "ConflictError", message: "seu papel mudou ou sua versão está desatualizada, recarregue" };
  }
  if (reasons[1] === "ConditionalCheckFailed") {
    return { kind: "ConflictError", message: "o alvo deixou de ser elegível ou mudou de versão, recarregue e tente de novo" };
  }
  if (reasons[2] === "ConditionalCheckFailed" || reasons[3] === "ConditionalCheckFailed") {
    return { kind: "ConflictError", message: "conflito interno de auditoria, tente novamente" }; // caso raro, sinal de alerta se ocorrer
  }
  if (reasons.some(r => TRANSIENT.has(r))) {
    return { kind: "DependencyUnavailableError" };
  }
  return { kind: "InternalError" }; // razão não reconhecida — nunca oferecer retry sem entender
}
```

Isto resolve, por construção, o caso `[None, None, ConditionalCheckFailed, ValidationException]`
que a Rodada 3 classificava incorretamente como "conflito de auditoria, tente novamente" — a
checagem `PERMANENT` roda ANTES de qualquer checagem por índice, então `ValidationException`
sempre vence.

## Correção do achado F.2 (4 apontamentos) — contrato de reconciliação sem prova de causalidade

> **Depois de uma resposta incerta, o cliente lê o estado ATUAL das duas memberships envolvidas
> (`GetItem` com `ConsistentRead: true` por membership — nunca a `Query` eventualmente consistente
> de `ListMembersService`, que não serve para esta reconciliação; isto é um requisito de
> implementação novo, não uma reutilização de rota existente). Essa leitura prova apenas o ESTADO
> OBSERVADO agora, nunca que ESTA tentativa específica foi a causa dele — outro caminho (ex. outro
> OWNER rebaixando o chamador e promovendo o mesmo alvo por uma via diferente) pode ter produzido
> o mesmo estado final. O contrato não promete identificar a tentativa causadora, só o resultado
> líquido atual.**
>
> **Retry disciplinado**: uma repetição da mesma operação usa OS MESMOS `expectedCallerVersion`/
> `expectedTargetVersion` da tentativa original — nunca reler e avançar as versões antes de repetir
> (isso seria uma NOVA tentativa deliberada, não uma repetição da incerta). Se as versões atuais já
> divergem das originais, a repetição falha em `ConditionalCheckFailed` normalmente (caminho já
> coberto no classificador acima).
>
> **Resultado inconclusivo, explícito**: se a leitura de reconciliação falhar (erro de
> disponibilidade) OU o chamador não tiver mais acesso para lê-la (ex. foi removido da organização
> entre as duas chamadas), a resposta é "resultado inconclusivo — verifique a lista de membros
> manualmente", nunca inferida como sucesso ou falha.
>
> Não é necessária uma fotografia conjunta atômica (`TransactGetItems`) — a reconciliação verifica
> cada Membership independentemente contra o resultado ESPERADO da operação (alvo é OWNER E
> chamador é ADMIN), não a simultaneidade entre as duas leituras.

## O que permanece inalterado desde R1-R3

Serviço dedicado, transação de 4 entradas, delta zero em `ownerCount`, Action
`membership:transfer-ownership` gated `OWNER_ROLES`, `MembershipAuditAction =
"OWNERSHIP_TRANSFERRED"`, adiamento formalizado de step-up (aceito na R2), fora de escopo (billing,
pausa reversível, reatribuição por terceiro, UI). B e E fechados sem mudança.
