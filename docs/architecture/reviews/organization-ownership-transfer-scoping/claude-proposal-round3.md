---
status: draft
owner: Marcelo
authority: proposta Rodada 3 do protocolo Claude↔Codex (AGENTS.md §4) — nível 5, não normativo até convergência
---

# Transferência de titularidade (OWNER) de organização — Rodada 3

Responde aos dois achados ainda abertos da Rodada 2 (A e F) e aplica os dois ajustes menores de B
e E. Nada mais mudou desde `claude-proposal-round2.md`.

## Correção do achado A — matriz reconciliada, pesos somando 100%, atribuição honesta

| Afirmação | Fonte real | Peso | Status |
|---|---|---:|---|
| Alvo já deve ser membro/usuário existente do workspace/org (nunca convite pendente) | GitHub, Slack, Google Workspace, Notion — as 4 fontes | 20% | Confirmado pelas 4 (Notion confirma "usuário existente" no sentido de billing/acesso, não especificamente elegibilidade de sucessor de ownership — mantenho a nota de que a correspondência com `Membership ACTIVE` deste projeto é interpretação minha, não uma citação literal de nenhuma das 4) |
| Só o próprio OWNER que cede pode iniciar | GitHub, Slack, Google Workspace — 3 fontes (Notion não trata do fluxo de iniciação) | 15% | Confirmado pelas 3 |
| Ação de altíssima irreversibilidade merece fricção extra de autenticação | OWASP (norma) + Slack exige senha explicitamente para ESTA ação especificamente | 20% | Confirmado — correção da regressão que eu havia cometido na Rodada 2: o Slack SIM documenta reautenticação específica para transferência de titularidade, não é uma exigência genérica. Volto à posição correta da Rodada 1. |
| Trilha de auditoria distinguível para a ação | Nenhuma das 4 fontes documenta publicamente seu modelo de auditoria interno (natural — é detalhe de implementação delas) | 10% | Não informado por pesquisa externa — decisão interna, ancorada em D-097 (que trata de auditoria de ações de maior irreversibilidade em geral, não especificamente transferência) |
| Antigo OWNER vira ADMIN, não é removido | Nenhuma das 4 fontes confirma — GitHub remove, Google Workspace depende de ação manual do sucessor, Slack usa papéis não-equivalentes | 15% | Decisão interna do OmniVence (retifico a atribuição a D-097/B2B-7 apontada como não sustentada: D-097 estabelece o TIER de autorização OWNER-only para ações irreversíveis, não a escolha ADMIN-vs-remoção; a escolha ADMIN é proposta NOVA desta rodada, justificada por manter continuidade operacional, sem precedente documentado anterior) |
| Nenhum toque em `TenantLifecycleRecord`/billing | Não é uma questão de pesquisa externa — decisão de escopo interna | 10% | Decisão interna |
| Transação atômica (não sequencial) | Removido na R2 — nenhuma fonte explica a motivação dos concorrentes; mantenho removido | 10% | Decisão interna, justificada só pela infraestrutura já disponível neste projeto (`TransactWriteItems`), nunca como "melhor que o mercado" |

Total: 100%. Cada linha agora declara explicitamente se é confirmada por pesquisa (e por quantas
das 4 fontes) ou decisão interna (e por qual documento/raciocínio interno, sem inventar precedência
que não existe).

## Correção do achado F.1 — contrato de cancelamento completo por índice

A transação tem 4 entradas: índice 0 = Update Membership do chamador, índice 1 = Update Membership
do alvo, índice 2 = Put `MembershipAuditEvent` do chamador, índice 3 = Put `MembershipAuditEvent`
do alvo. Os Puts de auditoria usam `ConditionExpression: "attribute_not_exists(PK) AND
attribute_not_exists(SK)"` (mesmo padrão de `audit-event.ts:102`), então uma falha nos índices 2/3
significa uma colisão de `eventId` (praticamente impossível com o gerador de ID já usado em todo o
projeto, mas tratada explicitamente, não ignorada):

