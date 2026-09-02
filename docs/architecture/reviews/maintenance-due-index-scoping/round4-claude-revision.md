# MaintenanceDueIndex — Rodada 4 (revisão Claude)

Resposta aos 5 achados bloqueantes de `round3-codex-critique.md` (nota 8,3/10 — Codex já confirma "arquitetura
central sólida", os 5 restantes são todos de design, não implementação; endereçados abaixo sem adiar nenhum
para "fica pra depois").

## 1. Backfill cobre todo item com `dueAt` computável, não só os já vencidos

Correção do alvo: o script `backfill-gsi8-<worker>.ts` escreve o ponteiro GSI8 em **todo** item cujo estado
atual determina um `dueAt` computável — não só os com `dueAt <= now`. Concretamente: `deriveMaintenanceDue()`
(função pura por worker, §2 abaixo) retorna `{ workerType, dueAtIso, tenantId, entityId } | undefined` — o
`undefined` significa "este item nunca vira candidato" (ex. `Requirement` sem `evidenceValidUntil`,
`Membership` ainda `ACTIVE`), nunca "ainda não venceu". Um `Membership` `REMOVED` há 2 dias (longe dos 30
exigidos) **recebe** o ponteiro com `GSI8SK = removedAt+30d` (no futuro) durante o backfill — só não aparece
nos resultados de uma `Query GSI8SK < now` até a data chegar, exatamente o comportamento correto de um índice
esparso ordenado por vencimento (mesmo padrão que `document-purge`/GSI6 já usa desde D-061, onde o ponteiro é
gravado no momento da transição, não no momento em que vence).

Critério de encerramento do backfill corrigido: o script varre a tabela inteira, computa
`deriveMaintenanceDue(item)` para cada item candidato ao TIPO daquele worker (usando o mesmo `entityType` de
filtro que o `Scan` atual já usa), e escreve o ponteiro sempre que o resultado não é `undefined` e o item ainda
não o tem. Termina reportando 0 itens do tipo elegível-ao-índice sem ponteiro — "elegível-ao-índice" agora
significa "tem `dueAt` determinável", não "já pode ser purgado".

## 2. `deriveMaintenanceDue()` — função pura nova, exportada, por worker (9 arquivos)

Cada worker ganha (ou já tem, promovida a exportada) uma função pura `deriveMaintenanceDue(candidate):
{ dueAtIso: string } | undefined`, usada por 3 consumidores idênticos — o writer da entidade (para gravar o
ponteiro na transição real), o script de backfill (§1), e o próprio candidate-source do worker (para validar
consistência em teste, nunca para decidir em runtime — GSI8 continua sendo só descoberta). Nenhum dos 9 é
inventado do zero — 6 já têm a lógica equivalente só não-exportada/privada:

| Worker | Estado hoje | Ação nesta rodada |
|---|---|---|
| `membership-purge`, `invitation-purge`, `quota-telemetry-purge`, `delivery-record-purge`, `core-user-data-purge`, `security-audit-purge` | já têm `isPurgeEligibleBy*(field, nowIso): boolean` exportada | vira `deriveMaintenanceDue` de fato — mesma fórmula, só devolve a data calculada em vez de um booleano comparado contra `now` (`cutoffMs` já é exatamente o valor certo, só não é retornado hoje) |
| `requirement-reindex` | decisão inline no loop (`reindex.ts:46-47`) | extrair `deriveMaintenanceDue(requirement)` retornando `{ dueAtIso: requirement.evidenceValidUntil }` quando presente, `undefined` caso contrário — puro, sem side-effect, testável isoladamente do loop |
| `document-file-reconciliation` | `deadlineFromGsi5Sk` privada (`reconciliation.ts`) | exportar como `deriveMaintenanceDue(candidate)`, mesma lógica, sem mudar assinatura de uso interno |
| `transient-purge` | `isEligibleByAge` privada, acopla contadores de resultado (`purge.ts:138-153`) | split em 2: `deriveMaintenanceDue(candidate)` pura nova (sem side-effect no `result`) + o wrapper privado atual continua existindo só para incrementar os contadores de resultado no loop principal, chamando a nova função pura por baixo |

