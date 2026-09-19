# Expiration Tracker — Estado Atual + Próxima Ação

> Este arquivo é estado atual + próxima ação (`AGENTS.md` §2), nunca fonte normativa e nunca histórico narrativo — história detalhada vive em `docs/architecture/{session-log,decisions-log}.md`, `docs/engineering/decisions-log.md` e nas pastas `reviews/`. Cada linha abaixo deve caber em 1-3 frases: o quê + status + referência D-xxx/E-xxx para detalhe completo. **Recompactado em 2026-09-08 (D-236, segunda reconciliação de engenharia de contexto — a de 2026-08-29 já tinha feito isso uma vez, 1067→78 linhas; o arquivo tinha reacumulado ~134 KB/~15.600 palavras em só ~299 linhas, achado E-022/full-audit-round2, nota 6,84/10).** Antes de adicionar uma entrada nova aqui: se o D-número/E-número já tem linha completa em `decisions-log.md` (deveria sempre ter), esta seção só recebe 1-3 frases — nunca reconte a narrativa.

## Branch / as-of

**Não confie nesta seção sem confirmar.** `git branch --show-current` deve ser `develop`; `git log --oneline -5`, `git status` e `git pull` antes de assumir qualquer coisa abaixo como pendente ou concluído — múltiplas sessões/agentes trabalham neste repo em paralelo.

**Padrão de trabalho autônomo (Marcelo, 2026-09-01, vale para toda sessão futura)**: prosseguir continuamente enquanto houver trabalho de engenharia real a fazer — nunca parar para pedir "posso continuar?". Só pausar/perguntar quando o próximo passo depender genuinamente de decisão exclusiva de Marcelo (produto/arquitetura, execução destrutiva/irreversível, gasto de infra não trivial, ou algo que `AGENTS.md` §4 exige elevar a ele). Nesses casos: registrar o pendente aqui/`decisions-log.md`, seguir para outra frente independente, nunca ficar ocioso.

## Fase atual

`Consolidation + Pilot Readiness` com recomendação **CONDITIONAL GO**. M0-M12 (exceto billing/D-052, bloqueado por fornecedor) e Multi-User B2B (15 waves, D-084 a D-120) implementados e deployados. Domínio Documental completo (D-143 a D-235, ver roadmap abaixo). Full-audit-round2 (auditoria cíclica por eixo, `docs/engineering/joint-review-criteria.md`) em andamento desde 2026-09-07 — ver seção dedicada abaixo para o que está aberto por eixo.

## Roadmap de lançamento (`docs/project/roadmap-competitivo-2026-09-01.md`) — 11 itens P0

**Todos os 11 itens 🟢 IMPLEMENTADOS por completo** (Requirement Templates D-191; Bulk import D-192;
WhatsApp D-197/ADR-0012+D-286; IA/OCR D-193; Busca/filtros D-194/D-196; Dashboard D-196; Relatórios
D-195; Document Types D-173-D-186/D-221/D-224/D-243/D-244; Guest Upload+Requests+Review+Recurrence
D-222/D-226-D-230; Storage/Versioning/Renewal D-163-D-168; Frontend 25 telas D-254-D-271/D-292/D-293).
Detalhe item-a-item nunca recontado aqui: `docs/architecture/decisions-log.md`. Únicas pendências
residuais, ambas fora de engenharia: **WhatsApp** aguarda E-019 (jurídico — aviso de privacidade,
DPA Meta, residência de dados); **Identidade visual** (workstream paralelo de Marcelo, fora desta
sessão) — Fase 1 concluída 2026-09-11, Fase 2 pendente (`Proximas_Tarefas_Identidade_Visual.md`,
raiz do repo, deliberadamente fora do `ROOT_MD_ALLOWLIST` — nunca commitar sem mover para `docs/`
ou atualizar o allowlist).

## Nova capacidade fora do roadmap original: quota de armazenamento por tenant (D-249, 2026-09-09)

🟢 FECHADO POR COMPLETO — backend (tracking/enforcement/leitura, `TenantStorageQuota`) e UI real (`StorageQuotaCard`/`StorageSection`, Bloco 1/D-255-256) implementados e testados. Quota default 8GB, confirmada por Marcelo após pesquisa de mercado. Detalhe completo: `docs/architecture/decisions-log.md` D-249, `docs/architecture/reviews/storage-quota-scoping/`.

## Backlog pós-lançamento P1 (autorizado 2026-09-04)

