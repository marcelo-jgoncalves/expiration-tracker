# Expiration Tracker — Estado Atual + Próxima Ação

> Este arquivo é estado atual + próxima ação (`AGENTS.md` §2), nunca fonte normativa e nunca histórico narrativo — história detalhada vive em `docs/architecture/{session-log,decisions-log}.md`, `docs/engineering/decisions-log.md` e nas pastas `reviews/`. Cada linha abaixo deve caber em 1-3 frases: o quê + status + referência D-xxx/E-xxx para detalhe completo. **Recompactado em 2026-09-08 (D-236, segunda reconciliação de engenharia de contexto — a de 2026-08-29 já tinha feito isso uma vez, 1067→78 linhas; o arquivo tinha reacumulado ~134 KB/~15.600 palavras em só ~299 linhas, achado E-022/full-audit-round2, nota 6,84/10).** Antes de adicionar uma entrada nova aqui: se o D-número/E-número já tem linha completa em `decisions-log.md` (deveria sempre ter), esta seção só recebe 1-3 frases — nunca reconte a narrativa.

## Branch / as-of

**Não confie nesta seção sem confirmar.** `git branch --show-current` deve ser `develop`; `git log --oneline -5`, `git status` e `git pull` antes de assumir qualquer coisa abaixo como pendente ou concluído — múltiplas sessões/agentes trabalham neste repo em paralelo.

**Padrão de trabalho autônomo (Marcelo, 2026-09-01, vale para toda sessão futura)**: prosseguir continuamente enquanto houver trabalho de engenharia real a fazer — nunca parar para pedir "posso continuar?". Só pausar/perguntar quando o próximo passo depender genuinamente de decisão exclusiva de Marcelo (produto/arquitetura, execução destrutiva/irreversível, gasto de infra não trivial, ou algo que `AGENTS.md` §4 exige elevar a ele). Nesses casos: registrar o pendente aqui/`decisions-log.md`, seguir para outra frente independente, nunca ficar ocioso.

## Fase atual

`Consolidation + Pilot Readiness` com recomendação **CONDITIONAL GO**. M0-M12 (exceto billing/D-052, bloqueado por fornecedor) e Multi-User B2B (15 waves, D-084 a D-120) implementados e deployados. Domínio Documental completo (D-143 a D-235, ver roadmap abaixo). Full-audit-round2 (auditoria cíclica por eixo, `docs/engineering/joint-review-criteria.md`) em andamento desde 2026-09-07 — ver seção dedicada abaixo para o que está aberto por eixo.

## Roadmap de lançamento (`docs/project/roadmap-competitivo-2026-09-01.md`) — 11 itens P0

