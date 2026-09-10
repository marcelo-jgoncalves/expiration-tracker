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
11. **Frontend completo do P0** — 🟡 planejamento + auditoria de qualidade + plano de sequenciamento CONCLUÍDOS (25/25 telas); **Bloco 0 (fundação) IMPLEMENTADO e VERIFICADO (D-254, 2026-09-10)**. Plano de 25 telas (D-247, `docs/frontend/p0-screen-inventory-plan.md`); os 3 gaps de backend/BFF fechados (D-248); as 24 specs concretas do Claude Design foram TODAS auditadas e revisadas (D-251) — 24/24 NOT PASS pré-revisão, corrigidas na própria auditoria; a 25ª (A10) foi escrita do zero e auditada em 2026-09-10 (D-252), WORLD-CLASS-READY de primeira. Plano de sequenciamento CONVERGIDO (D-253) — 11 blocos ordenados. **Bloco 0 (D-254)**: migração real de rotas para `/app/:orgId/...` (`OrgRouteGuard`/`LegacyOrgRedirect`/`useOrgPath`, caminhos antigos preservados como redirect), AppShell com navegação declarativa RBAC-aware (`shell/navigation.ts`), e os dois componentes de design system SLF-01 (`MetricCardGrid`, risk-prioritized) e SLF-05 (`GuestLinkUnavailable`) — todos reais, testados (204/204 unit+component, 35/35 E2E+visual, gate completo verde). Protocolo Claude↔Codex rodado 3x nesta rodada (2 tentativas não convergiram por limitação da ferramenta `codex exec` — gastou o orçamento relendo docs grandes do repo sem produzir veredito; a 3ª, com prompt reduzido e conteúdo inline, produziu "NEEDS FIXES" apontando 2 achados reais — nav RBAC escondendo "Membros" de papéis que a action real `membership:list-members`/READ_ONLY_ROLES permite ver, e o próprio `AppShell` ainda usando caminhos bare em vez de `useOrgPath()` — ambos corrigidos e revalidados; nota numérica formal ≥9.0 cega NÃO foi obtida desta vez, registrado honestamente em D-254, não substituído silenciosamente). **PRÓXIMA AÇÃO EXPLICITAMENTE AUTORIZADA POR MARCELO, sem esperar confirmação**: Bloco 1 (`docs/frontend/implementation-sequencing-plan.md` — A01/A02/A03/A19, reconciliar o código parcial já existente contra os achados CRITICAL de RBAC do D-251, não reescrever do zero). Rodar o protocolo Claude↔Codex novamente ao final do bloco, per o checklist de 10 itens do plano §4 — se a ferramenta `codex exec` voltar a não convergir num veredito, reduzir o prompt (conteúdo de arquivo inline, proibir reexploração de docs grandes) como funcionou desta vez, em vez de insistir no formato exploratório amplo.

## Nova capacidade fora do roadmap original: quota de armazenamento por tenant (D-249, 2026-09-09)

Marcelo identificou um gap real de produto: tenants não terão armazenamento ilimitado, e nada
rastreava bytes de armazenamento por tenant. **Mecanismo de backend (tracking/enforcement/leitura)
totalmente IMPLEMENTADO e testado** (D-249) — `TenantStorageQuota` (document-archive/domain),
enforcement fail-closed em `reserveFiles()`, contabilidade de 3 estados (`usedBytes`/
`reservedBytes`), rota `GET /document-archive/storage-usage` (`docarchive:read`). **A UI real
(A03/A19) permanece NÃO CONSTRUÍDA** — mesma situação do item 11 acima (frontend inteiro adiado até
Marcelo sinalizar); a especificação já foi atualizada em `p0-screen-inventory-plan.md` (addendum
datado, não reabre a convergência original). **Minha avaliação de prioridade (Marcelo não
especificou)**: NÃO é P0-blocking — nenhuma das 25 telas já planejadas depende de storage quota
para funcionar, e o roadmap competitivo de 11 itens não a menciona; é um **fast-follow** natural do
item 10 (Storage/Versioning/Renewal, já avançado) e deveria entrar no mesmo lote de frontend do item
11 quando esse trabalho começar, não bloquear seu início. **Número da quota CONFIRMADO por Marcelo
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
8. compartilhamento externo seguro (`ExternalShareLink`) — 🟡 design `APPROVED` (D-225), **slice 1/3 IMPLEMENTADO (D-241, domínio+persistência+serviço de aplicação, testado, gate local verde)**. Slices 2/3 (rota HTTP anônima, rotas autenticadas+RBAC+schemas, terraform) PAUSADAS deliberadamente — Marcelo pediu fechar o P0 inteiro antes de qualquer item novo do P1; retomar só depois disso. Último item do backlog P1 a implementar.
- **P2** (não escopado): assinatura eletrônica; API pública; webhooks; integrações de calendário; compliance score avançado.
- **Futuro** (sem gatilho comercial): portal completo do cliente; SSO/SCIM/controles enterprise.