**Fechado por completo, exceto item 3.** Itens 1/2/4-8 🟢 DONE (reminder sequences M3; escalation
D-199-D-201; relatórios agendados D-204/D-211-D-215; dossiê PDF/Excel D-205/D-216/D-217/D-235;
bulk actions D-206/D-207/D-209/D-210; metadata por Document Type D-218-D-221; `ExternalShareLink`
D-273, aplicado em `dev` CD run 34704323049). Item 3 (busca OCR/full-text) 🔴 **BLOQUEADO** —
decisão de Marcelo entre 3 caminhos nomeados em D-202. Detalhe item-a-item: `decisions-log.md`.
- **P2** (não escopado): assinatura eletrônica; API pública; webhooks; integrações de calendário;
  compliance score avançado; assistente de IA conversacional no produto (via API Claude direto,
  ver `docs/project/integrations-and-tooling-research-2026-09-11.md` §5).
- **Futuro** (sem gatilho comercial): portal completo do cliente; SSO/SCIM/controles enterprise.

## Full-audit round2 (`docs/engineering/joint-review-criteria.md`) e auditoria externa de 2026-09-12

Ambas substancialmente fechadas — todo achado HIGH/ALTA corrigido (E-015/E-016/E-018/E-020/E-021,
achados P0.1-P0.4/P0.6/P1.6/P2.1-P2.4 da auditoria externa: ver `decisions-log.md` D-232 a D-290
para detalhe item-a-item, nunca recontado aqui). **Únicos gates ainda não atingidos, ambos
decisão-dependente, não engenharia**: **E-019** (jurídico — aviso de privacidade/DPA Meta/residência
de dados, bloqueia WhatsApp com usuário real) e **E-023** (falta decisão de Marcelo sobre
`coverage.thresholds` em `vitest.config.ts`). **E-017** teve seus 2 achados pendentes corrigidos
(`definition-of-done.md`), drift desta linha corrigido 2026-09-19.

## Pendências reais que dependem de decisão de Marcelo (lista consolidada)

1. Item 3 do backlog P1 (busca OCR/full-text) — escolher entre 3 caminhos nomeados em D-202.
2. Execução destrutiva real de `scripts/reset-dev-data.ts --confirm`/`--include-cognito` contra `dev` — postergado, não perguntar de novo até ele sinalizar.
3. `coverage.thresholds` em `vitest.config.ts` — ainda não decidido (E-023).
4. WhatsApp com usuário real (item 3 P0, engenharia 100% fechada desde D-286 — rota de opt-in também já construída) — resta só aviso de privacidade, DPA Meta, residência de dados (E-019).
5. Wave 1b (Design System) — quais componentes com overlay/focus-trap (`Combobox`/`DateInput`/`Tooltip`/`Popover`/`DropdownMenu`/`Modal`/`Drawer`/`Tabs`/`Pagination`/`Breadcrumb`/`Avatar`/`Card`) abordar primeiro — deliberadamente por último, por pedido de Marcelo.
6. User Validation (planejamento de interface) — aguarda sinal explícito dele.
7. Aplicar ao **Claude for Startups Program** (`claude.com/programs/startups`, até US$25.000 em créditos de API, sem exigir VC) — projeto se encaixa no perfil, mas o cadastro exige dados da empresa/ação direta de Marcelo. Ver `docs/project/integrations-and-tooling-research-2026-09-11.md` §6.
8. P0.5 — suíte "Real System E2E" contra `dev` real (browser→CloudFront→API Gateway→S3 sem mocks) — projeto de infra de teste novo, não correção pontual; precisa de decisão sobre credenciais/tenant de teste, cadência de execução e estratégia de limpeza antes de começar. Deliberadamente adiado, Marcelo 2026-09-14.
9. **Import CSV em massa para Items** (proposta, ainda não decidida) — hoje o import CSV (`src/modules/import/`) só cobre `TrackedSubject`/`Document`/`Requirement`, não `Item` (o vencimento em si, entidade mais central do produto). Identificado como lacuna real durante o Programa de Performance (PERF-12, 2026-09-14) ao precisar semear 10k Items para teste de carga do pipeline de lembretes — não existe hoje nenhum caminho de criação em massa para Items (nem CSV, nem bulk-create). Não é correção pontual: decisões de produto reais precisam ser tomadas antes de implementar — mapeamento de colunas, se a Política de Lembrete vem junto na mesma linha ou é configurada depois, estratégia de deduplicação, validação linha a linha (mesmo padrão já usado para os outros 3 tipos). Provável nível 5-6 na escala de risco (`docs/engineering/change-risk-scale.md`) — protocolo Claude↔Codex + possível ADR antes de implementar. Aguardando sinal de Marcelo para virar iniciativa.

## Próxima ação recomendada