1. **Requirement Templates** — 🟢 IMPLEMENTADO (D-191).
2. **Bulk import (Documents+Requirements+column mapping)** — 🟢 IMPLEMENTADO (D-192).
3. **WhatsApp operacional** — 🟡 design `APPROVED` (D-197/ADR-0012) + fatias 1-3/5 implementadas (D-223/D-229/D-231). **Pendente real**: revisar `terraform plan` real contra `dev` e completar merge/CD/verificação ao vivo da fatia 3 (nunca aplicada); fatia 4/5 (quota 24h + IAM dedicada) não iniciada. Bloqueante adicional para uso com usuário real (E-019): aviso de privacidade, DPA Meta formalmente aceito, residência de dados decidida — nenhum feito ainda.
4. **IA/OCR no Document Lifecycle** — 🟢 IMPLEMENTADO por completo (D-193). Flags `EXTRACTION_DOCUMENT_ARCHIVE_TRIGGER_ENABLED`/`DOCUMENT_ARCHIVE_PROMOTION_ENABLED` deliberadamente OFF (ativação é decisão futura reversível).
5. **Busca e filtros documentais** — 🟢 IMPLEMENTADO fatias 1-3 (D-194/D-196). Fatias 4-5 (projeção materializada+GSI10, índice por assignee) DEFERIDAS com gatilho quantitativo nomeado em D-194 — não bloqueante.
6. **Dashboard operacional/compliance** — 🟢 IMPLEMENTADO (D-196).
7. **Relatórios + exportação + audit trail** — 🟢 IMPLEMENTADO fatias 1-4 (D-195). Fora de escopo, nomeado: "solicitações pendentes" (sem GSI tenant-wide por status) e audit trail legível para negócio.
8. **Document Types configuráveis** — 🟡 quase completo (D-173 a D-186, D-221, D-224): CRUD, RBAC, metadata configurável e leitura pública para guest todos implementados. **Pendente real, decisão de Marcelo**: tornar `documentTypeId` obrigatório no schema HTTP do guest submit (quebraria integrações existentes) — ver `decisions-log.md` D-224.
9. **Consolidar Guest Upload + Requests + Review + Recurrence** — 🟢 FECHADO POR INTEIRO (D-222/D-226 a D-230). Ciclo completo (criar→emitir credencial→entregar→resolver) funciona nos dois caminhos (avulso e recorrência), provado por teste e2e real.
10. **Consolidar Storage + Versioning + Renewal** — 🟢 avançado; `DocumentFile` fechado por completo (D-163 a D-168).
11. **Frontend completo do P0** — ❌ explicitamente adiado por Marcelo (2026-09-04) — não iniciar.

## Backlog pós-lançamento P1 (autorizado 2026-09-04)

1. reminder sequences configuráveis — 🟢 DONE (M3).
2. escalation/múltiplos destinatários — 🟢 FECHADO (D-199 a D-201).
3. busca OCR/full-text — 🔴 **BLOQUEADO**, pendente decisão de Marcelo entre 3 caminhos nomeados em D-202 — não é o próximo item executável sem essa decisão.
4. relatórios agendados — 🟢 FECHADO POR COMPLETO (D-204/D-211 a D-215).
5. dossiê documental PDF/Excel — 🟢 FECHADO POR COMPLETO (D-205/D-216/D-217). TTL de retenção do metadado fechado depois (D-235).
6. bulk actions — 🟢 FECHADO POR COMPLETO (D-206/D-207/D-209/D-210).
7. metadata configurável por Document Type — 🟢 FECHADO POR COMPLETO (D-218 a D-221).
8. compartilhamento externo seguro (`ExternalShareLink`) — 🟡 design `APPROVED` (D-225), implementação em fatias NÃO iniciada — último item do backlog P1 a implementar.
- **P2** (não escopado): assinatura eletrônica; API pública; webhooks; integrações de calendário; compliance score avançado.
- **Futuro** (sem gatilho comercial): portal completo do cliente; SSO/SCIM/controles enterprise.

## Full-audit round2 (`docs/engineering/joint-review-criteria.md`) — estado por eixo, 2026-09-07/08

Gate de fechamento é ≥9,0/10 nos dois avaliadores, sem arredondar. Nenhum eixo abaixo atingiu o gate ainda, exceto os 3 achados HIGH/ALTA já corrigidos nominalmente (linhas seguintes). Detalhe completo de cada eixo: `docs/engineering/decisions-log.md` E-0xx + `docs/engineering/reviews/full-audit-round2-*-summary.md`.

