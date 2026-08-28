# W3-06 — Round 2 (Claude tréplica, respondendo à crítica adversarial do Codex Rodada 1, nota 5,8/10)

> Rodada 1 completa em `claude-proposal-round1.md` / `codex-round1-critique.md` (achados
> bloqueantes 1-7 abaixo, colados no rodapé para referência). Esta rodada revisa o mecanismo
> resolvendo cada achado bloqueante individualmente, reusando um padrão **já provado no próprio
> repositório** (`GSI6PK_WORKSTATE_CLAIMED`/lease em `reminder-materializer.ts`/
> `dynamodb-reconciliation-candidate-source.ts`) em vez de inventar um mecanismo de claim novo.

## Resolução achado 1 — corrida TOCTOU S3-antes-de-DynamoDB

Adotado o mesmo idioma de **claim por lease** que `ReminderReconciliation` já usa para
`WORKSTATE#DST_PENDING → WORKSTATE#CLAIMED` (`reminder-materializer.ts:163-174`,
`dynamodb-reconciliation-candidate-source.ts:55-76`), não um estado novo em `DocumentStatus`:

1. `GSI6PK_PURGE_PENDING = "WORKSTATE#PURGE_PENDING"` (candidato elegível) e
   `GSI6PK_PURGE_CLAIMED = "WORKSTATE#PURGE_CLAIMED"` (em processamento, com lease).
2. Worker lê um lote de `WORKSTATE#PURGE_PENDING` com `GSI6SK < now`. Para cada candidato, tenta
   um `TransactWriteItems` de **claim**: `Update` condicionado a
   `version = :expectedVersion AND attribute_not_exists(legalHold) OR legalHold = :false`
   (ver achado 3), movendo `GSI6PK/GSI6SK` para `WORKSTATE#PURGE_CLAIMED` com
   `GSI6SK = <claimExpiresAt>#TENANT#t#DOCUMENT#d` (`claimExpiresAt = now + 15min`) e
   incrementando `version`. **Este `Update` condicional É o fence atômico** — se a condição
   falhar (documento mudou de versão, foi restaurado, ganhou `legalHold`, ou já foi claimado por
   outra invocação concorrente), o `TransactWriteItems` inteiro falha e o worker pula o
   candidato sem tocar S3. Só depois de um claim bem-sucedido o worker chama
   `deleteObjectVersion` em `quarantineObject`/`cleanObject`.
3. **Reconciliação de lease órfão**: segunda query, mesmo idioma de
   `GSI6PK_WORKSTATE_CLAIMED`/`before` em `dynamodb-reconciliation-candidate-source.ts:35-48` —
   `WORKSTATE#PURGE_CLAIMED` com `GSI6SK < now` (lease expirado) devolve o candidato para
   `WORKSTATE#PURGE_PENDING` (novo `version`, mesma condição de fence), permitindo reclaim por
   uma execução seguinte se o worker morreu no meio. Isso é literalmente o mesmo "claimed
   reconciliation" que `ReminderReconciliation` já roda produtivamente — zero mecanismo novo.
4. Após S3 confirmado (ambas chamadas de `deleteObjectVersion` retornam, sucesso ou "já ausente"
   — idempotente por natureza da API), `TransactWriteItems` final: `Delete` da linha `Document` +
   `Put` do `DocumentPurgeReceipt` (achado 7) na mesma transação, condicionado a
   `GSI6PK = WORKSTATE#PURGE_CLAIMED AND version = :claimedVersion` (garante que ninguém reabriu
   o claim entre o delete de S3 e este passo).

Duas invocações concorrentes: a segunda falha no passo 2 (condição de `version`/estado já mudou
pela primeira) — nunca as duas chamam `deleteObjectVersion` para o mesmo documento.

## Resolução achado 3 — `legalHold`

`Document` ganha `legalHold?: boolean` (default ausente = false), mesmo espírito do
`legalHold` de `privacy-lgpd.md` §3/§4 mas com escopo mínimo: **não** implementa o workflow
completo de aprovação/`reviewAt` de hold (isso é produto/feature maior, fora de W3-06) — só o
campo booleano que qualquer processo futuro de hold (manual, via suporte, ou DSR) pode setar, e
que o claim do purge (achado 1, passo 2) **sempre** verifica antes de prosseguir. Nenhuma rota
HTTP nova para setar `legalHold` nesta decisão — como nada no sistema hoje o seta, o efeito
prático imediato é idêntico ao desenho anterior (nunca bloqueia), mas o mecanismo de purga já
nasce respeitando-o, então uma feature de hold futura (fora de escopo) não precisa reabrir este
protocolo Type 1 para plugar a checagem — só popular o campo.

## Resolução achado 2 — lifecycle S3 incondicional era inseguro

**Removido.** Concordo com a crítica: um `expiration.days` de bucket inteiro não sabe distinguir
documento ativo de excluído, e o prazo real (evento variável + 30 dias) não é expressável nesse
mecanismo — diferente de `EXTRACTION_TRANSIENT`, que tem prazo fixo desde a criação.
**Rede de segurança revisada, não destrutiva**: um alarme CloudWatch (mesmo padrão de
`security-audit.ts`/alarmes já existentes no projeto) sobre a **idade do candidato mais antigo**
em `WORKSTATE#PURGE_PENDING`/`WORKSTATE#PURGE_CLAIMED` (métrica customizada publicada pelo próprio
`DocumentPurgeWorker` a cada execução, ex.: `oldest_purge_pending_age_seconds`) — dispara se um
candidato ficar pendente por mais que, digamos, 3 dias (10x a cadência de 6h), sinalizando falha
sistêmica do worker para intervenção humana, sem nunca apagar nada automaticamente por tempo.
Divergência deliberada do padrão `EXTRACTION_TRANSIENT` (registrada explicitamente, não um
descuido): lá a rede de segurança é ativa (lifecycle apaga), aqui é passiva (alarme avisa) —
porque só aqui apagar por tempo-desde-criação arriscaria dado ativo.

