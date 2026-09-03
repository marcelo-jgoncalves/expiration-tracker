# Busca e Filtros Documentais (Roadmap P0.5) — Round 4

> Régua estável (9,6/10 desde a Rodada 2). Rodada 3: design 8,1/10, NOT APPROVED, 4 bloqueios
> concretos + 1 pergunta ("a mudança de contrato do erro deveria ir a produto separado?"). Esta
> rodada fecha os 4 e resolve a pergunta por uma alternativa aditiva (sugerida pelo próprio Codex),
> evitando escalar a Marcelo sem necessidade real.

## 1. `BatchGetItem` — linguagem corrigida para o contrato real

Substituo "no máximo 2 chamadas" por: **"no máximo 2 CHUNKS de até 100 chaves cada, por chamada
lógica de busca (não por página física) — cada chunk pode gerar chamadas adicionais à AWS via o
retry de `UnprocessedKeys` já existente no helper reaproveitado (`dynamodb-subject-store.ts:128`),
sem teto adicional além do que esse helper já impõe hoje."** Isto é uma correção de precisão de
linguagem, não uma mudança de mecanismo — o helper já é o único ponto de contato com
`BatchGetItem`, nenhum código novo o reimplementa.

## 2. Cursor — vinculado a toda a assinatura de filtro, contradição resolvida

Contrato único (a ambiguidade "type obrigatório" vs. "type ausente" da Rodada 3 era um erro de
redação, não duas propostas concorrentes — resolvido a favor da segunda, que é a única
implementável sem quebrar "nome busca em todos os tipos"): **`type` é opcional em todo modo**. Com
`type` presente, o prefixo nativo do índice é usado (`begins_with(GSI7SK, "TYPE#{type}#NAME#...")`)
— sem `type`, cai para filtro em memória sobre a partição de status inteira, sempre dentro do
mesmo teto de 5 páginas/125 itens.

Cursor serializado carrega um **fingerprint de toda a assinatura de busca**, não só `mode`/`status`:

```ts
interface SearchCursor {
  mode: "SUBJECT" | "REQUIREMENT" | "EXPIRATION_ITEM";
  status: string;                 // obrigatório, singular (Decisão 3, Rodada 3, inalterada)
  type?: TrackedSubjectType;      // só modo SUBJECT
  namePrefix?: string;            // normalizado (mesma normalização de displayNameNormalized)
  tag?: string;                   // normalizado
  assigneeUserId?: string;        // só modos REQUIREMENT/EXPIRATION_ITEM
  validityState?: UnifiedValidityState;
  lastEvaluatedKey: Record<string, unknown>;
}
```

Servidor serializa isto (base64 de JSON, mesmo padrão de cursor já usado no resto da API) e, ao
receber um cursor de volta, **recomputa o mesmo fingerprint a partir dos parâmetros da nova
chamada e rejeita com 400 (`ValidationError`, "cursor não corresponde aos filtros desta busca") se
qualquer campo divergir** — fecha exatamente o caso "mudar `namePrefix` e reaproveitar o
`LastEvaluatedKey`" que a Rodada 3 apontou.

## 3. `UnifiedValidityState` de Requirement — mapeamento corrigido usando `evidenceState`, sem inventar um 6º valor

