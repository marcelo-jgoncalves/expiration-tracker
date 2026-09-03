# Round 5 (Claude) — Final Revision

**Claude's own blind score for Round 4 (recorded now that Codex's Round 4 score, 8.8/10, exists):
8.6/10.** The GSI1-per-status sweep design was a real improvement but still wrong on tenant
enumeration and status coverage, and I mismatched the write mechanism (`buildVersionedUpdate`
executes via `transactWrite`, not standalone `UpdateItem`) against the IAM I listed. Three precise
fixes, all converging on one simpler mechanism than Round 4's.

## 1+3. Sweep de reparo — Scan cross-tenant filtrado, não GSI1 por tenant (resolve descoberta de tenant E cobertura de status ao mesmo tempo)

Corrigido: a Rodada 4 errou ao propor um `Query` por partição `GSI1` — isso exige já saber o
`tenantId`, e nada no worker agendado enumera tenants (achado correto do Codex:
`DocumentArchiveStore` não tem esse método, e o precedente cross-tenant real do próprio módulo,
`document-request-recurrence`, já resolve exatamente este problema com `Scan`, não com `Query`).

Adoto o MESMO precedente já aprovado no mesmo módulo: novo método
`scanRequirementsWithEvidence(exclusiveStartKey?)` em `DocumentArchiveStore`, mesma forma de
`scanActiveSeries` (`document-archive-store.ts`'s doc comment já registra explicitamente esse
trade-off aceito: "this module still has no tenant-enumeration port method, so a GSI1 query keyed
by a specific `TENANT#<t>#...` partition can't answer 'every X across every tenant' without one" —
`Scan` filtrado no storage layer, um `ScanCommand` físico por página, paginado pelo caller). Filtro:
`entityType = "Requirement" AND attribute_exists(evidenceVersionId)`.

Isto resolve os dois achados da Rodada 4 ao mesmo tempo:

- **Descoberta de tenant** (achado #2): `Scan` não precisa de `tenantId` de entrada — cross-tenant
  por construção, mesmo padrão já aceito.
- **Cobertura de status** (achado #3): o filtro é `attribute_exists(evidenceVersionId)`, nunca um
  status específico — cobre `SATISFIED`, `PENDING` E `NOT_SATISFIED` (o caso que a Rodada 4
  perdeu: um Requirement preso em `NOT_SATISFIED` que deveria ter voltado a `SATISFIED` porque
  `validUntil` foi corrigido para uma data futura, ou teve a validade removida) — qualquer
  Requirement com evidência vinculada, independente do status cacheado, é candidato. Isto é
  estritamente mais forte que "adicionar NOT_SATISFIED à lista" (a alternativa que o próprio
  Codex sugeriu) — remove a dependência de status cacheado por completo, fechando por construção
  qualquer transição futura de status que ninguém pensou em listar.

Custo: mesmo trade-off já aceito por `scanActiveSeries` neste mesmo módulo — um `Scan` diário,
paginado, filtrado no storage layer. Não é um mecanismo novo de custo/risco, é o padrão que este
módulo já usa para exatamente esta classe de problema ("preciso de todos os X do sistema, não
tenho enumeração de tenant").

## 2. IAM do refresh worker — alinhado ao mecanismo de escrita real

Corrigido o erro apontado: `buildVersionedUpdate` produz uma entrada de `TransactWriteItems`,
executada via `store.transactWrite()` — nunca um `UpdateItem` standalone. IAM correto:
`dynamodb:TransactWriteItems` na tabela (escopado à ação de update do Requirement dentro dessa
transação), substituindo `dynamodb:UpdateItem` da Rodada 4. Mesma correção se aplica ao
`requirement-evidence-daily-sweep` do item 1 quando ele escreve (via o mesmo worker de refresh —
o sweep só enfileira candidatos para o MESMO `requirement-evidence-refresh-handler` já desenhado
na Rodada 3/4, nunca escreve `Requirement` diretamente ele mesmo — reaproveita o único caminho de
escrita já existente, um único lugar no código decide como atualizar um `Requirement`).

## IAM final consolidado do par de workers

- `requirement-evidence-daily-sweep` (agendado, EventBridge Scheduler): `dynamodb:Scan` na tabela
  (filtrado a `Requirement`+`evidenceVersionId` no storage layer), `sqs:SendMessage` na fila
  `requirement-evidence-refresh-queue` (um envio por candidato encontrado — o sweep não escreve
  Requirement, só reenfileira o mesmo evento wake-up que qualquer outro gatilho já produz).
- `requirement-evidence-refresh-handler` (SQS): `sqs:ReceiveMessage`/`DeleteMessage`/`GetQueueAttributes`
  na fila; `dynamodb:GetItem` em `DocumentVersion`; `dynamodb:Query` em `GSI_EVIDENCE`;
  `dynamodb:GetItem` em `Requirement`; `dynamodb:TransactWriteItems` na tabela (escrita OCC do
  Requirement). Nenhum `UpdateItem` standalone em lugar nenhum deste desenho.

## Resultado: os dois mecanismos de reparo colapsam em um só caminho de escrita

Com o sweep apenas reenfileirando (nunca escrevendo), este design fecha uma simplificação que
nenhuma rodada anterior tinha notado: existe agora exatamente UM lugar que decide como um
Requirement converge para o estado correto (`requirement-evidence-refresh-handler`, item 5 da
Rodada 3) — tanto o caminho "evento em tempo real" (outbox → fila) quanto o caminho "sweep diário
de reparo" (Scan → mesma fila) alimentam o MESMO consumidor idempotente. Isto não é uma mudança de
escopo desta rodada, é uma consequência que só ficou visível ao corrigir o mecanismo de descoberta
do sweep — registrada aqui porque simplifica a superfície de implementação da Fase 3
(um handler a menos do que as Rodadas 3/4 pareciam implicar).
