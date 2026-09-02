# MaintenanceDueIndex — Rodada 3 (crítica Codex)

Invocação real: `codex exec --skip-git-repo-check - < codex-round3-prompt.txt` (background, nota cega). Saída
completa arquivada localmente (não versionada); resumo fiel abaixo.

**NOTA: 8.3/10 — ainda não aprova (gate exige ≥9,0/≥9,0 sem arredondar), mas confirma correção genuína.**

## Correções factuais da Rodada 3, todas confirmadas linha a linha pelo Codex

`requirement-reindex` (`reindex.ts:46-47`), `quota-telemetry-purge` (`purge.ts:53-55`),
`EphemeralTelemetryMutation` no union (`candidate-source.ts:40`), `delivery-record-purge` (`purge.ts:66-68`),
`transient-purge` (`WebhookInbox.createdAt+7d`, `UploadSlot` via `computeUploadSlotPurgeAfter`),
`core-user-data-purge` (`ExpirationItem`/`ReminderPolicy`, `deletedAt+30d`), e a leitura de
`scripts/reset-dev-data.ts` (só apaga, nunca recria) — "todas corretas", contagem de 9 workers "volta a ser
internamente coerente".

## Achados ainda bloqueantes (5, todos de design, não de implementação)

1. **O backfill cobre o conjunto errado.** Escrever o ponteiro só para itens JÁ elegíveis hoje significa que
   registros pré-existentes com vencimento **futuro** (ex. `deletedAt` recente, ainda não +30d) nunca recebem
   ponteiro — o backfill termina "limpo" (0 itens elegíveis sem ponteiro) mas esses registros somem
   permanentemente do GSI8 quando a data chegar, porque nenhuma mutação nova necessariamente os toca. O
   backfill precisa escrever o ponteiro em todo item que **deveria ter** um `dueAt` computável, não só nos já
   vencidos.
2. **A alegação de reusar "a mesma função já exportada" não vale para os 9 workers.** `requirement-reindex`
   decide inline no loop; `document-file-reconciliation` tem `deadlineFromGsi5Sk` privada;
   `transient-purge`'s `isEligibleByAge` é privada e acopla contadores de resultado. Plausível, mas exige
   extrair/exportar uma função pura nova por worker (`deriveMaintenanceDue`), não reuso direto como escrito.
3. **IAM incompleto/factualmente incorreto**: a política geral `tenant_facing_read_write` concede
   `GetItem`/`PutItem`/`UpdateItem`/`DeleteItem`/`ConditionCheckItem`, mas **não** `TransactWriteItems` — a
   Rodada 3 alegou "nenhuma mudança aqui" quando a correção #4 (revalidação transacional) exige exatamente
   essa ação nova. Falta enumerar completamente: `Query` GSI8, `GetItem`, `TransactWriteItems`,
   `UpdateItem` (backoff/quarentena/redrive se não-transacional), permissões do script de backfill/redrive
   (distintas da role do worker).
4. **Idempotência do backoff ainda não demonstrada.** Recalcular o próximo backoff a partir do contador
   persistido em cada retry pode incrementar 2x se a resposta da 1ª tentativa se perdeu — precisa de uma
   identidade estável de tentativa ou reapresentar exatamente o mesmo alvo calculado na tentativa original,
   tratando falha condicional como reconciliação (não recálculo).
5. **Gatilho de shard parcialmente definido**: `catch` de exceção não observa throttling absorvido por retry
   interno do SDK; faltam threshold/janela concretos; e emitir métrica dentro do worker viola a arquitetura
   vigente (workers puros observability-agnostic, `AGENTS.md` §7 — emissão deveria subir ao handler).

## Pontos suficientemente resolvidos (citação direta)

"A revalidação por `ConditionCheck(TenantLifecycleRecord.status = ACTIVE)` na mesma `TransactWriteItems` do
delete/update fecha corretamente o TOCTOU"; "A análise de custo de `KEYS_ONLY` agora é honesta"; "A
continuação após falha individual está coerente"; "A quarentena por namespace separado... é direção adequada";
"O esquema de dual-read durante resharding é conceitualmente correto".

## Veredito

"A arquitetura central — GSI8 esparso, `KEYS_ONLY`, namespace por worker, revalidação transacional e
quarentena — está sólida." Não aprovado ainda porque o backfill "pode perder permanentemente registros
preexistentes com vencimento futuro", a afirmação IAM está factualmente incorreta, e a idempotência do backoff
ambíguo é insuficiente — "pontos de design, precisam ser corrigidos antes de serem relegados à implementação."
