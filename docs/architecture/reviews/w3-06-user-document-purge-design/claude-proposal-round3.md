# W3-06 — Round 3 (Claude tréplica, respondendo à Rodada 2 do Codex, nota 7,4/10, 5 achados bloqueantes)

## Resolução achado 2 (novo, Rodada 2) — referência S3 errada

Confirmado contra o código real (`document-service.ts:149`, `advance-after-evidence.ts:63-144`):
`quarantineObject.versionId` é **sempre `""`** — nunca atualizado após a reserva. A referência
real e imutável é `doc.uploadEvidence?.object ?? doc.malwareEvidence?.object`
("`knownObject`", exatamente o padrão que `advanceAfterEvidence` já usa). Além disso, o código
real já revela que **o objeto de quarantine já é removido best-effort na promoção para CLEAN**
(`advance-after-evidence.ts:139-144`, com o bucket de quarantine tendo sua própria lifecycle rule
de 24h como backstop — confirmar existência dessa lifecycle na implementação, item novo abaixo).
Isso simplifica o mecanismo de purga por status:

| `doc.status` no momento da exclusão lógica | O que existe fisicamente em S3 | Ação do purge worker |
|---|---|---|
| `CLEAN` | Só `cleanObject` (quarantine já removido na promoção, best-effort + lifecycle 24h de backstop) | `deleteObjectVersion(doc.cleanObject)` |
| `REJECTED` / `UNSUPPORTED` | Só o objeto de quarantine, referência real em `knownObject` (se existir) | `deleteObjectVersion(knownObject)` se `knownObject` existir; nada se `undefined` (nunca chegou evidência) |
| `PENDING_UPLOAD` / `SCANNING` / `TIMEOUT` sem nenhuma evidência ainda | Possível upload parcial órfão, sem referência confiável de versão | Nada a apagar por versão explícita — coberto só pela lifecycle 24h de quarantine já existente (mesmo backstop de qualquer upload nunca finalizado) |

Nunca usar `doc.quarantineObject` diretamente para deletar. IAM revisado: `s3:DeleteObjectVersion`
no bucket `clean` sempre necessário; no bucket `quarantine` só para o caminho REJECTED/UNSUPPORTED
(mesma ação, resource inclui os dois ARNs de objeto, sem `GetObject`).

**Verificação adicional (achado não-bloqueante da Rodada 2, resolvido aqui):** confirmar a
lifecycle de 24h do bucket quarantine citada nos comentários do código
(`advance-after-evidence.ts:137`) — `infra/modules/document-buckets/main.tf` deve ser lido na
implementação para confirmar que essa regra realmente existe (o comentário do código a assume,
mas este design não deve presumir sem checar o Terraform real antes de implementar).

## Resolução achado 1 (novo, Rodada 2) — hold aplicado depois do claim

Aceito que um handshake completo de hold é over-engineering para um campo que hoje não tem
NENHUM escritor real no sistema (`legalHold` nasce nesta decisão, nenhuma rota HTTP o seta).
Fechamento proporcional ao risco real, não ao risco teórico máximo:

1. O claim (achado 1 da Rodada 1) continua checando `legalHold` no momento do claim.
2. **Novo**: imediatamente antes de cada chamada `deleteObjectVersion`, o worker faz uma leitura
   fresca e não-transacional do `Document` (`store.get`) e aborta a exclusão (libera o claim
   voltando para `PENDING` numa transação separada) se `legalHold === true` nessa releitura —
   reduz a janela de exposição do lease inteiro (15min) para o round-trip de uma leitura (dezenas
   de ms), sem exigir que um setter de hold futuro conheça o protocolo de purge.
3. Residual aceito e registrado por escrito (não escondido): entre essa releitura e a chamada real
   de `deleteObjectVersion` ainda existe uma janela sub-segundo onde um hold aplicado
   simultaneamente não seria pego. Fechar esse resíduo exigiria um lock distribuído ou um segundo
   sistema conhecendo o protocolo de purge — desproporcional a um campo sem nenhum escritor real
   hoje. **Pendência textual explícita**: quando W3-07 ou qualquer feature de hold implementar um
   setter real de `legalHold`, esse setter deve ele mesmo verificar `GSI6PK ≠ WORKSTATE#PURGE_CLAIMED`
   antes de aceitar a mudança (ou aceitar o hold e deixar o purge log/alarme de uma exclusão que
   já ocorreu sob hold recém-aplicado) — decisão que pertence a essa feature futura, não a esta.

## Resolução achado 3 — condição de claim subespecificada/precedência de operador

Condição corrigida e completa (parenteses explícitos, todas as invariantes nomeadas pelo Codex),
implementada como extensão aditiva de `buildVersionedUpdate` (`occ.ts`) — novo campo opcional
`extraCondition?: string` (concatenado como `AND (${extraCondition})` à condição já existente,
retrocompatível, usado hoje só por este worker):

```
attribute_exists(PK) AND attribute_exists(SK)
  AND #version = :expectedVersion AND #tenantId = :tenantId   -- já provido por buildVersionedUpdate
  AND (attribute_not_exists(legalHold) OR legalHold = :false)  -- extraCondition
  AND #status = :deleted
  AND GSI6PK = :purgePending
  AND GSI6SK = :expectedGsi6Sk
  AND purgeAfter <= :now
```