```
reasons = getCancellationReasonCodes(err)  // undefined se o erro não for TransactionCanceledException

if (!reasons) → não é cancelamento de transação, relançar sem reinterpretar (comportamento atual
  de change-membership-role.ts:96, mantido)

if (reasons[0] === "ConditionalCheckFailed") → ConflictError "seu papel mudou ou versão
  desatualizada" (independente do que os outros índices dizem — primeira falha nomeada vence,
  mesma precedência por índice crescente já usada em change-membership-role.ts:89-92)
else if (reasons[1] === "ConditionalCheckFailed") → ConflictError "o alvo deixou de ser elegível
  ou mudou de versão"
else if (reasons[2] === "ConditionalCheckFailed" || reasons[3] === "ConditionalCheckFailed") →
  ConflictError genérico "conflito interno de auditoria, tente novamente" (caso extremamente raro
  de colisão de ID; nunca deve aparecer em operação normal — registrado como sinal de alerta se
  ocorrer, não apenas convertido silenciosamente)
else if (reasons.some(r => r !== "None")) → erro que NÃO é `ConditionalCheckFailed` em nenhum
  índice mas cancelou a transação mesmo assim (ex. `TransactionConflict`, `ThrottlingError`,
  `ValidationError` do próprio DynamoDB) → tratado por TIPO de razão, não por suposição:
  - "TransactionConflict" ou "ThrottlingError" → DependencyUnavailableError/503 (transitório,
    seguro para o cliente tentar de novo)
  - qualquer outra razão (ex. "ValidationError", "ItemCollectionSizeLimitExceeded") → InternalError
    (categoria INTERNAL/500, NUNCA reapresentado como "tente de novo" — não é seguro assumir que
    repetir resolve um erro de validação do próprio DynamoDB)
else → nenhum item causou o cancelamento identificável (`reasons` todo "None" ou ausente por
  completo) → relançar sem reinterpretar, mesmo tratamento do primeiro `if`
```

Este mapeamento fica como uma função nomeada (`classifyTransferCancellation(err)`) testada
isoladamente com um caso por ramo — não é lógica ad-hoc dentro do serviço.

## Correção do achado F.2 — reconciliação de resposta incerta sem falsa certeza

Removida a alegação "403 na repetição = sucesso da primeira tentativa" (o contraexemplo do Codex —
outro OWNER rebaixa o chamador entre as duas tentativas — é real e eu não tinha considerado).
Contrato revisado:

> **Depois de uma resposta incerta (timeout/crash entre a transação e a resposta ao cliente), o
> cliente NUNCA deve inferir sucesso ou falha a partir do código de status de uma repetição.** O
> único caminho correto é consultar o estado atual das memberships da organização (`GET
> /organizations/:id/members`, rota já existente) e comparar com o resultado esperado (o alvo agora
> é OWNER, o chamador agora é ADMIN). Se o estado bate, a operação teve sucesso, independentemente
> de qual resposta a repetição teria dado. Se não bate, o cliente pode tentar de novo com segurança
> (a operação não é destrutiva de re-tentar: se a primeira nunca comitou, a segunda tentativa
> comita normalmente; se a primeira comitou e a segunda for idêntica, ela falha em `authorize()`
> ou em `ConditionalCheckFailed`, nunca produz um efeito duplicado ou incorreto).
>
> Esta operação continua sem token de idempotência dedicado (nenhum serviço deste módulo tem —
> mesmo padrão de `ChangeMembershipRoleService`/`RemoveMembershipService`). O que muda aqui é só a
> orientação explícita ao cliente de NÃO usar o código de status da repetição como prova — a leitura
> de estado é a única fonte de verdade, reconhecendo explicitamente (conforme apontado pelo Codex)
> que mesmo essa leitura, se não fortemente consistente, pode estar atrasada em relação ao commit
> mais recente; por isso a leitura de reconciliação usa `ConsistentRead: true` (mesma opção já
> usada por `dynamodb-organization-store.ts:19` para `GetItem`), não a `Query` eventualmente
> consistente da listagem geral de membros.

Isto não introduz infraestrutura nova (sem token de idempotência, sem outbox extra) — só substitui
uma alegação errada (status como prova) por uma orientação correta (estado lido com consistência
forte como única fonte de verdade), compatível com o que o resto do módulo já faz para leitura de
uma única Membership.

## Ajustes menores de B e E aceitos sem alteração de desenho

- **B**: os eventos de auditoria preenchem os campos já existentes `previousVersion`/`newVersion`
  de `audit-event.ts:31/61`, não campos novos `fromVersion`/`toVersion`.
- **E**: a tabela de elegibilidade do sucessor inclui explicitamente a linha `GlobalUser` ausente
  (não só `identityStatus !== ACTIVE`) → mesma classe de erro `OwnershipTransferTargetIneligibleError`,
  mensagem ajustada para não sugerir "reative a identidade" quando ela nem existe.

## O que permanece do desenho (inalterado desde R1/R2)

Serviço dedicado, transação única de 4 entradas, delta zero em `ownerCount`, Action
`membership:transfer-ownership` gated `OWNER_ROLES`, `MembershipAuditAction =
"OWNERSHIP_TRANSFERRED"`, adiamento formalizado de step-up (aceito pelo Codex na R2, mantido),
fora de escopo (billing, pausa reversível, reatribuição por terceiro, UI).