**P0/P1/full-audit round2/auditoria externa são contexto histórico já fechado, não a próxima ação
— ver seções acima.** Foco real da sessão desde 2026-09-14 é o Programa de Performance (seção
dedicada abaixo); a próxima ação literal está no parágrafo do D-303, dentro dessa seção.

**Regra permanente (2026-09-14)**: `terraform apply` NUNCA roda localmente — só via pipeline de CD. `plan`/`validate`/`fmt`/`test` locais continuam liberados.

**Lição de processo**: default é fork serial (não orquestração paralela via Workflow) — mais barato em token, evita o "imposto" de recontextualização de agente fresco. Paralelizar só se Marcelo pedir velocidade explicitamente.

## Programa de Performance (2026-09-14, fora do roadmap P0/P1, iniciativa própria de Marcelo — foco real da sessão)

Fonte: `expiration-tracker-plano-acao-performance-world-class-2026-09-14.md` (raiz do repo, documento do Marcelo — nunca commitar/mover sem pedir, é dele). Rastreamento vivo: `docs/engineering/performance/TODO.md`. Consolidação executiva (rascunho): `docs/engineering/performance/results/PERF-15-consolidation.md`. **Ciclos A/B/C, PERF-13 e PERF-14 COMPLETOS e implantados em `dev`** — code splitting (-46%), cache TanStack corrigido, EMF real em produção, quota Lambda 10→1000, k6 smoke autenticado em PR + synthetic canaries + alarmes de regressão + dashboard consolidado, tudo implantado e verificado ao vivo em 2026-09-18. PERF-11/11-b: teto real é o rate limiter da própria app (100 req/60s/tenant), não infra AWS.

**PERF-12 (pipeline de lembretes) — achado central do programa, motivou mudança arquitetural real**: D-299/D-300 implementadas. 2 rodadas limpas de 10k em 2026-09-17 entregaram 10.000/10.000 mas estouraram o SLO de 300s (contenção entre continuações de scan e outboxes de dispatch no stream/relay global compartilhado). **D-301/D-302 (`APPROVED_BY_OWNER`, nível 6, protocolo Claude↔Codex dispensado por decisão direta do Marcelo, `ai-governance.md` §2)** — plano de controle dedicado (`DueWorkTable` autoritativa sem stream, sharding versionado, stream/relay/fila exclusivos) — **implementado e implantado em `dev`** (não mais só aprovado). Revalidação de 10k reprovou uma vez por bug real de checkpoint (alias não usado em `ExpressionAttributeNames` cancelando a transação silenciosamente); corrigido (`a45c145`) e confirmado por canário dedicado de 1.000 multi-shard (1.000/1.000 `TRIGGERED`, `pagesProcessed=2`/shard provando avanço de cursor, máximo 147,5s). Evidência completa: `results/PERF-12-d302-rollout-2026-09-18.md`.

**Revalidação de 10k de 2026-09-19 (cohort de e-mail SES) reprovou o SLO de 300s** (p100=535,98s,
zero perda) — causa raiz medida: `dispatch-outbox-relay` (relay **compartilhado**, não exclusivo
de reminders) ainda lê o stream global da tabela principal, `IteratorAge` até 275,8s mesmo com
`parallelization_factor=4` já esgotado. Evidência completa: `results/PERF-12-10k-latency-regression-2026-09-19.md`.
Achado incidental corrigido no mesmo dia: os 10.000 `NotificationIntent` saíram todos `CANCELLED`
(zero envio real ao SES em qualquer rodada até agora) porque `seed()` nunca definia
`assigneeUserId` — `perf-reminder-burst.mjs` corrigido e verificado ao vivo; a próxima rodada de
10k será a primeira a exercitar entrega real de e-mail ponta a ponta.

