---
status: approved
owner: Marcelo
authority: revisão de código (AGENTS.md §4, nível 5 — agregado/GSI/outbox destination novos)
---

# WhatsApp digest (D-347 §3.5) — revisão de código Claude↔Codex

Implementação da segunda metade do mecanismo de proteção de margem do WhatsApp autorizado por
Marcelo em 2026-09-27 (a primeira metade, orçamento de custo real de IA/OCR, já convergiu no
commit c0ff1426). Consolida `NotificationIntent`s WHATSAPP não-urgentes em no máximo 1
mensagem/destinatário/dia via um novo agregado `DigestEntry` na camada de entrega, reativando o
desenho já aprovado em `docs/architecture/roadmap-evolution/07-domain-model-escalation-watchers-digest.md`.

**Nota final: Claude 9,2/10 — Codex 9,1/10 — gate ≥9,0 atingido por ambos, sem arredondar (protocolo
de nota cega: cada nota registrada antes de ver a do outro).**

## Processo

5 rodadas reais do protocolo Claude↔Codex (AGENTS.md §4), cada uma corrigindo achados verificados
com teste de regressão antes de reenviar:

- **Rodada 1 (4,0/10)**: implementação inicial (`DigestEntry` com apenas 2 estados OPEN/FLUSHED,
  sem lease) tinha achados reais bloqueantes: permissão IAM `GetItem` ausente no worker GSI8 novo
  (e em todo worker GSI8 pré-existente — gap retroativamente corrigido na policy compartilhada);
  reentrega SQS enviava a mesma mensagem duas vezes (sem admissão/lease); item excluído do
  conteúdo ainda recebia status ACCEPTED; lista de itens sem teto (risco real do limite de 400KB
  do DynamoDB); sem correlação de webhook (`NotificationAttemptLookup`); kill switch e fence de
  tenant DELETING bypassados; sem TTL/retenção.
- **Rodada 2 (6,0/10)**: máquina de estado `OPEN→FLUSHED→SENDING→SENT|FAILED|UNKNOWN` com lease
  introduzida, mas o guard de attempt só aceitava `DIGESTED` (retry bem-sucedido ficava preso em
  `FAILED_RETRYABLE`); crash entre resolver a entry e marcar os attempts perdia o rastro
  (`DigestEntry.resolution` introduzido para tornar isso retomável); `SKIPPED_IN_PROGRESS` não
  forçava reentrega; propagação para attempts irmãos dependia da precedência do representante;
  falha transitória de AppConfig descartava o lote inteiro; conflito de transação
  (`TransactionConflict`, distinto de `ConditionalCheckFailed`) no `DigestEntry` compartilhado do
  router não era capturado; schema JSON e quiet hours endereçados como residuais.
- **Rodada 3 (8,0/10)**: os catches de `finalizeEntry`/`markAttemptsForRefs` engoliam QUALQUER
  `TransactionCanceledException` como se fosse um `ConditionalCheckFailed` comprovado — um
  `TransactionConflict` genuíno não prova que a escrita foi feita por outra parte, e era tratado
  como sucesso silencioso. Corrigido com `isProvenConditionalCheckFailure()`.
- **Rodada 4 (8,7/10)**: o lease padrão (300s) podia sobreviver ao orçamento real de reentrega da
  fila (60s de visibilidade × `maxReceiveCount=5` ≈ 300s até a DLQ) — a mensagem podia esgotar
  todas as tentativas do SQS e cair na DLQ com a entry ainda presa em `SENDING`, sem caminho
  automático de reconciliação. Lease reduzido para 90s.
- **Rodada 5 (Codex 9,1/10, Claude 9,2/10)**: aprovado. Ressalva não bloqueante registrada:
  mudanças futuras na configuração da fila (`infra/main.tf`) exigem revisitar também o lease em
  `delivery.ts` e seu teste dedicado, não só o comentário.

## Residuais explícitos, fora do escopo desta revisão

- `notification-router-handler.ts` usa `record.eventID` em vez de
  `record.dynamodb.SequenceNumber` como `itemIdentifier` de `ReportBatchItemFailures` — bug
  pré-existente (antecede esta feature), confirmado por ambos os revisores, não corrigido aqui.
- Um crash exatamente entre o envio externo bem-sucedido e a escrita da resolução pode, em teoria,
  terminar como `UNKNOWN` em vez de `SENT` (perda de informação, nunca de segurança — `UNKNOWN` já
  é o mesmo estado terminal seguro que o caminho de falha AMBIGUOUS usa) — aceito explicitamente
  como troca razoável por ambos os revisores, sem retry embutido em `finalizeEntry()`.

## Evidência

`npm run typecheck`/`lint`/`check-boundaries`/`validate-schemas`/`check-docs` verdes; `npm test` =
265 arquivos / 3225 testes verdes; `npm run build:lambdas` gerou os 2 handlers novos;
`terraform validate` + `AWS_PROFILE=claude-dev terraform test` = 29/29 verdes. Todos rodados de
verdade a cada rodada de correção, não assumidos.

DoD: item=whatsapp-digest-delivery (D-347 §3.5); risco=nível 5 (agregado DigestEntry novo, namespace
GSI8 novo, outbox destination novo, fila SQS nova); evidência=protocolo Claude↔Codex 5 rodadas,
Claude 9,2/Codex 9,1 finais, `npm test` 265/3225 verde, `terraform test` 29/29 verde;
lacunas=bug pré-existente de `SequenceNumber` em `notification-router-handler.ts` (fora de escopo,
confirmado por ambos os revisores).