## Resolução achado 4 — IAM

- `dynamodb:TransactWriteItems` (não `DeleteItem` isolado) na tabela base, resource = table ARN
  (nunca o índice — mesma regra de `tenant_facing_read_write`), escopado só à role do
  `DocumentPurgeWorker`.
- `s3:DeleteObjectVersion` (não `s3:DeleteObject`/`s3:GetObject`) nos ARNs de objeto de
  `quarantine`/`clean` (`module.document_buckets.quarantine_bucket_arn`/`clean_bucket_arn`, mesmo
  padrão de `main.tf:993` citado pelo Codex), escopado só a esta role — nenhuma permissão de
  leitura de conteúdo.
- `gsi6_read_policy_json` como quarta role — atualizar **todos** os comentários
  "EXACTLY TWO"/"EXACTLY THREE" em `dynamo-table/main.tf:223-226` e `main.tf:36,187,263` para
  "EXACTLY FOUR", listando as quatro roles nos dois lugares (achado não-bloqueante do Codex,
  resolvido junto).

## Resolução achado 5 — TTL nativo

**Removido da proposta.** `purgeAfterTtl` (atributo TTL real da tabela,
`dynamo-table/main.tf:147-150`) não é tocado por `Document` nesta decisão — confirmado que
populá-lo criaria exatamente a corrida que o Codex descreveu (TTL podendo remover a linha antes
da confirmação de purge S3, órfando o objeto e destruindo o próprio ponteiro GSI6 que o
localizaria). Fica registrado como não-objetivo desta decisão, não como "rede de segurança
opcional" como a Rodada 1 sugeria.

## Resolução achado 6 — reentrância/concorrência (tabela de casos)

| Cenário | Comportamento |
|---|---|
| Crash após apagar `quarantineObject`, antes de `cleanObject` | Lease expira, candidato retorna a `PENDING`, reclaim reprocessa; `deleteObjectVersion` no `quarantineObject` já ausente não lança (API S3) |
| Duas invocações concorrentes | Segunda falha no `Update` condicional de claim (achado 1 passo 2), nunca toca S3 |
| `legalHold` setado entre leitura e claim | Condição do claim falha, candidato nunca perde o pointer `PENDING`, permanece elegível só quando `legalHold` voltar a false |
| Erro permanente de S3 (ex.: acesso negado após mudança de IAM) | Claim já feito mas delete falha — lease expira, reconciliação devolve a `PENDING`; se reincide N vezes, alarme de idade de candidato (achado 2) dispara antes de virar um problema silencioso |
| Linha removida por TTL antes do purge | Não aplicável — TTL removido do escopo (achado 5) |
| `DeleteItem` final perdido por outro worker após ambos apagarem S3 | Impossível por construção — o passo final é a mesma transação que também apaga a linha; não há segundo worker com claim válido simultâneo (achado 1) |
| Paginação / limite por execução | Worker processa até N candidatos por invocação (proposto: 25, mesmo teto de `TransactWriteItems`/lote razoável para Lambda), usa `LastEvaluatedKey` do GSI6 Query para continuar na próxima invocação agendada — nunca processa a partição inteira de uma vez |

## Resolução achado 7 — evidência auditável

Novo `DocumentPurgeReceipt` (não sensível, sem conteúdo do documento):
`PK=TENANT#t#PURGERECEIPT#documentId`, `SK=META`, campos `tenantId`, `documentId`, `itemId`,
`retentionClassPurged: "USER_DOCUMENT"`, `deletedAtOriginal` (o `deletedAt` do soft-delete),
`purgedAt` (agora), `correlationId` (do contexto de execução do worker, `observability/context.ts`).
Escrito na mesma `TransactWriteItems` final que apaga a linha `Document` (achado 1, passo 4) —
nunca em uma escrita separada que poderia se perder entre as duas. Prazo de retenção do próprio
recibo: fora de escopo desta decisão (registrar como pendência textual, não implementar agora —
`principles.md` #1); sugestão não vinculante de follow-up: mesma classe `DELIVERY_RECORD`
(criação + 180 dias) já usada para `intents/attempts`, por analogia de propósito (prova de
processo, não dado de terceiro).

## Escopo confirmado nesta rodada (sem mudança)

§5 da Rodada 1 (reuso futuro por W3-07) e §6 (scan geral rejeitado) continuam válidos.
Correção de uma inconsistência apontada pelo Codex: `buildDocumentPurgeGsi6Sk` fica
**específico de `Document`** nesta decisão (sem parâmetro `entityType` genérico) — generalizar é
trabalho de W3-07 quando os requisitos reais da cascata existirem, não uma abstração especulativa
agora.

## Pergunta para Rodada B (Codex)

Este desenho resolve os 7 achados bloqueantes reescrevendo o mecanismo de claim para reusar o
idioma `PENDING/CLAIMED` já provado do `ReminderReconciliation`. Pontos que pedem verificação
adversarial específica: (a) o `Update` condicional de claim descrito no achado 1 é suficiente
sozinho como fence, ou falta alguma condição adicional (ex.: `attribute_exists` do próprio
`Document`, para o caso de a linha já ter sido apagada por uma corrida anterior que este desenho
não previu)? (b) o teto de 3 dias para o alarme de idade de candidato é razoável dado o prazo de
30 dias, ou baixo/alto demais? (c) alguma classe de bug que os 3 workers de reconciliação
existentes já tiveram e que ainda não foi endereçada aqui?