## Full-audit round2 (`docs/engineering/joint-review-criteria.md`) — estado por eixo, 2026-09-07/08

Gate de fechamento é ≥9,0/10 nos dois avaliadores, sem arredondar. Nenhum eixo abaixo atingiu o gate ainda, exceto os 3 achados HIGH/ALTA já corrigidos nominalmente (linhas seguintes). Detalhe completo de cada eixo: `docs/engineering/decisions-log.md` E-0xx + `docs/engineering/reviews/full-audit-round2-*-summary.md`.

- **E-020 (Operações/SRE)** — achado ALTA (rollback quebrado, manifesto hardcodava 13 de 61 Lambdas) **CORRIGIDO (D-232)**: `scripts/generate-lambda-manifest.ts` gera o manifesto automaticamente a partir de `infra/*.tf`, `npm run check:lambda-manifest` CI-blocking.
- **E-018 (Segurança)/E-021 (Arquitetura), achado convergente (SEC-R2-02)** — lease de entrega de credencial guest quebrado (marcador reivindicado antes do envio SES) **CORRIGIDO (D-233)**: máquina `CLAIMED`→`DELIVERED`/`SEND_UNCERTAIN`. Achados menores de E-021 ainda pendentes: EMF/dashboard operacional ausente; fan-out sem cap em `onboarding-state.ts`/`resolve-active-membership.ts`.
- **E-018 (Segurança) — IAM least-privilege** — `dynamodb:Scan` **CORRIGIDO PARCIALMENTE (D-234)**: removido das políticas gerais tenant-facing, isolado aos 4 workers que fazem Scan cross-tenant. Risco residual documentado (LeadingKeys estático inviável para ~44 Lambdas HTTP) mitigado via `AuthorizedTenantId` + suíte adversarial (143 casos). **Propagação de `AuthorizedTenantId` aos key-builders de persistência: COMPLETA nos 4 módulos** (document-archive D-237, expiration D-238, subject D-239, organization D-240) — todo key-builder tenant-scoped dos 4 módulos agora exige o tipo branded, fechando o gap de compile-time que D-234 tinha deixado como follow-up.
- **E-015 (Privacidade)** — `DossierExportRun`/`ReportSubscriptionRun`/`ReportDeliveryAttempt` sem TTL **CORRIGIDO (D-235)**: `purgeAfterTtl` (30 dias) adicionado, TTL nativo DynamoDB. Pendente: critérios #1/#5/#6/#7 sem rodada de debate dedicada (retorno esperado baixo).
- **E-016 (Governança de Produto/Multi-tenant)** — nota 7,1/7,8, gate não atingido. Nenhum vazamento cross-tenant confirmado. Pendente: `reset-dev-data.ts`'s `QUEUE_BASE_NAMES` desatualizado (faltam filas pós-B2B-12); sem enforcement automático de que toda rota nova chama `authorize()`.
- **E-017 (Governança de IA)** — nota 7,2/7,1, gate não atingido. 2 incidentes reais (delegação recursiva de subagente, item de roadmap declarado fechado sem worker real) registrados retroativamente em `ai-governance.md` §5. Pendente: sem gate de evidência ponta-a-ponta para fechar item de ROADMAP (só cobre todo list); sem limite de profundidade de subagente.
- **E-019 (Jurídico/Contratual)** — nota 4,73→5,25/5,16→5,28, gate não atingido (o mais baixo). Fixes factuais em `third-party-inventory.md`. **Bloqueante real antes de WhatsApp com usuário real**: aviso de privacidade, DPA Meta formalmente aceito, residência de dados decidida — nenhum feito.
- **E-022 (Engenharia de Contexto)** — nota 6,84/10, gate não atingido. **Este próprio arquivo era o achado central** — reconciliado nesta sessão como D-236 (ver preâmbulo). Guardrail de `scripts/check-doc-drift.ts` também corrigido (checagem de bytes/palavras adicionada, ver `AGENTS.md` §6 e o próprio script). Achados factuais menores em `docs/architecture/README.md` já corrigidos.
- **E-023 (Qualidade de Engenharia)** — nota 8,17→8,32/8,84→8,34, gate não atingido (mais perto de todos). Pendente nível 3-4: corrida intermitente entre `test/architecture/system-mutation-allowlist.test.ts` e `tenant-fence-boundary.test.ts` (causa raiz não identificada, não é regressão de produção). Pendente maior: sem `coverage.thresholds` em `vitest.config.ts` (decisão de Marcelo).

