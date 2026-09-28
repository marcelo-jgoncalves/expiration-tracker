---
status: draft
owner: Marcelo
authority: proposta Rodada 5 do protocolo Claude↔Codex (AGENTS.md §4) — nível 5, não normativo até convergência
---

# Transferência de titularidade (OWNER) de organização — Rodada 5

Responde aos três achados restantes da Rodada 4: alegação de auditoria superextendida, códigos de
cancelamento errados + precedência de razão desconhecida, e overclaim de fotografia conjunta em
F.2. Nada mais mudou desde `claude-proposal-round4.md`.

## Correção 1 — alegação de auditoria restrita aos escritores verificados

Linha da tabela A ("Trilha de auditoria distinguível") corrigida de "toda mutação de Membership já
produz auditoria" para:

> Os serviços existentes de alteração de papel, remoção e saída (`ChangeMembershipRoleService`,
> `RemoveMembershipService`, `LeaveOrganizationService`) registram um `MembershipAuditEvent` na
> mesma transação da mutação. `CreateOrganizationService` (criação da Membership OWNER inicial) é
> a exceção conhecida — não audita hoje, e corrigir isso está fora do escopo desta proposta
> (onboarding, não transferência). A transferência de titularidade adota a convenção dos três
> serviços verificados, não uma alegada universalidade que o código não sustenta.

## Correção 2 — códigos de cancelamento reais + precedência de razão desconhecida

```ts
function isTransactionCanceled(err: unknown): boolean {
  return err instanceof Error && err.name === "TransactionCanceledException";
}

// Códigos reais de `CancellationReasons[].Code` (AWS API Reference, TransactWriteItems) — nunca
// nomes de exceção de nível superior (`ValidationException`/`ThrottlingException` NÃO aparecem
// aqui; os códigos de razão de cancelamento têm nomes distintos dos nomes de exceção do SDK).
const PERMANENT = new Set(["ValidationError", "ItemCollectionSizeLimitExceeded"]);
const TRANSIENT = new Set(["TransactionConflict", "ThrottlingError", "ProvisionedThroughputExceeded"]);
const KNOWN = new Set(["None", "ConditionalCheckFailed", ...PERMANENT, ...TRANSIENT]);

function classifyTransferCancellation(err: unknown): TransferCancellationOutcome {
  if (!isTransactionCanceled(err)) throw err;

  const reasons = getCancellationReasonCodes(err);
  if (!reasons || reasons.every(r => r === "None")) {
    return { kind: "InternalError" };
  }
  if (reasons.some(r => PERMANENT.has(r))) {
    return { kind: "InternalError" };
  }
  // Achado real da Rodada 4: uma razão NÃO RECONHECIDA (fora do conjunto conhecido) precisa ser
  // detectada ANTES de qualquer ramo de conflito confiante — mesmo com um ConditionalCheckFailed
  // presente em outro índice, não entender uma das razões é motivo para não oferecer retry
  // confiante em lugar nenhum. Resolve [ConditionalCheckFailed, Unknown, None, None]: cai aqui,
  // nunca no ramo de "seu papel mudou, recarregue".
  if (reasons.some(r => !KNOWN.has(r))) {
    return { kind: "InternalError" };
  }
  if (reasons[0] === "ConditionalCheckFailed") {
    return { kind: "ConflictError", message: "seu papel mudou ou sua versão está desatualizada, recarregue" };
  }
  if (reasons[1] === "ConditionalCheckFailed") {
    return { kind: "ConflictError", message: "o alvo deixou de ser elegível ou mudou de versão, recarregue e tente de novo" };
  }
  if (reasons[2] === "ConditionalCheckFailed" || reasons[3] === "ConditionalCheckFailed") {
    return { kind: "ConflictError", message: "conflito interno de auditoria, tente novamente" };
  }
  if (reasons.some(r => TRANSIENT.has(r))) {
    return { kind: "DependencyUnavailableError" };
  }
  return { kind: "InternalError" };
}
```

Reverificação dos 4 casos que o Codex reproduziu contra este pseudocódigo corrigido:

| Razões | Resultado |
|---|---|
| `[None,None,ConditionalCheckFailed,ValidationError]` | `InternalError` (PERMANENT domina) |
| `[TransactionConflict,None,ValidationError,None]` | `InternalError` (PERMANENT domina) |
| `[ProvisionedThroughputExceeded,None,None,None]` | `DependencyUnavailableError` (TRANSIENT, código correto agora bate) |
| `[ThrottlingError,None,None,None]` | `DependencyUnavailableError` (TRANSIENT, código correto agora bate) |
| `[ConditionalCheckFailed,Unknown,None,None]` | `InternalError` (razão não reconhecida detectada antes do ramo de índice 0) |

## Correção 3 — F.2 sem overclaim de fotografia conjunta

Substituído "se o estado bate, a operação teve sucesso" / "resultado líquido atual" por:

> A reconciliação lê o alvo e o chamador **de forma independente**, cada leitura com
> `ConsistentRead: true` no seu próprio instante — nunca como um par simultâneo provado. O
> contrato não afirma "o par (chamador=ADMIN, alvo=OWNER) existiu ao mesmo tempo"; afirma apenas
> "no momento em que cada leitura individual foi feita, aquela Membership específica tinha aquele
> papel". Isto é suficiente para o propósito de reconciliação (informar ao usuário o estado atual
> de cada Membership, nunca certificar a causalidade histórica de uma tentativa incerta específica)
> e evita deliberadamente a complexidade de `TransactGetItems` — que resolveria a fotografia
> conjunta, mas para um propósito (prova de simultaneidade) que este contrato explicitamente não se
> propõe a oferecer. Se o produto algum dia precisar de uma garantia de simultaneidade real (não é
> o caso hoje), isso é uma extensão futura nomeada, não parte desta proposta.

## O que permanece inalterado desde R1-R4

Serviço dedicado, transação de 4 entradas, delta zero em `ownerCount`, Action
`membership:transfer-ownership` gated `OWNER_ROLES`, `MembershipAuditAction =
"OWNERSHIP_TRANSFERRED"`, adiamento formalizado de step-up, matriz de pesquisa (achado A da Rodada
4, exceto a linha de auditoria corrigida acima), retry disciplinado com versões originais,
resultado inconclusivo explícito. B e E fechados sem mudança.
