# MaintenanceDueIndex — Rodada 1 (crítica Codex)

Invocação real: `codex exec --skip-git-repo-check - < codex-round1-prompt.txt` (background, `AGENTS.md` §4),
nota cega — Codex não viu nenhuma nota do Claude antes de responder. Saída completa arquivada em
`C:\Users\Usuario\AppData\Local\Temp\claude\...\scratchpad\codex-round1-out.txt` (não versionada — cache local
de sessão); este arquivo é o resumo fiel dos achados e a nota real.

**NOTA: 5.8/10 — não aprova a Rodada 1.**

## Achados bloqueantes (resumo fiel da saída real do Codex)

1. **A garantia principal ("nada fica permanentemente esquecido") é falsa diante de poison records.** Workers
   abortam em erro não condicional (`membership-purge/purge.ts:105-110`,
   `requirement-reindex/reindex.ts:67-76`, `security-audit-purge/purge.ts:137-142`); um candidato
   permanentemente defeituoso volta em toda `Query` (mais antigo primeiro) e pode bloquear indefinidamente
   candidatos posteriores dentro do mesmo `Limit`. O precedente GSI6 citado não prova a propriedade — só
   consulta os primeiros 25 itens e também não tem cursor.
2. **Isolamento IAM "por índice" não é isolamento "por worker".** Política escopada ao ARN do índice GSI8 não
   restringe sort-key/PK; sem `dynamodb:LeadingKeys` condicionado a `WORK#<workerType>` por role, qualquer
   worker autorizado pode consultar o namespace dos outros 8 — blast radius real, inclusive cross-domain
   (security-audit + memberships no mesmo índice).
3. **Projeção do GSI8 não decidida** — sem isso, custo/privacidade/viabilidade de leitura ficam indefinidos.
   `ALL` duplicaria atributos (grave para `security-audit-purge`, que indexaria quase todo evento de auditoria
   durante a retenção); `KEYS_ONLY` exige leitura adicional; `INCLUDE` exige inventário de campos.
4. **Nenhuma matriz real por entidade.** O helper `maintenanceDueKeys()` só padroniza serialização — não
   resolve quando/onde/atomicamente-por-quem cada um dos 9 contratos heterogêneos (Membership, Invitation,
   DocumentFile, WebhookInbox/UploadSlot, RequirementReindex, CoreUserData, Quota, DeliveryRecord,
   SecurityAudit) move/remove o ponteiro.
5. **Plano de backfill não fundamentado** ("para três casos", sem inventário) — item existente sem GSI8
   desaparece do novo candidate source; falta estratégia verificável (reset/reseed vs. backfill vs.
   coexistência com critério de encerramento) e reconhecer a consistência eventual do GSI durante o backfill.
6. **Falta a invariante de revalidação atômica** — o próprio `document-file-reconciliation/candidate-source.ts:17-19`
   já declara que a descoberta via índice nunca é fonte de verdade; a proposta não formaliza isso como regra
   obrigatória para os 9 workers (ponteiro pode ficar obsoleto).
7. **Observabilidade obrigatória ausente** — o precedente GSI6 audita sucesso/negação de acesso
   (`dynamodb-document-purge-candidate-source.ts:37-43,59-65`); a proposta não define equivalente, nem
   métrica de idade do candidato mais antigo/backlog/throttling por namespace (`joint-review-criteria.md`
   Observability & Operability, eixo Arquitetura, 8%).
8. **"Sem shard" usa a métrica errada e não define gatilho executável** — RCU/WCU são limites distintos, hot
   partition depende de padrão instantâneo/tamanho de item/adaptive capacity, não só volume agregado; "vira
   runbook futuro" não especifica alarme/threshold/janela/dono nem plano de migração de PK sem dual-read.
9. **Precedente GSI6 descrito de forma factualmente incorreta/contraditória** — a proposta diz "4 consumidores"
   num ponto e "3 workers" noutro, omitindo `UploadSlotReconciliationWorker` (confirmado em
   `main.tf:12-14,238-246`); e alega comportamento "provado em produção", quando o projeto não tem produção
   (`AGENTS.md` §1) — o comentário do adapter documenta expectativa, não evidência operacional.
10. **O checklist de critérios da Rodada 1 substitui, não subordina, os pesos normativos do eixo Arquitetura**
    (`joint-review-criteria.md` §Arquitetura, 11 critérios reais) — viola `joint-review-criteria.md:9-13`
    ("nunca redefinem ou duplicam a tabela de pesos"). Dilui/omite reliability diante de poison records,
    consistência eventual, segurança cross-namespace, observabilidade, delivery safety do rollout, projeção/
    privacidade, custo quantificado, testes IAM/DynamoDB reais, governança/rastreabilidade.
11. **Alternativas reais não comparadas** — faltam: cursor persistido rotativo com wrap-around, checkpoint de
    Parallel Scan, sobrecarregar o próprio GSI6 (com avaliação explícita de por que não), TTL para classes
    elegíveis a exclusão assíncrona sem transação, Stream/outbox materializando itens de trabalho compactos,
    tabela/fila de manutenção dedicada (isolamento/retry/DLQ próprios). GSI8 pode vencer a comparação, mas a
    Rodada 1 presumiu a conclusão sem fazer a comparação.
12. **Evidência externa E-014 insuficientemente reprodutível** — a referência ao AWS Database Blog aponta só
    para a página raiz, não para um artigo específico; a citação de "The DynamoDB Book" não informa edição/
    capítulo/trecho verificável.

## Conclusão do Codex

"A direção arquitetural merece continuar, mas a proposta ainda é um conceito de access pattern, não um design
aprovado." Exige para a próxima rodada: matriz completa dos 9 writers, projeção do índice decidida, modelo
quantitativo de custo, política de progresso diante de poison records, isolamento real por PK (`LeadingKeys`
ou reconhecimento explícito de acesso cruzado), revalidação atômica como invariante obrigatória, observabilidade
equivalente ao precedente GSI6, plano de rollout/backfill verificável, comparação objetiva com cursor
persistido/checkpoint/work queue, e correção das 2 imprecisões factuais (contagem de consumidores do GSI6,
alegação de "prova em produção").