- **E-020 (Operações/SRE)** — achado ALTA (rollback quebrado, manifesto hardcodava 13 de 61 Lambdas) **CORRIGIDO (D-232)**: `scripts/generate-lambda-manifest.ts` gera o manifesto automaticamente a partir de `infra/*.tf`, `npm run check:lambda-manifest` CI-blocking.
- **E-018 (Segurança)/E-021 (Arquitetura), achado convergente (SEC-R2-02)** — lease de entrega de credencial guest quebrado (marcador reivindicado antes do envio SES) **CORRIGIDO (D-233)**: máquina `CLAIMED`→`DELIVERED`/`SEND_UNCERTAIN`. Achados menores de E-021 ainda pendentes: EMF/dashboard operacional ausente; fan-out sem cap em `onboarding-state.ts`/`resolve-active-membership.ts`.
- **E-018 (Segurança) — IAM least-privilege** — `dynamodb:Scan` **CORRIGIDO PARCIALMENTE (D-234)**: removido das políticas gerais tenant-facing, isolado aos 4 workers que fazem Scan cross-tenant. Risco residual documentado (LeadingKeys estático inviável para ~44 Lambdas HTTP) mitigado via `AuthorizedTenantId` + suíte adversarial (143 casos). Propagação de `AuthorizedTenantId` aos key-builders: document-archive fechado (D-237); expiration fechado (D-238); subject/organization pendentes, não bloqueantes.
- **E-015 (Privacidade)** — `DossierExportRun`/`ReportSubscriptionRun`/`ReportDeliveryAttempt` sem TTL **CORRIGIDO (D-235)**: `purgeAfterTtl` (30 dias) adicionado, TTL nativo DynamoDB. Pendente: critérios #1/#5/#6/#7 sem rodada de debate dedicada (retorno esperado baixo).
- **E-016 (Governança de Produto/Multi-tenant)** — nota 7,1/7,8, gate não atingido. Nenhum vazamento cross-tenant confirmado. Pendente: `reset-dev-data.ts`'s `QUEUE_BASE_NAMES` desatualizado (faltam filas pós-B2B-12); sem enforcement automático de que toda rota nova chama `authorize()`.
- **E-017 (Governança de IA)** — nota 7,2/7,1, gate não atingido. 2 incidentes reais (delegação recursiva de subagente, item de roadmap declarado fechado sem worker real) registrados retroativamente em `ai-governance.md` §5. Pendente: sem gate de evidência ponta-a-ponta para fechar item de ROADMAP (só cobre todo list); sem limite de profundidade de subagente.
- **E-019 (Jurídico/Contratual)** — nota 4,73→5,25/5,16→5,28, gate não atingido (o mais baixo). Fixes factuais em `third-party-inventory.md`. **Bloqueante real antes de WhatsApp com usuário real**: aviso de privacidade, DPA Meta formalmente aceito, residência de dados decidida — nenhum feito.
- **E-022 (Engenharia de Contexto)** — nota 6,84/10, gate não atingido. **Este próprio arquivo era o achado central** — reconciliado nesta sessão como D-236 (ver preâmbulo). Guardrail de `scripts/check-doc-drift.ts` também corrigido (checagem de bytes/palavras adicionada, ver `AGENTS.md` §6 e o próprio script). Achados factuais menores em `docs/architecture/README.md` já corrigidos.
- **E-023 (Qualidade de Engenharia)** — nota 8,17→8,32/8,84→8,34, gate não atingido (mais perto de todos). Pendente nível 3-4: corrida intermitente entre `test/architecture/system-mutation-allowlist.test.ts` e `tenant-fence-boundary.test.ts` (causa raiz não identificada, não é regressão de produção). Pendente maior: sem `coverage.thresholds` em `vitest.config.ts` (decisão de Marcelo).

## Pendências reais que dependem de decisão de Marcelo (lista consolidada)

1. Item 3 do backlog P1 (busca OCR/full-text) — escolher entre 3 caminhos nomeados em D-202.
2. Item 8 do roadmap P0 (Document Types) — tornar `documentTypeId` obrigatório no guest submit? (D-224).
3. Execução destrutiva real de `scripts/reset-dev-data.ts --confirm`/`--include-cognito` contra `dev` — postergado, não perguntar de novo até ele sinalizar.
4. `coverage.thresholds` em `vitest.config.ts` — ainda não decidido (E-023).
5. WhatsApp com usuário real (item 3 P0) — aviso de privacidade, DPA Meta, residência de dados (E-019).
6. Wave 1b (Design System) — quais componentes com overlay/focus-trap (`Combobox`/`DateInput`/`Tooltip`/`Popover`/`DropdownMenu`/`Modal`/`Drawer`/`Tabs`/`Pagination`/`Breadcrumb`/`Avatar`/`Card`) abordar primeiro — deliberadamente por último, por pedido de Marcelo.
7. User Validation (planejamento de interface) — aguarda sinal explícito dele.
8. Frontend completo do P0 (item 11) — adiado para depois do P0 fechar.