## Pendências reais que dependem de decisão de Marcelo (lista consolidada)

1. Item 3 do backlog P1 (busca OCR/full-text) — escolher entre 3 caminhos nomeados em D-202.
2. Execução destrutiva real de `scripts/reset-dev-data.ts --confirm`/`--include-cognito` contra `dev` — postergado, não perguntar de novo até ele sinalizar.
3. `coverage.thresholds` em `vitest.config.ts` — ainda não decidido (E-023).
4. WhatsApp com usuário real (item 3 P0, engenharia 100% fechada desde D-246) — aviso de privacidade, DPA Meta, residência de dados (E-019); mais rota HTTP de opt-in ainda não construída (nomeada em D-246, não bloqueante para o resto).
5. Wave 1b (Design System) — quais componentes com overlay/focus-trap (`Combobox`/`DateInput`/`Tooltip`/`Popover`/`DropdownMenu`/`Modal`/`Drawer`/`Tabs`/`Pagination`/`Breadcrumb`/`Avatar`/`Card`) abordar primeiro — deliberadamente por último, por pedido de Marcelo.
6. User Validation (planejamento de interface) — aguarda sinal explícito dele.
7. Frontend completo do P0 (item 11) — adiado para depois do P0 fechar.

## Próxima ação recomendada

**Prioridade 1 CONCLUÍDA (2026-09-08, D-240)**: a propagação de `AuthorizedTenantId` (branded type criado em D-234) aos key-builders de persistência dos 4 módulos (document-archive D-237, expiration D-238, subject D-239, organization D-240) está fechada por inteiro — zero `as AuthorizedTenantId` fora de `authorization.ts`, suíte completa verde (2786/2786) na fatia final. Nada pendente desse item.

**Mudança de prioridade (Marcelo, 2026-09-08)**: fechar o P0 (roadmap de lançamento, 11 itens acima) por inteiro ANTES de qualquer item novo do backlog P1. `ExternalShareLink` (item 8/19 do P1) foi pausado de propósito em ponto limpo — slice 1/3 implementado e testado (D-241: domínio, persistência, `ExternalShareLinkService` completo — create/resolve-anônimo/revoke/list —, gate local verde), slices 2/3 (rota HTTP anônima `GET /external-share/{shareId}/{token}`, rotas autenticadas+RBAC `docarchive:share-link-*`+schemas, terraform se necessário) **NÃO iniciadas** — não retomar até o P0 fechar.

Por ordem sugerida, tudo dentro do P0 (itens ainda não 🟢 na lista acima):
1. Item 3 do P0 (WhatsApp operacional) — 🟢 **TODAS as 5/5 fatias de engenharia FECHADAS** (D-246 fecha a última). Fatia 3/5 **verificada ao vivo (D-242)**. Fatias 4/5 (D-245) e 5/5 (D-246) implementadas/testadas em `develop`, **terraform de ambas ainda não mergeado em `main`/aplicado em `dev`** — uma varredura coordenada única cobre as duas. Bloqueante à parte para uso com usuário real (E-019) e a rota HTTP de opt-in ainda não construída seguem fora do escopo de engenharia pura desta fatia.
2. Item 8 do P0 (Document Types) — 🟢 FECHADO (D-244 implementou o desenho `APPROVED` de D-243 por inteiro). Nada pendente.
3. Avançar qualquer eixo do full-audit-round2 com achado nível 3-4 pendente listado acima (E-016 QUEUE_BASE_NAMES, E-023 corrida intermitente) — não é P0 formalmente, mas é qualidade de engenharia do que já foi entregue.
4. Ou uma nova frente que Marcelo trouxer.

**Instrução permanente para quando o item 11 (Frontend completo do P0) for o único item do P0 restante** (Marcelo, 2026-09-08): antes de prototipar qualquer tela, fazer um levantamento minucioso de quais telas são necessárias para o lançamento, via protocolo Claude↔Codex EM DUAS ETAPAS — (1) pesquisa na web + protocolo para estabelecer os critérios de avaliação dessa engenharia/arquitetura de telas; (2) só depois, protocolo para definir o conjunto de telas em si, usando os critérios convergidos na etapa 1. Ao convergir, salvar o planejamento final em um documento dedicado (`docs/frontend/` — nome a definir na hora) cujo objetivo explícito é dar ao Claude Design informação suficiente para construir o protótipo das telas com assertividade e coerência com o restante do projeto. Não iniciar isso enquanto outros itens do P0 ainda estiverem abertos.