O roadmap define exatamente 5 valores (`válido/vencendo/vencido/permanente/aguardando revisão`) —
adicionar um 6º (`SEM_EVIDENCIA`, sugestão da Rodada 3) mudaria o vocabulário do produto, o que
está fora da autoridade deste protocolo (mesma régua de "não reabrir decisão de produto sem
necessidade"). Em vez disso, o adaptador `Requirement -> UnifiedValidityState` passa a inspecionar
`evidenceState` (já presente no item, `requirement.ts:71`) para desambiguar dentro de `PENDING`,
que hoje o design comprimia erroneamente numa única linha:

| `Requirement.status` | `evidenceState` (quando relevante) | `UnifiedValidityState` | Racional |
|---|---|---|---|
| `NOT_APPLICABLE` | — | excluído do vocabulário | inalterado da Rodada 3 |
| `MISSING` | N/A (sem evidência nenhuma) | `AGUARDANDO_REVISAO` | nunca teve evidência — "aguardando" upload, o bucket acionável mais próximo dos 5 valores do roadmap |
| `PENDING` | `DRAFT` \| `RECEIVED` \| `UNDER_REVIEW` | `AGUARDANDO_REVISAO` | evidência existe e está em fluxo de revisão real — o caso que o nome do bucket descreve literalmente |
| `PENDING` | `REJECTED` \| `WITHDRAWN` \| `SUPERSEDED` | `VENCIDO` | o ponteiro de evidência atual é inválido/obsoleto — funcionalmente equivalente a "não satisfeito hoje", mesmo bucket de `NOT_SATISFIED` (nunca um terceiro estado que o vocabulário de 5 valores não tem onde guardar) |
| `SATISFIED` | (implica `ACCEPTED`) | `PERMANENTE`/`VALIDO`/`VENCENDO` conforme `evidenceValidUntil` (inalterado da Rodada 3) | — |
| `NOT_SATISFIED` | (implica `ACCEPTED`, `evidenceValidUntil` passado) | `VENCIDO` | inalterado da Rodada 3 |

Cada uma das 6 combinações reais de `status`×`evidenceState` vira um caso de teste unitário
dedicado da Fatia 1 (nunca "uma linha por status derivado", corrigindo a lacuna exata que a Rodada
3 apontou). Este é um judgment call de apresentação/derivação (nível 4 — nunca persiste um campo
novo, nunca muda `RequirementStatus`/`deriveRequirementStatus` em si), não uma decisão de produto
que precise ir a Marcelo.

## 4. Lookup de reatribuição — paralelo, exaustivo por necessidade, fail-closed, observável

**Correção ao "aceitável na escala atual" (não verificável, Rodada 3 tem razão)**:

- **Execução paralela** das 4 Queries de `Requirement` (`Promise.all`, mesma RCU total, latência
  = a mais lenta das 4, não a soma) — combinada com o lookup já existente de `ExpirationItem`
  (5 Queries no total rodando em paralelo, não 5 sequenciais).
- **Exaustividade não é negociável para as 4 Queries de Requirement** (paginar cada uma até
  `LastEvaluatedKey` esgotar) pela MESMA razão já `APPROVED` em D-122/D-125 para `ExpirationItem`:
  truncar via `Limit` do DynamoDB produziria falso negativo (deixar passar uma remoção que deveria
  bloquear) — o teto de 20 nesta decisão sempre foi só sobre a LISTA retornada no erro, nunca sobre
  a decisão de bloquear.
- **Orçamento de latência explícito**: timeout de 5s no total (mesma ordem de grandeza de um
  request HTTP síncrono já aceitável no resto da API) — se as 5 Queries paralelas não terminarem
  dentro do orçamento, `RemoveMembershipService.remove()`/`LeaveOrganizationService.leave()`
  **falham fechado**: lançam `ServiceUnavailableError` (categoria já existente em `app-error.ts`,
  `retryable: true`) em vez de prosseguir com a remoção sem ter concluído os dois lookups — nunca
  "sem resposta a tempo = assume que não há nada atribuído".
- **Observabilidade via mecanismos já existentes** (mesmo precedente que `research-protocol.md`'s
  checklist da Rodada 2 já exigiu para `SIM PARCIAL`/postura de consistência em D-122): o
  `security-audit.ts`/log estruturado já emitido por `RemoveMembershipService` ganha os campos
  `responsibilityLookupDurationMs`/`responsibilityLookupPagesEvaluated` — nenhuma métrica nova
  inventada, só dois campos a mais no evento que já é logado.
- **Gatilho quantitativo para revisitar** (nunca "quando parecer necessário"): se o volume real de
  `Requirement`s por tenant crescer a ponto do orçamento de 5s ser estourado com frequência
  observável, a fatia seguinte é um índice dedicado por `assigneeUserId` (GSI novo, mesmo
  tratamento de governança da Decisão 1 desta revisão) — nomeado aqui, não construído agora, mesmo
  padrão da Fatia 4 já deferida.

## 5. Contrato de erro — resolvido por alternativa aditiva, nunca quebra o formato existente

Acatando a sugestão do próprio Codex na Rodada 3: **`ResponsibilityReassignmentRequiredError`
mantém `details.itemIds`/`totalKnown`/`truncated` EXATAMENTE como estão hoje** (zero mudança de
contrato observável, zero cliente quebrado) e ganha um campo **novo e opcional**:

```ts
class ResponsibilityReassignmentRequiredError extends AppError {
  details: {
    // campos existentes, inalterados — sempre presentes, sempre sobre ExpirationItem, como hoje
    targetUserId: string;
    itemIds: string[];
    totalKnown: number;
    truncated: boolean;
    // NOVO, opcional — ausente/omitido quando não há Requirement nenhuma atribuída
    requirements?: { requirementIds: string[]; totalKnown: number; truncated: boolean };
  };
}
```

Isto fecha a pergunta da Rodada 3 sem precisar de uma decisão de produto separada nem escalar a
Marcelo — é aditivo por construção, exatamente a alternativa que a própria crítica apontou como
disponível. Lançado quando `itemIds.length > 0 OR (requirements?.totalKnown ?? 0) > 0`.

## Checklist (inalterado, régua estável desde a Rodada 2)

25% completude física / 20% paginação / 15% semântica de produto / 15% validade unificada / 15%
responsável / 10% governança de GSI.

## Escopo e fatias — inalterados desde a Rodada 3, contratos agora fechados nos 4 pontos acima
