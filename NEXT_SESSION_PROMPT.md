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
3. **WhatsApp operacional** — 🟢 **IMPLEMENTADO POR COMPLETO do lado de engenharia, D-197/ADR-0012, TODAS as 5/5 fatias (D-246 fecha a fatia 5/5 — router wiring `notification-router.ts`'s `SUPPORTED_CHANNELS`→`isChannelRoutable()` + kill switch no handler + RBAC confirmado sem gap + terraform completo)**. Fatia 3/5 **VERIFICADA AO VIVO em `dev`** (D-242). Fatias 4/5 (D-245) e 5/5 (D-246) implementadas/testadas em `develop`, **terraform de AMBAS ainda NÃO mergeado em `main`/aplicado em `dev`** — próxima sessão decide quando (varredura coordenada única para as duas). **Restam só**: (1) o `terraform apply`/merge-para-`main` pendente das fatias 4/5+5/5; (2) o bloqueio de produto/jurídico E-019 (aviso de privacidade, DPA Meta formalmente aceito, residência de dados decidida — nenhum feito ainda, fora do controle de engenharia; as credenciais reais da Meta no secret também dependem disso); (3) pendência nomeada não bloqueante — nenhuma rota HTTP existe ainda para `WhatsAppOptInService.recordOptIn()`, então nenhum usuário real consegue opt-in hoje mesmo com tudo mais pronto (nunca esteve no escopo de nenhuma das 5 fatias do design, D-246). Nenhuma fatia de engenharia resta.
4. **IA/OCR no Document Lifecycle** — 🟢 IMPLEMENTADO por completo (D-193). Flags `EXTRACTION_DOCUMENT_ARCHIVE_TRIGGER_ENABLED`/`DOCUMENT_ARCHIVE_PROMOTION_ENABLED` deliberadamente OFF (ativação é decisão futura reversível).
5. **Busca e filtros documentais** — 🟢 IMPLEMENTADO fatias 1-3 (D-194/D-196). Fatias 4-5 (projeção materializada+GSI10, índice por assignee) DEFERIDAS com gatilho quantitativo nomeado em D-194 — não bloqueante.
6. **Dashboard operacional/compliance** — 🟢 IMPLEMENTADO (D-196).
7. **Relatórios + exportação + audit trail** — 🟢 IMPLEMENTADO fatias 1-4 (D-195). Fora de escopo, nomeado: "solicitações pendentes" (sem GSI tenant-wide por status) e audit trail legível para negócio.
8. **Document Types configuráveis** — 🟢 IMPLEMENTADO (D-173 a D-186, D-221, D-224, D-243, D-244): CRUD, RBAC, metadata configurável, leitura pública para guest, e `documentTypeId` agora OBRIGATÓRIO no schema HTTP do guest submit-evidence (corte único, `documentType` livre removido por completo) — D-244 codou o desenho `APPROVED` de D-243 por inteiro (schema+serviço+9/9 testes do checklist), gate local completo verde.
9. **Consolidar Guest Upload + Requests + Review + Recurrence** — 🟢 FECHADO POR INTEIRO (D-222/D-226 a D-230). Ciclo completo (criar→emitir credencial→entregar→resolver) funciona nos dois caminhos (avulso e recorrência), provado por teste e2e real.
10. **Consolidar Storage + Versioning + Renewal** — 🟢 avançado; `DocumentFile` fechado por completo (D-163 a D-168).
11. **Frontend completo do P0** — 🟢 **FECHADO POR COMPLETO, 2026-09-11.** 25 telas (Blocos 0-10, D-254 a D-270) implementadas/testadas/revisadas, 1 rodada Codex por bloco. Análise holística do frontend + rodada Codex final: CONCLUÍDA (D-271). Detalhe bloco-a-bloco completo (achados de cada rodada Codex, arquivos tocados): `docs/architecture/decisions-log.md` D-254 a D-271, nunca recontado aqui. Pendências reais remanescentes, nomeadas nos próprios D-números: CSP/CORS bloqueando upload real browser→S3 (D-266/D-267); sessão guest não vinculada ao token do path (D-264, achado de segurança, deliberadamente adiado); `createSeries` sem fence de unicidade ACTIVE (D-264); sem histórico de execução A16; A15 sem drill-down por linha. (`ExternalShareLink` slice 2/3 — item 8 do backlog P1 — fechada por completo em D-273, 2026-09-12, não é mais pendência.)

**Armazenamento de arquivo do guest** — design (D-265/ADR-0013) e implementação (D-266) CONCLUÍDOS 2026-09-10, protocolo Claude↔Codex completo (7 rodadas design + 2 rodadas implementação). Pendência remanescente: CSP/CORS (ver item 11 acima) — rodada Claude↔Codex dedicada ainda não escopada por ninguém.

**Bloco 7** (A10 Rastreamento legado + A22 Entrega de solicitação + G01 Upload convidado legado) — COMPLETO (D-267). 1 rodada Codex (4,6/10 → achados corrigidos, incluindo gap real de infra: rota CloudFront nunca existiu para o caminho legado). Pendência nomeada não coberta: sem rota para `DocumentChasingOccurrence` (timeline A10 omite lembretes automáticos).

## Nova capacidade fora do roadmap original: quota de armazenamento por tenant (D-249, 2026-09-09)

Marcelo identificou um gap real de produto: tenants não terão armazenamento ilimitado, e nada
rastreava bytes de armazenamento por tenant. **Mecanismo de backend (tracking/enforcement/leitura)
totalmente IMPLEMENTADO e testado** (D-249) — `TenantStorageQuota` (document-archive/domain),
enforcement fail-closed em `reserveFiles()`, contabilidade de 3 estados (`usedBytes`/
`reservedBytes`), rota `GET /document-archive/storage-usage` (`docarchive:read`). **A UI real
(A03/A19) foi CONSTRUÍDA no Bloco 1 (D-255/D-256, 2026-09-10)** — `StorageQuotaCard` condicional em
`Overview.tsx` + `StorageSection` dedicada em `Settings.tsx`, ambas reais e testadas (achado da
revisão holística do frontend, D-271: esta seção ainda dizia "permanece NÃO CONSTRUÍDA", stale desde
o Bloco 1 — corrigido aqui). **Número da quota CONFIRMADO por Marcelo
(2026-09-09) após pesquisa de mercado**: 8GB — `DEFAULT_STORAGE_QUOTA_BYTES` (constante nomeada,
`src/modules/document-archive/domain/storage-quota.ts`) ajustado de 5GB (exemplo ilustrativo
original) para 8GB, deliberadamente acima da faixa "plano padrão" observada nos concorrentes
diretos de rastreamento de vencimento (Remindax/Expiration Reminder/ExpiryEdge: 100MB-1GB na
entrada, 5-50GB em planos pagos) — já que o nicho mais próximo do modelo de dados deste produto
(compliance de fornecedor, CertFocus/bcs nos EUA, Econsulte/SoftExpert/Valide no Brasil) trata
storage como não-diferencial, frequentemente ilimitado. Pesquisa completa:
`docs/architecture/reviews/storage-quota-scoping/market-research-storage-limits-2026-09-09.md`.
Evidência de design: `docs/architecture/decisions-log.md` D-249,
`docs/architecture/reviews/storage-quota-scoping/`.

## Backlog pós-lançamento P1 (autorizado 2026-09-04)

1. reminder sequences configuráveis — 🟢 DONE (M3).
2. escalation/múltiplos destinatários — 🟢 FECHADO (D-199 a D-201).
3. busca OCR/full-text — 🔴 **BLOQUEADO**, pendente decisão de Marcelo entre 3 caminhos nomeados em D-202 — não é o próximo item executável sem essa decisão.
4. relatórios agendados — 🟢 FECHADO POR COMPLETO (D-204/D-211 a D-215).
5. dossiê documental PDF/Excel — 🟢 FECHADO POR COMPLETO (D-205/D-216/D-217). TTL de retenção do metadado fechado depois (D-235).
6. bulk actions — 🟢 FECHADO POR COMPLETO (D-206/D-207/D-209/D-210).
7. metadata configurável por Document Type — 🟢 FECHADO POR COMPLETO (D-218 a D-221).
8. compartilhamento externo seguro (`ExternalShareLink`) — 🟢 **FECHADO POR COMPLETO (D-273), 2026-09-12** — design `APPROVED` (D-225), slice 1/3 (D-241) + slice 2/3 (rotas HTTP autenticadas+anônima, RBAC, schemas, terraform, BFF, testes) ambas implementadas. 2 achados reais corrigidos durante slice 2/3 (não presentes na slice 1/3 original): pepper de auditoria de IP reusava o pepper do token (violação da Decisão 11, corrigido com `ipAuditPepper` próprio); bug de forma do token no `handleCreateShareLink` (string composta `shareId.selector.secret` do serviço nunca dividida antes de devolver ao cliente — achado só por teste de integração real, não pelos unit tests do serviço). Gate local completo verde (`npm test` 2926/2926), `terraform test` root 27/27 + módulo `api-gateway` 1/1. Mergeado `develop→main` (PR #303) e **APLICADO em `dev` com sucesso** (CD run 34704323049, `Apply complete! Resources: 19 added, 96 changed, 4 destroyed`, exatamente o plano previsto, 0 erro). **Último item do backlog P1 originalmente sem decisão pendente — todo item 1-2/4-8 do backlog P1 está fechado.** Item 3 (busca OCR/full-text) segue 🔴 BLOQUEADO por decisão de Marcelo (não é engenharia) — o backlog P1 não está 100% fechado por causa desse item isolado.
- **P2** (não escopado): assinatura eletrônica; API pública; webhooks; integrações de calendário; compliance score avançado; **assistente de IA conversacional no produto** (ex. "quais fornecedores vencem em breve"/explicar documento sinalizado, via API do Claude direto — não MCP/Claude Code — item novo, 2026-09-11, ver `docs/project/integrations-and-tooling-research-2026-09-11.md` §5; validado por pesquisa de mercado como tendência real de diferenciação em SaaS de compliance, mas não escopado nem priorizado).
- **Futuro** (sem gatilho comercial): portal completo do cliente; SSO/SCIM/controles enterprise.
- **Identidade visual (workstream paralelo, não bloqueia nem é bloqueado por engenharia)**: Fase 1 (pesquisa/diagnóstico de marca) CONCLUÍDA 2026-09-11 por Marcelo diretamente (fora desta sessão de engenharia) — `Relatorio_Fase_1_Pesquisa_e_Diagnostico_Expiration_Tracker.md` e `Proximas_Tarefas_Identidade_Visual.md` (ambos na raiz do repo, **deliberadamente FORA do `ROOT_MD_ALLOWLIST`** de `scripts/check-doc-drift.ts` — nunca commitar sem antes mover para `docs/project/` ou atualizar o allowlist). Próximo passo nomeado: Fase 2 (3 territórios criativos), depois Fase 3 (escolha+busca de anterioridade jurídica+sistema de variantes), depois Fase 4 (aplicação real no produto, aí sim uma sessão de engenharia).

## Full-audit round2 (`docs/engineering/joint-review-criteria.md`) — estado por eixo, 2026-09-07/08

Gate de fechamento é ≥9,0/10 nos dois avaliadores, sem arredondar. Nenhum eixo abaixo atingiu o gate ainda, exceto os 3 achados HIGH/ALTA já corrigidos nominalmente (linhas seguintes). Detalhe completo de cada eixo: `docs/engineering/decisions-log.md` E-0xx + `docs/engineering/reviews/full-audit-round2-*-summary.md`.

- **E-020 (Operações/SRE)** — achado ALTA (rollback quebrado, manifesto hardcodava 13 de 61 Lambdas) **CORRIGIDO (D-232)**: `scripts/generate-lambda-manifest.ts` gera o manifesto automaticamente a partir de `infra/*.tf`, `npm run check:lambda-manifest` CI-blocking.
- **E-018 (Segurança)/E-021 (Arquitetura), achado convergente (SEC-R2-02)** — lease de entrega de credencial guest quebrado (marcador reivindicado antes do envio SES) **CORRIGIDO (D-233)**: máquina `CLAIMED`→`DELIVERED`/`SEND_UNCERTAIN`. Achados menores de E-021 sobre fan-out/duplicação de hidratação GSI4 **CORRIGIDOS (D-274, 2026-09-12)**. Ainda pendente: EMF/dashboard operacional ausente.
- **E-018 (Segurança) — IAM least-privilege** — `dynamodb:Scan` **CORRIGIDO PARCIALMENTE (D-234)**: removido das políticas gerais tenant-facing, isolado aos 4 workers que fazem Scan cross-tenant. Risco residual documentado (LeadingKeys estático inviável para ~44 Lambdas HTTP) mitigado via `AuthorizedTenantId` + suíte adversarial (143 casos). **Propagação de `AuthorizedTenantId` aos key-builders de persistência: COMPLETA nos 4 módulos** (document-archive D-237, expiration D-238, subject D-239, organization D-240) — todo key-builder tenant-scoped dos 4 módulos agora exige o tipo branded, fechando o gap de compile-time que D-234 tinha deixado como follow-up.
- **E-015 (Privacidade)** — `DossierExportRun`/`ReportSubscriptionRun`/`ReportDeliveryAttempt` sem TTL **CORRIGIDO (D-235)**: `purgeAfterTtl` (30 dias) adicionado, TTL nativo DynamoDB. Pendente: critérios #1/#5/#6/#7 sem rodada de debate dedicada (retorno esperado baixo).
- **E-016 (Governança de Produto/Multi-tenant)** — nota 7,1/7,8, gate não atingido. Nenhum vazamento cross-tenant confirmado. `reset-dev-data.ts`'s `QUEUE_BASE_NAMES` desatualizado **CORRIGIDO (D-274, 2026-09-12)**. Ainda pendente: sem enforcement automático de que toda rota nova chama `authorize()`.
- **E-017 (Governança de IA)** — nota 7,2/7,1, gate não atingido. 2 incidentes reais (delegação recursiva de subagente, item de roadmap declarado fechado sem worker real) registrados retroativamente em `ai-governance.md` §5. Pendente: sem gate de evidência ponta-a-ponta para fechar item de ROADMAP (só cobre todo list); sem limite de profundidade de subagente.
- **E-019 (Jurídico/Contratual)** — nota 4,73→5,25/5,16→5,28, gate não atingido (o mais baixo). Fixes factuais em `third-party-inventory.md`. **Bloqueante real antes de WhatsApp com usuário real**: aviso de privacidade, DPA Meta formalmente aceito, residência de dados decidida — nenhum feito.
- **E-022 (Engenharia de Contexto)** — nota 6,84/10, gate não atingido. **Este próprio arquivo era o achado central** — reconciliado nesta sessão como D-236 (ver preâmbulo). Guardrail de `scripts/check-doc-drift.ts` também corrigido (checagem de bytes/palavras adicionada, ver `AGENTS.md` §6 e o próprio script). Achados factuais menores em `docs/architecture/README.md` já corrigidos.
- **E-023 (Qualidade de Engenharia)** — nota 8,17→8,32/8,84→8,34, gate não atingido (mais perto de todos). **Corrida intermitente entre `test/architecture/system-mutation-allowlist.test.ts` e `tenant-fence-boundary.test.ts` RESOLVIDA (D-272, 2026-09-11)** — causa raiz real identificada (dois processos `tsc`/vitest concorrentes compilando a árvore inteira, não um bug de agendamento interno) e corrigida com lock cross-processo, reproduzida e verificada de verdade. Único pendente restante deste eixo: `coverage.thresholds` em `vitest.config.ts` (decisão de Marcelo) — sem isso, uma nova rodada formal de nota provavelmente ainda não bate ≥9,0 neste critério específico.

## Auditoria crítica externa recebida 2026-09-12 (~8,2/10, não é rodada Claude↔Codex)

Documento completo: `docs/engineering/reviews/external-audit-2026-09-11-critica-repositorio.md`. 3 achados novos verificados diretamente contra código/GitHub real antes de registrar aqui (nunca aceitos só por alegação):
- **CI de `main` exige só o check `guardrails`** (confirmado via `gh api .../protection`) — `frontend`/`terraform`/`dynamodb-integration` rodam mas não bloqueiam merge se falharem. Achado novo, correção barata (required-status-check agregador).
- **`ReminderPolicy` permite N policies por item, frontend modela 1** — sem uniqueness fence (D-258 já citava como pendência menor; a auditoria eleva a P0). Decisão de domínio pendente: 1:1 com fence transacional vs. N explícito em toda a stack.
- **IP bruto na PK do guest rate limiter** (`document-archive-guest-rate-limiter.ts`, confirmado) — sem HMAC. Correção barata de privacidade.

Achados adicionais não verificados linha a linha ainda (ver documento completo): falta suíte "Real System E2E" contra `dev` (não mockada); `RequestContext` caro no hot path; Reminder Producer não sustenta o SLO declarado; Capacity Model desatualizado; sem load testing; frontend sem code-splitting; 2 boundaries async sem schema runtime validation. Achados que a auditoria cita mas já eram rastreados aqui (não são novidade): CSP/CORS, guest session binding, `createSeries` unicidade, filas do `reset-dev-data.ts`, `coverage.thresholds`.

## Pendências reais que dependem de decisão de Marcelo (lista consolidada)

1. Item 3 do backlog P1 (busca OCR/full-text) — escolher entre 3 caminhos nomeados em D-202.
2. Execução destrutiva real de `scripts/reset-dev-data.ts --confirm`/`--include-cognito` contra `dev` — postergado, não perguntar de novo até ele sinalizar.
3. `coverage.thresholds` em `vitest.config.ts` — ainda não decidido (E-023).
4. WhatsApp com usuário real (item 3 P0, engenharia 100% fechada desde D-246) — aviso de privacidade, DPA Meta, residência de dados (E-019); mais rota HTTP de opt-in ainda não construída (nomeada em D-246, não bloqueante para o resto).
5. Wave 1b (Design System) — quais componentes com overlay/focus-trap (`Combobox`/`DateInput`/`Tooltip`/`Popover`/`DropdownMenu`/`Modal`/`Drawer`/`Tabs`/`Pagination`/`Breadcrumb`/`Avatar`/`Card`) abordar primeiro — deliberadamente por último, por pedido de Marcelo.
6. User Validation (planejamento de interface) — aguarda sinal explícito dele.
7. Frontend completo do P0 (item 11) — adiado para depois do P0 fechar.
8. Aplicar ao **Claude for Startups Program** (`claude.com/programs/startups`, até US$25.000 em créditos de API, sem exigir VC) — projeto se encaixa no perfil, mas o cadastro exige dados da empresa/ação direta de Marcelo. Ver `docs/project/integrations-and-tooling-research-2026-09-11.md` §6.

## Próxima ação recomendada

**P0 (11 itens) FECHADO POR COMPLETO, incluindo o item 11 (frontend) — 2026-09-11.** As 25 telas do plano de sequenciamento (Blocos 0-10, D-254 a D-270) estão todas implementadas, testadas e revisadas. Histórico de como o plano de 25 telas/auditoria/sequenciamento convergiu (D-247/D-248/D-250/D-251/D-252/D-253) preservado em `decisions-log.md`, não recontado aqui.

**Análise geral do frontend + rodada Codex holística: CONCLUÍDA (D-271)**. E-023 (eixo mais perto do gate de engenharia): achado mecânico resolvido (D-272), só falta decisão de Marcelo (`coverage.thresholds`).

**`ExternalShareLink` slice 2/3 FECHADA (D-273), 2026-09-12 — todo item do backlog P1 exceto o item 3 (OCR/full-text, bloqueado por decisão de Marcelo) está fechado.** Mergeado `develop→main` e APLICADO em `dev` com sucesso (CD run 34704323049, 0 erro).

**D-273 (`ExternalShareLink` slice 2/3) mergeado `develop→main` (PR #303) e APLICADO em `dev` com sucesso** (CD run 34704323049, `Apply complete! Resources: 19 added, 96 changed, 4 destroyed` — exatamente o plano previsto, 0 erro). E-016 (`QUEUE_BASE_NAMES`) e os 2 achados menores de E-021 (fan-out + duplicação de hidratação GSI4) **CORRIGIDOS (D-274)**.

**Próximo passo imediato**: E-017 (gate de evidência ponta-a-ponta para fechar item de ROADMAP, limite de profundidade de subagente) é o único item decisão-independente restante do full-audit round2 ainda não tocado. E-015/E-019 dependem mais de decisão/produto que de engenharia pura. EMF/dashboard operacional (E-021) seguem nomeados, não triviais.

CSP/CORS (D-266/D-267, upload real browser→S3) segue como pendência nível 5-6 separada, própria rodada Claude↔Codex dedicada — ninguém ainda começou a escopar isso.

**Lição de processo desta sessão (ver `AGENTS.md` §1)**: default agora é fork serial (não orquestração paralela via Workflow) — mais barato em token, evita o "imposto" de recontextualização de agente fresco. Paralelizar só se Marcelo pedir velocidade explicitamente.

## Status de evidência (não presumir E2E sem checar)

A maioria dos mecanismos do roadmap P0/backlog P1 está `IMPLEMENTED`/`UNIT TESTED` e confirmada `Active` contra `dev` via `aws --profile claude-dev`, mas **nem todo mecanismo tem prova E2E de ponta a ponta disparando pelo gatilho real** (cron/SQS real, não só G-V3/unit) — isso é nomeado individualmente nas linhas do roadmap acima onde relevante ("nunca testado ponta a ponta com... real"). Não assumir E2E PROVEN sem checar a linha específica do item ou `decisions-log.md`.

## Links para histórico (não reler por padrão — só sob demanda)

- `docs/architecture/session-log.md` — linha do tempo compacta, uma entrada por sessão.
- `docs/architecture/decisions-log.md` / `docs/engineering/decisions-log.md` — toda decisão com nota Claude/Codex e status (D-0xx / E-0xx).
- `docs/architecture/reviews/` — artefatos de cada rodada Claude↔Codex por tema.
- `docs/project/handoffs/` — prompts de handoff de sessões anteriores, superseded por este arquivo.
- `docs/frontend/` — planejamento de interface + `interface-quality-standard.md` + `prototype/`.
- `docs/architecture/multi-user-b2b-wave-tracker.md` — detalhe fatia-a-fatia do Multi-User B2B (15 waves, D-084 a D-120).