Cada extração é nível 2-3 (`change-risk-scale.md`) — refactor local reversível, sem mudar comportamento
observável do worker (mesmo `npm test` continua verde, sem regressão) — cabe dentro desta decisão de design,
não reabre protocolo por worker.

## 3. IAM completo, incluindo a lacuna real de `TransactWriteItems`

Aceito sem ressalva: `tenant_facing_read_write` (`main.tf`, achado confirmado) concede `GetItem`/`PutItem`/
`UpdateItem`/`DeleteItem`/`ConditionCheckItem`, mas não `TransactWriteItems`. Lista completa e explícita por
role de worker (9 roles, uma política adicional cada, anexada à role Lambda já existente):

- `dynamodb:Query` no ARN do índice GSI8, condicionado `ForAllValues:StringEquals` `LeadingKeys IN
  ["WORK#<type>", "DLQ#<type>"]` (achado #7 da Rodada 2/3, já decidido).
- `dynamodb:TransactWriteItems` na tabela base — **ação nova, não coberta pela política geral hoje**,
  adicionada explicitamente à política do worker (não à política geral tenant-facing — permanece escopada,
  mesma disciplina de nunca alargar a política geral para uma capacidade que só alguns callers precisam).
- `dynamodb:GetItem`/`UpdateItem` — já cobertos por `tenant_facing_read_write`, sem mudança (a Rodada 3 acertou
  isso, só errou ao estender a mesma alegação a `TransactWriteItems`).
- Permissões do script de backfill/redrive: papel operacional **separado** (mesmo padrão de
  `reset-dev-data.ts`, que já roda com credencial própria via `--profile claude-dev`, nunca a role de produção
  do worker) — `Scan`+`UpdateItem` na tabela base, sem acesso a GSI3/GSI4/GSI6 (nenhuma necessidade), aplicado
  manualmente por sessão, nunca uma role Lambda permanente.

`infra/tests/stack.tftest.hcl` ganha os 9 casos de isolamento (já decidido) **mais** um caso novo confirmando
que a política do worker inclui `TransactWriteItems` só na tabela base, nunca em GSI3/GSI4/GSI6 (reforça o
isolamento existente, não abre exceção nova).

## 4. Idempotência do backoff — reaproveita o padrão de claim já existente no projeto, não um mecanismo novo

Achado aceito: recalcular a partir do contador persistido pode duplicar avanço em retry de resposta perdida.
Correção: o valor-alvo do backoff é computado **uma única vez**, a partir do `maintenanceAttemptCount`
observado no momento da `Query` (não re-lido depois) — a atualização condicional usa esse valor observado como
parte da `ConditionExpression` (`maintenanceAttemptCount = :observedCount`), e o **resultado da tentativa
condicional em si** é a fonte de verdade sobre se já foi aplicado:

- Sucesso → aplicado, segue para o próximo candidato.
- `ConditionalCheckFailedException` → **alguém já mudou o contador** (o próprio retry anterior teve sucesso,
  ou outra invocação concorrente já processou) — tratado como no-op idempotente, nunca recalculado com um
  valor novo. O worker não tenta adivinhar se foi "ele mesmo" ou "outro" — não precisa, porque o efeito
  desejado (contador avançado, `GSI8SK` reposicionado) já está garantido por quem venceu a condição.

Isso é exatamente o mesmo formato de "tentativa condicionada a estado observado, falha condicional tratada
como já resolvido" que `membership-purge/purge.ts` já usa para o delete em si (`isConditionalCheckFailed` →
`skippedConcurrentlyModified`, nunca retry com dado recalculado) — reaproveita um padrão já convergido no
projeto, não introduz um segundo mecanismo (token/UUID) como a Rodada 3 cogitou. Redrive da quarentena:
operação manual, mas agora especificada — script separado (mesma classe de credencial do backfill, §3),
`ConditionExpression` exige `GSI8PK = "DLQ#<type>"` observado, grava `GSI8PK = "WORK#<type>"` +
`maintenanceAttemptCount = 0` + `GSI8SK` recalculado via `deriveMaintenanceDue()` (§2) a partir do estado
ATUAL do item base (nunca do estado no momento da quarentena) — mesma disciplina de revalidação do achado #6
das rodadas anteriores.