`#status`/`:deleted`/`GSI6PK`/`:purgePending`/`GSI6SK`/`:expectedGsi6Sk`/`purgeAfter`/`:now` viram
mais entradas em `extraCondition` (não em `set`, que já é usado para os campos que **mudam**:
`GSI6PK → WORKSTATE#PURGE_CLAIMED`, `GSI6SK → <claimExpiresAt>#...`, `purgeClaimedAt`). Todas as
oito condições precisam ser verdadeiras para o claim suceder — qualquer uma falsa (versão mudou,
já foi restaurado, `legalHold` setado, `GSI6SK` não é mais o esperado por causa de reconciliação
concorrente, `purgeAfter` ainda no futuro por relógio divergente) aborta o claim inteiro sem tocar
S3, exatamente como a Rodada 2 pretendia mas não formalizava.

## Resolução achado 4 — máquina de lease/paginação/retry incompleta

Simplificação aceita explicitamente na crítica do Codex ("pode ser correto e mais simples"):
**sem cursor entre invocações**. Cada execução agendada consulta até 25 candidatos de
`WORKSTATE#PURGE_PENDING` (`GSI6SK < now`) do zero — se houver mais de 25 elegíveis, o excedente
é naturalmente pego pela próxima execução (cadência 6h, prazo de negócio 30 dias — folga de
~120x). Reconciliação de lease (segunda query, `WORKSTATE#PURGE_CLAIMED` com `GSI6SK < now`) roda
na mesma invocação, também sem cursor, mesmo teto de 25.

- **Lease vs. timeout de Lambda**: lease de 15min deve ser configurada para exceder o timeout real
  configurado do handler (a definir na implementação, ex.: timeout 5min ⇒ lease 15min dá 3x de
  margem) — nunca o inverso. Sem heartbeat: a lease só precisa sobreviver a uma invocação, que faz
  no máximo duas chamadas S3 + duas transações DynamoDB por candidato, ordem de segundos, não
  minutos.
- **Retry/terminal**: contador `purgeAttempts` (novo campo em `Document`, incrementado no `set`
  do claim). Falha durante o delete S3 (exceção não relacionada a "objeto já ausente"): claim
  simplesmente expira (sem `catch` especial) e o próximo ciclo de reconciliação devolve a
  `PENDING`, reincrementando `purgeAttempts` no próximo claim. Ao atingir `purgeAttempts >= 5`
  sem sucesso, o worker **para de reclaimar automaticamente** esse candidato (condição adicional
  no reconciliador: `purgeAttempts < 5`) e publica uma métrica dedicada
  (`document_purge_stuck_total`, dimensionada por `tenantId`) distinta do alarme de idade de fila
  — equivalente funcional de uma DLQ, já que este worker é acionado por `EventBridge Scheduler`
  (poll), não por fila SQS (não há DLQ nativa a reusar aqui).
- **Referência S3 parcialmente inválida** (ex.: só uma das duas chamadas necessárias tem
  referência real): não se aplica mais depois do achado 2 — cada `status` tem no máximo **uma**
  chamada S3 real a fazer (tabela do achado 2), nunca duas condicionais incertas.
- **Alarme separado por partição**: a métrica de idade de candidato mais antigo (achado 2 da
  Rodada 1) publica duas séries, `oldest_purge_pending_age_seconds` e
  `oldest_purge_claimed_age_seconds` — cobre tanto "worker não está rodando" quanto "worker está
  rodando mas travando no claim".

## Resolução achado 5 — retenção indefinida do `DocumentPurgeReceipt`

Classe e prazo concretos, definidos agora (não adiados): `DocumentPurgeReceipt` recebe
`retentionClass: "DELIVERY_RECORD"` (reuso da classe já existente em `privacy-lgpd.md` §4,
"criação + 180 dias" — mesmo propósito, prova de processo, não dado de terceiro) e
`purgeAfter = purgedAt + 180 dias` (nova função `computeDeliveryRecordPurgeAfter`, mesmo padrão de
`computeUserDocumentPurgeAfter`). O próprio `DocumentPurgeReceipt` ganha, na mesma
`TransactWriteItems` que o cria, seu **próprio** ponteiro `GSI6PK = WORKSTATE#PURGE_PENDING` —
reusando o mesmíssimo `DocumentPurgeWorker` para se auto-purgar 180 dias depois (só `DeleteItem`
da própria linha do recibo, sem S3 envolvido). Fecha o ciclo sem inventar um segundo worker: a
generalização mínima necessária é o worker aceitar candidatos que não têm `cleanObject`/
`quarantineObject` (recibo) e pular a etapa de S3 nesse caso — não uma generalização por
`entityType` arbitrário (isso continua reservado para W3-07, §5 da Rodada 1).

## Estado do design após Rodada 3

Todos os 5 achados bloqueantes da Rodada 2 (achados 1/2 novos + 1/6/7 parcialmente abertos da
Rodada 1) têm resolução concreta acima. Peço reavaliação completa — se algum destes ainda não
fechar para 9.0+, preciso do apontamento exato do que falta, não uma repetição do achado anterior.