**D-303 (`APPROVED_BY_OWNER`, protocolo dispensado por autorização direta do Marcelo) — IMPLEMENTADO
e REVISADO, aguardando só CI/merge/deploy+reteste**: outbox/stream/relay dedicados só para
dispatch de reminders (mesmo padrão de D-301/D-302), reaproveitando a lógica genérica existente
sem duplicar código. `MaximumConcurrency` do `reminder-claim-consumer` subido 50→150 (independente,
nível 4). **Codex seguia bloqueado (até 2026-09-23) — testamos e confirmamos o Antigravity CLI
(`agy`, `/root/.local/bin/agy -p "..." --model gemini-3.1-pro-high --mode plan`) como segunda
opinião real funcional** (o `gemini` CLI puro está descontinuado — "Code Assist individual" não é
mais suportado). Achado real e corrigido na revisão: `dispatchOutboxTableName` era opcional com
fallback silencioso — armadilha de regressão silenciosa real, corrigida (campo agora obrigatório,
cada call site declara explicitamente qual tabela usa). Alarme de `WriteThrottleEvents` adicionado
(tabela on-demand nova começa em 4.000 WCU/s, abaixo da tabela principal já escalada). Detalhe
completo da rodada: `docs/architecture/reviews/reminder-dispatch-control-plane/DECISION.md` §7.1.
Gate adicional real encontrado e corrigido antes do commit: `infra/lambda-manifest.generated.tf`
(manifesto de rollback E-020/D-232) estava desatualizado — faltavam os 2 handlers novos, pego pelo
próprio `test/unit/scripts/lambda-manifest.test.ts`; corrigido via `npm run generate:lambda-manifest`
e reverificado (`npm test` 3113/3113, `terraform test` 29/29). **Mergeado em `main` via PR #371 e
APLICADO em `dev` com sucesso (2026-09-19)** — verificado ao vivo via `aws --profile claude-dev
--region us-east-1` (não só o status `success` do CD run): tabela `exptrk-dev-reminder-dispatch-
outbox` ACTIVE com stream+GSI6, `exptrk-dev-reminder-dispatch-outbox-relay`/`-sweeper` deployadas,
event source mapping do relay `Enabled` apontando pro stream novo, schedule do sweeper `Enabled`,
5 alarmes novos em `OK`. **Próxima ação literal**: decidir com Marcelo quando repetir a rodada de
10k para provar a correção sob carga real (não lançar sozinho sem visibilidade, é outro ciclo de
~2h) — essa será a primeira rodada a exercitar entrega real de e-mail de ponta a ponta também.

**Checklist de conclusão de tarefa + skill (2026-09-18, decisão direta do Marcelo)**: `docs/engineering/task-completion-checklist.md` (gate checkbox derivado de `definition-of-done.md`+`change-risk-scale.md`+`quality-gate-tiers.md`+`joint-review-criteria.md`) + skill `.claude/skills/task-checklist/` — uso obrigatório ao fim de toda tarefa, ver `AGENTS.md` §1.

**Manutenção paralela, não bloqueante**: fix de redeploy do canário CloudWatch Synthetics (`aws_synthetics_canary` não tem `source_code_hash`, zip nunca era redeployado por mudança de conteúdo) mergeado. Consolidação de 23 PRs Dependabot duplicados/parados (`hashicorp/aws` 6.62.0→6.65.0, só tocavam `infra/.terraform.lock.hcl`) em andamento — cada módulo tem seu próprio lock file (achado real: a primeira tentativa só atualizou o da raiz, `npm run check-dependency-freshness` pegou a inconsistência).

**Pendência de limpeza, não bloqueante**: tenants sintéticos de teste (PERF Test Tenant + 10 do PERF-11-b/PERF-12-10k + 10 novos do cohort de simuladores SES) e dezenas de milhares de registros sintéticos acumulados em `dev` — candidatos a exclusão quando Marcelo decidir, nenhuma ação tomada ainda.

**Achado incidental, também pendente (não é do programa de performance)**: proposta de import CSV em massa para Items — ver item 9 da lista de pendências abaixo.

## Status de evidência (não presumir E2E sem checar)

A maioria dos mecanismos do roadmap P0/backlog P1 está `IMPLEMENTED`/`UNIT TESTED` e confirmada `Active` contra `dev` via `aws --profile claude-dev`, mas **nem todo mecanismo tem prova E2E de ponta a ponta disparando pelo gatilho real** (cron/SQS real, não só G-V3/unit) — isso é nomeado individualmente nas linhas do roadmap acima onde relevante ("nunca testado ponta a ponta com... real"). Não assumir E2E PROVEN sem checar a linha específica do item ou `decisions-log.md`.

## Links para histórico (não reler por padrão — só sob demanda)

- `docs/architecture/session-log.md` — linha do tempo compacta, uma entrada por sessão.
- `docs/architecture/decisions-log.md` / `docs/engineering/decisions-log.md` — toda decisão com nota Claude/Codex e status (D-0xx / E-0xx).
- `docs/architecture/reviews/` — artefatos de cada rodada Claude↔Codex por tema.
- `docs/project/handoffs/` — prompts de handoff de sessões anteriores, superseded por este arquivo.
- `docs/frontend/` — planejamento de interface + `interface-quality-standard.md` + `prototype/`.
- `docs/architecture/multi-user-b2b-wave-tracker.md` — detalhe fatia-a-fatia do Multi-User B2B (15 waves, D-084 a D-120).