## 5. Gatilho de shard: métrica sobe pelo handler, não pelo worker; métrica primária é backlog, não throttle

Achado aceito integralmente: workers são deliberadamente observability-agnostic (`AGENTS.md` §7, D-007) — um
worker emitindo EMF/`console.log` diretamente violaria essa fronteira e a regra `no-console`. Correção:

- O worker continua só **retornando** contagens no objeto de resultado (mesmo padrão de
  `MembershipPurgeResult`/`TransientPurgeResult` já existentes) — ganha 2 campos novos:
  `quarantinedCount` e `oldestCandidateAgeSeconds` (idade do candidato mais antigo devolvido pela `Query`
  GSI8, calculável a partir do `GSI8SK` já lido, sem I/O extra).
- O **handler** (`src/runtime/aws/handlers/`, o único lugar com acesso a observability concreta,
  `AGENTS.md` §7) lê esse resultado e emite as métricas EMF (`SecureLogger`/estrutura já usada por todo
  handler real do projeto) — nenhuma mudança de camada, só aplicação da regra que já existia.
- **Métrica primária do gatilho de shard passa a ser `oldestCandidateAgeSeconds`** (aceito o achado de que o
  `catch` de throttle não captura retry interno do SDK bem-sucedido — descartado como sinal primário).
  Threshold concreto: alarme dispara se `oldestCandidateAgeSeconds` exceder o SLA de retenção do próprio
  worker (ex. `security-audit-purge`: candidato mais antigo já deveria ter sido purgado há mais de 24h) por 3
  períodos consecutivos de avaliação de 15 minutos (mesma forma de alarme CloudWatch — período + datapoints —
  já usada em `infra/modules/*/main.tf` para os alarmes existentes do projeto, não um formato novo). Métrica
  nativa `ThrottledRequests` da tabela+GSI8 (existe de verdade, mas sem granularidade por namespace) entra
  como **sinal corroborante secundário** no runbook, não como gatilho — confirma que o alarme de backlog
  provavelmente é causado por contenção de capacidade, não por outro motivo (ex. bug lógico gerando poison
  records em massa).

## O que permanece explicitamente como trabalho de implementação (não bloqueia aprovação do design)

Números reais de custo (RCU/WCU por worker) só vêm de medição contra `dev`; a extração das 3 funções privadas
do §2 é refactor mecânico, verificável por teste, não decisão; o script de backfill/redrive em si não foi
escrito (a função que ele chama, sim, está especificada). Nenhum destes muda a resposta a nenhum achado
bloqueante — são a fatia de implementação que naturalmente segue a aprovação do design.

## Autoavaliação Claude (nota cega, registrada antes de ver a crítica da Rodada 4 do Codex)

**9,2/10.** Os 5 achados da Rodada 3 (todos classificados pelo próprio Codex como "de design, não
implementação") receberam decisão concreta reaproveitando padrões já convergidos no projeto (claim
condicional idempotente = mesmo formato do delete OCC já usado; observability subindo ao handler = regra já
existente, só não aplicada; IAM enumerado por completo, incluindo a lacuna real de `TransactWriteItems`;
backfill corrigido para cobrir vencimento futuro, não só passado). Não é mais alto porque: (a) a extração das
3 funções privadas (§2) ainda não foi feita nem testada — é uma promessa de refactor mecânico verificável, não
uma verificação; (b) o formato exato do alarme (`período=15min`, `datapoints=3`) é proposto por analogia com
alarmes existentes, não validado linha a linha contra um `main.tf` real de algum desses workers nesta rodada.