## Próxima ação recomendada

**Prioridade 1, pedido explícito de Marcelo (2026-09-08) — fatias 1/4 e 2/4 CONCLUÍDAS (D-237/D-238)**: propagar `AuthorizedTenantId` (branded type criado em D-234, `src/modules/identity/domain/authorization.ts`) aos key-builders de persistência de TODOS os módulos. **document-archive** (D-237) e **expiration** (D-238) já fechados: todo key-builder de domínio dos dois módulos exige `AuthorizedTenantId`, `authorizedTenantIdFromPersistedEntity()` cobre o lado worker/SQS sem `RequestContext`, zero casts novos fora de `authorization.ts`, suíte completa verde (2786/2786) nas duas fatias. **Restam subject/organization** — mesmo padrão (D-237/D-238 documentam o design e os dois construtores a reusar), cada um sua própria fatia de sessão futura, mesma ordem de esforço (dezenas de call sites por módulo). Antes de começar cada fatia: releia D-237/D-238 inteiros (o design já resolvido, não redecidir do zero) e confirme se algum key-builder desse módulo tem uma forma diferente de acesso worker/queue que precise de um terceiro construtor (nenhum caso assim apareceu em document-archive nem expiration). Protocolo Claude↔Codex: dispensado nas duas fatias já feitas (réplica mecânica de decisão de design já registrada) — mesmo critério vale para subject/organization, salvo achado genuinamente novo.

Depois disso, ou em paralelo se a sessão preferir dividir o trabalho, sem decisão de Marcelo pendente:
2. Item 8 do backlog P1 (compartilhamento externo seguro) — design já `APPROVED` (D-225), implementar em fatias (nível 3-4, sem protocolo novo).
3. Fechar a fatia 3/5 do WhatsApp (item 3 P0): `terraform plan` real contra `dev`, merge, CD, verificação ao vivo — nunca aplicada ainda.
4. Fatia 4/5 do WhatsApp (quota 24h + IAM dedicada).
5. Avançar qualquer eixo do full-audit-round2 com achado nível 3-4 pendente listado acima (E-016 QUEUE_BASE_NAMES, E-023 corrida intermitente).
6. Ou uma nova frente que Marcelo trouxer.

## Status de evidência (não presumir E2E sem checar)

A maioria dos mecanismos do roadmap P0/backlog P1 está `IMPLEMENTED`/`UNIT TESTED` e confirmada `Active` contra `dev` via `aws --profile claude-dev`, mas **nem todo mecanismo tem prova E2E de ponta a ponta disparando pelo gatilho real** (cron/SQS real, não só G-V3/unit) — isso é nomeado individualmente nas linhas do roadmap acima onde relevante ("nunca testado ponta a ponta com... real"). Não assumir E2E PROVEN sem checar a linha específica do item ou `decisions-log.md`.

## Links para histórico (não reler por padrão — só sob demanda)

- `docs/architecture/session-log.md` — linha do tempo compacta, uma entrada por sessão.
- `docs/architecture/decisions-log.md` / `docs/engineering/decisions-log.md` — toda decisão com nota Claude/Codex e status (D-0xx / E-0xx).
- `docs/architecture/reviews/` — artefatos de cada rodada Claude↔Codex por tema.
- `docs/project/handoffs/` — prompts de handoff de sessões anteriores, superseded por este arquivo.
- `docs/frontend/` — planejamento de interface + `interface-quality-standard.md` + `prototype/`.
- `docs/architecture/multi-user-b2b-wave-tracker.md` — detalhe fatia-a-fatia do Multi-User B2B (15 waves, D-084 a D-120).