**CONCLUÍDO (D-247, 2026-09-09)**: as duas etapas acima convergiram — `docs/frontend/p0-screen-inventory-plan.md` (25 telas, autocontido, ver D-247 no `decisions-log.md` e `docs/architecture/reviews/p0-frontend-screens-scoping/` para o trilho completo de evidência). Os 3 gaps de backend/BFF (G2/G3/G4) foram fechados em D-248 (mesmo dia). Uma sessão separada do Claude Design gerou 24 specs concretas de tela a partir desse plano (`docs/frontend/prototype-screen-specs/`, ver a nota de proveniência/lacuna A10 no `README.md` dessa pasta).

**AUDITORIA DAS 24 SPECS — COMPLETA (D-251, 2026-09-10).** As 6 lotes (A01-A04, A05-A08,
A09/A11-A13, A14-A17, A18-A21, A22/A23/G01/G02) foram todos concluídos com o mesmo processo (1
rodada blind Codex + 1 reconciliação Claude por lote) contra `docs/frontend/screen-spec-audit-rubric.md`
(D-250) — resultado agregado, tabela completa, todos os achados de sistema (SLF-01 a SLF-05, todos
CONFIRMADOS e fechados) e as 6 CRITICALs (A05, A16, A19-cluster, A22, A23, G01+G02) estão em
`docs/architecture/reviews/screen-spec-audit-2026-09-09/estado-final-consolidado.md` — **ler esse
arquivo antes de qualquer trabalho novo de frontend**, não recontar aqui. Resultado: **24/24 telas
NOT PASS** (25.4-50.2/100 consolidado) — nenhuma passou nem o piso de Baseline Pass; as 24 specs em
`docs/frontend/prototype-screen-specs/` foram todas revisadas em resposta aos achados (versões
pré-auditoria estão superadas). `npm run check-docs` verde após o lote final.

**Lacuna A10 fechada (2026-09-10, D-252)**: `A10-rastreamento-legado.md` foi escrita do zero (nunca
gerada pelo pacote original do Claude Design) e auditada contra o mesmo rubric —
WORLD-CLASS-READY (Functional 94.0/Visual 92.0/Consolidado 92.4), a única das 25 telas a passar de
primeira. Ver `docs/architecture/reviews/screen-spec-audit-2026-09-09/A10-audit-record.md` e
`estado-final-consolidado.md` (tabela agregada agora com 25/25 telas). O conjunto de specs do plano
de 25 telas está **completo e auditado**.

**Lacuna real ainda aberta**: **Plano de sequenciamento de implementação** (ordem de construção das
25 telas, estratégia de teste por tela, integração com o AppShell já existente) — decisão real ainda
não tomada. Marcelo já autorizou prosseguir nisso via o mesmo protocolo Claude↔Codex sem esperar por
ele na resolução em si (mesma autonomia já concedida para o resto deste projeto).

**Próximo passo autorizado, sem esperar sinal de Marcelo**: resolver o plano de sequenciamento de
implementação via protocolo Claude↔Codex, e então começar a implementação real de frontend por
blocos de telas, rodando o mesmo protocolo de novo após cada bloco implementado.

Quando o P0 fechar por inteiro (exceto o item 11, tratado pela instrução acima): retomar `ExternalShareLink` a partir do slice 2/3 (ver D-241) — domínio/persistência já prontos, só falta a camada HTTP/RBAC/schemas/terraform.

## Status de evidência (não presumir E2E sem checar)

A maioria dos mecanismos do roadmap P0/backlog P1 está `IMPLEMENTED`/`UNIT TESTED` e confirmada `Active` contra `dev` via `aws --profile claude-dev`, mas **nem todo mecanismo tem prova E2E de ponta a ponta disparando pelo gatilho real** (cron/SQS real, não só G-V3/unit) — isso é nomeado individualmente nas linhas do roadmap acima onde relevante ("nunca testado ponta a ponta com... real"). Não assumir E2E PROVEN sem checar a linha específica do item ou `decisions-log.md`.

## Links para histórico (não reler por padrão — só sob demanda)

- `docs/architecture/session-log.md` — linha do tempo compacta, uma entrada por sessão.
- `docs/architecture/decisions-log.md` / `docs/engineering/decisions-log.md` — toda decisão com nota Claude/Codex e status (D-0xx / E-0xx).
- `docs/architecture/reviews/` — artefatos de cada rodada Claude↔Codex por tema.
- `docs/project/handoffs/` — prompts de handoff de sessões anteriores, superseded por este arquivo.
- `docs/frontend/` — planejamento de interface + `interface-quality-standard.md` + `prototype/`.
- `docs/architecture/multi-user-b2b-wave-tracker.md` — detalhe fatia-a-fatia do Multi-User B2B (15 waves, D-084 a D-120).
