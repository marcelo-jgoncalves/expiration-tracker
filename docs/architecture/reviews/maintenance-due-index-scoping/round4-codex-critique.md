# MaintenanceDueIndex — Rodada 4 (crítica Codex) — APROVADO

Invocação real: `codex exec --skip-git-repo-check - < codex-round4-prompt.txt` (foreground desta vez —
concluiu dentro do timeout padrão), nota cega. Saída completa arquivada localmente (não versionada); resumo
fiel abaixo.

**NOTA: 9.3/10 — APROVADO.**

## Veredito

"Os cinco achados bloqueantes da Rodada 3 foram genuinamente fechados no nível de design. Não identifiquei
novo bloqueante real."

1. **Backfill**: fechado — alvo inclui todo item com `dueAt` determinável (inclusive futuro), critério de
   encerramento usa a mesma definição, elimina a perda permanente da Rodada 3.
2. **`deriveMaintenanceDue()` por worker**: fechado — confirmadas as 6 funções já exportadas
   (`isPurgeEligibleByRemoval` em `membership-purge`, `isPurgeEligibleByTermination` em `invitation-purge`,
   `isPurgeEligibleByWindowEnd` em `quota-telemetry-purge`, equivalentes em `delivery-record-purge`/
   `core-user-data-purge`/`security-audit-purge`) e confirmado que `deadlineFromGsi5Sk`/`isEligibleByAge`
   (transient-purge) são privadas, exatamente como a Rodada 4 reconheceu.
3. **IAM**: fechado — confirmado que `tenant_facing_read_write` (`BatchGetItem`, `GetItem`, `Query`, `Scan`,
   `BatchWriteItem`, `PutItem`, `UpdateItem`, `DeleteItem`, `ConditionCheckItem`, `DescribeTable`) **não**
   contém `TransactWriteItems` — a correção da Rodada 4 (permissão nova, escopada à tabela base, política por
   worker, credencial operacional separada para backfill/redrive) fecha a lacuna real.
4. **Idempotência do backoff**: fechado no nível de design, com 1 nota textual não-bloqueante — com GSI8
   `KEYS_ONLY`, o contador não é literalmente "observado na `Query`" (é `KEYS_ONLY`, sem atributos de
   negócio), e sim na leitura/revalidação do item base que já é obrigatória — o fluxo e a IAM já pressupõem
   esse `GetItem`, então não deixa decisão em aberto, só uma imprecisão de redação a corrigir no documento
   final. Precedente confirmado real: `membership-purge/purge.ts` já usa `isConditionalCheckFailed` →
   `skippedConcurrentlyModified` sem retry recalculado.
5. **Observabilidade/gatilho de shard**: fechado — confirmado que `AGENTS.md` §7 realmente declara workers
   "deliberately observability-agnostic" com handlers reais em `src/runtime/aws/handlers/`; métrica primária
   passa a ser backlog mensurável (`oldestCandidateAgeSeconds`) com threshold/janela concretos, throttling
   nativo como sinal secundário.

"A arquitetura está pronta para implementação. As pendências restantes — extrações mecânicas, scripts, testes
Terraform e calibração operacional — são trabalho verificável de implementação, não lacunas de decisão."

## Gate do protocolo

Claude (autoavaliação Rodada 4, registrada antes desta crítica): **9,2/10**. Codex (esta rodada): **9,3/10**.
Ambos ≥9,0 sem arredondar — protocolo `AGENTS.md` §4 satisfeito. `APPROVED (design)`.
