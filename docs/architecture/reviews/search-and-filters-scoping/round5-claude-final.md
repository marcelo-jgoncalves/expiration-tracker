# Busca e Filtros Documentais (Roadmap P0.5) — Round 5 (fechamento)

> Régua estável (9,6/10) desde a Rodada 2. Rodada 4: design 8,8/10, NOT APPROVED, exatamente 2
> bloqueios. Ambos fechados abaixo sem reabrir nada já resolvido nas Rodadas 1-4.

## 1. Observabilidade do lookup de reatribuição — mecanismo correto nomeado, métricas completas

**Correção factual aceita integralmente**: `security-audit.ts` é taxonomia fechada de
autorização/GSI restrito (confirmado por leitura — nunca canal genérico de performance), e
`RemoveMembershipService`/`LeaveOrganizationService` emitem `MembershipAuditEvent` só quando a
remoção EFETIVAMENTE acontece dentro da transação — nunca observaria um lookup bloqueado, timeout
ou erro, exatamente os casos que importam aqui.

**Mecanismo correto**: um log operacional estruturado próprio, emitido pelo composition root
(`runtime/aws/composition/organization.ts`, onde as duas portas `AssignedActiveItemsLookup`/
`AssignedActiveRequirementsLookup` já são implementadas) via `SecureLogger` (mesma disciplina de
`AGENTS.md` §7 — nunca `console.*`), em TODOS os desfechos do lookup (sucesso permitindo
prosseguir, bloqueio por responsabilidade pendente, timeout, erro) — não só no caminho feliz:

```ts
logger.info("organization.responsibility_lookup", {
  outcome: "ALLOWED" | "BLOCKED" | "TIMEOUT" | "ERROR",
  durationMs: number,
  pagesEvaluated: number,      // soma das 5 Queries paralelas
  itemsEvaluated: number,      // soma dos itens brutos lidos, antes do FilterExpression
  consumedCapacityUnits: number, // soma de ConsumedCapacity das 5 Queries (já disponível via
                                  // ReturnConsumedCapacity, mesmo padrão que outras Queries do
                                  // projeto já usam para instrumentação, nenhum SDK novo)
});
```

**Gatilho quantitativo decidível** (corrige "frequência observável" vago da Rodada 4): **mais de
1% dos lookups excedendo 2,5s (metade do timeout de 5s, margem de alerta antes do teto) numa
janela móvel de 7 dias** dispara a fatia do índice dedicado por `assigneeUserId` — um número
concreto, mensurável a partir só dos campos acima, sem métrica nova além do que este log já
carrega.

## 2. Mapeamento de validade — estados sem correspondência semântica real retornam `undefined`, nunca forçados

**Aceito integralmente**: forçar `MISSING`/evidência terminal-inválida (`REJECTED`/`WITHDRAWN`/
`SUPERSEDED`) para um dos 5 valores do vocabulário muda o que é apresentado ao usuário de forma
enganosa ("vencido" implica que algo já foi válido e expirou — uma evidência rejeitada nunca foi
válida). A tabela já usava `undefined`/exclusão para `NOT_APPLICABLE` e para os estados terminais
de `DocumentVersion` — a mesma saída está disponível aqui e é a escolha certa, não uma decisão de
produto nova (é reaplicar uma convenção já adotada nesta mesma tabela a mais dois casos, não
inventar uma convenção nova).

### Tabela final de `Requirement -> UnifiedValidityState` (substitui a da Rodada 4)

| `status` | `evidenceState` | `UnifiedValidityState` |
|---|---|---|
| `NOT_APPLICABLE` | — | **excluído** (inaplicabilidade, filtro `applicability` separado) |
| `MISSING` | N/A | **excluído** (nunca houve evidência — não é "aguardando revisão" nem qualquer outro dos 5 valores; um filtro de busca por `UnifiedValidityState` nunca retorna Requirements `MISSING`, que continuam buscáveis pelo filtro de `status`/`applicability` diretamente) |
| `PENDING` | `DRAFT` \| `RECEIVED` \| `UNDER_REVIEW` | `AGUARDANDO_REVISAO` |
| `PENDING` | `REJECTED` \| `WITHDRAWN` \| `SUPERSEDED` | **excluído** (evidência inválida/obsoleta — nem "aguardando revisão" nem "vencido"; buscável só por `status=PENDING` diretamente) |
| `SATISFIED` | (`ACCEPTED`), sem `evidenceValidUntil` | `PERMANENTE` |
| `SATISFIED` | (`ACCEPTED`), `evidenceValidUntil >= now + 7d` | `VALIDO` |
| `SATISFIED` | (`ACCEPTED`), `evidenceValidUntil < now + 7d` e `>= now` | `VENCENDO` |
| `NOT_SATISFIED` | (`ACCEPTED`), `evidenceValidUntil < now` | `VENCIDO` |

**8 linhas reais, não 6** (correção da contagem imprecisa da Rodada 3/4) — cada uma um caso de
teste unitário dedicado da Fatia 1, cobrindo literalmente toda combinação de `status`×`evidenceState`
que `deriveRequirementStatus` pode produzir (verificado contra `requirement.ts:179-189`, nenhuma
combinação adicional é alcançável pela função de derivação real). Consequência de produto aceita
explicitamente: um Requirement `MISSING` ou `PENDING`-com-evidência-inválida não aparece em
NENHUM filtro de validade da busca — só aparece filtrando por `status` diretamente. Isto é
consistente (não uma lacuna escondida): o vocabulário de validade do roadmap descreve o ciclo de
vida de uma evidência que existe e está em algum estado de validade real, não a ausência total de
evidência.

## Checklist final (inalterado, régua 9,6/10 estável desde a Rodada 2)

25% completude física / 20% paginação / 15% semântica de produto / 15% validade unificada / 15%
responsável / 10% governança de GSI.

## Nenhum outro ponto reaberto

Rodadas 1-4 fecharam, em ordem: unidade de busca (união discriminada Subject/Requirement/Item),
prefixo GSI7 (type opcional, fallback em memória documentado), remoção de `ExpirationItem` do
enriquecimento e de `matchedRequirements`, `status` obrigatório/singular, contrato de paginação
completo (`items`/`cursor`/`scanLimitReached`, cursor com fingerprint de toda a assinatura de
busca), `BatchGetItem` com linguagem de chunking correta, portas irmãs para o lookup de
reatribuição (`AssignedActiveItemsLookup` inalterada + `AssignedActiveRequirementsLookup` nova),
4 Queries exaustivas paralelas com timeout fail-closed, contrato de erro aditivo (zero quebra
observável). Nenhum destes é tocado nesta rodada.

## Autoavaliação às cegas (registrada antes de ver a nota do Codex, protocolo de nota cega)

**9,2/10.** Os dois bloqueios da Rodada 4 eram reais e concretos, não formalidade — a correção do
mecanismo de observabilidade (nomear o log certo em vez de forçar `security-audit.ts`) e a recusa
de forçar `MISSING`/evidência-terminal-inválida num dos 5 valores do vocabulário fecham lacunas de
precisão que uma implementação real bateria de frente. Resto 0,8: a fatia de índice dedicado por
`assigneeUserId` (gatilho nomeado) ainda não tem um esboço de forma física — aceitável para uma
fatia explicitamente deferida (mesmo padrão da Fatia 4 de busca), mas registro que não é um "10"
redondo por isso.
