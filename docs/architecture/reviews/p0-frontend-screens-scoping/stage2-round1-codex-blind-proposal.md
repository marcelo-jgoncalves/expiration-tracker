OpenAI Codex v0.147.0
--------
workdir: C:\Users\Usuario\Desktop\projects\expiration-tracker
model: gpt-5.6-sol
provider: openai
approval: never
sandbox: workspace-write [workdir, /tmp, $TMPDIR]
reasoning effort: none
reasoning summaries: none
session id: 01a083e1-181b-7c40-9536-f0757e237efd
--------
user
You are Codex, acting as an independent reviewer/co-author in a Claude<->Codex protocol
(AGENTS.md paragraph 4). BLIND round: you have not seen Claude's Stage 2 proposal.

CONTEXT: expiration-tracker repo. B2B SaaS tracking compliance-document expirations. Multi-tenant
(Organization/Membership), RBAC roles OWNER/ADMIN/MEMBER/VIEWER. Backend for the entire P0 launch
roadmap (11 items, docs/project/roadmap-competitivo-2026-09-01.md) is done except item 11: the
frontend. Stage 1 of this protocol already converged a grading rubric (reproduced below). Your
task now (Stage 2): independently read the ACTUAL backend code in this repo and propose the
concrete screen/view inventory needed for P0 launch, to be graded against that rubric.

READ FOR REAL, in this repo, before answering (do not guess/invent capabilities):
- src/modules/identity/domain/authorization.ts — the full `Action` union and `ACTION_ROLES` map
  is the ground truth for what each of OWNER/ADMIN/MEMBER/VIEWER can do. Every action needs a
  home in some screen, or must be named a deliberate P0 deferral.
- src/modules/organization/ (Organization, Membership, Invitation - multi-tenant structure/onboarding)
- src/modules/document-archive/ (Document, DocumentVersion, Requirement, DocumentType,
  RequirementTemplate, guest upload+review, dossier export, document requests/recurrence - this
  is the core domain)
- src/modules/subject/ (TrackedSubject, RequirementAssignment, document chasing - an OLDER,
  still-live PARALLEL domain to document-archive's Requirement - see the D-116 naming-collision
  comment inside authorization.ts around the `docarchive:requirement-*` actions for why these are
  deliberately separate, not duplicated)
- src/modules/expiration/ (ExpirationItem - the original core entity, still live)
- src/modules/notification/ (channels EMAIL/WhatsApp, escalation, digests, preferences)
- docs/frontend/ - especially interface-screen-and-state-inventory.md (an OLDER 17-surface
  inventory that PREDATES document-archive/organization/multi-tenant-B2B - reuse its state-
  taxonomy discipline (loading/empty/error subtypes, persistence vs visibility distinction) but
  do NOT treat its surface list as current or complete - the backend has grown enormously since)
- docs/project/roadmap-competitivo-2026-09-01.md (the 11 P0 items, to know what needs a screen)

=== STAGE 1's CONVERGED RUBRIC (grade your own Stage 2 answer against this) ===

8 weighted axes / 100 points:
1. Backend-to-interface completeness and traceability (18) - every Action/capability maps to a
   screen or is recorded DEFERRED under a 6-condition rule (out of P0 scope; concrete reason;
   destination milestone/trigger; dependencies named; no P0 journey dangles on it; recorded as
   DEFERRED not silently dropped).
2. Journey/navigation/screen-graph coherence (14) - every screen has entry points, exits, next
   steps; no orphans/dead ends; cross-references agree both directions.
3. RBAC-aware visibility and action model (14) - per screen AND per action, which roles can
   discover/view/invoke/administer it; no actionable-looking control for a role that can't use it.
4. State, feedback, recovery coverage (14) - loading/empty/success/validation/error/retry/
   unavailable PLUS domain-specific states (OCC conflict, partial import failure, expired/revoked
   guest link, authorization denial, anti-enumeration collapse); actionable recovery, not "handle
   errors."
5. Multi-tenant organization context and isolation UX (10) - active org unambiguous, switch
   behavior/persistence, no misleading cross-tenant transitions, stale-link/invitation handling.
6. Guest/authenticated surface separation (8) - structural, not visual; guest entry/limited
   capabilities/expiry/revocation/escalation/safe-failure without leaking resource existence.
7. Responsive/mobile/accessibility planning (12) - per-screen responsive treatment stated
   explicitly (full parity / transformation / degradation / desktop-only-with-reason); keyboard/
   focus/reflow/target-size/status-announcement coverage.
8. Zero-context handoff quality and internal consistency (10) - a downstream design tool with NO
   session history can build each screen without an avoidable clarifying question; roles/states/
   terminology/backend facts restated inline, consistently.

Evidence-sufficiency gate (not a scored 9th axis): capability->surface traceability; surface->
capability reverse map; role x surface x action rules; route/nav hierarchy; journey x surface
coverage; per-screen state coverage; org-context/switching rules; guest/auth boundary spec;
per-screen responsive/accessibility notes; assumption/gap/deferral register.

=== YOUR TASK ===

Propose the full screen inventory for BOTH the authenticated tenant app AND the guest-facing
surface. For each screen give: name/route, purpose, primary entities/fields shown, actions
mapped to real Actions from authorization.ts (state which roles), states (generic + domain-
specific), and how it connects to other screens (entry points / what it links to-from). Name
anything that is a genuine backend gap as DEFERRED per the 6-condition rule (do not invent
screens for capabilities that don't exist, and do not silently omit capabilities that do exist -
grep the codebase for the real routes/actions, don't guess). End with your own self-score out of
10 against the 8-axis rubric above, naming at least one honest weakness.

Write your full answer as plain text/markdown to stdout. Do not ask clarifying questions.

codex
Vou executar a revisão cega diretamente no código e nos documentos indicados. Primeiro levanto ações, rotas e entidades reais; depois monto as matrizes bidirecionais e o inventário de telas com estados, RBAC, navegação e responsividade.
exec
"C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -Command 'Get-Content -Raw NEXT_SESSION_PROMPT.md; Get-Content -Raw docs/architecture/README.md; Get-Content -Raw docs/engineering/README.md; Get-Content -Raw docs/frontend/README.md' in C:\Users\Usuario\Desktop\projects\expiration-tracker
 succeeded in 2113ms:
# Expiration Tracker â€” Estado Atual + PrÃ³xima AÃ§Ã£o

> Este arquivo Ã© estado atual + prÃ³xima aÃ§Ã£o (`AGENTS.md` Â§2), nunca fonte normativa e nunca histÃ³rico narrativo â€” histÃ³ria detalhada vive em `docs/architecture/{session-log,decisions-log}.md`, `docs/engineering/decisions-log.md` e nas pastas `reviews/`. Cada linha abaixo deve caber em 1-3 frases: o quÃª + status + referÃªncia D-xxx/E-xxx para detalhe completo. **Recompactado em 2026-09-08 (D-236, segunda reconciliaÃ§Ã£o de engenharia de contexto â€” a de 2026-08-29 jÃ¡ tinha feito isso uma vez, 1067â†’78 linhas; o arquivo tinha reacumulado ~134 KB/~15.600 palavras em sÃ³ ~299 linhas, achado E-022/full-audit-round2, nota 6,84/10).** Antes de adicionar uma entrada nova aqui: se o D-nÃºmero/E-nÃºmero jÃ¡ tem linha completa em `decisions-log.md` (deveria sempre ter), esta seÃ§Ã£o sÃ³ recebe 1-3 frases â€” nunca reconte a narrativa.

## Branch / as-of

**NÃ£o confie nesta seÃ§Ã£o sem confirmar.** `git branch --show-current` deve ser `develop`; `git log --oneline -5`, `git status` e `git pull` antes de assumir qualquer coisa abaixo como pendente ou concluÃ­do â€” mÃºltiplas sessÃµes/agentes trabalham neste repo em paralelo.

**PadrÃ£o de trabalho autÃ´nomo (Marcelo, 2026-09-01, vale para toda sessÃ£o futura)**: prosseguir continuamente enquanto houver trabalho de engenharia real a fazer â€” nunca parar para pedir "posso continuar?". SÃ³ pausar/perguntar quando o prÃ³ximo passo depender genuinamente de decisÃ£o exclusiva de Marcelo (produto/arquitetura, execuÃ§Ã£o destrutiva/irreversÃ­vel, gasto de infra nÃ£o trivial, ou algo que `AGENTS.md` Â§4 exige elevar a ele). Nesses casos: registrar o pendente aqui/`decisions-log.md`, seguir para outra frente independente, nunca ficar ocioso.

## Fase atual

`Consolidation + Pilot Readiness` com recomendaÃ§Ã£o **CONDITIONAL GO**. M0-M12 (exceto billing/D-052, bloqueado por fornecedor) e Multi-User B2B (15 waves, D-084 a D-120) implementados e deployados. DomÃ­nio Documental completo (D-143 a D-235, ver roadmap abaixo). Full-audit-round2 (auditoria cÃ­clica por eixo, `docs/engineering/joint-review-criteria.md`) em andamento desde 2026-09-07 â€” ver seÃ§Ã£o dedicada abaixo para o que estÃ¡ aberto por eixo.

## Roadmap de lanÃ§amento (`docs/project/roadmap-competitivo-2026-09-01.md`) â€” 11 itens P0

1. **Requirement Templates** â€” ðŸŸ¢ IMPLEMENTADO (D-191).
2. **Bulk import (Documents+Requirements+column mapping)** â€” ðŸŸ¢ IMPLEMENTADO (D-192).
3. **WhatsApp operacional** â€” ðŸŸ¢ **IMPLEMENTADO POR COMPLETO do lado de engenharia, D-197/ADR-0012, TODAS as 5/5 fatias (D-246 fecha a fatia 5/5 â€” router wiring `notification-router.ts`'s `SUPPORTED_CHANNELS`â†’`isChannelRoutable()` + kill switch no handler + RBAC confirmado sem gap + terraform completo)**. Fatia 3/5 **VERIFICADA AO VIVO em `dev`** (D-242). Fatias 4/5 (D-245) e 5/5 (D-246) implementadas/testadas em `develop`, **terraform de AMBAS ainda NÃƒO mergeado em `main`/aplicado em `dev`** â€” prÃ³xima sessÃ£o decide quando (varredura coordenada Ãºnica para as duas). **Restam sÃ³**: (1) o `terraform apply`/merge-para-`main` pendente das fatias 4/5+5/5; (2) o bloqueio de produto/jurÃ­dico E-019 (aviso de privacidade, DPA Meta formalmente aceito, residÃªncia de dados decidida â€” nenhum feito ainda, fora do controle de engenharia; as credenciais reais da Meta no secret tambÃ©m dependem disso); (3) pendÃªncia nomeada nÃ£o bloqueante â€” nenhuma rota HTTP existe ainda para `WhatsAppOptInService.recordOptIn()`, entÃ£o nenhum usuÃ¡rio real consegue opt-in hoje mesmo com tudo mais pronto (nunca esteve no escopo de nenhuma das 5 fatias do design, D-246). Nenhuma fatia de engenharia resta.
4. **IA/OCR no Document Lifecycle** â€” ðŸŸ¢ IMPLEMENTADO por completo (D-193). Flags `EXTRACTION_DOCUMENT_ARCHIVE_TRIGGER_ENABLED`/`DOCUMENT_ARCHIVE_PROMOTION_ENABLED` deliberadamente OFF (ativaÃ§Ã£o Ã© decisÃ£o futura reversÃ­vel).
5. **Busca e filtros documentais** â€” ðŸŸ¢ IMPLEMENTADO fatias 1-3 (D-194/D-196). Fatias 4-5 (projeÃ§Ã£o materializada+GSI10, Ã­ndice por assignee) DEFERIDAS com gatilho quantitativo nomeado em D-194 â€” nÃ£o bloqueante.
6. **Dashboard operacional/compliance** â€” ðŸŸ¢ IMPLEMENTADO (D-196).
7. **RelatÃ³rios + exportaÃ§Ã£o + audit trail** â€” ðŸŸ¢ IMPLEMENTADO fatias 1-4 (D-195). Fora de escopo, nomeado: "solicitaÃ§Ãµes pendentes" (sem GSI tenant-wide por status) e audit trail legÃ­vel para negÃ³cio.
8. **Document Types configurÃ¡veis** â€” ðŸŸ¢ IMPLEMENTADO (D-173 a D-186, D-221, D-224, D-243, D-244): CRUD, RBAC, metadata configurÃ¡vel, leitura pÃºblica para guest, e `documentTypeId` agora OBRIGATÃ“RIO no schema HTTP do guest submit-evidence (corte Ãºnico, `documentType` livre removido por completo) â€” D-244 codou o desenho `APPROVED` de D-243 por inteiro (schema+serviÃ§o+9/9 testes do checklist), gate local completo verde.
9. **Consolidar Guest Upload + Requests + Review + Recurrence** â€” ðŸŸ¢ FECHADO POR INTEIRO (D-222/D-226 a D-230). Ciclo completo (criarâ†’emitir credencialâ†’entregarâ†’resolver) funciona nos dois caminhos (avulso e recorrÃªncia), provado por teste e2e real.
10. **Consolidar Storage + Versioning + Renewal** â€” ðŸŸ¢ avanÃ§ado; `DocumentFile` fechado por completo (D-163 a D-168).
11. **Frontend completo do P0** â€” âŒ explicitamente adiado por Marcelo (2026-09-04) â€” nÃ£o iniciar.

## Backlog pÃ³s-lanÃ§amento P1 (autorizado 2026-09-04)

1. reminder sequences configurÃ¡veis â€” ðŸŸ¢ DONE (M3).
2. escalation/mÃºltiplos destinatÃ¡rios â€” ðŸŸ¢ FECHADO (D-199 a D-201).
3. busca OCR/full-text â€” ðŸ”´ **BLOQUEADO**, pendente decisÃ£o de Marcelo entre 3 caminhos nomeados em D-202 â€” nÃ£o Ã© o prÃ³ximo item executÃ¡vel sem essa decisÃ£o.
4. relatÃ³rios agendados â€” ðŸŸ¢ FECHADO POR COMPLETO (D-204/D-211 a D-215).
5. dossiÃª documental PDF/Excel â€” ðŸŸ¢ FECHADO POR COMPLETO (D-205/D-216/D-217). TTL de retenÃ§Ã£o do metadado fechado depois (D-235).
6. bulk actions â€” ðŸŸ¢ FECHADO POR COMPLETO (D-206/D-207/D-209/D-210).
7. metadata configurÃ¡vel por Document Type â€” ðŸŸ¢ FECHADO POR COMPLETO (D-218 a D-221).
8. compartilhamento externo seguro (`ExternalShareLink`) â€” ðŸŸ¡ design `APPROVED` (D-225), **slice 1/3 IMPLEMENTADO (D-241, domÃ­nio+persistÃªncia+serviÃ§o de aplicaÃ§Ã£o, testado, gate local verde)**. Slices 2/3 (rota HTTP anÃ´nima, rotas autenticadas+RBAC+schemas, terraform) PAUSADAS deliberadamente â€” Marcelo pediu fechar o P0 inteiro antes de qualquer item novo do P1; retomar sÃ³ depois disso. Ãšltimo item do backlog P1 a implementar.
- **P2** (nÃ£o escopado): assinatura eletrÃ´nica; API pÃºblica; webhooks; integraÃ§Ãµes de calendÃ¡rio; compliance score avanÃ§ado.
- **Futuro** (sem gatilho comercial): portal completo do cliente; SSO/SCIM/controles enterprise.

## Full-audit round2 (`docs/engineering/joint-review-criteria.md`) â€” estado por eixo, 2026-09-07/08

Gate de fechamento Ã© â‰¥9,0/10 nos dois avaliadores, sem arredondar. Nenhum eixo abaixo atingiu o gate ainda, exceto os 3 achados HIGH/ALTA jÃ¡ corrigidos nominalmente (linhas seguintes). Detalhe completo de cada eixo: `docs/engineering/decisions-log.md` E-0xx + `docs/engineering/reviews/full-audit-round2-*-summary.md`.

- **E-020 (OperaÃ§Ãµes/SRE)** â€” achado ALTA (rollback quebrado, manifesto hardcodava 13 de 61 Lambdas) **CORRIGIDO (D-232)**: `scripts/generate-lambda-manifest.ts` gera o manifesto automaticamente a partir de `infra/*.tf`, `npm run check:lambda-manifest` CI-blocking.
- **E-018 (SeguranÃ§a)/E-021 (Arquitetura), achado convergente (SEC-R2-02)** â€” lease de entrega de credencial guest quebrado (marcador reivindicado antes do envio SES) **CORRIGIDO (D-233)**: mÃ¡quina `CLAIMED`â†’`DELIVERED`/`SEND_UNCERTAIN`. Achados menores de E-021 ainda pendentes: EMF/dashboard operacional ausente; fan-out sem cap em `onboarding-state.ts`/`resolve-active-membership.ts`.
- **E-018 (SeguranÃ§a) â€” IAM least-privilege** â€” `dynamodb:Scan` **CORRIGIDO PARCIALMENTE (D-234)**: removido das polÃ­ticas gerais tenant-facing, isolado aos 4 workers que fazem Scan cross-tenant. Risco residual documentado (LeadingKeys estÃ¡tico inviÃ¡vel para ~44 Lambdas HTTP) mitigado via `AuthorizedTenantId` + suÃ­te adversarial (143 casos). **PropagaÃ§Ã£o de `AuthorizedTenantId` aos key-builders de persistÃªncia: COMPLETA nos 4 mÃ³dulos** (document-archive D-237, expiration D-238, subject D-239, organization D-240) â€” todo key-builder tenant-scoped dos 4 mÃ³dulos agora exige o tipo branded, fechando o gap de compile-time que D-234 tinha deixado como follow-up.
- **E-015 (Privacidade)** â€” `DossierExportRun`/`ReportSubscriptionRun`/`ReportDeliveryAttempt` sem TTL **CORRIGIDO (D-235)**: `purgeAfterTtl` (30 dias) adicionado, TTL nativo DynamoDB. Pendente: critÃ©rios #1/#5/#6/#7 sem rodada de debate dedicada (retorno esperado baixo).
- **E-016 (GovernanÃ§a de Produto/Multi-tenant)** â€” nota 7,1/7,8, gate nÃ£o atingido. Nenhum vazamento cross-tenant confirmado. Pendente: `reset-dev-data.ts`'s `QUEUE_BASE_NAMES` desatualizado (faltam filas pÃ³s-B2B-12); sem enforcement automÃ¡tico de que toda rota nova chama `authorize()`.
- **E-017 (GovernanÃ§a de IA)** â€” nota 7,2/7,1, gate nÃ£o atingido. 2 incidentes reais (delegaÃ§Ã£o recursiva de subagente, item de roadmap declarado fechado sem worker real) registrados retroativamente em `ai-governance.md` Â§5. Pendente: sem gate de evidÃªncia ponta-a-ponta para fechar item de ROADMAP (sÃ³ cobre todo list); sem limite de profundidade de subagente.
- **E-019 (JurÃ­dico/Contratual)** â€” nota 4,73â†’5,25/5,16â†’5,28, gate nÃ£o atingido (o mais baixo). Fixes factuais em `third-party-inventory.md`. **Bloqueante real antes de WhatsApp com usuÃ¡rio real**: aviso de privacidade, DPA Meta formalmente aceito, residÃªncia de dados decidida â€” nenhum feito.
- **E-022 (Engenharia de Contexto)** â€” nota 6,84/10, gate nÃ£o atingido. **Este prÃ³prio arquivo era o achado central** â€” reconciliado nesta sessÃ£o como D-236 (ver preÃ¢mbulo). Guardrail de `scripts/check-doc-drift.ts` tambÃ©m corrigido (checagem de bytes/palavras adicionada, ver `AGENTS.md` Â§6 e o prÃ³prio script). Achados factuais menores em `docs/architecture/README.md` jÃ¡ corrigidos.
- **E-023 (Qualidade de Engenharia)** â€” nota 8,17â†’8,32/8,84â†’8,34, gate nÃ£o atingido (mais perto de todos). Pendente nÃ­vel 3-4: corrida intermitente entre `test/architecture/system-mutation-allowlist.test.ts` e `tenant-fence-boundary.test.ts` (causa raiz nÃ£o identificada, nÃ£o Ã© regressÃ£o de produÃ§Ã£o). Pendente maior: sem `coverage.thresholds` em `vitest.config.ts` (decisÃ£o de Marcelo).

## PendÃªncias reais que dependem de decisÃ£o de Marcelo (lista consolidada)

1. Item 3 do backlog P1 (busca OCR/full-text) â€” escolher entre 3 caminhos nomeados em D-202.
2. ExecuÃ§Ã£o destrutiva real de `scripts/reset-dev-data.ts --confirm`/`--include-cognito` contra `dev` â€” postergado, nÃ£o perguntar de novo atÃ© ele sinalizar.
3. `coverage.thresholds` em `vitest.config.ts` â€” ainda nÃ£o decidido (E-023).
4. WhatsApp com usuÃ¡rio real (item 3 P0, engenharia 100% fechada desde D-246) â€” aviso de privacidade, DPA Meta, residÃªncia de dados (E-019); mais rota HTTP de opt-in ainda nÃ£o construÃ­da (nomeada em D-246, nÃ£o bloqueante para o resto).
5. Wave 1b (Design System) â€” quais componentes com overlay/focus-trap (`Combobox`/`DateInput`/`Tooltip`/`Popover`/`DropdownMenu`/`Modal`/`Drawer`/`Tabs`/`Pagination`/`Breadcrumb`/`Avatar`/`Card`) abordar primeiro â€” deliberadamente por Ãºltimo, por pedido de Marcelo.
6. User Validation (planejamento de interface) â€” aguarda sinal explÃ­cito dele.
7. Frontend completo do P0 (item 11) â€” adiado para depois do P0 fechar.

## PrÃ³xima aÃ§Ã£o recomendada

**Prioridade 1 CONCLUÃDA (2026-09-08, D-240)**: a propagaÃ§Ã£o de `AuthorizedTenantId` (branded type criado em D-234) aos key-builders de persistÃªncia dos 4 mÃ³dulos (document-archive D-237, expiration D-238, subject D-239, organization D-240) estÃ¡ fechada por inteiro â€” zero `as AuthorizedTenantId` fora de `authorization.ts`, suÃ­te completa verde (2786/2786) na fatia final. Nada pendente desse item.

**MudanÃ§a de prioridade (Marcelo, 2026-09-08)**: fechar o P0 (roadmap de lanÃ§amento, 11 itens acima) por inteiro ANTES de qualquer item novo do backlog P1. `ExternalShareLink` (item 8/19 do P1) foi pausado de propÃ³sito em ponto limpo â€” slice 1/3 implementado e testado (D-241: domÃ­nio, persistÃªncia, `ExternalShareLinkService` completo â€” create/resolve-anÃ´nimo/revoke/list â€”, gate local verde), slices 2/3 (rota HTTP anÃ´nima `GET /external-share/{shareId}/{token}`, rotas autenticadas+RBAC `docarchive:share-link-*`+schemas, terraform se necessÃ¡rio) **NÃƒO iniciadas** â€” nÃ£o retomar atÃ© o P0 fechar.

Por ordem sugerida, tudo dentro do P0 (itens ainda nÃ£o ðŸŸ¢ na lista acima):
1. Item 3 do P0 (WhatsApp operacional) â€” ðŸŸ¢ **TODAS as 5/5 fatias de engenharia FECHADAS** (D-246 fecha a Ãºltima). Fatia 3/5 **verificada ao vivo (D-242)**. Fatias 4/5 (D-245) e 5/5 (D-246) implementadas/testadas em `develop`, **terraform de ambas ainda nÃ£o mergeado em `main`/aplicado em `dev`** â€” uma varredura coordenada Ãºnica cobre as duas. Bloqueante Ã  parte para uso com usuÃ¡rio real (E-019) e a rota HTTP de opt-in ainda nÃ£o construÃ­da seguem fora do escopo de engenharia pura desta fatia.
2. Item 8 do P0 (Document Types) â€” ðŸŸ¢ FECHADO (D-244 implementou o desenho `APPROVED` de D-243 por inteiro). Nada pendente.
3. AvanÃ§ar qualquer eixo do full-audit-round2 com achado nÃ­vel 3-4 pendente listado acima (E-016 QUEUE_BASE_NAMES, E-023 corrida intermitente) â€” nÃ£o Ã© P0 formalmente, mas Ã© qualidade de engenharia do que jÃ¡ foi entregue.
4. Ou uma nova frente que Marcelo trouxer.

**InstruÃ§Ã£o permanente para quando o item 11 (Frontend completo do P0) for o Ãºnico item do P0 restante** (Marcelo, 2026-09-08): antes de prototipar qualquer tela, fazer um levantamento minucioso de quais telas sÃ£o necessÃ¡rias para o lanÃ§amento, via protocolo Claudeâ†”Codex EM DUAS ETAPAS â€” (1) pesquisa na web + protocolo para estabelecer os critÃ©rios de avaliaÃ§Ã£o dessa engenharia/arquitetura de telas; (2) sÃ³ depois, protocolo para definir o conjunto de telas em si, usando os critÃ©rios convergidos na etapa 1. Ao convergir, salvar o planejamento final em um documento dedicado (`docs/frontend/` â€” nome a definir na hora) cujo objetivo explÃ­cito Ã© dar ao Claude Design informaÃ§Ã£o suficiente para construir o protÃ³tipo das telas com assertividade e coerÃªncia com o restante do projeto. NÃ£o iniciar isso enquanto outros itens do P0 ainda estiverem abertos.

Quando o P0 fechar por inteiro (exceto o item 11, tratado pela instruÃ§Ã£o acima): retomar `ExternalShareLink` a partir do slice 2/3 (ver D-241) â€” domÃ­nio/persistÃªncia jÃ¡ prontos, sÃ³ falta a camada HTTP/RBAC/schemas/terraform.

## Status de evidÃªncia (nÃ£o presumir E2E sem checar)

A maioria dos mecanismos do roadmap P0/backlog P1 estÃ¡ `IMPLEMENTED`/`UNIT TESTED` e confirmada `Active` contra `dev` via `aws --profile claude-dev`, mas **nem todo mecanismo tem prova E2E de ponta a ponta disparando pelo gatilho real** (cron/SQS real, nÃ£o sÃ³ G-V3/unit) â€” isso Ã© nomeado individualmente nas linhas do roadmap acima onde relevante ("nunca testado ponta a ponta com... real"). NÃ£o assumir E2E PROVEN sem checar a linha especÃ­fica do item ou `decisions-log.md`.

## Links para histÃ³rico (nÃ£o reler por padrÃ£o â€” sÃ³ sob demanda)

- `docs/architecture/session-log.md` â€” linha do tempo compacta, uma entrada por sessÃ£o.
- `docs/architecture/decisions-log.md` / `docs/engineering/decisions-log.md` â€” toda decisÃ£o com nota Claude/Codex e status (D-0xx / E-0xx).
- `docs/architecture/reviews/` â€” artefatos de cada rodada Claudeâ†”Codex por tema.
- `docs/project/handoffs/` â€” prompts de handoff de sessÃµes anteriores, superseded por este arquivo.
- `docs/frontend/` â€” planejamento de interface + `interface-quality-standard.md` + `prototype/`.
- `docs/architecture/multi-user-b2b-wave-tracker.md` â€” detalhe fatia-a-fatia do Multi-User B2B (15 waves, D-084 a D-120).

# docs/architecture/ â€” Ãndice e Mapa de Autoridade

```text
Design maturity:        APPROVED (arquitetura conceitual + Implementation Blueprint)
Operational architecture: NOT APPROVED
Current phase:           ImplementaÃ§Ã£o real (cÃ³digo/infra/testes) â€” Implementation Blueprint concluÃ­do
Last verified:           2026-08-29 (reconciliaÃ§Ã£o de engenharia de contexto â€” este bloco reescrito para corrigir drift real: dizia "auto-CONFIRMED nÃ£o propaga dueDate, aguardando decisÃ£o do Marcelo" e "8 de 9 classes de retenÃ§Ã£o sem purga" quando D-058/D-061 jÃ¡ tinham decidido e implementado ambos em sessÃµes anteriores). Consolidation + Pilot Readiness Program concluÃ­do, recomendaÃ§Ã£o **CONDITIONAL GO** (`docs/engineering/pilot-readiness-assessment.md`, backlog item-a-item em `pilot-readiness-program.md`): Wave 3 (tenant isolation/LGPD) `DONE` de ponta a ponta, zero vulnerabilidade cross-tenant real; `USER_DOCUMENT` e `EXTRACTION_TRANSIENT` tÃªm purga fÃ­sica real (D-061), as outras 7 de 9 classes de retenÃ§Ã£o LGPD nÃ£o tÃªm, decisÃ£o de escopo pendente do Marcelo; Wave 4 confirmou `tenantId=userId` literal, sem Organization/Membership; Wave 5 fechou GTR-01. M6/M7/M9/M10/M11 deployados em `main`/`dev`, M7 **E2E PROVEN** (verificaÃ§Ã£o real 2026-08-27, achados registrados em `decisions-log.md` D-057/D-058); M12 bloqueado por decisÃ£o de fornecedor (D-052). Full BFF + Frontend Production Foundation (D-053/D-054) **implementado e `APPROVED`**; planejamento de interface 8/9 etapas `APPROVED`, sÃ³ falta User Validation (em suspenso a pedido do Marcelo); BLOCKER-A/B/C **todos resolvidos**. W3-07 (exclusÃ£o fÃ­sica de tenant/DSR) tem design **`APPROVED WITH CONDITIONS`** (D-066/D-067, condiÃ§Ã£o de polÃ­tica SES jÃ¡ decidida) e implementaÃ§Ã£o incremental em andamento (fencing de writers D-068 a D-080, purge pipeline D-081 a D-083 com nota Codex 9,1/10, emenda de privacidade B2B-9/D-103/D-104); orquestrador real ganhou design `APROVADO` depois (D-121, ver mais adiante neste mesmo bloco) â€” nÃ£o deixar a frase acima ler como "ainda nÃ£o decidido" sem essa referÃªncia, achado de autocontradiÃ§Ã£o de `full-audit-round2-contexto` (2026-09-07). **Multi-User B2B (D-084 a D-108, 2026-08-30)**: design tÃ©cnico `APPROVED` via protocolo (Claude 9,2/Codex 9,2) e timing decidido diretamente pelo Marcelo (proceder agora, supersedendo o gatilho comercial de `roadmap-evolution/05`) â€” maior iniciativa de arquitetura autorizada no momento; **Waves B2B-0 a B2B-11 `DONE`** (inventÃ¡rio, physical model D-086, identidade global D-087/D-088, Organization+Membership+CreateOrganizationService D-089/D-090/D-091, `OnboardingStateResolver` puro D-092/D-094, `RequestContext Cutover` D-095/D-096 â€” login nÃ£o cria mais tenant sozinho, `POST /bff/organizations` fecha o loop de onboarding, cap transacional; `RBAC` D-097/D-098 â€” `Membership.role=ADMIN` real na matriz de autorizaÃ§Ã£o, primeira aplicaÃ§Ã£o real de `docs/engineering/research-protocol.md`/E-014; `Invitations/Team` D-099/D-100 â€” `Invitation`/aceite/revogaÃ§Ã£o/gerÃªncia de membros com last-owner protection, segunda aplicaÃ§Ã£o de E-014, primeiro writer real de `Membership` alÃ©m da criaÃ§Ã£o; `BFF Organization Context` D-101/D-102 â€” `X-Organization-Id` transportado do BFF ao recurso, terceira aplicaÃ§Ã£o de E-014, fecha o `InternalError` 500 que B2B-8 tornou explorÃ¡vel; `W3-07/Privacy Reconciliation` D-103/D-104 â€” quarta aplicaÃ§Ã£o de E-014, fecha o `InvitationTokenPointer` Ã³rfÃ£o pÃ³s-exclusÃ£o de Organization, formaliza a fronteira User-level vs. Organization-level erasure em `privacy-lgpd.md`; `Tenant-aware Frontend` D-105/D-106 â€” primeira aplicaÃ§Ã£o do protocolo a uma decisÃ£o de frontend, corrige a regressÃ£o real do `AuthContext`, isolamento de cache real entre tenants, switcher/members/settings; `Responsibility + Notifications` D-107/D-108 â€” quinta aplicaÃ§Ã£o de E-014, migra `NotificationRecipientResolver`/`assigneeUserId`/`ItemWatch` de validaÃ§Ã£o vestigial para `Membership`+`GlobalUser` reais; NÃƒO inclui a supersessÃ£o de GTR-01, ver `multi-user-b2b-wave-tracker.md`; `Cutover de dev` D-110/D-111 â€” sexta aplicaÃ§Ã£o de E-014 (declaraÃ§Ã£o `NÃƒO`), `scripts/reset-dev-data.ts` (reset/reseed, nÃ£o migraÃ§Ã£o, dado 100% sintÃ©tico confirmado por inventÃ¡rio real via `aws --profile claude-dev`) + remoÃ§Ã£o de `LEGACY_TENANT_ONLY`, Fase A verificada de fato contra `dev`; execuÃ§Ã£o real destrutiva (`--confirm`) pendente de confirmaÃ§Ã£o explÃ­cita do Marcelo; `E2E/Adversarial Security` D-112/D-113 â€” sÃ©tima aplicaÃ§Ã£o de E-014, auditoria contra as 25 perguntas de `roadmap-evolution/17` Â§121 (20/25 jÃ¡ cobertas, 2 fecham com fix real de TOCTOU entre roteamento e entrega assÃ­ncrona de notificaÃ§Ã£o â€” `notification.ts`+`subject.ts` reaproveitam `DynamoDbNotificationRecipientResolver` jÃ¡ testado, 2 ganham teste novo de revogaÃ§Ã£o/isolamento de role, 1 Ã© auditoria de fixture IDs sem achado). **Multi-User B2B â€” todas as 14 waves originais (B2B-0 a B2B-13) `DONE`.** **B2B-14 (Operational Evidence) `EM ANDAMENTO`, 2026-08-30**: 7 achados reais severos, cada um encontrado sÃ³ por exercitar o fluxo de verdade contra `dev` pela primeira vez â€” `app_origin` placeholder nunca trocado (D-114), `bff-handler` crashava em toda invocaÃ§Ã£o (D-115), GSI4 nunca autorizado aos 10 Lambdas reais que o consomem (D-116), 2 rotas do BFF nunca wireadas no API Gateway (D-117), nenhuma tela de onboarding existia (D-118), `ExpressionAttributeNames: {}` quebrava `TransactWriteItems` real em 3 arquivos incluindo o guard de Ãºltima-proteÃ§Ã£o-de-OWNER (D-119), e o convite/aceite de membro nunca foi alcanÃ§Ã¡vel de ponta a ponta â€” tela nunca existiu, rota nunca foi wireada, e-mail real nunca foi ativado, SES sandbox sem NENHUMA identity verificada no ambiente inteiro (D-120, 2 endereÃ§os reais verificados com o Marcelo). Pendente para fechar: Marcelo testar convite/aceite/troca-de-organizaÃ§Ã£o com uma segunda conta â€” **explicitamente adiado para uma sessÃ£o futura**, nÃ£o bloqueia o resto do trabalho. Em paralelo, **W3-07 â€” orquestrador de purga ganhou design `APROVADO` (D-121, protocolo Claudeâ†”Codex 3 rodadas, 9,1/9,2): Step Functions + EventBridge Scheduler, e a implementaÃ§Ã£o real estÃ¡ `IMPLEMENTED`/`DEPLOYED`** (D-124, PR #122, CD `success` 2026-08-31, state machine + sweeper `ENABLED` confirmados ao vivo contra `dev` â€” corrigido em 2026-09-07, esta frase ainda dizia "implementaÃ§Ã£o real ainda nÃ£o construÃ­da", achado de `full-audit-round2-contexto`); e 2 lacunas de produto levantadas pelo Marcelo (exportaÃ§Ã£o de dados CSV/planilha, reatribuiÃ§Ã£o de responsabilidade ao remover um Membership) tiveram rodadas de scoping dispatchadas via o mesmo protocolo â€” ver `decisions-log.md` para o D-number final de cada uma antes de assumir status. **`docs/engineering/definition-of-done.md` (E-012, emenda E-013)**: gate de processo permanente â€” nenhum item de todo list que produza cÃ³digo Ã© `completed` sem passar pelo gate correspondente ao seu nÃ­vel de risco, incluindo aplicaÃ§Ã£o concreta (nÃ£o sÃ³ referencial) de `test-engineering-standard.md`. Ver `NEXT_SESSION_PROMPT.md` para a prÃ³xima aÃ§Ã£o exata â€” este bloco Ã© sÃ³ o resumo de fase, nÃ£o histÃ³rico item-a-item.
```

Ver `ARCHITECTURE.md` (raiz do repo) para o resumo executivo consolidado e `NEXT_SESSION_PROMPT.md` para a prÃ³xima aÃ§Ã£o concreta.

## PrecedÃªncia de fontes (quando houver divergÃªncia)

1. `AGENTS.md` (raiz) â€” processo de trabalho dos agentes, sempre vence sobre conteÃºdo de arquitetura.
2. ADR aceito em `adr/` â€” decisÃ£o arquitetural especÃ­fica e formal.
3. Documento temÃ¡tico corrente (tabela abaixo, coluna "normativo atual") â€” especificaÃ§Ã£o detalhada do domÃ­nio.
4. `ARCHITECTURE.md` â€” visÃ£o consolidada e Ã­ndice executivo; nÃ£o sobrescreve silenciosamente um ADR ou documento temÃ¡tico divergente â€” divergÃªncia entre eles Ã© defeito a corrigir, nÃ£o licenÃ§a para escolher.
5. `NEXT_SESSION_PROMPT.md` â€” estado de execuÃ§Ã£o, nunca fonte normativa de arquitetura.
6. `docs/architecture/history/` â€” evidÃªncia histÃ³rica de como se chegou a uma decisÃ£o, nunca normativo.

## Ãndice por documento

| Documento | ClassificaÃ§Ã£o | Do que trata |
|---|---|---|
| `../ARCHITECTURE.md` | resumo/Ã­ndice | Documento consolidado final, aponta para todos os outros |
| `../docs/00-prompt-mestre.md` | histÃ³rico/processo (ciclo concluÃ­do) | Processo Claudeâ†”Codex que produziu o design; nÃ£o Ã© ponto de entrada de sessÃ£o |
| `quality-criteria.md` | normativo atual | 12 critÃ©rios de qualidade, pesos, gates G1-G6 |
| `fitness-function.md` | normativo atual | Fitness function derivada dos critÃ©rios |
| `requirements.md` | normativo atual | Requisitos funcionais/nÃ£o-funcionais, unknowns |
| `capacity-model.md` | normativo atual | Modelo de capacidade Stage 0-5 |
| `architecture-fase3-consolidada.md` | normativo atual | Arquitetura AWS conceitual, 14 decisÃµes numeradas |
| `data-model.md` | normativo atual | Modelo de domÃ­nio/dados, DynamoDB single-table, 6 GSIs |
| `slo.md` | normativo atual | SLOs, incluindo drenagem de pico extremo |
| `disaster-recovery.md` | normativo atual | RPO/RTO, teste de restore, runbook |
| `incident-runbooks.md` | normativo atual (draft operacional) | Runbooks OPS-006 (falha de disparo, DLQ, provedor, IA), matriz de severidade/escalonamento, template de post-mortem, registro de exercÃ­cios |
| `privacy-lgpd.md` | normativo atual | Classes de retenÃ§Ã£o, direitos do titular |
| `cost-model.md` | normativo atual | Modelo de custo por estÃ¡gio |
| `mcp-readiness.md` | normativo atual | ProntidÃ£o de domÃ­nio para MCP futuro |
| `evolution.md` | normativo atual | TransiÃ§Ãµes de estÃ¡gio, gatilhos |
| `aws-well-architected-review.md` | normativo atual | RevisÃ£o pelos 6 pilares AWS, riscos conhecidos |
| `threat-model.md` | normativo atual | Threat model STRIDE, seÃ§Ã£o 33 â€” APPROVED (Claude ~9.05 / Codex 9.002) |
| `implementation-blueprint.md` | normativo atual | Implementation Blueprint, seÃ§Ã£o 60 â€” componentes, interfaces, eventos/schemas, ordem de deploy, milestones â€” APPROVED (Claude 9.20 / Codex 9.2) |
| `correlationid-xray-trace-join.md` | normativo atual (decisÃ£o + implementaÃ§Ã£o) | JunÃ§Ã£o `correlationId`â†”trace ADOT/X-Ray (E-011 pendÃªncia 1) â€” `APPROVED` via protocolo Claudeâ†”Codex (Claude 9,3/Codex 9,4), amplia D-022 sem reabri-la; implementado 2026-08-29 (`xray-trace-header.ts`, correÃ§Ã£o de precedÃªncia do `SecureLogger`), status `E2E PROVEN` (smoke test real contra `dev` confirmado 2026-08-29 â€” corrigido em 2026-09-07, esta linha ainda dizia "pendente", achado de `full-audit-round2-contexto`) |
| `m3.5-runtime-design.md` | normativo atual | Design do milestone M3.5 (runtime real do Reminder Engine, fechamento de G8) â€” adapters DynamoDB, handlers Lambda, outbox+relay SQS/DLQ, EventBridge Scheduler+GSI6, testes em 3 camadas â€” APPROVED (Claude 9.0 / Codex 9.3) |
| `reminder-delivery-pipeline.md` | normativo atual | BLOCKER-B â€” pipeline real de materializaÃ§Ã£o/entrega de lembretes: event taxonomy (`expiration.item-due-date-changed.v1`/`item-deactivated.v1`/`reminder.policy-changed.v1`), lifecycle do ponteiro `POLICYREF#`, fencing de concorrÃªncia (dispatch + reconciliaÃ§Ã£o), backfill â€” APPROVED (arquitetura, Codex 9.2/10, rodadas B-H; implementaÃ§Ã£o, Codex 9.2/10, 2 rodadas) |
| `blocker-b-recon-handoff.md` | histÃ³rico/evidÃªncia (citado por `reminder-delivery-pipeline.md` Â§3/Â§3.2) | Recon prÃ©-implementaÃ§Ã£o de BLOCKER-B (materializer/trigger de materializaÃ§Ã£o, infra Terraform) confirmado contra o cÃ³digo real antes do design ser escrito; BLOCKER-B estÃ¡ implementado e mergeado (PR #50) â€” este documento sÃ³ registra a evidÃªncia que fundamentou o design |
| `blocker-b-mission-brief.md` | histÃ³rico/evidÃªncia | Texto verbatim do prompt de missÃ£o original (2026-08-24) que abriu o recon de BLOCKER-B acima; persistido porque sÃ³ existia em histÃ³rico de conversa de uma sessÃ£o especÃ­fica |
| `decisions-log.md` | decisÃ£o/ADR (log vivo) | D-000 em diante (D-231+ na revisÃ£o mais recente â€” nÃ£o referenciar um teto fixo aqui, ele desatualiza a cada sessÃ£o; a numeraÃ§Ã£o tambÃ©m nÃ£o Ã© sequencial na ordem das linhas â€” ex. D-024 a D-028 foram inseridas antes de D-010 a D-023 no arquivo), nota Claude/Codex, status |
| `reviews/m7-extraction-design/` | histÃ³rico/evidÃªncia de rodada | Artefatos do protocolo Claudeâ†”Codex de M7 (proposta Claude, proposta Codex, crÃ­tica, reconciliaÃ§Ã£o final aprovada â€” D-035) |
| `adr/` | decisÃ£o/ADR | 11 ADRs formais para decisÃµes Type 1 |
| `reviews/spa-hosting-cloudfront-bff/` | histÃ³rico/evidÃªncia de rodada (protocolo `AGENTS.md` Â§4) | Debate de 6 rodadas que produziu ADR-0011 (coexistÃªncia CloudFront + Full BFF) â€” nota final 9,2/9,3 |
| `diagrams/diagrams.md` | normativo atual (visual) | 14 diagramas Mermaid |
| `diagrams/project-status.html` | resumo/Ã­ndice (visual) | **O documento de status do projeto** â€” painel visual (timeline de marcos, achados reais, pendÃªncias); abrir no navegador para uma visÃ£o executiva rÃ¡pida, mais legÃ­vel que `NEXT_SESSION_PROMPT.md` para esse fim (que continua sendo a fonte de estado detalhado por sessÃ£o) |
| `session-log.md` | histÃ³rico | Log cronolÃ³gico compacto por sessÃ£o |
| `roadmap-evolution/00-mission-brief.md` | histÃ³rico/evidÃªncia | Texto verbatim do prompt original (2026-08-22) que abriu as 3 fases de evoluÃ§Ã£o estratÃ©gica do roadmap abaixo; movido da raiz em 2026-08-29, mesmo tratamento de `blocker-b-mission-brief.md` |
| `roadmap-evolution/01-gap-analysis.md` | informativo (rascunho, nÃ£o normativo) | Fase 1 da evoluÃ§Ã£o estratÃ©gica do roadmap (2026-08-23): estado real dos milestones + classificaÃ§Ã£o de cada capacidade comercial proposta contra o cÃ³digo real. Insumo para a Fase 2 (pesquisa de mercado + modelagem de domÃ­nio + protocolo Claudeâ†”Codex por tema), nunca decisÃ£o fechada |
| `roadmap-evolution/02-market-research.md` | informativo (rascunho, nÃ£o normativo) | Fase 2a: pesquisa de mercado real sobre concorrentes (TrustLayer, Certificial, SubCompliant, VendorJot, Remindax, categoria ampla) e tentativa de refutar cada capacidade proposta na Fase 1 â€” achado central: billing por sujeito rastreado Ã© padrÃ£o de mercado dominante |
| `roadmap-evolution/03-domain-model-tracked-subject-requirement.md` | informativo (decisÃ£o reconciliada via protocolo AGENTS.md Â§4, ADR formal sÃ³ na Fase 3) | Fase 2b, primeiro cluster de modelagem de domÃ­nio (`TrackedSubject`+`RequirementAssignment`) â€” protocolo Claudeâ†”Codex completo via MCP, nota final 9,1/9,1 |
| `roadmap-evolution/04-domain-model-guest-upload.md` | informativo (decisÃ£o reconciliada via protocolo AGENTS.md Â§4, ADR formal sÃ³ na Fase 3) | Fase 2b, segundo cluster (guest upload/magic link, `DocumentRequest`+`DocumentSubmission`) â€” protocolo Claudeâ†”Codex completo via MCP, nota final 9,2/9,2; achado real: GSI novo evitado reaproveitando padrÃ£o de `IdentityMapping` |
| `roadmap-evolution/05-domain-model-organization-billing.md` | informativo (decisÃ£o reconciliada via protocolo AGENTS.md Â§4, ADR formal sÃ³ na Fase 3) | Fase 2b, terceiro cluster (Organization/Membership/RBAC + Billing/Entitlements) â€” protocolo Claudeâ†”Codex completo via MCP, nota final 9,2/9,2; reordena billing por `TrackedSubject` antes de Organization; achado real de correÃ§Ã£o pendente em `evolution.md:13` |
| `roadmap-evolution/06-domain-model-automated-chasing.md` | informativo (decisÃ£o reconciliada via protocolo AGENTS.md Â§4, ADR formal sÃ³ na Fase 3) | Fase 2b, quarto cluster (automated document chasing via Reminder Engine) â€” protocolo Claudeâ†”Codex completo via MCP, nota final 9,1/9,2; agregados-irmÃ£os em vez de generalizar `NotificationIntent`/`ReminderOccurrence` jÃ¡ em produÃ§Ã£o, aplicando o precedente de M7; GSI3 reaproveitado sob condiÃ§Ã£o de mini-revisÃ£o de capacidade |
| `roadmap-evolution/07-domain-model-escalation-watchers-digest.md` | informativo (decisÃ£o reconciliada via protocolo AGENTS.md Â§4, ADR formal sÃ³ na Fase 3) | Fase 2b, quinto cluster (escalation/watchers/digest) â€” protocolo Claudeâ†”Codex completo via MCP, nota final 9,2/9,4; `ItemWatch` como extensÃ£o direta de padrÃ£o jÃ¡ em produÃ§Ã£o (mesma partiÃ§Ã£o de `Document`/M6); digest registrado como questÃ£o aberta, nÃ£o decidida |
| `roadmap-evolution/08-domain-model-custom-fields.md` | informativo (decisÃ£o reconciliada via protocolo AGENTS.md Â§4, lista de rejeitados formal sÃ³ na Fase 3) | Fase 2b, sexto cluster â€” custom fields genÃ©rico (`FieldDefinition`/`FieldValue`) rejeitado/adiado por padrÃ£o (nota 9,1/9,0), valor jÃ¡ servido por `tags[]`+`notes?`+`requirementName`; emenda registrada nos clusters 1 e 2 |
| `roadmap-evolution/09-domain-model-csv-import.md` | informativo (decisÃ£o reconciliada via protocolo AGENTS.md Â§4, ADR formal sÃ³ na Fase 3) | Fase 2b, sÃ©timo e Ãºltimo cluster (CSV import/export) â€” protocolo Claudeâ†”Codex completo via MCP, nota final 9,2/9,4; formula injection mitigada na exportaÃ§Ã£o (nÃ£o na entrada); plano linha-a-linha em S3, nÃ£o DynamoDB; **Fase 2b concluÃ­da, 7/7 clusters â‰¥9,0** |
| `roadmap-evolution/10-phase3-scoring-and-roadmap.md` | informativo (sÃ­ntese proposta, nÃ£o autorizaÃ§Ã£o de implementaÃ§Ã£o) | Fase 3: executive summary, feature score ponderado, roadmap revisado M9-M13 (milestone-a-milestone, formato completo), dependency graph â€” consolida os 7 clusters da Fase 2b |
| `roadmap-evolution/11-phase3-impacts-and-closing.md` | informativo (sÃ­ntese proposta, ADRs formais sÃ³ com decisÃ£o do Marcelo) | Fase 3: domain model antes/depois, impacto de arquitetura/seguranÃ§a/persistÃªncia/custo, lista de 10 ADRs candidatos, estratÃ©gia de teste/migraÃ§Ã£o, perguntas abertas reais, capacidades rejeitadas â€” inclui revisÃ£o adversarial final de coerÃªncia do pacote completo (nota 8,2/10, achados corrigidos) |
| `roadmap-evolution/12-automated-chasing-capacity-review.md` | verificaÃ§Ã£o de prÃ©-requisito (D-046) | Mini-revisÃ£o de capacidade de GSI3 antes de M10 cluster 4 (automated chasing) â€” pico orgÃ¢nico ~220Ã— abaixo do SLO de drenagem de pico extremo, GSI3 reaproveitado sem shard/Ã­ndice novo |
| `roadmap-evolution/13-guest-link-delivery-design.md` | decisÃ£o reconciliada via protocolo AGENTS.md Â§4 (D-047/D-048) | Fecha D-047 â€” entrega/reenvio do link de guest upload: rotaÃ§Ã£o de token a cada disparo de chasing, sem KMS/secret cifrado persistido; nota final 9,2/9,4 |
| `roadmap-evolution/14-document-request-initial-invite-design.md` | decisÃ£o reconciliada via protocolo AGENTS.md Â§4 (D-049) | Fecha "DecisÃ£o B" de D-048 â€” automatiza o convite inicial de guest upload (hoje manual) atrÃ¡s de preferÃªncia de tenant + kill switch global default `false`; nota final 9,2/9,4 |
| `roadmap-evolution/15-m12-billing-scope-decision.md` | decisÃ£o reconciliada via protocolo AGENTS.md Â§4 (D-052) | PÃ³s-M11: M12 (Billing) fica bloqueado por decisÃ£o de produto (fornecedor de pagamento) â€” zero cÃ³digo novo; achado real de que o projeto nÃ£o tem conceito de "platform staff" cross-tenant, descartando atÃ© a fatia manual de entitlement; nota final 9,3/9,4 |
| `roadmap-evolution/16-document-lifecycle-strategic-analysis.md` | informativo (anÃ¡lise externa, nÃ£o passou pelo protocolo AGENTS.md Â§4, sem ADR) | EvoluÃ§Ã£o estratÃ©gica de "controle de vencimentos" para "gestÃ£o enxuta do ciclo de vida documental" â€” avaliaÃ§Ã£o de coerÃªncia/reaproveitamento/risco de overengineering; recomenda aprovar a direÃ§Ã£o mas nÃ£o antecipar o escopo, mantendo o foco em Consolidation + Pilot Readiness; identifica `Document` deixar de ser filho exclusivo de `ExpirationItem` como a mudanÃ§a arquitetural futura central, marcada nela mesma como Type 1 (ADR + protocolo Claudeâ†”Codex antes de qualquer implementaÃ§Ã£o) |
| `roadmap-evolution/17-multi-user-b2b-revised-strategy.md` | **`APPROVED` â€” design tÃ©cnico (protocolo AGENTS.md Â§4) + timing (decisÃ£o direta do Marcelo, D-085)** | EspecificaÃ§Ã£o vigente de Multi-User B2B â€” `Organization` como tenant boundary permanente, `User` global, `Membership` N:N, RBAC por permissions. Protocolo Claudeâ†”Codex completo (Â§125): 3 rodadas reais, Claude 9,2/Codex 9,2, ambos â‰¥9,0 (mecanismo transacional de last-OWNER, unicidade de Membership/Invitation, tabela mantÃ©m/emenda/refaz do impacto no W3-07, supersessÃ£o explÃ­cita de D-060/GTR-01). **D-085 (2026-08-29)**: Marcelo decidiu diretamente proceder agora, supersedendo o gatilho comercial de `roadmap-evolution/05` (marcado `SUPERSEDED (timing)`, modelo de billing/entitlements desse cluster permanece vigente). **Waves B2B-0 a B2B-11 `DONE`** (D-108 conclui B2B-11, Responsibility + Notifications) â€” ver `multi-user-b2b-wave-tracker.md` para o detalhamento por subitem (inclui a nota de escopo sobre GTR-01/`Organization.displayName` ainda pendente). Wave B2B-12 (Cutover de dev) foi, na Ã©poca da escrita original desta linha, a prÃ³xima aÃ§Ã£o real do documento fonte â€” **hoje jÃ¡ `APPROVED`/`IMPLEMENTADO` (D-110/D-111, ver linha da tabela abaixo)**, corrigido em 2026-09-07 (achado de `full-audit-round2-contexto`: esta linha descrevia um estado histÃ³rico do documento-fonte como se fosse o estado atual) â€” ver `NEXT_SESSION_PROMPT.md` para o estado de execuÃ§Ã£o vigente |
| `roadmap-evolution/18-synthetic-persona-research-quality-baseline.md` | informativo (anÃ¡lise externa trazida pelo Marcelo em 2026-08-31, nÃ£o passou pelo protocolo AGENTS.md Â§4, sem ADR, sem decisÃ£o de proceder) | Fundamento metodolÃ³gico proposto para um futuro "Synthetic Persona Evaluation Framework" (agentes condicionados por persona exercitando a aplicaÃ§Ã£o real, em complemento â€” nunca substituiÃ§Ã£o â€” a testes humanos): modelo Persona+Contexto+Dataset+CenÃ¡rio+Objetivo="Trial", provenance de evidÃªncia (`hypothesisâ†’research-groundedâ†’human-observedâ†’production-observed`), hierarquia de oracle (estado determinÃ­stico > banco/API/evento > LLM grader > autoavaliaÃ§Ã£o do agente, esta Ãºltima nunca fonte de verdade), scorecard de 100 pontos + 18 Hard Gates (HG-01..18, ex. "agente nunca recebe oracle/caminho de navegaÃ§Ã£o", "actor nÃ£o pode ser o Ãºnico judge"). Puramente conceitual/genÃ©rico nesta etapa, ainda nÃ£o aplicado ao Expiration Tracker |
| `roadmap-evolution/19-synthetic-persona-application-analysis.md` | informativo (anÃ¡lise externa trazida pelo Marcelo em 2026-08-31, nÃ£o passou pelo protocolo AGENTS.md Â§4, sem ADR, sem decisÃ£o de proceder) | Aplica o baseline de `18` Ã  realidade atual do cÃ³digo: conclui que a aplicaÃ§Ã£o Ã© "muito favorÃ¡vel" a personas sintÃ©ticas (domÃ­nio modelado, OCC, idempotÃªncia, outbox, relÃ³gio injetÃ¡vel, `dev` resetÃ¡vel, Playwright, Test Engineering Standard jÃ¡ existentes), mas nomeia 4 restriÃ§Ãµes reais â€” zero usuÃ¡rio/produÃ§Ã£o real, frontend cobre sÃ³ parte das superfÃ­cies planejadas, modelo B2B ainda em transiÃ§Ã£o, e a principal: **o Playwright atual roda majoritariamente contra um BFF mockado (`page.route()`), nÃ£o contra o sistema real** â€” a mesma lacuna que B2B-14 (Operational Evidence) jÃ¡ vinha fechando manualmente. TambÃ©m documenta drift real entre `NEXT_SESSION_PROMPT.md`/comentÃ¡rios antigos e o cÃ³digo atual |
| `roadmap-evolution/20-synthetic-trial-identity-design.md` | informativo (anÃ¡lise externa trazida pelo Marcelo em 2026-08-31, nÃ£o passou pelo protocolo AGENTS.md Â§4, sem ADR, sem decisÃ£o de proceder) | Proposta de implementaÃ§Ã£o: identidade de execuÃ§Ã£o hierÃ¡rquica `evaluationRunIdâ†’trialIdâ†’correlationIdâ†’traceId/spanId`, deliberadamente **execution metadata, nunca atributo funcional do domÃ­nio** (nunca `ExpirationItem.trialId`), propagada via header Playwrightâ†’middleware BFFâ†’`RequestContext`â†’outbox `metadata` (nunca `payload`)â†’SQSâ†’workerâ†’audit event/log estruturado; gate de ambiente (`EVALUATION_CONTEXT_ENABLED`, `prod=false` por padrÃ£o), fail-closed para metadata invÃ¡lida, 12 Hard Gates prÃ³prios (HG-TID-01..12, ex. "trialId nunca altera autorizaÃ§Ã£o/validaÃ§Ã£o funcional"). O prÃ³prio documento recomenda revisÃ£o via protocolo Claudeâ†”Codex antes de entrar no roadmap â€” ainda nÃ£o submetida |
| `multi-user-b2b-wave-b2b4-scope.md` | **`APPROVED` (D-092, protocolo Claudeâ†”Codex 4 rodadas, Claude 9,3/Codex 9,4)** | Escopo final de Wave B2B-4 â€” `OnboardingStateResolver` puro (4 estados, procedimento sequencial estrito), sem wiring de login, sem exposiÃ§Ã£o HTTP; redesigna "remover auto-provision"/gate real para Wave B2B-5. EvidÃªncia das 4 rodadas em `reviews/multi-user-b2b-wave-b2b4-scoping/` |
| `multi-user-b2b-wave-b2b5-scope.md` | **`APPROVED` (D-095, protocolo Claudeâ†”Codex 3 rodadas, Claude 9,1/Codex 9,1) â€” `IMPLEMENTADO` (D-096)** | Escopo final de Wave B2B-5 (RequestContext Cutover) â€” `bootstrapUser()` de 2 itens, `RequestContextResolver` reescrito com resoluÃ§Ã£o de Membership Ãºnica e assert explÃ­cito para `ADMIN` nÃ£o suportado, `POST /bff/organizations` com cap transacional (`GlobalUser.hasCreatedOrganization`), self-heal de sessÃ£o BFF; desvio faseado explÃ­cito de Â§11/Â§12 do physical model (seleÃ§Ã£o real de organizaÃ§Ã£o fica para B2B-6). EvidÃªncia das 3 rodadas em `reviews/multi-user-b2b-wave-b2b5-scoping/`; implementaÃ§Ã£o e 2 achados reais corrigidos (UserProfile mantido, gate de lifecycle da Organization adicionado) em `decisions-log.md` D-096 |
| `multi-user-b2b-wave-b2b6-scope.md` | **`APPROVED` (D-101, protocolo Claudeâ†”Codex 3 rodadas, checklist v2, Claude 9,1/Codex 9,2) â€” `IMPLEMENTADO` (D-102)** | Escopo final de Wave B2B-6 (BFF Organization Context) â€” terceira aplicaÃ§Ã£o real de E-014 (padrÃ£o header+revalidaÃ§Ã£o server-side, OWASP Multi Tenant Security). `X-Organization-Id` injetado sÃ³ pelo BFF (nunca do browser), `resolveWorkingOrganization()`/`OrganizationUnavailableError`(403)/`OrganizationSelectionRequiredError`(409) fecham o `InternalError` 500 que B2B-8 tornou explorÃ¡vel; `POST /bff/organization/select` (CSRF)/`GET /bff/organizations` (filtrado por lifecycle) novos. EvidÃªncia das 3 rodadas (checklist contestado e reconciliado 2x) em `reviews/multi-user-b2b-wave-b2b6-scoping/` |
| `multi-user-b2b-wave-b2b7-scope.md` | **`APPROVED` (D-097, protocolo Claudeâ†”Codex 3 rodadas, checklist v2, Claude 9,2/Codex 9,3) â€” `IMPLEMENTADO` (D-098)** | Escopo final de Wave B2B-7 (RBAC) â€” primeira aplicaÃ§Ã£o real de `docs/engineering/research-protocol.md`/E-014 (pesquisa GitHub/Linear/Slack/Notion/NIST-ANSI-INCITS-359, checklist de critÃ©rios de nota contestado e reconciliado na Rodada 1â†’2). `Role` ganha `ADMIN`, paritÃ¡rio com `OWNER` nas 4 actions de deleÃ§Ã£o de recurso e no bypass de ownership; `notification:configure` reclassificada para `READ_ONLY_ROLES` (bug fix real, nÃ£o escolha ADMIN-vs-OWNER); `tenant:configure-document-request-delivery` isolada em novo tier `OWNER_ROLES`. EvidÃªncia das 3 rodadas (incl. a contestaÃ§Ã£o do checklist) em `reviews/multi-user-b2b-wave-b2b7-scoping/` |
| `multi-user-b2b-wave-b2b8-scope.md` | **`APPROVED` (D-099, protocolo Claudeâ†”Codex 3 rodadas, checklist v3, Claude 9,1/Codex 9,2) â€” `IMPLEMENTADO` (D-100)** | Escopo final de Wave B2B-8 (Invitations/Team) â€” segunda aplicaÃ§Ã£o real de E-014, declaraÃ§Ã£o `SIM PARCIAL` (mecanismo de dados jÃ¡ `APPROVED` em D-086; last-owner protection/hierarquia de gerÃªncia de membros pesquisados nesta wave, GitHub/Slack/Linear/Notion). `Invitation`+token pointer+dedup (D-086 Â§7), `AcceptInvitationService` (transaÃ§Ã£o de 6 itens, token consumido estruturalmente), `ChangeMembershipRoleService`/`RemoveMembershipService`/`LeaveOrganizationService` com builder Ãºnico de `ownerCount` (`LastOwnerError`) â€” primeiro writer real de `Membership` alÃ©m da criaÃ§Ã£o. EvidÃªncia das 3 rodadas (checklist contestado e reconciliado 2x) em `reviews/multi-user-b2b-wave-b2b8-scoping/` |
| `multi-user-b2b-wave-b2b9-scope.md` | **`APPROVED` (D-103, protocolo Claudeâ†”Codex 3 rodadas, Claude 9,3/Codex 9,3) â€” `IMPLEMENTADO` (D-104)** | Escopo final de Wave B2B-9 (W3-07/Privacy Reconciliation) â€” quarta aplicaÃ§Ã£o real de E-014 (GitHub/Slack/Atlassian, "delete conta" vs. "delete organizaÃ§Ã£o"). Fix real: `InvitationTokenPointer` (declara `organizationId`, nÃ£o `tenantId`) ganha 3Âª clÃ¡usula OR no scan/`PURGE_DELETE` de purga, fechando Ã³rfÃ£o pÃ³s-exclusÃ£o de Organization. `privacy-lgpd.md` Â§4.1/Â§4.2 novos (fronteira User-level vs. Organization-level erasure, invariante de Ãºltimo OWNER documentada) + 4 linhas de retenÃ§Ã£o. EvidÃªncia das 3 rodadas em `reviews/multi-user-b2b-wave-b2b9-scoping/` |
| `multi-user-b2b-wave-b2b10-scope.md` | **`APPROVED` (D-105, protocolo Claudeâ†”Codex 3 rodadas, Claude 9,2/Codex 9,2) â€” `IMPLEMENTADO` (D-106)** | Escopo final de Wave B2B-10 (Tenant-aware Frontend) â€” primeira aplicaÃ§Ã£o do protocolo a uma decisÃ£o de frontend nesta sessÃ£o. Fix de regressÃ£o real (`AuthContext` tratava todo usuÃ¡rio autenticado como deslogado desde B2B-5); arquitetura de cache isolation (query keys por `organizationId` + `ActiveOrganizationProvider`/`switching`/`cancelQueries`/`AbortSignal` ponta-a-ponta) fecha uma corrida real de vazamento de dado entre tenants na UI; switcher/members/settings novos. EvidÃªncia das 3 rodadas em `reviews/multi-user-b2b-wave-b2b10-scoping/` |
| `multi-user-b2b-wave-b2b11-scope.md` | **`APPROVED` (D-107, protocolo Claudeâ†”Codex 3 rodadas, Claude 9,2/Codex 9,2) â€” `IMPLEMENTADO` (D-108)** | Escopo final de Wave B2B-11 (Responsibility + Notifications) â€” quinta aplicaÃ§Ã£o de E-014 (GitHub/Linear, "assignee deve ser membro real e ativo"). `NotificationRecipientResolver` migrado de `UserProfile` (vestigial) para `Membership`+`GlobalUser` (2 condiÃ§Ãµes); `assigneeUserId`/`ItemWatch.userId` agora validados contra `Membership` real via `MemberEligibilityChecker` novo. **Nota**: nÃ£o inclui a supersessÃ£o de GTR-01 (`UserProfile.requesterDisplayName`â†’`Organization.displayName`), prevista em B2B-5 mas nunca debatida nas 3 rodadas reais desta wave â€” ver `multi-user-b2b-wave-tracker.md`. EvidÃªncia das 3 rodadas em `reviews/multi-user-b2b-wave-b2b11-scoping/` |
| `multi-user-b2b-wave-b2b12-scope.md` | **`APPROVED` (D-110, protocolo Claudeâ†”Codex 3 rodadas, Claude 9,2/Codex 9,1) â€” `IMPLEMENTADO` (D-111)** | Escopo final de Wave B2B-12 (Cutover de dev) â€” sexta aplicaÃ§Ã£o de E-014 (declaraÃ§Ã£o `NÃƒO`, polÃ­tica reset-vs-migraÃ§Ã£o jÃ¡ aprovada dentro do prÃ³prio `roadmap-evolution/17` Â§62-63). InventÃ¡rio real via `aws --profile claude-dev` confirma `dev` 100% sintÃ©tico/descartÃ¡vel; `scripts/reset-dev-data.ts` (Fase A inventÃ¡rio+snapshot sempre, Fase B delete real sÃ³ `--confirm`, allowlist de tabela/conta, verificaÃ§Ã£o final fail-loud) + remoÃ§Ã£o de `LEGACY_TENANT_ONLY` (backend+frontend+teste). Fase A verificada de fato contra `dev` (nÃ£o sÃ³ fakes). **ExecuÃ§Ã£o real destrutiva (`--confirm`/`--include-cognito`) pendente de confirmaÃ§Ã£o explÃ­cita do Marcelo.** EvidÃªncia das 3 rodadas em `reviews/multi-user-b2b-wave-b2b12-scoping/` |
| `multi-user-b2b-wave-b2b13-scope.md` | **`APPROVED` (D-112, protocolo Claudeâ†”Codex 3 rodadas, Claude 9,1/Codex 9,2, rÃ©gua E-014 9,3) â€” `IMPLEMENTADO` (D-113)** | Escopo final de Wave B2B-13 (E2E/Adversarial Security) â€” sÃ©tima aplicaÃ§Ã£o de E-014 (OWASP WSTG/Authorization Testing, SIM PARCIAL). Auditoria completa contra as 25 perguntas de `roadmap-evolution/17` Â§121 (matriz Qâ†’arquivo:linha completa): 20/25 jÃ¡ cobertas por testes reais de waves anteriores; 2 fecham com fix real (mesmo TOCTOU em `notification.ts`+`subject.ts` â€” entrega assÃ­ncrona nunca revalidava `Membership`, sÃ³ roteamento checava â€” corrigido reaproveitando `DynamoDbNotificationRecipientResolver` jÃ¡ testado, `ResolvedRecipient` ganha `email?: string`); 2 ganham teste novo (revogaÃ§Ã£o de Membership encadeada ponta-a-ponta; roles diferentes por Organization nunca vazam); 1 Ã© auditoria de fixture IDs (zero achado). A Rodada 1 do Codex achou um 6Âº achado real (mesmo TOCTOU em `document-chasing-dispatch`) que a proposta original nÃ£o tinha visto. EvidÃªncia das 3 rodadas em `reviews/multi-user-b2b-wave-b2b13-scoping/` |
| `multi-user-b2b-wave-b2b0-inventory.md` | evidÃªncia de rodada (read-only, completo) | InventÃ¡rio verificado de Wave B2B-0 (Â§105 do documento acima): `tenantId=userId` em produÃ§Ã£o (3 pontos confirmados, 1 gap de fencing prÃ©-existente achado no login BFF), `IdentityMapping`/BFF session/`RequestContext`, stores tenant-scoped/S3 (3 prefixos reais, diverge de Â§68)/eventos/W3-07, frontend caches (zero isolamento tenant hoje) e contagem reproduzÃ­vel da suÃ­te de testes (122 arquivos/1092 casos, nÃ£o ~1104) |
| `multi-user-b2b-physical-model.md` | **`APPROVED` (D-086, protocolo Claudeâ†”Codex 5 rodadas, Claude 9,3/Codex 9,5)** | Physical model final de Wave B2B-1 â€” `User`/`IdentityMapping`/`Organization`/`Membership` (3 estados, GSI4 `MembershipByUser` reaproveitado)/`Invitation`/`ownerCount`/`bootstrapUser()`/`DeviceSession`+`logoutAll`/`RequestContext`/BFF session, respostas finais Ã s 25 perguntas de `roadmap-evolution/17` Â§121. EvidÃªncia das 5 rodadas em `reviews/multi-user-b2b-physical-model/` |
| `multi-user-b2b-wave-tracker.md` | registro vivo de backlog (nÃ£o normativo sobre arquitetura/design) | Status DONE/IN PROGRESS/BLOCKED/NOT STARTED por wave (B2B-0 a B2B-15), mesmo papel de `docs/engineering/pilot-readiness-program.md` â€” ponto de entrada para saber o que jÃ¡ foi feito antes de continuar a iniciativa |
| `reviews/context-engineering-reconciliation/` | decisÃ£o reconciliada via protocolo AGENTS.md Â§4 | ReconciliaÃ§Ã£o da arquitetura de contexto do repo (2026-08-29) â€” root cleanup (21â†’6 `.md`), `AGENTS.md`/`NEXT_SESSION_PROMPT.md` trimados (narrativa de milestone jÃ¡ duplicada em `decisions-log.md` removida), 2 guardrails novos em `check-doc-drift.ts` (root allowlist, size), READMEs stale corrigidos. 4 rodadas Codex (8,1â†’8,8â†’8,9â†’9,3/10, `APPROVED`), 3 achados reais de drift semÃ¢ntico prÃ©-existente corrigidos no processo |
| `reviews/bff-full-vs-session-design/` | decisÃ£o reconciliada via protocolo AGENTS.md Â§4 (D-053/D-054) | Full BFF como fronteira de sessÃ£o do browser â€” decide o mecanismo de autenticaÃ§Ã£o das chamadas de recurso que o "BFF de sessÃ£o" original (D-034) nunca cobriu. D-053 (Claude 9,2/Codex 9,3): browser nunca recebe token OAuth, cookie de sessÃ£o opaco, PKCE+`state`. D-054, amendment de auditoria adversarial de 16 pontos (Claude 9,2/Codex 9,4): rotaÃ§Ã£o nativa do Cognito no refresh (nÃ£o contador local â€” evita falso-positivo de invalidaÃ§Ã£o), tabela de sessÃ£o dedicada IAM-isolada, cookies login/sessÃ£o com `SameSite` diferenciado. **Implementado e `APPROVED AS FRONTEND PRODUCTION FOUNDATION`** (`src/modules/bff/`, `infra/modules/bff-*`) â€” ver `docs/frontend/frontend-production-foundation.md` para o registro completo da implementaÃ§Ã£o e do protocolo Claudeâ†”Codex (Rodada D: 6 passagens, 5 achados bloqueantes reais de seguranÃ§a de sessÃ£o corrigidos) |
| `reviews/w3-07-purge-orchestrator-scoping/` | decisÃ£o reconciliada via protocolo AGENTS.md Â§4 (D-121) | Orquestrador real do purge pipeline W3-07 (Step Functions + EventBridge Scheduler) â€” decisÃ£o pendente desde D-083, fechada 3 rodadas (6,7â†’8,2â†’9,2/9,1 `APPROVED`). Design apenas â€” implementaÃ§Ã£o (novo mÃ³dulo Terraform, 2 Lambdas, `CloseOrganizationService`) fica para sessÃ£o dedicada futura |
| `reviews/responsibility-reassignment-scoping/` | decisÃ£o reconciliada via protocolo AGENTS.md Â§4 (D-122) | ReatribuiÃ§Ã£o de responsabilidade quando um Membership Ã© removido/sai â€” precondiÃ§Ã£o bloqueante best-effort via GSI1 jÃ¡ existente (zero GSI novo), 3 rodadas (7,0â†’8,1â†’9,1/9,1 `APPROVED`). Design apenas â€” implementaÃ§Ã£o fica para sessÃ£o dedicada futura |
| `reviews/data-export-scoping/` | decisÃ£o reconciliada via protocolo AGENTS.md Â§4 (D-123) | ExportaÃ§Ã£o de dados (CSV) de `ExpirationItem` â€” `item:export`/`ADMIN_ROLES`, handler sÃ­ncrono via `queryGsi1` com orÃ§amento decrescente + guard de 4 MB, `csv-export-writer.ts` (RFC4180+mitigaÃ§Ã£o de fÃ³rmula), 3 rodadas (6,2â†’8,1â†’9,1/9,1 `APPROVED`). Design apenas â€” implementaÃ§Ã£o fica para sessÃ£o dedicada futura |
| `reviews/search-and-filters-scoping/` | decisÃ£o reconciliada via protocolo AGENTS.md Â§4 (D-194) | Busca e filtros documentais (roadmap P0.5) â€” uniÃ£o discriminada Subject/Requirement/ExpirationItem via GSI7/GSI1 jÃ¡ tenant-facing (zero GSI novo), `Requirement.assigneeUserId` (mecanismo completo transportado de D-122/D-125), `UnifiedValidityState` derivado read-time. RÃ©gua reconciliada na Rodada 2 (9,6/10 estÃ¡vel), 5 rodadas (design 4,8â†’6,2â†’8,1â†’8,8â†’9,2/9,3 `APPROVED`). Design apenas â€” implementaÃ§Ã£o fica para sessÃ£o dedicada futura |
| `reviews/` | histÃ³rico/evidÃªncia de rodada (protocolo `AGENTS.md` Â§4, pÃ³s-M0) | Artefatos de revisÃ£o Claudeâ†”Codex de implementaÃ§Ã£o real, por milestone (ex. `reviews/m3.5-runtime-design/`) â€” mesmo papel de `history/` (evidÃªncia, nunca normativo), mas para rodadas ocorridas depois que cÃ³digo passou a existir, em vez das rodadas de design conceitual prÃ©-implementaÃ§Ã£o |
| `history/` | histÃ³rico/supersedido | Artefatos de rodada (propostas, crÃ­ticas, red team) que produziram os documentos normativos acima â€” ver subseÃ§Ã£o |

## `history/` â€” evidÃªncia de rodada, por tema

Cada subpasta contÃ©m os artefatos de proposta/crÃ­tica/trÃ©plica que antecederam o documento normativo correspondente. Nunca tratar como fonte de decisÃ£o vigente â€” sÃ³ como prova de como o consenso foi alcanÃ§ado.

| Subpasta | Documento normativo correspondente |
|---|---|
| `history/quality-criteria/` | `quality-criteria.md` |
| `history/architecture-fase3/` | `architecture-fase3-consolidada.md` |
| `history/data-model/` | `data-model.md` |
| `history/slo/` | `slo.md` |
| `history/disaster-recovery/` | `disaster-recovery.md` |
| `history/privacy-lgpd/` | `privacy-lgpd.md` |
| `history/cost-model/` | `cost-model.md` |
| `history/threat-model/` | `threat-model.md` |
| `history/implementation-blueprint/` | `implementation-blueprint.md` |

# docs/engineering/ â€” Ãndice e Mapa de Autoridade

```text
Rubrica de qualidade:     CONGELADA (01-engineering-quality-criteria.md)
Fitness functions:        ativas (02-engineering-fitness-functions.md), enforcement real em CI
Full-audit 9 eixos:       CONCLUÃDO em 2026-08-20 (9/9 avaliados, sÃ³ Contexto bateu o gate â‰¥9.0 originalmente) â€” achados remediados/reavaliados em rodadas posteriores por eixo, ver decisions-log.md/pilot-readiness-program.md, nÃ£o re-enumerado aqui
Programas posteriores:    test-engineering-standard.md (E-010, APPROVED), logging-observability-standard.md (E-011, APPROVED), definition-of-done.md (E-012, APPROVED â€” gate por item de todo list; emenda E-013 tornando a aplicaÃ§Ã£o de test-engineering-standard.md operacional, nÃ£o sÃ³ referencial), research-protocol.md (E-014, APPROVED â€” pesquisa externa exigida/checklist de nota antes de decisÃµes Type 1 que dependem de padrÃ£o de mercado), Consolidation + Pilot Readiness Program (pilot-readiness-program.md/pilot-readiness-assessment.md, CONDITIONAL GO)
Last verified:            2026-09-08 (E-023 â€” full-audit round2, eixo Qualidade de Engenharia, reaberto (Round 1 fechou 2026-08-20 em 8,199/7,788); melhora real (Claude 8,199â†’8,32, Codex 7,788â†’8,341), gate â‰¥9,0 ainda nÃ£o atingido, convergido em 2 rodadas por acordo mÃºtuo explÃ­cito do Codex; achado real novo: suÃ­te completa rodou 2624/2625 nesta sessÃ£o por corrida intermitente entre 2 arquivos de teste de arquitetura (`system-mutation-allowlist.test.ts`/`tenant-fence-boundary.test.ts`) cuja mitigaÃ§Ã£o jÃ¡ tentada (fixtures movidas, `fileParallelism: false`) nÃ£o foi suficiente â€” causa raiz nÃ£o identificada, PENDENTE; achado do Round1 sobre logger sem `correlationId` automÃ¡tico confirmado corrigido de fato (`AsyncLocalStorage` real); 3 achados mecÃ¢nicos do Codex corrigidos nesta sessÃ£o (contagem desatualizada em `test-engineering-standard.md`, comentÃ¡rio do dependency-cruiser, CycloneDX sem versÃ£o pinada) â€” ver reviews/full-audit-round2-qualidade-summary.md. E-022 â€” full-audit round2, eixo Engenharia de Contexto, reaberto (Round 1 fechou 2026-08-20 em 9,08/9,09); gate â‰¥9,0 NÃƒO atingido, convergido em 3 rodadas, nota final 6,84/10 â€” achado central: `NEXT_SESSION_PROMPT.md` cumpre o guardrail de linhas mas nÃ£o sua intenÃ§Ã£o (~134 KB), guardrail mede sÃ³ linhas; 5 achados factuais mecÃ¢nicos corrigidos em `docs/architecture/README.md` no processo â€” ver reviews/full-audit-round2-contexto-summary.md. **Achado central CORRIGIDO, D-236, 2026-09-08**: `NEXT_SESSION_PROMPT.md` recompactado (299 linhas/~145.804 bytes â†’ 87 linhas/~12.304 bytes) e `scripts/check-doc-drift.ts` ganhou guardrail de densidade (bytes+palavras, independente de contagem de linhas) â€” ver `docs/engineering/decisions-log.md` E-022 e `docs/architecture/decisions-log.md` D-236; gate â‰¥9,0 nÃ£o reavaliado por rodada nova nesta correÃ§Ã£o. E-021 â€” full-audit round2, eixo Arquitetura, reaberto pelo volume de mudanÃ§a de escopo desde round1 (D-084 a D-231+: Multi-User B2B completo, Document Archive completo, ADR-0009 substitui CDK por Terraform); melhora real (Claude 7,966â†’8,55, Codex 8,743â†’8,782), gate â‰¥9,0 ainda nÃ£o atingido, convergido em 3 rodadas; achado real novo nÃ­vel 5 (nÃ£o corrigido, PENDENTE): `src/workers/guest-credential-delivery/deliver.ts` reivindica o marcador idempotente antes do envio SES â€” falha entre claim e send perde a entrega de credencial guest permanentemente e silenciosamente, sem alarme dedicado, redrive nativo neutralizado pelo prÃ³prio claim â€” ver reviews/full-audit-round2-arquitetura-summary.md. E-020 â€” full-audit round2, eixo OperaÃ§Ãµes/SRE e Continuidade de NegÃ³cio, reaberto por crescimento de escopo (32â†’61 Lambdas, rollback.yml novo); gate â‰¥9,0 nÃ£o atingido (Claude 5,18â†’4,36, Codex 4,36, convergido em 2 rodadas); achado real nÃ­vel 5: rollback.yml hardcoda "exatamente 13 funÃ§Ãµes" no manifesto mas o manifesto real tem 34 â€” rollback falha antes de reverter qualquer alias, bug estÃ¡tico nÃ£o dependente de incidente real â€” ver reviews/full-audit-round2-operacoes-summary.md. E-019 â€” full-audit round2, eixo GovernanÃ§a JurÃ­dica/Contratual/Terceiros, reaberto por D-231 (primeiro secret de vendor externo real, Meta Cloud API); gate â‰¥9.0 ainda nÃ£o atingido (Claude 4,73â†’5,247, Codex 5,163â†’5,275, convergido em 2 rodadas); E-018 â€” full-audit round2, eixo SeguranÃ§a da InformaÃ§Ã£o e AppSec, ver decisions-log.md)
```

Este diretÃ³rio trata de **como o trabalho de engenharia Ã© medido e revisado** (rubrica, critÃ©rios por eixo, protocolo de debate, achados de auditoria) â€” nÃ£o confundir com `docs/architecture/`, que trata do que o sistema Ã‰ (design, modelo de dados, decisÃµes de arquitetura). Se a dÃºvida for "o GSI3 Ã© consultÃ¡vel por quem", vÃ¡ para `docs/architecture/`; se for "que nota isso tira / que processo formal se aplica aqui", este diretÃ³rio Ã© o certo.

## PrecedÃªncia de fontes (quando houver divergÃªncia)

Mesma regra de `docs/architecture/README.md` â€” `AGENTS.md` (raiz) sempre vence sobre conteÃºdo deste diretÃ³rio; um achado de auditoria (`reviews/full-audit-*-summary.md`) Ã© evidÃªncia de uma rodada especÃ­fica, nunca redefine os pesos/critÃ©rios de `joint-review-criteria.md` (ele mesmo linka para lÃ¡ em vez de duplicar, ver seu prÃ³prio rodapÃ© "Como adicionar um novo eixo").

## Quando carregar o quÃª (roteamento por tipo de tarefa)

| Sua tarefa Ã©... | Carregue |
|---|---|
| Rodar o protocolo Claudeâ†”Codex num eixo especÃ­fico (`AGENTS.md` Â§4) | `joint-review-criteria.md` (seÃ§Ã£o do eixo) + o `full-audit-round1-<eixo>-summary.md` mais recente em `reviews/`, se existir (retomar em vez de reabrir do zero) |
| Entender que nota um achado especÃ­fico do cÃ³digo tira / que critÃ©rio ele afeta | `joint-review-criteria.md` (nÃ£o precisa da rubrica congelada nem do bibliography) |
| Julgar se um teste automatizado ou drill operacional Ã© vÃ¡lido/de qualidade suficiente (gate binÃ¡rio, critÃ©rio ponderado, nota mÃ­nima) | `test-engineering-standard.md` â€” rÃ©gua concreta que `joint-review-criteria.md`'s critÃ©rio "Test Effectiveness & Coverage Discipline" passa a referenciar |
| Decidir se uma mudanÃ§a precisa de ADR/protocolo formal ou Ã© correÃ§Ã£o mecÃ¢nica | `change-risk-scale.md` (a rÃ©gua concreta) â€” `AGENTS.md` Â§4 sÃ³ distingue os dois extremos de forma binÃ¡ria |
| Marcar um item de todo list de cÃ³digo como `completed` | `definition-of-done.md` â€” gate por item (nÃ£o por PR/wave inteira): unidade de conclusÃ£o, gate por nÃ­vel de risco, registro mÃ­nimo de evidÃªncia |
| Decidir se uma proposta Type 1 precisa de pesquisa externa antes da Rodada 1, e como isso vira critÃ©rio de nota | `research-protocol.md` â€” critÃ©rio decidÃ­vel (nÃ­vel 5-6 + padrÃ£o externo estabelecido), declaraÃ§Ã£o `SIM`/`SIM PARCIAL`/`NÃƒO`, checklist de critÃ©rios derivado da pesquisa, fluxo de reconciliaÃ§Ã£o se o Codex contestar o checklist |
| Saber que comando roda em qual gate (PR vs. deploy) | `quality-gate-tiers.md` â€” mapeia Tier A/B/C (CI `guardrails`, `dynamodb-integration`, Camada 3 ainda pendente) aos comandos reais de `package.json` |
| Entender uma exceÃ§Ã£o/vulnerabilidade aceita (ex. EX-001) e seu prazo de revisÃ£o | `exceptions.md` |
| Ver o histÃ³rico completo de decisÃµes de engenharia (nÃ£o de arquitetura) com motivo | `decisions-log.md` â€” E-000 em diante, mesmo padrÃ£o de `docs/architecture/decisions-log.md` mas para decisÃµes de processo/qualidade, nÃ£o de sistema |
| Ver onde Claude e Codex genuinamente discordaram e como foi resolvido | `disagreement-log.md` |
| Entender a origem da rubrica de 12 critÃ©rios/gates G1-G6 (histÃ³rico, prÃ© full-audit) | `01-engineering-quality-criteria.md` (CONGELADA â€” mudanÃ§a exige nova rodada formal, nÃ£o ediÃ§Ã£o direta) + `00-research-bibliography.md` para as fontes que a fundamentam |
| Ver o estado exato do repositÃ³rio no inÃ­cio da Engineering Maturity Review (checkpoint 0) | `03-repository-baseline.md` â€” histÃ³rico, nÃ£o estado atual (ver aviso no prÃ³prio arquivo) |
| Consultar o resultado de uma auditoria especÃ­fica dos 9 eixos formalizados | `reviews/full-audit-round1-<eixo>-summary.md` (ver convenÃ§Ã£o de nomenclatura abaixo) |
| Consultar evidÃªncia bruta de uma rodada especÃ­fica (nota cega, prompt do Codex, saÃ­da bruta) | `reviews/full-audit-round1-<eixo>-{claude,codex-prompt,codex-output-roundN}.{md,txt}` â€” evidÃªncia, nunca ponto de entrada; leia o `-summary.md` primeiro |
| Rodar o checker de drift determinÃ­stico entre docs | `npm run check-docs` (`scripts/check-doc-drift.ts`) â€” link relativo quebrado + referÃªncia `AGENTS.md Â§N` desatualizada, bloqueante no CI (`guardrails`) |

## Ãndice por documento (nÃ­vel raiz de `docs/engineering/`)

| Documento | ClassificaÃ§Ã£o | Do que trata |
|---|---|---|
| `principles.md` | normativo atual | PrincÃ­pios de engenharia adotados (proporcionalidade, evidÃªncia antes de mecanismo) |
| `change-risk-scale.md` | normativo atual | Escala de risco de mudanÃ§a NÃ­vel 1-6, rÃ©gua concreta para "isso precisa de protocolo formal?" |
| `quality-gate-tiers.md` | normativo atual | Tiers de gate (PR vs. deploy), mapeados aos comandos reais |
| `definition-of-done.md` | normativo atual (APPROVED, protocolo Claudeâ†”Codex 3 rodadas, Claude 9,1/Codex 9,2, E-012; emenda E-013) | Definition of Done por item de todo list â€” granularidade ("unidade de conclusÃ£o"), gate por nÃ­vel de risco, classificaÃ§Ã£o de risco na prÃ¡tica, registro mÃ­nimo de evidÃªncia; complementa `quality-gate-tiers.md`/`change-risk-scale.md` sem substituÃ­-los. E-013 tornou a aplicaÃ§Ã£o de `test-engineering-standard.md` operacional (G-V3 mutaÃ§Ã£o nomeada por escrito), nÃ£o sÃ³ referencial |
| `research-protocol.md` | normativo atual (APPROVED, protocolo Claudeâ†”Codex 3 rodadas, Claude 9,2/Codex 9,2, E-014) | Pesquisa externa antes de decisÃµes Type 1 â€” gatilho acoplado a `change-risk-scale.md` nÃ­vel 5-6 + Rodada 1 do protocolo (nunca uma disciplina paralela para lembrar); declaraÃ§Ã£o `SIM`/`SIM PARCIAL`/`NÃƒO` com fonte+data+representatividade; checklist de critÃ©rios de nota derivado da pesquisa, sub-rubrica subordinada a `joint-review-criteria.md`; fluxo de reconciliaÃ§Ã£o quando o Codex contesta o checklist em si |
| `joint-review-criteria.md` | normativo atual | CritÃ©rios/pesos por eixo das revisÃµes conjuntas Claudeâ†”Codex (9 eixos formalizados + FinOps pendente) |
| `test-engineering-standard.md` | normativo atual (APPROVED, protocolo Claudeâ†”Codex 8 rodadas, gate elevado 9,5/10) | PadrÃ£o de validade/qualidade para teste automatizado e drill operacional (chaos/DiRT) â€” gates binÃ¡rios (G-V1..G-V6, G-C1), critÃ©rios ponderados, fÃ³rmula de agregaÃ§Ã£o, auditoria retroativa da Wave 2 (2026-08-28) |
| `logging-observability-standard.md` | normativo atual (APPROVED, protocolo Claudeâ†”Codex 3 rodadas, gate elevado 9,5/10) | RÃ©gua concreta de qualidade para logging/tracing/taxonomia de erro (`src/shared/observability/**`, `app-error.ts`, wiring Terraform de detecÃ§Ã£o) â€” 8 critÃ©rios ponderados, Ã¢ncoras de pontuaÃ§Ã£o, gate de auditoria 9,0/10, escrita em resposta a achados reais de uma rodada Codex de 2026-08-29 |
| `exceptions.md` | normativo atual (registro vivo) | ExceÃ§Ãµes/vulnerabilidades aceitas com owner e prazo |
| `decisions-log.md` | decisÃ£o (log vivo) | DecisÃµes de engenharia/processo, E-000 em diante |
| `disagreement-log.md` | histÃ³rico/registro vivo | DivergÃªncias materiais Claudeâ†”Codex e como foram resolvidas |
| `ai-governance.md` | normativo atual (registro vivo) | Matriz de autoridade por agente, regra de quando `AGENTS.md` Â§4 pode ser dispensado, inventÃ¡rio de casos de uso de IA, registro de modelo/fornecedor, incidentes causados pelo prÃ³prio agente (distinto de `exceptions.md`) |
| `01-engineering-quality-criteria.md` | histÃ³rico (CONGELADA) | Rubrica original de 12 critÃ©rios/gates G1-G6 da Engineering Maturity Review â€” antecessora conceitual de `joint-review-criteria.md`, nÃ£o superseded formalmente mas escopo majoritariamente absorvido pelos 9 eixos |
| `02-engineering-fitness-functions.md` | normativo atual | VerificaÃ§Ãµes executÃ¡veis derivadas da rubrica CONGELADA |
| `00-research-bibliography.md` | histÃ³rico/fundamentaÃ§Ã£o | Fontes de pesquisa que embasam a rubrica original |
| `03-repository-baseline.md` | histÃ³rico | Estado do repositÃ³rio no inÃ­cio da Engineering Maturity Review â€” nunca estado atual |
| `pilot-readiness-program.md` | registro vivo de backlog (nÃ£o normativo sobre arquitetura/design) | Backlog item-a-item do "Consolidation + Pilot Readiness Program" (`docs/project/handoffs/expiration-tracker-next-days-master-plan-and-ai-prompt.md`, movido da raiz em 2026-08-29) â€” DONE/PARTIAL/BLOCKED/DEFERRED/NOT STARTED por Wave 0-6, atualizado a cada milestone |
| `pilot-readiness-assessment.md` | sÃ­ntese/recomendaÃ§Ã£o (entregÃ¡vel final do programa, prompt mestre Â§42) | GO/CONDITIONAL GO/NO-GO por escopo de piloto, consolidando a evidÃªncia de `pilot-readiness-program.md` â€” nÃ£o repete achado, sÃ³ aponta; nÃ£o Ã© aprovaÃ§Ã£o final, Ã© insumo para a decisÃ£o do Marcelo |
| `reviews/` | histÃ³rico/evidÃªncia de rodada | Artefatos de toda rodada Claudeâ†”Codex de processo/qualidade â€” ver seÃ§Ã£o prÃ³pria abaixo |

## `reviews/` â€” convenÃ§Ã£o de nomenclatura e classificaÃ§Ã£o

EvidÃªncia de rodada, mesmo papel que `docs/architecture/history/` tem para decisÃµes de arquitetura: nunca normativo, sÃ³ prova de como uma nota/decisÃ£o foi alcanÃ§ada. TrÃªs geraÃ§Ãµes de conteÃºdo coexistem aqui, nesta ordem cronolÃ³gica:

1. **Checkpoints da Engineering Maturity Review** (`checkpoint-01-rubric/`, `checkpoint-02-09-consolidated/`, `checkpoint-12-redteam/`, e os arquivos soltos `_codex-*-checkpoint1-*.txt` no nÃ­vel raiz de `reviews/`) â€” produziram a rubrica CONGELADA (`01-engineering-quality-criteria.md`) e o red team que motivou G8. Prefixo `_` nos arquivos brutos Ã© intencional (agrupa antes de outros nomes em ordem alfabÃ©tica, sinaliza "transcript bruto, nÃ£o leia direto").
2. **ConvergÃªncia dos critÃ©rios por eixo** (`joint-review-criteria-round1-*`, `security-axis-criteria-round1-*`, `remaining-axes-round1-*`, `audit-areas-*`) â€” produziram `joint-review-criteria.md`.
3. **Full-audit dos 9 eixos formais** (`full-audit-round1-<eixo>-*`) â€” a rodada em andamento nesta sessÃ£o. PadrÃ£o de nomenclatura por eixo (`<eixo>` âˆˆ `arquitetura`, `qualidade`, `contexto`, `seguranca`, ...):
   - `full-audit-round1-<eixo>-claude.md`, `-claude-round2.md`, `-claude-round3.md`, ... â€” nota cega do Claude, uma por rodada.
   - `full-audit-round1-<eixo>-codex-prompt.txt` / `-codex-prompt-round2.txt`, ... â€” prompt enviado ao Codex CLI, um por rodada.
   - `full-audit-round1-<eixo>-codex-output-round1.txt`, `-round2.txt`, ... â€” saÃ­da bruta do Codex CLI. Alguns trechos que ecoam saÃ­da de outros comandos de shell continham mojibake (encoding double/triple-decoded em algumas invocaÃ§Ãµes via PowerShell) â€” revertido deterministicamente para os arquivos anteriores a cada rodada (achado real de higiene, corrigido, nÃ£o sÃ³ mitigado); a saÃ­da de uma rodada em andamento pode ainda conter mojibake atÃ© a rodada seguinte revisÃ¡-la, por ser evidÃªncia datada do que o Codex realmente viu naquele momento â€” nunca editada retroativamente. Se precisar do conteÃºdo, prefira o `-summary.md` correspondente, que jÃ¡ extrai a informaÃ§Ã£o sem o ruÃ­do de encoding.
   - `full-audit-round1-<eixo>-summary.md` â€” **o Ãºnico arquivo desta trinca que deveria ser lido diretamente.** Nota final por critÃ©rio (ambos os lados), achados corrigidos com commit real, achados restantes classificados em "impedimento externo real" vs. "escopo maior que correÃ§Ã£o pontual".

4. **Reabertura de um eixo jÃ¡ fechado** (`full-audit-round2-<eixo>-*`, mesmo padrÃ£o de nomenclatura acima, "round2" substitui "round1" no prefixo, nÃ£o sufixo `-round2.md` isolado como o de uma nota Claude dentro da mesma rodada) â€” usada quando a recomendaÃ§Ã£o de fechamento de um `full-audit-round1-<eixo>-summary.md` cita uma condiÃ§Ã£o objetiva de reabertura (ex.: "reabrir quando X for implementado") e essa condiÃ§Ã£o se materializa. Casos reais: `full-audit-round2-privacidade-*` (E-015, 2026-09-07), reaberto porque a condiÃ§Ã£o nomeada no fechamento round1 (purge worker real) foi satisfeita por D-179/D-190; `full-audit-round2-produto-multitenant-*` (E-016, 2026-09-07), reaberto pelo volume de mudanÃ§a de escopo desde round1 (Document Archive D-143â€“D-226, WhatsApp, B2B-7 a B2B-14) â€” melhora real (4,65â†’7,1/7,8), gate ainda nÃ£o atingido, nenhum vazamento cross-tenant confirmado nesta rodada; `full-audit-round2-governanca-ia-*` (E-017, 2026-09-08); `full-audit-round2-seguranca-*` (E-018, 2026-09-08); `full-audit-round2-juridico-*` (E-019, 2026-09-08), reaberto por D-231 (primeiro secret de vendor externo real, Meta Cloud API) â€” gate ainda nÃ£o atingido (5,247/5,275), convergido em 2 rodadas; `full-audit-round2-arquitetura-*` (E-021, 2026-09-08), reaberto pelo volume de mudanÃ§a de escopo desde round1 (D-084 a D-231+) â€” melhora real (7,966/8,743â†’8,55/8,782), gate ainda nÃ£o atingido, convergido em 3 rodadas, achado novo real nÃ­vel 5 (claim-before-send em `guest-credential-delivery/deliver.ts`, perda silenciosa de entrega, PENDENTE para decisÃ£o de Marcelo).

Arquivos de transcript bruto (`.txt`, prefixo `_`, ou os `full-audit-*-codex-output-*.txt`) nunca sÃ£o fonte de verdade por si sÃ³ â€” sempre prefira o `.md` de resumo/nota que os acompanha. **PolÃ­tica de proveniÃªncia/metadata**: os `.md` de nota/resumo carregam frontmatter (`status`/`owner`/`authority`, mais `Last verified` nos routers); os `.txt` brutos nÃ£o â€” exigir frontmatter em cada transcript violaria proporcionalidade (`principles.md` #1) sem ganho real, jÃ¡ que sua proveniÃªncia Ã© herdada do `.md` que os acompanha (mesmo prefixo de nome) e da posiÃ§Ã£o cronolÃ³gica descrita nesta seÃ§Ã£o. Isso Ã© uma decisÃ£o de design, nÃ£o uma lacuna: um transcript nunca Ã© lido isoladamente por convenÃ§Ã£o (ver acima), entÃ£o nÃ£o precisa carregar sua prÃ³pria metadata.

# docs/frontend/ â€” Ãndice do Planejamento de Interface

```text
SequÃªncia:       Context/Task Model â†’ Conceptual Model + IA â†’ Critical User Journeys â†’ Screen + State Inventory â†’ Low-Fidelity Wireframes â†’ Interaction Prototype â†’ Heuristic + Accessibility Evaluation â†’ Validation Readiness + Product Focus Hardening â†’ User Validation (prÃ³xima, nÃ£o iniciada)
Status vigente:  8 de 9 etapas de planejamento APPROVED; Full BFF + Frontend Production Foundation implementados; Core Expiration Vertical Slice (Collection/Detail/Create/Renew) implementado e APPROVED; Visual Language + Design System Foundation implementado e APPROVED (PROVISIONAL, pendente User Validation) â€” o frontend jÃ¡ NÃƒO Ã© mais grayscale/provisÃ³rio, mas a identidade visual continua explicitamente reversÃ­vel
Last verified:   2026-08-24 (planejamento) / 2026-08-26 (Visual Language + Design System Foundation) / 2026-08-28 (reconciliado com o Pilot Readiness Program â€” GTR-01/W5-01, `docs/engineering/pilot-readiness-program.md`; protÃ³tipo standalone de 2026-08-27 ainda NÃƒO reconciliado com o Design System vigente, ver W0-03 nesse documento)
```

Ver `docs/architecture/README.md` para o mapa de arquitetura de sistema (este Ã­ndice cobre sÃ³ o
planejamento de interface). PrecedÃªncia de fontes idÃªntica Ã  de `docs/architecture/README.md`:
`AGENTS.md` > decisÃ£o reconciliada > documento temÃ¡tico corrente > `NEXT_SESSION_PROMPT.md`
(estado, nunca normativo).

## Full BFF + Frontend de ProduÃ§Ã£o (implementaÃ§Ã£o real, distinto do planejamento de interface abaixo)

`docs/frontend/frontend-production-foundation.md` â€” Full BFF (D-053/D-054) implementado de ponta a ponta (`src/modules/bff/`, infra Terraform) e uma fundaÃ§Ã£o de frontend de produÃ§Ã£o real (`frontend/`, projeto npm separado â€” Vite+React+TS+React Router v7+TanStack Query v5). `APPROVED AS FRONTEND PRODUCTION FOUNDATION` via protocolo Claudeâ†”Codex (Rodada D levou 6 passagens atÃ© convergir â€” 5 achados bloqueantes reais de seguranÃ§a de sessÃ£o encontrados e corrigidos, todos na famÃ­lia "leitura de Session/LoginAttempt tratada como autoridade sem checar todas as propriedades de validade"). NÃ£o confundir com os 8 documentos de planejamento de interface abaixo (que cobrem UX/IA/journeys, nunca cÃ³digo de produÃ§Ã£o).

## Core Expiration Vertical Slice (primeiro vertical slice real do anchor Vencimentos)

`docs/frontend/core-expiration-vertical-slice.md` â€” primeiro fluxo real e completo de Vencimentos (Expiration Collection, Expiration Detail, Create Expiration, Renew Expiration) sobre a Frontend Production Foundation, sem expandir para Documents/Reminders/External Collection. `APPROVED AS CORE EXPIRATION PRODUCTION VERTICAL SLICE` via protocolo Claudeâ†”Codex (Round B adversarial achou 4 bugs reais â€” 1 S1: corrida TOCTOU na reaquisiÃ§Ã£o de um registro de idempotÃªncia `ABORTED`; 3 S2: `abort()` podendo disparar depois de um commit bem-sucedido, hash de renovaÃ§Ã£o ambÃ­guo quando `cycle` Ã© enviado independente de `newDueDate`, e um bug de fuso horÃ¡rio na formataÃ§Ã£o de data da Overview â€” todos corrigidos na Rodada C e reverificados sem achados novos na Rodada D). Durante a implementaÃ§Ã£o tambÃ©m corrigiu um bug real prÃ©-existente de liveness de idempotÃªncia (lock nunca liberado em falha de `renewItem`/`createItem`). 96 testes unitÃ¡rio/componente de frontend + 12 E2E Playwright (era 42+6 na fundaÃ§Ã£o), 621 testes de backend.

## Visual Language + Design System Foundation (primeira linguagem visual real)

`docs/frontend/visual-language-and-design-system.md` â€” substitui o `foundation.css`
deliberadamente provisÃ³rio (71 linhas, 4 tokens, escala de cinza) por uma arquitetura de tokens
em duas camadas (primitivos â†’ aliases semÃ¢nticos), ~9 primitives acessÃ­veis
(`frontend/src/components/ui/`), e a aplicaÃ§Ã£o da direÃ§Ã£o **Operational Calm** Ã s cinco
superfÃ­cies do Core Expiration slice. `APPROVED AS VISUAL LANGUAGE + DESIGN SYSTEM FOUNDATION
â€” PROVISIONAL PENDING USER VALIDATION`.

Nenhuma dependÃªncia nova (nenhum framework de UI, nenhum Storybook, nenhuma biblioteca de
Ã­cones); JS de bundle inalterado. A mudanÃ§a estrutural Ãºnica Ã© a Expiration Collection ter
deixado de ser `<ul>/<li>` e virado uma `<table>` semÃ¢ntica com urgÃªncia e situaÃ§Ã£o em colunas
separadas â€” mesmos dados, ordenaÃ§Ã£o, agrupamento, filtro e rotas. Densidade real (140 itens,
nomes longos e quase-idÃªnticos) verificada contra o cÃ³digo real do frontend pela primeira vez,
com asserÃ§Ã£o automatizada em `frontend/e2e/expiration-density.spec.ts`; 10 baselines de
regressÃ£o visual determinÃ­sticas em `frontend/e2e/visual-regression.spec.ts` (projeto Playwright
`visual`, local â€” ver Â§31 do documento para a limitaÃ§Ã£o de plataforma, o caminho de adoÃ§Ã£o em CI
e o mapa baseline-a-baseline de qual teste funcional cobre cada superfÃ­cie enquanto isso).
Acessibilidade deixou de ser narrativa e virou `frontend/e2e/accessibility.spec.ts` â€” **9 testes
no projeto `chromium`, portanto no CI em todo PR**: contraste computado, percurso de teclado com
anel, alvo e **cobertura de todo focÃ¡vel** (Ã© a cobertura, nÃ£o o tÃ©rmino, que descarta
armadilha), ausÃªncia de sticky/fixed, reduced motion, forced colors, regiÃ£o de scroll condicional
e associaÃ§Ã£o label/erro nos forms. Duas falhas reais foram achadas por essas asserÃ§Ãµes e
corrigidas (contraste 4,48:1 e alvo de 19px).

Protocolo Claudeâ†”Codex: **16 rodadas, 11 reaberturas**, convergindo em Codex **9,04** e Claude
**9,2** (`AGENTS.md` Â§4, sem arredondamento) â€” o protocolo mais longo jÃ¡ executado neste
repositÃ³rio. A Rodada B achou 5 achados reais (2 S2: um botÃ£o de mutaÃ§Ã£o clicÃ¡vel durante o
submit porque `disabled ?? pending` curto-circuitava num `false` explÃ­cito, e cabeÃ§alhos de grupo
com `scope="colgroup"` onde encabeÃ§avam linhas). TrÃªs rodadas posteriores acharam defeitos
**criados pela rodada de correÃ§Ã£o anterior** (D-01, F-01, G-01) â€” o modo de falha que o protocolo
existe para pegar. E a classe dominante de achado nÃ£o foi cÃ³digo errado: foi **documentaÃ§Ã£o
afirmando prova mais ampla que a evidÃªncia nomeada**, que apareceu seis vezes e sÃ³ foi eliminada
na Rodada P. Vale como precedente de processo: a alegaÃ§Ã£o "sem armadilha de teclado" passou dez
rodadas sem prova real por trÃ¡s dela. Registro de decisÃµes, contrastes medidos, resultados dos
gates `VL-G1..VL-G17`, as limitaÃ§Ãµes declaradas e o registro de 15 adiamentos para User
Validation estÃ£o no prÃ³prio documento.

**AtualizaÃ§Ã£o trazida pelo Marcelo (2026-08-30) â€” `design-system.md`** (mesma pasta, movida da
raiz do repo em 2026-08-30 como `design-system-v1-proposal.md`, renomeada e emendada em
2026-08-31 apÃ³s reconciliaÃ§Ã£o): `APPROVED COM EMENDA` via protocolo Claudeâ†”Codex (5 rodadas,
Claude 9,2/Codex 9,5, D-130) â€” amadurece a mesma linguagem visual "Operational Calm" jÃ¡
implementada com arquitetura formal de tokens, catÃ¡logo de componentes e patterns. Os valores
primitivos concretos do texto original (paleta roxa, Plus Jakarta Sans, escala tipogrÃ¡fica,
radius) foram substituÃ­dos, na Â§0 do prÃ³prio documento, pelos valores reais jÃ¡ `APPROVED` em
`visual-language-and-design-system.md`/`tokens.css` â€” nenhum gate `VL-G` foi reaberto. Esta foi
exatamente a atualizaÃ§Ã£o que `docs/engineering/pilot-readiness-program.md`'s Wave 1 (Design
System Reconciliation) estava esperando; Wave 1 pode agora ser executada (reconciliar o frontend
real contra este documento) â€” ver esse documento e
`docs/architecture/reviews/design-system-reconciliation-scoping/estado-final-consolidado.md`.

## Ãndice por documento

| Documento | Status | Do que trata |
|---|---|---|
| `interface-context-and-critical-tasks.md` | `APPROVED AS INPUT FOR CONCEPTUAL MODEL + INFORMATION ARCHITECTURE` | PapÃ©is funcionais (`Internal Operator`, `External Submitter`), Jobs to Be Done, inventÃ¡rio completo de tarefas, classificaÃ§Ã£o de criticidade (T0-T3) Ã— frequÃªncia Ã— `Implementation Readiness` (READY/PARTIAL/BLOCKED/FUTURE) â€” eixos deliberadamente separados apÃ³s amendment metodolÃ³gico. Descobriu os 3 blockers tÃ©cnicos de backend (ver abaixo). |
| `interface-conceptual-model-and-information-architecture.md` | `APPROVED AS INPUT FOR CRITICAL USER JOURNEYS` | Modelo conceitual de usuÃ¡rio (Vencimento/Documento/Fornecedor/Requisito/SolicitaÃ§Ã£o/Alerta), Information Architecture recomendada (**dual-anchor**: Vencimentos + Fornecedor/Subject como dois anchors mentais coexistentes, sem hierarquia Ãºnica â€” `ExpirationItem` nÃ£o tem `subjectId`). Amendment semÃ¢ntico corrigiu `Document.CLEAN`="Aprovado" e `RequirementAssignment.SATISFIED`="Em dia" (nenhum dos dois Ã© verdade â€” verificado em cÃ³digo) e formalizou `GTR-01`. |
| `interface-critical-user-journeys.md` | `APPROVED AS INPUT FOR SCREEN + STATE INVENTORY` | 8 journeys (J-01 a J-08) mapeadas outcome-a-outcome, com fluxo passo-a-passo classificado por `System Knowledge` (KNOWN/INFERRED/PENDING/CONFIRMED/FAILED/UNKNOWN), failure/recovery paths, matrizes de dependÃªncia de backend. Achou que `POST /items` nÃ£o tem idempotÃªncia (`CREATE-IDEMPOTENCY-01`) e que o guest flow comprime "enviado" com "verificado". |
| `interface-screen-and-state-inventory.md` | `APPROVED AS INPUT FOR LOW-FIDELITY WIREFRAMES` | 17 Interaction Surfaces (`SURF-001` a `SURF-017`) derivadas das 8 journeys, com taxonomia de estado compartilhada (loading/empty/error/persistence/visibility), Epistemic Integrity Matrix, e as 3 matrizes Surfaceâ†”Journey/Concept/Transition. Achado real da revisÃ£o: `Document.SCANNING` estava classificado `PERSISTED` incorretamente como `REMOTE_ASYNC`/`USER_KNOWN` â€” corrigido para `NOT_CURRENTLY_OBSERVABLE` (o mesmo gap de leitura de `BLOCKER-A` comeÃ§a em `SCANNING`, nÃ£o sÃ³ em `CLEAN`). |
| `interface-low-fidelity-wireframes.md` | `APPROVED AS INPUT FOR INTERACTION PROTOTYPE` | Wireframe ASCII de baixa fidelidade das 17 `SURF-xxx`, agrupadas em 3 lotes (Ã¢ncora Vencimento â†’ Ã¢ncora Fornecedor â†’ isoladas/utility), com hierarquia primary/secondary/contextual, convenÃ§Ãµes estruturais fixas (`[PRIMARY]`/`âš [DANGEROUS]`/`[BLOQUEADO: BLOCKER-X]`), 8 journey walkthroughs e State Coverage Matrix. Achados reais da revisÃ£o: affordance de aÃ§Ã£o primÃ¡ria ausente em 4 coleÃ§Ãµes, `BLOCKER-A` mascarado no estado inicial de Document Context (afirmava "nenhum documento" quando a interface nÃ£o pode saber isso), `SATISFIED` reaproximado de "compliance atual" numa das variantes de branch de `BLOCKER-C`, e um canal (WhatsApp) sem lastro â€” todos corrigidos. |
| `interface-interaction-prototype.md` + `prototype/` | `APPROVED AS INPUT FOR HEURISTIC + ACCESSIBILITY EVALUATION AND USER VALIDATION` | ProtÃ³tipo interativo real (HTML/CSS/JS sem dependÃªncias, `prototype/app.js`), 17 rotas 1:1 com `SURF-001`â€“`SURF-017`, 34 Prototype Scenario IDs determinÃ­sticos cobrindo J-01â€“J-08 (happy path + alternates + falha + recovery + re-entry), verificado com testes automatizados de navegador headless. Achados reais da revisÃ£o: compressÃ£o de estados no guest upload (faltava validaÃ§Ã£o de arquivo e o estado "reserva aceita" distinto de "enviado"), uma simulaÃ§Ã£o de coleta externa anunciando ao operador uma verificaÃ§Ã£o de seguranÃ§a que `BLOCKER-A`/`BLOCKER-C` tornam `NOT_CURRENTLY_OBSERVABLE`, dois campos de formulÃ¡rio sem `<label>`, e uma reincidÃªncia de menÃ§Ã£o a WhatsApp â€” todos corrigidos e reverificados funcionalmente. |
| `interface-heuristic-accessibility-evaluation.md` | `APPROVED AS INPUT FOR USER VALIDATION` | AvaliaÃ§Ã£o do protÃ³tipo **executÃ¡vel** (Nielsen H1-H10, WCAG 2.2 AA, teclado/foco/semÃ¢ntica/forms real em navegador headless, `axe-core`, re-execuÃ§Ã£o de J-01â€“J-08, Epistemic Integrity, `BLOCKER-A/B/C`/`GTR-01`/`CREATE-IDEMPOTENCY-01`). Protocolo completo de 4 rodadas Claudeâ†”Codex: Rodada A (autoavaliaÃ§Ã£o, 9 achados corrigidos) concluiu aprovaÃ§Ã£o prematuramente â€” Rodada B (adversarial) achou 6 problemas-raiz reais nÃ£o vistos, o mais grave sendo a prÃ³pria guarda anti-duplo-submit da Rodada A quebrando recovery de validaÃ§Ã£o (S3) e `reconcileImport()` afirmando ter criado registros sem materializÃ¡-los (violaÃ§Ã£o epistÃªmica real); Rodada C corrigiu os 6, mas errou ao manter jargÃ£o tÃ©cnico ("SIMULATED...BACKEND") numa superfÃ­cie pÃºblica de guest; Rodada D (nova adversarial) achou essa lacuna e uma correÃ§Ã£o incompleta em `submitAlert` (travava apÃ³s sucesso, nÃ£o sÃ³ apÃ³s erro) â€” ambos corrigidos e reverificados no fechamento. Quality Score final **9.04/10**, calculado apÃ³s esse histÃ³rico, nÃ£o apenas sobre o estado final do cÃ³digo. |
| `interface-validation-readiness.md` | `APPROVED FOR USER VALIDATION PLANNING` | Hardening final antes de User Validation, 8 workstreams: Participant Mode (default, sem anotaÃ§Ãµes tÃ©cnicas) vs. Evaluator Mode (`?mode=evaluator`, preserva tudo); `GTR-01` simulado no guest flow (identidade do solicitante), documentado como simulaÃ§Ã£o, nÃ£o backend-resolvido; cenÃ¡rio de densidade `PROTO-STRESS-DENSITY-01` (155 vencimentos/38 fornecedores/95 requisitos) que achou e corrigiu uma falta real de ordenaÃ§Ã£o por urgÃªncia; `CREATE-IDEMPOTENCY-01` **resolvido no backend real** (`createItem` ganhou `idempotencyKey` opcional, mesmo padrÃ£o de `renewItem`); tese de produto (compliance documental leve de terceiros) e mÃ©tricas de validaÃ§Ã£o formalizadas; `interface-quality-standard.md` criado (12 eixos jÃ¡ em uso desde a 1Âª etapa, agora formal); matriz de gates User Validation/Pilot/Paid Pilot/Public Production. Protocolo de 4 rodadas + 1 fechamento: Rodada B achou 4 furos reais (2 vazamentos de anotaÃ§Ã£o tÃ©cnica, teste de idempotÃªncia incompleto, 2 imprecisÃµes de documentaÃ§Ã£o); Rodada D, apÃ³s reconciliaÃ§Ã£o, achou **mais 6 vazamentos** numa releitura exaustiva (nenhum introduzido pela Rodada C) â€” todos corrigidos no fechamento, zero contaminaÃ§Ã£o residual confirmada. |

## Blockers tÃ©cnicos de backend (citados por ID em todo o planejamento)

| ID | O que Ã© | Onde bloqueia |
|---|---|---|
| `BLOCKER-A` | Nenhuma rota lÃª/lista `Document`/`DocumentSubmission` â€” sÃ³ upload/delete existem | Outcome "manter evidÃªncia documental" (J-04); indireto em renovaÃ§Ã£o (J-03) |
| `BLOCKER-B` | **Resolvido tecnicamente e mergeado** â€” implementaÃ§Ã£o real mergeada em `develop` (PR #50, commit `8f00160`, 2026-08-25) e jÃ¡ em `main`/`dev`, `docs/architecture/reminder-delivery-pipeline.md`. Salvar uma `ReminderPolicy` agora materializa e agenda um lembrete real de ponta a ponta; `renewItem` tambÃ©m copia a `ReminderPolicy` do item de origem para o novo (decisÃ£o do Marcelo, 2026-08-25) | Outcome "ser avisado antes do vencimento" (J-05) â€” desbloqueado |
| `BLOCKER-C` | Ciclo de coleta externa (guest upload) nÃ£o fecha sozinho â€” sem transiÃ§Ã£o automÃ¡tica nem visibilidade da submissÃ£o | Outcome "obter documentaÃ§Ã£o de terceiros" (J-06); branch point nÃ£o decidido (automÃ¡tico vs. revisÃ£o humana) |
| `GTR-01` | Guest flow nÃ£o expÃµe identidade do solicitante ao fornecedor externo â€” risco de Trust/phishing | J-07 (guest submission), UX trust readiness `NOT READY` no backend real. **Simulado** no Participant Mode do protÃ³tipo desde `interface-validation-readiness.md` (identidade fixa "Empresa Alfa Ltda."), nunca implementado â€” ver matriz de gates nesse documento Â§20. Escopo tÃ©cnico do gap fechado em 2026-08-28 (`docs/engineering/pilot-readiness-program.md` item `W5-01`) â€” nenhum campo de nome de tenant/empresa existe em lugar nenhum do backend real hoje; fechar isso nÃ£o depende de Organization/Membership existir primeiro, mas precisa de decisÃ£o de produto (`W5-01-DECISION`) sobre o que capturar. |

Achados menores registrados, nÃ£o elevados a blocker nomeado: guest flow sem rota pÃºblica de
confirmaÃ§Ã£o pÃ³s-envio (`interface-critical-user-journeys.md` Â§14); query tenant-wide de
solicitaÃ§Ãµes pendentes inexistente (`interface-screen-and-state-inventory.md` Â§41, bloqueia
`SURF-013`). `CREATE-IDEMPOTENCY-01` (`POST /items` sem proteÃ§Ã£o de idempotÃªncia,
`interface-critical-user-journeys.md` Â§9) **resolvido no backend real** em
`interface-validation-readiness.md` Â§14 (`createItem` ganhou `idempotencyKey` opcional, mesmo
padrÃ£o de `IdempotencyStore` jÃ¡ usado por `renewItem`) â€” classificado formalmente como
`PRODUCTION GATE`; ver matriz de gates para o status por estÃ¡gio. Desde o Core Expiration
Vertical Slice, o frontend/BFF reais enviam o header em ambos os fluxos (Create e Renew) â€” gap
fechado para o caminho de item.

## Mission briefs (histÃ³rico â€” entrada bruta que originou as etapas acima)

Movidos da raiz do repo em 2026-08-29 (limpeza de contexto), mesmo tratamento de `docs/architecture/blocker-b-mission-brief.md`: texto verbatim do prompt que abriu cada etapa, preservado como evidÃªncia, nunca normativo.

- `interface-context-and-critical-tasks-mission-brief.md` â€” abriu `interface-context-and-critical-tasks.md`.
- `interface-conceptual-model-mission-brief.md` â€” abriu `interface-conceptual-model-and-information-architecture.md` (e a preparaÃ§Ã£o tÃ©cnica que descobriu os 3 blockers).
- `interface-screen-and-state-inventory-mission-brief.md` â€” abriu `interface-screen-and-state-inventory.md`.

## PadrÃ£o de qualidade formalizado

`docs/frontend/interface-quality-standard.md` â€” criado em `interface-validation-readiness.md`
(Workstream G), consolidando os 12 eixos, modelo de severidade, quality gates e threshold
(`Overall â‰¥ 9.0`) que jÃ¡ eram usados desde a primeira etapa, sem introduzir critÃ©rio novo.
`bff-frontend-quality-standard-proposal.md` (mesma pasta, movido da raiz em 2026-08-29) Ã© agora
`status: SUPERSEDED` (2026-08-31, D-130) â€” ver
`docs/frontend/frontend-engineering-quality-standard.md` e o mapa de destino Â§1-37 em
`docs/architecture/reviews/design-system-reconciliation-scoping/estado-final-consolidado.md`.
Arquivo preservado como evidÃªncia histÃ³rica, sem valor normativo residual.

**`docs/frontend/frontend-engineering-quality-standard.md`** (mesma pasta; trazido pelo Marcelo em
2026-08-30 como `frontend-engineering-quality-standard-v1-proposal.md`, renomeado e `APPROVED` em
2026-08-31 via protocolo Claudeâ†”Codex, 5 rodadas, Claude 9,2/Codex 9,5, D-130) â€” cobre
`frontend/**`, `src/modules/bff/**`, contratos consumidos pelo browser, Design System,
acessibilidade, performance, observabilidade do browser, deploy do frontend, com 12 eixos de
engenharia e gates `FE-G1..FE-G5`. Explicitamente nÃ£o substitui o Definition of Done global
(`docs/engineering/definition-of-done.md`), sÃ³ o especializa para mudanÃ§as de frontend.
**Coexiste** com `interface-quality-standard.md` (12 eixos de UX/IA, escopo diferente) via um
crosswalk de ownership formal (Â§4.3 do documento) que garante que nenhum achado Ã© pontuado duas
vezes â€” gate combinado quando ambos aplicÃ¡veis Ã© `FrontendOverall >= 9.0 AND InterfaceOverall >=
9.0`, calculados independentemente. **Supersede** `bff-frontend-quality-standard-proposal.md`
(ver acima).

## DomÃ­nio Documental â€” proposta trazida pelo Marcelo (2026-08-31, ainda nÃ£o avaliada)

6 documentos movidos da raiz do repo para `docs/frontend/` em 2026-08-31 (organizaÃ§Ã£o de contexto, mesmo tratamento dos demais documentos desta pasta) â€” planejamento de uma evoluÃ§Ã£o do produto para "vencimentos + arquivo documental operacional + ciclo de renovaÃ§Ã£o", em sequÃªncia prÃ³pria (planejamento â†’ especificaÃ§Ã£o â†’ decisÃµes D1-D10 â†’ jornadas/critÃ©rios de aceitaÃ§Ã£o v0.2 â†’ wireframes de baixa fidelidade â†’ plano de validaÃ§Ã£o). **Nenhum destes passou ainda pelo protocolo Claudeâ†”Codex nem foi avaliado a fundo por Claude** â€” sÃ£o proposta de produto do Marcelo, anÃ¡loga ao tratamento inicial de `design-system-v1-proposal.md` antes da reconciliaÃ§Ã£o de D-130. NÃ£o tratar como `APPROVED` atÃ© uma rodada de avaliaÃ§Ã£o real acontecer.

- `document-domain-functional-planning.md` â€” visÃ£o: evoluir o Expiration Tracker para "gestÃ£o de vencimentos + arquivo documental operacional + ciclo de renovaÃ§Ã£o"; escopo produto/UX, sem decisÃ£o de engenharia.
- `document-domain-functional-specification-v0.1.md` â€” especificaÃ§Ã£o formal de objetos, estados, relaÃ§Ãµes, jornadas e superfÃ­cies do domÃ­nio documental (`PROPOSTA FUNCIONAL v0.1`).
- `document-domain-functional-decisions.md` â€” fecha as 10 decisÃµes (D1-D10) propostas na especificaÃ§Ã£o v0.1 (`APROVADO COMO DIREÃ‡ÃƒO FUNCIONAL INICIAL` â€” aprovaÃ§Ã£o do prÃ³prio Marcelo, nÃ£o via protocolo).
- `document-domain-journeys-and-acceptance-criteria-v0.2.md` â€” jornadas detalhadas e critÃ©rios de aceitaÃ§Ã£o funcionais (`ESPECIFICAÃ‡ÃƒO FUNCIONAL v0.2`).
- `document-domain-wireframes.md` â€” wireframes de baixa fidelidade das telas/jornadas crÃ­ticas (`WIREFRAMES FUNCIONAIS v0.1`), explicitamente sem identidade visual final.
- `document-domain-wireframes-validation-plan.md` â€” plano para validar os wireframes antes de virarem protÃ³tipo de alta fidelidade, baseado em `interface-quality-standard.md` + `frontend-engineering-quality-standard.md`.

## PrÃ³xima etapa

**User Validation** â€” ainda nÃ£o iniciada (o roteiro formal de entrevista fica para `User Validation
Planning`, nÃ£o produzido em `interface-validation-readiness.md` Â§23 por decisÃ£o explÃ­cita de
escopo). Recebe como input o protÃ³tipo jÃ¡ com Participant Mode isolado (`prototype/`, ver
`prototype/README.md` para como rodar â€” Participant Mode Ã© o default, `?mode=evaluator` ativa o
modo de engenharia) e `interface-validation-readiness.md` Â§15-18/Â§23-24 (tese de produto, mÃ©tricas
de validaÃ§Ã£o, tarefas candidatas, limitaÃ§Ãµes conhecidas a comunicar ao facilitador) â€” sem
redescobrir estrutura, estados, semÃ¢ntica, achados de acessibilidade, ou os gates de produto/
engenharia jÃ¡ fechados. NÃ£o obriga o inÃ­cio imediato de Visual Design/Design System.


exec
"C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -Command 'Get-Content -Raw src/modules/identity/domain/authorization.ts; rg --files src/modules/organization src/modules/document-archive src/modules/subject src/modules/expiration src/modules/notification | Sort-Object; rg -n "method:|path:|route|router|GET |POST |PATCH |DELETE |export const .*Handler|Action" src/runtime/aws/handlers src/modules/organization src/modules/document-archive src/modules/subject src/modules/expiration src/modules/notification' in C:\Users\Usuario\Desktop\projects\expiration-tracker
 succeeded in 3606ms:
/**
 * Authorization matrix â€” implementation-blueprint.md Â§4.3. "A matriz Ã© cÃ³digo
 * versionado e testado, nÃ£o documentaÃ§Ã£o informal."
 */
import type { RequestContext } from "./request-context.js";

export type Action =
  | "item:create"
  | "item:read"
  | "item:update"
  | "item:delete"
  | "item:watch"
  | "reminder:manage"
  | "document:reserve-upload"
  | "document:read"
  | "document:delete"
  | "extraction:confirm"
  | "notification:configure"
  | "audit:read"
  | "system:ping" // M1 test route action, not in the blueprint's business list but
  // declared explicitly here rather than silently bypassing the matrix (see report).
  // M9 (evoluÃ§Ã£o estratÃ©gica do roadmap, D-036/D-039, 03-domain-model-tracked-subject-
  // requirement.md e 07-domain-model-escalation-watchers-digest.md): TrackedSubject +
  // RequirementAssignment + ItemWatch. Mesmo padrÃ£o resolver-deriva-tenantId de todo mÃ³dulo
  // existente â€” nenhuma dessas actions confia em tenantId fornecido pelo cliente.
  | "subject:create"
  | "subject:read"
  | "subject:update"
  | "subject:delete"
  | "requirement:assign"
  | "requirement:read"
  | "requirement:update"
  | "requirement:delete"
  | "requirement:review"
  // M10 (guest upload/magic link, D-037, 04-domain-model-guest-upload.md): apenas o lado
  // autenticado do tenant tem action prÃ³pria â€” o convidado nunca passa por authorize()/
  // RequestContext, Ã© validado por GuestTokenService (fora da matriz de roles por design).
  | "requirement:request-document"
  // M10 cluster 4 (D-049): polÃ­tica de tenant para automatizar o convite inicial de guest
  // upload â€” decisÃ£o de comunicaÃ§Ã£o externa/reputaÃ§Ã£o de todo o tenant, nÃ£o uma aÃ§Ã£o por
  // request individual (essa Ã© `requirement:request-document` acima). B2B-7 (D-097/D-098):
  // OWNER_ROLES, nÃ£o ADMIN_ROLES â€” a classe de "workspace settings"/comunicaÃ§Ã£o externa que a
  // pesquisa de RBAC (research-protocol.md) mostrou ficar separada mesmo em produtos que dÃ£o
  // a ADMIN paridade de conteÃºdo com OWNER.
  | "tenant:configure-document-request-delivery"
  // M11 (CSV import/export, D-042, 09-domain-model-csv-import.md, cluster 7): superfÃ­cie de
  // processamento em massa - mesma granularidade de document:reserve-upload/document:read.
  | "import:create"
  | "import:read"
  | "import:commit"
  // D-192 slice 9: `POST /import-jobs/{jobId}/mapping` â€” same WRITE_ROLES tier as
  // `import:commit` (both mutate the job's lifecycle/state machine, never a passive read).
  | "import:map"
  // B2B-8 (D-099, docs/architecture/multi-user-b2b-wave-b2b8-scope.md): Invitations/Team.
  // Pesquisa (GitHub/Slack/Linear/Notion, 2026-08-30) convergiu em ADMIN-tier-e-acima gerencia
  // membros (nunca MEMBER/VIEWER), e sÃ³ OWNER promove/demove o prÃ³prio tier OWNER (Slack:
  // "Owners can assign Owners... [and] assign Admins") â€” a segunda parte nÃ£o Ã© expressÃ¡vel na
  // matriz genÃ©rica (nÃ£o hÃ¡ um "OWNER, exceto quando o alvo/novo role Ã© OWNER"), fica como
  // checagem de serviÃ§o nomeada (OwnerTierChangeRequiresOwnerError) em cima do ADMIN_ROLES
  // baseline abaixo. `membership:leave` nunca aceita um alvo externo (LeaveOrganizationService
  // opera sÃ³ sobre ctx.principal.userId por assinatura) - a proteÃ§Ã£o real Ã© o LastOwnerError
  // transacional, nÃ£o a matriz.
  | "membership:invite"
  | "membership:revoke-invitation"
  // Convites pendentes carregam e-mail + intenÃ§Ã£o de adicionar pessoa - superfÃ­cie
  // administrativa (Linear "Settings > Administration > Members" para pending invites), nunca
  // a mesma tier de "listar membros ativos" (achado real da Rodada 1 do Codex).
  | "membership:list-invitations"
  | "membership:list-members"
  | "membership:role-change"
  | "membership:remove"
  | "membership:leave"
  // Wave B2B-10 (Tenant-aware Frontend): Organization.displayName/timezone. OWNER_ROLES, same
  // tier as "tenant:configure-document-request-delivery" above â€” workspace identity/settings
  // that reads externally (invitation emails, guest-facing name) is consistently kept OWNER-only
  // in this codebase, not paritary with ADMIN like most other membership-management actions.
  | "organization:update-settings"
  // D-123/D-126 (CSV data export): bulk export of ExpirationItem rows across the whole tenant.
  // ADMIN_ROLES, NOT a bulk-action precedent â€” the justification is disclosure asymmetry:
  // export READS every member's work (including items the caller never touched), while
  // import only WRITES what the actor could already create individually. See
  // docs/architecture/reviews/data-export-scoping/round-3-claude-proposal.md.
  | "item:export"
  // W3-07 purge orchestrator (D-124, implementing D-121): closing the organization starts the
  // physical, irreversible tenant purge (`ACTIVE -> DELETING -> ... -> DELETED`). OWNER_ROLES,
  // the same tier as `tenant:configure-document-request-delivery`/`organization:update-settings`
  // above â€” this is the single most destructive tenant-wide action in the system, so it can never
  // be paritary with ADMIN the way ordinary content administration is.
  | "organization:close"
  // D-127 (quarantine/recovery window): cancels an in-progress closure while the tenant is
  // `HELD_FOR_RECOVERY`. Same OWNER_ROLES tier as `organization:close` â€” reversing the most
  // destructive tenant-wide action is at least as sensitive as triggering it. Registered here for
  // the closed `Action` type (`AuthorizationDeniedError`/`auditAuthorizationDenied` typing) and
  // for matrix completeness, but the actual authorization check for this action is
  // `authorizeCancelClosure()` below, NOT the generic `authorize()` â€” the caller
  // (`CancelOrganizationClosureService`) cannot build a `RequestContext` in the first place
  // (`resolve-request-context.ts` requires `TenantLifecycleRecord.status === ACTIVE`, which a
  // `HELD_FOR_RECOVERY` tenant is definitionally not), so `authorize()`'s own `AuthorizationInput`
  // shape (needs `context: RequestContext`) is not constructible on this path at all.
  | "organization:cancel-close"
  // D-143 (Document Archive domain, Nucleus 1): distinct namespace from the existing
  // `document:*` actions above, which belong to the low-level generic file-object storage
  // module (src/modules/document/ â€” S3/malware-scan primitives). `docarchive:*` is the
  // higher-level business domain (Document/DocumentVersion/state machine) â€” same tenant-wide
  // RBAC tiers as every other business resource, no per-item ACL (D-143 Decision 1/9 explicitly
  // rejected presuming an ACL `authorize()` doesn't implement). `docarchive:review` covers
  // claim/accept/reject â€” the finer-grained "may THIS actor decide THIS version" check is a
  // separate, named service-level gate (`assertReviewerOrAdmin`), not a distinct RBAC action.
  | "docarchive:create"
  | "docarchive:read"
  | "docarchive:upload"
  | "docarchive:review"
  // D-143 Nucleus 2, entity 1 (Decision 5, D-145): Requirement â€” "algo que um Subject precisa
  // possuir, apresentar ou manter vÃ¡lido". Deliberately NOT reusing `requirement:*` above:
  // those belong to the older, distinct `subject` module's `RequirementAssignment` concept
  // (linked ExpirationItem, MISSING<->SATISFIED only). This Requirement is document-archive's
  // own aggregate (linked DocumentVersion evidence, 5-state derived status) â€” a real naming
  // collision resolved deliberately by namespacing under `docarchive:`, same prefix as this
  // module's other actions, rather than overloading the older name silently.
  | "docarchive:requirement-create"
  | "docarchive:requirement-read"
  | "docarchive:requirement-update"
  | "docarchive:requirement-delete"
  // D-143 Nucleus 2, entity 3/3 (Decision 8, D-147): recurrence. Series management (create/
  // read/list/cancel, materializeAttempt) is a tenant-facing operation, same WRITE/READ_ONLY
  // tiers as Requirement above â€” no per-item ACL here either, same D-143 Decision 9 rationale.
  // `docarchive:series-materialize` is distinct from `-update` because it is invoked by the
  // periodic producer/materializer worker on the series' own schedule, not by a direct caller
  // edit â€” kept as its own action so a future service-role-scoped policy could grant it
  // separately from interactive series editing without reshaping the matrix again.
  | "docarchive:series-create"
  | "docarchive:series-read"
  | "docarchive:series-update"
  | "docarchive:series-cancel"
  | "docarchive:series-materialize"
  // D-226 Achado 2 (`guest-credential-issuance-scoping/estado-final-consolidado.md`): avulso/
  // non-recurring DocumentRequest creation, outside any DocumentRequestSeries cycle â€” same
  // WRITE_ROLES tier as series-create/materialize above (D-222 gap 2).
  | "docarchive:request-create"
  // D-173 (`DocumentType` catalog): tenant-scoped, renamable-but-identity-stable catalog entry
  // closing item 8 of D-161's macro-order. Same tier as `document:delete`/`requirement:delete`
  // (ADMIN_ROLES for every mutation, READ_ONLY_ROLES for listing/reading) â€” a catalog entry is
  // shared, tenant-wide configuration, not a per-item content resource a MEMBER should mutate.
  | "docarchive:documenttype-create"
  | "docarchive:documenttype-rename"
  | "docarchive:documenttype-deprecate"
  | "docarchive:documenttype-reactivate"
  | "docarchive:documenttype-read"
  // RequirementTemplate (P0.1). The catalog itself is admin-only, exactly like DocumentType;
  // APPLYING a template is deliberately a SEPARATE action with WRITE_ROLES â€” applying creates
  // operational Requirements, it does not administer the catalog.
  | "docarchive:requirementtemplate-create"
  | "docarchive:requirementtemplate-update"
  | "docarchive:requirementtemplate-duplicate"
  | "docarchive:requirementtemplate-archive"
  | "docarchive:requirementtemplate-unarchive"
  | "docarchive:requirementtemplate-read"
  | "docarchive:requirementtemplate-apply"
  // Roadmap P0.7 ("RelatÃ³rios, ExportaÃ§Ã£o e Audit Trail"), fatias 1-2: bulk CSV reports over
  // Requirement rows (missing-requirements/requirements-by-subject/requirements-by-assignee),
  // reading every member's rows tenant-wide. Same disclosure-asymmetry rationale `item:export`
  // above already documents for D-123/D-126, not `docarchive:requirement-read`'s READ_ONLY_ROLES
  // tier (a single caller-scoped search page). ADMIN_ROLES, same tier as `item:export`.
  | "docarchive:requirement-export"
  // D-149 (Admin Activity/Audit Log view, admin-activity-log-scoping/estado-final-consolidado.md
  // decisÃ£o 3): visibility into what OTHER members did (renewal/creation/export/etc.) is
  // disclosure-sensitive equivalent to bulk export (`item:export` above) - deliberately NOT the
  // more permissive precedent of reading one's own resource. ADMIN_ROLES, same tier as `item:export`.
  | "activity:read"
  // D-204 decision 1 (Roadmap P1 item 15, scheduled reports), D-213 fatia (HTTP CRUD):
  // ReportSubscription creation/management is disclosure-sensitive by the same reasoning as
  // `docarchive:requirement-export` above (a subscription names OTHER members as recipients,
  // and its reports are the same bulk cross-member CSVs `item:export`/`docarchive:requirement-
  // export` already gate) - ADMIN_ROLES, same tier, single action for create/read/list/delete
  // (no separate read tier - unlike DocumentType/RequirementTemplate, a subscription has no
  // less-sensitive "browse the catalog" use case a MEMBER/VIEWER would legitimately need).
  | "reports:subscription-manage"
  // D-205 decision 10 (Roadmap P1 item 16, dossier export): ADMIN_ROLES EXCLUSIVELY, no
  // assignee tier - achado real do Codex (Rodada 1): `authorization.ts`'s own resource-ownership
  // gate only applies when `ownerUserId` AND `assigneeUserId` both exist on the resource, and
  // `Requirement` never has `ownerUserId`, so an "ADMIN_ROLES ou assignee" rule could never be
  // expressed here structurally - closed by removing the assignee tier entirely rather than
  // inventing a new resource-ownership shape for one route. Same disclosure profile as
  // `docarchive:requirement-export`/`item:export` (a full-Subject export is the same bulk
  // cross-Requirement disclosure those already gate), covers preview+confirm+download.
  | "docarchive:dossier-export"
  // D-218 (Roadmap P1, "metadata configurÃ¡vel por Document Type"): field/option CATALOG
  // mutation (create/rename/archive/reactivate a metadata field or one of its SINGLE_SELECT
  // options) is ADMIN_ROLES, same tier as `docarchive:documenttype-*` above â€” a metadata field
  // definition is shared, tenant-wide catalog configuration, not a per-item content resource.
  // Editing the VALUE of an existing field on one Document is a separate, lower-sensitivity
  // action â€” WRITE_ROLES, same tier as `docarchive:create`/`docarchive:upload` (day-to-day data
  // entry on an already-existing Document, not catalog administration). `docarchive:update`
  // (presumed to exist by an early draft of this decision) does not exist â€” `Document` has no
  // generic edit action today, only `create`/`upload`/`review`.
  | "docarchive:documenttype-metadata-manage"
  | "docarchive:document-metadata-update";

/**
 * D-234 (E-018, full-audit-round2 Seguranca criterio 2, protocolo Claude<->Codex 4 rodadas):
 * branded provenance marker for a tenantId that came from an authenticated `RequestContext`, not
 * from arbitrary client input. This does NOT prove `authorize()` was called (Codex Rodada 2
 * finding) - it only proves the value traces back to `RequestContext.tenant.tenantId`, which
 * itself is resolved server-side from the caller's identity (`resolve-request-context.ts`), never
 * from a request body/path/query parameter. Persistence-layer functions that build a PK's tenant
 * segment should prefer accepting `AuthorizedTenantId` over a raw `tenantId: string` where the
 * call site already has a `RequestContext` - the type system then rejects a client-supplied string
 * being threaded straight into a key builder without going through this function first. No `as
 * AuthorizedTenantId` cast is permitted outside this file (grep-able convention, same discipline
 * as `TRANSACTION_CANCELED`'s single-producer pattern in `shared/dynamodb/occ.ts`).
 */
export type AuthorizedTenantId = string & { readonly __brand: "AuthorizedTenantId" };

export function authorizedTenantId(context: RequestContext): AuthorizedTenantId {
  return context.tenant.tenantId as AuthorizedTenantId;
}

/**
 * D-2xx (document-archive key-builder propagation, follow-up to D-234): second, narrower
 * provenance constructor for the non-HTTP half of `AuthorizedTenantId`'s propagation gap â€” async
 * workers (`src/workers/**`) that build a persistence key from a `tenantId` but have no
 * `RequestContext` (no authenticated caller on the path at all). Call ONLY with an entity/record
 * that was itself just read back from a trusted repository call (`store.get`/`queryByPk`/
 * `queryIndexPage`/`scanActiveSeries`/â€¦) â€” never with a bare field lifted straight off an SQS
 * message/event payload before it has been reconciled against a persisted record, since a queue
 * payload is still one hop removed from "traced back to an authenticated identity." The whole
 * `entity` (not a bare string) is required deliberately: it makes a suspicious call site (passing
 * something that isn't actually a repository read result) visibly wrong at the call site, the same
 * shape-based nudge `authorizedTenantId(context: RequestContext)` gets from requiring a
 * `RequestContext.` TypeScript's structural typing cannot literally prove the object came from
 * DynamoDB â€” this is an audited trust boundary, not a compile-time guarantee, enforced by the same
 * "no `as AuthorizedTenantId` outside this file" convention as the HTTP-path constructor above.
 */
export function authorizedTenantIdFromPersistedEntity(entity: Readonly<{ tenantId: string }>): AuthorizedTenantId {
  return entity.tenantId as AuthorizedTenantId;
}

export interface AuthorizedResource {
  tenantId: string;
  ownerUserId?: string;
  assigneeUserId?: string;
  status?: string;
}

export interface AuthorizationInput {
  context: RequestContext;
  action: Action;
  resource?: AuthorizedResource;
}

/**
 * Role model closed by Wave B2B-7 (RBAC, D-097/D-098) â€” `Membership.role` (D-090) has 4 real
 * values; this matrix now recognizes all of them. Research protocol E-014 applied for the
 * first time (docs/engineering/research-protocol.md): GitHub/Linear/Slack/Notion + NIST/ANSI
 * INCITS 359 (Hierarchical RBAC) don't converge on a single "what does Admin get beyond
 * Member" answer, so each action formerly gated to ADMIN_ROLES got a named, individual
 * decision instead of a blanket parity rule â€” see multi-user-b2b-wave-b2b7-scope.md.
 */
export type Role = "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";

const READ_ONLY_ROLES: ReadonlySet<Role> = new Set(["OWNER", "ADMIN", "MEMBER", "VIEWER"]);
const WRITE_ROLES: ReadonlySet<Role> = new Set(["OWNER", "ADMIN", "MEMBER"]);
const ADMIN_ROLES: ReadonlySet<Role> = new Set(["OWNER", "ADMIN"]);
/** Owner-exclusive tier (B2B-7) â€” reserved for actions with tenant-wide external/reputational
 * impact (research: the class GitHub/Linear/Slack/Notion keep apart from ordinary content
 * admin). Members: `tenant:configure-document-request-delivery` (B2B-7),
 * `organization:update-settings` (B2B-10), `organization:close` (W3-07/D-124). */
const OWNER_ROLES: ReadonlySet<Role> = new Set(["OWNER"]);

const ACTION_ROLES: Record<Action, ReadonlySet<Role>> = {
  "item:create": WRITE_ROLES,
  "item:read": READ_ONLY_ROLES,
  "item:update": WRITE_ROLES,
  "item:delete": ADMIN_ROLES,
  "item:export": ADMIN_ROLES,
  "item:watch": WRITE_ROLES,
  "reminder:manage": WRITE_ROLES,
  "document:reserve-upload": WRITE_ROLES,
  "document:read": READ_ONLY_ROLES,
  "document:delete": ADMIN_ROLES,
  "extraction:confirm": WRITE_ROLES,
  // B2B-7 bug fix (not an ADMIN-vs-OWNER call): this action gates both read and update of a
  // per-user preference (ctx.principal.userId-keyed, notification-preferences-service.ts),
  // never tenant-wide config. This is tied to the ability to RECEIVE a reminder -
  // assigneeUserId is never role-checked, so a VIEWER can legitimately be a notification
  // recipient and must be able to configure it for themself. Reuses READ_ONLY_ROLES (already
  // "any real Membership") rather than adding a 5th constant with the same 4 members.
  "notification:configure": READ_ONLY_ROLES,
  "audit:read": READ_ONLY_ROLES,
  "system:ping": READ_ONLY_ROLES,
  "subject:create": WRITE_ROLES,
  "subject:read": READ_ONLY_ROLES,
  "subject:update": WRITE_ROLES,
  "subject:delete": ADMIN_ROLES,
  "requirement:assign": WRITE_ROLES,
  "requirement:read": READ_ONLY_ROLES,
  "requirement:update": WRITE_ROLES,
  "requirement:delete": ADMIN_ROLES,
  "requirement:review": WRITE_ROLES,
  "requirement:request-document": WRITE_ROLES,
  "tenant:configure-document-request-delivery": OWNER_ROLES,
  "import:create": WRITE_ROLES,
  "import:read": READ_ONLY_ROLES,
  "import:commit": WRITE_ROLES,
  "import:map": WRITE_ROLES,
  "membership:invite": ADMIN_ROLES,
  "membership:revoke-invitation": ADMIN_ROLES,
  "membership:list-invitations": ADMIN_ROLES,
  "membership:list-members": READ_ONLY_ROLES,
  "membership:role-change": ADMIN_ROLES,
  "membership:remove": ADMIN_ROLES,
  "membership:leave": READ_ONLY_ROLES,
  "organization:update-settings": OWNER_ROLES,
  "organization:close": OWNER_ROLES,
  "organization:cancel-close": OWNER_ROLES,
  "docarchive:create": WRITE_ROLES,
  "docarchive:read": READ_ONLY_ROLES,
  "docarchive:upload": WRITE_ROLES,
  "docarchive:review": WRITE_ROLES,
  "docarchive:requirement-create": WRITE_ROLES,
  "docarchive:requirement-read": READ_ONLY_ROLES,
  "docarchive:requirement-update": WRITE_ROLES,
  "docarchive:requirement-delete": WRITE_ROLES,
  "docarchive:series-create": WRITE_ROLES,
  "docarchive:series-read": READ_ONLY_ROLES,
  "docarchive:series-update": WRITE_ROLES,
  "docarchive:series-cancel": WRITE_ROLES,
  "docarchive:series-materialize": WRITE_ROLES,
  "docarchive:request-create": WRITE_ROLES,
  "activity:read": ADMIN_ROLES,
  "reports:subscription-manage": ADMIN_ROLES,
  "docarchive:dossier-export": ADMIN_ROLES,
  "docarchive:documenttype-metadata-manage": ADMIN_ROLES,
  "docarchive:document-metadata-update": WRITE_ROLES,
  "docarchive:documenttype-create": ADMIN_ROLES,
  "docarchive:documenttype-rename": ADMIN_ROLES,
  "docarchive:documenttype-deprecate": ADMIN_ROLES,
  "docarchive:documenttype-reactivate": ADMIN_ROLES,
  "docarchive:documenttype-read": READ_ONLY_ROLES,
  "docarchive:requirementtemplate-create": ADMIN_ROLES,
  "docarchive:requirementtemplate-update": ADMIN_ROLES,
  "docarchive:requirementtemplate-duplicate": ADMIN_ROLES,
  "docarchive:requirementtemplate-archive": ADMIN_ROLES,
  "docarchive:requirementtemplate-unarchive": ADMIN_ROLES,
  "docarchive:requirementtemplate-read": READ_ONLY_ROLES,
  "docarchive:requirementtemplate-apply": WRITE_ROLES,
  "docarchive:requirement-export": ADMIN_ROLES,
};

/**
 * D-234 (E-018, Rodada 3/4): every real `Action` this matrix knows about, derived directly from
 * `ACTION_ROLES`'s own keys - never a hand-maintained parallel list. `test/integration/
 * tenant-isolation-matrix.test.ts` iterates this array to assert the TENANT_MISMATCH check applies
 * uniformly; because it is derived (not duplicated), a new `Action` added to the union above
 * cannot silently escape that test - `ACTION_ROLES` is a `Record<Action, ...>`, so TypeScript
 * itself already forces every new Action to get an entry before this compiles, and this array
 * picks it up automatically at runtime with zero maintenance.
 */
export const ALL_ACTIONS: readonly Action[] = Object.keys(ACTION_ROLES) as Action[];

export type AuthorizationDenialReason = "TENANT_MISMATCH" | "NO_MEMBERSHIP" | "INSUFFICIENT_ROLE" | "RESOURCE_OWNERSHIP_MISMATCH";

export class AuthorizationDeniedError extends Error {
  constructor(
    readonly reason: AuthorizationDenialReason,
    readonly action: Action,
  ) {
    super(`Authorization denied for action "${action}": ${reason}`);
    this.name = "AuthorizationDeniedError";
  }
}

/**
 * authorize() â€” implementation-blueprint.md Â§4.3: "authorize() verifica primeiro
 * igualdade de tenant, depois papel e vÃ­nculo por recurso." Throws
 * AuthorizationDeniedError (never returns false) so callers cannot forget to check
 * a boolean result â€” the http layer maps this to AuthorizationError (403).
 *
 * Order matters and is deliberately fail-closed at every step:
 *  1. context must carry at least one role (no membership => no access at all).
 *  2. if a resource is supplied, resource.tenantId MUST equal context.tenant.tenantId â€”
 *     this is the check that makes cross-tenant ID substitution fail, independent of
 *     role, and independent of what the caller *claims* the resource's tenant is (the
 *     resource object here must always be populated from a DB read keyed by the
 *     authenticated tenantId, never from client input â€” see repository contract).
 *  3. role must be sufficient for the action.
 *  4. if the resource declares an owner/assignee, membership role alone isn't enough
 *     for actions that are resource-scoped by ownership in the future; MVP has no
 *     per-item ownership finer than tenant, so this step is a no-op today but kept
 *     explicit so a future item-level ACL doesn't require re-deriving this function.
 */
export function authorize(input: AuthorizationInput): void {
  const { context, action, resource } = input;
  const roles = context.tenant.roles as Role[];

  if (roles.length === 0) {
    throw new AuthorizationDeniedError("NO_MEMBERSHIP", action);
  }

  if (resource && resource.tenantId !== context.tenant.tenantId) {
    throw new AuthorizationDeniedError("TENANT_MISMATCH", action);
  }

  const allowedRoles = ACTION_ROLES[action];
  const hasRole = roles.some((role) => allowedRoles.has(role));
  if (!hasRole) {
    throw new AuthorizationDeniedError("INSUFFICIENT_ROLE", action);
  }

  if (resource?.assigneeUserId && resource.ownerUserId) {
    const isOwnerOrAssignee =
      resource.ownerUserId === context.principal.userId ||
      resource.assigneeUserId === context.principal.userId;
    // OWNER and ADMIN bypass per-resource ownership (tenant-wide content admin, B2B-7 -
    // ADMIN has parity with OWNER over business resources, see authorization.ts role model
    // comment above), MEMBER/VIEWER scoped resources require ownership match once per-item
    // ACLs exist. This is enforced only when both fields ARE present (defensive for future
    // use), never invented from nothing.
    if (!roles.includes("OWNER") && !roles.includes("ADMIN") && !isOwnerOrAssignee) {
      throw new AuthorizationDeniedError("RESOURCE_OWNERSHIP_MISMATCH", action);
    }
  }
}

export interface CancelClosureAuthorizationInput {
  /** Read directly (`GlobalUser.identityStatus`) by `CancelOrganizationClosureService`'s own
   * identity-mapping path â€” never derived from a `RequestContext`, which cannot be built for a
   * `HELD_FOR_RECOVERY` tenant in the first place (see the `organization:cancel-close` doc
   * comment above). */
  identityStatus: "ACTIVE" | "SUSPENDED";
  membershipStatus: "ACTIVE" | "SUSPENDED" | "REMOVED";
  membershipRole: Role;
}

/**
 * D-127: the dedicated authorization primitive for cancelling an in-progress tenant closure â€”
 * deliberately NOT `authorize()`. Two reasons this cannot be the generic function:
 *  1. `authorize()`'s signature requires a `RequestContext`, which requires
 *     `resolveWorkingOrganization()`/`TenantLifecycleRecord.status === ACTIVE` to have already
 *     succeeded (`resolve-request-context.ts`) â€” structurally uncomputable for a tenant that IS
 *     `HELD_FOR_RECOVERY` by definition on this path.
 *  2. Even granting a hypothetical relaxed `RequestContext`, the tenant's own RBAC state during
 *     the recovery window is not necessarily the ordinary "one clean read" `authorize()` assumes
 *     â€” this reads `GlobalUser`/`Membership` directly and fresh, with its own explicit
 *     ACTIVE-on-both checks, rather than trusting a context object assembled by a different
 *     resolution path built for a different (ACTIVE-tenant) precondition.
 *
 * Same fail-closed ordering discipline as `authorize()`: identity status checked before
 * membership status before role â€” the first failing check wins, no partial/best-effort pass.
 * Throws (never returns false), same convention as `authorize()`, so callers cannot forget to
 * check a boolean result.
 */
export function authorizeCancelClosure(input: CancelClosureAuthorizationInput): void {
  const action: Action = "organization:cancel-close";
  if (input.identityStatus !== "ACTIVE") {
    throw new AuthorizationDeniedError("NO_MEMBERSHIP", action);
  }
  if (input.membershipStatus !== "ACTIVE") {
    throw new AuthorizationDeniedError("NO_MEMBERSHIP", action);
  }
  if (input.membershipRole !== "OWNER") {
    throw new AuthorizationDeniedError("INSUFFICIENT_ROLE", action);
  }
}

src/modules/document-archive\application\advance-file-after-evidence.ts
src/modules/document-archive\application\apply-file-scan-result.ts
src/modules/document-archive\application\document-archive-guest-rate-limiter.ts
src/modules/document-archive\application\document-archive-service.ts
src/modules/document-archive\application\document-request-credential-issuance-service.ts
src/modules/document-archive\application\document-request-recurrence-service.ts
src/modules/document-archive\application\dossier-pdf-builder.ts
src/modules/document-archive\application\dossier-xlsx-builder.ts
src/modules/document-archive\application\external-share-link-service.ts
src/modules/document-archive\application\guest-document-access-service.ts
src/modules/document-archive\application\id-generator.ts
src/modules/document-archive\domain\document.ts
src/modules/document-archive\domain\document-archive-clean-key.ts
src/modules/document-archive\domain\document-archive-quarantine-key.ts
src/modules/document-archive\domain\document-file.ts
src/modules/document-archive\domain\document-request.ts
src/modules/document-archive\domain\document-request-series.ts
src/modules/document-archive\domain\document-type.ts
src/modules/document-archive\domain\document-version.ts
src/modules/document-archive\domain\document-version-event.ts
src/modules/document-archive\domain\dossier-export-run.ts
src/modules/document-archive\domain\external-share-link.ts
src/modules/document-archive\domain\guest-credential-delivery.ts
src/modules/document-archive\domain\guest-session.ts
src/modules/document-archive\domain\request-access-credential.ts
src/modules/document-archive\domain\requirement.ts
src/modules/document-archive\domain\requirement-template.ts
src/modules/document-archive\http\document-archive-guest-handlers.ts
src/modules/document-archive\http\document-archive-handlers.ts
src/modules/document-archive\persistence\dynamodb-document-archive-store.ts
src/modules/document-archive\persistence\dynamodb-guest-credential-delivery-marker-store.ts
src/modules/document-archive\persistence\s3-dossier-export-store.ts
src/modules/document-archive\persistence\s3-external-share-link-file-store.ts
src/modules/document-archive\ports\document-archive-store.ts
src/modules/document-archive\ports\dossier-export-store.ts
src/modules/document-archive\ports\external-share-link-file-store.ts
src/modules/document-archive\ports\guest-credential-delivery-marker-store.ts
src/modules/expiration\application\expiration-service.ts
src/modules/expiration\application\id-generator.ts
src/modules/expiration\application\item-watch-service.ts
src/modules/expiration\domain\audit-event.ts
src/modules/expiration\domain\expiration-item.ts
src/modules/expiration\domain\item-watch.ts
src/modules/expiration\http\bulk-action-handlers.ts
src/modules/expiration\http\export-handler.ts
src/modules/expiration\http\item-handlers.ts
src/modules/expiration\http\item-watch-handlers.ts
src/modules/expiration\persistence\dynamodb-expiration-store.ts
src/modules/expiration\ports\expiration-store.ts
src/modules/expiration\ports\member-eligibility.ts
src/modules/notification\application\corrective-intent-service.ts
src/modules/notification\application\email-delivery.ts
src/modules/notification\application\email-delivery-workflow.ts
src/modules/notification\application\notification-preferences-service.ts
src/modules/notification\application\notification-router.ts
src/modules/notification\application\notification-router-workflow.ts
src/modules/notification\application\quiet-hours.ts
src/modules/notification\application\ses-callback-processor.ts
src/modules/notification\application\ses-callback-workflow.ts
src/modules/notification\application\whatsapp-activation.ts
src/modules/notification\application\whatsapp-delivery.ts
src/modules/notification\application\whatsapp-delivery-workflow.ts
src/modules/notification\application\whatsapp-opt-in-service.ts
src/modules/notification\application\whatsapp-outbox.ts
src/modules/notification\application\whatsapp-portfolio-quota-service.ts
src/modules/notification\application\whatsapp-webhook-processor.ts
src/modules/notification\application\whatsapp-webhook-workflow.ts
src/modules/notification\domain\notification-attempt.ts
src/modules/notification\domain\notification-entitlements.ts
src/modules/notification\domain\notification-preferences.ts
src/modules/notification\domain\whatsapp-opt-in.ts
src/modules/notification\domain\whatsapp-portfolio-quota.ts
src/modules/notification\http\preferences-handlers.ts
src/modules/notification\persistence\dynamodb-notification-store.ts
src/modules/notification\persistence\dynamodb-recipient-resolver.ts
src/modules/notification\persistence\secrets-manager-whatsapp-config.ts
src/modules/notification\ports\email-provider.ts
src/modules/notification\ports\notification-store.ts
src/modules/notification\ports\recipient-resolver.ts
src/modules/notification\ports\whatsapp-provider.ts
src/modules/notification\providers\email-templates.ts
src/modules/notification\providers\ses-email-adapter.ts
src/modules/notification\providers\whatsapp-cloud-api-adapter.ts
src/modules/organization\application\accept-invitation.ts
src/modules/organization\application\cancel-organization-closure.ts
src/modules/organization\application\change-membership-role.ts
src/modules/organization\application\close-organization.ts
src/modules/organization\application\create-invitation.ts
src/modules/organization\application\create-organization.ts
src/modules/organization\application\id-generator.ts
src/modules/organization\application\leave-organization.ts
src/modules/organization\application\list-membership.ts
src/modules/organization\application\membership-invite-rate-limiter.ts
src/modules/organization\application\onboarding-state.ts
src/modules/organization\application\owner-count-guard.ts
src/modules/organization\application\remove-membership.ts
src/modules/organization\application\resolve-active-membership.ts
src/modules/organization\application\resolve-working-organization.ts
src/modules/organization\application\revoke-invitation.ts
src/modules/organization\application\update-organization-settings.ts
src/modules/organization\domain\audit-event.ts
src/modules/organization\domain\invitation.ts
src/modules/organization\domain\invitation-token.ts
src/modules/organization\domain\membership.ts
src/modules/organization\domain\organization.ts
src/modules/organization\http\membership-handlers.ts
src/modules/organization\http\organization-lifecycle-handlers.ts
src/modules/organization\http\organization-settings-handlers.ts
src/modules/organization\persistence\dynamodb-organization-store.ts
src/modules/organization\ports\assigned-active-items-lookup.ts
src/modules/organization\ports\assigned-active-requirements-lookup.ts
src/modules/organization\ports\organization-store.ts
src/modules/subject\application\advance-after-submission-evidence.ts
src/modules/subject\application\document-chasing-materializer.ts
src/modules/subject\application\document-chasing-producer.ts
src/modules/subject\application\document-request-service.ts
src/modules/subject\application\guest-rate-limiter.ts
src/modules/subject\application\guest-submission-service.ts
src/modules/subject\application\id-generator.ts
src/modules/subject\application\initial-invite-rate-limiter.ts
src/modules/subject\application\requirement-service.ts
src/modules/subject\application\subject-service.ts
src/modules/subject\domain\audit-event.ts
src/modules/subject\domain\document-chasing.ts
src/modules/subject\domain\document-request.ts
src/modules/subject\domain\document-request-delivery-preference.ts
src/modules/subject\domain\document-submission.ts
src/modules/subject\domain\entitlement.ts
src/modules/subject\domain\guest-token.ts
src/modules/subject\domain\requirement-assignment.ts
src/modules/subject\domain\submission-quarantine-key.ts
src/modules/subject\domain\tracked-subject.ts
src/modules/subject\http\document-request-handlers.ts
src/modules/subject\http\guest-handlers.ts
src/modules/subject\http\requirement-handlers.ts
src/modules/subject\http\subject-handlers.ts
src/modules/subject\persistence\dynamodb-subject-store.ts
src/modules/subject\ports\expiration-item-lookup.ts
src/modules/subject\ports\subject-store.ts
src/modules/notification\http\preferences-handlers.ts:89:/** GET /notifications/preferences - always returns 200 with the caller's own preferences,
src/modules/notification\persistence\dynamodb-recipient-resolver.ts:17: * single state, so the router's existing cancellation-reason distinction stays meaningful.
src/modules/notification\persistence\dynamodb-recipient-resolver.ts:39:        // source (never raw client input) - same threading convention as notification-router-
src/modules/notification\providers\email-templates.ts:144:  // LINK here is always the authenticated API route (`GET /reports/subscriptions/{subscriptionId}
src/modules/notification\providers\email-templates.ts:147:  // role, so the e-mail only ever points at the route that mints a fresh 5-minute presign on
src/modules/document-archive\ports\external-share-link-file-store.ts:1:/** D-225 Decision 5 — presigns a GET against a `DocumentFile.cleanObject` triple for the
src/modules/document-archive\ports\external-share-link-file-store.ts:2: * anonymous visitor route. Deliberately narrower than `UploadUrlSigner` (that port presigns
src/modules/document-archive\ports\dossier-export-store.ts:3: * generation worker (write, once per run) and the authenticated download route (read,
src/modules/document-archive\ports\dossier-export-store.ts:17:  /** Mints a short-lived (decision 9: 5 min, same as D-204 decision 7) presigned GET for an
src/modules/notification\providers\whatsapp-cloud-api-adapter.ts:96:        method: "POST",
src/modules/expiration\application\expiration-service.ts:34:import { buildAuditEvent, appendAuditToTransaction, type AuditAction } from "../domain/audit-event.js";
src/modules/expiration\application\expiration-service.ts:57: * integration test measuring wall-clock time before exposing the route in production; adjust
src/modules/expiration\application\expiration-service.ts:951:    action: AuditAction,
src/modules/expiration\application\expiration-service.ts:1017:      action: AuditAction;
src/modules/notification\ports\recipient-resolver.ts:3: * the router never re-implements eligibility rules itself.
src/modules/notification\ports\recipient-resolver.ts:11: * silent fallback to some other user) when validation fails, which the router turns into
src/modules/notification\domain\notification-entitlements.ts:6: * window". Consumption happens in the delivery worker, never in the router (a
src/modules/notification\domain\notification-attempt.ts:18: * attempt's channel and the intent's `requestedChannels`/`routedChannels` can never drift into
src/modules/notification\domain\notification-attempt.ts:20: * in `notification-router.ts` still routes `EMAIL` alone — WhatsApp delivery itself (the
src/modules/notification\domain\notification-attempt.ts:60:  /** Set when status transitions to SUBMITTING - decideSendAction (email-delivery.ts) uses
src/modules/notification\domain\notification-preferences.ts:9: * router (that would silently stop every reminder for any user whose onboarding didn't run
src/modules/notification\domain\notification-preferences.ts:10: * this step) - see notification-router.ts's fail-closed matrix for the distinct, narrower
src/modules/notification\domain\whatsapp-opt-in.ts:9: * "consent is scoped to the CURRENT phone" true by construction — a future router checking
src/modules/expiration\domain\audit-event.ts:15:export type AuditAction = "CREATE" | "UPDATE" | "ARCHIVE" | "RENEW" | "DELETE";
src/modules/expiration\domain\audit-event.ts:24:  action: AuditAction;
src/modules/expiration\domain\audit-event.ts:54:  action: AuditAction;
src/modules/organization\http\organization-lifecycle-handlers.ts:9: * action must not be triggerable by a bare POST that a mis-wired client (or a curious caller
src/modules/organization\http\organization-lifecycle-handlers.ts:38:   * route is simply unreachable (like `closeOrganization` above) when absent. */
src/modules/organization\http\membership-handlers.ts:2: * HTTP handlers for Wave B2B-8 (Invitations/Team, D-099) membership-management routes —
src/modules/organization\http\membership-handlers.ts:4: * calls `authorize()`) and its AppError -> status-code mapping, so every route in the system
src/modules/organization\http\membership-handlers.ts:6: * same class as `POST /bff/organizations`, D-096), wired in `bff/http/bff-handlers.ts` instead.
src/modules/subject\http\subject-handlers.ts:176:/** D-194 Fatia 3 — GET /subjects/search. `status` is required/singular (schema enforces
src/modules/subject\http\subject-handlers.ts:178: * signature mirrors every field this route accepts as a filter, so re-presenting it with a
src/modules/subject\http\requirement-handlers.ts:131:/** BLOCKER-A (segunda metade): GET /subjects/{subjectId}/requirements/{assignmentId}/submissions. */
src/modules/subject\http\requirement-handlers.ts:143:/** BLOCKER-A (segunda metade): GET /subjects/{subjectId}/requirements/{assignmentId}/submissions/{submissionId}. */
src/modules/subject\domain\audit-event.ts:14:export type SubjectAuditAction =
src/modules/subject\domain\audit-event.ts:40:  action: SubjectAuditAction;
src/modules/subject\domain\audit-event.ts:67:  action: SubjectAuditAction;
src/modules/document-archive\application\advance-file-after-evidence.ts:8: * `decideNextAction()` separately), `DocumentFile`'s `applyFileScanResult()` already does BOTH —
src/modules/document-archive\application\advance-file-after-evidence.ts:9: * persists whichever evidence half this call observed AND applies `decideNextAction()`'s
src/modules/subject\application\advance-after-submission-evidence.ts:4: * (`decideNextAction`, document-state-machine.ts) — vocabulário de evidência/estado é
src/modules/subject\application\advance-after-submission-evidence.ts:10:import { decideNextAction } from "../../document/domain/document-state-machine.js";
src/modules/subject\application\advance-after-submission-evidence.ts:44:    const decision = decideNextAction({
src/modules/subject\application\document-request-service.ts:13:import { buildSubjectAuditEvent, appendSubjectAuditToTransaction, type SubjectAuditAction, type SubjectAuditResourceType } from "../domain/audit-event.js";
src/modules/subject\application\document-request-service.ts:383:    input: { resourceType: SubjectAuditResourceType; resourceId: string; subjectId: string; action: SubjectAuditAction; previousVersion: number | undefined; newVersion: number; changes: Record<string, unknown> },
src/modules/organization\domain\audit-event.ts:14:export type MembershipAuditAction =
src/modules/organization\domain\audit-event.ts:29:  action: MembershipAuditAction;
src/modules/organization\domain\audit-event.ts:59:  action: MembershipAuditAction;
src/runtime/aws/handlers\bulk-actions-handler.ts:2: * D-206/D-207 (bulk reassign/archive, Roadmap P1 item 17). Dedicated Lambda, not routes
src/runtime/aws/handlers\bulk-actions-handler.ts:6: * TransactWriteItems, needs more budget than any single-item /items* route. This mechanism
src/runtime/aws/handlers\bulk-actions-handler.ts:31:  return runWithContext({ correlationId: event.requestContext.requestId }, () => handleBulkActionsRoute(event));
src/runtime/aws/handlers\bulk-actions-handler.ts:34:async function handleBulkActionsRoute(event: APIGatewayProxyEventV2WithJWTAuthorizer): Promise<APIGatewayProxyStructuredResultV2> {
src/runtime/aws/handlers\bulk-actions-handler.ts:37:  const routeKey = event.routeKey;
src/runtime/aws/handlers\bulk-actions-handler.ts:41:      switch (routeKey) {
src/runtime/aws/handlers\bulk-actions-handler.ts:42:        case "POST /items/bulk-reassign":
src/runtime/aws/handlers\bulk-actions-handler.ts:44:        case "POST /items/bulk-archive":
src/runtime/aws/handlers\bulk-actions-handler.ts:47:          throw new ValidationError(`Unknown route: ${routeKey}`);
src/runtime/aws/handlers\bff-handler.ts:42:  return { method: event.requestContext.http.method, path: event.rawPath, queryStringParameters: query, headers, body };
src/runtime/aws/handlers\bff-handler.ts:67:  return runWithContext({ correlationId: event.requestContext.requestId }, () => route(event));
src/runtime/aws/handlers\bff-handler.ts:70:async function route(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
src/runtime/aws/handlers\bff-handler.ts:72:  const routeKey = `${event.requestContext.http.method} ${event.routeKey.split(" ")[1] ?? event.rawPath}`;
src/runtime/aws/handlers\bff-handler.ts:74:  if (routeKey === "GET /bff/login") return toApiGatewayResult(await handleLogin(deps, req));
src/runtime/aws/handlers\bff-handler.ts:75:  if (routeKey === "GET /bff/callback") return toApiGatewayResult(await handleCallback(deps, req));
src/runtime/aws/handlers\bff-handler.ts:76:  if (routeKey === "GET /bff/session") return toApiGatewayResult(await handleGetSession(deps, req));
src/runtime/aws/handlers\bff-handler.ts:77:  if (routeKey === "POST /bff/session/logout") return toApiGatewayResult(await handleLogout(deps, req));
src/runtime/aws/handlers\bff-handler.ts:78:  if (routeKey === "POST /bff/session/logout-all") return toApiGatewayResult(await handleLogoutAll(deps, req));
src/runtime/aws/handlers\bff-handler.ts:79:  if (routeKey === "POST /bff/organizations") return toApiGatewayResult(await handleCreateOrganization(deps, req));
src/runtime/aws/handlers\bff-handler.ts:80:  if (routeKey === "POST /bff/invitations/accept") return toApiGatewayResult(await handleAcceptInvitation(deps, req));
src/runtime/aws/handlers\bff-handler.ts:81:  if (routeKey === "GET /bff/organizations") return toApiGatewayResult(await handleListOrganizations(deps, req));
src/runtime/aws/handlers\bff-handler.ts:82:  if (routeKey === "POST /bff/organization/select") return toApiGatewayResult(await handleSelectOrganization(deps, req));
src/runtime/aws/handlers\bff-handler.ts:89:  return toApiGatewayResult({ statusCode: 404, body: { code: "NOT_FOUND", category: "NOT_FOUND", message: "Unknown BFF route.", retryable: false } });
src/runtime/aws/handlers\bedrock-extraction-task-handler.ts:72:      // Rethrown as a real Task failure - the ASL's Catch (ErrorEquals: States.ALL) routes to
src/modules/notification\application\email-delivery.ts:12:export type SendAction =
src/modules/notification\application\email-delivery.ts:24:export function decideSendAction(
src/modules/notification\application\email-delivery.ts:27:): SendAction {
src/modules/notification\application\email-delivery-workflow.ts:3: * notification-router-workflow.ts: loads entities with consistent reads, calls the pure
src/modules/notification\application\email-delivery-workflow.ts:25:import { decideSendAction, nextStatusAfterSendAttempt } from "./email-delivery.js";
src/modules/notification\application\email-delivery-workflow.ts:26:import { applyStaleDeliveryDecision } from "./notification-router-workflow.js";
src/modules/notification\application\email-delivery-workflow.ts:79:  const action = decideSendAction({ status: attempt.status, leaseExpiresAt: attempt.leaseExpiresAt }, now);
src/modules/notification\application\corrective-intent-service.ts:7: * detected, in either the router (before routing) or the delivery worker (immediately
src/modules/notification\application\notification-preferences-service.ts:15: * exists: a GET lazily creates the record with its documented default (emailEnabled: true),
src/modules/notification\application\notification-preferences-service.ts:19: * (that's the router's own fail-closed matrix's job, not this service's).
src/modules/notification\application\notification-preferences-service.ts:67:      // This bridge runs on first GET for a user whose onboarding never wrote the record -
src/modules/notification\application\notification-router-workflow.ts:4: * into a SINGLE TransactWriteItems - the router never issues more than one transactional
src/modules/notification\application\notification-router-workflow.ts:24:import { decideRouting, type RouterDecision } from "./notification-router.js";
src/modules/notification\application\notification-router-workflow.ts:53:  | { kind: "ROUTED"; routedChannels: NotificationChannel[] };
src/modules/notification\application\notification-router-workflow.ts:60: * through the router's decision + a single transactional write. Idempotent by construction:
src/modules/notification\application\notification-router-workflow.ts:63:export async function routeNotificationIntent(deps: NotificationRouterWorkflowDeps, intent: NotificationIntent): Promise<RouterWorkflowOutcome> {
src/modules/notification\application\notification-router-workflow.ts:145:              routedAt: now,
src/modules/notification\application\notification-router-workflow.ts:183: * versão pode acontecer entre o router e o delivery worker também"). Returns the
src/modules/notification\application\notification-router-workflow.ts:184: * corrective kind actually applied, alongside the same RouterWorkflowOutcome the router uses. */
src/modules/notification\application\notification-router-workflow.ts:316:          routedChannels: decision.routedChannels,
src/modules/notification\application\notification-router-workflow.ts:318:          routedAt: now,
src/modules/notification\application\notification-router-workflow.ts:324:          // read undefined, meaning `to` was always undefined for every EVER real routed
src/modules/notification\application\notification-router-workflow.ts:334:  for (const channel of decision.routedChannels) {
src/modules/notification\application\notification-router-workflow.ts:338:    // router's own per-channel loop (`isChannelRoutable`) is the only place a NEW channel must
src/modules/notification\application\notification-router-workflow.ts:401:  return { kind: "ROUTED", routedChannels: decision.routedChannels };
src/modules/document-archive\persistence\s3-external-share-link-file-store.ts:1:/** Real S3 adapter for `ExternalShareLinkFileStore` (D-225 Decision 5) — presigns a GET directly
src/modules/document-archive\application\apply-file-scan-result.ts:4: * `decideNextAction()` VERBATIM (never forked/redesigned — `DocumentFileScanStatus`'s taxonomy
src/modules/document-archive\application\apply-file-scan-result.ts:28:import { decideNextAction } from "../../document/domain/document-state-machine.js";
src/modules/document-archive\application\apply-file-scan-result.ts:71: * concurrently, exactly the corridor `decideNextAction()`'s doc comment describes for M6. */
src/modules/document-archive\application\apply-file-scan-result.ts:98:    const decision = decideNextAction({
src/modules/document-archive\application\apply-file-scan-result.ts:126:              // decideNextAction's own vocabulary (it only ever returns actions, never this
src/modules/expiration\http\item-handlers.ts:3: * http/test-route-handler.ts pipeline (resolve -> service, which internally calls
src/modules/expiration\http\item-handlers.ts:4: * authorize()) and its AppError -> status-code mapping, so every route in the system
src/modules/expiration\http\item-handlers.ts:24: * leituras/escritas ilimitadas. Mesmo limite/janela do test-route-handler.ts
src/modules/expiration\http\item-handlers.ts:278:/** D-194 Fatia 3 — GET /items/search. Route lives ABOVE `/items/{itemId}` on purpose (same
src/modules/expiration\http\item-handlers.ts:279: * literal-vs-parameterized precedent `main.tf`'s `GET /items/dashboard` comment documents). */
src/modules/document-archive\http\document-archive-guest-handlers.ts:3: * SECOND public (no-JWT) route family in this codebase (after `subject/http/guest-handlers.ts`),
src/modules/document-archive\http\document-archive-guest-handlers.ts:112:/** GET /document-archive/guest/document-requests/{token} — resolves the credential (layer 1)
src/modules/document-archive\http\document-archive-guest-handlers.ts:132:/** POST /document-archive/guest/document-requests/{token}/session — the explicit human
src/modules/document-archive\http\document-archive-guest-handlers.ts:151:/** POST /document-archive/guest/document-requests/{token}/uploads — layer 3, idempotent
src/modules/document-archive\http\document-archive-guest-handlers.ts:154:/** GET /document-archive/guest/document-requests/{token}/document-types — discovery route,
src/modules/document-archive\http\document-archive-guest-handlers.ts:173:    requireToken(req); // Presence-checked for route symmetry/observability; resolution is by session cookie, not the path token.
src/modules/notification\application\notification-router.ts:11: *   -> quiet hours -> transactional route
src/modules/notification\application\notification-router.ts:95:      routedChannels: NotificationChannel[];
src/modules/notification\application\notification-router.ts:103: * flag (`entitlement.whatsappEnabled`) - a tenant whose plan denies WhatsApp never routes to
src/modules/notification\application\notification-router.ts:107: * the router only decides CHANNEL availability, not per-recipient consent. */
src/modules/notification\application\notification-router.ts:172:  const routedChannels: NotificationChannel[] = [];
src/modules/notification\application\notification-router.ts:175:      routedChannels.push(channel);
src/modules/notification\application\notification-router.ts:180:  if (routedChannels.length === 0) {
src/modules/notification\application\notification-router.ts:190:  return { kind: "ROUTED", routedChannels, cancelledChannels, deliverNotBefore };
src/modules/organization\application\accept-invitation.ts:7: * Autorização por IDENTIDADE, não por tenant (mesmo padrão de `POST /bff/organizations`, D-096)
src/modules/notification\application\quiet-hours.ts:10: * the deliverNotBefore instant; scheduling it is the caller's (router's) job.
src/modules/subject\application\requirement-service.ts:22:import { buildSubjectAuditEvent, appendSubjectAuditToTransaction, type SubjectAuditAction } from "../domain/audit-event.js";
src/modules/subject\application\requirement-service.ts:287:      action: SubjectAuditAction;
src/runtime/aws/handlers\document-archive-guest-handler.ts:4: * Gateway route, no Cognito JWT authorizer), same isolation posture as `guest-documents-handler.ts`
src/runtime/aws/handlers\document-archive-guest-handler.ts:6: * `extractClaims` — there is no JWT on this route.
src/runtime/aws/handlers\document-archive-guest-handler.ts:42:  // correlationId never derives from guest-supplied data (public route) — always generated here.
src/runtime/aws/handlers\document-archive-guest-handler.ts:47:  const routeKey = event.routeKey;
src/runtime/aws/handlers\document-archive-guest-handler.ts:56:      switch (routeKey) {
src/runtime/aws/handlers\document-archive-guest-handler.ts:57:        case "GET /document-archive/guest/document-requests/{token}":
src/runtime/aws/handlers\document-archive-guest-handler.ts:59:        case "POST /document-archive/guest/document-requests/{token}/session":
src/runtime/aws/handlers\document-archive-guest-handler.ts:61:        case "POST /document-archive/guest/document-requests/{token}/uploads":
src/runtime/aws/handlers\document-archive-guest-handler.ts:63:        case "GET /document-archive/guest/document-requests/{token}/document-types":
src/runtime/aws/handlers\document-archive-guest-handler.ts:66:          throw new ValidationError(`Unknown route: ${routeKey}`);
src/modules/document-archive\http\document-archive-handlers.ts:6: * route in the system.
src/modules/document-archive\http\document-archive-handlers.ts:88:  /** D-205 fatia 3 (decision 9): only the dossier download route needs this - optional so every
src/modules/document-archive\http\document-archive-handlers.ts:89:   * OTHER caller of this Lambda/module (all the routes above) keeps working unchanged. */
src/modules/document-archive\http\document-archive-handlers.ts:124: * every other business route (item-handlers.ts's consumeApiRequestQuota), applied here too
src/modules/document-archive\http\document-archive-handlers.ts:339: * routeKey comment) but the `PROXY_ALLOWLIST` array in `proxy-allowlist.ts` matches by
src/modules/document-archive\http\document-archive-handlers.ts:353:/** D-194 Fatia 3 — GET /document-archive/requirements/search. Route lives ABOVE
src/modules/document-archive\http\document-archive-handlers.ts:356: * the same position (same precedent `main.tf`'s `GET /items/dashboard` comment documents). */
src/modules/document-archive\http\document-archive-handlers.ts:583:// estado-final-consolidado.md. Same pipeline as the catalog routes above. ------------------
src/modules/document-archive\http\document-archive-handlers.ts:633:// Same pipeline as the DocumentType routes above (resolve context -> schema validation ->
src/modules/document-archive\http\document-archive-handlers.ts:764:// Preview/confirm two-step (decision 4, Journey J22): POST .../dossier creates a
src/modules/document-archive\http\document-archive-handlers.ts:765:// PREVIEW_READY run + returns the preview rows in the SAME response (no separate GET needed for
src/modules/document-archive\http\document-archive-handlers.ts:766:// this fatia); POST .../dossier/{runId}/confirm is idempotent given a matching scopeHash.
src/modules/document-archive\http\document-archive-handlers.ts:799:/** GET /document-archive/subjects/{subjectId}/dossier/{runId}/download?format=pdf|xlsx (D-205
src/modules/document-archive\http\document-archive-handlers.ts:803: * to any URL this route might otherwise persist). RBAC (decision 10): `ADMIN_ROLES` exclusively
src/modules/organization\domain\membership.ts:17: * Organizations de um usuário (`GET /me`, seletor) — resolução de `RequestContext`/decisão de
src/modules/document-archive\application\document-archive-service.ts:697:   * event handler routes on this prefix to pick the right parser (D-163 §7, deferred). Never
src/modules/document-archive\application\document-archive-service.ts:707:   * D-163 §4 gate, activated now that `reserveFiles()` has a real HTTP route (D-167): a Version
src/modules/document-archive\application\document-archive-service.ts:1256:   * D-205 fatia 1 (Roadmap P1 item 16, dossier export) — `POST .../subjects/{subjectId}/dossier`.
src/modules/document-archive\application\document-archive-service.ts:1301:   * D-205 fatia 1 — `POST .../dossier/{runId}/confirm`. Idempotent (decision 3): a matching
src/modules/document-archive\application\document-archive-service.ts:1379:   * D-205 fatia 3 — `GET .../dossier/{runId}/download` reads the run through this (ADMIN_ROLES,
src/modules/document-archive\application\document-archive-service.ts:1380:   * decision 10 - no assignee/recipient fallback tier, unlike D-204's report download route:
src/modules/document-archive\application\document-archive-service.ts:1382:   * assignee tier entirely). The route itself checks `status === "READY"` after this returns -
src/modules/document-archive\application\document-archive-service.ts:1910:  // Fatia 1: domain + catalog CRUD only (Decisions 1/3/4/6 partial) — no HTTP routes yet, no
src/modules/document-archive\application\document-archive-service.ts:1980:  /** Decision 7 — one PATCH covers the field itself (name/required/status) AND its options
src/modules/document-archive\domain\document-type.ts:142:/** D-218 Decision 7 — one PATCH endpoint covers both the field itself (name/required/status)
src/modules/subject\application\subject-service.ts:27:import { buildSubjectAuditEvent, appendSubjectAuditToTransaction, type SubjectAuditAction } from "../domain/audit-event.js";
src/modules/subject\application\subject-service.ts:334:    action: SubjectAuditAction,
src/modules/subject\application\subject-service.ts:387:      action: SubjectAuditAction;
src/runtime/aws/handlers\document-archive-handler.ts:1:/** Real handler for /document-archive/* routes (D-143 Nucleus 1), same shape as
src/runtime/aws/handlers\document-archive-handler.ts:2: * items-handler.ts. Wired to real infra (Lambda resource + API Gateway route + IAM policy)
src/runtime/aws/handlers\document-archive-handler.ts:68:// D-205 fatia 3 (decision 9): only the dossier download route needs this - required so a real
src/runtime/aws/handlers\document-archive-handler.ts:69:// invocation of that route never silently falls back to the "not wired" throw in
src/runtime/aws/handlers\document-archive-handler.ts:84:  const routeKey = event.routeKey; // e.g. "POST /document-archive/documents"
src/runtime/aws/handlers\document-archive-handler.ts:88:      switch (routeKey) {
src/runtime/aws/handlers\document-archive-handler.ts:89:        case "POST /document-archive/documents":
src/runtime/aws/handlers\document-archive-handler.ts:91:        case "GET /document-archive/documents/{documentId}":
src/runtime/aws/handlers\document-archive-handler.ts:93:        case "GET /document-archive/documents/{documentId}/versions":
src/runtime/aws/handlers\document-archive-handler.ts:95:        case "POST /document-archive/documents/{documentId}/versions":
src/runtime/aws/handlers\document-archive-handler.ts:97:        case "POST /document-archive/documents/{documentId}/versions/{seq}/files":
src/runtime/aws/handlers\document-archive-handler.ts:99:        case "POST /document-archive/documents/{documentId}/versions/{seq}/commit":
src/runtime/aws/handlers\document-archive-handler.ts:101:        case "POST /document-archive/documents/{documentId}/versions/{seq}/claim":
src/runtime/aws/handlers\document-archive-handler.ts:103:        case "POST /document-archive/documents/{documentId}/versions/{seq}/accept":
src/runtime/aws/handlers\document-archive-handler.ts:105:        case "POST /document-archive/documents/{documentId}/versions/{seq}/reject":
src/runtime/aws/handlers\document-archive-handler.ts:107:        // D-143 Nucleus 2, Requirement (Decision 5 / D-145) — subject-scoped routes.
src/runtime/aws/handlers\document-archive-handler.ts:108:        case "POST /document-archive/requirements":
src/runtime/aws/handlers\document-archive-handler.ts:110:        // D-194 Fatia 3 (search/filters) - literal segment, routed before
src/runtime/aws/handlers\document-archive-handler.ts:111:        // "GET /document-archive/requirements/{subjectId}" below.
src/runtime/aws/handlers\document-archive-handler.ts:112:        case "GET /document-archive/requirements/search":
src/runtime/aws/handlers\document-archive-handler.ts:114:        case "GET /document-archive/requirements/{subjectId}":
src/runtime/aws/handlers\document-archive-handler.ts:116:        // Roadmap P0.6, fatia 2 — literal segment, routed before "{requirementId}" below (same
src/runtime/aws/handlers\document-archive-handler.ts:118:        case "GET /document-archive/requirements/{subjectId}/compliance":
src/runtime/aws/handlers\document-archive-handler.ts:120:        case "GET /document-archive/requirements/{subjectId}/{requirementId}":
src/runtime/aws/handlers\document-archive-handler.ts:122:        case "PATCH /document-archive/requirements/{subjectId}/{requirementId}":
src/runtime/aws/handlers\document-archive-handler.ts:124:        case "POST /document-archive/requirements/{subjectId}/{requirementId}/link-evidence":
src/runtime/aws/handlers\document-archive-handler.ts:126:        case "POST /document-archive/requirements/{subjectId}/{requirementId}/unlink-evidence":
src/runtime/aws/handlers\document-archive-handler.ts:128:        case "POST /document-archive/requirements/{subjectId}/{requirementId}/delete":
src/runtime/aws/handlers\document-archive-handler.ts:131:        // routes. Tenant-facing only — the guest-facing surface stays on
src/runtime/aws/handlers\document-archive-handler.ts:133:        case "POST /document-archive/series":
src/runtime/aws/handlers\document-archive-handler.ts:135:        case "GET /document-archive/series/{subjectId}":
src/runtime/aws/handlers\document-archive-handler.ts:137:        case "GET /document-archive/series/{subjectId}/{seriesId}":
src/runtime/aws/handlers\document-archive-handler.ts:139:        case "POST /document-archive/series/{subjectId}/{seriesId}/cancel":
src/runtime/aws/handlers\document-archive-handler.ts:141:        case "POST /document-archive/series/{subjectId}/{seriesId}/materialize":
src/runtime/aws/handlers\document-archive-handler.ts:144:        case "POST /document-archive/series/{subjectId}/{seriesId}/recipient":
src/runtime/aws/handlers\document-archive-handler.ts:146:        // D-173 (DocumentType catalog), item 5 — tenant-facing catalog CRUD routes.
src/runtime/aws/handlers\document-archive-handler.ts:147:        case "POST /document-archive/document-types":
src/runtime/aws/handlers\document-archive-handler.ts:149:        case "GET /document-archive/document-types":
src/runtime/aws/handlers\document-archive-handler.ts:151:        case "GET /document-archive/document-types/{documentTypeId}":
src/runtime/aws/handlers\document-archive-handler.ts:153:        case "PATCH /document-archive/document-types/{documentTypeId}":
src/runtime/aws/handlers\document-archive-handler.ts:155:        case "POST /document-archive/document-types/{documentTypeId}/deprecate":
src/runtime/aws/handlers\document-archive-handler.ts:157:        case "POST /document-archive/document-types/{documentTypeId}/reactivate":
src/runtime/aws/handlers\document-archive-handler.ts:160:        case "POST /document-archive/document-types/{documentTypeId}/metadata-fields":
src/runtime/aws/handlers\document-archive-handler.ts:162:        case "PATCH /document-archive/document-types/{documentTypeId}/metadata-fields/{fieldId}":
src/runtime/aws/handlers\document-archive-handler.ts:164:        case "PATCH /document-archive/documents/{documentId}/metadata-values":
src/runtime/aws/handlers\document-archive-handler.ts:167:        case "POST /document-archive/requirement-templates":
src/runtime/aws/handlers\document-archive-handler.ts:169:        case "GET /document-archive/requirement-templates":
src/runtime/aws/handlers\document-archive-handler.ts:171:        case "GET /document-archive/requirement-templates/{templateId}":
src/runtime/aws/handlers\document-archive-handler.ts:173:        case "PATCH /document-archive/requirement-templates/{templateId}":
src/runtime/aws/handlers\document-archive-handler.ts:175:        case "POST /document-archive/requirement-templates/{templateId}/duplicate":
src/runtime/aws/handlers\document-archive-handler.ts:177:        case "POST /document-archive/requirement-templates/{templateId}/archive":
src/runtime/aws/handlers\document-archive-handler.ts:179:        case "POST /document-archive/requirement-templates/{templateId}/unarchive":
src/runtime/aws/handlers\document-archive-handler.ts:181:        case "POST /document-archive/requirement-templates/{templateId}/preview":
src/runtime/aws/handlers\document-archive-handler.ts:183:        case "POST /document-archive/requirement-templates/{templateId}/apply":
src/runtime/aws/handlers\document-archive-handler.ts:186:        case "POST /document-archive/subjects/{subjectId}/dossier":
src/runtime/aws/handlers\document-archive-handler.ts:188:        case "POST /document-archive/subjects/{subjectId}/dossier/{runId}/confirm":
src/runtime/aws/handlers\document-archive-handler.ts:191:        case "GET /document-archive/subjects/{subjectId}/dossier/{runId}/download":
src/runtime/aws/handlers\document-archive-handler.ts:194:          throw new ValidationError(`Unknown route: ${routeKey}`);
src/modules/notification\application\ses-callback-workflow.ts:176: * nothing to suppress against (the router's own opt-in-default onboarding invariant means
src/modules/notification\application\whatsapp-activation.ts:14: * router visibility - `notification-router.ts`'s `isChannelRoutable()` reads this via
src/modules/document-archive\application\document-request-recurrence-service.ts:227:   * which has no HTTP route of its own — no collision). Rejects a `CANCELLED` series with
src/modules/notification\application\whatsapp-delivery-workflow.ts:8: * Wired to the router as of D-197 fatia 5/5 - `notification-router-workflow.ts`'s
src/modules/notification\application\whatsapp-delivery-workflow.ts:10: * WHATSAPP-requesting intent routes (kill switch + entitlement both pass), which the outbox
src/modules/notification\application\whatsapp-delivery-workflow.ts:13: * independently of the router's `WHATSAPP` flag - both must be on for a message to actually
src/modules/notification\application\whatsapp-delivery-workflow.ts:29:import { decideSendAction, nextWhatsAppStatusAfterSendAttempt } from "./whatsapp-delivery.js";
src/modules/notification\application\whatsapp-delivery-workflow.ts:30:import { applyStaleDeliveryDecision } from "./notification-router-workflow.js";
src/modules/notification\application\whatsapp-delivery-workflow.ts:96:  const action = decideSendAction({ status: attempt.status, leaseExpiresAt: attempt.leaseExpiresAt }, now);
src/modules/organization\application\create-organization.ts:27: * `POST /bff/organizations` poder compor um 5º entry (o cap transacional de
src/modules/document-archive\domain\document.ts:82:/** D-218 Decision 2/5 — input for one field of `PATCH .../metadata-values`. `null` clears the
src/modules/notification\application\whatsapp-delivery.ts:2: * WhatsAppDeliveryWorker core decision logic (fatia 2/5, pure - no AWS SDK). `decideSendAction`
src/modules/notification\application\whatsapp-delivery.ts:12:import { decideSendAction, nextStatusAfterSendAttempt, type SendAction } from "./email-delivery.js";
src/modules/notification\application\whatsapp-delivery.ts:14:export type { SendAction };
src/modules/notification\application\whatsapp-delivery.ts:15:export { decideSendAction };
src/modules/notification\application\whatsapp-opt-in-service.ts:4: * route yet (`estado-final-consolidado.md` "próxima ação real": fatia 1 is domain+entities
src/modules/notification\application\whatsapp-opt-in-service.ts:7: * level. A future fatia adds the route that calls `recordOptIn()`; this class does not change
src/modules/notification\application\whatsapp-outbox.ts:3: * fatia 2/5). Analogous to `notification-router-workflow.ts`'s own (private)
src/modules/notification\application\whatsapp-outbox.ts:5: * of the router wiring (fatia 2/5 did not call it yet); as of D-197 fatia 5/5,
src/modules/notification\application\whatsapp-outbox.ts:6: * `notification-router-workflow.ts`'s `applyRoutedDecision` imports and calls this directly for
src/modules/notification\application\whatsapp-outbox.ts:7: * every routed WHATSAPP channel - kept as its own file (not inlined) since it's still reused
src/modules/notification\application\whatsapp-outbox.ts:10: * `destination: "SQS_NOTIFICATION_WHATSAPP_V1"` routes through the SAME generic
src/modules/document-archive\application\external-share-link-service.ts:9: *  - `resolveForAnonymousAccess` — the visitor's route. NEVER touches `RequestContext`/
src/modules/document-archive\application\external-share-link-service.ts:326:    // Decision 3: the route is `GET /external-share/{shareId}/{token}` — `shareId` is
src/modules/document-archive\application\external-share-link-service.ts:329:    // segment (`selector.secret`), never the route's `shareId`.
src/modules/document-archive\domain\external-share-link.ts:50:   * field) — frozen for the same reason `documentFileSeq` is: the visitor route must never read
src/modules/document-archive\domain\external-share-link.ts:93: * share triple. The `{shareId}` embedded in the public route is for LOGGING ONLY; a mismatch
src/modules/document-archive\domain\external-share-link.ts:94: * between the route's shareId and the pointer's own `shareId` collapses into the same generic
src/runtime/aws/handlers\documents-handler.ts:1:/** Real handler for /items/{itemId}/documents* routes (M6). */
src/runtime/aws/handlers\documents-handler.ts:21:// M7 item 8 (§1.7): the two confirm/reject field routes live under the same /items/{itemId}/
src/runtime/aws/handlers\documents-handler.ts:22:// documents* API Gateway route group and Lambda (documents_handler already has full
src/runtime/aws/handlers\documents-handler.ts:24:// Lambda for two routes this narrow.
src/runtime/aws/handlers\documents-handler.ts:34:  const routeKey = event.routeKey;
src/runtime/aws/handlers\documents-handler.ts:38:      switch (routeKey) {
src/runtime/aws/handlers\documents-handler.ts:39:        case "POST /items/{itemId}/documents":
src/runtime/aws/handlers\documents-handler.ts:41:        case "GET /items/{itemId}/documents":
src/runtime/aws/handlers\documents-handler.ts:43:        case "GET /items/{itemId}/documents/{documentId}":
src/runtime/aws/handlers\documents-handler.ts:45:        case "DELETE /items/{itemId}/documents/{documentId}":
src/runtime/aws/handlers\documents-handler.ts:47:        case "POST /items/{itemId}/documents/{documentId}/extractions/{runId}/fields/{fieldName}/confirm":
src/runtime/aws/handlers\documents-handler.ts:49:        case "POST /items/{itemId}/documents/{documentId}/extractions/{runId}/fields/{fieldName}/reject":
src/runtime/aws/handlers\documents-handler.ts:52:          throw new ValidationError(`Unknown route: ${routeKey}`);
src/modules/document-archive\application\guest-document-access-service.ts:223:   * Discovery route (item 6 of D-173's estado-final-consolidado.md, engineering-only slice —
src/modules/document-archive\application\guest-document-access-service.ts:231:   * concern and this route can be polled/refreshed by a guest UI without mutating Request state).
src/modules/notification\application\whatsapp-webhook-processor.ts:41: * Meta's initial webhook-registration handshake (GET request, documented at the same URL above,
src/modules/notification\application\whatsapp-webhook-processor.ts:42: * "Verification Requests" - verified 2026-09-07): Meta calls `GET <callback_url>?hub.mode=
src/modules/notification\application\whatsapp-webhook-processor.ts:115: * single POST can carry multiple entries/statuses in one batch. Skips (never throws on) any
src/runtime/aws/handlers\email-delivery-handler.ts:83:              // Quiet hours not over yet - never discard. The router already scheduled a
src/runtime/aws/handlers\export-handler.ts:2: * D-123/D-126 (CSV data export). Dedicated Lambda, not a route added to items-handler.
src/runtime/aws/handlers\export-handler.ts:4: * infra/modules/lambda-function/variables.tf), and every other route it serves is a fast
src/runtime/aws/handlers\export-handler.ts:9: * changing the budget/behavior of any existing /items* route.
src/runtime/aws/handlers\export-handler.ts:40:  const routeKey = event.routeKey;
src/runtime/aws/handlers\export-handler.ts:42:  if (routeKey !== "GET /items/export") {
src/runtime/aws/handlers\export-handler.ts:43:    return toApiGatewayResult({ statusCode: 400, body: new ValidationError(`Unknown route: ${routeKey}`).toJSON() });
src/modules/organization\application\resolve-active-membership.ts:36:   * value for `PATCH /organizations/settings`; every other tenant-scoped write in this app
src/modules/organization\application\resolve-active-membership.ts:44: * (physical model §11 exige a checagem dupla). Sem este filtro, `GET /bff/organizations`
src/runtime/aws/handlers\extraction-starter-handler.ts:2: * clean bucket routed through EventBridge - same shape as UploadFinalizerWorker's quarantine
src/modules/organization\application\resolve-working-organization.ts:6: * `POST /bff/organization/select`, per the Codex Rodada 1 answer to "shared helper or
src/modules/organization\application\update-organization-settings.ts:9: * not routed through `TenantBusinessMutation` — Organization/Membership writers are not yet
src/runtime/aws/handlers\guest-documents-handler.ts:41:  const routeKey = event.routeKey;
src/runtime/aws/handlers\guest-documents-handler.ts:46:      switch (routeKey) {
src/runtime/aws/handlers\guest-documents-handler.ts:47:        case "GET /guest/document-requests/{token}":
src/runtime/aws/handlers\guest-documents-handler.ts:49:        case "POST /guest/document-requests/{token}/uploads":
src/runtime/aws/handlers\guest-documents-handler.ts:52:          throw new ValidationError(`Unknown route: ${routeKey}`);
src/runtime/aws/handlers\import-parse-handler.ts:2: * bucket routed through EventBridge, M11 design). Same shape as upload-finalizer-handler.ts. */
src/runtime/aws/handlers\imports-handler.ts:1:/** Real handler for /imports* routes (M11, D-042). */
src/runtime/aws/handlers\imports-handler.ts:34:  const routeKey = event.routeKey;
src/runtime/aws/handlers\imports-handler.ts:38:      switch (routeKey) {
src/runtime/aws/handlers\imports-handler.ts:39:        case "POST /imports":
src/runtime/aws/handlers\imports-handler.ts:41:        case "GET /imports/{jobId}":
src/runtime/aws/handlers\imports-handler.ts:43:        case "POST /imports/{jobId}/commit":
src/runtime/aws/handlers\imports-handler.ts:45:        case "GET /import-jobs/{jobId}/schema":
src/runtime/aws/handlers\imports-handler.ts:47:        case "POST /import-jobs/{jobId}/mapping":
src/runtime/aws/handlers\imports-handler.ts:50:          throw new ValidationError(`Unknown route: ${routeKey}`);
src/runtime/aws/handlers\items-handler.ts:1:/** Real handler for /items* routes (M2), replacing the 501 placeholder. */
src/runtime/aws/handlers\items-handler.ts:51:  const routeKey = event.routeKey; // e.g. "POST /items", "GET /items/{itemId}"
src/runtime/aws/handlers\items-handler.ts:55:      switch (routeKey) {
src/runtime/aws/handlers\items-handler.ts:56:        case "POST /items":
src/runtime/aws/handlers\items-handler.ts:58:        case "GET /items/dashboard":
src/runtime/aws/handlers\items-handler.ts:60:        // D-194 Fatia 3 (search/filters) - literal segment, must be routed BEFORE
src/runtime/aws/handlers\items-handler.ts:61:        // "GET /items/{itemId}" below (API Gateway v2 prioritizes the literal at the same
src/runtime/aws/handlers\items-handler.ts:62:        // position, same precedent as "GET /items/dashboard" already living alongside it).
src/runtime/aws/handlers\items-handler.ts:63:        case "GET /items/search":
src/runtime/aws/handlers\items-handler.ts:65:        case "GET /items/{itemId}":
src/runtime/aws/handlers\items-handler.ts:69:        case "DELETE /items/{itemId}":
src/runtime/aws/handlers\items-handler.ts:71:        case "POST /items/{itemId}/archive":
src/runtime/aws/handlers\items-handler.ts:73:        case "POST /items/{itemId}/renew":
src/runtime/aws/handlers\items-handler.ts:75:        case "POST /items/{itemId}/watchers/{userId}":
src/runtime/aws/handlers\items-handler.ts:77:        case "DELETE /items/{itemId}/watchers/{userId}":
src/runtime/aws/handlers\items-handler.ts:79:        case "GET /items/{itemId}/watchers":
src/runtime/aws/handlers\items-handler.ts:81:        case "GET /activity":
src/runtime/aws/handlers\items-handler.ts:84:        // Lambda/integration as GET /activity above (no new function), own invoke permission in
src/runtime/aws/handlers\items-handler.ts:86:        case "GET /dashboard/summary":
src/runtime/aws/handlers\items-handler.ts:89:          throw new ValidationError(`Unknown route: ${routeKey}`);
src/runtime/aws/handlers\malware-result-handler.ts:2: * finding events routed through EventBridge). M6 design §3.4/§4. */
src/runtime/aws/handlers\memberships-handler.ts:40:// W3-07 (D-124): required for POST /organizations/close. Absent means the closure route returns a
src/runtime/aws/handlers\memberships-handler.ts:66:  const routeKey = event.routeKey;
src/runtime/aws/handlers\memberships-handler.ts:70:      switch (routeKey) {
src/runtime/aws/handlers\memberships-handler.ts:71:        case "POST /organizations/members/invite":
src/runtime/aws/handlers\memberships-handler.ts:73:        case "POST /organizations/invitations/{invitationId}/revoke":
src/runtime/aws/handlers\memberships-handler.ts:75:        case "GET /organizations/members":
src/runtime/aws/handlers\memberships-handler.ts:77:        case "GET /organizations/invitations":
src/runtime/aws/handlers\memberships-handler.ts:81:        case "DELETE /organizations/members/{userId}":
src/runtime/aws/handlers\memberships-handler.ts:83:        case "POST /organizations/members/leave":
src/runtime/aws/handlers\memberships-handler.ts:85:        case "PATCH /organizations/settings":
src/runtime/aws/handlers\memberships-handler.ts:87:        case "POST /organizations/close":
src/runtime/aws/handlers\memberships-handler.ts:90:        case "POST /organizations/cancel-close":
src/runtime/aws/handlers\memberships-handler.ts:94:          throw new ValidationError(`Unknown route: ${routeKey}`);
src/runtime/aws/handlers\notification-email-outbox-relay-handler.ts:3: * src/workers/dispatch-outbox-relay/relay.ts's header (M4 generalized it to route by
src/runtime/aws/handlers\notification-router-handler.ts:10:import { routeNotificationIntent, type NotificationRouterWorkflowDeps } from "../../../modules/notification/application/notification-router-workflow.js";
src/runtime/aws/handlers\notification-router-handler.ts:33:const logger = new SecureLogger({ baseContext: { service: "notification-router" } });
src/runtime/aws/handlers\notification-router-handler.ts:49:      const outcome = await routeNotificationIntent(deps, item as unknown as NotificationIntent);
src/runtime/aws/handlers\notification-router-handler.ts:50:      logger.info("notification-router outcome", { intentId: item["intentId"], outcome: outcome.kind });
src/runtime/aws/handlers\notification-router-handler.ts:55:      logger.error("notification-router failed", { eventID: record.eventID, error: err instanceof Error ? err.message : String(err) });
src/runtime/aws/handlers\notification-router-handler.ts:67:  // the whole batch - EMAIL-only intents route exactly as before; only WHATSAPP-requesting
src/runtime/aws/handlers\notification-router-handler.ts:68:  // intents fall back to CHANNEL_UNAVAILABLE per `notification-router.ts`'s own per-channel gate.
src/runtime/aws/handlers\notification-router-handler.ts:74:      logger.error("notification-router feature-flags read failed - fail-closed (treating WHATSAPP as disabled)", { error: err instanceof Error ? err.message : String(err) });
src/runtime/aws/handlers\notification-router-handler.ts:90:      logger.error("notification-router failed to parse Streams image", { eventID: record.eventID, error: err instanceof Error ? err.message : String(err) });
src/runtime/aws/handlers\notifications-handler.ts:1:/** Real handler for /notifications/preferences routes (M4 backlog item closed: previously
src/runtime/aws/handlers\notifications-handler.ts:31:  const routeKey = event.routeKey;
src/runtime/aws/handlers\notifications-handler.ts:35:      switch (routeKey) {
src/runtime/aws/handlers\notifications-handler.ts:36:        case "GET /notifications/preferences":
src/runtime/aws/handlers\notifications-handler.ts:41:          throw new ValidationError(`Unknown route: ${routeKey}`);
src/runtime/aws/handlers\outbox-sweeper-handler.ts:21:// sweeper role - same "router keyed by destination" pattern §7.4 already established for
src/runtime/aws/handlers\outbox-sweeper-handler.ts:39:// notification flow (router wiring is fatia 5/5) - wired here now so the sweeper's own
src/runtime/aws/handlers\pdf-parser-task-handler.ts:57:      // Rethrown as a real Task failure - the ASL's Catch (ErrorEquals: States.ALL) routes
src/runtime/aws/handlers\reminders-handler.ts:1:/** Real handler for /reminders/policies* routes (M3), replacing the 501 placeholder. */
src/runtime/aws/handlers\reminders-handler.ts:35:  const routeKey = event.routeKey;
src/runtime/aws/handlers\reminders-handler.ts:39:      switch (routeKey) {
src/runtime/aws/handlers\reminders-handler.ts:40:        case "POST /reminders/policies":
src/runtime/aws/handlers\reminders-handler.ts:42:        case "GET /reminders/policies/{policyId}":
src/runtime/aws/handlers\reminders-handler.ts:46:        case "POST /reminders/policies/{policyId}/disable":
src/runtime/aws/handlers\reminders-handler.ts:49:          throw new ValidationError(`Unknown route: ${routeKey}`);
src/runtime/aws/handlers\reports-handler.ts:3: * all 7 `GET /reports/*` routes — same reasoning as `export-handler.ts` (D-123/D-126): a raw
src/runtime/aws/handlers\reports-handler.ts:31:// D-204 fatia 3 (decision 7): only the download route needs this - required so a real
src/runtime/aws/handlers\reports-handler.ts:32:// invocation of that route never silently falls back to the "not wired" throw in
src/runtime/aws/handlers\reports-handler.ts:53:  // D-204 decision 1 (implemented D-213): JSON-envelope CRUD routes, dispatched separately from
src/runtime/aws/handlers\reports-handler.ts:54:  // the CSV report routes below - never through `handleReportsRoute`'s CSV-only ROUTES map.
src/runtime/aws/handlers\reports-handler.ts:55:  switch (event.routeKey) {
src/runtime/aws/handlers\reports-handler.ts:56:    case "POST /reports/subscriptions":
src/runtime/aws/handlers\reports-handler.ts:58:    case "GET /reports/subscriptions":
src/runtime/aws/handlers\reports-handler.ts:60:    case "GET /reports/subscriptions/{subscriptionId}":
src/runtime/aws/handlers\reports-handler.ts:62:    case "POST /reports/subscriptions/{subscriptionId}/delete":
src/runtime/aws/handlers\reports-handler.ts:64:    case "GET /reports/subscriptions/{subscriptionId}/runs/{runId}/download":
src/runtime/aws/handlers\reports-handler.ts:67:      const response = await handleReportsRoute(deps, event.routeKey, base);
src/runtime/aws/handlers\subjects-handler.ts:78:  const routeKey = event.routeKey;
src/runtime/aws/handlers\subjects-handler.ts:82:      switch (routeKey) {
src/runtime/aws/handlers\subjects-handler.ts:83:        case "POST /subjects":
src/runtime/aws/handlers\subjects-handler.ts:85:        case "GET /subjects/dashboard":
src/runtime/aws/handlers\subjects-handler.ts:87:        // D-194 Fatia 3 (search/filters) - literal segment, routed before "GET /subjects/{subjectId}".
src/runtime/aws/handlers\subjects-handler.ts:88:        case "GET /subjects/search":
src/runtime/aws/handlers\subjects-handler.ts:90:        case "GET /subjects/{subjectId}":
src/runtime/aws/handlers\subjects-handler.ts:94:        case "DELETE /subjects/{subjectId}":
src/runtime/aws/handlers\subjects-handler.ts:96:        case "POST /subjects/{subjectId}/archive":
src/runtime/aws/handlers\subjects-handler.ts:98:        case "POST /subjects/{subjectId}/requirements":
src/runtime/aws/handlers\subjects-handler.ts:100:        case "GET /subjects/{subjectId}/requirements":
src/runtime/aws/handlers\subjects-handler.ts:102:        case "GET /subjects/{subjectId}/requirements/{assignmentId}":
src/runtime/aws/handlers\subjects-handler.ts:106:        case "DELETE /subjects/{subjectId}/requirements/{assignmentId}":
src/runtime/aws/handlers\subjects-handler.ts:108:        case "POST /subjects/{subjectId}/requirements/{assignmentId}/link":
src/runtime/aws/handlers\subjects-handler.ts:110:        case "POST /subjects/{subjectId}/requirements/{assignmentId}/unlink":
src/runtime/aws/handlers\subjects-handler.ts:112:        case "GET /subjects/{subjectId}/requirements/{assignmentId}/submissions":
src/runtime/aws/handlers\subjects-handler.ts:114:        case "GET /subjects/{subjectId}/requirements/{assignmentId}/submissions/{submissionId}":
src/runtime/aws/handlers\subjects-handler.ts:116:        case "POST /subjects/{subjectId}/requirements/{assignmentId}/document-requests":
src/runtime/aws/handlers\subjects-handler.ts:118:        case "GET /subjects/{subjectId}/requirements/{assignmentId}/document-requests":
src/runtime/aws/handlers\subjects-handler.ts:120:        case "GET /subjects/{subjectId}/document-requests/{documentRequestId}":
src/runtime/aws/handlers\subjects-handler.ts:122:        case "POST /subjects/{subjectId}/document-requests/{documentRequestId}/revoke":
src/runtime/aws/handlers\subjects-handler.ts:124:        case "GET /subjects/document-request-delivery-preference":
src/runtime/aws/handlers\subjects-handler.ts:129:          throw new ValidationError(`Unknown route: ${routeKey}`);
src/runtime/aws/handlers\tenant-lifecycle-transition-handler.ts:21:    // to Step Functions as a Task failure so the ASL's own Catch routes the tenant to BLOCKED.
src/runtime/aws/handlers\test-ping-handler.ts:1:/** Real handler for GET /test/ping (M1 exit-criterion route), replacing the 501 placeholder.
src/runtime/aws/handlers\test-ping-handler.ts:10:import { handleTestRoute } from "../../../modules/identity/http/test-route-handler.js";
src/runtime/aws/handlers\textract-task-handler.ts:92:      // fixed for real in W2-02, see pilot-readiness-program.md) routes to
src/runtime/aws/handlers\upload-finalizer-handler.ts:2: * quarantine bucket routed through EventBridge). M6 design §3.2/§4. */
src/runtime/aws/handlers\whatsapp-delivery-handler.ts:9: * `notification-router-workflow.ts` now writes a `SQS_NOTIFICATION_WHATSAPP_V1` outbox record
src/runtime/aws/handlers\whatsapp-delivery-handler.ts:10: * whenever a WHATSAPP-requesting intent routes; the outbox relay delivers it to this queue.
src/runtime/aws/handlers\whatsapp-outbox-relay-handler.ts:10: * `SQS_NOTIFICATION_WHATSAPP_V1` outbox record until `notification-router-workflow.ts` is
src/runtime/aws/handlers\whatsapp-webhook-handler.ts:3: * API Gateway HTTP API route (no JWT authorizer - Meta calls this endpoint directly, there is no
src/runtime/aws/handlers\whatsapp-webhook-handler.ts:85:    logger.warn("whatsapp-webhook GET verification failed", { mode: qs["hub.mode"] });

exec
"C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -Command '$a=Get-Content src/modules/identity/domain/authorization.ts; $start=($a|Select-String '"'const ACTION_ROLES').LineNumber; "'$end=($a|Select-String '"'"'^};$'"'|Where-Object {"'$_.LineNumber -gt $start}|Select-Object -First 1).LineNumber; $a[($start-1)..($end-1)]; rg -n '"'route_key\\s*=|routeKey|\"(GET|POST|PUT|PATCH|DELETE) /' infra src/runtime/aws/handlers | Select-String -Pattern 'GET |POST |PUT |PATCH |DELETE '" in C:\Users\Usuario\Desktop\projects\expiration-tracker
2026-09-09T01:56:39.127030Z ERROR codex_core::tools::router: error=Exit code: 1
Wall time: 0.6 seconds
Output:
const ACTION_ROLES: Record<Action, ReadonlySet<Role>> = {
  "item:create": WRITE_ROLES,
  "item:read": READ_ONLY_ROLES,
  "item:update": WRITE_ROLES,
  "item:delete": ADMIN_ROLES,
  "item:export": ADMIN_ROLES,
  "item:watch": WRITE_ROLES,
  "reminder:manage": WRITE_ROLES,
  "document:reserve-upload": WRITE_ROLES,
  "document:read": READ_ONLY_ROLES,
  "document:delete": ADMIN_ROLES,
  "extraction:confirm": WRITE_ROLES,
  // B2B-7 bug fix (not an ADMIN-vs-OWNER call): this action gates both read and update of a
  // per-user preference (ctx.principal.userId-keyed, notification-preferences-service.ts),
  // never tenant-wide config. This is tied to the ability to RECEIVE a reminder -
  // assigneeUserId is never role-checked, so a VIEWER can legitimately be a notification
  // recipient and must be able to configure it for themself. Reuses READ_ONLY_ROLES (already
  // "any real Membership") rather than adding a 5th constant with the same 4 members.
  "notification:configure": READ_ONLY_ROLES,
  "audit:read": READ_ONLY_ROLES,
  "system:ping": READ_ONLY_ROLES,
  "subject:create": WRITE_ROLES,
  "subject:read": READ_ONLY_ROLES,
  "subject:update": WRITE_ROLES,
  "subject:delete": ADMIN_ROLES,
  "requirement:assign": WRITE_ROLES,
  "requirement:read": READ_ONLY_ROLES,
  "requirement:update": WRITE_ROLES,
  "requirement:delete": ADMIN_ROLES,
  "requirement:review": WRITE_ROLES,
  "requirement:request-document": WRITE_ROLES,
  "tenant:configure-document-request-delivery": OWNER_ROLES,
  "import:create": WRITE_ROLES,
  "import:read": READ_ONLY_ROLES,
  "import:commit": WRITE_ROLES,
  "import:map": WRITE_ROLES,
  "membership:invite": ADMIN_ROLES,
  "membership:revoke-invitation": ADMIN_ROLES,
  "membership:list-invitations": ADMIN_ROLES,
  "membership:list-members": READ_ONLY_ROLES,
  "membership:role-change": ADMIN_ROLES,
  "membership:remove": ADMIN_ROLES,
  "membership:leave": READ_ONLY_ROLES,
  "organization:update-settings": OWNER_ROLES,
  "organization:close": OWNER_ROLES,
  "organization:cancel-close": OWNER_ROLES,
  "docarchive:create": WRITE_ROLES,
  "docarchive:read": READ_ONLY_ROLES,
  "docarchive:upload": WRITE_ROLES,
  "docarchive:review": WRITE_ROLES,
  "docarchive:requirement-create": WRITE_ROLES,
  "docarchive:requirement-read": READ_ONLY_ROLES,
  "docarchive:requirement-update": WRITE_ROLES,
  "docarchive:requirement-delete": WRITE_ROLES,
  "docarchive:series-create": WRITE_ROLES,
  "docarchive:series-read": READ_ONLY_ROLES,
  "docarchive:series-update": WRITE_ROLES,
  "docarchive:series-cancel": WRITE_ROLES,
  "docarchive:series-materialize": WRITE_ROLES,
  "docarchive:request-create": WRITE_ROLES,
  "activity:read": ADMIN_ROLES,
  "reports:subscription-manage": ADMIN_ROLES,
  "docarchive:dossier-export": ADMIN_ROLES,
  "docarchive:documenttype-metadata-manage": ADMIN_ROLES,
  "docarchive:document-metadata-update": WRITE_ROLES,
  "docarchive:documenttype-create": ADMIN_ROLES,
  "docarchive:documenttype-rename": ADMIN_ROLES,
  "docarchive:documenttype-deprecate": ADMIN_ROLES,
  "docarchive:documenttype-reactivate": ADMIN_ROLES,
  "docarchive:documenttype-read": READ_ONLY_ROLES,
  "docarchive:requirementtemplate-create": ADMIN_ROLES,
  "docarchive:requirementtemplate-update": ADMIN_ROLES,
  "docarchive:requirementtemplate-duplicate": ADMIN_ROLES,
  "docarchive:requirementtemplate-archive": ADMIN_ROLES,
  "docarchive:requirementtemplate-unarchive": ADMIN_ROLES,
  "docarchive:requirementtemplate-read": READ_ONLY_ROLES,
  "docarchive:requirementtemplate-apply": WRITE_ROLES,
  "docarchive:requirement-export": ADMIN_ROLES,
};

 exited 1 in 573ms:
const ACTION_ROLES: Record<Action, ReadonlySet<Role>> = {
  "item:create": WRITE_ROLES,
  "item:read": READ_ONLY_ROLES,
  "item:update": WRITE_ROLES,
  "item:delete": ADMIN_ROLES,
  "item:export": ADMIN_ROLES,
  "item:watch": WRITE_ROLES,
  "reminder:manage": WRITE_ROLES,
  "document:reserve-upload": WRITE_ROLES,
  "document:read": READ_ONLY_ROLES,
  "document:delete": ADMIN_ROLES,
  "extraction:confirm": WRITE_ROLES,
  // B2B-7 bug fix (not an ADMIN-vs-OWNER call): this action gates both read and update of a
  // per-user preference (ctx.principal.userId-keyed, notification-preferences-service.ts),
  // never tenant-wide config. This is tied to the ability to RECEIVE a reminder -
  // assigneeUserId is never role-checked, so a VIEWER can legitimately be a notification
  // recipient and must be able to configure it for themself. Reuses READ_ONLY_ROLES (already
  // "any real Membership") rather than adding a 5th constant with the same 4 members.
  "notification:configure": READ_ONLY_ROLES,
  "audit:read": READ_ONLY_ROLES,
  "system:ping": READ_ONLY_ROLES,
  "subject:create": WRITE_ROLES,
  "subject:read": READ_ONLY_ROLES,
  "subject:update": WRITE_ROLES,
  "subject:delete": ADMIN_ROLES,
  "requirement:assign": WRITE_ROLES,
  "requirement:read": READ_ONLY_ROLES,
  "requirement:update": WRITE_ROLES,
  "requirement:delete": ADMIN_ROLES,
  "requirement:review": WRITE_ROLES,
  "requirement:request-document": WRITE_ROLES,
  "tenant:configure-document-request-delivery": OWNER_ROLES,
  "import:create": WRITE_ROLES,
  "import:read": READ_ONLY_ROLES,
  "import:commit": WRITE_ROLES,
  "import:map": WRITE_ROLES,
  "membership:invite": ADMIN_ROLES,
  "membership:revoke-invitation": ADMIN_ROLES,
  "membership:list-invitations": ADMIN_ROLES,
  "membership:list-members": READ_ONLY_ROLES,
  "membership:role-change": ADMIN_ROLES,
  "membership:remove": ADMIN_ROLES,
  "membership:leave": READ_ONLY_ROLES,
  "organization:update-settings": OWNER_ROLES,
  "organization:close": OWNER_ROLES,
  "organization:cancel-close": OWNER_ROLES,
  "docarchive:create": WRITE_ROLES,
  "docarchive:read": READ_ONLY_ROLES,
  "docarchive:upload": WRITE_ROLES,
  "docarchive:review": WRITE_ROLES,
  "docarchive:requirement-create": WRITE_ROLES,
  "docarchive:requirement-read": READ_ONLY_ROLES,
  "docarchive:requirement-update": WRITE_ROLES,
  "docarchive:requirement-delete": WRITE_ROLES,
  "docarchive:series-create": WRITE_ROLES,
  "docarchive:series-read": READ_ONLY_ROLES,
  "docarchive:series-update": WRITE_ROLES,
  "docarchive:series-cancel": WRITE_ROLES,
  "docarchive:series-materialize": WRITE_ROLES,
  "docarchive:request-create": WRITE_ROLES,
  "activity:read": ADMIN_ROLES,
  "reports:subscription-manage": ADMIN_ROLES,
  "docarchive:dossier-export": ADMIN_ROLES,
  "docarchive:documenttype-metadata-manage": ADMIN_ROLES,
  "docarchive:document-metadata-update": WRITE_ROLES,
  "docarchive:documenttype-create": ADMIN_ROLES,
  "docarchive:documenttype-rename": ADMIN_ROLES,
  "docarchive:documenttype-deprecate": ADMIN_ROLES,
  "docarchive:documenttype-reactivate": ADMIN_ROLES,
  "docarchive:documenttype-read": READ_ONLY_ROLES,
  "docarchive:requirementtemplate-create": ADMIN_ROLES,
  "docarchive:requirementtemplate-update": ADMIN_ROLES,
  "docarchive:requirementtemplate-duplicate": ADMIN_ROLES,
  "docarchive:requirementtemplate-archive": ADMIN_ROLES,
  "docarchive:requirementtemplate-unarchive": ADMIN_ROLES,
  "docarchive:requirementtemplate-read": READ_ONLY_ROLES,
  "docarchive:requirementtemplate-apply": WRITE_ROLES,
  "docarchive:requirement-export": ADMIN_ROLES,
};

codex
A matriz confirmou dois domínios documentais paralelos e vivos, além do armazenamento de arquivo de baixo nível; vou mantê-los separados na IA. Também há ações internas/operacionais que não devem virar controles humanos, mas precisam aparecer formalmente como adiamentos deliberados.
exec
"C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -Command "rg -n 'route_key\\s*=\\s*\"|case \"(GET|POST|PUT|PATCH|DELETE) /' infra src/runtime/aws/handlers" in C:\Users\Usuario\Desktop\projects\expiration-tracker
2026-09-09T01:56:48.023043Z ERROR codex_core::tools::router: error=Exit code: 1
Wall time: 0.8 seconds
Output:
src/runtime/aws/handlers\document-archive-guest-handler.ts:57:        case "GET /document-archive/guest/document-requests/{token}":
src/runtime/aws/handlers\document-archive-guest-handler.ts:59:        case "POST /document-archive/guest/document-requests/{token}/session":
src/runtime/aws/handlers\document-archive-guest-handler.ts:61:        case "POST /document-archive/guest/document-requests/{token}/uploads":
src/runtime/aws/handlers\document-archive-guest-handler.ts:63:        case "GET /document-archive/guest/document-requests/{token}/document-types":
src/runtime/aws/handlers\document-archive-handler.ts:89:        case "POST /document-archive/documents":
src/runtime/aws/handlers\document-archive-handler.ts:91:        case "GET /document-archive/documents/{documentId}":
src/runtime/aws/handlers\document-archive-handler.ts:93:        case "GET /document-archive/documents/{documentId}/versions":
src/runtime/aws/handlers\document-archive-handler.ts:95:        case "POST /document-archive/documents/{documentId}/versions":
src/runtime/aws/handlers\document-archive-handler.ts:97:        case "POST /document-archive/documents/{documentId}/versions/{seq}/files":
src/runtime/aws/handlers\document-archive-handler.ts:99:        case "POST /document-archive/documents/{documentId}/versions/{seq}/commit":
src/runtime/aws/handlers\document-archive-handler.ts:101:        case "POST /document-archive/documents/{documentId}/versions/{seq}/claim":
src/runtime/aws/handlers\document-archive-handler.ts:103:        case "POST /document-archive/documents/{documentId}/versions/{seq}/accept":
src/runtime/aws/handlers\document-archive-handler.ts:105:        case "POST /document-archive/documents/{documentId}/versions/{seq}/reject":
src/runtime/aws/handlers\document-archive-handler.ts:108:        case "POST /document-archive/requirements":
src/runtime/aws/handlers\document-archive-handler.ts:112:        case "GET /document-archive/requirements/search":
src/runtime/aws/handlers\document-archive-handler.ts:114:        case "GET /document-archive/requirements/{subjectId}":
src/runtime/aws/handlers\document-archive-handler.ts:118:        case "GET /document-archive/requirements/{subjectId}/compliance":
src/runtime/aws/handlers\document-archive-handler.ts:120:        case "GET /document-archive/requirements/{subjectId}/{requirementId}":
src/runtime/aws/handlers\document-archive-handler.ts:122:        case "PATCH /document-archive/requirements/{subjectId}/{requirementId}":
src/runtime/aws/handlers\document-archive-handler.ts:124:        case "POST /document-archive/requirements/{subjectId}/{requirementId}/link-evidence":
src/runtime/aws/handlers\document-archive-handler.ts:126:        case "POST /document-archive/requirements/{subjectId}/{requirementId}/unlink-evidence":
src/runtime/aws/handlers\document-archive-handler.ts:128:        case "POST /document-archive/requirements/{subjectId}/{requirementId}/delete":
src/runtime/aws/handlers\document-archive-handler.ts:133:        case "POST /document-archive/series":
src/runtime/aws/handlers\document-archive-handler.ts:135:        case "GET /document-archive/series/{subjectId}":
src/runtime/aws/handlers\document-archive-handler.ts:137:        case "GET /document-archive/series/{subjectId}/{seriesId}":
src/runtime/aws/handlers\document-archive-handler.ts:139:        case "POST /document-archive/series/{subjectId}/{seriesId}/cancel":
src/runtime/aws/handlers\document-archive-handler.ts:141:        case "POST /document-archive/series/{subjectId}/{seriesId}/materialize":
src/runtime/aws/handlers\document-archive-handler.ts:144:        case "POST /document-archive/series/{subjectId}/{seriesId}/recipient":
src/runtime/aws/handlers\document-archive-handler.ts:147:        case "POST /document-archive/document-types":
src/runtime/aws/handlers\document-archive-handler.ts:149:        case "GET /document-archive/document-types":
src/runtime/aws/handlers\document-archive-handler.ts:151:        case "GET /document-archive/document-types/{documentTypeId}":
src/runtime/aws/handlers\document-archive-handler.ts:153:        case "PATCH /document-archive/document-types/{documentTypeId}":
src/runtime/aws/handlers\document-archive-handler.ts:155:        case "POST /document-archive/document-types/{documentTypeId}/deprecate":
src/runtime/aws/handlers\document-archive-handler.ts:157:        case "POST /document-archive/document-types/{documentTypeId}/reactivate":
src/runtime/aws/handlers\document-archive-handler.ts:160:        case "POST /document-archive/document-types/{documentTypeId}/metadata-fields":
src/runtime/aws/handlers\document-archive-handler.ts:162:        case "PATCH /document-archive/document-types/{documentTypeId}/metadata-fields/{fieldId}":
src/runtime/aws/handlers\document-archive-handler.ts:164:        case "PATCH /document-archive/documents/{documentId}/metadata-values":
src/runtime/aws/handlers\document-archive-handler.ts:167:        case "POST /document-archive/requirement-templates":
src/runtime/aws/handlers\document-archive-handler.ts:169:        case "GET /document-archive/requirement-templates":
src/runtime/aws/handlers\document-archive-handler.ts:171:        case "GET /document-archive/requirement-templates/{templateId}":
src/runtime/aws/handlers\document-archive-handler.ts:173:        case "PATCH /document-archive/requirement-templates/{templateId}":
src/runtime/aws/handlers\document-archive-handler.ts:175:        case "POST /document-archive/requirement-templates/{templateId}/duplicate":
src/runtime/aws/handlers\document-archive-handler.ts:177:        case "POST /document-archive/requirement-templates/{templateId}/archive":
src/runtime/aws/handlers\document-archive-handler.ts:179:        case "POST /document-archive/requirement-templates/{templateId}/unarchive":
src/runtime/aws/handlers\document-archive-handler.ts:181:        case "POST /document-archive/requirement-templates/{templateId}/preview":
src/runtime/aws/handlers\document-archive-handler.ts:183:        case "POST /document-archive/requirement-templates/{templateId}/apply":
src/runtime/aws/handlers\document-archive-handler.ts:186:        case "POST /document-archive/subjects/{subjectId}/dossier":
src/runtime/aws/handlers\document-archive-handler.ts:188:        case "POST /document-archive/subjects/{subjectId}/dossier/{runId}/confirm":
src/runtime/aws/handlers\document-archive-handler.ts:191:        case "GET /document-archive/subjects/{subjectId}/dossier/{runId}/download":
src/runtime/aws/handlers\bulk-actions-handler.ts:42:        case "POST /items/bulk-reassign":
src/runtime/aws/handlers\bulk-actions-handler.ts:44:        case "POST /items/bulk-archive":
src/runtime/aws/handlers\documents-handler.ts:39:        case "POST /items/{itemId}/documents":
src/runtime/aws/handlers\documents-handler.ts:41:        case "GET /items/{itemId}/documents":
src/runtime/aws/handlers\documents-handler.ts:43:        case "GET /items/{itemId}/documents/{documentId}":
src/runtime/aws/handlers\documents-handler.ts:45:        case "DELETE /items/{itemId}/documents/{documentId}":
src/runtime/aws/handlers\documents-handler.ts:47:        case "POST /items/{itemId}/documents/{documentId}/extractions/{runId}/fields/{fieldName}/confirm":
src/runtime/aws/handlers\documents-handler.ts:49:        case "POST /items/{itemId}/documents/{documentId}/extractions/{runId}/fields/{fieldName}/reject":
src/runtime/aws/handlers\imports-handler.ts:39:        case "POST /imports":
src/runtime/aws/handlers\imports-handler.ts:41:        case "GET /imports/{jobId}":
src/runtime/aws/handlers\imports-handler.ts:43:        case "POST /imports/{jobId}/commit":
src/runtime/aws/handlers\imports-handler.ts:45:        case "GET /import-jobs/{jobId}/schema":
src/runtime/aws/handlers\imports-handler.ts:47:        case "POST /import-jobs/{jobId}/mapping":
src/runtime/aws/handlers\items-handler.ts:56:        case "POST /items":
src/runtime/aws/handlers\items-handler.ts:58:        case "GET /items/dashboard":
src/runtime/aws/handlers\items-handler.ts:63:        case "GET /items/search":
src/runtime/aws/handlers\items-handler.ts:65:        case "GET /items/{itemId}":
src/runtime/aws/handlers\items-handler.ts:67:        case "PUT /items/{itemId}":
src/runtime/aws/handlers\items-handler.ts:69:        case "DELETE /items/{itemId}":
src/runtime/aws/handlers\items-handler.ts:71:        case "POST /items/{itemId}/archive":
src/runtime/aws/handlers\items-handler.ts:73:        case "POST /items/{itemId}/renew":
src/runtime/aws/handlers\items-handler.ts:75:        case "POST /items/{itemId}/watchers/{userId}":
src/runtime/aws/handlers\items-handler.ts:77:        case "DELETE /items/{itemId}/watchers/{userId}":
src/runtime/aws/handlers\items-handler.ts:79:        case "GET /items/{itemId}/watchers":
src/runtime/aws/handlers\items-handler.ts:81:        case "GET /activity":
src/runtime/aws/handlers\items-handler.ts:86:        case "GET /dashboard/summary":
src/runtime/aws/handlers\guest-documents-handler.ts:47:        case "GET /guest/document-requests/{token}":
src/runtime/aws/handlers\guest-documents-handler.ts:49:        case "POST /guest/document-requests/{token}/uploads":
src/runtime/aws/handlers\notifications-handler.ts:36:        case "GET /notifications/preferences":
src/runtime/aws/handlers\notifications-handler.ts:38:        case "PUT /notifications/preferences":
src/runtime/aws/handlers\reminder-dispatch-handler.ts:28:// case) - processing them one at a time serialized every message's DynamoDB round trips
src/runtime/aws/handlers\memberships-handler.ts:71:        case "POST /organizations/members/invite":
src/runtime/aws/handlers\memberships-handler.ts:73:        case "POST /organizations/invitations/{invitationId}/revoke":
src/runtime/aws/handlers\memberships-handler.ts:75:        case "GET /organizations/members":
src/runtime/aws/handlers\memberships-handler.ts:77:        case "GET /organizations/invitations":
src/runtime/aws/handlers\memberships-handler.ts:79:        case "PUT /organizations/members/{userId}/role":
src/runtime/aws/handlers\memberships-handler.ts:81:        case "DELETE /organizations/members/{userId}":
src/runtime/aws/handlers\memberships-handler.ts:83:        case "POST /organizations/members/leave":
src/runtime/aws/handlers\memberships-handler.ts:85:        case "PATCH /organizations/settings":
src/runtime/aws/handlers\memberships-handler.ts:87:        case "POST /organizations/close":
src/runtime/aws/handlers\memberships-handler.ts:90:        case "POST /organizations/cancel-close":
src/runtime/aws/handlers\reports-handler.ts:56:    case "POST /reports/subscriptions":
src/runtime/aws/handlers\reports-handler.ts:58:    case "GET /reports/subscriptions":
src/runtime/aws/handlers\reports-handler.ts:60:    case "GET /reports/subscriptions/{subscriptionId}":
src/runtime/aws/handlers\reports-handler.ts:62:    case "POST /reports/subscriptions/{subscriptionId}/delete":
src/runtime/aws/handlers\reports-handler.ts:64:    case "GET /reports/subscriptions/{subscriptionId}/runs/{runId}/download":
src/runtime/aws/handlers\reminders-handler.ts:40:        case "POST /reminders/policies":
src/runtime/aws/handlers\reminders-handler.ts:42:        case "GET /reminders/policies/{policyId}":
src/runtime/aws/handlers\reminders-handler.ts:44:        case "PUT /reminders/policies/{policyId}":
src/runtime/aws/handlers\reminders-handler.ts:46:        case "POST /reminders/policies/{policyId}/disable":
src/runtime/aws/handlers\subjects-handler.ts:83:        case "POST /subjects":
src/runtime/aws/handlers\subjects-handler.ts:85:        case "GET /subjects/dashboard":
src/runtime/aws/handlers\subjects-handler.ts:88:        case "GET /subjects/search":
src/runtime/aws/handlers\subjects-handler.ts:90:        case "GET /subjects/{subjectId}":
src/runtime/aws/handlers\subjects-handler.ts:92:        case "PUT /subjects/{subjectId}":
src/runtime/aws/handlers\subjects-handler.ts:94:        case "DELETE /subjects/{subjectId}":
src/runtime/aws/handlers\subjects-handler.ts:96:        case "POST /subjects/{subjectId}/archive":
src/runtime/aws/handlers\subjects-handler.ts:98:        case "POST /subjects/{subjectId}/requirements":
src/runtime/aws/handlers\subjects-handler.ts:100:        case "GET /subjects/{subjectId}/requirements":
src/runtime/aws/handlers\subjects-handler.ts:102:        case "GET /subjects/{subjectId}/requirements/{assignmentId}":
src/runtime/aws/handlers\subjects-handler.ts:104:        case "PUT /subjects/{subjectId}/requirements/{assignmentId}":
src/runtime/aws/handlers\subjects-handler.ts:106:        case "DELETE /subjects/{subjectId}/requirements/{assignmentId}":
src/runtime/aws/handlers\subjects-handler.ts:108:        case "POST /subjects/{subjectId}/requirements/{assignmentId}/link":
src/runtime/aws/handlers\subjects-handler.ts:110:        case "POST /subjects/{subjectId}/requirements/{assignmentId}/unlink":
src/runtime/aws/handlers\subjects-handler.ts:112:        case "GET /subjects/{subjectId}/requirements/{assignmentId}/submissions":
src/runtime/aws/handlers\subjects-handler.ts:114:        case "GET /subjects/{subjectId}/requirements/{assignmentId}/submissions/{submissionId}":
src/runtime/aws/handlers\subjects-handler.ts:116:        case "POST /subjects/{subjectId}/requirements/{assignmentId}/document-requests":
src/runtime/aws/handlers\subjects-handler.ts:118:        case "GET /subjects/{subjectId}/requirements/{assignmentId}/document-requests":
src/runtime/aws/handlers\subjects-handler.ts:120:        case "GET /subjects/{subjectId}/document-requests/{documentRequestId}":
src/runtime/aws/handlers\subjects-handler.ts:122:        case "POST /subjects/{subjectId}/document-requests/{documentRequestId}/revoke":
src/runtime/aws/handlers\subjects-handler.ts:124:        case "GET /subjects/document-request-delivery-preference":
src/runtime/aws/handlers\subjects-handler.ts:126:        case "PUT /subjects/document-request-delivery-preference":
src/runtime/aws/handlers\textract-task-handler.ts:114:    // record for this specific case, same idempotency/join pattern e.g. `outbox_sweeper`
infra\main.tf:2004:  # (PURGE_LEASE_MS, purge.ts) at a 15x margin over the worst-case invocation duration.
infra\modules\bff-api-gateway\variables.tf:17:  description = "The CloudFront-fronted app origin (e.g. https://app.example.com) - allowed for CORS on the rare case the BFF is called cross-origin during development; production traffic is same-origin via CloudFront (D-054) and does not depend on this."
infra\variables.tf:244:  # Matches infra/bin/app.ts's stack id (ExpirationTrackerStack-Dev) in spirit, lowercased/
infra\variables.tf:245:  # kebab-cased for Terraform resource naming (CDK/CloudFormation and Terraform/AWS resource
infra\modules\feature-flags\main.tf:3:# Hosted configuration (no S3/SSM indirection) — the whole payload is three booleans, no case
infra\modules\cognito\tests\cognito.tftest.hcl:32:      aws_cognito_user_pool.this.password_policy[0].require_lowercase,
infra\modules\cognito\tests\cognito.tftest.hcl:33:      aws_cognito_user_pool.this.password_policy[0].require_uppercase,
infra\modules\cognito\tests\cognito.tftest.hcl:37:    error_message = "Password policy must require lowercase, uppercase, numbers, and symbols"
infra\modules\cognito\main.tf:30:    require_lowercase = true
infra\modules\cognito\main.tf:31:    require_uppercase = true
infra\modules\bff-api-gateway\tests\bff_api_gateway.tftest.hcl:54:    condition     = aws_apigatewayv2_route.bff["organizations_create"].route_key == "POST /bff/organizations"
infra\modules\bff-api-gateway\tests\bff_api_gateway.tftest.hcl:78:    condition     = aws_apigatewayv2_route.bff["organizations_list"].route_key == "GET /bff/organizations"
infra\modules\bff-api-gateway\tests\bff_api_gateway.tftest.hcl:83:    condition     = aws_apigatewayv2_route.bff["organization_select"].route_key == "POST /bff/organization/select"
infra\modules\bff-api-gateway\tests\bff_api_gateway.tftest.hcl:104:    condition     = aws_apigatewayv2_route.bff["invitations_accept"].route_key == "POST /bff/invitations/accept"
infra\modules\bff-api-gateway\tests\bff_api_gateway.tftest.hcl:120:    condition     = aws_apigatewayv2_route.bff["proxy_catch"].route_key == "ANY /bff/api/{proxy+}"
infra\modules\bff-api-gateway\main.tf:89:  route_key          = "${each.value.method} ${each.value.path}"
infra\modules\api-gateway\tests\api_gateway.tftest.hcl:76:    condition     = aws_apigatewayv2_route.test_ping.route_key == "GET /test/ping"
infra\modules\api-gateway\tests\api_gateway.tftest.hcl:115:    condition     = aws_apigatewayv2_route.export.route_key == "GET /items/export"
infra\modules\api-gateway\main.tf:53:      route_key              = "${route_settings.value.method} ${route_settings.value.path}"
infra\modules\api-gateway\main.tf:65:      route_key              = "${route_settings.value.method} ${route_settings.value.path}"
infra\modules\api-gateway\main.tf:95:  route_key          = "GET /test/ping"
infra\modules\api-gateway\main.tf:157:  route_key          = "${each.value.method} ${each.value.path}"
infra\modules\api-gateway\main.tf:209:  route_key          = "GET /items/export"
infra\modules\api-gateway\main.tf:262:  route_key          = "${each.value.method} ${each.value.path}"
infra\modules\api-gateway\main.tf:302:  route_key          = "${each.value.method} ${each.value.path}"
infra\modules\api-gateway\main.tf:330:  route_key          = "${each.value.method} ${each.value.path}"
infra\modules\api-gateway\main.tf:372:  route_key          = "${each.value.method} ${each.value.path}"
infra\modules\api-gateway\main.tf:440:  route_key          = "${each.value.method} ${each.value.path}"
infra\modules\api-gateway\main.tf:493:  route_key          = "${each.value.method} ${each.value.path}"
infra\modules\api-gateway\main.tf:538:  route_key          = "${each.value.method} ${each.value.path}"
infra\modules\api-gateway\main.tf:577:  route_key          = "${each.value.method} ${each.value.path}"
infra\modules\api-gateway\main.tf:611:  route_key          = "${each.value.method} ${each.value.path}"
infra\modules\api-gateway\main.tf:653:  route_key          = "${each.value.method} ${each.value.path}"
infra\modules\api-gateway\main.tf:763:  route_key          = "${each.value.method} ${each.value.path}"
infra\modules\api-gateway\main.tf:804:  route_key          = "${each.value.method} ${each.value.path}"
rg: (GET|POST|PUT|PATCH|DELETE) /: A sintaxe do nome do arquivo, do nome do diretório ou do rótulo do volume está incorreta. (os error 123)

 exited 1 in 807ms:
src/runtime/aws/handlers\document-archive-guest-handler.ts:57:        case "GET /document-archive/guest/document-requests/{token}":
src/runtime/aws/handlers\document-archive-guest-handler.ts:59:        case "POST /document-archive/guest/document-requests/{token}/session":
src/runtime/aws/handlers\document-archive-guest-handler.ts:61:        case "POST /document-archive/guest/document-requests/{token}/uploads":
src/runtime/aws/handlers\document-archive-guest-handler.ts:63:        case "GET /document-archive/guest/document-requests/{token}/document-types":
src/runtime/aws/handlers\document-archive-handler.ts:89:        case "POST /document-archive/documents":
src/runtime/aws/handlers\document-archive-handler.ts:91:        case "GET /document-archive/documents/{documentId}":
src/runtime/aws/handlers\document-archive-handler.ts:93:        case "GET /document-archive/documents/{documentId}/versions":
src/runtime/aws/handlers\document-archive-handler.ts:95:        case "POST /document-archive/documents/{documentId}/versions":
src/runtime/aws/handlers\document-archive-handler.ts:97:        case "POST /document-archive/documents/{documentId}/versions/{seq}/files":
src/runtime/aws/handlers\document-archive-handler.ts:99:        case "POST /document-archive/documents/{documentId}/versions/{seq}/commit":
src/runtime/aws/handlers\document-archive-handler.ts:101:        case "POST /document-archive/documents/{documentId}/versions/{seq}/claim":
src/runtime/aws/handlers\document-archive-handler.ts:103:        case "POST /document-archive/documents/{documentId}/versions/{seq}/accept":
src/runtime/aws/handlers\document-archive-handler.ts:105:        case "POST /document-archive/documents/{documentId}/versions/{seq}/reject":
src/runtime/aws/handlers\document-archive-handler.ts:108:        case "POST /document-archive/requirements":
src/runtime/aws/handlers\document-archive-handler.ts:112:        case "GET /document-archive/requirements/search":
src/runtime/aws/handlers\document-archive-handler.ts:114:        case "GET /document-archive/requirements/{subjectId}":
src/runtime/aws/handlers\document-archive-handler.ts:118:        case "GET /document-archive/requirements/{subjectId}/compliance":
src/runtime/aws/handlers\document-archive-handler.ts:120:        case "GET /document-archive/requirements/{subjectId}/{requirementId}":
src/runtime/aws/handlers\document-archive-handler.ts:122:        case "PATCH /document-archive/requirements/{subjectId}/{requirementId}":
src/runtime/aws/handlers\document-archive-handler.ts:124:        case "POST /document-archive/requirements/{subjectId}/{requirementId}/link-evidence":
src/runtime/aws/handlers\document-archive-handler.ts:126:        case "POST /document-archive/requirements/{subjectId}/{requirementId}/unlink-evidence":
src/runtime/aws/handlers\document-archive-handler.ts:128:        case "POST /document-archive/requirements/{subjectId}/{requirementId}/delete":
src/runtime/aws/handlers\document-archive-handler.ts:133:        case "POST /document-archive/series":
src/runtime/aws/handlers\document-archive-handler.ts:135:        case "GET /document-archive/series/{subjectId}":
src/runtime/aws/handlers\document-archive-handler.ts:137:        case "GET /document-archive/series/{subjectId}/{seriesId}":
src/runtime/aws/handlers\document-archive-handler.ts:139:        case "POST /document-archive/series/{subjectId}/{seriesId}/cancel":
src/runtime/aws/handlers\document-archive-handler.ts:141:        case "POST /document-archive/series/{subjectId}/{seriesId}/materialize":
src/runtime/aws/handlers\document-archive-handler.ts:144:        case "POST /document-archive/series/{subjectId}/{seriesId}/recipient":
src/runtime/aws/handlers\document-archive-handler.ts:147:        case "POST /document-archive/document-types":
src/runtime/aws/handlers\document-archive-handler.ts:149:        case "GET /document-archive/document-types":
src/runtime/aws/handlers\document-archive-handler.ts:151:        case "GET /document-archive/document-types/{documentTypeId}":
src/runtime/aws/handlers\document-archive-handler.ts:153:        case "PATCH /document-archive/document-types/{documentTypeId}":
src/runtime/aws/handlers\document-archive-handler.ts:155:        case "POST /document-archive/document-types/{documentTypeId}/deprecate":
src/runtime/aws/handlers\document-archive-handler.ts:157:        case "POST /document-archive/document-types/{documentTypeId}/reactivate":
src/runtime/aws/handlers\document-archive-handler.ts:160:        case "POST /document-archive/document-types/{documentTypeId}/metadata-fields":
src/runtime/aws/handlers\document-archive-handler.ts:162:        case "PATCH /document-archive/document-types/{documentTypeId}/metadata-fields/{fieldId}":
src/runtime/aws/handlers\document-archive-handler.ts:164:        case "PATCH /document-archive/documents/{documentId}/metadata-values":
src/runtime/aws/handlers\document-archive-handler.ts:167:        case "POST /document-archive/requirement-templates":
src/runtime/aws/handlers\document-archive-handler.ts:169:        case "GET /document-archive/requirement-templates":
src/runtime/aws/handlers\document-archive-handler.ts:171:        case "GET /document-archive/requirement-templates/{templateId}":
src/runtime/aws/handlers\document-archive-handler.ts:173:        case "PATCH /document-archive/requirement-templates/{templateId}":
src/runtime/aws/handlers\document-archive-handler.ts:175:        case "POST /document-archive/requirement-templates/{templateId}/duplicate":
src/runtime/aws/handlers\document-archive-handler.ts:177:        case "POST /document-archive/requirement-templates/{templateId}/archive":
src/runtime/aws/handlers\document-archive-handler.ts:179:        case "POST /document-archive/requirement-templates/{templateId}/unarchive":
src/runtime/aws/handlers\document-archive-handler.ts:181:        case "POST /document-archive/requirement-templates/{templateId}/preview":
src/runtime/aws/handlers\document-archive-handler.ts:183:        case "POST /document-archive/requirement-templates/{templateId}/apply":
src/runtime/aws/handlers\document-archive-handler.ts:186:        case "POST /document-archive/subjects/{subjectId}/dossier":
src/runtime/aws/handlers\document-archive-handler.ts:188:        case "POST /document-archive/subjects/{subjectId}/dossier/{runId}/confirm":
src/runtime/aws/handlers\document-archive-handler.ts:191:        case "GET /document-archive/subjects/{subjectId}/dossier/{runId}/download":
src/runtime/aws/handlers\bulk-actions-handler.ts:42:        case "POST /items/bulk-reassign":
src/runtime/aws/handlers\bulk-actions-handler.ts:44:        case "POST /items/bulk-archive":
src/runtime/aws/handlers\documents-handler.ts:39:        case "POST /items/{itemId}/documents":
src/runtime/aws/handlers\documents-handler.ts:41:        case "GET /items/{itemId}/documents":
src/runtime/aws/handlers\documents-handler.ts:43:        case "GET /items/{itemId}/documents/{documentId}":
src/runtime/aws/handlers\documents-handler.ts:45:        case "DELETE /items/{itemId}/documents/{documentId}":
src/runtime/aws/handlers\documents-handler.ts:47:        case "POST /items/{itemId}/documents/{documentId}/extractions/{runId}/fields/{fieldName}/confirm":
src/runtime/aws/handlers\documents-handler.ts:49:        case "POST /items/{itemId}/documents/{documentId}/extractions/{runId}/fields/{fieldName}/reject":
src/runtime/aws/handlers\imports-handler.ts:39:        case "POST /imports":
src/runtime/aws/handlers\imports-handler.ts:41:        case "GET /imports/{jobId}":
src/runtime/aws/handlers\imports-handler.ts:43:        case "POST /imports/{jobId}/commit":
src/runtime/aws/handlers\imports-handler.ts:45:        case "GET /import-jobs/{jobId}/schema":
src/runtime/aws/handlers\imports-handler.ts:47:        case "POST /import-jobs/{jobId}/mapping":
src/runtime/aws/handlers\items-handler.ts:56:        case "POST /items":
src/runtime/aws/handlers\items-handler.ts:58:        case "GET /items/dashboard":
src/runtime/aws/handlers\items-handler.ts:63:        case "GET /items/search":
src/runtime/aws/handlers\items-handler.ts:65:        case "GET /items/{itemId}":
src/runtime/aws/handlers\items-handler.ts:67:        case "PUT /items/{itemId}":
src/runtime/aws/handlers\items-handler.ts:69:        case "DELETE /items/{itemId}":
src/runtime/aws/handlers\items-handler.ts:71:        case "POST /items/{itemId}/archive":
src/runtime/aws/handlers\items-handler.ts:73:        case "POST /items/{itemId}/renew":
src/runtime/aws/handlers\items-handler.ts:75:        case "POST /items/{itemId}/watchers/{userId}":
src/runtime/aws/handlers\items-handler.ts:77:        case "DELETE /items/{itemId}/watchers/{userId}":
src/runtime/aws/handlers\items-handler.ts:79:        case "GET /items/{itemId}/watchers":
src/runtime/aws/handlers\items-handler.ts:81:        case "GET /activity":
src/runtime/aws/handlers\items-handler.ts:86:        case "GET /dashboard/summary":
src/runtime/aws/handlers\guest-documents-handler.ts:47:        case "GET /guest/document-requests/{token}":
src/runtime/aws/handlers\guest-documents-handler.ts:49:        case "POST /guest/document-requests/{token}/uploads":
src/runtime/aws/handlers\notifications-handler.ts:36:        case "GET /notifications/preferences":
src/runtime/aws/handlers\notifications-handler.ts:38:        case "PUT /notifications/preferences":
src/runtime/aws/handlers\reminder-dispatch-handler.ts:28:// case) - processing them one at a time serialized every message's DynamoDB round trips
src/runtime/aws/handlers\memberships-handler.ts:71:        case "POST /organizations/members/invite":
src/runtime/aws/handlers\memberships-handler.ts:73:        case "POST /organizations/invitations/{invitationId}/revoke":
src/runtime/aws/handlers\memberships-handler.ts:75:        case "GET /organizations/members":
src/runtime/aws/handlers\memberships-handler.ts:77:        case "GET /organizations/invitations":
src/runtime/aws/handlers\memberships-handler.ts:79:        case "PUT /organizations/members/{userId}/role":
src/runtime/aws/handlers\memberships-handler.ts:81:        case "DELETE /organizations/members/{userId}":
src/runtime/aws/handlers\memberships-handler.ts:83:        case "POST /organizations/members/leave":
src/runtime/aws/handlers\memberships-handler.ts:85:        case "PATCH /organizations/settings":
src/runtime/aws/handlers\memberships-handler.ts:87:        case "POST /organizations/close":
src/runtime/aws/handlers\memberships-handler.ts:90:        case "POST /organizations/cancel-close":
src/runtime/aws/handlers\reports-handler.ts:56:    case "POST /reports/subscriptions":
src/runtime/aws/handlers\reports-handler.ts:58:    case "GET /reports/subscriptions":
src/runtime/aws/handlers\reports-handler.ts:60:    case "GET /reports/subscriptions/{subscriptionId}":
src/runtime/aws/handlers\reports-handler.ts:62:    case "POST /reports/subscriptions/{subscriptionId}/delete":
src/runtime/aws/handlers\reports-handler.ts:64:    case "GET /reports/subscriptions/{subscriptionId}/runs/{runId}/download":
src/runtime/aws/handlers\reminders-handler.ts:40:        case "POST /reminders/policies":
src/runtime/aws/handlers\reminders-handler.ts:42:        case "GET /reminders/policies/{policyId}":
src/runtime/aws/handlers\reminders-handler.ts:44:        case "PUT /reminders/policies/{policyId}":
src/runtime/aws/handlers\reminders-handler.ts:46:        case "POST /reminders/policies/{policyId}/disable":
src/runtime/aws/handlers\subjects-handler.ts:83:        case "POST /subjects":
src/runtime/aws/handlers\subjects-handler.ts:85:        case "GET /subjects/dashboard":
src/runtime/aws/handlers\subjects-handler.ts:88:        case "GET /subjects/search":
src/runtime/aws/handlers\subjects-handler.ts:90:        case "GET /subjects/{subjectId}":
src/runtime/aws/handlers\subjects-handler.ts:92:        case "PUT /subjects/{subjectId}":
src/runtime/aws/handlers\subjects-handler.ts:94:        case "DELETE /subjects/{subjectId}":
src/runtime/aws/handlers\subjects-handler.ts:96:        case "POST /subjects/{subjectId}/archive":
src/runtime/aws/handlers\subjects-handler.ts:98:        case "POST /subjects/{subjectId}/requirements":
src/runtime/aws/handlers\subjects-handler.ts:100:        case "GET /subjects/{subjectId}/requirements":
src/runtime/aws/handlers\subjects-handler.ts:102:        case "GET /subjects/{subjectId}/requirements/{assignmentId}":
src/runtime/aws/handlers\subjects-handler.ts:104:        case "PUT /subjects/{subjectId}/requirements/{assignmentId}":
src/runtime/aws/handlers\subjects-handler.ts:106:        case "DELETE /subjects/{subjectId}/requirements/{assignmentId}":
src/runtime/aws/handlers\subjects-handler.ts:108:        case "POST /subjects/{subjectId}/requirements/{assignmentId}/link":
src/runtime/aws/handlers\subjects-handler.ts:110:        case "POST /subjects/{subjectId}/requirements/{assignmentId}/unlink":
src/runtime/aws/handlers\subjects-handler.ts:112:        case "GET /subjects/{subjectId}/requirements/{assignmentId}/submissions":
src/runtime/aws/handlers\subjects-handler.ts:114:        case "GET /subjects/{subjectId}/requirements/{assignmentId}/submissions/{submissionId}":
src/runtime/aws/handlers\subjects-handler.ts:116:        case "POST /subjects/{subjectId}/requirements/{assignmentId}/document-requests":
src/runtime/aws/handlers\subjects-handler.ts:118:        case "GET /subjects/{subjectId}/requirements/{assignmentId}/document-requests":
src/runtime/aws/handlers\subjects-handler.ts:120:        case "GET /subjects/{subjectId}/document-requests/{documentRequestId}":
src/runtime/aws/handlers\subjects-handler.ts:122:        case "POST /subjects/{subjectId}/document-requests/{documentRequestId}/revoke":
src/runtime/aws/handlers\subjects-handler.ts:124:        case "GET /subjects/document-request-delivery-preference":
src/runtime/aws/handlers\subjects-handler.ts:126:        case "PUT /subjects/document-request-delivery-preference":
src/runtime/aws/handlers\textract-task-handler.ts:114:    // record for this specific case, same idempotency/join pattern e.g. `outbox_sweeper`
infra\main.tf:2004:  # (PURGE_LEASE_MS, purge.ts) at a 15x margin over the worst-case invocation duration.
infra\modules\bff-api-gateway\variables.tf:17:  description = "The CloudFront-fronted app origin (e.g. https://app.example.com) - allowed for CORS on the rare case the BFF is called cross-origin during development; production traffic is same-origin via CloudFront (D-054) and does not depend on this."
infra\variables.tf:244:  # Matches infra/bin/app.ts's stack id (ExpirationTrackerStack-Dev) in spirit, lowercased/
infra\variables.tf:245:  # kebab-cased for Terraform resource naming (CDK/CloudFormation and Terraform/AWS resource
infra\modules\feature-flags\main.tf:3:# Hosted configuration (no S3/SSM indirection) — the whole payload is three booleans, no case
infra\modules\cognito\tests\cognito.tftest.hcl:32:      aws_cognito_user_pool.this.password_policy[0].require_lowercase,
infra\modules\cognito\tests\cognito.tftest.hcl:33:      aws_cognito_user_pool.this.password_policy[0].require_uppercase,
infra\modules\cognito\tests\cognito.tftest.hcl:37:    error_message = "Password policy must require lowercase, uppercase, numbers, and symbols"
infra\modules\cognito\main.tf:30:    require_lowercase = true
infra\modules\cognito\main.tf:31:    require_uppercase = true
infra\modules\bff-api-gateway\tests\bff_api_gateway.tftest.hcl:54:    condition     = aws_apigatewayv2_route.bff["organizations_create"].route_key == "POST /bff/organizations"
infra\modules\bff-api-gateway\tests\bff_api_gateway.tftest.hcl:78:    condition     = aws_apigatewayv2_route.bff["organizations_list"].route_key == "GET /bff/organizations"
infra\modules\bff-api-gateway\tests\bff_api_gateway.tftest.hcl:83:    condition     = aws_apigatewayv2_route.bff["organization_select"].route_key == "POST /bff/organization/select"
infra\modules\bff-api-gateway\tests\bff_api_gateway.tftest.hcl:104:    condition     = aws_apigatewayv2_route.bff["invitations_accept"].route_key == "POST /bff/invitations/accept"
infra\modules\bff-api-gateway\tests\bff_api_gateway.tftest.hcl:120:    condition     = aws_apigatewayv2_route.bff["proxy_catch"].route_key == "ANY /bff/api/{proxy+}"
infra\modules\bff-api-gateway\main.tf:89:  route_key          = "${each.value.method} ${each.value.path}"
infra\modules\api-gateway\tests\api_gateway.tftest.hcl:76:    condition     = aws_apigatewayv2_route.test_ping.route_key == "GET /test/ping"
infra\modules\api-gateway\tests\api_gateway.tftest.hcl:115:    condition     = aws_apigatewayv2_route.export.route_key == "GET /items/export"
infra\modules\api-gateway\main.tf:53:      route_key              = "${route_settings.value.method} ${route_settings.value.path}"
infra\modules\api-gateway\main.tf:65:      route_key              = "${route_settings.value.method} ${route_settings.value.path}"
infra\modules\api-gateway\main.tf:95:  route_key          = "GET /test/ping"
infra\modules\api-gateway\main.tf:157:  route_key          = "${each.value.method} ${each.value.path}"
infra\modules\api-gateway\main.tf:209:  route_key          = "GET /items/export"
infra\modules\api-gateway\main.tf:262:  route_key          = "${each.value.method} ${each.value.path}"
infra\modules\api-gateway\main.tf:302:  route_key          = "${each.value.method} ${each.value.path}"
infra\modules\api-gateway\main.tf:330:  route_key          = "${each.value.method} ${each.value.path}"
infra\modules\api-gateway\main.tf:372:  route_key          = "${each.value.method} ${each.value.path}"
infra\modules\api-gateway\main.tf:440:  route_key          = "${each.value.method} ${each.value.path}"
infra\modules\api-gateway\main.tf:493:  route_key          = "${each.value.method} ${each.value.path}"
infra\modules\api-gateway\main.tf:538:  route_key          = "${each.value.method} ${each.value.path}"
infra\modules\api-gateway\main.tf:577:  route_key          = "${each.value.method} ${each.value.path}"
infra\modules\api-gateway\main.tf:611:  route_key          = "${each.value.method} ${each.value.path}"
infra\modules\api-gateway\main.tf:653:  route_key          = "${each.value.method} ${each.value.path}"
infra\modules\api-gateway\main.tf:763:  route_key          = "${each.value.method} ${each.value.path}"
infra\modules\api-gateway\main.tf:804:  route_key          = "${each.value.method} ${each.value.path}"
rg: (GET|POST|PUT|PATCH|DELETE) /: A sintaxe do nome do arquivo, do nome do diretório ou do rótulo do volume está incorreta. (os error 123)

exec
"C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -Command "rg --files src/modules/organization/domain src/modules/document-archive/domain src/modules/subject/domain src/modules/expiration/domain src/modules/notification/domain; rg -n '"'^export (interface|type|class)|''^  (readonly )?[a-zA-Z][a-zA-Z0-9]*[?]?:'"' src/modules/organization/domain src/modules/document-archive/domain src/modules/subject/domain src/modules/expiration/domain src/modules/notification/domain" in C:\Users\Usuario\Desktop\projects\expiration-tracker
 succeeded in 466ms:
src/modules/expiration/domain\item-watch.ts
src/modules/expiration/domain\audit-event.ts
src/modules/expiration/domain\expiration-item.ts
src/modules/organization/domain\organization.ts
src/modules/organization/domain\membership.ts
src/modules/organization/domain\invitation.ts
src/modules/organization/domain\invitation-token.ts
src/modules/organization/domain\audit-event.ts
src/modules/subject/domain\tracked-subject.ts
src/modules/subject/domain\submission-quarantine-key.ts
src/modules/subject/domain\requirement-assignment.ts
src/modules/subject/domain\guest-token.ts
src/modules/subject/domain\entitlement.ts
src/modules/subject/domain\document-submission.ts
src/modules/subject/domain\document-request.ts
src/modules/subject/domain\document-request-delivery-preference.ts
src/modules/subject/domain\document-chasing.ts
src/modules/subject/domain\audit-event.ts
src/modules/document-archive/domain\requirement.ts
src/modules/document-archive/domain\requirement-template.ts
src/modules/document-archive/domain\request-access-credential.ts
src/modules/document-archive/domain\guest-session.ts
src/modules/document-archive/domain\guest-credential-delivery.ts
src/modules/document-archive/domain\external-share-link.ts
src/modules/document-archive/domain\dossier-export-run.ts
src/modules/document-archive/domain\document.ts
src/modules/document-archive/domain\document-version.ts
src/modules/document-archive/domain\document-version-event.ts
src/modules/document-archive/domain\document-type.ts
src/modules/document-archive/domain\document-request.ts
src/modules/document-archive/domain\document-request-series.ts
src/modules/document-archive/domain\document-file.ts
src/modules/document-archive/domain\document-archive-quarantine-key.ts
src/modules/document-archive/domain\document-archive-clean-key.ts
src/modules/notification/domain\whatsapp-portfolio-quota.ts
src/modules/notification/domain\whatsapp-opt-in.ts
src/modules/notification/domain\notification-preferences.ts
src/modules/notification/domain\notification-entitlements.ts
src/modules/notification/domain\notification-attempt.ts
src/modules/notification/domain\whatsapp-portfolio-quota.ts:40:export interface WhatsAppPortfolioQuotaEntry extends EntityKey {
src/modules/notification/domain\whatsapp-portfolio-quota.ts:41:  entityType: "WhatsAppPortfolioQuotaEntry";
src/modules/notification/domain\whatsapp-portfolio-quota.ts:42:  phoneE164: string;
src/modules/notification/domain\whatsapp-portfolio-quota.ts:43:  sentAt: string;
src/modules/notification/domain\whatsapp-portfolio-quota.ts:45:  purgeAfterTtl: number;
src/modules/notification/domain\whatsapp-portfolio-quota.ts:77:export type WhatsAppPortfolioQuotaDecision =
src/modules/notification/domain\whatsapp-portfolio-quota.ts:90:  distinctPhonesInWindow: ReadonlySet<string>;
src/modules/notification/domain\whatsapp-portfolio-quota.ts:91:  to: string;
src/modules/notification/domain\whatsapp-portfolio-quota.ts:92:  tierLimit: number;
src/modules/notification/domain\notification-entitlements.ts:11:export interface NotificationEntitlements extends EntityKey {
src/modules/notification/domain\notification-entitlements.ts:12:  SK: "ENTITLEMENTS";
src/modules/notification/domain\notification-entitlements.ts:13:  entityType: "NotificationEntitlements";
src/modules/notification/domain\notification-entitlements.ts:14:  tenantId: string;
src/modules/notification/domain\notification-entitlements.ts:15:  email: { enabled: boolean; monthlyLimit?: number };
src/modules/notification/domain\notification-entitlements.ts:16:  whatsapp: { enabled: boolean };
src/modules/notification/domain\notification-entitlements.ts:17:  planVersion: number;
src/modules/notification/domain\notification-entitlements.ts:18:  validUntil?: string;
src/modules/notification/domain\notification-entitlements.ts:19:  version: number;
src/modules/notification/domain\notification-entitlements.ts:20:  createdAt: string;
src/modules/notification/domain\notification-entitlements.ts:21:  updatedAt: string;
src/modules/notification/domain\notification-preferences.ts:15:export type NotificationConsentSource = "ONBOARDING" | "USER_SETTINGS" | "MIGRATED_DEFAULT";
src/modules/notification/domain\notification-preferences.ts:17:export interface NotificationPreferences extends EntityKey {
src/modules/notification/domain\notification-preferences.ts:18:  SK: "NOTIFICATION_PREFERENCES";
src/modules/notification/domain\notification-preferences.ts:19:  entityType: "NotificationPreferences";
src/modules/notification/domain\notification-preferences.ts:20:  tenantId: string;
src/modules/notification/domain\notification-preferences.ts:21:  userId: string;
src/modules/notification/domain\notification-preferences.ts:22:  emailEnabled: boolean;
src/modules/notification/domain\notification-preferences.ts:23:  locale: string;
src/modules/notification/domain\notification-preferences.ts:24:  quietHours: {
src/modules/notification/domain\notification-preferences.ts:30:  consentSource: NotificationConsentSource;
src/modules/notification/domain\notification-preferences.ts:31:  version: number;
src/modules/notification/domain\notification-preferences.ts:32:  createdAt: string;
src/modules/notification/domain\notification-preferences.ts:33:  updatedAt: string;
src/modules/notification/domain\notification-preferences.ts:42:  tenantId: string;
src/modules/notification/domain\notification-preferences.ts:43:  userId: string;
src/modules/notification/domain\notification-preferences.ts:44:  locale: string;
src/modules/notification/domain\notification-preferences.ts:45:  now: string;
src/modules/notification/domain\notification-preferences.ts:46:  consentSource?: NotificationConsentSource;
src/modules/subject/domain\document-chasing.ts:24:export type DocumentChasingTier = "T7" | "T3" | "EXPIRED";
src/modules/subject/domain\document-chasing.ts:25:export type DocumentChasingOccurrenceStatus = "SCHEDULED" | "CLAIMED" | "CANCELLED" | "TRIGGERED";
src/modules/subject/domain\document-chasing.ts:27:export interface DocumentChasingOccurrence extends EntityKey {
src/modules/subject/domain\document-chasing.ts:28:  entityType: "DocumentChasingOccurrence";
src/modules/subject/domain\document-chasing.ts:29:  occurrenceId: string;
src/modules/subject/domain\document-chasing.ts:30:  tenantId: string;
src/modules/subject/domain\document-chasing.ts:31:  subjectId: string;
src/modules/subject/domain\document-chasing.ts:32:  assignmentId: string;
src/modules/subject/domain\document-chasing.ts:33:  documentRequestId: string;
src/modules/subject/domain\document-chasing.ts:34:  tier: DocumentChasingTier;
src/modules/subject/domain\document-chasing.ts:35:  scheduledAt: string; // UTC ISO-8601 instant
src/modules/subject/domain\document-chasing.ts:36:  documentRequestVersion: number; // versão esperada do DocumentRequest no momento da materialização — mesma checagem de staleness que itemVersion faz para reminders
src/modules/subject/domain\document-chasing.ts:37:  shard: string;
src/modules/subject/domain\document-chasing.ts:38:  shardFnVersion: number;
src/modules/subject/domain\document-chasing.ts:39:  status: DocumentChasingOccurrenceStatus;
src/modules/subject/domain\document-chasing.ts:40:  claimedAt?: string;
src/modules/subject/domain\document-chasing.ts:41:  claimExpiresAt?: string;
src/modules/subject/domain\document-chasing.ts:42:  version: number;
src/modules/subject/domain\document-chasing.ts:43:  createdAt: string;
src/modules/subject/domain\document-chasing.ts:44:  updatedAt: string;
src/modules/subject/domain\document-chasing.ts:45:  GSI3PK?: string; // presente só enquanto status === SCHEDULED (ou CLAIMED) — removido em TRIGGERED/CANCELLED, mesmo invariante de ReminderOccurrence
src/modules/subject/domain\document-chasing.ts:46:  GSI3SK?: string;
src/modules/subject/domain\document-chasing.ts:47:  GSI6PK?: string; // WORKSTATE#CLAIMED (constante compartilhada com reminders) enquanto CLAIMED
src/modules/subject/domain\document-chasing.ts:48:  GSI6SK?: string;
src/modules/subject/domain\document-chasing.ts:92:export type DocumentChasingRecipientRef =
src/modules/subject/domain\document-chasing.ts:96:export type DocumentChasingIntentStatus = "PENDING" | "SENT" | "FAILED";
src/modules/subject/domain\document-chasing.ts:102:export interface DocumentChasingIntent extends EntityKey {
src/modules/subject/domain\document-chasing.ts:103:  entityType: "DocumentChasingIntent";
src/modules/subject/domain\document-chasing.ts:104:  intentId: string;
src/modules/subject/domain\document-chasing.ts:105:  tenantId: string;
src/modules/subject/domain\document-chasing.ts:106:  subjectId: string;
src/modules/subject/domain\document-chasing.ts:107:  assignmentId: string;
src/modules/subject/domain\document-chasing.ts:108:  documentRequestId: string;
src/modules/subject/domain\document-chasing.ts:109:  occurrenceId: string;
src/modules/subject/domain\document-chasing.ts:110:  tier: DocumentChasingTier;
src/modules/subject/domain\document-chasing.ts:111:  recipient: DocumentChasingRecipientRef;
src/modules/subject/domain\document-chasing.ts:112:  templateId: string;
src/modules/subject/domain\document-chasing.ts:113:  templateVersion: number;
src/modules/subject/domain\document-chasing.ts:114:  status: DocumentChasingIntentStatus;
src/modules/subject/domain\document-chasing.ts:115:  sentAt?: string;
src/modules/subject/domain\document-chasing.ts:116:  failureReason?: string;
src/modules/subject/domain\document-chasing.ts:117:  version: number;
src/modules/subject/domain\document-chasing.ts:118:  createdAt: string;
src/modules/subject/domain\document-chasing.ts:119:  updatedAt: string;
src/modules/subject/domain\document-submission.ts:18:export type { DocumentStatus, UploadEvidence, MalwareEvidence, DocumentObjectReference };
src/modules/subject/domain\document-submission.ts:20:export interface DocumentSubmission extends EntityKey {
src/modules/subject/domain\document-submission.ts:21:  entityType: "DocumentSubmission";
src/modules/subject/domain\document-submission.ts:22:  submissionId: string;
src/modules/subject/domain\document-submission.ts:23:  tenantId: string;
src/modules/subject/domain\document-submission.ts:24:  subjectId: string;
src/modules/subject/domain\document-submission.ts:25:  assignmentId: string;
src/modules/subject/domain\document-submission.ts:26:  documentRequestId: string;
src/modules/subject/domain\document-submission.ts:27:  fileName: string;
src/modules/subject/domain\document-submission.ts:28:  mediaType: string;
src/modules/subject/domain\document-submission.ts:29:  contentLength: number;
src/modules/subject/domain\document-submission.ts:30:  checksumSha256: string;
src/modules/subject/domain\document-submission.ts:31:  status: DocumentStatus;
src/modules/subject/domain\document-submission.ts:32:  quarantineObject: DocumentObjectReference;
src/modules/subject/domain\document-submission.ts:33:  cleanObject?: DocumentObjectReference;
src/modules/subject/domain\document-submission.ts:34:  uploadEvidence?: UploadEvidence;
src/modules/subject/domain\document-submission.ts:35:  malwareEvidence?: MalwareEvidence;
src/modules/subject/domain\document-submission.ts:36:  createdAt: string;
src/modules/subject/domain\document-submission.ts:37:  updatedAt: string;
src/modules/subject/domain\document-submission.ts:38:  deletedAt?: string;
src/modules/subject/domain\document-submission.ts:39:  version: number;
src/modules/subject/domain\document-request-delivery-preference.ts:13:export type DocumentRequestDeliveryMode = "MANUAL" | "EMAIL";
src/modules/subject/domain\document-request-delivery-preference.ts:18:export type InitialInviteDeliveryOverride = "DEFAULT" | DocumentRequestDeliveryMode;
src/modules/subject/domain\document-request-delivery-preference.ts:20:export interface DocumentRequestDeliveryPreference extends EntityKey {
src/modules/subject/domain\document-request-delivery-preference.ts:21:  SK: "DOCUMENT_REQUEST_DELIVERY";
src/modules/subject/domain\document-request-delivery-preference.ts:22:  entityType: "DocumentRequestDeliveryPreference";
src/modules/subject/domain\document-request-delivery-preference.ts:23:  tenantId: string;
src/modules/subject/domain\document-request-delivery-preference.ts:24:  initialInviteDeliveryDefault: DocumentRequestDeliveryMode;
src/modules/subject/domain\document-request-delivery-preference.ts:25:  updatedByUserId: string;
src/modules/subject/domain\document-request-delivery-preference.ts:26:  createdAt: string;
src/modules/subject/domain\document-request-delivery-preference.ts:27:  updatedAt: string;
src/modules/subject/domain\document-request-delivery-preference.ts:28:  version: number;
src/modules/notification/domain\notification-attempt.ts:23:export type NotificationProvider = "SES" | "META_CLOUD_API";
src/modules/notification/domain\notification-attempt.ts:25:export type NotificationAttemptStatus =
src/modules/notification/domain\notification-attempt.ts:37:export interface NotificationAttempt extends EntityKey {
src/modules/notification/domain\notification-attempt.ts:39:  entityType: "NotificationAttempt";
src/modules/notification/domain\notification-attempt.ts:40:  tenantId: string;
src/modules/notification/domain\notification-attempt.ts:41:  intentId: string;
src/modules/notification/domain\notification-attempt.ts:42:  attemptId: string;
src/modules/notification/domain\notification-attempt.ts:43:  attemptNumber: number;
src/modules/notification/domain\notification-attempt.ts:44:  redriveGeneration: number;
src/modules/notification/domain\notification-attempt.ts:45:  channel: NotificationChannel;
src/modules/notification/domain\notification-attempt.ts:46:  provider: NotificationProvider;
src/modules/notification/domain\notification-attempt.ts:47:  providerAccountId: string;
src/modules/notification/domain\notification-attempt.ts:48:  providerMessageId?: string;
src/modules/notification/domain\notification-attempt.ts:49:  status: NotificationAttemptStatus;
src/modules/notification/domain\notification-attempt.ts:50:  expectedItemVersion: number;
src/modules/notification/domain\notification-attempt.ts:51:  commandMessageId: string;
src/modules/notification/domain\notification-attempt.ts:52:  destinationHash: string;
src/modules/notification/domain\notification-attempt.ts:53:  templateId: string;
src/modules/notification/domain\notification-attempt.ts:54:  templateVersion: number;
src/modules/notification/domain\notification-attempt.ts:55:  submitStartedAt?: string;
src/modules/notification/domain\notification-attempt.ts:56:  acceptedAt?: string;
src/modules/notification/domain\notification-attempt.ts:57:  completedAt?: string;
src/modules/notification/domain\notification-attempt.ts:58:  lastProviderEventAt?: string;
src/modules/notification/domain\notification-attempt.ts:59:  normalizedFailureCode?: string;
src/modules/notification/domain\notification-attempt.ts:64:  leaseExpiresAt?: string;
src/modules/notification/domain\notification-attempt.ts:65:  version: number;
src/modules/notification/domain\notification-attempt.ts:66:  createdAt: string;
src/modules/notification/domain\notification-attempt.ts:67:  updatedAt: string;
src/modules/notification/domain\notification-attempt.ts:103:export interface NotificationAttemptLookup extends EntityKey {
src/modules/notification/domain\notification-attempt.ts:105:  entityType: "NotificationAttemptLookup";
src/modules/notification/domain\notification-attempt.ts:106:  tenantId: string;
src/modules/notification/domain\notification-attempt.ts:107:  intentId: string;
src/modules/notification/domain\notification-attempt.ts:108:  attemptSk: string;
src/modules/notification/domain\notification-attempt.ts:109:  provider: NotificationProvider;
src/modules/notification/domain\notification-attempt.ts:110:  providerAccountId: string;
src/modules/notification/domain\notification-attempt.ts:118:  attempt: Pick<NotificationAttempt, "tenantId" | "intentId" | "attemptId" | "attemptNumber" | "provider" | "providerAccountId">,
src/modules/notification/domain\whatsapp-opt-in.ts:22:export type WhatsAppOptInSource = "USER_SETTINGS";
src/modules/notification/domain\whatsapp-opt-in.ts:24:export interface WhatsAppOptIn extends EntityKey {
src/modules/notification/domain\whatsapp-opt-in.ts:26:  entityType: "WhatsAppOptIn";
src/modules/notification/domain\whatsapp-opt-in.ts:27:  tenantId: string;
src/modules/notification/domain\whatsapp-opt-in.ts:28:  userId: string;
src/modules/notification/domain\whatsapp-opt-in.ts:29:  phoneE164: string;
src/modules/notification/domain\whatsapp-opt-in.ts:30:  source: WhatsAppOptInSource;
src/modules/notification/domain\whatsapp-opt-in.ts:31:  optedInAt: string;
src/modules/notification/domain\whatsapp-opt-in.ts:32:  createdAt: string;
src/modules/notification/domain\whatsapp-opt-in.ts:47:  tenantId: string;
src/modules/notification/domain\whatsapp-opt-in.ts:48:  userId: string;
src/modules/notification/domain\whatsapp-opt-in.ts:49:  phoneE164: string;
src/modules/notification/domain\whatsapp-opt-in.ts:50:  source: WhatsAppOptInSource;
src/modules/notification/domain\whatsapp-opt-in.ts:51:  now: string;
src/modules/subject/domain\audit-event.ts:14:export type SubjectAuditAction =
src/modules/subject/domain\audit-event.ts:31:export type SubjectAuditResourceType = "TrackedSubject" | "RequirementAssignment" | "DocumentRequest" | "DocumentRequestDeliveryPreference";
src/modules/subject/domain\audit-event.ts:33:export interface SubjectAuditEvent extends EntityKey {
src/modules/subject/domain\audit-event.ts:34:  entityType: "SubjectAuditEvent";
src/modules/subject/domain\audit-event.ts:35:  auditEventId: string;
src/modules/subject/domain\audit-event.ts:36:  tenantId: string;
src/modules/subject/domain\audit-event.ts:37:  resourceType: SubjectAuditResourceType;
src/modules/subject/domain\audit-event.ts:38:  resourceId: string;
src/modules/subject/domain\audit-event.ts:39:  subjectId: string;
src/modules/subject/domain\audit-event.ts:40:  action: SubjectAuditAction;
src/modules/subject/domain\audit-event.ts:41:  actor: Actor;
src/modules/subject/domain\audit-event.ts:42:  previousVersion?: number;
src/modules/subject/domain\audit-event.ts:43:  newVersion: number;
src/modules/subject/domain\audit-event.ts:44:  changes: Record<string, unknown>;
src/modules/subject/domain\audit-event.ts:45:  occurredAt: string;
src/modules/subject/domain\audit-event.ts:46:  correlationId: string;
src/modules/subject/domain\audit-event.ts:49:  GSI8PK: string;
src/modules/subject/domain\audit-event.ts:50:  GSI8SK: string;
src/modules/subject/domain\audit-event.ts:61:export interface BuildSubjectAuditEventInput {
src/modules/subject/domain\audit-event.ts:62:  auditEventId: string;
src/modules/subject/domain\audit-event.ts:63:  tenantId: AuthorizedTenantId;
src/modules/subject/domain\audit-event.ts:64:  resourceType: SubjectAuditResourceType;
src/modules/subject/domain\audit-event.ts:65:  resourceId: string;
src/modules/subject/domain\audit-event.ts:66:  subjectId: string;
src/modules/subject/domain\audit-event.ts:67:  action: SubjectAuditAction;
src/modules/subject/domain\audit-event.ts:68:  actor: Actor;
src/modules/subject/domain\audit-event.ts:69:  previousVersion?: number;
src/modules/subject/domain\audit-event.ts:70:  newVersion: number;
src/modules/subject/domain\audit-event.ts:71:  changes: Record<string, unknown>;
src/modules/subject/domain\audit-event.ts:72:  occurredAt: string;
src/modules/subject/domain\audit-event.ts:73:  correlationId: string;
src/modules/subject/domain\tracked-subject.ts:26:export type TrackedSubjectType = "COMPANY" | "VENDOR" | "CLIENT" | "EMPLOYEE" | "ASSET" | "LOCATION" | "CUSTOM";
src/modules/subject/domain\tracked-subject.ts:27:export type TrackedSubjectStatus = "ACTIVE" | "ARCHIVED" | "DELETED";
src/modules/subject/domain\tracked-subject.ts:29:export interface TrackedSubject extends EntityKey {
src/modules/subject/domain\tracked-subject.ts:30:  SK: "META";
src/modules/subject/domain\tracked-subject.ts:31:  entityType: "TrackedSubject";
src/modules/subject/domain\tracked-subject.ts:32:  subjectId: string;
src/modules/subject/domain\tracked-subject.ts:33:  tenantId: string;
src/modules/subject/domain\tracked-subject.ts:34:  type: TrackedSubjectType;
src/modules/subject/domain\tracked-subject.ts:35:  displayName: string;
src/modules/subject/domain\tracked-subject.ts:36:  displayNameNormalized: string;
src/modules/subject/domain\tracked-subject.ts:39:  notes?: string;
src/modules/subject/domain\tracked-subject.ts:47:  externalId?: string;
src/modules/subject/domain\tracked-subject.ts:48:  tags: string[];
src/modules/subject/domain\tracked-subject.ts:49:  status: TrackedSubjectStatus;
src/modules/subject/domain\tracked-subject.ts:50:  deletedAt?: string;
src/modules/subject/domain\tracked-subject.ts:51:  createdAt: string;
src/modules/subject/domain\tracked-subject.ts:52:  updatedAt: string;
src/modules/subject/domain\tracked-subject.ts:53:  version: number;
src/modules/subject/domain\tracked-subject.ts:54:  GSI7PK: string;
src/modules/subject/domain\tracked-subject.ts:55:  GSI7SK: string;
src/modules/subject/domain\tracked-subject.ts:65:  tenantId: AuthorizedTenantId,
src/modules/subject/domain\tracked-subject.ts:66:  status: TrackedSubjectStatus,
src/modules/subject/domain\tracked-subject.ts:67:  type: TrackedSubjectType,
src/modules/subject/domain\tracked-subject.ts:68:  displayNameNormalized: string,
src/modules/subject/domain\tracked-subject.ts:69:  subjectId: string,
src/modules/subject/domain\tracked-subject.ts:82:export interface SubjectExternalIdPointer extends EntityKey {
src/modules/subject/domain\tracked-subject.ts:83:  SK: "POINTER";
src/modules/subject/domain\tracked-subject.ts:84:  entityType: "SubjectExternalIdPointer";
src/modules/subject/domain\tracked-subject.ts:85:  tenantId: string;
src/modules/subject/domain\tracked-subject.ts:86:  externalId: string;
src/modules/subject/domain\tracked-subject.ts:87:  subjectId: string;
src/modules/subject/domain\tracked-subject.ts:88:  createdAt: string;
src/modules/subject/domain\tracked-subject.ts:89:  updatedAt: string;
src/modules/subject/domain\tracked-subject.ts:90:  version: number;
src/modules/subject/domain\tracked-subject.ts:97:export interface CreateSubjectInput {
src/modules/subject/domain\tracked-subject.ts:98:  type: TrackedSubjectType;
src/modules/subject/domain\tracked-subject.ts:99:  displayName: string;
src/modules/subject/domain\tracked-subject.ts:100:  notes?: string;
src/modules/subject/domain\tracked-subject.ts:101:  tags?: string[];
src/modules/subject/domain\tracked-subject.ts:103:  externalId?: string;
src/modules/subject/domain\tracked-subject.ts:106:export interface UpdateSubjectInput {
src/modules/subject/domain\tracked-subject.ts:107:  displayName?: string;
src/modules/subject/domain\tracked-subject.ts:108:  notes?: string;
src/modules/subject/domain\tracked-subject.ts:109:  tags?: string[];
src/modules/subject/domain\requirement-assignment.ts:21:export type RequirementAssignmentStatus =
src/modules/subject/domain\requirement-assignment.ts:29:export interface RequirementAssignment extends EntityKey {
src/modules/subject/domain\requirement-assignment.ts:30:  entityType: "RequirementAssignment";
src/modules/subject/domain\requirement-assignment.ts:31:  assignmentId: string;
src/modules/subject/domain\requirement-assignment.ts:32:  subjectId: string;
src/modules/subject/domain\requirement-assignment.ts:33:  tenantId: string;
src/modules/subject/domain\requirement-assignment.ts:34:  requirementName: string;
src/modules/subject/domain\requirement-assignment.ts:35:  requirementDefinitionId?: string;
src/modules/subject/domain\requirement-assignment.ts:36:  notes?: string;
src/modules/subject/domain\requirement-assignment.ts:37:  status: RequirementAssignmentStatus;
src/modules/subject/domain\requirement-assignment.ts:38:  linkedItemId?: string;
src/modules/subject/domain\requirement-assignment.ts:39:  linkedDocumentId?: string;
src/modules/subject/domain\requirement-assignment.ts:40:  lastSubmissionId?: string;
src/modules/subject/domain\requirement-assignment.ts:41:  requestedAt?: string;
src/modules/subject/domain\requirement-assignment.ts:42:  submittedAt?: string;
src/modules/subject/domain\requirement-assignment.ts:43:  reviewedAt?: string;
src/modules/subject/domain\requirement-assignment.ts:44:  satisfiedAt?: string;
src/modules/subject/domain\requirement-assignment.ts:45:  deletedAt?: string;
src/modules/subject/domain\requirement-assignment.ts:46:  createdAt: string;
src/modules/subject/domain\requirement-assignment.ts:47:  updatedAt: string;
src/modules/subject/domain\requirement-assignment.ts:48:  version: number;
src/modules/subject/domain\requirement-assignment.ts:58:export interface AssignRequirementInput {
src/modules/subject/domain\requirement-assignment.ts:59:  requirementName: string;
src/modules/subject/domain\requirement-assignment.ts:60:  requirementDefinitionId?: string;
src/modules/subject/domain\requirement-assignment.ts:61:  notes?: string;
src/modules/subject/domain\requirement-assignment.ts:64:export interface UpdateRequirementAssignmentInput {
src/modules/subject/domain\requirement-assignment.ts:65:  requirementName?: string;
src/modules/subject/domain\requirement-assignment.ts:66:  notes?: string;
src/modules/subject/domain\document-request.ts:11:export type DocumentRequestStatus = "REQUESTED" | "OPENED" | "SUBMITTED" | "COMPLETED" | "CANCELLED" | "EXPIRED" | "REVOKED";
src/modules/subject/domain\document-request.ts:13:export interface DocumentRequest extends EntityKey {
src/modules/subject/domain\document-request.ts:14:  entityType: "DocumentRequest";
src/modules/subject/domain\document-request.ts:15:  documentRequestId: string;
src/modules/subject/domain\document-request.ts:16:  tenantId: string;
src/modules/subject/domain\document-request.ts:17:  subjectId: string;
src/modules/subject/domain\document-request.ts:18:  assignmentId: string;
src/modules/subject/domain\document-request.ts:19:  recipientEmail: string;
src/modules/subject/domain\document-request.ts:20:  recipientDisplayName?: string;
src/modules/subject/domain\document-request.ts:21:  requestedByUserId: string;
src/modules/subject/domain\document-request.ts:22:  requestedAt: string;
src/modules/subject/domain\document-request.ts:23:  deadline?: string;
src/modules/subject/domain\document-request.ts:24:  status: DocumentRequestStatus;
src/modules/subject/domain\document-request.ts:25:  tokenSelectorHash: string;
src/modules/subject/domain\document-request.ts:26:  tokenVersion: number;
src/modules/subject/domain\document-request.ts:27:  tokenExpiresAt: string;
src/modules/subject/domain\document-request.ts:28:  revokedAt?: string;
src/modules/subject/domain\document-request.ts:29:  lastOpenedAt?: string;
src/modules/subject/domain\document-request.ts:30:  submissionCount: number;
src/modules/subject/domain\document-request.ts:31:  lastSubmissionId?: string;
src/modules/subject/domain\document-request.ts:32:  completedAt?: string;
src/modules/subject/domain\document-request.ts:33:  cancellationReason?: string;
src/modules/subject/domain\document-request.ts:34:  createdAt: string;
src/modules/subject/domain\document-request.ts:35:  updatedAt: string;
src/modules/subject/domain\document-request.ts:36:  version: number;
src/modules/subject/domain\document-request.ts:43:export interface CreateDocumentRequestInput {
src/modules/subject/domain\document-request.ts:44:  recipientEmail: string;
src/modules/subject/domain\document-request.ts:45:  recipientDisplayName?: string;
src/modules/subject/domain\document-request.ts:46:  deadline?: string;
src/modules/subject/domain\document-request.ts:49:  initialInviteDelivery?: InitialInviteDeliveryOverride;
src/modules/subject/domain\guest-token.ts:18:export interface GuestTokenPointer extends EntityKey {
src/modules/subject/domain\guest-token.ts:19:  SK: "POINTER";
src/modules/subject/domain\guest-token.ts:20:  entityType: "GuestTokenPointer";
src/modules/subject/domain\guest-token.ts:21:  selectorHash: string;
src/modules/subject/domain\guest-token.ts:22:  secretHash: string;
src/modules/subject/domain\guest-token.ts:23:  tenantId: string;
src/modules/subject/domain\guest-token.ts:24:  subjectId: string;
src/modules/subject/domain\guest-token.ts:25:  assignmentId: string;
src/modules/subject/domain\guest-token.ts:26:  documentRequestId: string;
src/modules/subject/domain\guest-token.ts:27:  tokenVersion: number;
src/modules/subject/domain\guest-token.ts:28:  expiresAt: string;
src/modules/subject/domain\guest-token.ts:33:  purgeAfterTtl: number;
src/modules/subject/domain\guest-token.ts:34:  revokedAt?: string;
src/modules/subject/domain\guest-token.ts:35:  createdAt: string;
src/modules/subject/domain\guest-token.ts:36:  updatedAt: string;
src/modules/subject/domain\guest-token.ts:37:  version: number;
src/modules/subject/domain\guest-token.ts:51:export interface GuestTokenCrypto {
src/modules/subject/domain\guest-token.ts:61:export interface IssuedGuestToken {
src/modules/subject/domain\guest-token.ts:63:  token: string;
src/modules/subject/domain\guest-token.ts:64:  selector: string;
src/modules/subject/domain\guest-token.ts:65:  selectorHash: string;
src/modules/subject/domain\guest-token.ts:66:  secretHash: string;
src/modules/subject/domain\guest-token.ts:81:export interface ParsedGuestToken {
src/modules/subject/domain\guest-token.ts:82:  selector: string;
src/modules/subject/domain\guest-token.ts:83:  secret: string;
src/modules/subject/domain\entitlement.ts:22:export interface TenantEntitlement extends EntityKey {
src/modules/subject/domain\entitlement.ts:23:  SK: "PLAN";
src/modules/subject/domain\entitlement.ts:24:  entityType: "TenantEntitlement";
src/modules/subject/domain\entitlement.ts:25:  tenantId: string;
src/modules/subject/domain\entitlement.ts:26:  planId: string;
src/modules/subject/domain\entitlement.ts:27:  activeTrackedSubjectsLimit: number;
src/modules/subject/domain\entitlement.ts:28:  activeTrackedSubjectsCount: number;
src/modules/subject/domain\entitlement.ts:29:  createdAt: string;
src/modules/subject/domain\entitlement.ts:30:  updatedAt: string;
src/modules/subject/domain\entitlement.ts:31:  version: number;
src/modules/organization/domain\audit-event.ts:14:export type MembershipAuditAction =
src/modules/organization/domain\audit-event.ts:21:export type MembershipAuditResourceType = "Membership" | "Invitation";
src/modules/organization/domain\audit-event.ts:23:export interface MembershipAuditEvent extends EntityKey {
src/modules/organization/domain\audit-event.ts:24:  entityType: "MembershipAuditEvent";
src/modules/organization/domain\audit-event.ts:25:  auditEventId: string;
src/modules/organization/domain\audit-event.ts:26:  organizationId: string;
src/modules/organization/domain\audit-event.ts:27:  resourceType: MembershipAuditResourceType;
src/modules/organization/domain\audit-event.ts:28:  resourceId: string;
src/modules/organization/domain\audit-event.ts:29:  action: MembershipAuditAction;
src/modules/organization/domain\audit-event.ts:30:  actor: Actor;
src/modules/organization/domain\audit-event.ts:31:  previousVersion?: number;
src/modules/organization/domain\audit-event.ts:32:  newVersion: number;
src/modules/organization/domain\audit-event.ts:33:  changes: Record<string, unknown>;
src/modules/organization/domain\audit-event.ts:34:  occurredAt: string;
src/modules/organization/domain\audit-event.ts:35:  correlationId: string;
src/modules/organization/domain\audit-event.ts:38:  GSI8PK: string;
src/modules/organization/domain\audit-event.ts:39:  GSI8SK: string;
src/modules/organization/domain\audit-event.ts:54:export interface BuildMembershipAuditEventInput {
src/modules/organization/domain\audit-event.ts:55:  auditEventId: string;
src/modules/organization/domain\audit-event.ts:56:  organizationId: AuthorizedTenantId;
src/modules/organization/domain\audit-event.ts:57:  resourceType: MembershipAuditResourceType;
src/modules/organization/domain\audit-event.ts:58:  resourceId: string;
src/modules/organization/domain\audit-event.ts:59:  action: MembershipAuditAction;
src/modules/organization/domain\audit-event.ts:60:  actor: Actor;
src/modules/organization/domain\audit-event.ts:61:  previousVersion?: number;
src/modules/organization/domain\audit-event.ts:62:  newVersion: number;
src/modules/organization/domain\audit-event.ts:63:  changes: Record<string, unknown>;
src/modules/organization/domain\audit-event.ts:64:  occurredAt: string;
src/modules/organization/domain\audit-event.ts:65:  correlationId: string;
src/modules/subject/domain\submission-quarantine-key.ts:20:export interface ParsedSubmissionQuarantineKey {
src/modules/subject/domain\submission-quarantine-key.ts:21:  tenantId: string;
src/modules/subject/domain\submission-quarantine-key.ts:22:  subjectId: string;
src/modules/subject/domain\submission-quarantine-key.ts:23:  assignmentId: string;
src/modules/subject/domain\submission-quarantine-key.ts:24:  submissionId: string;
src/modules/subject/domain\submission-quarantine-key.ts:25:  documentId: string;
src/modules/subject/domain\submission-quarantine-key.ts:26:  uploadSlotId: string;
src/modules/organization/domain\invitation-token.ts:20:export interface InvitationTokenPointer extends EntityKey {
src/modules/organization/domain\invitation-token.ts:21:  SK: "POINTER";
src/modules/organization/domain\invitation-token.ts:22:  entityType: "InvitationTokenPointer";
src/modules/organization/domain\invitation-token.ts:23:  selectorHash: string;
src/modules/organization/domain\invitation-token.ts:24:  secretHash: string;
src/modules/organization/domain\invitation-token.ts:25:  organizationId: string;
src/modules/organization/domain\invitation-token.ts:26:  invitationId: string;
src/modules/organization/domain\invitation-token.ts:27:  expiresAt: string;
src/modules/organization/domain\invitation-token.ts:30:  purgeAfterTtl: number;
src/modules/organization/domain\invitation-token.ts:33:  consumedAt?: string;
src/modules/organization/domain\invitation-token.ts:34:  createdAt: string;
src/modules/organization/domain\invitation-token.ts:35:  updatedAt: string;
src/modules/organization/domain\invitation-token.ts:36:  version: number;
src/modules/organization/domain\invitation-token.ts:49:export interface InvitationTokenCrypto {
src/modules/organization/domain\invitation-token.ts:59:export interface IssuedInvitationToken {
src/modules/organization/domain\invitation-token.ts:61:  token: string;
src/modules/organization/domain\invitation-token.ts:62:  selector: string;
src/modules/organization/domain\invitation-token.ts:63:  selectorHash: string;
src/modules/organization/domain\invitation-token.ts:64:  secretHash: string;
src/modules/organization/domain\invitation-token.ts:80:export interface ParsedInvitationToken {
src/modules/organization/domain\invitation-token.ts:81:  selector: string;
src/modules/organization/domain\invitation-token.ts:82:  secret: string;
src/modules/organization/domain\invitation-token.ts:97:  pepper: string,
src/modules/organization/domain\invitation-token.ts:98:  secret: string,
src/modules/organization/domain\invitation-token.ts:99:  expectedSecretHash: string,
src/modules/organization/domain\invitation-token.ts:100:  crypto: InvitationTokenCrypto = hmacInvitationTokenCrypto,
src/modules/expiration/domain\item-watch.ts:11:export type ItemWatchStatus = "ACTIVE" | "REMOVED";
src/modules/expiration/domain\item-watch.ts:13:export interface ItemWatch extends EntityKey {
src/modules/expiration/domain\item-watch.ts:14:  entityType: "ItemWatch";
src/modules/expiration/domain\item-watch.ts:15:  itemId: string;
src/modules/expiration/domain\item-watch.ts:16:  tenantId: string;
src/modules/expiration/domain\item-watch.ts:17:  userId: string;
src/modules/expiration/domain\item-watch.ts:18:  status: ItemWatchStatus;
src/modules/expiration/domain\item-watch.ts:19:  createdAt: string;
src/modules/expiration/domain\item-watch.ts:20:  updatedAt: string;
src/modules/expiration/domain\item-watch.ts:21:  version: number;
src/modules/organization/domain\organization.ts:19:export interface Organization extends EntityKey {
src/modules/organization/domain\organization.ts:20:  SK: "META";
src/modules/organization/domain\organization.ts:21:  entityType: "Organization";
src/modules/organization/domain\organization.ts:22:  organizationId: string;
src/modules/organization/domain\organization.ts:23:  displayName: string;
src/modules/organization/domain\organization.ts:24:  timezone: string;
src/modules/organization/domain\organization.ts:25:  defaultQuietHours?: { start: string; end: string };
src/modules/organization/domain\organization.ts:26:  ownerCount: number;
src/modules/organization/domain\organization.ts:27:  createdAt: string;
src/modules/organization/domain\organization.ts:28:  updatedAt: string;
src/modules/organization/domain\organization.ts:29:  version: number;
src/modules/organization/domain\membership.ts:23:export type MembershipRole = "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";
src/modules/organization/domain\membership.ts:24:export type MembershipStatus = "ACTIVE" | "SUSPENDED" | "REMOVED";
src/modules/organization/domain\membership.ts:26:export interface Membership extends EntityKey {
src/modules/organization/domain\membership.ts:27:  SK: string; // MEMBER#<userId>
src/modules/organization/domain\membership.ts:28:  entityType: "Membership";
src/modules/organization/domain\membership.ts:29:  membershipId: string;
src/modules/organization/domain\membership.ts:30:  organizationId: string;
src/modules/organization/domain\membership.ts:31:  userId: string;
src/modules/organization/domain\membership.ts:32:  role: MembershipRole;
src/modules/organization/domain\membership.ts:33:  status: MembershipStatus;
src/modules/organization/domain\membership.ts:34:  joinedAt: string;
src/modules/organization/domain\membership.ts:35:  createdBy: string;
src/modules/organization/domain\membership.ts:40:  removedAt?: string;
src/modules/organization/domain\membership.ts:41:  version: number;
src/modules/organization/domain\membership.ts:42:  GSI4PK: string;
src/modules/organization/domain\membership.ts:43:  GSI4SK: string;
src/modules/organization/domain\membership.ts:50:  GSI8PK?: string;
src/modules/organization/domain\membership.ts:51:  GSI8SK?: string;
src/modules/organization/domain\membership.ts:57:  maintenanceAttemptCount?: number;
src/modules/organization/domain\membership.ts:84:export interface MaintenanceDue {
src/modules/organization/domain\membership.ts:85:  dueAtIso: string;
src/modules/expiration/domain\audit-event.ts:15:export type AuditAction = "CREATE" | "UPDATE" | "ARCHIVE" | "RENEW" | "DELETE";
src/modules/expiration/domain\audit-event.ts:17:export interface AuditEvent extends EntityKey {
src/modules/expiration/domain\audit-event.ts:18:  entityType: "AuditEvent";
src/modules/expiration/domain\audit-event.ts:19:  auditEventId: string;
src/modules/expiration/domain\audit-event.ts:20:  tenantId: string;
src/modules/expiration/domain\audit-event.ts:21:  resourceType: "ExpirationItem";
src/modules/expiration/domain\audit-event.ts:22:  resourceId: string;
src/modules/expiration/domain\audit-event.ts:23:  itemId: string;
src/modules/expiration/domain\audit-event.ts:24:  action: AuditAction;
src/modules/expiration/domain\audit-event.ts:25:  actor: Actor;
src/modules/expiration/domain\audit-event.ts:26:  previousVersion?: number;
src/modules/expiration/domain\audit-event.ts:27:  newVersion: number;
src/modules/expiration/domain\audit-event.ts:29:  changes: Record<string, unknown>;
src/modules/expiration/domain\audit-event.ts:30:  occurredAt: string;
src/modules/expiration/domain\audit-event.ts:31:  correlationId: string;
src/modules/expiration/domain\audit-event.ts:32:  causationId?: string;
src/modules/expiration/domain\audit-event.ts:35:  GSI8PK: string;
src/modules/expiration/domain\audit-event.ts:36:  GSI8SK: string;
src/modules/expiration/domain\audit-event.ts:50:export interface BuildAuditEventInput {
src/modules/expiration/domain\audit-event.ts:51:  auditEventId: string;
src/modules/expiration/domain\audit-event.ts:52:  tenantId: AuthorizedTenantId;
src/modules/expiration/domain\audit-event.ts:53:  itemId: string;
src/modules/expiration/domain\audit-event.ts:54:  action: AuditAction;
src/modules/expiration/domain\audit-event.ts:55:  actor: Actor;
src/modules/expiration/domain\audit-event.ts:56:  previousVersion?: number;
src/modules/expiration/domain\audit-event.ts:57:  newVersion: number;
src/modules/expiration/domain\audit-event.ts:59:  changes: Record<string, unknown>;
src/modules/expiration/domain\audit-event.ts:60:  occurredAt: string;
src/modules/expiration/domain\audit-event.ts:61:  correlationId: string;
src/modules/expiration/domain\audit-event.ts:62:  causationId?: string;
src/modules/document-archive/domain\document-archive-clean-key.ts:20:export interface ParsedDocumentArchiveCleanKey {
src/modules/document-archive/domain\document-archive-clean-key.ts:21:  tenantId: string;
src/modules/document-archive/domain\document-archive-clean-key.ts:22:  documentId: string;
src/modules/document-archive/domain\document-archive-clean-key.ts:23:  versionId: string;
src/modules/document-archive/domain\document-archive-clean-key.ts:24:  fileId: string;
src/modules/organization/domain\invitation.ts:14:export type InvitationStatus = "PENDING" | "ACCEPTED" | "REVOKED" | "EXPIRED";
src/modules/organization/domain\invitation.ts:16:export interface Invitation extends EntityKey {
src/modules/organization/domain\invitation.ts:17:  SK: string; // INVITATION#<invitationId>
src/modules/organization/domain\invitation.ts:18:  entityType: "Invitation";
src/modules/organization/domain\invitation.ts:19:  invitationId: string;
src/modules/organization/domain\invitation.ts:20:  organizationId: string;
src/modules/organization/domain\invitation.ts:21:  emailNormalized: string;
src/modules/organization/domain\invitation.ts:22:  role: MembershipRole;
src/modules/organization/domain\invitation.ts:23:  status: InvitationStatus;
src/modules/organization/domain\invitation.ts:24:  tokenPointerId: string;
src/modules/organization/domain\invitation.ts:25:  expiresAt: string;
src/modules/organization/domain\invitation.ts:26:  createdBy: string;
src/modules/organization/domain\invitation.ts:27:  createdAt: string;
src/modules/organization/domain\invitation.ts:28:  acceptedAt?: string;
src/modules/organization/domain\invitation.ts:29:  revokedAt?: string;
src/modules/organization/domain\invitation.ts:30:  version: number;
src/modules/organization/domain\invitation.ts:39:  GSI8PK?: string;
src/modules/organization/domain\invitation.ts:40:  GSI8SK?: string;
src/modules/organization/domain\invitation.ts:43:  maintenanceAttemptCount?: number;
src/modules/organization/domain\invitation.ts:54:export interface InvitationDedupPointer extends EntityKey {
src/modules/organization/domain\invitation.ts:55:  SK: string; // INVITE_DEDUP#<emailNormalized>
src/modules/organization/domain\invitation.ts:56:  entityType: "InvitationDedupPointer";
src/modules/organization/domain\invitation.ts:57:  invitationId: string;
src/modules/organization/domain\invitation.ts:58:  organizationId: string;
src/modules/organization/domain\invitation.ts:59:  emailNormalized: string;
src/modules/organization/domain\invitation.ts:60:  expiresAt: string;
src/modules/organization/domain\invitation.ts:78:export interface MaintenanceDue {
src/modules/organization/domain\invitation.ts:79:  dueAtIso: string;
src/modules/expiration/domain\expiration-item.ts:14:export type ExpirationItemStatus = "ACTIVE" | "ARCHIVED" | "RENEWED" | "DELETED";
src/modules/expiration/domain\expiration-item.ts:16:export interface ExpirationItem extends EntityKey {
src/modules/expiration/domain\expiration-item.ts:17:  SK: "META";
src/modules/expiration/domain\expiration-item.ts:18:  entityType: "ExpirationItem";
src/modules/expiration/domain\expiration-item.ts:19:  itemId: string;
src/modules/expiration/domain\expiration-item.ts:20:  tenantId: string;
src/modules/expiration/domain\expiration-item.ts:21:  name: string;
src/modules/expiration/domain\expiration-item.ts:22:  category: string;
src/modules/expiration/domain\expiration-item.ts:23:  categoryNormalized: string;
src/modules/expiration/domain\expiration-item.ts:24:  description?: string;
src/modules/expiration/domain\expiration-item.ts:25:  dueDate: string; // ISO-8601 date-time
src/modules/expiration/domain\expiration-item.ts:26:  issueDate?: string;
src/modules/expiration/domain\expiration-item.ts:27:  periodicity?: string;
src/modules/expiration/domain\expiration-item.ts:28:  issuer?: string;
src/modules/expiration/domain\expiration-item.ts:29:  number?: string;
src/modules/expiration/domain\expiration-item.ts:30:  assigneeUserId?: string;
src/modules/expiration/domain\expiration-item.ts:31:  tags: string[];
src/modules/expiration/domain\expiration-item.ts:32:  priority?: string;
src/modules/expiration/domain\expiration-item.ts:33:  status: ExpirationItemStatus;
src/modules/expiration/domain\expiration-item.ts:34:  renewedFromId?: string;
src/modules/expiration/domain\expiration-item.ts:35:  deletedAt?: string;
src/modules/expiration/domain\expiration-item.ts:36:  createdAt: string;
src/modules/expiration/domain\expiration-item.ts:37:  updatedAt: string;
src/modules/expiration/domain\expiration-item.ts:38:  version: number;
src/modules/expiration/domain\expiration-item.ts:39:  GSI1PK: string;
src/modules/expiration/domain\expiration-item.ts:40:  GSI1SK: string;
src/modules/expiration/domain\expiration-item.ts:68:export interface CreateItemInput {
src/modules/expiration/domain\expiration-item.ts:69:  name: string;
src/modules/expiration/domain\expiration-item.ts:70:  category: string;
src/modules/expiration/domain\expiration-item.ts:71:  description?: string;
src/modules/expiration/domain\expiration-item.ts:72:  dueDate: string;
src/modules/expiration/domain\expiration-item.ts:73:  issueDate?: string;
src/modules/expiration/domain\expiration-item.ts:74:  periodicity?: string;
src/modules/expiration/domain\expiration-item.ts:75:  issuer?: string;
src/modules/expiration/domain\expiration-item.ts:76:  number?: string;
src/modules/expiration/domain\expiration-item.ts:77:  assigneeUserId?: string;
src/modules/expiration/domain\expiration-item.ts:78:  tags?: string[];
src/modules/expiration/domain\expiration-item.ts:79:  priority?: string;
src/modules/expiration/domain\expiration-item.ts:83:export interface UpdateItemInput {
src/modules/expiration/domain\expiration-item.ts:84:  name?: string;
src/modules/expiration/domain\expiration-item.ts:85:  category?: string;
src/modules/expiration/domain\expiration-item.ts:86:  description?: string;
src/modules/expiration/domain\expiration-item.ts:87:  dueDate?: string;
src/modules/expiration/domain\expiration-item.ts:88:  issueDate?: string;
src/modules/expiration/domain\expiration-item.ts:89:  periodicity?: string;
src/modules/expiration/domain\expiration-item.ts:90:  issuer?: string;
src/modules/expiration/domain\expiration-item.ts:91:  number?: string;
src/modules/expiration/domain\expiration-item.ts:92:  assigneeUserId?: string;
src/modules/expiration/domain\expiration-item.ts:93:  tags?: string[];
src/modules/expiration/domain\expiration-item.ts:94:  priority?: string;
src/modules/expiration/domain\expiration-item.ts:109:export interface RenewItemInput {
src/modules/expiration/domain\expiration-item.ts:110:  newDueDate: string;
src/modules/expiration/domain\expiration-item.ts:112:  cycle?: string;
src/modules/document-archive/domain\document-archive-quarantine-key.ts:22:export interface ParsedDocumentArchiveQuarantineKey {
src/modules/document-archive/domain\document-archive-quarantine-key.ts:23:  tenantId: string;
src/modules/document-archive/domain\document-archive-quarantine-key.ts:24:  documentId: string;
src/modules/document-archive/domain\document-archive-quarantine-key.ts:25:  seq: number;
src/modules/document-archive/domain\document-archive-quarantine-key.ts:26:  fileId: string;
src/modules/document-archive/domain\document-file.ts:24:export type DocumentFileRole = "PRINCIPAL" | "ATTACHMENT";
src/modules/document-archive/domain\document-file.ts:26:export type DocumentFileScanStatus = "PENDING_UPLOAD" | "SCANNING" | "CLEAN" | "REJECTED" | "UNSUPPORTED" | "TIMEOUT";
src/modules/document-archive/domain\document-file.ts:36:export interface DocumentFile extends EntityKey {
src/modules/document-archive/domain\document-file.ts:37:  entityType: "DocumentFile";
src/modules/document-archive/domain\document-file.ts:38:  tenantId: string;
src/modules/document-archive/domain\document-file.ts:39:  documentId: string;
src/modules/document-archive/domain\document-file.ts:40:  versionId: string;
src/modules/document-archive/domain\document-file.ts:41:  seq: number;
src/modules/document-archive/domain\document-file.ts:42:  fileId: string;
src/modules/document-archive/domain\document-file.ts:43:  role: DocumentFileRole;
src/modules/document-archive/domain\document-file.ts:44:  scanStatus: DocumentFileScanStatus;
src/modules/document-archive/domain\document-file.ts:45:  mediaType: string;
src/modules/document-archive/domain\document-file.ts:46:  contentLength: number;
src/modules/document-archive/domain\document-file.ts:47:  checksumSha256: string;
src/modules/document-archive/domain\document-file.ts:48:  quarantineObject: DocumentObjectReference;
src/modules/document-archive/domain\document-file.ts:49:  cleanObject?: DocumentObjectReference;
src/modules/document-archive/domain\document-file.ts:50:  uploadEvidence?: UploadEvidence;
src/modules/document-archive/domain\document-file.ts:51:  malwareEvidence?: MalwareEvidence;
src/modules/document-archive/domain\document-file.ts:52:  createdAt: string;
src/modules/document-archive/domain\document-file.ts:53:  updatedAt: string;
src/modules/document-archive/domain\document-file.ts:54:  version: number;
src/modules/document-archive/domain\document-file.ts:63:  GSI8PK?: string;
src/modules/document-archive/domain\document-file.ts:64:  GSI8SK?: string;
src/modules/document-archive/domain\document-file.ts:84:export interface MaintenanceDue {
src/modules/document-archive/domain\document-file.ts:85:  dueAtIso: string;
src/modules/document-archive/domain\document-file.ts:116:export interface FileUploadSpec {
src/modules/document-archive/domain\document-file.ts:117:  role: DocumentFileRole;
src/modules/document-archive/domain\document-file.ts:118:  mediaType: string;
src/modules/document-archive/domain\document-file.ts:119:  contentLength: number;
src/modules/document-archive/domain\document-file.ts:120:  checksumSha256: string;
src/modules/document-archive/domain\document-file.ts:123:export class InvalidFileSetError extends Error {
src/modules/document-archive/domain\document-request.ts:30:export type DocumentRequestStatus = "REQUESTED" | "OPENED" | "SUBMITTED" | "COMPLETED" | "CANCELLED" | "EXPIRED" | "REVOKED";
src/modules/document-archive/domain\document-request.ts:32:export interface DocumentRequest extends EntityKey {
src/modules/document-archive/domain\document-request.ts:33:  SK: `DOCREQUEST#${string}`;
src/modules/document-archive/domain\document-request.ts:34:  entityType: "DocumentRequest";
src/modules/document-archive/domain\document-request.ts:35:  documentRequestId: string;
src/modules/document-archive/domain\document-request.ts:36:  tenantId: string;
src/modules/document-archive/domain\document-request.ts:37:  subjectId: string;
src/modules/document-archive/domain\document-request.ts:40:  requirementId: string;
src/modules/document-archive/domain\document-request.ts:41:  status: DocumentRequestStatus;
src/modules/document-archive/domain\document-request.ts:45:  deadline?: string;
src/modules/document-archive/domain\document-request.ts:46:  lastOpenedAt?: string;
src/modules/document-archive/domain\document-request.ts:47:  lastSubmissionId?: string;
src/modules/document-archive/domain\document-request.ts:48:  submissionCount: number;
src/modules/document-archive/domain\document-request.ts:51:  seriesId?: string;
src/modules/document-archive/domain\document-request.ts:55:  occurrenceId?: string;
src/modules/document-archive/domain\document-request.ts:63:  attemptIndex?: number;
src/modules/document-archive/domain\document-request.ts:67:  parentRequestId?: string;
src/modules/document-archive/domain\document-request.ts:78:  issuanceGeneration: number;
src/modules/document-archive/domain\document-request.ts:86:  activeCredentialSelectorHash?: string;
src/modules/document-archive/domain\document-request.ts:93:  lastRejection?: { versionId: string; reason: string; occurredAt: string };
src/modules/document-archive/domain\document-request.ts:109:  recipientEmail?: string;
src/modules/document-archive/domain\document-request.ts:110:  createdAt: string;
src/modules/document-archive/domain\document-request.ts:111:  updatedAt: string;
src/modules/document-archive/domain\document-request.ts:112:  version: number;
src/modules/document-archive/domain\document-request-series.ts:35:export type DocumentRequestSeriesStatus = "ACTIVE" | "CANCELLED";
src/modules/document-archive/domain\document-request-series.ts:37:export interface DocumentRequestSeriesCadence {
src/modules/document-archive/domain\document-request-series.ts:38:  intervalDays: number;
src/modules/document-archive/domain\document-request-series.ts:41:export interface DocumentRequestSeries extends EntityKey {
src/modules/document-archive/domain\document-request-series.ts:42:  entityType: "DocumentRequestSeries";
src/modules/document-archive/domain\document-request-series.ts:43:  seriesId: string;
src/modules/document-archive/domain\document-request-series.ts:44:  tenantId: string;
src/modules/document-archive/domain\document-request-series.ts:45:  subjectId: string;
src/modules/document-archive/domain\document-request-series.ts:46:  requirementId: string;
src/modules/document-archive/domain\document-request-series.ts:47:  cadence: DocumentRequestSeriesCadence;
src/modules/document-archive/domain\document-request-series.ts:48:  status: DocumentRequestSeriesStatus;
src/modules/document-archive/domain\document-request-series.ts:51:  currentCycleStartAt: string;
src/modules/document-archive/domain\document-request-series.ts:56:  nextDueAt: string;
src/modules/document-archive/domain\document-request-series.ts:60:  latestAttemptIndex: number;
src/modules/document-archive/domain\document-request-series.ts:64:  latestRequestId?: string;
src/modules/document-archive/domain\document-request-series.ts:82:  recipientEmail?: string;
src/modules/document-archive/domain\document-request-series.ts:83:  createdAt: string;
src/modules/document-archive/domain\document-request-series.ts:84:  updatedAt: string;
src/modules/document-archive/domain\document-request-series.ts:85:  version: number;
src/modules/document-archive/domain\document-request-series.ts:86:  GSI1PK: string;
src/modules/document-archive/domain\document-request-series.ts:87:  GSI1SK: string;
src/modules/document-archive/domain\document-request-series.ts:122:export interface CreateDocumentRequestSeriesInput {
src/modules/document-archive/domain\document-request-series.ts:123:  subjectId: string;
src/modules/document-archive/domain\document-request-series.ts:124:  requirementId: string;
src/modules/document-archive/domain\document-request-series.ts:125:  cadence: DocumentRequestSeriesCadence;
src/modules/document-archive/domain\document-request-series.ts:127:  firstDueAt?: string;
src/modules/document-archive/domain\document-request-series.ts:130:  recipientEmail?: string;
src/modules/document-archive/domain\document-type.ts:13:export type DocumentTypeStatus = "ACTIVE" | "DEPRECATED";
src/modules/document-archive/domain\document-type.ts:15:export interface DocumentType extends EntityKey {
src/modules/document-archive/domain\document-type.ts:16:  SK: "METADATA";
src/modules/document-archive/domain\document-type.ts:17:  entityType: "DocumentType";
src/modules/document-archive/domain\document-type.ts:18:  documentTypeId: string;
src/modules/document-archive/domain\document-type.ts:19:  tenantId: string;
src/modules/document-archive/domain\document-type.ts:22:  displayName: string;
src/modules/document-archive/domain\document-type.ts:23:  status: DocumentTypeStatus;
src/modules/document-archive/domain\document-type.ts:30:  metadataFields?: readonly DocumentTypeMetadataFieldDefinition[];
src/modules/document-archive/domain\document-type.ts:31:  createdAt: string;
src/modules/document-archive/domain\document-type.ts:32:  updatedAt: string;
src/modules/document-archive/domain\document-type.ts:33:  version: number;
src/modules/document-archive/domain\document-type.ts:34:  GSI1PK: string;
src/modules/document-archive/domain\document-type.ts:35:  GSI1SK: string;
src/modules/document-archive/domain\document-type.ts:44:export type DocumentTypeFieldValueType = "TEXT" | "NUMBER" | "DECIMAL" | "DATE" | "BOOLEAN" | "SINGLE_SELECT";
src/modules/document-archive/domain\document-type.ts:50:export type DocumentTypeFieldStatus = "ACTIVE" | "ARCHIVED";
src/modules/document-archive/domain\document-type.ts:54:export type DocumentTypeFieldOptionStatus = "ACTIVE" | "ARCHIVED";
src/modules/document-archive/domain\document-type.ts:68:export interface DocumentTypeFieldOption {
src/modules/document-archive/domain\document-type.ts:69:  optionId: string;
src/modules/document-archive/domain\document-type.ts:70:  label: string;
src/modules/document-archive/domain\document-type.ts:71:  status: DocumentTypeFieldOptionStatus;
src/modules/document-archive/domain\document-type.ts:80:export interface DocumentTypeMetadataFieldDefinition {
src/modules/document-archive/domain\document-type.ts:81:  fieldId: string;
src/modules/document-archive/domain\document-type.ts:82:  name: string;
src/modules/document-archive/domain\document-type.ts:83:  valueType: DocumentTypeFieldValueType;
src/modules/document-archive/domain\document-type.ts:87:  required: boolean;
src/modules/document-archive/domain\document-type.ts:89:  options?: readonly DocumentTypeFieldOption[];
src/modules/document-archive/domain\document-type.ts:90:  status: DocumentTypeFieldStatus;
src/modules/document-archive/domain\document-type.ts:91:  createdAt: string;
src/modules/document-archive/domain\document-type.ts:92:  updatedAt: string;
src/modules/document-archive/domain\document-type.ts:112:export interface DocumentTypeNamePointer extends EntityKey {
src/modules/document-archive/domain\document-type.ts:113:  SK: "POINTER";
src/modules/document-archive/domain\document-type.ts:114:  entityType: "DocumentTypeNamePointer";
src/modules/document-archive/domain\document-type.ts:115:  tenantId: string;
src/modules/document-archive/domain\document-type.ts:116:  normalizedName: string;
src/modules/document-archive/domain\document-type.ts:117:  documentTypeId: string;
src/modules/document-archive/domain\document-type.ts:118:  createdAt: string;
src/modules/document-archive/domain\document-type.ts:119:  updatedAt: string;
src/modules/document-archive/domain\document-type.ts:120:  version: number;
src/modules/document-archive/domain\document-type.ts:127:export interface CreateDocumentTypeInput {
src/modules/document-archive/domain\document-type.ts:128:  displayName: string;
src/modules/document-archive/domain\document-type.ts:135:export interface CreateDocumentTypeMetadataFieldInput {
src/modules/document-archive/domain\document-type.ts:136:  name: string;
src/modules/document-archive/domain\document-type.ts:137:  valueType: DocumentTypeFieldValueType;
src/modules/document-archive/domain\document-type.ts:138:  required: boolean;
src/modules/document-archive/domain\document-type.ts:139:  options?: readonly string[];
src/modules/document-archive/domain\document-type.ts:146:export interface UpdateDocumentTypeMetadataFieldInput {
src/modules/document-archive/domain\document-type.ts:147:  name?: string;
src/modules/document-archive/domain\document-type.ts:148:  required?: boolean;
src/modules/document-archive/domain\document-type.ts:149:  status?: DocumentTypeFieldStatus;
src/modules/document-archive/domain\document-type.ts:150:  optionsPatch?: readonly DocumentTypeFieldOptionPatchOp[];
src/modules/document-archive/domain\document-type.ts:153:export type DocumentTypeFieldOptionPatchOp =
src/modules/document-archive/domain\document-version-event.ts:19:export type DocumentVersionEventType = "RECEIVED" | "CLAIMED" | "CLAIM_EXPIRED" | "ACCEPTED" | "REJECTED" | "SUPERSEDED" | "WITHDRAWN" | "FILE_REJECTED_INFECTED";
src/modules/document-archive/domain\document-version-event.ts:21:export interface DocumentVersionEvent {
src/modules/document-archive/domain\document-version-event.ts:22:  PK: string;
src/modules/document-archive/domain\document-version-event.ts:23:  SK: string; // `VERSION#<seq>#EVENT#<ULID>` — AP10, chronological via ULID, distinct from the
src/modules/document-archive/domain\document-version-event.ts:25:  entityType: "DocumentVersionEvent";
src/modules/document-archive/domain\document-version-event.ts:26:  tenantId: string;
src/modules/document-archive/domain\document-version-event.ts:27:  documentId: string;
src/modules/document-archive/domain\document-version-event.ts:28:  versionId: string;
src/modules/document-archive/domain\document-version-event.ts:29:  type: DocumentVersionEventType;
src/modules/document-archive/domain\document-version-event.ts:30:  fromState?: DocumentVersionState;
src/modules/document-archive/domain\document-version-event.ts:31:  toState: DocumentVersionState;
src/modules/document-archive/domain\document-version-event.ts:32:  actor: string;
src/modules/document-archive/domain\document-version-event.ts:33:  occurredAt: string;
src/modules/document-archive/domain\document-version-event.ts:43:  fileId?: string;
src/modules/document-archive/domain\document-version-event.ts:44:  fromFileScanStatus?: DocumentFileScanStatus;
src/modules/document-archive/domain\document-version-event.ts:45:  toFileScanStatus?: DocumentFileScanStatus;
src/modules/document-archive/domain\document-version-event.ts:53:export interface IdempotencyRecord<TResult = unknown> {
src/modules/document-archive/domain\document-version-event.ts:54:  PK: string;
src/modules/document-archive/domain\document-version-event.ts:55:  SK: string; // `VERSION#<seq>#IDEMPOTENCY#<clientRequestToken>` — deliberately a different SK
src/modules/document-archive/domain\document-version-event.ts:58:  entityType: "IdempotencyRecord";
src/modules/document-archive/domain\document-version-event.ts:59:  tenantId: string;
src/modules/document-archive/domain\document-version-event.ts:60:  payloadHash: string;
src/modules/document-archive/domain\document-version-event.ts:61:  resultSnapshot: TResult;
src/modules/document-archive/domain\document-version-event.ts:62:  createdAt: string;
src/modules/document-archive/domain\document-version.ts:27:export type DocumentVersionState = "DRAFT" | "RECEIVED" | "UNDER_REVIEW" | "ACCEPTED" | "REJECTED" | "SUPERSEDED" | "WITHDRAWN";
src/modules/document-archive/domain\document-version.ts:30:export type RejectionReason = "EXPIRED" | "ILLEGIBLE" | "INCORRECT" | "WRONG_SUBJECT" | "OUTDATED_VERSION" | "INCOMPLETE" | "OTHER";
src/modules/document-archive/domain\document-version.ts:33:export type DocumentVersionOrigin = "MANUAL_UPLOAD" | "GUEST_UPLOAD" | "REQUEST_RESPONSE" | "IMPORT" | "AUTOMATED_CAPTURE";
src/modules/document-archive/domain\document-version.ts:35:export interface DocumentVersion extends EntityKey {
src/modules/document-archive/domain\document-version.ts:36:  entityType: "DocumentVersion";
src/modules/document-archive/domain\document-version.ts:37:  versionId: string;
src/modules/document-archive/domain\document-version.ts:38:  documentId: string;
src/modules/document-archive/domain\document-version.ts:39:  tenantId: string;
src/modules/document-archive/domain\document-version.ts:40:  seq: number;
src/modules/document-archive/domain\document-version.ts:41:  state: DocumentVersionState;
src/modules/document-archive/domain\document-version.ts:42:  origin: DocumentVersionOrigin;
src/modules/document-archive/domain\document-version.ts:43:  issuedAt?: string;
src/modules/document-archive/domain\document-version.ts:44:  validFrom?: string;
src/modules/document-archive/domain\document-version.ts:45:  validUntil?: string;
src/modules/document-archive/domain\document-version.ts:46:  receivedAt?: string;
src/modules/document-archive/domain\document-version.ts:47:  reviewerId?: string;
src/modules/document-archive/domain\document-version.ts:48:  decidedAt?: string;
src/modules/document-archive/domain\document-version.ts:49:  rejectionReason?: RejectionReason;
src/modules/document-archive/domain\document-version.ts:53:  pendingFileScans: number;
src/modules/document-archive/domain\document-version.ts:54:  infectedFileScans: number;
src/modules/document-archive/domain\document-version.ts:63:  fileSetSealed?: boolean;
src/modules/document-archive/domain\document-version.ts:64:  principalFileId?: string;
src/modules/document-archive/domain\document-version.ts:65:  totalFiles?: number;
src/modules/document-archive/domain\document-version.ts:66:  requestId?: string;
src/modules/document-archive/domain\document-version.ts:67:  createdAt: string;
src/modules/document-archive/domain\document-version.ts:68:  updatedAt: string;
src/modules/document-archive/domain\document-version.ts:69:  version: number;
src/modules/document-archive/domain\document-version.ts:73:  GSI5PK?: string;
src/modules/document-archive/domain\document-version.ts:74:  GSI5SK?: string;
src/modules/document-archive/domain\document-version.ts:90:  tenantId: AuthorizedTenantId,
src/modules/document-archive/domain\document-version.ts:91:  state: "RECEIVED" | "UNDER_REVIEW",
src/modules/document-archive/domain\document-version.ts:92:  orderingTimestamp: string,
src/modules/document-archive/domain\document-version.ts:93:  versionId: string,
src/modules/document-archive/domain\document-version.ts:108:  from: readonly DocumentVersionState[];
src/modules/document-archive/domain\document-version.ts:109:  to: DocumentVersionState;
src/modules/document-archive/domain\document-version.ts:122:export class InvalidDocumentVersionTransitionError extends Error {
src/modules/document-archive/domain\document.ts:14:export type DocumentStatus = "ACTIVE" | "ARCHIVED";
src/modules/document-archive/domain\document.ts:16:export interface Document extends EntityKey {
src/modules/document-archive/domain\document.ts:17:  SK: "METADATA";
src/modules/document-archive/domain\document.ts:18:  entityType: "Document";
src/modules/document-archive/domain\document.ts:19:  documentId: string;
src/modules/document-archive/domain\document.ts:20:  tenantId: string;
src/modules/document-archive/domain\document.ts:21:  subjectId: string;
src/modules/document-archive/domain\document.ts:22:  documentTypeId: string;
src/modules/document-archive/domain\document.ts:23:  status: DocumentStatus;
src/modules/document-archive/domain\document.ts:26:  hasValidity: boolean;
src/modules/document-archive/domain\document.ts:30:  currentVersionId?: string;
src/modules/document-archive/domain\document.ts:38:  metadataValues?: Readonly<Record<string, DocumentMetadataValue>>;
src/modules/document-archive/domain\document.ts:43:  activeExternalShareLinkCount?: number;
src/modules/document-archive/domain\document.ts:44:  createdAt: string;
src/modules/document-archive/domain\document.ts:45:  updatedAt: string;
src/modules/document-archive/domain\document.ts:46:  version: number;
src/modules/document-archive/domain\document.ts:47:  GSI1PK: string;
src/modules/document-archive/domain\document.ts:48:  GSI1SK: string;
src/modules/document-archive/domain\document.ts:49:  GSI2PK: string;
src/modules/document-archive/domain\document.ts:50:  GSI2SK: string;
src/modules/document-archive/domain\document.ts:61:export type DocumentMetadataValue =
src/modules/document-archive/domain\document.ts:89:export type DocumentMetadataValueInput =
src/modules/document-archive/domain\document.ts:170:export interface CreateDocumentInput {
src/modules/document-archive/domain\document.ts:171:  subjectId: string;
src/modules/document-archive/domain\document.ts:172:  documentTypeId: string;
src/modules/document-archive/domain\document.ts:173:  hasValidity: boolean;
src/modules/document-archive/domain\dossier-export-run.ts:38:export type DossierExportRunStatus =
src/modules/document-archive/domain\dossier-export-run.ts:46:export interface DossierExportRun extends EntityKey {
src/modules/document-archive/domain\dossier-export-run.ts:48:  entityType: "DossierExportRun";
src/modules/document-archive/domain\dossier-export-run.ts:49:  runId: string;
src/modules/document-archive/domain\dossier-export-run.ts:50:  subjectId: string;
src/modules/document-archive/domain\dossier-export-run.ts:51:  tenantId: string;
src/modules/document-archive/domain\dossier-export-run.ts:52:  status: DossierExportRunStatus;
src/modules/document-archive/domain\dossier-export-run.ts:55:  requirementIds: readonly string[];
src/modules/document-archive/domain\dossier-export-run.ts:56:  scopeHash: string;
src/modules/document-archive/domain\dossier-export-run.ts:57:  createdBy: string;
src/modules/document-archive/domain\dossier-export-run.ts:58:  version: number;
src/modules/document-archive/domain\dossier-export-run.ts:59:  createdAt: string;
src/modules/document-archive/domain\dossier-export-run.ts:60:  updatedAt: string;
src/modules/document-archive/domain\dossier-export-run.ts:61:  confirmedAt?: string;
src/modules/document-archive/domain\dossier-export-run.ts:63:  generatingLeaseExpiresAt?: string;
src/modules/document-archive/domain\dossier-export-run.ts:64:  generatedAt?: string;
src/modules/document-archive/domain\dossier-export-run.ts:65:  failureReason?: string;
src/modules/document-archive/domain\dossier-export-run.ts:68:  purgeAfterTtl: number;
src/modules/document-archive/domain\external-share-link.ts:22:export type ExternalShareLinkStatus = "ACTIVE" | "REVOKED"; // EXPIRED is never persisted — always derived from expiresAt.
src/modules/document-archive/domain\external-share-link.ts:35:export interface ExternalShareLink extends EntityKey {
src/modules/document-archive/domain\external-share-link.ts:36:  SK: `SHARE#${string}`;
src/modules/document-archive/domain\external-share-link.ts:37:  entityType: "ExternalShareLink";
src/modules/document-archive/domain\external-share-link.ts:38:  tenantId: string;
src/modules/document-archive/domain\external-share-link.ts:39:  documentId: string;
src/modules/document-archive/domain\external-share-link.ts:41:  documentTypeNameSnapshot: string;
src/modules/document-archive/domain\external-share-link.ts:42:  documentVersionId: string;
src/modules/document-archive/domain\external-share-link.ts:43:  documentFileId: string;
src/modules/document-archive/domain\external-share-link.ts:48:  documentFileSeq: number;
src/modules/document-archive/domain\external-share-link.ts:52:  documentIssuedDateSnapshot?: string;
src/modules/document-archive/domain\external-share-link.ts:53:  selectorHash: string;
src/modules/document-archive/domain\external-share-link.ts:54:  secretHash: string;
src/modules/document-archive/domain\external-share-link.ts:55:  status: ExternalShareLinkStatus;
src/modules/document-archive/domain\external-share-link.ts:56:  createdByUserId: string;
src/modules/document-archive/domain\external-share-link.ts:57:  expiresAt: string;
src/modules/document-archive/domain\external-share-link.ts:58:  purgeAfterTtl: number;
src/modules/document-archive/domain\external-share-link.ts:59:  revokedAt?: string;
src/modules/document-archive/domain\external-share-link.ts:62:  revokedByUserId?: string;
src/modules/document-archive/domain\external-share-link.ts:63:  createdAt: string;
src/modules/document-archive/domain\external-share-link.ts:64:  updatedAt: string;
src/modules/document-archive/domain\external-share-link.ts:65:  version: number;
src/modules/document-archive/domain\external-share-link.ts:66:  GSI1PK: string;
src/modules/document-archive/domain\external-share-link.ts:67:  GSI1SK: string;
src/modules/document-archive/domain\external-share-link.ts:79:  tenantId: AuthorizedTenantId,
src/modules/document-archive/domain\external-share-link.ts:80:  documentId: string,
src/modules/document-archive/domain\external-share-link.ts:81:  status: ExternalShareLinkStatus,
src/modules/document-archive/domain\external-share-link.ts:82:  createdAt: string,
src/modules/document-archive/domain\external-share-link.ts:83:  shareId: string,
src/modules/document-archive/domain\external-share-link.ts:100:export interface ExternalShareLinkPointer extends EntityKey {
src/modules/document-archive/domain\external-share-link.ts:101:  SK: "POINTER";
src/modules/document-archive/domain\external-share-link.ts:102:  entityType: "ExternalShareLinkPointer";
src/modules/document-archive/domain\external-share-link.ts:103:  tenantId: string;
src/modules/document-archive/domain\external-share-link.ts:104:  documentId: string;
src/modules/document-archive/domain\external-share-link.ts:105:  shareId: string;
src/modules/document-archive/domain\external-share-link.ts:106:  selectorHash: string;
src/modules/document-archive/domain\external-share-link.ts:107:  secretHash: string;
src/modules/document-archive/domain\external-share-link.ts:108:  purgeAfterTtl: number;
src/modules/document-archive/domain\external-share-link.ts:121:export interface ExternalShareLinkCrypto {
src/modules/document-archive/domain\external-share-link.ts:131:export interface IssuedExternalShareLinkToken {
src/modules/document-archive/domain\external-share-link.ts:134:  token: string;
src/modules/document-archive/domain\external-share-link.ts:135:  selector: string;
src/modules/document-archive/domain\external-share-link.ts:136:  selectorHash: string;
src/modules/document-archive/domain\external-share-link.ts:137:  secretHash: string;
src/modules/document-archive/domain\external-share-link.ts:152:export interface ParsedExternalShareLinkToken {
src/modules/document-archive/domain\external-share-link.ts:153:  selector: string;
src/modules/document-archive/domain\external-share-link.ts:154:  secret: string;
src/modules/document-archive/domain\external-share-link.ts:169:  pepper: string,
src/modules/document-archive/domain\external-share-link.ts:170:  secret: string,
src/modules/document-archive/domain\external-share-link.ts:171:  expectedSecretHash: string,
src/modules/document-archive/domain\external-share-link.ts:172:  crypto: ExternalShareLinkCrypto = hmacExternalShareLinkCrypto,
src/modules/document-archive/domain\requirement.ts:34:export type RequirementApplicability = "APPLICABLE" | "NOT_APPLICABLE";
src/modules/document-archive/domain\requirement.ts:38:export type RequirementStatus = "MISSING" | "PENDING" | "SATISFIED" | "NOT_SATISFIED" | "NOT_APPLICABLE";
src/modules/document-archive/domain\requirement.ts:40:export interface Requirement extends EntityKey {
src/modules/document-archive/domain\requirement.ts:41:  entityType: "Requirement";
src/modules/document-archive/domain\requirement.ts:42:  requirementId: string;
src/modules/document-archive/domain\requirement.ts:43:  tenantId: string;
src/modules/document-archive/domain\requirement.ts:44:  subjectId: string;
src/modules/document-archive/domain\requirement.ts:48:  name: string;
src/modules/document-archive/domain\requirement.ts:49:  notes?: string;
src/modules/document-archive/domain\requirement.ts:50:  applicability: RequirementApplicability;
src/modules/document-archive/domain\requirement.ts:60:  assigneeUserId?: string;
src/modules/document-archive/domain\requirement.ts:63:  evidenceVersionId?: string;
src/modules/document-archive/domain\requirement.ts:73:  evidenceDocumentId?: string;
src/modules/document-archive/domain\requirement.ts:77:  evidenceSeq?: number;
src/modules/document-archive/domain\requirement.ts:85:  evidenceState?: DocumentVersionState;
src/modules/document-archive/domain\requirement.ts:86:  evidenceValidUntil?: string;
src/modules/document-archive/domain\requirement.ts:87:  status: RequirementStatus;
src/modules/document-archive/domain\requirement.ts:94:  sourceTemplateId?: string;
src/modules/document-archive/domain\requirement.ts:95:  sourceTemplateItemId?: string;
src/modules/document-archive/domain\requirement.ts:96:  sourceTemplateAppliedVersion?: number;
src/modules/document-archive/domain\requirement.ts:97:  createdAt: string;
src/modules/document-archive/domain\requirement.ts:98:  updatedAt: string;
src/modules/document-archive/domain\requirement.ts:99:  version: number;
src/modules/document-archive/domain\requirement.ts:100:  GSI1PK: string;
src/modules/document-archive/domain\requirement.ts:101:  GSI1SK: string;
src/modules/document-archive/domain\requirement.ts:106:  GSI8PK?: string;
src/modules/document-archive/domain\requirement.ts:107:  GSI8SK?: string;
src/modules/document-archive/domain\requirement.ts:118:  GSI9PK?: string;
src/modules/document-archive/domain\requirement.ts:119:  GSI9SK?: string;
src/modules/document-archive/domain\requirement.ts:152:export interface CreateRequirementInput {
src/modules/document-archive/domain\requirement.ts:153:  subjectId: string;
src/modules/document-archive/domain\requirement.ts:154:  name: string;
src/modules/document-archive/domain\requirement.ts:155:  notes?: string;
src/modules/document-archive/domain\requirement.ts:156:  applicability: RequirementApplicability;
src/modules/document-archive/domain\requirement.ts:158:  assigneeUserId?: string;
src/modules/document-archive/domain\requirement.ts:164:export interface UpdateRequirementInput {
src/modules/document-archive/domain\requirement.ts:165:  name?: string;
src/modules/document-archive/domain\requirement.ts:166:  notes?: string;
src/modules/document-archive/domain\requirement.ts:167:  applicability?: RequirementApplicability;
src/modules/document-archive/domain\requirement.ts:171:  assigneeUserId?: string;
src/modules/document-archive/domain\requirement.ts:176:export interface EvidenceVersionForDerivation {
src/modules/document-archive/domain\requirement.ts:177:  state: DocumentVersionState;
src/modules/document-archive/domain\requirement.ts:178:  validUntil?: string;
src/modules/document-archive/domain\requirement.ts:200:  applicability: RequirementApplicability,
src/modules/document-archive/domain\requirement.ts:201:  evidenceVersion: EvidenceVersionForDerivation | undefined,
src/modules/document-archive/domain\requirement.ts:202:  now: Date,
src/modules/document-archive/domain\requirement.ts:241:  requirement: Pick<Requirement, "status" | "evidenceState" | "evidenceValidUntil">,
src/modules/document-archive/domain\requirement.ts:242:  now: Date,
src/modules/document-archive/domain\guest-session.ts:25:export interface GuestSession extends EntityKey {
src/modules/document-archive/domain\guest-session.ts:26:  SK: "POINTER";
src/modules/document-archive/domain\guest-session.ts:27:  entityType: "GuestSession";
src/modules/document-archive/domain\guest-session.ts:28:  selectorHash: string;
src/modules/document-archive/domain\guest-session.ts:29:  secretHash: string;
src/modules/document-archive/domain\guest-session.ts:30:  tenantId: string;
src/modules/document-archive/domain\guest-session.ts:31:  subjectId: string;
src/modules/document-archive/domain\guest-session.ts:32:  requirementId: string;
src/modules/document-archive/domain\guest-session.ts:33:  documentRequestId: string;
src/modules/document-archive/domain\guest-session.ts:36:  credentialSelectorHash: string;
src/modules/document-archive/domain\guest-session.ts:37:  csrfTokenHash: string;
src/modules/document-archive/domain\guest-session.ts:38:  expiresAt: string;
src/modules/document-archive/domain\guest-session.ts:39:  purgeAfterTtl: number;
src/modules/document-archive/domain\guest-session.ts:40:  createdAt: string;
src/modules/document-archive/domain\guest-session.ts:41:  updatedAt: string;
src/modules/document-archive/domain\guest-session.ts:42:  version: number;
src/modules/document-archive/domain\guest-session.ts:49:export interface GuestSessionCrypto {
src/modules/document-archive/domain\guest-session.ts:59:export interface IssuedGuestSession {
src/modules/document-archive/domain\guest-session.ts:60:  token: string;
src/modules/document-archive/domain\guest-session.ts:61:  selector: string;
src/modules/document-archive/domain\guest-session.ts:62:  selectorHash: string;
src/modules/document-archive/domain\guest-session.ts:63:  secretHash: string;
src/modules/document-archive/domain\guest-session.ts:64:  csrfToken: string;
src/modules/document-archive/domain\guest-session.ts:65:  csrfTokenHash: string;
src/modules/document-archive/domain\guest-session.ts:82:export interface ParsedGuestSessionToken {
src/modules/document-archive/domain\guest-session.ts:83:  selector: string;
src/modules/document-archive/domain\guest-session.ts:84:  secret: string;
src/modules/document-archive/domain\guest-credential-delivery.ts:21:export interface GuestCredentialDeliveryRecord extends EntityKey {
src/modules/document-archive/domain\guest-credential-delivery.ts:22:  SK: "DELIVERY";
src/modules/document-archive/domain\guest-credential-delivery.ts:23:  entityType: "GuestCredentialDelivery";
src/modules/document-archive/domain\guest-credential-delivery.ts:24:  tenantId: string;
src/modules/document-archive/domain\guest-credential-delivery.ts:25:  subjectId: string;
src/modules/document-archive/domain\guest-credential-delivery.ts:26:  documentRequestId: string;
src/modules/document-archive/domain\guest-credential-delivery.ts:27:  requirementId: string;
src/modules/document-archive/domain\guest-credential-delivery.ts:28:  issuanceGeneration: number;
src/modules/document-archive/domain\guest-credential-delivery.ts:31:  token: string;
src/modules/document-archive/domain\guest-credential-delivery.ts:32:  selectorHash: string;
src/modules/document-archive/domain\guest-credential-delivery.ts:33:  expiresAt: string;
src/modules/document-archive/domain\guest-credential-delivery.ts:36:  purgeAfterTtl: number;
src/modules/document-archive/domain\guest-credential-delivery.ts:37:  createdAt: string;
src/modules/document-archive/domain\request-access-credential.ts:30:export interface RequestAccessCredential extends EntityKey {
src/modules/document-archive/domain\request-access-credential.ts:31:  SK: "POINTER";
src/modules/document-archive/domain\request-access-credential.ts:32:  entityType: "RequestAccessCredential";
src/modules/document-archive/domain\request-access-credential.ts:33:  selectorHash: string;
src/modules/document-archive/domain\request-access-credential.ts:34:  secretHash: string;
src/modules/document-archive/domain\request-access-credential.ts:35:  tenantId: string;
src/modules/document-archive/domain\request-access-credential.ts:36:  subjectId: string;
src/modules/document-archive/domain\request-access-credential.ts:37:  requirementId: string;
src/modules/document-archive/domain\request-access-credential.ts:38:  documentRequestId: string;
src/modules/document-archive/domain\request-access-credential.ts:39:  tokenVersion: number;
src/modules/document-archive/domain\request-access-credential.ts:40:  expiresAt: string;
src/modules/document-archive/domain\request-access-credential.ts:44:  purgeAfterTtl: number;
src/modules/document-archive/domain\request-access-credential.ts:45:  revokedAt?: string;
src/modules/document-archive/domain\request-access-credential.ts:46:  createdAt: string;
src/modules/document-archive/domain\request-access-credential.ts:47:  updatedAt: string;
src/modules/document-archive/domain\request-access-credential.ts:48:  version: number;
src/modules/document-archive/domain\request-access-credential.ts:61:export interface RequestAccessCrypto {
src/modules/document-archive/domain\request-access-credential.ts:71:export interface IssuedRequestAccessCredential {
src/modules/document-archive/domain\request-access-credential.ts:74:  token: string;
src/modules/document-archive/domain\request-access-credential.ts:75:  selector: string;
src/modules/document-archive/domain\request-access-credential.ts:76:  selectorHash: string;
src/modules/document-archive/domain\request-access-credential.ts:77:  secretHash: string;
src/modules/document-archive/domain\request-access-credential.ts:93:export interface ParsedRequestAccessToken {
src/modules/document-archive/domain\request-access-credential.ts:94:  selector: string;
src/modules/document-archive/domain\request-access-credential.ts:95:  secret: string;
src/modules/document-archive/domain\requirement-template.ts:25:export type RequirementTemplateStatus = "ACTIVE" | "ARCHIVED";
src/modules/document-archive/domain\requirement-template.ts:47:export interface RequirementTemplateItem {
src/modules/document-archive/domain\requirement-template.ts:50:  templateItemId: string;
src/modules/document-archive/domain\requirement-template.ts:51:  name: string;
src/modules/document-archive/domain\requirement-template.ts:52:  notes?: string;
src/modules/document-archive/domain\requirement-template.ts:53:  applicability: RequirementApplicability;
src/modules/document-archive/domain\requirement-template.ts:54:  position: number;
src/modules/document-archive/domain\requirement-template.ts:57:export interface RequirementTemplate extends EntityKey {
src/modules/document-archive/domain\requirement-template.ts:58:  SK: "METADATA";
src/modules/document-archive/domain\requirement-template.ts:59:  entityType: "RequirementTemplate";
src/modules/document-archive/domain\requirement-template.ts:60:  templateId: string;
src/modules/document-archive/domain\requirement-template.ts:61:  tenantId: string;
src/modules/document-archive/domain\requirement-template.ts:63:  displayName: string;
src/modules/document-archive/domain\requirement-template.ts:64:  description?: string;
src/modules/document-archive/domain\requirement-template.ts:65:  status: RequirementTemplateStatus;
src/modules/document-archive/domain\requirement-template.ts:66:  items: RequirementTemplateItem[];
src/modules/document-archive/domain\requirement-template.ts:67:  createdAt: string;
src/modules/document-archive/domain\requirement-template.ts:68:  updatedAt: string;
src/modules/document-archive/domain\requirement-template.ts:69:  version: number;
src/modules/document-archive/domain\requirement-template.ts:70:  GSI1PK: string;
src/modules/document-archive/domain\requirement-template.ts:71:  GSI1SK: string;
src/modules/document-archive/domain\requirement-template.ts:82:  tenantId: AuthorizedTenantId,
src/modules/document-archive/domain\requirement-template.ts:83:  status: RequirementTemplateStatus,
src/modules/document-archive/domain\requirement-template.ts:84:  normalizedName: string,
src/modules/document-archive/domain\requirement-template.ts:85:  templateId: string,
src/modules/document-archive/domain\requirement-template.ts:95:export interface RequirementTemplateNamePointer extends EntityKey {
src/modules/document-archive/domain\requirement-template.ts:96:  SK: "POINTER";
src/modules/document-archive/domain\requirement-template.ts:97:  entityType: "RequirementTemplateNamePointer";
src/modules/document-archive/domain\requirement-template.ts:98:  tenantId: string;
src/modules/document-archive/domain\requirement-template.ts:99:  normalizedName: string;
src/modules/document-archive/domain\requirement-template.ts:100:  templateId: string;
src/modules/document-archive/domain\requirement-template.ts:101:  createdAt: string;
src/modules/document-archive/domain\requirement-template.ts:102:  updatedAt: string;
src/modules/document-archive/domain\requirement-template.ts:103:  version: number;
src/modules/document-archive/domain\requirement-template.ts:123:export interface RequirementNamePointer extends EntityKey {
src/modules/document-archive/domain\requirement-template.ts:124:  SK: "POINTER";
src/modules/document-archive/domain\requirement-template.ts:125:  entityType: "RequirementNamePointer";
src/modules/document-archive/domain\requirement-template.ts:126:  tenantId: string;
src/modules/document-archive/domain\requirement-template.ts:127:  subjectId: string;
src/modules/document-archive/domain\requirement-template.ts:128:  normalizedName: string;
src/modules/document-archive/domain\requirement-template.ts:129:  requirementId: string;
src/modules/document-archive/domain\requirement-template.ts:130:  createdAt: string;
src/modules/document-archive/domain\requirement-template.ts:131:  updatedAt: string;
src/modules/document-archive/domain\requirement-template.ts:132:  version: number;
src/modules/document-archive/domain\requirement-template.ts:157:export interface CreateRequirementTemplateInput {
src/modules/document-archive/domain\requirement-template.ts:158:  displayName: string;
src/modules/document-archive/domain\requirement-template.ts:159:  description?: string;
src/modules/document-archive/domain\requirement-template.ts:160:  items: Array<{ name: string; notes?: string; applicability?: RequirementApplicability }>;
src/modules/document-archive/domain\requirement-template.ts:163:export interface UpdateRequirementTemplateInput {
src/modules/document-archive/domain\requirement-template.ts:164:  displayName?: string;
src/modules/document-archive/domain\requirement-template.ts:165:  description?: string;
src/modules/document-archive/domain\requirement-template.ts:166:  items?: Array<{ name: string; notes?: string; applicability?: RequirementApplicability }>;
src/modules/document-archive/domain\requirement-template.ts:205:export interface ExistingRequirementForPlan {
src/modules/document-archive/domain\requirement-template.ts:206:  requirementId: string;
src/modules/document-archive/domain\requirement-template.ts:207:  name: string;
src/modules/document-archive/domain\requirement-template.ts:208:  sourceTemplateItemId?: string;
src/modules/document-archive/domain\requirement-template.ts:211:export type TemplateApplicationSkipReason = "DUPLICATE_NAME";
src/modules/document-archive/domain\requirement-template.ts:213:export interface TemplateApplicationPlan {
src/modules/document-archive/domain\requirement-template.ts:214:  create: RequirementTemplateItem[];
src/modules/document-archive/domain\requirement-template.ts:215:  skip: Array<{
src/modules/document-archive/domain\requirement-template.ts:242:  items: ReadonlyArray<RequirementTemplateItem>,
src/modules/document-archive/domain\requirement-template.ts:243:  existing: ReadonlyArray<ExistingRequirementForPlan>,

exec
"C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -Command 'Get-Content -Raw src/modules/document-archive/domain/document.ts; Get-Content -Raw src/modules/document-archive/domain/document-version.ts; Get-Content -Raw src/modules/document-archive/domain/document-type.ts; Get-Content -Raw src/modules/document-archive/domain/document-request.ts; Get-Content -Raw src/modules/document-archive/domain/document-request-series.ts; Get-Content -Raw src/modules/subject/domain/tracked-subject.ts; Get-Content -Raw src/modules/subject/domain/requirement-assignment.ts; Get-Content -Raw src/modules/subject/domain/document-request.ts; Get-Content -Raw src/modules/expiration/domain/expiration-item.ts; Get-Content -Raw src/modules/organization/domain/organization.ts; Get-Content -Raw src/modules/organization/domain/membership.ts; Get-Content -Raw src/modules/organization/domain/invitation.ts' in C:\Users\Usuario\Desktop\projects\expiration-tracker
 succeeded in 471ms:
/**
 * Document â€” D-143 (`docs/architecture/reviews/document-domain-scoping/estado-final-consolidado.md`
 * DecisÃ£o 1/2). A durable logical entity (D1, `document-domain-functional-decisions.md`) â€”
 * `Document.status` only ever flips ACTIVE/ARCHIVED and never encodes validity or review state
 * (those live on `DocumentVersion`/`Requirement`). Archiving is safe by construction: Requirement
 * status derivation (Decision 5) reads from `DocumentVersion`, never from `Document.status`, so
 * archiving a Document can never silently change whether it satisfies a Requirement (closes
 * adversarial case A10 from `document-domain-wireframes-validation-plan.md`).
 */
import type { EntityKey } from "../../../shared/dynamodb/occ.js";
import type { AuthorizedTenantId } from "../../identity/domain/authorization.js";
import type { DocumentTypeFieldValueType } from "./document-type.js";

export type DocumentStatus = "ACTIVE" | "ARCHIVED";

export interface Document extends EntityKey {
  SK: "METADATA";
  entityType: "Document";
  documentId: string;
  tenantId: string;
  subjectId: string;
  documentTypeId: string;
  status: DocumentStatus;
  /** D3: documents without an expiration date are a legitimate first-class case, never
   * forced to carry a fabricated validity. */
  hasValidity: boolean;
  /** Denormalized pointer to the single ACCEPTED version, updated transactionally in the
   * same TransactWriteItems that flips the previous current version to SUPERSEDED (Decision 2's
   * `acceptVersion` transaction) â€” never a second, separately-committed write. */
  currentVersionId?: string;
  /** D-218 fatia 2 (Roadmap P1 "metadata configurÃ¡vel por Document Type") â€” see
   * `docs/architecture/reviews/document-type-metadata-scoping/estado-final-consolidado.md`
   * Decision 2. Keyed by `fieldId` (never the field's renamable `name`), same identity-not-label
   * discipline as `documentTypeId` vs. `displayName`. `createDocument()` NEVER accepts nor
   * writes this â€” every Document starts with the key entirely ABSENT (sparse, not an empty
   * object), regardless of how many `required` fields the DocumentType declares (Decision 5) â€”
   * the only writer is `updateDocumentMetadataValues()` (`document-archive-service.ts`). */
  metadataValues?: Readonly<Record<string, DocumentMetadataValue>>;
  /** D-225 Decision 1 â€” sparse, atomic cap counter for `ExternalShareLink` (max
   * `MAX_ACTIVE_SHARE_LINKS_PER_DOCUMENT`). Every writer uses `if_not_exists(...,0)` and never
   * allows underflow (`external-share-link-service.ts` is the sole writer, always inside the
   * SAME `TransactWriteItems` as the link Put/Update it accompanies). */
  activeExternalShareLinkCount?: number;
  createdAt: string;
  updatedAt: string;
  version: number;
  GSI1PK: string;
  GSI1SK: string;
  GSI2PK: string;
  GSI2SK: string;
}

/** D-218 Decision 2 â€” one value of `Document.metadataValues`, discriminated by `valueType` so
 * the compiler enforces `value`'s shape matches the type declared, never a mismatched pair
 * constructed by accident. `valueType` is copied from the `DocumentTypeMetadataFieldDefinition`
 * AT WRITE TIME (immutable there too, Decision 3) â€” this value is self-describing and never
 * needs to re-read the current field definition to know how to interpret itself, even if that
 * definition is later archived (checklist criterion 2). `documentTypeVersionAtWrite` is
 * TRACEABILITY ONLY (which `DocumentType.version` was in effect when this was written) â€” never
 * the source of correctness, which comes from `valueType` immutability + `optionId` stability. */
export type DocumentMetadataValue =
  | { valueType: "TEXT"; value: string; documentTypeVersionAtWrite: number; updatedAt: string; updatedBy: string }
  | { valueType: "NUMBER"; value: number; documentTypeVersionAtWrite: number; updatedAt: string; updatedBy: string }
  | { valueType: "DECIMAL"; value: string; documentTypeVersionAtWrite: number; updatedAt: string; updatedBy: string }
  | { valueType: "DATE"; value: string; documentTypeVersionAtWrite: number; updatedAt: string; updatedBy: string }
  | { valueType: "BOOLEAN"; value: boolean; documentTypeVersionAtWrite: number; updatedAt: string; updatedBy: string }
  | { valueType: "SINGLE_SELECT"; optionId: string; labelSnapshot: string; documentTypeVersionAtWrite: number; updatedAt: string; updatedBy: string };

/** Compile-time proof (same "independently-maintained, bidirectional `extends`" idiom as
 * `test/architecture/system-mutation-allowlist.test.ts`) that `DocumentMetadataValue`'s
 * `valueType` variants stay exactly in sync with `DocumentTypeFieldValueType` (`document-type.ts`)
 * â€” the two taxonomies are declared independently (one describes a field DEFINITION, the other
 * a stored VALUE) but must never silently drift apart. */
type AssertValueTypesMatchFieldTypes = DocumentMetadataValue["valueType"] extends DocumentTypeFieldValueType
  ? DocumentTypeFieldValueType extends DocumentMetadataValue["valueType"]
    ? true
    : ["FAIL: DocumentTypeFieldValueType has a member DocumentMetadataValue's valueType union is missing"]
  : ["FAIL: DocumentMetadataValue's valueType union has a member not in DocumentTypeFieldValueType"];
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- compile-time-only proof, never read at runtime.
const _assertValueTypesMatch: AssertValueTypesMatchFieldTypes = true;

/** D-218 Decision 2/5 â€” input for one field of `PATCH .../metadata-values`. `null` clears the
 * field entirely (removes the `fieldId` key from `Document.metadataValues`); a field simply
 * ABSENT from the input record means "do not touch" (true partial update) â€” these are two
 * distinct operations, never conflated (see `updateDocumentMetadataValues`'s doc comment). The
 * raw value shape mirrors `DocumentMetadataValue` minus the server-computed provenance fields
 * (`documentTypeVersionAtWrite`/`updatedAt`/`updatedBy`) and minus `labelSnapshot` (derived
 * server-side from the option's current `label`, never accepted from the caller). */
export type DocumentMetadataValueInput =
  | { valueType: "TEXT"; value: string }
  | { valueType: "NUMBER"; value: number }
  | { valueType: "DECIMAL"; value: string }
  | { valueType: "DATE"; value: string }
  | { valueType: "BOOLEAN"; value: boolean }
  | { valueType: "SINGLE_SELECT"; optionId: string }
  | null;

export const MAX_METADATA_TEXT_VALUE_CHARS = 500;
export const MAX_METADATA_DECIMAL_INTEGER_DIGITS = 15;
export const MAX_METADATA_DECIMAL_FRACTION_DIGITS = 4;
export const MAX_METADATA_NUMBER_ABS_VALUE = 1_000_000_000_000;
const DECIMAL_PATTERN = new RegExp(`^-?\\d{1,${MAX_METADATA_DECIMAL_INTEGER_DIGITS}}(\\.\\d{1,${MAX_METADATA_DECIMAL_FRACTION_DIGITS}})?$`);
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** D-218 Decision 8 â€” the closed storage-representation rules for each `DocumentTypeFieldValueType`,
 * shared by whatever validates a raw `DocumentMetadataValueInput` before it is written (this
 * module owns the RULE, `document-archive-service.ts` owns the transactional WRITE). Returns a
 * human-readable reason string when invalid, `undefined` when the value is well-formed for its
 * declared type â€” deliberately never throws, so callers can attach their own error type/details. */
export function describeMetadataValueFormatError(input: Exclude<DocumentMetadataValueInput, null>): string | undefined {
  switch (input.valueType) {
    case "TEXT":
      if (input.value.length > MAX_METADATA_TEXT_VALUE_CHARS) return `TEXT value exceeds ${MAX_METADATA_TEXT_VALUE_CHARS} characters.`;
      return undefined;
    case "NUMBER":
      if (!Number.isInteger(input.value)) return "NUMBER value must be an integer (never money â€” use DECIMAL for that).";
      if (Math.abs(input.value) > MAX_METADATA_NUMBER_ABS_VALUE) return `NUMBER value exceeds the allowed magnitude of ${MAX_METADATA_NUMBER_ABS_VALUE}.`;
      return undefined;
    case "DECIMAL":
      if (!DECIMAL_PATTERN.test(input.value)) return "DECIMAL value must be a normalized decimal string (e.g. \"1234.56\"), never a float literal.";
      return undefined;
    case "DATE":
      if (!DATE_PATTERN.test(input.value) || !isValidCalendarDate(input.value)) return "DATE value must be a real calendar date in YYYY-MM-DD format (civil date, no time/timezone).";
      return undefined;
    case "BOOLEAN":
      return undefined;
    case "SINGLE_SELECT":
      if (input.optionId.trim().length === 0) return "SINGLE_SELECT value must carry a non-empty optionId.";
      return undefined;
  }
}

/** `Date.parse`/`new Date(...)` silently normalizes an out-of-range day/month (e.g.
 * "2026-02-30" becomes March 2nd) instead of rejecting it â€” this reconstructs the ISO string
 * from the parsed components and compares, the same "does it round-trip" idiom used elsewhere
 * in the codebase for civil-date validation, never a second bespoke calendar implementation. */
function isValidCalendarDate(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return false;
  return parsed.toISOString().slice(0, 10) === value;
}

export function documentKey(tenantId: AuthorizedTenantId, documentId: string): { PK: string; SK: "METADATA" } {
  return { PK: `TENANT#${tenantId}#DOCUMENT#${documentId}`, SK: "METADATA" };
}

/** GSI1 (discriminated by prefix â€” same GSI1 index physically shared with ExpirationItem's
 * ITEMSTATUS/Requirement's REQSTATUS namespaces, never a new index): Documents by
 * Organization+status, ordered by most-recently-updated (AP4) â€” not by Subject, which is a
 * separate access pattern (AP3, GSI2). */
export function documentGsi1Keys(tenantId: AuthorizedTenantId, status: DocumentStatus, updatedAt: string, documentId: string): { GSI1PK: string; GSI1SK: string } {
  return {
    GSI1PK: `TENANT#${tenantId}#DOCSTATUS#${status}`,
    GSI1SK: `UPDATED#${updatedAt}#DOCUMENT#${documentId}`,
  };
}

/** GSI2 (new index, AP3 â€” verified free of any existing writer in the codebase before this
 * module claimed it, see D-143 Decision 2/round2-codex-critique.md's corrected finding):
 * Documents by Subject, grouped by DocumentType (D-173 Â§5: keyed by the stable
 * documentTypeId, not the renamable displayName â€” renaming a DocumentType must never move
 * where an existing Document sits in this index). */
export function documentGsi2Keys(tenantId: AuthorizedTenantId, subjectId: string, documentTypeId: string, documentId: string): { GSI2PK: string; GSI2SK: string } {
  return {
    GSI2PK: `TENANT#${tenantId}#SUBJECT#${subjectId}#DOC`,
    GSI2SK: `DOCTYPE#${documentTypeId}#DOCUMENT#${documentId}`,
  };
}

export interface CreateDocumentInput {
  subjectId: string;
  documentTypeId: string;
  hasValidity: boolean;
}

/**
 * DocumentVersion â€” D-143 Decision 1 (state machine) + Decision 6 (file lifecycle).
 * `DocumentVersion.state` is the SOLE mutable source of truth (Decision 3) â€” the append-only
 * `DocumentVersionEvent` log (`document-version-event.ts`) records every transition but never
 * competes with this field for authority.
 *
 * Graph (estado-final-consolidado.md Decision 1):
 *   (none)      -[reserveUpload]->        DRAFT
 *   DRAFT       -[commitUpload]->         RECEIVED
 *   DRAFT       -[abandonUpload]->        WITHDRAWN
 *   RECEIVED    -[claimReview]->          UNDER_REVIEW
 *   RECEIVED | UNDER_REVIEW -[acceptVersion]-> ACCEPTED
 *   RECEIVED | UNDER_REVIEW -[rejectVersion]-> REJECTED
 *   ACCEPTED    -[superseded by another version's acceptVersion]-> SUPERSEDED
 *   UNDER_REVIEW -[claim TTL sweeper]->    RECEIVED
 *
 * REJECTED is a terminal state that is NEVER removable (D-143 Decision 7 â€” a Rodada 1 proposal
 * that allowed removing REJECTED versions was rejected for directly contradicting J9's
 * "the rejected file stays in history" requirement). Only DRAFT can ever be physically removed
 * (via WITHDRAWN, before it ever became evidence).
 */
import type { EntityKey } from "../../../shared/dynamodb/occ.js";
import type { AuthorizedTenantId } from "../../identity/domain/authorization.js";
import type { UnifiedValidityState } from "../../../shared/domain/validity-state.js";
import { deriveValidityStateFromExpiry } from "../../../shared/domain/validity-state.js";

export type DocumentVersionState = "DRAFT" | "RECEIVED" | "UNDER_REVIEW" | "ACCEPTED" | "REJECTED" | "SUPERSEDED" | "WITHDRAWN";

/** Closed taxonomy, `document-domain-functional-specification-v0.1.md` Â§12. */
export type RejectionReason = "EXPIRED" | "ILLEGIBLE" | "INCORRECT" | "WRONG_SUBJECT" | "OUTDATED_VERSION" | "INCOMPLETE" | "OTHER";

/** Origin taxonomy, spec Â§13. */
export type DocumentVersionOrigin = "MANUAL_UPLOAD" | "GUEST_UPLOAD" | "REQUEST_RESPONSE" | "IMPORT" | "AUTOMATED_CAPTURE";

export interface DocumentVersion extends EntityKey {
  entityType: "DocumentVersion";
  versionId: string;
  documentId: string;
  tenantId: string;
  seq: number;
  state: DocumentVersionState;
  origin: DocumentVersionOrigin;
  issuedAt?: string;
  validFrom?: string;
  validUntil?: string;
  receivedAt?: string;
  reviewerId?: string;
  decidedAt?: string;
  rejectionReason?: RejectionReason;
  /** Decision 6/Bloqueador 9: two independent counters gate `acceptVersion` â€” `pendingFileScans=0`
   * alone is NOT sufficient (a version with zero pending and one INFECTED file must never be
   * accepted), both must be zero. */
  pendingFileScans: number;
  infectedFileScans: number;
  /** D-163 Â§2: set atomically by `reserveFiles()`'s single `TransactWriteItems`, together with
   * `principalFileId`/`totalFiles`/`pendingFileScans` â€” never by a separate write. Fences two
   * concurrent `reserveFiles()` calls against the same Version: the second one's Update
   * condition (`fileSetSealed` absent or `false`) fails, closing the race a Rodada 1 proposal
   * tried to close with input validation alone (D-163 Â§2, achado real da Rodada 1). Once
   * `true`, no further file reservation against this Version is possible â€” the only recovery
   * for a bad file set is rejecting the whole Version and starting a new one (D-143
   * Decision 1/7, never reopening a sealed set). */
  fileSetSealed?: boolean;
  principalFileId?: string;
  totalFiles?: number;
  requestId?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
  /** Present only while state IN (RECEIVED, UNDER_REVIEW) â€” sparse GSI5 review-queue entry
   * (AP5). Removed (not merely blanked) the moment the version leaves either state, so the
   * index only ever contains live review work (AWS DynamoDB sparse-index pattern). */
  GSI5PK?: string;
  GSI5SK?: string;
}

const SEQ_WIDTH = 6;

export function formatVersionSeq(seq: number): string {
  return String(seq).padStart(SEQ_WIDTH, "0");
}

export function documentVersionKey(tenantId: AuthorizedTenantId, documentId: string, seq: number): { PK: string; SK: string } {
  return { PK: `TENANT#${tenantId}#DOCUMENT#${documentId}`, SK: `VERSION#${formatVersionSeq(seq)}` };
}

/** AP5 sparse review-queue index â€” separate buckets per real state (never a fixed `RECEIVED`
 * literal for both RECEIVED and UNDER_REVIEW, the exact bug the Rodada 2 proposal had). */
export function reviewQueueGsi5Keys(
  tenantId: AuthorizedTenantId,
  state: "RECEIVED" | "UNDER_REVIEW",
  orderingTimestamp: string,
  versionId: string,
): { GSI5PK: string; GSI5SK: string } {
  return {
    GSI5PK: `TENANT#${tenantId}#REVIEWQUEUE#${state}`,
    GSI5SK: `${orderingTimestamp}#VERSION#${versionId}`,
  };
}

/** AP11 â€” Version lookup by id alone (Decision 5's relink needs to resolve a `versionId` to
 * its owning `documentId` without knowing the Document upfront). */
export function versionLookupGsi5Keys(tenantId: AuthorizedTenantId, versionId: string): { GSI5PK: string; GSI5SK: string } {
  return { GSI5PK: `TENANT#${tenantId}#VERSIONLOOKUP`, GSI5SK: `VERSION#${versionId}` };
}

interface TransitionRule {
  from: readonly DocumentVersionState[];
  to: DocumentVersionState;
}

const TRANSITIONS: readonly TransitionRule[] = [
  { from: ["DRAFT"], to: "RECEIVED" },
  { from: ["DRAFT"], to: "WITHDRAWN" },
  { from: ["RECEIVED"], to: "UNDER_REVIEW" },
  { from: ["UNDER_REVIEW"], to: "RECEIVED" }, // claim TTL sweeper releasing a dead claim
  { from: ["RECEIVED", "UNDER_REVIEW"], to: "ACCEPTED" },
  { from: ["RECEIVED", "UNDER_REVIEW"], to: "REJECTED" },
  { from: ["ACCEPTED"], to: "SUPERSEDED" },
];

export class InvalidDocumentVersionTransitionError extends Error {
  constructor(
    readonly from: DocumentVersionState,
    readonly to: DocumentVersionState,
  ) {
    super(`Cannot transition DocumentVersion from "${from}" to "${to}"`);
    this.name = "InvalidDocumentVersionTransitionError";
  }
}

export function canTransitionDocumentVersion(from: DocumentVersionState, to: DocumentVersionState): boolean {
  return TRANSITIONS.some((rule) => rule.to === to && rule.from.includes(from));
}

/** Throws rather than returning a boolean (implementation-blueprint.md's `authorize()`
 * precedent: callers should not be able to forget to check a boolean result). */
export function assertValidDocumentVersionTransition(from: DocumentVersionState, to: DocumentVersionState): void {
  if (!canTransitionDocumentVersion(from, to)) {
    throw new InvalidDocumentVersionTransitionError(from, to);
  }
}

/** Decision 7: REJECTED is never removable (would contradict J9's "the rejected file stays in
 * history"). Only DRAFT can ever be removed â€” WITHDRAWN is the terminal state that records a
 * DRAFT was abandoned before it ever became evidence, and only a version that reached
 * WITHDRAWN this way is eligible for physical deletion under retention policy. */
export function isRemovableDocumentVersionState(state: DocumentVersionState): boolean {
  return state === "DRAFT";
}

/** Decision 1's terminal states â€” no further state transition is possible once reached (a
 * repeated command against one of these is only ever a legitimate idempotent replay, never a
 * fresh mutation). */
export function isTerminalDocumentVersionState(state: DocumentVersionState): boolean {
  return state === "ACCEPTED" || state === "REJECTED" || state === "SUPERSEDED" || state === "WITHDRAWN";
}

/** Decision 6/Bloqueador 9 gate for `acceptVersion` â€” both counters must be zero. */
export function hasCleanFileScans(version: Pick<DocumentVersion, "pendingFileScans" | "infectedFileScans">): boolean {
  return version.pendingFileScans === 0 && version.infectedFileScans === 0;
}

/**
 * D-194 fatia 1: `UnifiedValidityState` adapter. `DRAFT` is excluded (`undefined`) â€” it is not a
 * pending review, just an in-progress upload. `RECEIVED`/`UNDER_REVIEW` -> `AGUARDANDO_REVISAO`.
 * `REJECTED`/`WITHDRAWN`/`SUPERSEDED` are terminal-but-not-current -> excluded. `ACCEPTED`
 * delegates to `deriveValidityStateFromExpiry` (PERMANENTE/VALIDO/VENCENDO/VENCIDO, the only
 * state here that can genuinely be expired). Not consumed by any search mode in this phase (no
 * mode searches `Document`/`DocumentVersion` directly) â€” exists for a future detail-view use per
 * the design doc.
 */
export function deriveDocumentVersionValidityState(version: Pick<DocumentVersion, "state" | "validUntil">, now: Date): UnifiedValidityState | undefined {
  switch (version.state) {
    case "RECEIVED":
    case "UNDER_REVIEW":
      return "AGUARDANDO_REVISAO";
    case "ACCEPTED":
      return deriveValidityStateFromExpiry(version.validUntil, now);
    default:
      return undefined;
  }
}

/**
 * DocumentType â€” D-173 (`docs/architecture/reviews/document-type-scoping/
 * estado-final-consolidado.md` Â§1). Tenant-scoped catalog entry closing item 8 of D-161's
 * macro-order: gives DocumentType a stable, renamable-but-identity-stable identity a future
 * `Requirement` can reference (item 1, Requirement Templates). `Document.documentTypeId`
 * (item 4 of the design doc's "PrÃ³ximo passo real") stores this id, not the renamable
 * `displayName` â€” GSI2 partitions by it so renaming a DocumentType never moves an existing
 * Document.
 */
import type { EntityKey } from "../../../shared/dynamodb/occ.js";
import type { AuthorizedTenantId } from "../../identity/domain/authorization.js";

export type DocumentTypeStatus = "ACTIVE" | "DEPRECATED";

export interface DocumentType extends EntityKey {
  SK: "METADATA";
  entityType: "DocumentType";
  documentTypeId: string;
  tenantId: string;
  /** Renamable â€” never used as the entity's identity (documentTypeId is, immutable, ULID,
   * never reused). */
  displayName: string;
  status: DocumentTypeStatus;
  /** D-218 (Roadmap P1, "metadata configurÃ¡vel por Document Type") â€” see
   * `docs/architecture/reviews/document-type-metadata-scoping/estado-final-consolidado.md`.
   * Embedded (not a separate entity), same convention as `RequirementTemplate.items` (D-191) â€”
   * the whole array is read/replaced together, never paginated independently. Absent (not an
   * empty array) until the first field is created, same sparse idiom as every other optional
   * field on this entity. */
  metadataFields?: readonly DocumentTypeMetadataFieldDefinition[];
  createdAt: string;
  updatedAt: string;
  version: number;
  GSI1PK: string;
  GSI1SK: string;
}

/** D-218 Decision 8 â€” closed taxonomy, each with an unambiguous storage representation.
 * `NUMBER` is an integer count/quantity, NEVER money (`DECIMAL` is); `DATE` is a civil date
 * (`YYYY-MM-DD`, no time/timezone), never a full timestamp. Deliberately distinct from
 * `extraction/domain/extracted-field.ts`'s `ExtractedFieldValueType` (`DATE`/`STRING`/
 * `NUMBER`, an OCR/extraction concept) â€” two different contracts, never reused one for the
 * other. */
export type DocumentTypeFieldValueType = "TEXT" | "NUMBER" | "DECIMAL" | "DATE" | "BOOLEAN" | "SINGLE_SELECT";

/** Never removed physically once created (D-218 checklist criterion 3, "tombstone, never
 * delete") â€” `ARCHIVED` only blocks NEW/EDITED values from referencing it (fenced at the
 * value-write boundary), it never invalidates a `Document.metadataValues` entry already
 * written under it. */
export type DocumentTypeFieldStatus = "ACTIVE" | "ARCHIVED";

/** Same tombstone discipline as `DocumentTypeFieldStatus` above, applied to one option of a
 * `SINGLE_SELECT` field. */
export type DocumentTypeFieldOptionStatus = "ACTIVE" | "ARCHIVED";

export const MAX_ACTIVE_METADATA_FIELDS = 20;
export const MAX_TOTAL_METADATA_FIELD_DEFINITIONS = 100;
export const MAX_ACTIVE_OPTIONS_PER_FIELD = 50;
export const MAX_TOTAL_OPTIONS_PER_FIELD = 150;
export const MAX_METADATA_FIELD_NAME_CHARS = 200;
export const MAX_METADATA_FIELD_OPTION_LABEL_CHARS = 200;

/** D-218 Decision 4/8 â€” `optionId` is the stable identity (ULID, immutable, never reused);
 * `label` is renamable and never used to key a stored value (`Document.metadataValues`' own
 * `SINGLE_SELECT` variant stores `optionId` + a `labelSnapshot` copy, never the live `label`
 * alone â€” see `document.ts`). Only meaningful when the owning field's `valueType ===
 * "SINGLE_SELECT"`. */
export interface DocumentTypeFieldOption {
  optionId: string;
  label: string;
  status: DocumentTypeFieldOptionStatus;
}

/** D-218 Decision 1/3 â€” one entry of `DocumentType.metadataFields`. `valueType` is IMMUTABLE
 * once created (Decision 3, the design's strongest invariant): no operation in this module's
 * service layer ever accepts a `valueType` change for an existing `fieldId` â€” changing type
 * means archiving this field and creating a new one (`fieldId` is never reused, so this is
 * always an expand, never an in-place mutation that could reinterpret an existing stored
 * value under the old type). */
export interface DocumentTypeMetadataFieldDefinition {
  fieldId: string;
  name: string;
  valueType: DocumentTypeFieldValueType;
  /** Prospective only (Decision 5) â€” never validated against a Document that is not currently
   * being written; `createDocument()` never consults this field at all (see `document.ts`'s
   * doc comment on `metadataValues`). */
  required: boolean;
  /** Present only when `valueType === "SINGLE_SELECT"`. */
  options?: readonly DocumentTypeFieldOption[];
  status: DocumentTypeFieldStatus;
  createdAt: string;
  updatedAt: string;
}

export function documentTypeKey(tenantId: AuthorizedTenantId, documentTypeId: string): { PK: string; SK: "METADATA" } {
  return { PK: `TENANT#${tenantId}#DOCTYPE#${documentTypeId}`, SK: "METADATA" };
}

/** GSI1 (discriminated by prefix â€” same physical GSI1 index already shared by Document/
 * ExpirationItem/Requirement's own status namespaces, no new index): DocumentTypes by
 * status, ordered by normalized name so a catalog listing sorts alphabetically for free. */
export function documentTypeGsi1Keys(tenantId: AuthorizedTenantId, status: DocumentTypeStatus, normalizedName: string, documentTypeId: string): { GSI1PK: string; GSI1SK: string } {
  return {
    GSI1PK: `TENANT#${tenantId}#DOCTYPESTATUS#${status}`,
    GSI1SK: `NAME#${normalizedName}#DOCTYPE#${documentTypeId}`,
  };
}

/** Dedupe pointer â€” Â§2 of the design doc. One pointer row per (tenant, normalizedName),
 * created/deleted transactionally alongside the DocumentType it names so two concurrent
 * creators (or a rename landing on an in-use name) can never both succeed. */
export interface DocumentTypeNamePointer extends EntityKey {
  SK: "POINTER";
  entityType: "DocumentTypeNamePointer";
  tenantId: string;
  normalizedName: string;
  documentTypeId: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export function documentTypeNamePointerKey(tenantId: AuthorizedTenantId, normalizedName: string): { PK: string; SK: "POINTER" } {
  return { PK: `TENANT#${tenantId}#DOCTYPENAME#${normalizedName}`, SK: "POINTER" };
}

export interface CreateDocumentTypeInput {
  displayName: string;
}

/** D-218 â€” input for creating one `DocumentTypeMetadataFieldDefinition`. `options` is only
 * meaningful (and only validated) when `valueType === "SINGLE_SELECT"`; each entry is a bare
 * label â€” `optionId`s are always minted by the service, never accepted from the caller (an
 * option is never renamed by re-supplying the same string twice, see `UpdateDocumentTypeMetadataFieldInput.optionsPatch`). */
export interface CreateDocumentTypeMetadataFieldInput {
  name: string;
  valueType: DocumentTypeFieldValueType;
  required: boolean;
  options?: readonly string[];
}

/** D-218 Decision 7 â€” one PATCH endpoint covers both the field itself (name/required/status)
 * and its options (`optionsPatch`), because both live inside the same embedded array inside
 * the same `DocumentType` item â€” one OCC-fenced write, never two separate concurrency
 * mechanisms. `valueType` is deliberately NOT a field here (Decision 3 â€” immutable). */
export interface UpdateDocumentTypeMetadataFieldInput {
  name?: string;
  required?: boolean;
  status?: DocumentTypeFieldStatus;
  optionsPatch?: readonly DocumentTypeFieldOptionPatchOp[];
}

export type DocumentTypeFieldOptionPatchOp =
  | { op: "ADD"; label: string }
  | { op: "RENAME"; optionId: string; label: string }
  | { op: "ARCHIVE"; optionId: string }
  | { op: "REACTIVATE"; optionId: string };

/**
 * DocumentRequest â€” document-archive's OWN minimal shape, D-143 Decision 4 (guest access). NOT
 * the older `src/modules/subject/domain/document-request.ts` (that entity belongs to the
 * subject module's M10 guest-upload slice, keyed under `TENANT#t#SUBJECT#s`/
 * `REQASSIGN#<assignmentId>#DOCREQ#<id>` and carrying its own `tokenSelectorHash` inline) â€” this
 * is a distinct, new entity scoped to the document-archive domain (Document/DocumentVersion/
 * Requirement), the one `estado-final-consolidado.md` Decision 8 (recurrence) references via
 * `requestId`/`attemptIndex`/`seriesId`.
 *
 * Deliberately minimal: this task (guest access, D-143 Decision 4) only needs "the business
 * request a RequestAccessCredential is issued against" â€” id/subjectId/tenantId/requirementId/
 * status/deadline. Recurrence (Decision 8, D-147) ADDS `seriesId`/`occurrenceId`/
 * `attemptIndex`/`parentRequestId` below rather than introducing a parallel entity.
 *
 * D-147 (Decision 8, recurrence): all four new fields are OPTIONAL/additive â€” a bare
 * `DocumentRequest` created outside a series (the only kind guest access's existing tests
 * construct) simply omits them, same "no fabricated value" discipline as every other optional
 * field in this module (`requirement.ts`'s `evidenceValidUntil`, etc.). `attemptIndex` is the
 * one exception worth calling out: it defaults to `1` for a non-recurring request (see
 * `document-request-series.ts`'s `materializeAttempt`), so it is typed as a required `number`
 * with `1` as the implicit non-recurring value, not `attemptIndex?: number` â€” every
 * DocumentRequest that exists IS exactly one attempt, whether or not it belongs to a series.
 */
import type { EntityKey } from "../../../shared/dynamodb/occ.js";
import type { AuthorizedTenantId } from "../../identity/domain/authorization.js";

/** Mirrors the older subject-module DocumentRequest's status vocabulary (same states cover the
 * same real lifecycle â€” requested/opened/submitted/completed, plus the three ways it can die
 * early) â€” not reused by import (distinct module, distinct entity), just the same taxonomy. */
export type DocumentRequestStatus = "REQUESTED" | "OPENED" | "SUBMITTED" | "COMPLETED" | "CANCELLED" | "EXPIRED" | "REVOKED";

export interface DocumentRequest extends EntityKey {
  SK: `DOCREQUEST#${string}`;
  entityType: "DocumentRequest";
  documentRequestId: string;
  tenantId: string;
  subjectId: string;
  /** The Requirement this request asks the guest to satisfy â€” a request always targets exactly
   * one Requirement in this minimal shape (no fan-out to multiple Requirements per request). */
  requirementId: string;
  status: DocumentRequestStatus;
  /** Also the RequestAccessCredential's TTL (Decision 4: "TTL = prazo do Request de negÃ³cio") â€”
   * absent means no deadline, in which case credential issuance must supply an explicit TTL of
   * its own rather than defaulting to "forever" (see `issueRequestAccessCredential`). */
  deadline?: string;
  lastOpenedAt?: string;
  lastSubmissionId?: string;
  submissionCount: number;
  /** D-147 (Decision 8): present only when this request belongs to a `DocumentRequestSeries`
   * cycle â€” see `document-request-series.ts` for the series/cycle/attempt shape. */
  seriesId?: string;
  /** Deterministic per-cycle id (`computeSeriesOccurrenceId`) â€” stable across every attempt of
   * the SAME cycle, changes only when the series advances to its next cycle. Never present
   * without `seriesId`. */
  occurrenceId?: string;
  /** Which attempt within the cycle this is â€” `1` for a series' first attempt of a cycle,
   * incrementing on each `materializeAttempt` call within the same cycle. Optional (not
   * defaulted to `1`) rather than required: a bare, non-recurring `DocumentRequest` (guest
   * access's existing shape, no `seriesId`) has no cycle at all, so "attempt 1 of what?" does
   * not apply to it â€” forcing a fabricated `1` onto every non-recurring request would violate
   * this module's "no fabricated value" discipline (see `requirement.ts`'s `evidenceValidUntil`
   * for the same principle applied elsewhere). Always present together with `seriesId`. */
  attemptIndex?: number;
  /** Always the immediately-previous attempt of the SAME cycle (never the previous cycle's
   * last attempt) â€” preserves causality within a cycle while `occurrenceId` preserves cycle
   * identity across attempts (D-147/Decision 8). Absent for attempt 1 of any cycle. */
  parentRequestId?: string;
  /**
   * D-226 (`guest-credential-issuance-scoping/estado-final-consolidado.md`): monotonic counter,
   * starts at `1` at creation, incremented by `rejectVersion()` on every reissue-triggering
   * rejection (Achado 3 of D-222). Identity for credential ISSUANCE is `documentRequestId` +
   * `issuanceGeneration` together, never `documentRequestId` alone â€” this is what lets a
   * post-rejection reissue avoid colliding with the original issuance's idempotency record on
   * the guest Lambda's consumer, and what the consumer's `DocumentRequest` `Update` fences on
   * (`ConditionExpression` includes `issuanceGeneration = :expected`) to reject a stale/obsolete
   * issuance event without a TOCTOU window.
   */
  issuanceGeneration: number;
  /**
   * D-226: selector hash of the currently-active `RequestAccessCredential` for this request â€”
   * written ONLY by the guest-Lambda issuance consumer (the one holding the D-146 pepper), never
   * by this (authenticated, pepper-less) Lambda. Its purpose is to let THIS Lambda revoke a
   * stale credential (`rejectVersion()`) by a known key, without ever needing to compute or
   * verify a hash itself â€” revocation is a plain conditional `SET revokedAt`, no pepper required.
   */
  activeCredentialSelectorHash?: string;
  /**
   * D-226 (Achado 3 of D-222): set by `rejectVersion()` when it reopens this request â€” one
   * object, never two loose fields, so the reason always stays correlated to the exact version
   * and moment it was rejected (never an ambiguous "last reason" disconnected from which
   * submission it belonged to).
   */
  lastRejection?: { versionId: string; reason: string; occurredAt: string };
  /**
   * D-228 (closes D-222/D-227's named gap: this entity had no way to know WHO to deliver a
   * guest link to). Optional/additive â€” same "no fabricated value" discipline as every other
   * optional field here â€” following the exact precedent already established for the SAME
   * problem (delivering a guest link to an external party) in the older, unrelated
   * `src/modules/subject/domain/document-request.ts`'s `recipientEmail: string` (there
   * required, because that entity's ONLY creation path â€” `CreateDocumentRequestInput` â€”
   * already demands it; here optional, because a series-materialized attempt
   * (`document-request-series.ts`'s `materializeAttempt`) has no recipient contact modeled at
   * the series level yet â€” a genuine product gap named, not solved, by this decision; see
   * decisions-log.md D-228). Populated only by `createDocumentRequest()`'s avulso path today.
   * The delivery worker (`src/workers/guest-credential-delivery/deliver.ts`) treats its
   * absence as a terminal, non-retryable skip rather than an error â€” a request with no
   * recipient is a data gap, not a transient failure.
   */
  recipientEmail?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export function documentRequestKey(tenantId: AuthorizedTenantId, subjectId: string, documentRequestId: string): { PK: string; SK: `DOCREQUEST#${string}` } {
  return { PK: `TENANT#${tenantId}#SUBJECT#${subjectId}`, SK: `DOCREQUEST#${documentRequestId}` };
}

export const DOCUMENT_REQUEST_SK_PREFIX = "DOCREQUEST#";

/** States a resolved credential/session may still act against â€” mirrors
 * `GuestSubmissionService.resolveToken`'s terminal-status rejection list (subject module
 * precedent) applied to this module's own status vocabulary. */
export function isDocumentRequestLive(status: DocumentRequestStatus): boolean {
  return status !== "CANCELLED" && status !== "REVOKED" && status !== "EXPIRED" && status !== "COMPLETED";
}

/**
 * DocumentRequestSeries â€” D-143 Decision 8 (`estado-final-consolidado.md`, D-147), Nucleus 2
 * entity 3/3, the final piece of Nucleus 2. A series is a recurring request DEFINITION (e.g.
 * "renew this Requirement's evidence every 90 days"); each time it comes due it materializes
 * one CYCLE, identified by a deterministic `occurrenceId` derived from `seriesId` + the cycle's
 * `currentCycleStartAt` â€” computing it twice for the same cycle always yields the same id, so a
 * duplicate scheduler tick can never double-materialize a cycle (the property
 * `computeSeriesOccurrenceId` exists to guarantee).
 *
 * Within one cycle, `materializeAttempt` (application layer) may be called more than once (a
 * resend/retry of the same request) â€” each call creates one `DocumentRequest` "attempt"
 * (`attemptIndex` incrementing from 1) whose `parentRequestId` always points to the
 * IMMEDIATELY PREVIOUS attempt of the SAME cycle. `occurrenceId` stays stable across every
 * attempt of a cycle; `advanceCycle` is the only operation that changes it (moving to the next
 * due date resets `latestAttemptIndex`/`latestRequestId` and recomputes `currentCycleStartAt`).
 *
 * Co-located under the owning Subject's partition, same convention as `requirement.ts`
 * (`TENANT#t#SUBJECT#s`/`SERIES#<seriesId>`) â€” a series' lifecycle is owned by the Subject, not
 * by the Requirement it renews evidence for (mirrors why Requirement isn't co-located under
 * Document either).
 *
 * Index: GSI1 (document-archive's own â€” GSI3/GSI4/GSI6 are off-limits, restricted to
 * reminder/chasing per D-143 Decision 2's GSI exclusivity rule, confirmed by grep: no writer
 * under `src/modules/document-archive/` ever sets `GSI3PK`). GSI1 already hosts two
 * prefix-discriminated namespaces (`DOCSTATUS`/`REQSTATUS`, `document.ts`/`requirement.ts`) â€”
 * this adds a third, `SERIESDUE`, following the exact same discrimination-by-prefix convention
 * rather than colliding with either existing one or reaching for GSI5 (already carrying its own
 * two sparse namespaces, review-queue and version-lookup, which this access pattern doesn't
 * share the "sparse, removed on transition" shape of).
 */
import type { EntityKey } from "../../../shared/dynamodb/occ.js";
import type { AuthorizedTenantId } from "../../identity/domain/authorization.js";
import { stableHash } from "../../reminder/domain/reminder-occurrence.js";

export type DocumentRequestSeriesStatus = "ACTIVE" | "CANCELLED";

export interface DocumentRequestSeriesCadence {
  intervalDays: number;
}

export interface DocumentRequestSeries extends EntityKey {
  entityType: "DocumentRequestSeries";
  seriesId: string;
  tenantId: string;
  subjectId: string;
  requirementId: string;
  cadence: DocumentRequestSeriesCadence;
  status: DocumentRequestSeriesStatus;
  /** The current cycle's canonical start instant â€” the exact input (together with `seriesId`)
   * `computeSeriesOccurrenceId` hashes. Changed only by `advanceCycle`. */
  currentCycleStartAt: string;
  /** When the current cycle's first attempt is due to be materialized (>= `currentCycleStartAt`,
   * equal to it in this increment â€” a future catch-up/pause feature could diverge them, out of
   * scope per `estado-final-consolidado.md`'s "fora de escopo" list: "timezone/pausa/catch-up de
   * recorrÃªncia"). */
  nextDueAt: string;
  /** How many attempts have been materialized in the CURRENT cycle â€” `0` means no attempt yet
   * (the series is due but `materializeAttempt` has not run for this cycle). Reset to `0` by
   * `advanceCycle`. */
  latestAttemptIndex: number;
  /** The most recently materialized `DocumentRequest.documentRequestId` of the current cycle â€”
   * the next `materializeAttempt` call's `parentRequestId`. Absent when `latestAttemptIndex=0`
   * (no attempt yet) and reset to absent by `advanceCycle`. */
  latestRequestId?: string;
  /**
   * D-230 (closes D-228's named pendency: the recurrence path had no recipient contact modeled,
   * so every series-materialized `DocumentRequest` was structurally unable to deliver a guest
   * link). Optional/additive, same "no fabricated value" discipline as
   * `DocumentRequest.recipientEmail` (D-228) â€” a series with no `recipientEmail` keeps behaving
   * exactly as before this decision (the delivery worker's terminal skip, never an error).
   * Provided once by the human at `createSeries()` time, mutable afterwards only via
   * `updateSeriesRecipient()` (never in-place by any other mutation). `buildMaterializeAttemptEntries`
   * copies this value onto EACH materialized `DocumentRequest` at the moment of materialization â€”
   * a snapshot, never re-synced retroactively: changing a series' `recipientEmail` only affects
   * cycles materialized AFTER the change, exactly like every other field a `DocumentRequest`
   * copies from its series. Normalized with `.trim()` only (no case-folding â€” an email's local
   * part is not universally case-insensitive; kept consistent with the avulso path, which also
   * does not lower-case). NÃ­vel 5 per `change-risk-scale.md` (protocol round-tripped in
   * `docs/architecture/reviews/document-request-series-recipient-scoping/`) because this also
   * introduces the new `updateSeriesRecipient` mutation/HTTP surface, not just an additive field.
   */
  recipientEmail?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
  GSI1PK: string;
  GSI1SK: string;
}

export function documentRequestSeriesKey(tenantId: AuthorizedTenantId, subjectId: string, seriesId: string): EntityKey {
  return { PK: `TENANT#${tenantId}#SUBJECT#${subjectId}`, SK: `SERIES#${seriesId}` };
}

export const DOCUMENT_REQUEST_SERIES_SK_PREFIX = "SERIES#";

/**
 * GSI1 SERIESDUE namespace â€” a third prefix-discriminated namespace on the same physical GSI1
 * `document.ts`/`requirement.ts` already use, ordered ascending by `nextDueAt` so the producer's
 * "what's due" query (`document-request-recurrence-producer.ts`) is a single bounded Query
 * against a status-scoped partition, same shape as `reviewQueueGsi5Keys`'s access pattern.
 */
export function documentRequestSeriesGsi1Keys(tenantId: AuthorizedTenantId, status: DocumentRequestSeriesStatus, nextDueAt: string, seriesId: string): { GSI1PK: string; GSI1SK: string } {
  return {
    GSI1PK: `TENANT#${tenantId}#SERIESDUE#${status}`,
    GSI1SK: `DUE#${nextDueAt}#SERIES#${seriesId}`,
  };
}

/**
 * Deterministic per-cycle id â€” SAME `seriesId` + SAME `cycleStartAt` ALWAYS yields the SAME
 * `occurrenceId`, independent of when/how many times it is computed (D-147/Decision 8: this is
 * exactly the property that makes a duplicate scheduler tick for the same due cycle safe â€”
 * recomputing it never mints a second identity for the cycle). Reuses `stableHash` from
 * `reminder/domain/reminder-occurrence.ts` (same non-cryptographic stable-hash primitive
 * `document-chasing.ts`'s `chasingGsi3Keys` already reuses) rather than a fresh random id â€”
 * pure function of its two inputs, no I/O, no randomness.
 */
export function computeSeriesOccurrenceId(seriesId: string, cycleStartAt: string): string {
  return `OCC-${stableHash(`${seriesId}#${cycleStartAt}`)}`;
}

export interface CreateDocumentRequestSeriesInput {
  subjectId: string;
  requirementId: string;
  cadence: DocumentRequestSeriesCadence;
  /** First due date; defaults to "now" (immediately due) when omitted. */
  firstDueAt?: string;
  /** D-230 â€” see `DocumentRequestSeries.recipientEmail`'s doc comment. Optional; omit for a
   * series with no guest-delivery recipient (unchanged from pre-D-230 behavior). */
  recipientEmail?: string;
}

/**
 * TrackedSubject â€” docs/architecture/roadmap-evolution/03-domain-model-tracked-subject-requirement.md
 * (D-036, protocolo Claudeâ†”Codex 9,1/9,1). Agregado raiz prÃ³prio, tenant-owned, mesmo padrÃ£o
 * de chave de ExpirationItem (`TENANT#t#ITEM#i`/`META`): `TENANT#t#SUBJECT#s`/`META`.
 *
 * Sem `ownerUserId`/`assigneeUserId` (correÃ§Ã£o registrada em D-194 Fatia 2,
 * `docs/architecture/reviews/search-and-filters-scoping/estado-final-consolidado.md`): a premissa
 * original acima ("modelar responsÃ¡vel antes de existir um segundo usuÃ¡rio real") estÃ¡
 * desatualizada desde D-086/D-122 â€” um segundo usuÃ¡rio real jÃ¡ existe (Organization/Membership),
 * e "responsÃ¡vel" jÃ¡ Ã© um conceito modelado no sistema, sÃ³ que em duas outras entidades:
 * `ExpirationItem.assigneeUserId` (D-122/D-125) e, desde D-194 Fatia 2,
 * `document-archive/domain/requirement.ts`'s `Requirement.assigneeUserId`. TrackedSubject
 * permanece deliberadamente sem o campo â€” nÃ£o porque o mecanismo ainda careÃ§a de evidÃªncia, mas
 * porque D-194 tratou "quem carrega o responsÃ¡vel" (Document, evidÃªncia, vs. Requirement,
 * obrigaÃ§Ã£o acionÃ¡vel, vs. TrackedSubject, o prÃ³prio sujeito rastreado) como uma decisÃ£o de
 * engenharia dentro da autoridade jÃ¡ delegada por D-122, e nenhuma das 5 rodadas do debate
 * encontrou motivo de produto para estender esse campo a TrackedSubject nesta fase (ver "Escopo
 * explicitamente fora desta decisÃ£o" no documento acima).
 */
import type { EntityKey } from "../../../shared/dynamodb/occ.js";
import { normalizeDisplayName } from "../../../shared/text/normalize-display-name.js";
import type { AuthorizedTenantId } from "../../identity/domain/authorization.js";

export { normalizeDisplayName };

export type TrackedSubjectType = "COMPANY" | "VENDOR" | "CLIENT" | "EMPLOYEE" | "ASSET" | "LOCATION" | "CUSTOM";
export type TrackedSubjectStatus = "ACTIVE" | "ARCHIVED" | "DELETED";

export interface TrackedSubject extends EntityKey {
  SK: "META";
  entityType: "TrackedSubject";
  subjectId: string;
  tenantId: string;
  type: TrackedSubjectType;
  displayName: string;
  displayNameNormalized: string;
  /** Emenda registrada em 08-domain-model-custom-fields.md: observaÃ§Ã£o nÃ£o indexada, nÃ£o
   * pesquisÃ¡vel, tenant-only (nunca editÃ¡vel pelo convidado do futuro fluxo de guest upload). */
  notes?: string;
  /** D-192 Â§2 (bulk-import-documents-requirements-scoping/estado-final-consolidado.md) â€” a
   * caller-supplied durable identifier from the tenant's source-of-record system (e.g. an
   * external CRM/vendor-management id). Optional (not every Subject needs one), create-only
   * (`updateSubject()` deliberately does not gain this capability in this slice â€” no rename
   * path, mirrors DocumentType's identity-vs-displayName split but simpler: no rename at all).
   * Uniqueness enforced tenant-wide via `SubjectExternalIdPointer`, same mechanism as
   * `DocumentTypeNamePointer`/`RequirementNamePointer` (D-173/D-191). */
  externalId?: string;
  tags: string[];
  status: TrackedSubjectStatus;
  deletedAt?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
  GSI7PK: string;
  GSI7SK: string;
}

export function subjectKey(tenantId: AuthorizedTenantId, subjectId: string): { PK: string; SK: "META" } {
  return { PK: `TENANT#${tenantId}#SUBJECT#${subjectId}`, SK: "META" };
}

/** GSI7 â€” listagem de subjects por status/tipo/nome (03-domain-model-...md, cluster 1,
 * rodada 2: escopo Ãºnico, nÃ£o misturado com nenhum outro access pattern). */
export function gsi7Keys(
  tenantId: AuthorizedTenantId,
  status: TrackedSubjectStatus,
  type: TrackedSubjectType,
  displayNameNormalized: string,
  subjectId: string,
): { GSI7PK: string; GSI7SK: string } {
  return {
    GSI7PK: `TENANT#${tenantId}#SUBJECTSTATUS#${status}`,
    GSI7SK: `TYPE#${type}#NAME#${displayNameNormalized}#SUBJECT#${subjectId}`,
  };
}

/** Dedupe/lookup pointer for `TrackedSubject.externalId` â€” D-192 Â§2. One pointer row per
 * (tenant, externalId), created transactionally alongside the TrackedSubject it names so two
 * concurrent creators can never both claim the same externalId. Never deleted/repointed in
 * this slice (create-only, no rename path) â€” unlike `DocumentTypeNamePointer`, there is no
 * `renameSubject...` counterpart to keep in sync. */
export interface SubjectExternalIdPointer extends EntityKey {
  SK: "POINTER";
  entityType: "SubjectExternalIdPointer";
  tenantId: string;
  externalId: string;
  subjectId: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export function subjectExternalIdPointerKey(tenantId: AuthorizedTenantId, externalId: string): { PK: string; SK: "POINTER" } {
  return { PK: `TENANT#${tenantId}#SUBJECTEXTID#${externalId}`, SK: "POINTER" };
}

export interface CreateSubjectInput {
  type: TrackedSubjectType;
  displayName: string;
  notes?: string;
  tags?: string[];
  /** Create-only â€” see `TrackedSubject.externalId` doc comment. */
  externalId?: string;
}

export interface UpdateSubjectInput {
  displayName?: string;
  notes?: string;
  tags?: string[];
}

/**
 * RequirementAssignment â€” 03-domain-model-tracked-subject-requirement.md (D-036). Agregado
 * prÃ³prio, coleÃ§Ã£o sob a partiÃ§Ã£o do subject (`TENANT#t#SUBJECT#s`/`REQASSIGN#a`) â€” mesmo
 * padrÃ£o de coleÃ§Ã£o JÃ usado em produÃ§Ã£o por identity (`TENANT#t#USER#u`/`SESSION#<deviceId>`)
 * e por document/M6 (`TENANT#t#ITEM#i`/`DOC#d`), nÃ£o convenÃ§Ã£o nova.
 *
 * `RequirementDefinition`/`RequirementTemplate` ficam deferidos por completo (nenhum access
 * pattern os exige ainda) â€” `requirementDefinitionId?` Ã© sÃ³ escape hatch para promoÃ§Ã£o futura.
 *
 * VALID/EXPIRING/EXPIRED NUNCA sÃ£o persistidos aqui â€” sÃ£o estados de apresentaÃ§Ã£o derivados
 * do ExpirationItem linkado (condiÃ§Ã£o de aprovaÃ§Ã£o do Codex no cluster 1, registrada no
 * documento de decisÃ£o). Este mÃ³dulo sÃ³ modela o estado operacional MISSING..SATISFIED.
 * REQUESTED/SUBMITTED/UNDER_REVIEW/REJECTED existem no enum para compatibilidade de schema
 * futura (cluster 2 â€” DocumentRequest/guest upload, M10), mas nenhuma transiÃ§Ã£o para esses
 * estados Ã© implementada em M9: o Ãºnico caminho de mutaÃ§Ã£o de status aqui Ã©
 * MISSING <-> SATISFIED, via link/unlink manual de um ExpirationItem jÃ¡ existente.
 */
import type { EntityKey } from "../../../shared/dynamodb/occ.js";
import type { AuthorizedTenantId } from "../../identity/domain/authorization.js";

export type RequirementAssignmentStatus =
  | "MISSING"
  | "REQUESTED"
  | "SUBMITTED"
  | "UNDER_REVIEW"
  | "REJECTED"
  | "SATISFIED";

export interface RequirementAssignment extends EntityKey {
  entityType: "RequirementAssignment";
  assignmentId: string;
  subjectId: string;
  tenantId: string;
  requirementName: string;
  requirementDefinitionId?: string;
  notes?: string;
  status: RequirementAssignmentStatus;
  linkedItemId?: string;
  linkedDocumentId?: string;
  lastSubmissionId?: string;
  requestedAt?: string;
  submittedAt?: string;
  reviewedAt?: string;
  satisfiedAt?: string;
  deletedAt?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export function requirementAssignmentKey(tenantId: AuthorizedTenantId, subjectId: string, assignmentId: string): EntityKey {
  return { PK: `TENANT#${tenantId}#SUBJECT#${subjectId}`, SK: `REQASSIGN#${assignmentId}` };
}

/** Prefixo de SK para listar todos os requisitos de um subject via Query(PK, begins_with(SK, ...)) â€” sem GSI novo. */
export const REQUIREMENT_ASSIGNMENT_SK_PREFIX = "REQASSIGN#";

export interface AssignRequirementInput {
  requirementName: string;
  requirementDefinitionId?: string;
  notes?: string;
}

export interface UpdateRequirementAssignmentInput {
  requirementName?: string;
  notes?: string;
}

/**
 * DocumentRequest â€” 04-domain-model-guest-upload.md (D-037). Mesma partiÃ§Ã£o do
 * RequirementAssignment (coleÃ§Ã£o sob o subject, sem GSI novo). DestinatÃ¡rio como snapshot
 * inline (nÃ£o bloqueia por `ExternalContact`, ainda nÃ£o modelado â€” decisÃ£o explÃ­cita do
 * cluster 2).
 */
import type { EntityKey } from "../../../shared/dynamodb/occ.js";
import type { InitialInviteDeliveryOverride } from "./document-request-delivery-preference.js";
import type { AuthorizedTenantId } from "../../identity/domain/authorization.js";

export type DocumentRequestStatus = "REQUESTED" | "OPENED" | "SUBMITTED" | "COMPLETED" | "CANCELLED" | "EXPIRED" | "REVOKED";

export interface DocumentRequest extends EntityKey {
  entityType: "DocumentRequest";
  documentRequestId: string;
  tenantId: string;
  subjectId: string;
  assignmentId: string;
  recipientEmail: string;
  recipientDisplayName?: string;
  requestedByUserId: string;
  requestedAt: string;
  deadline?: string;
  status: DocumentRequestStatus;
  tokenSelectorHash: string;
  tokenVersion: number;
  tokenExpiresAt: string;
  revokedAt?: string;
  lastOpenedAt?: string;
  submissionCount: number;
  lastSubmissionId?: string;
  completedAt?: string;
  cancellationReason?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export function documentRequestKey(tenantId: AuthorizedTenantId, subjectId: string, assignmentId: string, documentRequestId: string): EntityKey {
  return { PK: `TENANT#${tenantId}#SUBJECT#${subjectId}`, SK: `REQASSIGN#${assignmentId}#DOCREQ#${documentRequestId}` };
}

export interface CreateDocumentRequestInput {
  recipientEmail: string;
  recipientDisplayName?: string;
  deadline?: string;
  /** M10 cluster 4 (D-049): override por chamada do modo de entrega do convite inicial -
   * `"DEFAULT"` (ou ausente) usa a preferÃªncia do tenant, ver `document-request-delivery-preference.ts`. */
  initialInviteDelivery?: InitialInviteDeliveryOverride;
}

/**
 * ExpirationItem â€” data-model.md Â§2 (`TENANT#t#ITEM#i` / `META`) and Â§3 (GSI1 dashboard
 * key shape). status ACTIVE/ARCHIVED/RENEWED/DELETED per data-model.md; `renewedFromId`
 * links a renewed item's successor back to its source (implementation-blueprint.md Â§8:
 * renewal creates a new item/version in the lineage rather than mutating dueDate in
 * place on the same aggregate - the source item transitions to RENEWED and a new
 * ACTIVE item is created with `renewedFromId` pointing at the source).
 */
import type { EntityKey } from "../../../shared/dynamodb/occ.js";
import type { UnifiedValidityState } from "../../../shared/domain/validity-state.js";
import { deriveValidityStateFromExpiry } from "../../../shared/domain/validity-state.js";
import type { AuthorizedTenantId } from "../../identity/domain/authorization.js";

export type ExpirationItemStatus = "ACTIVE" | "ARCHIVED" | "RENEWED" | "DELETED";

export interface ExpirationItem extends EntityKey {
  SK: "META";
  entityType: "ExpirationItem";
  itemId: string;
  tenantId: string;
  name: string;
  category: string;
  categoryNormalized: string;
  description?: string;
  dueDate: string; // ISO-8601 date-time
  issueDate?: string;
  periodicity?: string;
  issuer?: string;
  number?: string;
  assigneeUserId?: string;
  tags: string[];
  priority?: string;
  status: ExpirationItemStatus;
  renewedFromId?: string;
  deletedAt?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
  GSI1PK: string;
  GSI1SK: string;
}

export function itemKey(tenantId: AuthorizedTenantId, itemId: string): { PK: string; SK: "META" } {
  return { PK: `TENANT#${tenantId}#ITEM#${itemId}`, SK: "META" };
}

/** GSI1 - vencimentos/dashboard: PK=TENANT#t#ITEMSTATUS#<status>, SK=DUE#<dueDate>#ITEM#i (data-model.md Â§3). No shard: MVP volume doesn't justify it (data-model.md "GovernanÃ§a do single-table"). */
export function gsi1Keys(tenantId: AuthorizedTenantId, status: ExpirationItemStatus, dueDate: string, itemId: string): { GSI1PK: string; GSI1SK: string } {
  return {
    GSI1PK: `TENANT#${tenantId}#ITEMSTATUS#${status}`,
    GSI1SK: `DUE#${dueDate}#ITEM#${itemId}`,
  };
}

/** Unicode combining-diacritical-marks block (U+0300-U+036F), left behind by NFD decomposition (e.g. "Ã©" -> "e" + U+0301). Built from code points rather than a literal character class to avoid any ambiguity from non-ASCII source bytes. */
const DIACRITICS_PATTERN = new RegExp(`[\\u0300-\\u036f]`, "g");

/** Lowercase, accent/extra-space-stripped normalization (data-model.md "Category â€” normalizaÃ§Ã£o mÃ­nima"). */
export function normalizeCategory(category: string): string {
  return category
    .normalize("NFD")
    .replace(DIACRITICS_PATTERN, "") // strip combining diacritics left by NFD decomposition
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export interface CreateItemInput {
  name: string;
  category: string;
  description?: string;
  dueDate: string;
  issueDate?: string;
  periodicity?: string;
  issuer?: string;
  number?: string;
  assigneeUserId?: string;
  tags?: string[];
  priority?: string;
}

/** Fields an authenticated caller may change via updateItem. Never includes status/version/renewedFromId - those are controlled by dedicated operations (archiveItem/deleteItem/renewItem, the OCC builder). */
export interface UpdateItemInput {
  name?: string;
  category?: string;
  description?: string;
  dueDate?: string;
  issueDate?: string;
  periodicity?: string;
  issuer?: string;
  number?: string;
  assigneeUserId?: string;
  tags?: string[];
  priority?: string;
}

/**
 * D-194 fatia 1: `UnifiedValidityState` adapter. Only `ACTIVE` has a validity to present â€”
 * `ARCHIVED`/`RENEWED`/`DELETED` are excluded (`undefined`), never a `PERMANENTE`/`VENCIDO` that
 * would misrepresent a non-current item. `dueDate` is always present on this aggregate (unlike
 * `Requirement`'s optional `evidenceValidUntil`), so `PERMANENTE` never occurs here in practice â€”
 * `deriveValidityStateFromExpiry` stays the shared entry point regardless.
 */
export function deriveExpirationItemValidityState(item: Pick<ExpirationItem, "status" | "dueDate">, now: Date): UnifiedValidityState | undefined {
  if (item.status !== "ACTIVE") return undefined;
  return deriveValidityStateFromExpiry(item.dueDate, now);
}

export interface RenewItemInput {
  newDueDate: string;
  /** Idempotency cycle discriminator (data-model.md Â§4: "tenantId|sourceItemId|sourceVersion|cycle"). Defaults to newDueDate when omitted. */
  cycle?: string;
}

/**
 * Organization â€” Multi-User B2B Wave B2B-3 (docs/architecture/multi-user-b2b-physical-model.md
 * Â§4, `APPROVED` D-086 via protocolo Claudeâ†”Codex). Tenant boundary permanente:
 * `tenantId = organizationId` a partir do cutover (Wave B2B-5) â€” atÃ© lÃ¡, coexiste com o
 * `tenantId=userId` legado (Wave B2B-2, D-087/D-088), sem substituÃ­-lo ainda. Mesma partiÃ§Ã£o
 * do agregado raiz `Membership` (domain/membership.ts) â€” uma Ãºnica `Query` em
 * `PK=TENANT#<organizationId>#ORG#<organizationId>` retorna a org + todos os membros.
 *
 * `ownerCount` Ã© a contagem de `Membership` `ACTIVE` com `role=OWNER` â€” nunca calculado por
 * varredura, sempre mantido transacionalmente na mesma `TransactWriteItems` que qualquer
 * mudanÃ§a de Membership que o afete (Â§8 do physical model; seed em `CreateOrganization`,
 * Wave B2B-3.3; decremento em mudanÃ§as de role/status fica para Wave B2B-7/B2B-8, quando
 * existir um writer real de Membership alÃ©m da criaÃ§Ã£o â€” ver nota de escopo em
 * docs/architecture/multi-user-b2b-wave-tracker.md B2B-3).
 */
import type { EntityKey } from "../../../shared/dynamodb/occ.js";
import type { AuthorizedTenantId } from "../../identity/domain/authorization.js";

export interface Organization extends EntityKey {
  SK: "META";
  entityType: "Organization";
  organizationId: string;
  displayName: string;
  timezone: string;
  defaultQuietHours?: { start: string; end: string };
  ownerCount: number;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export function organizationKey(organizationId: AuthorizedTenantId): { PK: string; SK: "META" } {
  return { PK: `TENANT#${organizationId}#ORG#${organizationId}`, SK: "META" };
}

/**
 * Membership â€” Multi-User B2B Wave B2B-3 (docs/architecture/multi-user-b2b-physical-model.md
 * Â§5, `APPROVED` D-086). Mesma partiÃ§Ã£o do `Organization` (domain/organization.ts):
 * `PK=TENANT#<organizationId>#ORG#<organizationId>`, `SK=MEMBER#<userId>`.
 *
 * TrÃªs estados, nunca hard-delete (mesmo padrÃ£o de retenÃ§Ã£o/auditoria jÃ¡ usado por
 * `AuditEvent`/W3-07 neste projeto): `REMOVED` substitui remoÃ§Ã£o fÃ­sica â€” a linha permanece,
 * sÃ³ o `status` muda. `SUSPENDED` ainda Ã‰ membro (conta para `ownerCount` se `role=OWNER`,
 * sem acesso operacional); reversÃ­vel sÃ³ por aÃ§Ã£o administrativa explÃ­cita (fora do escopo
 * desta wave). `REMOVED` Ã© o Ãºnico estado que um reingresso via convite pode sobrescrever
 * (Wave B2B-8, physical model Â§9 â€” `Update` condicionado a
 * `attribute_not_exists(PK) OR #status = :REMOVED`, nÃ£o implementado ainda nesta wave).
 *
 * `GSI4PK`/`GSI4SK` sÃ³ existem neste tipo de item â€” Ã­ndice esparso, verificado seguro contra
 * o resto do schema (Wave B2B-1, rodada de design). GSI4 Ã© EVENTUALLY CONSISTENT por natureza
 * do DynamoDB e NUNCA Ã© fonte de autorizaÃ§Ã£o (physical model Â§6): serve sÃ³ para listar
 * Organizations de um usuÃ¡rio (`GET /me`, seletor) â€” resoluÃ§Ã£o de `RequestContext`/decisÃ£o de
 * acesso sempre faz `GetItem` direto na partiÃ§Ã£o base via `membershipKey()`, nunca via GSI4.
 */
import type { EntityKey } from "../../../shared/dynamodb/occ.js";
import type { AuthorizedTenantId } from "../../identity/domain/authorization.js";

export type MembershipRole = "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";
export type MembershipStatus = "ACTIVE" | "SUSPENDED" | "REMOVED";

export interface Membership extends EntityKey {
  SK: string; // MEMBER#<userId>
  entityType: "Membership";
  membershipId: string;
  organizationId: string;
  userId: string;
  role: MembershipRole;
  status: MembershipStatus;
  joinedAt: string;
  createdBy: string;
  /** Set only when status transitions to REMOVED (remove-membership.ts/leave-organization.ts);
   * cleared on reactivation (accept-invitation.ts). Absent for a Membership never removed.
   * The clock the ACCOUNT_ACTIVE LGPD purge worker needs for "encerramento + 30 dias"
   * (privacy-lgpd.md Â§4, D-127/D-155/D-157 â€” this field was the missing blocker). */
  removedAt?: string;
  version: number;
  GSI4PK: string;
  GSI4SK: string;
  /** MaintenanceDueIndex pointer (D-179/D-180) â€” written atomically in the SAME transaction
   * that sets status=REMOVED (never a separate write), cleared atomically on reactivation
   * (accept-invitation.ts). Sparse: absent for any Membership that was never removed, so it
   * never appears in a GSI8 query until there is a real due date. GSI8 is discovery-only
   * (never a source of eligibility) â€” membership-purge-worker.ts revalidates the base item
   * via deriveMembershipMaintenanceDue() before acting on any candidate this produces. */
  GSI8PK?: string;
  GSI8SK?: string;
  /** Observed-on-revalidation retry counter for the GSI8 claim/revalidation transaction (D-179
   * Â§8 poison-record handling) â€” incremented only when the atomic tenant-ACTIVE ConditionCheck
   * fails (never recomputed speculatively), drives the capped exponential backoff of GSI8SK and
   * the move to the DLQ#MEMBERSHIP_PURGE namespace above MAX_ATTEMPTS. Absent until the first
   * failed claim attempt. */
  maintenanceAttemptCount?: number;
}

export function membershipKey(organizationId: AuthorizedTenantId, userId: string): { PK: string; SK: string } {
  return { PK: `TENANT#${organizationId}#ORG#${organizationId}`, SK: `MEMBER#${userId}` };
}

/** `MembershipByUser` (GSI4, reaproveitado â€” nÃ£o Ã© GSI novo, Â§6 do physical model). Resolve
 * "quais Organizations este usuÃ¡rio pode acessar" sem tenant prÃ©vio. */
export function membershipGsi4Keys(userId: string, organizationId: AuthorizedTenantId, membershipId: string): { GSI4PK: string; GSI4SK: string } {
  return {
    GSI4PK: `USER#${userId}`,
    GSI4SK: `ORG#${organizationId}#MEMBERSHIP#${membershipId}`,
  };
}

/** D-127 Prioridade 5's "encerramento + 30 dias" retention window for a REMOVED Membership row
 * â€” the same clock D-155/D-158 established, now also the source of `deriveMembershipMaintenanceDue()`'s
 * due date (D-179/D-180). */
export const MEMBERSHIP_RETENTION_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** GSI8 (MaintenanceDueIndex, D-179) namespace this worker owns â€” the ONLY value any
 * membership-purge-scoped IAM policy's `dynamodb:LeadingKeys` condition may reference
 * (`infra/modules/dynamo-table/main.tf`), alongside the DLQ counterpart below. */
export const MEMBERSHIP_PURGE_WORK_TYPE = "MEMBERSHIP_PURGE";

export interface MaintenanceDue {
  dueAtIso: string;
}

/**
 * Pure `deriveMaintenanceDue()` for `Membership` (D-179 Â§2) â€” the single source of truth for
 * "when does this row become a membership-purge candidate", reused by all 3 consumers the
 * design names: the writer of the GSI8 pointer at the real REMOVED transition
 * (`remove-membership.ts`/`leave-organization.ts`), the backfill script
 * (`scripts/backfill-gsi8-membership-purge.ts`), and the worker's own revalidation step
 * (`membership-purge/purge.ts` â€” GSI8 is discovery-only, NEVER a source of eligibility, so
 * every candidate the index returns is re-derived from the base item before being acted on).
 * `undefined` means "this row can never be a candidate in its current state" (still ACTIVE/
 * SUSPENDED, or a pre-D-158 REMOVED row with no `removedAt`) â€” never "not yet due", which is
 * instead a `dueAtIso` in the future.
 */
export function deriveMembershipMaintenanceDue(membership: Pick<Membership, "status" | "removedAt">): MaintenanceDue | undefined {
  if (membership.status !== "REMOVED" || !membership.removedAt) return undefined;
  const dueAtMs = Date.parse(membership.removedAt) + MEMBERSHIP_RETENTION_DAYS * MS_PER_DAY;
  return { dueAtIso: new Date(dueAtMs).toISOString() };
}

/** `GSI8PK=WORK#MEMBERSHIP_PURGE` / `GSI8SK=<dueAtIso>#TENANT#<tenantId>#<membershipId>`
 * (D-179's exact key spec) â€” `tenantId` embedded in the sort key lets the worker revalidate
 * the atomic tenant-ACTIVE `ConditionCheck` straight off a `KEYS_ONLY` Query result, without a
 * second read just to learn which tenant a candidate belongs to. */
export function membershipGsi8Keys(input: { dueAtIso: string; tenantId: AuthorizedTenantId; membershipId: string }): { GSI8PK: string; GSI8SK: string } {
  return {
    GSI8PK: `WORK#${MEMBERSHIP_PURGE_WORK_TYPE}`,
    GSI8SK: `${input.dueAtIso}#TENANT#${input.tenantId}#${input.membershipId}`,
  };
}

/**
 * Invitation â€” Multi-User B2B Wave B2B-8 (docs/architecture/multi-user-b2b-physical-model.md
 * Â§7, `APPROVED` D-086; escopo final `APPROVED` D-099, docs/architecture/multi-user-b2b-wave-
 * b2b8-scope.md). Mesma partiÃ§Ã£o do `Organization`/`Membership`
 * (`PK=TENANT#<organizationId>#ORG#<organizationId>`), `SK=INVITATION#<invitationId>`.
 *
 * `emailNormalized` usa a MESMA funÃ§Ã£o de normalizaÃ§Ã£o jÃ¡ usada por `GlobalUser`/
 * `IdentityMapping` (physical model Â§1) â€” nunca reimplementada aqui.
 */
import type { EntityKey } from "../../../shared/dynamodb/occ.js";
import type { AuthorizedTenantId } from "../../identity/domain/authorization.js";
import type { MembershipRole } from "./membership.js";

export type InvitationStatus = "PENDING" | "ACCEPTED" | "REVOKED" | "EXPIRED";

export interface Invitation extends EntityKey {
  SK: string; // INVITATION#<invitationId>
  entityType: "Invitation";
  invitationId: string;
  organizationId: string;
  emailNormalized: string;
  role: MembershipRole;
  status: InvitationStatus;
  tokenPointerId: string;
  expiresAt: string;
  createdBy: string;
  createdAt: string;
  acceptedAt?: string;
  revokedAt?: string;
  version: number;
  /** MaintenanceDueIndex pointer (D-179/slice 2) â€” unlike Membership's removal-time write, the
   * PENDING branch's due date (`expiresAt + 30 days`) is already fully known at creation (D-179
   * Â§2's "writer of the entity writes the pointer at the real transition" reused literally:
   * creation IS that transition for a PENDING row, there is no later discrete event to hang it
   * on), so `create-invitation.ts` stamps this at Put time, not just at revoke. `revoke-
   * invitation.ts` overwrites it (revocation can move the due date earlier than the original
   * PENDING expiry). `accept-invitation.ts` clears it (ACCEPTED is never a candidate). Sparse:
   * absent only for a never-eligible status (ACCEPTED/EXPIRED). */
  GSI8PK?: string;
  GSI8SK?: string;
  /** Same D-179 Â§8 poison-record retry counter as `Membership.maintenanceAttemptCount` â€” observed
   * on revalidation, drives capped exponential backoff / DLQ#INVITATION_PURGE quarantine. */
  maintenanceAttemptCount?: number;
}

export function invitationKey(organizationId: AuthorizedTenantId, invitationId: string): { PK: string; SK: string } {
  return { PK: `TENANT#${organizationId}#ORG#${organizationId}`, SK: `INVITATION#${invitationId}` };
}

/** Dedup pointer PENDING por (org, e-mail) â€” tenant-scoped por desvio deliberado (physical
 * model Â§7: `organizationId` jÃ¡ Ã© conhecido no momento de criar o convite). Um `Invitation`
 * PENDING por (org, e-mail) por vez â€” criar um novo enquanto este existe vira reenvio/rotaÃ§Ã£o
 * do convite existente, nunca um segundo `Invitation` PENDING. */
export interface InvitationDedupPointer extends EntityKey {
  SK: string; // INVITE_DEDUP#<emailNormalized>
  entityType: "InvitationDedupPointer";
  invitationId: string;
  organizationId: string;
  emailNormalized: string;
  expiresAt: string;
}

export function invitationDedupKey(organizationId: AuthorizedTenantId, emailNormalized: string): { PK: string; SK: string } {
  return { PK: `TENANT#${organizationId}#ORG#${organizationId}`, SK: `INVITE_DEDUP#${emailNormalized}` };
}

/** D-155's "encerramento + 30 dias" retention window, now also the source of
 * `deriveInvitationMaintenanceDue()`'s due date (D-179 slice 2) â€” same constant shape as
 * `MEMBERSHIP_RETENTION_DAYS`. */
export const INVITATION_RETENTION_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** GSI8 (MaintenanceDueIndex, D-179) namespace this worker owns â€” the ONLY value any
 * invitation-purge-scoped IAM policy's `dynamodb:LeadingKeys` condition may reference
 * (`infra/modules/dynamo-table/main.tf`), alongside the DLQ counterpart. */
export const INVITATION_PURGE_WORK_TYPE = "INVITATION_PURGE";

export interface MaintenanceDue {
  dueAtIso: string;
}

/**
 * Pure `deriveMaintenanceDue()` for `Invitation` (D-179 Â§2/slice 2) â€” single source of truth for
 * "when does this row become an invitation-purge candidate", reused by the same 3 consumers as
 * `deriveMembershipMaintenanceDue()`: the writer(s) of the GSI8 pointer at the real transition(s)
 * (`create-invitation.ts`/`revoke-invitation.ts`/`accept-invitation.ts`), the backfill script
 * (`scripts/backfill-gsi8-invitation-purge.ts`), and the worker's own revalidation step
 * (`invitation-purge/purge.ts`).
 *
 * Two branches, same as the pre-GSI8 `terminalTimestamp()`/`isPurgeEligibleByTermination()` pair
 * this replaces:
 *   - `REVOKED` with `revokedAt` â€” due at `revokedAt + RETENTION_DAYS`.
 *   - `PENDING` â€” due at `expiresAt + RETENTION_DAYS`, ALWAYS computable (unlike Membership's
 *     REMOVED branch, `expiresAt` is set at creation and never absent for a PENDING row) â€” this is
 *     exactly why the GSI8 pointer for this branch is written at creation time, not at a later
 *     transition: the due date is already fully known then, and there is no other discrete event
 *     ("became terminal") to hang the write on, since a PENDING row's eventual expiry is pure time
 *     passing, never a state-changing write.
 * `undefined` for `ACCEPTED`/`EXPIRED` (never a real candidate) or a malformed REVOKED row missing
 * `revokedAt` (fail-closed defense in depth, same posture as Membership's pre-D-158 REMOVED row).
 */
export function deriveInvitationMaintenanceDue(invitation: Pick<Invitation, "status" | "revokedAt" | "expiresAt">): MaintenanceDue | undefined {
  if (invitation.status === "REVOKED") {
    if (!invitation.revokedAt) return undefined;
    return { dueAtIso: new Date(Date.parse(invitation.revokedAt) + INVITATION_RETENTION_DAYS * MS_PER_DAY).toISOString() };
  }
  if (invitation.status === "PENDING") {
    return { dueAtIso: new Date(Date.parse(invitation.expiresAt) + INVITATION_RETENTION_DAYS * MS_PER_DAY).toISOString() };
  }
  return undefined;
}

/** `GSI8PK=WORK#INVITATION_PURGE` / `GSI8SK=<dueAtIso>#TENANT#<tenantId>#<invitationId>` (D-179's
 * exact key spec, same shape as `membershipGsi8Keys()`). */
export function invitationGsi8Keys(input: { dueAtIso: string; tenantId: AuthorizedTenantId; invitationId: string }): { GSI8PK: string; GSI8SK: string } {
  return {
    GSI8PK: `WORK#${INVITATION_PURGE_WORK_TYPE}`,
    GSI8SK: `${input.dueAtIso}#TENANT#${input.tenantId}#${input.invitationId}`,
  };
}


exec
"C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -Command "rg -n '\"(GET|POST|PUT|PATCH|DELETE) /' src/modules src/runtime/aws/handlers | Sort-Object; rg -n 'const ROUTES|missing-requirements|requirements-by|review.queue|reviewQueue|dashboard|report' src/modules/document-archive src/runtime/aws/handlers/reports-handler.ts" in C:\Users\Usuario\Desktop\projects\expiration-tracker
 succeeded in 553ms:
src/runtime/aws/handlers/reports-handler.ts:3: * all 7 `GET /reports/*` routes — same reasoning as `export-handler.ts` (D-123/D-126): a raw
src/runtime/aws/handlers/reports-handler.ts:7: * (`content-type`/`etag`) would silently drop `content-disposition`/`x-report-truncated`,
src/runtime/aws/handlers/reports-handler.ts:15:import { buildReportsDeps } from "../composition/reports.js";
src/runtime/aws/handlers/reports-handler.ts:25:} from "../../../modules/reports/http/reports-handler.js";
src/runtime/aws/handlers/reports-handler.ts:34:const reportExportsBucketName = process.env["REPORT_EXPORTS_BUCKET_NAME"];
src/runtime/aws/handlers/reports-handler.ts:36:if (!reportExportsBucketName) throw new Error("REPORT_EXPORTS_BUCKET_NAME env var is required.");
src/runtime/aws/handlers/reports-handler.ts:38:const { reports, subscriptions, subscriptionStore, exportStore } = buildReportsDeps(client, tableName, reportExportsBucketName);
src/runtime/aws/handlers/reports-handler.ts:39:const deps = { resolver, reports, subscriptions, quota, subscriptionStore, exportStore };
src/runtime/aws/handlers/reports-handler.ts:54:  // the CSV report routes below - never through `handleReportsRoute`'s CSV-only ROUTES map.
src/runtime/aws/handlers/reports-handler.ts:56:    case "POST /reports/subscriptions":
src/runtime/aws/handlers/reports-handler.ts:58:    case "GET /reports/subscriptions":
src/runtime/aws/handlers/reports-handler.ts:60:    case "GET /reports/subscriptions/{subscriptionId}":
src/runtime/aws/handlers/reports-handler.ts:62:    case "POST /reports/subscriptions/{subscriptionId}/delete":
src/runtime/aws/handlers/reports-handler.ts:64:    case "GET /reports/subscriptions/{subscriptionId}/runs/{runId}/download":
src/modules/document-archive\ports\dossier-export-store.ts:4: * presign-on-demand) both need. Reuses the SAME `report_exports` bucket D-204's
src/modules/document-archive\ports\dossier-export-store.ts:6: * `infra/main.tf`'s `aws_s3_bucket.report_exports`) under a distinct key prefix — a dossier
src/modules/document-archive\ports\dossier-export-store.ts:7: * export has the identical retention/security profile a scheduled report does, so this is
src/modules/document-archive\ports\document-archive-store.ts:23: * status+responsible, GSI5 for the review queue and version lookup — D-143 Decision 2), so a
src/modules/document-archive\ports\document-archive-store.ts:54:   * best-effort dashboard render (D-143 Decision 2 keeps `ConsistentRead` on throughout,
src/modules/document-archive\persistence\dynamodb-guest-credential-delivery-marker-store.ts:76:    // A plain GetItem here is safe (no write), used only to report the right outcome kind.
src/modules/document-archive\persistence\s3-dossier-export-store.ts:1:/** Real S3 adapter for DossierExportStore (D-205 fatia 2/3). Reuses the SAME `report_exports`
src/modules/document-archive\application\guest-document-access-service.ts:55:import { documentVersionKey, reviewQueueGsi5Keys, type DocumentVersion } from "../domain/document-version.js";
src/modules/document-archive\application\guest-document-access-service.ts:412:      ...reviewQueueGsi5Keys(tenantId, "RECEIVED", now, versionId),
src/modules/document-archive\http\document-archive-handlers.ts:334:/** Roadmap P0.6 (dashboard operacional/compliance básico), fatia 2 — GET
src/modules/document-archive\http\document-archive-handlers.ts:356: * the same position (same precedent `main.tf`'s `GET /items/dashboard` comment documents). */
src/modules/document-archive\application\document-archive-service.ts:113:  reviewQueueGsi5Keys,
src/modules/document-archive\application\document-archive-service.ts:723:    const gsi5 = reviewQueueGsi5Keys(tenantId, "RECEIVED", now, current.versionId);
src/modules/document-archive\application\document-archive-service.ts:754:    const gsi5 = reviewQueueGsi5Keys(tenantId, "UNDER_REVIEW", now, current.versionId);
src/modules/document-archive\application\document-archive-service.ts:1175:   * longer applicable, reporting "name X collided" would be misleading; likewise for the Subject.
src/modules/document-archive\application\document-archive-service.ts:1231:   * Roadmap P0.6 (dashboard operacional/compliance básico), fatia 2 — reuses the exact same
src/modules/document-archive\application\document-archive-service.ts:1380:   * decision 10 - no assignee/recipient fallback tier, unlike D-204's report download route:
src/modules/document-archive\application\document-archive-service.ts:1557:   * already claimed by the sparse review-queue index and is removed exactly when a version
src/modules/document-archive\application\document-archive-service.ts:2457:   * Subject — an incomplete plan would silently under-report skips. */
src/modules/document-archive\domain\document-request-series.ts:28: * two sparse namespaces, review-queue and version-lookup, which this access pattern doesn't
src/modules/document-archive\domain\document-request-series.ts:100: * against a status-scoped partition, same shape as `reviewQueueGsi5Keys`'s access pattern.
src/modules/document-archive\domain\document-version.ts:70:  /** Present only while state IN (RECEIVED, UNDER_REVIEW) — sparse GSI5 review-queue entry
src/modules/document-archive\domain\document-version.ts:87:/** AP5 sparse review-queue index — separate buckets per real state (never a fixed `RECEIVED`
src/modules/document-archive\domain\document-version.ts:89:export function reviewQueueGsi5Keys(
src/modules/document-archive\domain\requirement.ts:67:   * the sparse review-queue index (`document-version.ts`'s `reviewQueueGsi5Keys`), which
src/modules/document-archive\domain\dossier-export-run.ts:27: * `aws_s3_bucket_lifecycle_configuration.report_exports` already established (D-215 decision 6,
src/modules/document-archive\domain\dossier-export-run.ts:77:/** Same 30-day figure as `aws_s3_bucket_lifecycle_configuration.report_exports` (D-215 decision

exec
"C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -Command "Get-Content src/modules/document-archive/http/document-archive-handlers.ts | Select-Object -First 430; Get-Content -Raw src/modules/reports/http/reports-handler.ts; rg -n 'document_archive_routes|path\\s*=\\s*\"/document-archive|reports_routes|path\\s*=\\s*\"/reports' infra/main.tf infra/modules/api-gateway/*.tf" in C:\Users\Usuario\Desktop\projects\expiration-tracker
2026-09-09T01:57:26.788687Z ERROR codex_core::tools::router: error=Exit code: 1
Wall time: 0.6 seconds
Output:
/**
 * HTTP handlers for the Document Archive module (D-143 Nucleus 1) â€” mirrors
 * `src/modules/expiration/http/item-handlers.ts`'s exact pipeline (resolve context ->
 * service, which internally calls authorize() -> schema validation before the service call
 * -> AppError -> status-code mapping), so this module fails the same way as every other
 * route in the system.
 */
import { AppError, AuthorizationError, ConflictError, ValidationError, toAppError } from "../../../shared/errors/app-error.js";
import { AuthorizationDeniedError, authorizedTenantId } from "../../identity/domain/authorization.js";
import { auditAuthorizationDenied } from "../../../shared/observability/security-audit.js";
import { defaultSchemaRegistry } from "../../../shared/contracts/schema-validator.js";
import { encodeSearchCursor, decodeSearchCursor } from "../../../shared/domain/search-cursor.js";
import type { UnifiedValidityState } from "../../../shared/domain/validity-state.js";
import type { RequestContextResolver, ValidatedClaims } from "../../identity/application/resolve-request-context.js";
import type { TenantQuotaService } from "../../identity/application/quota.js";
import type { DocumentArchiveService } from "../application/document-archive-service.js";
import type { DocumentRequestRecurrenceService } from "../application/document-request-recurrence-service.js";
import type { CreateDocumentInput } from "../domain/document.js";
import type { FileUploadSpec } from "../domain/document-file.js";
import type { DocumentVersionOrigin, RejectionReason } from "../domain/document-version.js";
import type { CreateRequirementInput, RequirementStatus, UpdateRequirementInput } from "../domain/requirement.js";
import type { CreateDocumentRequestSeriesInput } from "../domain/document-request-series.js";
import type { CreateDocumentTypeInput, CreateDocumentTypeMetadataFieldInput, DocumentType, UpdateDocumentTypeMetadataFieldInput } from "../domain/document-type.js";
import type { DocumentMetadataValueInput } from "../domain/document.js";
import type { CreateRequirementTemplateInput, RequirementTemplate, UpdateRequirementTemplateInput } from "../domain/requirement-template.js";
import type { DossierExportFormat, DossierExportStore } from "../ports/dossier-export-store.js";

function validateAgainstSchema(schemaId: string, body: unknown): void {
  const { valid, errors } = defaultSchemaRegistry.validate(schemaId, body);
  if (!valid) {
    throw new ValidationError("Request body failed schema validation.", { errors });
  }
}

const CREATE_SCHEMA_ID = "https://expiration-tracker/schemas/api/docarchive-create-request.v1.json";
const RESERVE_UPLOAD_SCHEMA_ID = "https://expiration-tracker/schemas/api/docarchive-reserve-upload-request.v1.json";
const RESERVE_FILES_SCHEMA_ID = "https://expiration-tracker/schemas/api/docarchive-reserve-files-request.v1.json";
const COMMIT_UPLOAD_SCHEMA_ID = "https://expiration-tracker/schemas/api/docarchive-commit-upload-request.v1.json";
const CLAIM_REVIEW_SCHEMA_ID = "https://expiration-tracker/schemas/api/docarchive-claim-review-request.v1.json";
const ACCEPT_VERSION_SCHEMA_ID = "https://expiration-tracker/schemas/api/docarchive-accept-version-request.v1.json";
const REJECT_VERSION_SCHEMA_ID = "https://expiration-tracker/schemas/api/docarchive-reject-version-request.v1.json";
const REQUIREMENT_CREATE_SCHEMA_ID = "https://expiration-tracker/schemas/api/docarchive-requirement-create-request.v1.json";
const REQUIREMENT_UPDATE_SCHEMA_ID = "https://expiration-tracker/schemas/api/docarchive-requirement-update-request.v1.json";
const REQUIREMENT_LINK_EVIDENCE_SCHEMA_ID = "https://expiration-tracker/schemas/api/docarchive-requirement-link-evidence-request.v1.json";
const REQUIREMENT_UNLINK_EVIDENCE_SCHEMA_ID = "https://expiration-tracker/schemas/api/docarchive-requirement-unlink-evidence-request.v1.json";
const REQUIREMENT_DELETE_SCHEMA_ID = "https://expiration-tracker/schemas/api/docarchive-requirement-delete-request.v1.json";
const REQUIREMENT_SEARCH_SCHEMA_ID = "https://expiration-tracker/schemas/api/docarchive-requirement-search-request.v1.json";
const SERIES_CREATE_SCHEMA_ID = "https://expiration-tracker/schemas/api/docarchive-series-create-request.v1.json";
const SERIES_CANCEL_SCHEMA_ID = "https://expiration-tracker/schemas/api/docarchive-series-cancel-request.v1.json";
const SERIES_MATERIALIZE_SCHEMA_ID = "https://expiration-tracker/schemas/api/docarchive-series-materialize-request.v1.json";
const SERIES_UPDATE_RECIPIENT_SCHEMA_ID = "https://expiration-tracker/schemas/api/docarchive-series-update-recipient-request.v1.json";
const DOCUMENTTYPE_CREATE_SCHEMA_ID = "https://expiration-tracker/schemas/api/docarchive-documenttype-create-request.v1.json";
const DOCUMENTTYPE_RENAME_SCHEMA_ID = "https://expiration-tracker/schemas/api/docarchive-documenttype-rename-request.v1.json";
const DOCUMENTTYPE_DEPRECATE_SCHEMA_ID = "https://expiration-tracker/schemas/api/docarchive-documenttype-deprecate-request.v1.json";
const DOCUMENTTYPE_REACTIVATE_SCHEMA_ID = "https://expiration-tracker/schemas/api/docarchive-documenttype-reactivate-request.v1.json";
const REQTEMPLATE_CREATE_SCHEMA_ID = "https://expiration-tracker/schemas/api/docarchive-requirementtemplate-create-request.v1.json";
const REQTEMPLATE_UPDATE_SCHEMA_ID = "https://expiration-tracker/schemas/api/docarchive-requirementtemplate-update-request.v1.json";
const REQTEMPLATE_DUPLICATE_SCHEMA_ID = "https://expiration-tracker/schemas/api/docarchive-requirementtemplate-duplicate-request.v1.json";
const REQTEMPLATE_ARCHIVE_SCHEMA_ID = "https://expiration-tracker/schemas/api/docarchive-requirementtemplate-archive-request.v1.json";
const REQTEMPLATE_UNARCHIVE_SCHEMA_ID = "https://expiration-tracker/schemas/api/docarchive-requirementtemplate-unarchive-request.v1.json";
const REQTEMPLATE_PREVIEW_SCHEMA_ID = "https://expiration-tracker/schemas/api/docarchive-requirementtemplate-preview-request.v1.json";
const REQTEMPLATE_APPLY_SCHEMA_ID = "https://expiration-tracker/schemas/api/docarchive-requirementtemplate-apply-request.v1.json";
const DOSSIER_CONFIRM_SCHEMA_ID = "https://expiration-tracker/schemas/api/docarchive-dossier-confirm-request.v1.json";
const DOCUMENTTYPE_METADATA_FIELD_CREATE_SCHEMA_ID = "https://expiration-tracker/schemas/api/docarchive-documenttype-metadata-field-create-request.v1.json";
const DOCUMENTTYPE_METADATA_FIELD_UPDATE_SCHEMA_ID = "https://expiration-tracker/schemas/api/docarchive-documenttype-metadata-field-update-request.v1.json";
const DOCUMENT_METADATA_VALUES_UPDATE_SCHEMA_ID = "https://expiration-tracker/schemas/api/docarchive-document-metadata-values-update-request.v1.json";

export interface HttpRequest<TBody = unknown> {
  requestId: string;
  correlationId: string;
  claims: ValidatedClaims;
  pathParameters?: Record<string, string | undefined>;
  queryStringParameters?: Record<string, string | undefined>;
  headers?: Record<string, string | undefined>;
  body?: TBody;
}

export interface HttpResponse {
  statusCode: number;
  body: Record<string, unknown>;
}

export interface DocumentArchiveHttpDeps {
  resolver: RequestContextResolver;
  documentArchive: DocumentArchiveService;
  recurrence: DocumentRequestRecurrenceService;
  quota: TenantQuotaService;
  /** D-205 fatia 3 (decision 9): only the dossier download route needs this - optional so every
   * OTHER caller of this Lambda/module (all the routes above) keeps working unchanged. */
  dossierExportStore?: DossierExportStore;
}

const STATUS_BY_CATEGORY: Record<string, number> = {
  VALIDATION: 400,
  AUTH: 401,
  AUTHORIZATION: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  QUOTA_EXCEEDED: 429,
  DEPENDENCY_UNAVAILABLE: 503,
  INTERNAL: 500,
  BUSINESS_RULE: 422,
};

function toResponse(appError: AppError): HttpResponse {
  const status = STATUS_BY_CATEGORY[appError.category] ?? 500;
  return { statusCode: status, body: appError.toJSON() };
}

async function withErrorMapping(fn: () => Promise<HttpResponse>): Promise<HttpResponse> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof AuthorizationDeniedError) {
      auditAuthorizationDenied({ reason: err.reason, action: err.action });
      return toResponse(new AuthorizationError(err.message, { reason: err.reason }));
    }
    const appError = err instanceof AppError ? err : toAppError(err);
    return toResponse(appError);
  }
}

/** full-audit round1/Seguranca criterio 9 (Resistencia a Abuso/DoS) â€” same limit/window as
 * every other business route (item-handlers.ts's consumeApiRequestQuota), applied here too
 * rather than leaving this module's real business writes unmetered. */
async function consumeApiRequestQuota(quota: TenantQuotaService, tenantId: string): Promise<void> {
  await quota.consume({ tenantId, quotaType: "API_REQUEST", window: "current", limit: 100, windowSeconds: 60 });
}

function requireDocumentId(req: HttpRequest): string {
  const documentId = req.pathParameters?.["documentId"];
  if (!documentId) throw new ValidationError("Missing documentId path parameter.");
  return documentId;
}

function requireSeq(req: HttpRequest): number {
  const raw = req.pathParameters?.["seq"];
  const seq = Number(raw);
  if (!raw || !Number.isInteger(seq) || seq < 1) {
    throw new ValidationError("Missing or invalid seq path parameter.");
  }
  return seq;
}

function requireSubjectId(req: HttpRequest): string {
  const subjectId = req.pathParameters?.["subjectId"];
  if (!subjectId) throw new ValidationError("Missing subjectId path parameter.");
  return subjectId;
}

function requireRequirementId(req: HttpRequest): string {
  const requirementId = req.pathParameters?.["requirementId"];
  if (!requirementId) throw new ValidationError("Missing requirementId path parameter.");
  return requirementId;
}

function requireSeriesId(req: HttpRequest): string {
  const seriesId = req.pathParameters?.["seriesId"];
  if (!seriesId) throw new ValidationError("Missing seriesId path parameter.");
  return seriesId;
}

function requireDocumentTypeId(req: HttpRequest): string {
  const documentTypeId = req.pathParameters?.["documentTypeId"];
  if (!documentTypeId) throw new ValidationError("Missing documentTypeId path parameter.");
  return documentTypeId;
}

function requireRunId(req: HttpRequest): string {
  const runId = req.pathParameters?.["runId"];
  if (!runId) throw new ValidationError("Missing runId path parameter.");
  return runId;
}

function requireFieldId(req: HttpRequest): string {
  const fieldId = req.pathParameters?.["fieldId"];
  if (!fieldId) throw new ValidationError("Missing fieldId path parameter.");
  return fieldId;
}

/** Defaults to ACTIVE (the catalog a document-create flow actually needs) rather than requiring
 * every caller to pass `?status=ACTIVE` explicitly â€” DEPRECATED is opt-in via the query param. */
function requireDocumentTypeStatus(req: HttpRequest): DocumentType["status"] {
  const raw = req.queryStringParameters?.["status"];
  if (!raw) return "ACTIVE";
  if (raw !== "ACTIVE" && raw !== "DEPRECATED") throw new ValidationError("Invalid status query parameter.", { status: raw });
  return raw;
}

async function resolve(deps: DocumentArchiveHttpDeps, req: HttpRequest) {
  const context = await deps.resolver.resolve({
    claims: req.claims,
    requestId: req.requestId,
    correlationId: req.correlationId,
    organizationIdHint: req.headers?.["x-organization-id"],
  });
  await consumeApiRequestQuota(deps.quota, context.tenant.tenantId);
  return context;
}

export async function handleCreateDocument(deps: DocumentArchiveHttpDeps, req: HttpRequest<CreateDocumentInput>): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    if (!req.body) throw new ValidationError("Missing request body.");
    validateAgainstSchema(CREATE_SCHEMA_ID, req.body);
    const context = await resolve(deps, req);
    const document = await deps.documentArchive.createDocument(context, req.body);
    return { statusCode: 201, body: { document } };
  });
}

export async function handleGetDocument(deps: DocumentArchiveHttpDeps, req: HttpRequest): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const documentId = requireDocumentId(req);
    const context = await resolve(deps, req);
    const document = await deps.documentArchive.getDocument(context, documentId);
    return { statusCode: 200, body: { document } };
  });
}

export async function handleListVersions(deps: DocumentArchiveHttpDeps, req: HttpRequest): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const documentId = requireDocumentId(req);
    const context = await resolve(deps, req);
    const versions = await deps.documentArchive.listVersions(context, documentId);
    return { statusCode: 200, body: { versions } };
  });
}

export async function handleReserveUpload(deps: DocumentArchiveHttpDeps, req: HttpRequest<{ origin: DocumentVersionOrigin }>): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const documentId = requireDocumentId(req);
    if (!req.body) throw new ValidationError("Missing request body.");
    validateAgainstSchema(RESERVE_UPLOAD_SCHEMA_ID, req.body);
    const context = await resolve(deps, req);
    const version = await deps.documentArchive.reserveUpload(context, documentId, req.body.origin);
    return { statusCode: 201, body: { version } };
  });
}

export async function handleReserveFiles(
  deps: DocumentArchiveHttpDeps,
  req: HttpRequest<{ expectedVersion: number; files: readonly FileUploadSpec[] }>,
): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const documentId = requireDocumentId(req);
    const seq = requireSeq(req);
    if (!req.body) throw new ValidationError("Missing request body.");
    validateAgainstSchema(RESERVE_FILES_SCHEMA_ID, req.body);
    const context = await resolve(deps, req);
    const reserved = await deps.documentArchive.reserveFiles(context, documentId, seq, req.body.expectedVersion, req.body.files);
    return { statusCode: 201, body: { files: reserved } };
  });
}

export async function handleCommitUpload(deps: DocumentArchiveHttpDeps, req: HttpRequest<{ expectedVersion: number }>): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const documentId = requireDocumentId(req);
    const seq = requireSeq(req);
    if (!req.body) throw new ValidationError("Missing request body.");
    validateAgainstSchema(COMMIT_UPLOAD_SCHEMA_ID, req.body);
    const context = await resolve(deps, req);
    const version = await deps.documentArchive.commitUpload(context, documentId, seq, req.body.expectedVersion);
    return { statusCode: 200, body: { version } };
  });
}

export async function handleClaimReview(deps: DocumentArchiveHttpDeps, req: HttpRequest<{ expectedVersion: number }>): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const documentId = requireDocumentId(req);
    const seq = requireSeq(req);
    if (!req.body) throw new ValidationError("Missing request body.");
    validateAgainstSchema(CLAIM_REVIEW_SCHEMA_ID, req.body);
    const context = await resolve(deps, req);
    const version = await deps.documentArchive.claimReview(context, documentId, seq, req.body.expectedVersion);
    return { statusCode: 200, body: { version } };
  });
}

export async function handleAcceptVersion(deps: DocumentArchiveHttpDeps, req: HttpRequest<{ expectedVersion: number; clientRequestToken: string }>): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const documentId = requireDocumentId(req);
    const seq = requireSeq(req);
    if (!req.body) throw new ValidationError("Missing request body.");
    validateAgainstSchema(ACCEPT_VERSION_SCHEMA_ID, req.body);
    const context = await resolve(deps, req);
    const result = await deps.documentArchive.acceptVersion(context, documentId, seq, req.body.expectedVersion, req.body.clientRequestToken);
    return { statusCode: 200, body: { ...result } };
  });
}

export async function handleRejectVersion(deps: DocumentArchiveHttpDeps, req: HttpRequest<{ expectedVersion: number; reason: RejectionReason }>): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const documentId = requireDocumentId(req);
    const seq = requireSeq(req);
    if (!req.body) throw new ValidationError("Missing request body.");
    validateAgainstSchema(REJECT_VERSION_SCHEMA_ID, req.body);
    const context = await resolve(deps, req);
    const version = await deps.documentArchive.rejectVersion(context, documentId, seq, req.body.expectedVersion, req.body.reason);
    return { statusCode: 200, body: { version } };
  });
}

// --- Requirement (D-143 Decision 5 / D9, D-145) ---------------------------------------------

export async function handleCreateRequirement(deps: DocumentArchiveHttpDeps, req: HttpRequest<CreateRequirementInput>): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    if (!req.body) throw new ValidationError("Missing request body.");
    validateAgainstSchema(REQUIREMENT_CREATE_SCHEMA_ID, req.body);
    const context = await resolve(deps, req);
    const requirement = await deps.documentArchive.createRequirement(context, req.body);
    return { statusCode: 201, body: { requirement } };
  });
}

export async function handleGetRequirement(deps: DocumentArchiveHttpDeps, req: HttpRequest): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const subjectId = requireSubjectId(req);
    const requirementId = requireRequirementId(req);
    const context = await resolve(deps, req);
    const requirement = await deps.documentArchive.getRequirement(context, subjectId, requirementId);
    return { statusCode: 200, body: { requirement } };
  });
}

export async function handleListRequirements(deps: DocumentArchiveHttpDeps, req: HttpRequest): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const subjectId = requireSubjectId(req);
    const context = await resolve(deps, req);
    const requirements = await deps.documentArchive.listRequirements(context, subjectId);
    return { statusCode: 200, body: { requirements } };
  });
}

/** Roadmap P0.6 (dashboard operacional/compliance bÃ¡sico), fatia 2 â€” GET
 * /document-archive/requirements/{subjectId}/compliance. Routed ABOVE
 * `/document-archive/requirements/{subjectId}/{requirementId}` in
 * `document-archive-handler.ts`'s switch (API Gateway itself resolves the literal `compliance`
 * segment over `{requirementId}` regardless of switch-case order - see that handler's own
 * routeKey comment) but the `PROXY_ALLOWLIST` array in `proxy-allowlist.ts` matches by
 * `.find()`, so THAT list must list this entry before the `{requirementId}` one. */
export async function handleGetSubjectCompliance(deps: DocumentArchiveHttpDeps, req: HttpRequest): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const subjectId = requireSubjectId(req);
    const context = await resolve(deps, req);
    const compliance = await deps.documentArchive.getSubjectCompliance(context, subjectId);
    return { statusCode: 200, body: { compliance } };
  });
}

const REQUIREMENT_STATUSES = new Set(["MISSING", "PENDING", "SATISFIED", "NOT_SATISFIED", "NOT_APPLICABLE"]);
const VALIDITY_STATES = new Set(["PERMANENTE", "VALIDO", "VENCENDO", "VENCIDO", "AGUARDANDO_REVISAO"]);

/** D-194 Fatia 3 â€” GET /document-archive/requirements/search. Route lives ABOVE
 * `/document-archive/requirements/{subjectId}` in `main.tf`/the switch below on purpose â€” API
 * Gateway v2 prioritizes the literal `search` segment over the `{subjectId}` path parameter at
 * the same position (same precedent `main.tf`'s `GET /items/dashboard` comment documents). */
export async function handleSearchRequirements(deps: DocumentArchiveHttpDeps, req: HttpRequest): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const qs = req.queryStringParameters ?? {};
    const queryObject: Record<string, string> = {};
    for (const key of ["status", "namePrefix", "assigneeUserId", "validityState", "cursor"] as const) {
      const value = qs[key];
      if (value !== undefined) queryObject[key] = value;
    }
    const { valid, errors } = defaultSchemaRegistry.validate(REQUIREMENT_SEARCH_SCHEMA_ID, queryObject);
    if (!valid) throw new ValidationError("Query parameters failed schema validation.", { errors });

    const status = queryObject["status"] as RequirementStatus | undefined;
    if (!status || !REQUIREMENT_STATUSES.has(status)) {
      throw new ValidationError("Invalid or missing status query parameter.", { allowed: [...REQUIREMENT_STATUSES] });
    }
    const validityState = queryObject["validityState"] as UnifiedValidityState | undefined;
    if (validityState !== undefined && !VALIDITY_STATES.has(validityState)) {
      throw new ValidationError("Invalid validityState query parameter.", { allowed: [...VALIDITY_STATES] });
    }
    const namePrefix = queryObject["namePrefix"];
    const assigneeUserId = queryObject["assigneeUserId"];
    const signature = { mode: "REQUIREMENT", status, namePrefix, assigneeUserId, validityState };
    const exclusiveStartKey = queryObject["cursor"] !== undefined ? decodeSearchCursor(queryObject["cursor"], signature) : undefined;

    const context = await resolve(deps, req);
    const page = await deps.documentArchive.searchRequirements(context, { status, namePrefix, assigneeUserId, validityState, exclusiveStartKey });
    return {
      statusCode: 200,
      body: {
        items: page.items,
        cursor: page.lastEvaluatedKey ? encodeSearchCursor(signature, page.lastEvaluatedKey) : null,
        scanLimitReached: page.scanLimitReached,
      },
    };
  });
}

export async function handleUpdateRequirement(deps: DocumentArchiveHttpDeps, req: HttpRequest<UpdateRequirementInput & { expectedVersion: number }>): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const subjectId = requireSubjectId(req);
    const requirementId = requireRequirementId(req);
    if (!req.body) throw new ValidationError("Missing request body.");
    validateAgainstSchema(REQUIREMENT_UPDATE_SCHEMA_ID, req.body);
    const context = await resolve(deps, req);
    const { expectedVersion, ...input } = req.body;
    const requirement = await deps.documentArchive.updateRequirement(context, subjectId, requirementId, expectedVersion, input);
    return { statusCode: 200, body: { requirement } };
  });
}

export async function handleLinkEvidence(
  deps: DocumentArchiveHttpDeps,
  req: HttpRequest<{ expectedVersion: number; documentId: string; versionId: string }>,
): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const subjectId = requireSubjectId(req);
    const requirementId = requireRequirementId(req);
    if (!req.body) throw new ValidationError("Missing request body.");
    validateAgainstSchema(REQUIREMENT_LINK_EVIDENCE_SCHEMA_ID, req.body);
    const context = await resolve(deps, req);
    const requirement = await deps.documentArchive.linkEvidence(context, subjectId, requirementId, req.body.expectedVersion, req.body.documentId, req.body.versionId);
    return { statusCode: 200, body: { requirement } };
  });
}

export async function handleUnlinkEvidence(deps: DocumentArchiveHttpDeps, req: HttpRequest<{ expectedVersion: number }>): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const subjectId = requireSubjectId(req);
    const requirementId = requireRequirementId(req);
    if (!req.body) throw new ValidationError("Missing request body.");
    validateAgainstSchema(REQUIREMENT_UNLINK_EVIDENCE_SCHEMA_ID, req.body);
    const context = await resolve(deps, req);
    const requirement = await deps.documentArchive.unlinkEvidence(context, subjectId, requirementId, req.body.expectedVersion);
    return { statusCode: 200, body: { requirement } };
/**
 * Roadmap P0.7 ("RelatÃ³rios, ExportaÃ§Ã£o e Audit Trail"), fatias 1-2. Dedicated CSV route family,
 * one Lambda serving all 7 GET /reports/* routes â€” same reasons `export-handler.ts`
 * (D-123/D-126) is its own module rather than folded into a generic JSON `HttpResponse` pipeline
 * (raw CSV body, `Content-Disposition`, no JSON envelope). A single dedicated module (not 7) is
 * a deliberate choice within the delegated engineering authority for this slice: every report
 * shares the identical CSV-building/RBAC/audit-free shape `export-handler.ts` already
 * established, so 7 near-identical Lambdas would duplicate infra wiring without a matching
 * behavioral difference (unlike `/items/export`'s own dedicated `timeout_seconds=25`, which
 * exists for a REAL reason â€” a page budget no other route shares).
 */
import { AppError, AuthorizationError, NotFoundError, toAppError, ValidationError } from "../../../shared/errors/app-error.js";
import { AuthorizationDeniedError, authorize } from "../../identity/domain/authorization.js";
import { auditAuthorizationDenied } from "../../../shared/observability/security-audit.js";
import { defaultSchemaRegistry } from "../../../shared/contracts/schema-validator.js";
import type { RequestContextResolver, ValidatedClaims } from "../../identity/application/resolve-request-context.js";
import type { TenantQuotaService } from "../../identity/application/quota.js";
import { buildExpirationItemCsv, buildRequirementCsv } from "../application/report-csv.js";
import { ReportsService } from "../application/reports-service.js";
import type { CreateReportSubscriptionInput, ReportSubscriptionService } from "../application/report-subscription-service.js";
import { reportSubscriptionRunKey, type ReportSubscriptionRun } from "../domain/report-subscription-run.js";
import { reportDeliveryAttemptKey, type ReportDeliveryAttempt } from "../domain/report-delivery-attempt.js";
import type { ReportSubscriptionStore } from "../ports/report-subscription-store.js";
import type { ReportExportStore } from "../ports/report-export-store.js";

const STATUS_BY_CATEGORY: Record<string, number> = {
  VALIDATION: 400,
  AUTH: 401,
  AUTHORIZATION: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  QUOTA_EXCEEDED: 429,
  DEPENDENCY_UNAVAILABLE: 503,
  INTERNAL: 500,
  BUSINESS_RULE: 422,
};

export interface HttpRequest<TBody = unknown> {
  requestId: string;
  correlationId: string;
  claims: ValidatedClaims;
  pathParameters?: Record<string, string | undefined>;
  queryStringParameters?: Record<string, string | undefined>;
  headers?: Record<string, string | undefined>;
  body?: TBody;
}

export interface HttpResponse {
  statusCode: number;
  body: Record<string, unknown>;
}

export interface CsvHttpResponse {
  statusCode: number;
  csv: string;
  filename: string;
  /** Surfaced only when the report hit `ReportPage.truncated` â€” never present otherwise
   * (`toApiGatewayCsvResult` omits the header entirely when this is undefined). */
  truncated?: boolean;
}

export interface ReportsHttpDeps {
  resolver: RequestContextResolver;
  reports: ReportsService;
  quota: TenantQuotaService;
  subscriptions: ReportSubscriptionService;
  /** D-204 fatia 3 (decision 7): download route deps - subscription store to read the frozen
   * `ReportSubscriptionRun`/`ReportDeliveryAttempt` rows the delivery worker writes, S3 store to
   * mint the short-lived (5 min) presigned GET on demand. Both optional so this same
   * `ReportsHttpDeps` shape keeps working for any test/composition that only exercises the CSV
   * routes/subscription CRUD above - a route actually hitting the download handler without them
   * wired is a composition bug, surfaced as a real throw, not a silent 500. */
  subscriptionStore?: ReportSubscriptionStore;
  exportStore?: ReportExportStore;
}

/** Filename built ENTIRELY from server-controlled values (report name literal, tenantId, a
 * timestamp) â€” same posture `export-handler.ts`'s own `buildExportFilename` doc comment
 * requires (Content-Disposition header-injection guard). */
function buildReportFilename(reportName: string, tenantId: string, now: () => string): string {
  const timestamp = now().replace(/[:.]/g, "-");
  return `${reportName}-${tenantId}-${timestamp}.csv`;
}

interface ReportRoute {
  reportName: string;
  run: (deps: ReportsHttpDeps, ctx: Awaited<ReturnType<RequestContextResolver["resolve"]>>) => Promise<{ csv: string; truncated: boolean }>;
}

const ROUTES: Record<string, ReportRoute> = {
  "GET /reports/expired-items": {
    reportName: "expired-items",
    run: async (deps, ctx) => {
      const page = await deps.reports.getExpiredItems(ctx);
      return { csv: buildExpirationItemCsv(page.rows), truncated: page.truncated };
    },
  },
  "GET /reports/expiring-soon-items": {
    reportName: "expiring-soon-items",
    run: async (deps, ctx) => {
      const page = await deps.reports.getExpiringSoonItems(ctx);
      return { csv: buildExpirationItemCsv(page.rows), truncated: page.truncated };
    },
  },
  "GET /reports/renewed-items": {
    reportName: "renewed-items",
    run: async (deps, ctx) => {
      const page = await deps.reports.getRenewedItems(ctx);
      return { csv: buildExpirationItemCsv(page.rows), truncated: page.truncated };
    },
  },
  "GET /reports/expiration-items-by-assignee": {
    reportName: "expiration-items-by-assignee",
    run: async (deps, ctx) => {
      const page = await deps.reports.getExpirationItemsByAssignee(ctx);
      return { csv: buildExpirationItemCsv(page.rows), truncated: page.truncated };
    },
  },
  "GET /reports/missing-requirements": {
    reportName: "missing-requirements",
    run: async (deps, ctx) => {
      const page = await deps.reports.getMissingRequirements(ctx);
      return { csv: buildRequirementCsv(page.rows), truncated: page.truncated };
    },
  },
  "GET /reports/requirements-by-subject": {
    reportName: "requirements-by-subject",
    run: async (deps, ctx) => {
      const page = await deps.reports.getRequirementsBySubject(ctx);
      return { csv: buildRequirementCsv(page.rows), truncated: page.truncated };
    },
  },
  "GET /reports/requirements-by-assignee": {
    reportName: "requirements-by-assignee",
    run: async (deps, ctx) => {
      const page = await deps.reports.getRequirementsByAssignee(ctx);
      return { csv: buildRequirementCsv(page.rows), truncated: page.truncated };
    },
  },
};

export const REPORT_ROUTE_KEYS = Object.keys(ROUTES);

async function consumeApiRequestQuota(deps: ReportsHttpDeps, context: Awaited<ReturnType<RequestContextResolver["resolve"]>>): Promise<void> {
  await deps.quota.consume({
    tenantId: context.tenant.tenantId,
    quotaType: "API_REQUEST",
    window: "current",
    limit: 100,
    windowSeconds: 60,
  });
}

export async function handleReportsRoute(
  deps: ReportsHttpDeps,
  routeKey: string,
  req: HttpRequest,
  now: () => string = () => new Date().toISOString(),
): Promise<HttpResponse | CsvHttpResponse> {
  const route = ROUTES[routeKey];
  if (!route) {
    return { statusCode: 400, body: new ValidationError(`Unknown route: ${routeKey}`).toJSON() };
  }
  try {
    const context = await deps.resolver.resolve({
      claims: req.claims,
      requestId: req.requestId,
      correlationId: req.correlationId,
      organizationIdHint: req.headers?.["x-organization-id"],
    });
    await consumeApiRequestQuota(deps, context);
    const { csv, truncated } = await route.run(deps, context);
    const filename = buildReportFilename(route.reportName, context.tenant.tenantId, now);
    return { statusCode: 200, csv, filename, truncated: truncated || undefined };
  } catch (err) {
    if (err instanceof AuthorizationDeniedError) {
      auditAuthorizationDenied({ reason: err.reason, action: err.action });
      const appError = new AuthorizationError(err.message, { reason: err.reason });
      return { statusCode: STATUS_BY_CATEGORY[appError.category] ?? 500, body: appError.toJSON() };
    }
    const appError = err instanceof AppError ? err : toAppError(err);
    return { statusCode: STATUS_BY_CATEGORY[appError.category] ?? 500, body: appError.toJSON() };
  }
}

// --- ReportSubscription CRUD (D-204 decision 1, implemented D-213) -------------------------
// JSON-envelope routes (never CSV) - same pipeline as document-archive-handlers.ts (resolve
// context -> schema validation -> service, which authorizes internally -> AppError -> status
// mapping). The Lambda entrypoint (reports-handler.ts under runtime/aws/handlers) discriminates
// CSV vs JSON responses via `"csv" in response`, so these can share the same Lambda/module as
// the 7 CSV routes above without any response-shape ambiguity.

const SUBSCRIPTION_CREATE_SCHEMA_ID = "https://expiration-tracker/schemas/api/report-subscription-create-request.v1.json";
const SUBSCRIPTION_DELETE_SCHEMA_ID = "https://expiration-tracker/schemas/api/report-subscription-delete-request.v1.json";

function validateAgainstSchema(schemaId: string, body: unknown): void {
  const { valid, errors } = defaultSchemaRegistry.validate(schemaId, body);
  if (!valid) throw new ValidationError("Request body failed schema validation.", { errors });
}

function requireSubscriptionId(req: HttpRequest): string {
  const subscriptionId = req.pathParameters?.["subscriptionId"];
  if (!subscriptionId) throw new ValidationError("Missing subscriptionId path parameter.");
  return subscriptionId;
}

async function resolveContext(deps: ReportsHttpDeps, req: HttpRequest) {
  const context = await deps.resolver.resolve({
    claims: req.claims,
    requestId: req.requestId,
    correlationId: req.correlationId,
    organizationIdHint: req.headers?.["x-organization-id"],
  });
  await consumeApiRequestQuota(deps, context);
  return context;
}

async function withErrorMapping(fn: () => Promise<HttpResponse>): Promise<HttpResponse> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof AuthorizationDeniedError) {
      auditAuthorizationDenied({ reason: err.reason, action: err.action });
      return { statusCode: STATUS_BY_CATEGORY["AUTHORIZATION"] ?? 403, body: new AuthorizationError(err.message, { reason: err.reason }).toJSON() };
    }
    const appError = err instanceof AppError ? err : toAppError(err);
    return { statusCode: STATUS_BY_CATEGORY[appError.category] ?? 500, body: appError.toJSON() };
  }
}

export async function handleCreateReportSubscription(deps: ReportsHttpDeps, req: HttpRequest<CreateReportSubscriptionInput>): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    if (!req.body) throw new ValidationError("Missing request body.");
    validateAgainstSchema(SUBSCRIPTION_CREATE_SCHEMA_ID, req.body);
    const context = await resolveContext(deps, req);
    const subscription = await deps.subscriptions.createSubscription(context, req.body);
    return { statusCode: 201, body: { subscription } };
  });
}

export async function handleGetReportSubscription(deps: ReportsHttpDeps, req: HttpRequest): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const subscriptionId = requireSubscriptionId(req);
    const context = await resolveContext(deps, req);
    const subscription = await deps.subscriptions.getSubscription(context, subscriptionId);
    return { statusCode: 200, body: { subscription } };
  });
}

export async function handleListReportSubscriptions(deps: ReportsHttpDeps, req: HttpRequest): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const context = await resolveContext(deps, req);
    const { items, lastEvaluatedKey } = await deps.subscriptions.listSubscriptions(context);
    return { statusCode: 200, body: { subscriptions: items, ...(lastEvaluatedKey ? { lastEvaluatedKey } : {}) } };
  });
}

export async function handleDeleteReportSubscription(deps: ReportsHttpDeps, req: HttpRequest<{ expectedVersion: number }>): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const subscriptionId = requireSubscriptionId(req);
    if (!req.body) throw new ValidationError("Missing request body.");
    validateAgainstSchema(SUBSCRIPTION_DELETE_SCHEMA_ID, req.body);
    const context = await resolveContext(deps, req);
    await deps.subscriptions.deleteSubscription(context, subscriptionId, req.body.expectedVersion);
    return { statusCode: 204, body: {} };
  });
}

// --- Scheduled report run download (D-204 decisions 6-7, implemented fatia 3) ---------------

const DOWNLOAD_PRESIGN_TTL_SECONDS = 5 * 60; // decision 7: short-lived, minted on demand.

function requireRunId(req: HttpRequest): string {
  const runId = req.pathParameters?.["runId"];
  if (!runId) throw new ValidationError("Missing runId path parameter.");
  return runId;
}

/** GET /reports/subscriptions/{subscriptionId}/runs/{runId}/download â€” never returns file bytes
 * itself, only a freshly minted presigned S3 URL (decision 7's whole point: a long-TTL presign
 * embedded directly in the delivery e-mail is physically invalid past the ~7 day SigV4
 * credential ceiling when signed by a Lambda role, decision 1).
 *
 * RBAC (decision 6): `ADMIN_ROLES` OR `principal.userId` is one of THIS run's real recipients -
 * checked via the `ReportDeliveryAttempt` row the delivery worker wrote for this exact
 * `(subscriptionId, runId, recipientUserId)`, never the mutable/current
 * `ReportSubscription.recipientUserIds` list (which may have moved on since - there is no
 * update route in v1, but this is still the correct authority: "were you actually a recipient
 * of THIS run", not "are you on the subscription's list right now"). */
export async function handleDownloadReportSubscriptionRun(deps: ReportsHttpDeps, req: HttpRequest): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    if (!deps.subscriptionStore || !deps.exportStore) {
      throw new Error("handleDownloadReportSubscriptionRun requires subscriptionStore/exportStore to be wired.");
    }
    const subscriptionId = requireSubscriptionId(req);
    const runId = requireRunId(req);
    const context = await resolveContext(deps, req);
    const tenantId = context.tenant.tenantId;

    const run = await deps.subscriptionStore.get<ReportSubscriptionRun>(reportSubscriptionRunKey(tenantId, subscriptionId, runId));
    if (!run) throw new NotFoundError("ReportSubscriptionRun not found.", { subscriptionId, runId });

    try {
      authorize({ context, action: "reports:subscription-manage", resource: { tenantId } });
    } catch (err) {
      if (!(err instanceof AuthorizationDeniedError)) throw err;
      const attempt = await deps.subscriptionStore.get<ReportDeliveryAttempt>(reportDeliveryAttemptKey(tenantId, subscriptionId, runId, context.principal.userId));
      if (!attempt) {
        auditAuthorizationDenied({ reason: err.reason, action: err.action });
        throw err;
      }
    }

    const downloadUrl = await deps.exportStore.presignDownload({ tenantId, subscriptionId, runId, expiresInSeconds: DOWNLOAD_PRESIGN_TTL_SECONDS });
    return { statusCode: 200, body: { downloadUrl, expiresInSeconds: DOWNLOAD_PRESIGN_TTL_SECONDS } };
  });
}

rg: infra/modules/api-gateway/*.tf: A sintaxe do nome do arquivo, do nome do diretório ou do rótulo do volume está incorreta. (os error 123)

 exited 1 in 582ms:
/**
 * HTTP handlers for the Document Archive module (D-143 Nucleus 1) â€” mirrors
 * `src/modules/expiration/http/item-handlers.ts`'s exact pipeline (resolve context ->
 * service, which internally calls authorize() -> schema validation before the service call
 * -> AppError -> status-code mapping), so this module fails the same way as every other
 * route in the system.
 */
import { AppError, AuthorizationError, ConflictError, ValidationError, toAppError } from "../../../shared/errors/app-error.js";
import { AuthorizationDeniedError, authorizedTenantId } from "../../identity/domain/authorization.js";
import { auditAuthorizationDenied } from "../../../shared/observability/security-audit.js";
import { defaultSchemaRegistry } from "../../../shared/contracts/schema-validator.js";
import { encodeSearchCursor, decodeSearchCursor } from "../../../shared/domain/search-cursor.js";
import type { UnifiedValidityState } from "../../../shared/domain/validity-state.js";
import type { RequestContextResolver, ValidatedClaims } from "../../identity/application/resolve-request-context.js";
import type { TenantQuotaService } from "../../identity/application/quota.js";
import type { DocumentArchiveService } from "../application/document-archive-service.js";
import type { DocumentRequestRecurrenceService } from "../application/document-request-recurrence-service.js";
import type { CreateDocumentInput } from "../domain/document.js";
import type { FileUploadSpec } from "../domain/document-file.js";
import type { DocumentVersionOrigin, RejectionReason } from "../domain/document-version.js";
import type { CreateRequirementInput, RequirementStatus, UpdateRequirementInput } from "../domain/requirement.js";
import type { CreateDocumentRequestSeriesInput } from "../domain/document-request-series.js";
import type { CreateDocumentTypeInput, CreateDocumentTypeMetadataFieldInput, DocumentType, UpdateDocumentTypeMetadataFieldInput } from "../domain/document-type.js";
import type { DocumentMetadataValueInput } from "../domain/document.js";
import type { CreateRequirementTemplateInput, RequirementTemplate, UpdateRequirementTemplateInput } from "../domain/requirement-template.js";
import type { DossierExportFormat, DossierExportStore } from "../ports/dossier-export-store.js";

function validateAgainstSchema(schemaId: string, body: unknown): void {
  const { valid, errors } = defaultSchemaRegistry.validate(schemaId, body);
  if (!valid) {
    throw new ValidationError("Request body failed schema validation.", { errors });
  }
}

const CREATE_SCHEMA_ID = "https://expiration-tracker/schemas/api/docarchive-create-request.v1.json";
const RESERVE_UPLOAD_SCHEMA_ID = "https://expiration-tracker/schemas/api/docarchive-reserve-upload-request.v1.json";
const RESERVE_FILES_SCHEMA_ID = "https://expiration-tracker/schemas/api/docarchive-reserve-files-request.v1.json";
const COMMIT_UPLOAD_SCHEMA_ID = "https://expiration-tracker/schemas/api/docarchive-commit-upload-request.v1.json";
const CLAIM_REVIEW_SCHEMA_ID = "https://expiration-tracker/schemas/api/docarchive-claim-review-request.v1.json";
const ACCEPT_VERSION_SCHEMA_ID = "https://expiration-tracker/schemas/api/docarchive-accept-version-request.v1.json";
const REJECT_VERSION_SCHEMA_ID = "https://expiration-tracker/schemas/api/docarchive-reject-version-request.v1.json";
const REQUIREMENT_CREATE_SCHEMA_ID = "https://expiration-tracker/schemas/api/docarchive-requirement-create-request.v1.json";
const REQUIREMENT_UPDATE_SCHEMA_ID = "https://expiration-tracker/schemas/api/docarchive-requirement-update-request.v1.json";
const REQUIREMENT_LINK_EVIDENCE_SCHEMA_ID = "https://expiration-tracker/schemas/api/docarchive-requirement-link-evidence-request.v1.json";
const REQUIREMENT_UNLINK_EVIDENCE_SCHEMA_ID = "https://expiration-tracker/schemas/api/docarchive-requirement-unlink-evidence-request.v1.json";
const REQUIREMENT_DELETE_SCHEMA_ID = "https://expiration-tracker/schemas/api/docarchive-requirement-delete-request.v1.json";
const REQUIREMENT_SEARCH_SCHEMA_ID = "https://expiration-tracker/schemas/api/docarchive-requirement-search-request.v1.json";
const SERIES_CREATE_SCHEMA_ID = "https://expiration-tracker/schemas/api/docarchive-series-create-request.v1.json";
const SERIES_CANCEL_SCHEMA_ID = "https://expiration-tracker/schemas/api/docarchive-series-cancel-request.v1.json";
const SERIES_MATERIALIZE_SCHEMA_ID = "https://expiration-tracker/schemas/api/docarchive-series-materialize-request.v1.json";
const SERIES_UPDATE_RECIPIENT_SCHEMA_ID = "https://expiration-tracker/schemas/api/docarchive-series-update-recipient-request.v1.json";
const DOCUMENTTYPE_CREATE_SCHEMA_ID = "https://expiration-tracker/schemas/api/docarchive-documenttype-create-request.v1.json";
const DOCUMENTTYPE_RENAME_SCHEMA_ID = "https://expiration-tracker/schemas/api/docarchive-documenttype-rename-request.v1.json";
const DOCUMENTTYPE_DEPRECATE_SCHEMA_ID = "https://expiration-tracker/schemas/api/docarchive-documenttype-deprecate-request.v1.json";
const DOCUMENTTYPE_REACTIVATE_SCHEMA_ID = "https://expiration-tracker/schemas/api/docarchive-documenttype-reactivate-request.v1.json";
const REQTEMPLATE_CREATE_SCHEMA_ID = "https://expiration-tracker/schemas/api/docarchive-requirementtemplate-create-request.v1.json";
const REQTEMPLATE_UPDATE_SCHEMA_ID = "https://expiration-tracker/schemas/api/docarchive-requirementtemplate-update-request.v1.json";
const REQTEMPLATE_DUPLICATE_SCHEMA_ID = "https://expiration-tracker/schemas/api/docarchive-requirementtemplate-duplicate-request.v1.json";
const REQTEMPLATE_ARCHIVE_SCHEMA_ID = "https://expiration-tracker/schemas/api/docarchive-requirementtemplate-archive-request.v1.json";
const REQTEMPLATE_UNARCHIVE_SCHEMA_ID = "https://expiration-tracker/schemas/api/docarchive-requirementtemplate-unarchive-request.v1.json";
const REQTEMPLATE_PREVIEW_SCHEMA_ID = "https://expiration-tracker/schemas/api/docarchive-requirementtemplate-preview-request.v1.json";
const REQTEMPLATE_APPLY_SCHEMA_ID = "https://expiration-tracker/schemas/api/docarchive-requirementtemplate-apply-request.v1.json";
const DOSSIER_CONFIRM_SCHEMA_ID = "https://expiration-tracker/schemas/api/docarchive-dossier-confirm-request.v1.json";
const DOCUMENTTYPE_METADATA_FIELD_CREATE_SCHEMA_ID = "https://expiration-tracker/schemas/api/docarchive-documenttype-metadata-field-create-request.v1.json";
const DOCUMENTTYPE_METADATA_FIELD_UPDATE_SCHEMA_ID = "https://expiration-tracker/schemas/api/docarchive-documenttype-metadata-field-update-request.v1.json";
const DOCUMENT_METADATA_VALUES_UPDATE_SCHEMA_ID = "https://expiration-tracker/schemas/api/docarchive-document-metadata-values-update-request.v1.json";

export interface HttpRequest<TBody = unknown> {
  requestId: string;
  correlationId: string;
  claims: ValidatedClaims;
  pathParameters?: Record<string, string | undefined>;
  queryStringParameters?: Record<string, string | undefined>;
  headers?: Record<string, string | undefined>;
  body?: TBody;
}

export interface HttpResponse {
  statusCode: number;
  body: Record<string, unknown>;
}

export interface DocumentArchiveHttpDeps {
  resolver: RequestContextResolver;
  documentArchive: DocumentArchiveService;
  recurrence: DocumentRequestRecurrenceService;
  quota: TenantQuotaService;
  /** D-205 fatia 3 (decision 9): only the dossier download route needs this - optional so every
   * OTHER caller of this Lambda/module (all the routes above) keeps working unchanged. */
  dossierExportStore?: DossierExportStore;
}

const STATUS_BY_CATEGORY: Record<string, number> = {
  VALIDATION: 400,
  AUTH: 401,
  AUTHORIZATION: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  QUOTA_EXCEEDED: 429,
  DEPENDENCY_UNAVAILABLE: 503,
  INTERNAL: 500,
  BUSINESS_RULE: 422,
};

function toResponse(appError: AppError): HttpResponse {
  const status = STATUS_BY_CATEGORY[appError.category] ?? 500;
  return { statusCode: status, body: appError.toJSON() };
}

async function withErrorMapping(fn: () => Promise<HttpResponse>): Promise<HttpResponse> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof AuthorizationDeniedError) {
      auditAuthorizationDenied({ reason: err.reason, action: err.action });
      return toResponse(new AuthorizationError(err.message, { reason: err.reason }));
    }
    const appError = err instanceof AppError ? err : toAppError(err);
    return toResponse(appError);
  }
}

/** full-audit round1/Seguranca criterio 9 (Resistencia a Abuso/DoS) â€” same limit/window as
 * every other business route (item-handlers.ts's consumeApiRequestQuota), applied here too
 * rather than leaving this module's real business writes unmetered. */
async function consumeApiRequestQuota(quota: TenantQuotaService, tenantId: string): Promise<void> {
  await quota.consume({ tenantId, quotaType: "API_REQUEST", window: "current", limit: 100, windowSeconds: 60 });
}

function requireDocumentId(req: HttpRequest): string {
  const documentId = req.pathParameters?.["documentId"];
  if (!documentId) throw new ValidationError("Missing documentId path parameter.");
  return documentId;
}

function requireSeq(req: HttpRequest): number {
  const raw = req.pathParameters?.["seq"];
  const seq = Number(raw);
  if (!raw || !Number.isInteger(seq) || seq < 1) {
    throw new ValidationError("Missing or invalid seq path parameter.");
  }
  return seq;
}

function requireSubjectId(req: HttpRequest): string {
  const subjectId = req.pathParameters?.["subjectId"];
  if (!subjectId) throw new ValidationError("Missing subjectId path parameter.");
  return subjectId;
}

function requireRequirementId(req: HttpRequest): string {
  const requirementId = req.pathParameters?.["requirementId"];
  if (!requirementId) throw new ValidationError("Missing requirementId path parameter.");
  return requirementId;
}

function requireSeriesId(req: HttpRequest): string {
  const seriesId = req.pathParameters?.["seriesId"];
  if (!seriesId) throw new ValidationError("Missing seriesId path parameter.");
  return seriesId;
}

function requireDocumentTypeId(req: HttpRequest): string {
  const documentTypeId = req.pathParameters?.["documentTypeId"];
  if (!documentTypeId) throw new ValidationError("Missing documentTypeId path parameter.");
  return documentTypeId;
}

function requireRunId(req: HttpRequest): string {
  const runId = req.pathParameters?.["runId"];
  if (!runId) throw new ValidationError("Missing runId path parameter.");
  return runId;
}

function requireFieldId(req: HttpRequest): string {
  const fieldId = req.pathParameters?.["fieldId"];
  if (!fieldId) throw new ValidationError("Missing fieldId path parameter.");
  return fieldId;
}

/** Defaults to ACTIVE (the catalog a document-create flow actually needs) rather than requiring
 * every caller to pass `?status=ACTIVE` explicitly â€” DEPRECATED is opt-in via the query param. */
function requireDocumentTypeStatus(req: HttpRequest): DocumentType["status"] {
  const raw = req.queryStringParameters?.["status"];
  if (!raw) return "ACTIVE";
  if (raw !== "ACTIVE" && raw !== "DEPRECATED") throw new ValidationError("Invalid status query parameter.", { status: raw });
  return raw;
}

async function resolve(deps: DocumentArchiveHttpDeps, req: HttpRequest) {
  const context = await deps.resolver.resolve({
    claims: req.claims,
    requestId: req.requestId,
    correlationId: req.correlationId,
    organizationIdHint: req.headers?.["x-organization-id"],
  });
  await consumeApiRequestQuota(deps.quota, context.tenant.tenantId);
  return context;
}

export async function handleCreateDocument(deps: DocumentArchiveHttpDeps, req: HttpRequest<CreateDocumentInput>): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    if (!req.body) throw new ValidationError("Missing request body.");
    validateAgainstSchema(CREATE_SCHEMA_ID, req.body);
    const context = await resolve(deps, req);
    const document = await deps.documentArchive.createDocument(context, req.body);
    return { statusCode: 201, body: { document } };
  });
}

export async function handleGetDocument(deps: DocumentArchiveHttpDeps, req: HttpRequest): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const documentId = requireDocumentId(req);
    const context = await resolve(deps, req);
    const document = await deps.documentArchive.getDocument(context, documentId);
    return { statusCode: 200, body: { document } };
  });
}

export async function handleListVersions(deps: DocumentArchiveHttpDeps, req: HttpRequest): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const documentId = requireDocumentId(req);
    const context = await resolve(deps, req);
    const versions = await deps.documentArchive.listVersions(context, documentId);
    return { statusCode: 200, body: { versions } };
  });
}

export async function handleReserveUpload(deps: DocumentArchiveHttpDeps, req: HttpRequest<{ origin: DocumentVersionOrigin }>): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const documentId = requireDocumentId(req);
    if (!req.body) throw new ValidationError("Missing request body.");
    validateAgainstSchema(RESERVE_UPLOAD_SCHEMA_ID, req.body);
    const context = await resolve(deps, req);
    const version = await deps.documentArchive.reserveUpload(context, documentId, req.body.origin);
    return { statusCode: 201, body: { version } };
  });
}

export async function handleReserveFiles(
  deps: DocumentArchiveHttpDeps,
  req: HttpRequest<{ expectedVersion: number; files: readonly FileUploadSpec[] }>,
): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const documentId = requireDocumentId(req);
    const seq = requireSeq(req);
    if (!req.body) throw new ValidationError("Missing request body.");
    validateAgainstSchema(RESERVE_FILES_SCHEMA_ID, req.body);
    const context = await resolve(deps, req);
    const reserved = await deps.documentArchive.reserveFiles(context, documentId, seq, req.body.expectedVersion, req.body.files);
    return { statusCode: 201, body: { files: reserved } };
  });
}

export async function handleCommitUpload(deps: DocumentArchiveHttpDeps, req: HttpRequest<{ expectedVersion: number }>): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const documentId = requireDocumentId(req);
    const seq = requireSeq(req);
    if (!req.body) throw new ValidationError("Missing request body.");
    validateAgainstSchema(COMMIT_UPLOAD_SCHEMA_ID, req.body);
    const context = await resolve(deps, req);
    const version = await deps.documentArchive.commitUpload(context, documentId, seq, req.body.expectedVersion);
    return { statusCode: 200, body: { version } };
  });
}

export async function handleClaimReview(deps: DocumentArchiveHttpDeps, req: HttpRequest<{ expectedVersion: number }>): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const documentId = requireDocumentId(req);
    const seq = requireSeq(req);
    if (!req.body) throw new ValidationError("Missing request body.");
    validateAgainstSchema(CLAIM_REVIEW_SCHEMA_ID, req.body);
    const context = await resolve(deps, req);
    const version = await deps.documentArchive.claimReview(context, documentId, seq, req.body.expectedVersion);
    return { statusCode: 200, body: { version } };
  });
}

export async function handleAcceptVersion(deps: DocumentArchiveHttpDeps, req: HttpRequest<{ expectedVersion: number; clientRequestToken: string }>): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const documentId = requireDocumentId(req);
    const seq = requireSeq(req);
    if (!req.body) throw new ValidationError("Missing request body.");
    validateAgainstSchema(ACCEPT_VERSION_SCHEMA_ID, req.body);
    const context = await resolve(deps, req);
    const result = await deps.documentArchive.acceptVersion(context, documentId, seq, req.body.expectedVersion, req.body.clientRequestToken);
    return { statusCode: 200, body: { ...result } };
  });
}

export async function handleRejectVersion(deps: DocumentArchiveHttpDeps, req: HttpRequest<{ expectedVersion: number; reason: RejectionReason }>): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const documentId = requireDocumentId(req);
    const seq = requireSeq(req);
    if (!req.body) throw new ValidationError("Missing request body.");
    validateAgainstSchema(REJECT_VERSION_SCHEMA_ID, req.body);
    const context = await resolve(deps, req);
    const version = await deps.documentArchive.rejectVersion(context, documentId, seq, req.body.expectedVersion, req.body.reason);
    return { statusCode: 200, body: { version } };
  });
}

// --- Requirement (D-143 Decision 5 / D9, D-145) ---------------------------------------------

export async function handleCreateRequirement(deps: DocumentArchiveHttpDeps, req: HttpRequest<CreateRequirementInput>): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    if (!req.body) throw new ValidationError("Missing request body.");
    validateAgainstSchema(REQUIREMENT_CREATE_SCHEMA_ID, req.body);
    const context = await resolve(deps, req);
    const requirement = await deps.documentArchive.createRequirement(context, req.body);
    return { statusCode: 201, body: { requirement } };
  });
}

export async function handleGetRequirement(deps: DocumentArchiveHttpDeps, req: HttpRequest): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const subjectId = requireSubjectId(req);
    const requirementId = requireRequirementId(req);
    const context = await resolve(deps, req);
    const requirement = await deps.documentArchive.getRequirement(context, subjectId, requirementId);
    return { statusCode: 200, body: { requirement } };
  });
}

export async function handleListRequirements(deps: DocumentArchiveHttpDeps, req: HttpRequest): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const subjectId = requireSubjectId(req);
    const context = await resolve(deps, req);
    const requirements = await deps.documentArchive.listRequirements(context, subjectId);
    return { statusCode: 200, body: { requirements } };
  });
}

/** Roadmap P0.6 (dashboard operacional/compliance bÃ¡sico), fatia 2 â€” GET
 * /document-archive/requirements/{subjectId}/compliance. Routed ABOVE
 * `/document-archive/requirements/{subjectId}/{requirementId}` in
 * `document-archive-handler.ts`'s switch (API Gateway itself resolves the literal `compliance`
 * segment over `{requirementId}` regardless of switch-case order - see that handler's own
 * routeKey comment) but the `PROXY_ALLOWLIST` array in `proxy-allowlist.ts` matches by
 * `.find()`, so THAT list must list this entry before the `{requirementId}` one. */
export async function handleGetSubjectCompliance(deps: DocumentArchiveHttpDeps, req: HttpRequest): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const subjectId = requireSubjectId(req);
    const context = await resolve(deps, req);
    const compliance = await deps.documentArchive.getSubjectCompliance(context, subjectId);
    return { statusCode: 200, body: { compliance } };
  });
}

const REQUIREMENT_STATUSES = new Set(["MISSING", "PENDING", "SATISFIED", "NOT_SATISFIED", "NOT_APPLICABLE"]);
const VALIDITY_STATES = new Set(["PERMANENTE", "VALIDO", "VENCENDO", "VENCIDO", "AGUARDANDO_REVISAO"]);

/** D-194 Fatia 3 â€” GET /document-archive/requirements/search. Route lives ABOVE
 * `/document-archive/requirements/{subjectId}` in `main.tf`/the switch below on purpose â€” API
 * Gateway v2 prioritizes the literal `search` segment over the `{subjectId}` path parameter at
 * the same position (same precedent `main.tf`'s `GET /items/dashboard` comment documents). */
export async function handleSearchRequirements(deps: DocumentArchiveHttpDeps, req: HttpRequest): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const qs = req.queryStringParameters ?? {};
    const queryObject: Record<string, string> = {};
    for (const key of ["status", "namePrefix", "assigneeUserId", "validityState", "cursor"] as const) {
      const value = qs[key];
      if (value !== undefined) queryObject[key] = value;
    }
    const { valid, errors } = defaultSchemaRegistry.validate(REQUIREMENT_SEARCH_SCHEMA_ID, queryObject);
    if (!valid) throw new ValidationError("Query parameters failed schema validation.", { errors });

    const status = queryObject["status"] as RequirementStatus | undefined;
    if (!status || !REQUIREMENT_STATUSES.has(status)) {
      throw new ValidationError("Invalid or missing status query parameter.", { allowed: [...REQUIREMENT_STATUSES] });
    }
    const validityState = queryObject["validityState"] as UnifiedValidityState | undefined;
    if (validityState !== undefined && !VALIDITY_STATES.has(validityState)) {
      throw new ValidationError("Invalid validityState query parameter.", { allowed: [...VALIDITY_STATES] });
    }
    const namePrefix = queryObject["namePrefix"];
    const assigneeUserId = queryObject["assigneeUserId"];
    const signature = { mode: "REQUIREMENT", status, namePrefix, assigneeUserId, validityState };
    const exclusiveStartKey = queryObject["cursor"] !== undefined ? decodeSearchCursor(queryObject["cursor"], signature) : undefined;

    const context = await resolve(deps, req);
    const page = await deps.documentArchive.searchRequirements(context, { status, namePrefix, assigneeUserId, validityState, exclusiveStartKey });
    return {
      statusCode: 200,
      body: {
        items: page.items,
        cursor: page.lastEvaluatedKey ? encodeSearchCursor(signature, page.lastEvaluatedKey) : null,
        scanLimitReached: page.scanLimitReached,
      },
    };
  });
}

export async function handleUpdateRequirement(deps: DocumentArchiveHttpDeps, req: HttpRequest<UpdateRequirementInput & { expectedVersion: number }>): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const subjectId = requireSubjectId(req);
    const requirementId = requireRequirementId(req);
    if (!req.body) throw new ValidationError("Missing request body.");
    validateAgainstSchema(REQUIREMENT_UPDATE_SCHEMA_ID, req.body);
    const context = await resolve(deps, req);
    const { expectedVersion, ...input } = req.body;
    const requirement = await deps.documentArchive.updateRequirement(context, subjectId, requirementId, expectedVersion, input);
    return { statusCode: 200, body: { requirement } };
  });
}

export async function handleLinkEvidence(
  deps: DocumentArchiveHttpDeps,
  req: HttpRequest<{ expectedVersion: number; documentId: string; versionId: string }>,
): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const subjectId = requireSubjectId(req);
    const requirementId = requireRequirementId(req);
    if (!req.body) throw new ValidationError("Missing request body.");
    validateAgainstSchema(REQUIREMENT_LINK_EVIDENCE_SCHEMA_ID, req.body);
    const context = await resolve(deps, req);
    const requirement = await deps.documentArchive.linkEvidence(context, subjectId, requirementId, req.body.expectedVersion, req.body.documentId, req.body.versionId);
    return { statusCode: 200, body: { requirement } };
  });
}

export async function handleUnlinkEvidence(deps: DocumentArchiveHttpDeps, req: HttpRequest<{ expectedVersion: number }>): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const subjectId = requireSubjectId(req);
    const requirementId = requireRequirementId(req);
    if (!req.body) throw new ValidationError("Missing request body.");
    validateAgainstSchema(REQUIREMENT_UNLINK_EVIDENCE_SCHEMA_ID, req.body);
    const context = await resolve(deps, req);
    const requirement = await deps.documentArchive.unlinkEvidence(context, subjectId, requirementId, req.body.expectedVersion);
    return { statusCode: 200, body: { requirement } };
/**
 * Roadmap P0.7 ("RelatÃ³rios, ExportaÃ§Ã£o e Audit Trail"), fatias 1-2. Dedicated CSV route family,
 * one Lambda serving all 7 GET /reports/* routes â€” same reasons `export-handler.ts`
 * (D-123/D-126) is its own module rather than folded into a generic JSON `HttpResponse` pipeline
 * (raw CSV body, `Content-Disposition`, no JSON envelope). A single dedicated module (not 7) is
 * a deliberate choice within the delegated engineering authority for this slice: every report
 * shares the identical CSV-building/RBAC/audit-free shape `export-handler.ts` already
 * established, so 7 near-identical Lambdas would duplicate infra wiring without a matching
 * behavioral difference (unlike `/items/export`'s own dedicated `timeout_seconds=25`, which
 * exists for a REAL reason â€” a page budget no other route shares).
 */
import { AppError, AuthorizationError, NotFoundError, toAppError, ValidationError } from "../../../shared/errors/app-error.js";
import { AuthorizationDeniedError, authorize } from "../../identity/domain/authorization.js";
import { auditAuthorizationDenied } from "../../../shared/observability/security-audit.js";
import { defaultSchemaRegistry } from "../../../shared/contracts/schema-validator.js";
import type { RequestContextResolver, ValidatedClaims } from "../../identity/application/resolve-request-context.js";
import type { TenantQuotaService } from "../../identity/application/quota.js";
import { buildExpirationItemCsv, buildRequirementCsv } from "../application/report-csv.js";
import { ReportsService } from "../application/reports-service.js";
import type { CreateReportSubscriptionInput, ReportSubscriptionService } from "../application/report-subscription-service.js";
import { reportSubscriptionRunKey, type ReportSubscriptionRun } from "../domain/report-subscription-run.js";
import { reportDeliveryAttemptKey, type ReportDeliveryAttempt } from "../domain/report-delivery-attempt.js";
import type { ReportSubscriptionStore } from "../ports/report-subscription-store.js";
import type { ReportExportStore } from "../ports/report-export-store.js";

const STATUS_BY_CATEGORY: Record<string, number> = {
  VALIDATION: 400,
  AUTH: 401,
  AUTHORIZATION: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  QUOTA_EXCEEDED: 429,
  DEPENDENCY_UNAVAILABLE: 503,
  INTERNAL: 500,
  BUSINESS_RULE: 422,
};

export interface HttpRequest<TBody = unknown> {
  requestId: string;
  correlationId: string;
  claims: ValidatedClaims;
  pathParameters?: Record<string, string | undefined>;
  queryStringParameters?: Record<string, string | undefined>;
  headers?: Record<string, string | undefined>;
  body?: TBody;
}

export interface HttpResponse {
  statusCode: number;
  body: Record<string, unknown>;
}

export interface CsvHttpResponse {
  statusCode: number;
  csv: string;
  filename: string;
  /** Surfaced only when the report hit `ReportPage.truncated` â€” never present otherwise
   * (`toApiGatewayCsvResult` omits the header entirely when this is undefined). */
  truncated?: boolean;
}

export interface ReportsHttpDeps {
  resolver: RequestContextResolver;
  reports: ReportsService;
  quota: TenantQuotaService;
  subscriptions: ReportSubscriptionService;
  /** D-204 fatia 3 (decision 7): download route deps - subscription store to read the frozen
   * `ReportSubscriptionRun`/`ReportDeliveryAttempt` rows the delivery worker writes, S3 store to
   * mint the short-lived (5 min) presigned GET on demand. Both optional so this same
   * `ReportsHttpDeps` shape keeps working for any test/composition that only exercises the CSV
   * routes/subscription CRUD above - a route actually hitting the download handler without them
   * wired is a composition bug, surfaced as a real throw, not a silent 500. */
  subscriptionStore?: ReportSubscriptionStore;
  exportStore?: ReportExportStore;
}

/** Filename built ENTIRELY from server-controlled values (report name literal, tenantId, a
 * timestamp) â€” same posture `export-handler.ts`'s own `buildExportFilename` doc comment
 * requires (Content-Disposition header-injection guard). */
function buildReportFilename(reportName: string, tenantId: string, now: () => string): string {
  const timestamp = now().replace(/[:.]/g, "-");
  return `${reportName}-${tenantId}-${timestamp}.csv`;
}

interface ReportRoute {
  reportName: string;
  run: (deps: ReportsHttpDeps, ctx: Awaited<ReturnType<RequestContextResolver["resolve"]>>) => Promise<{ csv: string; truncated: boolean }>;
}

const ROUTES: Record<string, ReportRoute> = {
  "GET /reports/expired-items": {
    reportName: "expired-items",
    run: async (deps, ctx) => {
      const page = await deps.reports.getExpiredItems(ctx);
      return { csv: buildExpirationItemCsv(page.rows), truncated: page.truncated };
    },
  },
  "GET /reports/expiring-soon-items": {
    reportName: "expiring-soon-items",
    run: async (deps, ctx) => {
      const page = await deps.reports.getExpiringSoonItems(ctx);
      return { csv: buildExpirationItemCsv(page.rows), truncated: page.truncated };
    },
  },
  "GET /reports/renewed-items": {
    reportName: "renewed-items",
    run: async (deps, ctx) => {
      const page = await deps.reports.getRenewedItems(ctx);
      return { csv: buildExpirationItemCsv(page.rows), truncated: page.truncated };
    },
  },
  "GET /reports/expiration-items-by-assignee": {
    reportName: "expiration-items-by-assignee",
    run: async (deps, ctx) => {
      const page = await deps.reports.getExpirationItemsByAssignee(ctx);
      return { csv: buildExpirationItemCsv(page.rows), truncated: page.truncated };
    },
  },
  "GET /reports/missing-requirements": {
    reportName: "missing-requirements",
    run: async (deps, ctx) => {
      const page = await deps.reports.getMissingRequirements(ctx);
      return { csv: buildRequirementCsv(page.rows), truncated: page.truncated };
    },
  },
  "GET /reports/requirements-by-subject": {
    reportName: "requirements-by-subject",
    run: async (deps, ctx) => {
      const page = await deps.reports.getRequirementsBySubject(ctx);
      return { csv: buildRequirementCsv(page.rows), truncated: page.truncated };
    },
  },
  "GET /reports/requirements-by-assignee": {
    reportName: "requirements-by-assignee",
    run: async (deps, ctx) => {
      const page = await deps.reports.getRequirementsByAssignee(ctx);
      return { csv: buildRequirementCsv(page.rows), truncated: page.truncated };
    },
  },
};

export const REPORT_ROUTE_KEYS = Object.keys(ROUTES);

async function consumeApiRequestQuota(deps: ReportsHttpDeps, context: Awaited<ReturnType<RequestContextResolver["resolve"]>>): Promise<void> {
  await deps.quota.consume({
    tenantId: context.tenant.tenantId,
    quotaType: "API_REQUEST",
    window: "current",
    limit: 100,
    windowSeconds: 60,
  });
}

export async function handleReportsRoute(
  deps: ReportsHttpDeps,
  routeKey: string,
  req: HttpRequest,
  now: () => string = () => new Date().toISOString(),
): Promise<HttpResponse | CsvHttpResponse> {
  const route = ROUTES[routeKey];
  if (!route) {
    return { statusCode: 400, body: new ValidationError(`Unknown route: ${routeKey}`).toJSON() };
  }
  try {
    const context = await deps.resolver.resolve({
      claims: req.claims,
      requestId: req.requestId,
      correlationId: req.correlationId,
      organizationIdHint: req.headers?.["x-organization-id"],
    });
    await consumeApiRequestQuota(deps, context);
    const { csv, truncated } = await route.run(deps, context);
    const filename = buildReportFilename(route.reportName, context.tenant.tenantId, now);
    return { statusCode: 200, csv, filename, truncated: truncated || undefined };
  } catch (err) {
    if (err instanceof AuthorizationDeniedError) {
      auditAuthorizationDenied({ reason: err.reason, action: err.action });
      const appError = new AuthorizationError(err.message, { reason: err.reason });
      return { statusCode: STATUS_BY_CATEGORY[appError.category] ?? 500, body: appError.toJSON() };
    }
    const appError = err instanceof AppError ? err : toAppError(err);
    return { statusCode: STATUS_BY_CATEGORY[appError.category] ?? 500, body: appError.toJSON() };
  }
}

// --- ReportSubscription CRUD (D-204 decision 1, implemented D-213) -------------------------
// JSON-envelope routes (never CSV) - same pipeline as document-archive-handlers.ts (resolve
// context -> schema validation -> service, which authorizes internally -> AppError -> status
// mapping). The Lambda entrypoint (reports-handler.ts under runtime/aws/handlers) discriminates
// CSV vs JSON responses via `"csv" in response`, so these can share the same Lambda/module as
// the 7 CSV routes above without any response-shape ambiguity.

const SUBSCRIPTION_CREATE_SCHEMA_ID = "https://expiration-tracker/schemas/api/report-subscription-create-request.v1.json";
const SUBSCRIPTION_DELETE_SCHEMA_ID = "https://expiration-tracker/schemas/api/report-subscription-delete-request.v1.json";

function validateAgainstSchema(schemaId: string, body: unknown): void {
  const { valid, errors } = defaultSchemaRegistry.validate(schemaId, body);
  if (!valid) throw new ValidationError("Request body failed schema validation.", { errors });
}

function requireSubscriptionId(req: HttpRequest): string {
  const subscriptionId = req.pathParameters?.["subscriptionId"];
  if (!subscriptionId) throw new ValidationError("Missing subscriptionId path parameter.");
  return subscriptionId;
}

async function resolveContext(deps: ReportsHttpDeps, req: HttpRequest) {
  const context = await deps.resolver.resolve({
    claims: req.claims,
    requestId: req.requestId,
    correlationId: req.correlationId,
    organizationIdHint: req.headers?.["x-organization-id"],
  });
  await consumeApiRequestQuota(deps, context);
  return context;
}

async function withErrorMapping(fn: () => Promise<HttpResponse>): Promise<HttpResponse> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof AuthorizationDeniedError) {
      auditAuthorizationDenied({ reason: err.reason, action: err.action });
      return { statusCode: STATUS_BY_CATEGORY["AUTHORIZATION"] ?? 403, body: new AuthorizationError(err.message, { reason: err.reason }).toJSON() };
    }
    const appError = err instanceof AppError ? err : toAppError(err);
    return { statusCode: STATUS_BY_CATEGORY[appError.category] ?? 500, body: appError.toJSON() };
  }
}

export async function handleCreateReportSubscription(deps: ReportsHttpDeps, req: HttpRequest<CreateReportSubscriptionInput>): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    if (!req.body) throw new ValidationError("Missing request body.");
    validateAgainstSchema(SUBSCRIPTION_CREATE_SCHEMA_ID, req.body);
    const context = await resolveContext(deps, req);
    const subscription = await deps.subscriptions.createSubscription(context, req.body);
    return { statusCode: 201, body: { subscription } };
  });
}

export async function handleGetReportSubscription(deps: ReportsHttpDeps, req: HttpRequest): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const subscriptionId = requireSubscriptionId(req);
    const context = await resolveContext(deps, req);
    const subscription = await deps.subscriptions.getSubscription(context, subscriptionId);
    return { statusCode: 200, body: { subscription } };
  });
}

export async function handleListReportSubscriptions(deps: ReportsHttpDeps, req: HttpRequest): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const context = await resolveContext(deps, req);
    const { items, lastEvaluatedKey } = await deps.subscriptions.listSubscriptions(context);
    return { statusCode: 200, body: { subscriptions: items, ...(lastEvaluatedKey ? { lastEvaluatedKey } : {}) } };
  });
}

export async function handleDeleteReportSubscription(deps: ReportsHttpDeps, req: HttpRequest<{ expectedVersion: number }>): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const subscriptionId = requireSubscriptionId(req);
    if (!req.body) throw new ValidationError("Missing request body.");
    validateAgainstSchema(SUBSCRIPTION_DELETE_SCHEMA_ID, req.body);
    const context = await resolveContext(deps, req);
    await deps.subscriptions.deleteSubscription(context, subscriptionId, req.body.expectedVersion);
    return { statusCode: 204, body: {} };
  });
}

// --- Scheduled report run download (D-204 decisions 6-7, implemented fatia 3) ---------------

const DOWNLOAD_PRESIGN_TTL_SECONDS = 5 * 60; // decision 7: short-lived, minted on demand.

function requireRunId(req: HttpRequest): string {
  const runId = req.pathParameters?.["runId"];
  if (!runId) throw new ValidationError("Missing runId path parameter.");
  return runId;
}

/** GET /reports/subscriptions/{subscriptionId}/runs/{runId}/download â€” never returns file bytes
 * itself, only a freshly minted presigned S3 URL (decision 7's whole point: a long-TTL presign
 * embedded directly in the delivery e-mail is physically invalid past the ~7 day SigV4
 * credential ceiling when signed by a Lambda role, decision 1).
 *
 * RBAC (decision 6): `ADMIN_ROLES` OR `principal.userId` is one of THIS run's real recipients -
 * checked via the `ReportDeliveryAttempt` row the delivery worker wrote for this exact
 * `(subscriptionId, runId, recipientUserId)`, never the mutable/current
 * `ReportSubscription.recipientUserIds` list (which may have moved on since - there is no
 * update route in v1, but this is still the correct authority: "were you actually a recipient
 * of THIS run", not "are you on the subscription's list right now"). */
export async function handleDownloadReportSubscriptionRun(deps: ReportsHttpDeps, req: HttpRequest): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    if (!deps.subscriptionStore || !deps.exportStore) {
      throw new Error("handleDownloadReportSubscriptionRun requires subscriptionStore/exportStore to be wired.");
    }
    const subscriptionId = requireSubscriptionId(req);
    const runId = requireRunId(req);
    const context = await resolveContext(deps, req);
    const tenantId = context.tenant.tenantId;

    const run = await deps.subscriptionStore.get<ReportSubscriptionRun>(reportSubscriptionRunKey(tenantId, subscriptionId, runId));
    if (!run) throw new NotFoundError("ReportSubscriptionRun not found.", { subscriptionId, runId });

    try {
      authorize({ context, action: "reports:subscription-manage", resource: { tenantId } });
    } catch (err) {
      if (!(err instanceof AuthorizationDeniedError)) throw err;
      const attempt = await deps.subscriptionStore.get<ReportDeliveryAttempt>(reportDeliveryAttemptKey(tenantId, subscriptionId, runId, context.principal.userId));
      if (!attempt) {
        auditAuthorizationDenied({ reason: err.reason, action: err.action });
        throw err;
      }
    }

    const downloadUrl = await deps.exportStore.presignDownload({ tenantId, subscriptionId, runId, expiresInSeconds: DOWNLOAD_PRESIGN_TTL_SECONDS });
    return { statusCode: 200, body: { downloadUrl, expiresInSeconds: DOWNLOAD_PRESIGN_TTL_SECONDS } };
  });
}

rg: infra/modules/api-gateway/*.tf: A sintaxe do nome do arquivo, do nome do diretório ou do rótulo do volume está incorreta. (os error 123)

exec
"C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -Command "rg -n 'case \"|path: \"|routeKey' src/modules/bff src/runtime/aws/handlers/bff* frontend/src | Select-Object -First 300; Get-Content -Raw docs/project/roadmap-competitivo-2026-09-01.md | Select-Object -First 1" in C:\Users\Usuario\Desktop\projects\expiration-tracker
 succeeded in 1400ms:
frontend/src\api\activity.ts:4: * backend path: src/modules/activity/http/activity-handlers.ts, allowlisted in
frontend/src\App.tsx:75:                  anywhere yet, exactly the case those two assume never happens. */}
src/modules/bff\domain\cookies.ts:28:  path: string;
src/modules/bff\domain\cookies.ts:38:  path: "/",
src/modules/bff\domain\cookies.ts:48:  path: "/",
src/modules/bff\domain\cookies.ts:58:  path: "/",
src/modules/bff\application\bff-auth-service.ts:83:function isValidReturnPath(path: string): boolean {
src/modules/bff\application\bff-auth-service.ts:528:    // action (found in Round D re-verification: this is exactly the blast-radius case Codex
src/modules/bff\http\bff-handlers.ts:110:    // case surfaces as "we don't know", not "definitely logged out" - found in review).
src/modules/bff\http\bff-handlers.ts:311:    const result = await deps.proxy.forward(session, { method: req.method, path: backendPath, queryString, headers: req.headers, body: req.body });
src/modules/bff\http\http-types.ts:7:  path: string;
src/modules/bff\application\proxy-service.ts:19:  path: string;
src/modules/bff\application\proxy-service.ts:44:      throw new NotFoundError("No such BFF-proxied route.", { method: req.method, path: req.path });
frontend/src\api\client.ts:63:  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
frontend/src\api\client.ts:126:  get<T>(path: string, options: Omit<RequestOptions, "method" | "body"> = {}): Promise<T> {
frontend/src\api\client.ts:129:  post<T>(path: string, body: unknown, options: Omit<RequestOptions, "method" | "body"> = {}): Promise<T> {
frontend/src\api\client.ts:132:  put<T>(path: string, body: unknown, options: Omit<RequestOptions, "method" | "body"> = {}): Promise<T> {
frontend/src\api\client.ts:135:  delete<T>(path: string, options: Omit<RequestOptions, "method" | "body"> = {}): Promise<T> {
frontend/src\routes\AcceptInvitation.tsx:6: * zero Memberships anywhere yet, exactly the case those assume never happens.
frontend/src\api\errors.ts:133: * covers `OwnerTierChangeRequiresOwnerError` (`BUSINESS_RULE_VIOLATION`), a distinct case this
frontend/src\auth\ProtectedRoute.tsx:22:    case "AUTHENTICATED":
frontend/src\auth\ProtectedRoute.tsx:24:    case "SESSION_REFRESHING":
frontend/src\auth\ProtectedRoute.tsx:30:    case "SESSION_MISSING":
frontend/src\auth\ProtectedRoute.tsx:31:    case "SESSION_EXPIRED":
frontend/src\auth\ProtectedRoute.tsx:32:    case "REFRESH_FAILED":
frontend/src\auth\ProtectedRoute.tsx:33:    case "REAUTH_REQUIRED":
src/modules/bff\domain\proxy-allowlist.ts:5: * `case "METHOD /path"` switch statements in src/runtime/aws/handlers/*.ts - this list is
src/modules/bff\domain\proxy-allowlist.ts:175:function pathMatchesTemplate(path: string, template: string): boolean {
src/modules/bff\domain\proxy-allowlist.ts:184:export function matchAllowlistedRoute(method: string, path: string): AllowlistedRoute | undefined {
frontend/src\api\presentation.ts:34:    case "ACTIVE":
frontend/src\api\presentation.ts:36:    case "ARCHIVED":
frontend/src\api\presentation.ts:38:    case "RENEWED":
frontend/src\api\presentation.ts:40:    case "DELETED":
frontend/src\api\presentation.ts:162:    case "MISSING":
frontend/src\api\presentation.ts:164:    case "REQUESTED":
frontend/src\api\presentation.ts:166:    case "SUBMITTED":
frontend/src\api\presentation.ts:168:    case "UNDER_REVIEW":
frontend/src\api\presentation.ts:170:    case "REJECTED":
frontend/src\api\presentation.ts:172:    case "SATISFIED":
frontend/src\api\presentation.ts:179:    case "PENDING_UPLOAD":
frontend/src\api\presentation.ts:181:    case "SCANNING":
frontend/src\api\presentation.ts:183:    case "CLEAN":
frontend/src\api\presentation.ts:185:    case "REJECTED":
frontend/src\api\presentation.ts:187:    case "UNSUPPORTED":
frontend/src\api\presentation.ts:189:    case "TIMEOUT":
frontend/src\api\presentation.ts:191:    case "DELETED":
frontend/src\components\ui\DataTable.css:93:   is the case WCAG 1.4.1 is about. */
frontend/src\components\ui\DataTable.tsx:110:   * The observer catches the case a re-render cannot: a viewport or container resize that
frontend/src\components\ui\DataTable.tsx:124:    // the case observing only the container would miss.
frontend/src\api\session.ts:60:async function postSessionAction(path: string): Promise<void> {
frontend/src\components\ui\StatusBadge.css:17:  /* Sentence case (mission §18) — deliberately NOT text-transform: uppercase. */
frontend/src\components\ui\StatusBadge.tsx:23:    case "danger":
frontend/src\components\ui\StatusBadge.tsx:25:    case "warning":
frontend/src\components\ui\StatusBadge.tsx:27:    case "neutral":
# Expiration Tracker â€” Roadmap Competitivo de Funcionalidades

**Data:** 1 de setembro de 2026  
**Objetivo:** definir a ordem de evoluÃ§Ã£o funcional necessÃ¡ria para entrar no mercado em boas condiÃ§Ãµes de competir em funcionalidades e preÃ§o, sem transformar o Expiration Tracker em uma suÃ­te contÃ¡bil ou GED genÃ©rico.

---

# 1. PrincÃ­pio estratÃ©gico

O objetivo do roadmap nÃ£o Ã© competir por quantidade absoluta de funcionalidades.

A prioridade Ã©:

> **eliminar lacunas que possam fazer um cliente escolher um concorrente por falta de uma capacidade bÃ¡sica ou claramente relevante.**

A estratÃ©gia deve preservar o foco do produto:

```text
Requirement
    â†“
Document Request
    â†“
Guest Upload
    â†“
AI Extraction
    â†“
Human Verification
    â†“
Document Version
    â†“
Validity
    â†“
Responsible
    â†“
Alerts / Chasing
    â†“
Renewal
    â†“
New Version
    â†“
Audit History
```

Esse ciclo completo deve ser o principal diferencial funcional do Expiration Tracker.

---

# 2. DecisÃ£o de sequÃªncia de desenvolvimento

O frontend completo do novo domÃ­nio documental **nÃ£o serÃ¡ finalizado imediatamente**.

A estratÃ©gia passa a ser:

```text
Funcionalidades P0 de domÃ­nio/backend/integrations
        â†“
todas funcionando de forma coerente
        â†“
escopo funcional estabilizado
        â†“
frontend completo e integrado
        â†“
polimento
        â†“
lanÃ§amento comercial
```

## Motivo

Finalizar agora toda a interface enquanto funcionalidades P0 ainda estÃ£o entrando aumentaria o risco de:

- retrabalho de fluxos;
- telas redesenhadas vÃ¡rias vezes;
- componentes temporÃ¡rios;
- inconsistÃªncia entre backend e UX;
- decisÃµes prematuras de navegaÃ§Ã£o;
- necessidade de revalidar jornadas repetidamente.

Portanto:

> **construir primeiro o conjunto P0 funcionalmente completo e, em seguida, consolidar o frontend como uma Ãºnica etapa coerente de productizaÃ§Ã£o.**

Isso nÃ£o significa ignorar UX durante o desenvolvimento.

Cada feature deve continuar sendo implementada com seus contratos, estados e necessidades de interface conhecidos, mas a consolidaÃ§Ã£o final do frontend ocorrerÃ¡ depois que o conjunto P0 estiver fechado.

---

# 3. Roadmap competitivo geral

| Ordem | Funcionalidade | Prioridade | Motivo |
|---:|---|---|---|
| 1 | Requirement Templates | P0 | Templates/checklists aparecem repetidamente nos concorrentes e aceleram onboarding e padronizaÃ§Ã£o |
| 2 | Bulk onboarding / importaÃ§Ã£o em massa | P0 | Remove enorme barreira de migraÃ§Ã£o para clientes com centenas de documentos |
| 3 | WhatsApp operacional | P0 | Muito relevante para o mercado brasileiro e jÃ¡ oferecido por concorrentes baratos |
| 4 | IA/OCR integrada ao novo Document Lifecycle | P0 | Transforma upload em classificaÃ§Ã£o + extraÃ§Ã£o + validaÃ§Ã£o humana |
| 5 | Busca e filtros documentais sÃ³lidos | P0 | NecessÃ¡rios para operar acervos reais em escala |
| 6 | Dashboard operacional / compliance bÃ¡sico | P0 | DÃ¡ visÃ£o rÃ¡pida de risco, pendÃªncias, vencimentos e requisitos |
| 7 | RelatÃ³rios + exportaÃ§Ã£o + audit trail utilizÃ¡vel | P0 | NecessÃ¡rio para gestÃ£o, auditoria e percepÃ§Ã£o de valor B2B |
| 8 | Document Types configurÃ¡veis | P0 | Base para templates, IA, classificaÃ§Ã£o e organizaÃ§Ã£o |
| 9 | Consolidar Guest Upload + Requests + Review + Recurrence como produto completo | P0 | **AUDITADO 2026-09-07 (D-222): ABERTO.** PeÃ§as individuais (Document/DocumentVersion, Requirement, guest access 3 camadas, DocumentRequestSeries/recorrÃªncia) corretas e deployadas, mas desconectadas no ponto central: `issueCredential()` nunca Ã© chamado por `materializeAttempt`/worker â€” nenhum guest recebe link hoje. Gap Ã© decisÃ£o nÃ­vel 5 (fronteira de seguranÃ§a Lambda/pepper), nÃ£o mecÃ¢nico. Ver `decisions-log.md` D-222. |
| 10 | Consolidar Storage + Versioning + Renewal | P0 | NÃºcleo documental precisa estar funcionalmente fechado antes do frontend final |
| 11 | Frontend completo do conjunto P0 | P0 â€” fechamento | ProductizaÃ§Ã£o final apÃ³s estabilizaÃ§Ã£o das capacidades acima |
| 12 | Reminder sequences configurÃ¡veis | P1 | AutomaÃ§Ã£o avanÃ§ada e bom diferencial Premium |
| 13 | Escalation / mÃºltiplos destinatÃ¡rios | P1 | Importante em equipes maiores e operaÃ§Ãµes crÃ­ticas |
| 14 | Busca OCR/full-text | P1 | Valor crescente conforme o acervo documental aumenta |
| 15 | RelatÃ³rios agendados | P1 | ConveniÃªncia relevante para gestores |
| 16 | DossiÃª documental PDF/Excel | P1 | Facilita auditorias, compliance e compartilhamento |
| 17 | Bulk actions | P1 | Importante para operaÃ§Ã£o em escala |
| 18 | Metadata configurÃ¡vel por Document Type | P1 | Flexibilidade controlada sem cair em custom fields irrestritos |
| 19 | Compartilhamento externo seguro | P1 | Link temporÃ¡rio, controle de acesso e futura governanÃ§a |
| 20 | Assinatura eletrÃ´nica | P2 | Diferencial Premium estratÃ©gico |
| 21 | API pÃºblica | P2 | IntegraÃ§Ã£o com clientes maduros |
| 22 | Webhooks | P2 | AutomaÃ§Ã£o com sistemas externos |
| 23 | Calendar integrations | P2 | ConveniÃªncia, nÃ£o core |
| 24 | Compliance score avanÃ§ado | P2 | SÃ³ depois de termos mÃ©trica simples, explicÃ¡vel e validada |
| 25 | Portal completo do cliente | Futuro | NÃ£o obrigatÃ³rio; Guest Flow pode ser mais simples e eficaz |
| 26 | SSO / SCIM / controles enterprise | Futuro | SÃ³ com evidÃªncia comercial real |

---

# 4. P0 â€” Funcionalidades necessÃ¡rias antes do lanÃ§amento

## P0.1 â€” Requirement Templates

Permitir reutilizar conjuntos de requisitos documentais.

Exemplo:

```text
Template: Regularidade bÃ¡sica da empresa

- CND Federal
- CND Estadual
- CND Municipal
- AlvarÃ¡ de Funcionamento
- Contrato Social
```

Deve incluir criaÃ§Ã£o, ediÃ§Ã£o, duplicaÃ§Ã£o, arquivamento, preview e aplicaÃ§Ã£o a Subjects com prevenÃ§Ã£o de duplicidade Ã³bvia.

---

## P0.2 â€” Bulk Onboarding / ImportaÃ§Ã£o em Massa

Objetivo: permitir que um novo cliente migre rapidamente para o Expiration Tracker.

EvoluÃ§Ã£o desejada:

```text
CSV / dados
+
Subjects
+
Documents
+
Requirements
+
mapeamento
+
preview
+
dedupe
+
resume
```

Depois, processamento em lote de documentos com OCR/IA.

---

## P0.3 â€” WhatsApp Operacional

Usos:

- alerta de vencimento;
- pedido de documento;
- cobranÃ§a automÃ¡tica;
- lembrete de renovaÃ§Ã£o;
- aviso ao responsÃ¡vel.

Email continua padrÃ£o. WhatsApp pode ser limitado por franquia/plano e monetizado conforme custo real.

---

## P0.4 â€” IA/OCR integrada ao Document Lifecycle

```text
DocumentVersion
        â†“
upload
        â†“
OCR
        â†“
AI extraction
        â†“
tipo documental
emissÃ£o
validade
identificador
Subject
        â†“
confidence
        â†“
human review
        â†“
accepted
```

Regra:

```text
SUGGESTED != CONFIRMED
```

---

## P0.5 â€” Busca e filtros documentais

Busca bÃ¡sica:

- nome;
- Subject;
- Document Type;
- responsÃ¡vel;
- tags.

Filtros:

- vÃ¡lido;
- vencendo;
- vencido;
- permanente;
- aguardando revisÃ£o;
- responsÃ¡vel;
- categoria;
- origem;
- arquivado.

---

## P0.6 â€” Dashboard Operacional / Compliance BÃ¡sico

Exemplo:

```text
12 vencidos
18 vencendo em 30 dias
7 aguardando cliente
5 aguardando revisÃ£o
9 requisitos ausentes
6 renovaÃ§Ãµes abertas
```

Por Subject:

```text
20 requisitos
17 satisfeitos
2 vencendo
1 ausente

Compliance documental: 85%
```

O percentual deve ser inicialmente simples e explicÃ¡vel.

**Status de implementaÃ§Ã£o (2026-09-03)**: 4 dos 6 contadores tenant-wide do exemplo acima
implementados â€” `GET /dashboard/summary` (`vencidos`/`overdueCount`, `vencendo em 30 dias`/
`expiringSoonCount` â€” janela real de 7 dias, reuso do `UnifiedValidityState`, nÃ£o 30 â€”,
`aguardando revisÃ£o`/`awaitingReviewCount`, `requisitos ausentes`/`missingRequirementsCount`);
card por Subject implementado â€” `GET /document-archive/requirements/{subjectId}/compliance`
(`totalRequirements`/`satisfiedCount`/`expiringSoonCount`/`missingCount`/`compliancePercent`,
fÃ³rmula acima, `null` quando `totalRequirements === 0`). `aguardando cliente` e `renovaÃ§Ãµes
abertas` ficam PENDENTES â€” nenhum status do modelo de dados atual (`Requirement`/
`ExpirationItem`) cobre esses dois conceitos; gap de produto genuÃ­no, aguardando decisÃ£o do
Marcelo antes de qualquer desenho tÃ©cnico, nÃ£o implementado nesta fatia.

---

## P0.7 â€” RelatÃ³rios, ExportaÃ§Ã£o e Audit Trail

RelatÃ³rios:

- documentos vencidos;
- vencendo;
- Requirements ausentes;
- documentos por Subject;
- documentos por responsÃ¡vel;
- solicitaÃ§Ãµes pendentes;
- renovaÃ§Ãµes.

Audit trail deve ser legÃ­vel para negÃ³cio:

```text
quem
fez o quÃª
quando
```

---

## P0.8 â€” Document Types ConfigurÃ¡veis

Exemplos:

```text
AlvarÃ¡ de Funcionamento
CND Federal
Contrato Social
ApÃ³lice
ProcuraÃ§Ã£o
Certificado
```

CaracterÃ­sticas iniciais:

- nome;
- categoria;
- possui validade normalmente?;
- descriÃ§Ã£o;
- integraÃ§Ã£o futura com metadata/IA.

---

## P0.9 â€” Guest Collection completa

Consolidar:

```text
Requirement
    â†“
Document Request
    â†“
Guest link
    â†“
Upload
    â†“
Received
    â†“
Review
    â†“
Accept / Reject
```

TambÃ©m:

- solicitaÃ§Ãµes recorrentes;
- automated chasing;
- recusa com motivo;
- solicitar novamente;
- prazo opcional;
- histÃ³rico.

---

## P0.10 â€” Storage + Versioning + Renewal consolidados

```text
Document
    â†“
Version 1
    â†“
expiraÃ§Ã£o
    â†“
Renewal
    â†“
Version 2
    â†“
Version 1 = SUPERSEDED
```

Garantir:

- versÃ£o atual;
- versÃµes anteriores;
- arquivos complementares;
- preview;
- download;
- validade;
- histÃ³rico.

---

# 5. P0.11 â€” Frontend completo e productizaÃ§Ã£o

Esta passa a ser a **Ãºltima grande etapa do P0**.

Quando as funcionalidades anteriores estiverem funcionalmente estÃ¡veis:

```text
backend/domÃ­nio completo
        â†“
contratos consolidados
        â†“
jornadas definitivas
        â†“
arquitetura de informaÃ§Ã£o final
        â†“
frontend completo
```

Escopo:

- Documents Collection;
- Document Detail;
- Upload;
- New Version;
- Requirements;
- Templates;
- Requests;
- Guest experience;
- Review Queue;
- Renewal;
- Bulk onboarding;
- IA review;
- Compliance dashboard;
- reports;
- WhatsApp configuration;
- settings;
- mobile;
- responsive;
- accessibility;
- Design System.

---

# 6. Ordem prÃ¡tica de desenvolvimento revisada

```text
1. Requirement Templates
        â†“
2. Bulk Onboarding / Import
        â†“
3. WhatsApp
        â†“
4. IA/OCR integrada ao novo DocumentVersion
        â†“
5. Busca e filtros documentais
        â†“
6. Compliance Dashboard
        â†“
7. RelatÃ³rios / Export / Audit
        â†“
8. Document Types configurÃ¡veis
        â†“
9. Consolidar Guest / Requests / Review / Recurrence
        â†“
10. Consolidar Storage / Versioning / Renewal
        â†“
11. FRONTEND COMPLETO DO P0
        â†“
12. Hardening / validaÃ§Ã£o / onboarding comercial
        â†“
LANÃ‡AMENTO
```

---

# 7. ComentÃ¡rios sobre a ordem prÃ¡tica

## 7.1 Templates primeiro

Templates tÃªm Ã³tima relaÃ§Ã£o esforÃ§o/valor e ajudam a estruturar Requirements, onboarding e verticalizaÃ§Ã£o.

## 7.2 Bulk onboarding muito cedo

Essa capacidade remove uma das maiores barreiras comerciais:

> â€œGostei, mas vou ter que cadastrar tudo de novo?â€

Pode impactar aquisiÃ§Ã£o mais do que vÃ¡rias funcionalidades sofisticadas.

## 7.3 WhatsApp antes do frontend final

WhatsApp afeta settings, planos, quotas, reminder flow, requests, chasing e notification preferences. Melhor fechar esse comportamento antes da experiÃªncia final.

## 7.4 IA antes do frontend final

A IA muda diretamente upload, review, Document Detail, bulk onboarding e metadata. Consolidar a integraÃ§Ã£o primeiro reduz retrabalho visual.

## 7.5 Busca antes da productizaÃ§Ã£o

O frontend final deve nascer jÃ¡ conhecendo filtros reais, campos pesquisÃ¡veis, sorting e volumes esperados.

## 7.6 Compliance Dashboard depois de Requirements

O dashboard depende de Requirement, Document, Validity, Request, Review e Renewal jÃ¡ semanticamente estÃ¡veis.

## 7.7 Frontend por Ãºltimo dentro do P0

Isso nÃ£o significa deixar UX para o final.

Durante cada feature:

- definir jornada;
- definir estados;
- definir contratos;
- registrar necessidades de UI.

Mas o acabamento e a integraÃ§Ã£o total devem ocorrer uma vez, contra um domÃ­nio estabilizado.

---

# 8. CritÃ©rio de lanÃ§amento

Antes do lanÃ§amento comercial, o produto deve cobrir:

### DomÃ­nio funcional

- vencimentos;
- documentos;
- versÃµes;
- storage;
- Requirements;
- templates;
- requests;
- guest upload;
- review;
- renewal;
- recurrence;
- automated chasing.

### Produtividade

- bulk onboarding;
- busca;
- filtros;
- dashboard;
- relatÃ³rios;
- exportaÃ§Ã£o.

### AutomaÃ§Ã£o

- OCR/IA;
- email;
- WhatsApp.

### Plataforma

- Organization;
- Membership;
- RBAC;
- audit trail;
- privacy/LGPD;
- quotas;
- entitlements bÃ¡sicos.

### ExperiÃªncia

- frontend completo;
- mobile;
- acessibilidade;
- onboarding;
- error/recovery states;
- Design System consistente.

---

# 9. P1 â€” EvoluÃ§Ã£o logo apÃ³s o lanÃ§amento

- Reminder sequences configurÃ¡veis;
- Escalation;
- OCR full-text search;
- RelatÃ³rios agendados;
- DossiÃª documental;
- Bulk actions;
- Metadata por Document Type;
- Compartilhamento externo seguro.

---

# 10. P2 â€” DiferenciaÃ§Ã£o Premium

- Assinatura eletrÃ´nica;
- API pÃºblica;
- Webhooks;
- Calendar integrations;
- Compliance score avanÃ§ado.

---

# 11. Funcionalidades deliberadamente fora do lanÃ§amento

- portal completo do cliente;
- native mobile app;
- SSO;
- SCIM;
- BPM;
- editor colaborativo;
- drive desktop;
- pastas infinitas;
- ACL por pasta;
- CRM;
- financeiro;
- ERP;
- chat completo;
- gestÃ£o fiscal completa.

SÃ³ entram com evidÃªncia comercial clara.

---

# 12. EstratÃ©gia inicial de preÃ§os

| Plano | PreÃ§o | Posicionamento |
|---|---:|---|
| Free | R$0 | ExperimentaÃ§Ã£o e geraÃ§Ã£o de leads |
| Essencial | R$59,90/mÃªs | NÃºcleo documental + vencimentos |
| Profissional | R$99,90/mÃªs | AutomaÃ§Ã£o + IA + WhatsApp + compliance |
| Premium | R$149,90/mÃªs | AutomaÃ§Ã£o avanÃ§ada, relatÃ³rios e inteligÃªncia |

---

# 13. EstratÃ©gia de limites

Evitar depender principalmente da quantidade de empresas.

Preferir limites ligados a custo real:

```text
storage
+
IA/OCR
+
WhatsApp
+
usuÃ¡rios
```

Subjects e documentos podem ter limites generosos.

---

# 14. PosiÃ§Ã£o competitiva desejada no lanÃ§amento

O produto nÃ£o deve ser percebido como:

> â€œmais um lembrete de vencimentos.â€

Mas como:

> **uma plataforma leve para manter obrigaÃ§Ãµes documentais sob controle durante todo o ciclo de vida.**

```text
O que precisa existir?
        â†“
Requirement

EstÃ¡ faltando?
        â†“
Request

Cliente precisa enviar?
        â†“
Guest Upload

Chegou?
        â†“
Review

O que o documento diz?
        â†“
AI/OCR

EstÃ¡ vÃ¡lido?
        â†“
Validity

Quem cuida disso?
        â†“
Responsible

Vai vencer?
        â†“
Alerts / Chasing

Renovou?
        â†“
New Version

O que aconteceu?
        â†“
History / Audit
```

---

# 15. Resumo executivo

## Antes do lanÃ§amento

1. Requirement Templates
2. Bulk onboarding
3. WhatsApp
4. IA/OCR integrada ao novo domÃ­nio documental
5. Busca/filtros
6. Compliance dashboard
7. RelatÃ³rios/export/audit
8. Document Types
9. Consolidar Guest/Requests/Review/Recurrence
10. Consolidar Storage/Versioning/Renewal
11. Frontend completo
12. Hardening e onboarding

## Depois do lanÃ§amento

- reminder sequences;
- escalation;
- full-text search;
- scheduled reports;
- dossiÃªs;
- bulk actions;
- metadata configurÃ¡vel;
- secure sharing.

## Premium futuro

- assinatura eletrÃ´nica;
- API;
- webhooks;
- integrations;
- advanced compliance.

---

# 16. DecisÃ£o estratÃ©gica final

> **O frontend completo serÃ¡ consolidado somente depois que as funcionalidades P0 estiverem funcionalmente prontas.**

Durante a construÃ§Ã£o do P0, UX e requisitos de tela continuam sendo definidos e registrados.

Assim:

```text
engenharia funcional P0
        â†“
escopo estÃ¡vel
        â†“
frontend integrado
        â†“
validaÃ§Ã£o
        â†“
lanÃ§amento
```

Essa passa a ser a sequÃªncia recomendada para o Expiration Tracker.

---

# 17. DÃ©bito tÃ©cnico de infraestrutura (custo/performance, revisar antes de produÃ§Ã£o real)

Itens de otimizaÃ§Ã£o de infraestrutura identificados mas deliberadamente adiados â€” nenhum Ã©
urgente hoje (`AGENTS.md` Â§1: sem usuÃ¡rio real, sem produÃ§Ã£o), mas ambos devem ser reavaliados
como decisÃ£o explÃ­cita (protocolo Claudeâ†”Codex, `AGENTS.md` Â§4, por serem mudanÃ§a de
arquitetura/seguranÃ§a) quando o projeto se aproximar de produÃ§Ã£o real.

## 17.1 â€” Migrar Lambdas de x86_64 para ARM64 (Graviton2)

Todas as Lambdas do projeto rodam hoje em x86_64 â€” nunca decidido explicitamente, Ã© o default
implÃ­cito do provider (`infra/modules/lambda-function/main.tf`'s `aws_lambda_function` nunca
declara `architectures`). Graviton2/ARM64 tipicamente reduz custo (~20%) e melhora
performance/watt para workloads Node.js. PendÃªncias reais a resolver na migraÃ§Ã£o: o layer ADOT
pinado em `infra/env/dev.tfvars` (`aws-otel-nodejs-amd64-...`) Ã© arquitetura-especÃ­fica e precisa
trocar para a variante `arm64` correspondente; validar que todas as dependÃªncias nativas (se
houver alguma com binÃ¡rio compilado) tÃªm build ARM64 disponÃ­vel.

**Registrado por pedido de Marcelo, 2026-09-05.**

## 17.2 â€” Hardening de rede (VPC + WAF)

1. VPC com subnets privadas + NAT Gateway, Lambdas dentro da VPC, Gateway Endpoints para S3 e
   DynamoDB (evita rotear esse trÃ¡fego pelo NAT/internet pÃºblica) â€” reduz superfÃ­cie de ataque.
   Trade-off real: hoje nenhuma Lambda fala com algo que exija VPC (sem RDS/ElastiCache/serviÃ§o
   privado), entÃ£o colocar em VPC Ã© sÃ³ sobre controlar egress (benefÃ­cio real, mas mais estreito
   que corrigir uma lacuna explorÃ¡vel hoje), com custo real recorrente (NAT Gateway
   hora+processamento de dados) e complexidade de rede adicional.
2. WAF na frente do CloudFront, mais automaÃ§Ã£o para bloquear bots/scans considerados ameaÃ§a
   real. MÃ³dulo `waf` jÃ¡ existiu e foi removido (D-051, `decisions-log.md`) â€” AWS WAFv2 nÃ£o
   suporta associaÃ§Ã£o com API Gateway HTTP API v2, sÃ³ REST API/ALB/AppSync/Cognito/App
   Runner/Verified Access/Amplify; reavaliar contra o CloudFront (ADR-0011), que suporta WAFv2
   nativamente â€” pode fechar essa lacuna. Prioridade mais alta que o item 1 (protege a superfÃ­cie
   pÃºblica/nÃ£o-autenticada de fato).

**Registrado por pedido de Marcelo, 2026-08-30** (item jÃ¡ existia em memÃ³ria de sessÃ£o anterior,
nunca tinha sido escrito no repositÃ³rio â€” corrigido aqui).

rg: |routeKey: A sintaxe do nome do arquivo, do nome do diretório ou do rótulo do volume está incorreta. (os error 123)
rg: src/runtime/aws/handlers/bff*: A sintaxe do nome do arquivo, do nome do diretório ou do rótulo do volume está incorreta. (os error 123)

exec
"C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -Command "rg -n 'handle.*Request|issueCredential|listReview|ReviewQueue|listDocuments|searchDocuments|listRequests' src/modules/document-archive src/runtime/aws/handlers/document-archive-handler.ts; Get-Content -Raw src/modules/bff/domain/proxy-allowlist.ts | Select-Object -First 1" in C:\Users\Usuario\Desktop\projects\expiration-tracker
 succeeded in 492ms:
src/modules/document-archive\http\document-archive-handlers.ts:124: * every other business route (item-handlers.ts's consumeApiRequestQuota), applied here too
src/modules/document-archive\http\document-archive-handlers.ts:201:export async function handleCreateDocument(deps: DocumentArchiveHttpDeps, req: HttpRequest<CreateDocumentInput>): Promise<HttpResponse> {
src/modules/document-archive\http\document-archive-handlers.ts:211:export async function handleGetDocument(deps: DocumentArchiveHttpDeps, req: HttpRequest): Promise<HttpResponse> {
src/modules/document-archive\http\document-archive-handlers.ts:220:export async function handleListVersions(deps: DocumentArchiveHttpDeps, req: HttpRequest): Promise<HttpResponse> {
src/modules/document-archive\http\document-archive-handlers.ts:229:export async function handleReserveUpload(deps: DocumentArchiveHttpDeps, req: HttpRequest<{ origin: DocumentVersionOrigin }>): Promise<HttpResponse> {
src/modules/document-archive\http\document-archive-handlers.ts:255:export async function handleCommitUpload(deps: DocumentArchiveHttpDeps, req: HttpRequest<{ expectedVersion: number }>): Promise<HttpResponse> {
src/modules/document-archive\http\document-archive-handlers.ts:267:export async function handleClaimReview(deps: DocumentArchiveHttpDeps, req: HttpRequest<{ expectedVersion: number }>): Promise<HttpResponse> {
src/modules/document-archive\http\document-archive-handlers.ts:279:export async function handleAcceptVersion(deps: DocumentArchiveHttpDeps, req: HttpRequest<{ expectedVersion: number; clientRequestToken: string }>): Promise<HttpResponse> {
src/modules/document-archive\http\document-archive-handlers.ts:291:export async function handleRejectVersion(deps: DocumentArchiveHttpDeps, req: HttpRequest<{ expectedVersion: number; reason: RejectionReason }>): Promise<HttpResponse> {
src/modules/document-archive\http\document-archive-handlers.ts:305:export async function handleCreateRequirement(deps: DocumentArchiveHttpDeps, req: HttpRequest<CreateRequirementInput>): Promise<HttpResponse> {
src/modules/document-archive\http\document-archive-handlers.ts:315:export async function handleGetRequirement(deps: DocumentArchiveHttpDeps, req: HttpRequest): Promise<HttpResponse> {
src/modules/document-archive\http\document-archive-handlers.ts:325:export async function handleListRequirements(deps: DocumentArchiveHttpDeps, req: HttpRequest): Promise<HttpResponse> {
src/modules/document-archive\http\document-archive-handlers.ts:341:export async function handleGetSubjectCompliance(deps: DocumentArchiveHttpDeps, req: HttpRequest): Promise<HttpResponse> {
src/modules/document-archive\http\document-archive-handlers.ts:357:export async function handleSearchRequirements(deps: DocumentArchiveHttpDeps, req: HttpRequest): Promise<HttpResponse> {
src/modules/document-archive\http\document-archive-handlers.ts:394:export async function handleUpdateRequirement(deps: DocumentArchiveHttpDeps, req: HttpRequest<UpdateRequirementInput & { expectedVersion: number }>): Promise<HttpResponse> {
src/modules/document-archive\http\document-archive-handlers.ts:422:export async function handleUnlinkEvidence(deps: DocumentArchiveHttpDeps, req: HttpRequest<{ expectedVersion: number }>): Promise<HttpResponse> {
src/modules/document-archive\http\document-archive-handlers.ts:434:export async function handleDeleteRequirement(deps: DocumentArchiveHttpDeps, req: HttpRequest<{ expectedVersion: number }>): Promise<HttpResponse> {
src/modules/document-archive\http\document-archive-handlers.ts:450:export async function handleCreateSeries(deps: DocumentArchiveHttpDeps, req: HttpRequest<CreateDocumentRequestSeriesInput>): Promise<HttpResponse> {
src/modules/document-archive\http\document-archive-handlers.ts:460:export async function handleGetSeries(deps: DocumentArchiveHttpDeps, req: HttpRequest): Promise<HttpResponse> {
src/modules/document-archive\http\document-archive-handlers.ts:470:export async function handleListSeries(deps: DocumentArchiveHttpDeps, req: HttpRequest): Promise<HttpResponse> {
src/modules/document-archive\http\document-archive-handlers.ts:479:export async function handleCancelSeries(deps: DocumentArchiveHttpDeps, req: HttpRequest<{ expectedVersion: number }>): Promise<HttpResponse> {
src/modules/document-archive\http\document-archive-handlers.ts:494:export async function handleUpdateSeriesRecipient(deps: DocumentArchiveHttpDeps, req: HttpRequest<{ recipientEmail: string | null; expectedVersion: number }>): Promise<HttpResponse> {
src/modules/document-archive\http\document-archive-handlers.ts:506:export async function handleMaterializeSeriesAttempt(deps: DocumentArchiveHttpDeps, req: HttpRequest<{ expectedVersion: number }>): Promise<HttpResponse> {
src/modules/document-archive\http\document-archive-handlers.ts:520:export async function handleCreateDocumentType(deps: DocumentArchiveHttpDeps, req: HttpRequest<CreateDocumentTypeInput>): Promise<HttpResponse> {
src/modules/document-archive\http\document-archive-handlers.ts:530:export async function handleGetDocumentType(deps: DocumentArchiveHttpDeps, req: HttpRequest): Promise<HttpResponse> {
src/modules/document-archive\http\document-archive-handlers.ts:539:export async function handleListDocumentTypes(deps: DocumentArchiveHttpDeps, req: HttpRequest): Promise<HttpResponse> {
src/modules/document-archive\http\document-archive-handlers.ts:548:export async function handleRenameDocumentType(deps: DocumentArchiveHttpDeps, req: HttpRequest<{ expectedVersion: number; displayName: string }>): Promise<HttpResponse> {
src/modules/document-archive\http\document-archive-handlers.ts:559:export async function handleDeprecateDocumentType(deps: DocumentArchiveHttpDeps, req: HttpRequest<{ expectedVersion: number }>): Promise<HttpResponse> {
src/modules/document-archive\http\document-archive-handlers.ts:570:export async function handleReactivateDocumentType(deps: DocumentArchiveHttpDeps, req: HttpRequest<{ expectedVersion: number }>): Promise<HttpResponse> {
src/modules/document-archive\http\document-archive-handlers.ts:651:export async function handleCreateRequirementTemplate(deps: DocumentArchiveHttpDeps, req: HttpRequest<CreateRequirementTemplateInput>): Promise<HttpResponse> {
src/modules/document-archive\http\document-archive-handlers.ts:662:export async function handleGetRequirementTemplate(deps: DocumentArchiveHttpDeps, req: HttpRequest): Promise<HttpResponse> {
src/modules/document-archive\http\document-archive-handlers.ts:671:export async function handleListRequirementTemplates(deps: DocumentArchiveHttpDeps, req: HttpRequest): Promise<HttpResponse> {
src/modules/document-archive\http\document-archive-handlers.ts:696:export async function handleDuplicateRequirementTemplate(deps: DocumentArchiveHttpDeps, req: HttpRequest<{ displayName: string }>): Promise<HttpResponse> {
src/modules/document-archive\http\document-archive-handlers.ts:708:export async function handleArchiveRequirementTemplate(deps: DocumentArchiveHttpDeps, req: HttpRequest<{ expectedVersion: number }>): Promise<HttpResponse> {
src/modules/document-archive\http\document-archive-handlers.ts:720:export async function handleUnarchiveRequirementTemplate(deps: DocumentArchiveHttpDeps, req: HttpRequest<{ expectedVersion: number }>): Promise<HttpResponse> {
src/modules/document-archive\http\document-archive-handlers.ts:735:export async function handlePreviewRequirementTemplate(deps: DocumentArchiveHttpDeps, req: HttpRequest<{ subjectId: string }>): Promise<HttpResponse> {
src/modules/document-archive\http\document-archive-handlers.ts:770:export async function handlePreviewDossierExport(deps: DocumentArchiveHttpDeps, req: HttpRequest): Promise<HttpResponse> {
src/modules/document-archive\http\document-archive-handlers.ts:779:export async function handleConfirmDossierExport(deps: DocumentArchiveHttpDeps, req: HttpRequest<{ scopeHash: string }>): Promise<HttpResponse> {
src/modules/document-archive\http\document-archive-handlers.ts:805:export async function handleDownloadDossierExport(deps: DocumentArchiveHttpDeps, req: HttpRequest): Promise<HttpResponse> {
src/modules/document-archive\http\document-archive-guest-handlers.ts:114:export async function handleGetGuestRequest(deps: GuestArchiveHttpDeps, req: GuestArchiveHttpRequest): Promise<GuestArchiveHttpResponse> {
src/modules/document-archive\http\document-archive-guest-handlers.ts:135:export async function handleStartGuestSession(deps: GuestArchiveHttpDeps, req: GuestArchiveHttpRequest): Promise<GuestArchiveHttpResponse> {
src/modules/document-archive\http\document-archive-guest-handlers.ts:158: * response as `handleGetGuestRequest`. */
src/modules/document-archive\http\document-archive-guest-handlers.ts:159:export async function handleListGuestDocumentTypes(deps: GuestArchiveHttpDeps, req: GuestArchiveHttpRequest): Promise<GuestArchiveHttpResponse> {
src/modules/document-archive\http\document-archive-guest-handlers.ts:171:export async function handleSubmitEvidence(deps: GuestArchiveHttpDeps, req: GuestArchiveHttpRequest<SubmitEvidenceInput>): Promise<GuestArchiveHttpResponse> {
src/modules/document-archive\application\document-request-credential-issuance-service.ts:16: * Put (main table, same shape `GuestDocumentAccessService.issueCredential` already writes),
src/modules/document-archive\application\document-request-credential-issuance-service.ts:93:  async handle(message: DocumentRequestCredentialIssuanceMessage): Promise<CredentialIssuanceOutcome> {
src/modules/document-archive\application\guest-document-access-service.ts:152:  async issueCredential(input: IssueCredentialInput): Promise<IssuedRequestAccessCredential> {
/**
 * Proxy allowlist â€” D-053/D-054: the BFF must never become a generic authenticated HTTP
 * proxy. Every route it will forward to the real API is listed here explicitly, mirroring
 * the routes already registered against the JWT-authorizer-protected API Gateway (see the
 * `case "METHOD /path"` switch statements in src/runtime/aws/handlers/*.ts - this list is
 * generated from reading those exhaustively, not invented). `/guest/*` is deliberately
 * excluded: it is already public and has its own token-based validation, outside the BFF's
 * concern entirely (a browser session cookie has no bearing on a guest upload link).
 *
 * Matching is by exact method + templated path segments (`{itemId}` etc.) - never a prefix
 * match, never a wildcard segment, so adding a new backend route requires a deliberate edit
 * here before the BFF will ever forward to it.
 */
export interface AllowlistedRoute {
  method: string;
  /** Path template using the same `{param}` convention as the real API Gateway routes. */
  pathTemplate: string;
}

export const PROXY_ALLOWLIST: readonly AllowlistedRoute[] = [
  // D-149 (admin-activity-log-scoping/estado-final-consolidado.md): tenant-facing read,
  // activity:read RBAC (ADMIN/OWNER) enforced by ActivityService, not by this allowlist.
  { method: "GET", pathTemplate: "/activity" },
  // Roadmap P0.6 (dashboard operacional/compliance bÃ¡sico), fatia 1 - tenant-wide read, RBAC
  // enforced by DashboardService, not by this allowlist (same posture as /activity above).
  { method: "GET", pathTemplate: "/dashboard/summary" },
  { method: "POST", pathTemplate: "/items" },
  { method: "GET", pathTemplate: "/items/dashboard" },
  // D-194 Fatia 3 (search/filters).
  { method: "GET", pathTemplate: "/items/search" },
  { method: "GET", pathTemplate: "/items/{itemId}" },
  { method: "PUT", pathTemplate: "/items/{itemId}" },
  { method: "DELETE", pathTemplate: "/items/{itemId}" },
  { method: "POST", pathTemplate: "/items/{itemId}/archive" },
  // D-206/D-207 (bulk actions, Roadmap P1 item 17): plain JSON response (never CSV), so
  // unlike /items/export this doesn't hit ProxyService.forward()'s content-disposition gap -
  // safe to proxy like any other item mutation.
  { method: "POST", pathTemplate: "/items/bulk-reassign" },
  { method: "POST", pathTemplate: "/items/bulk-archive" },
  { method: "POST", pathTemplate: "/items/{itemId}/renew" },
  { method: "POST", pathTemplate: "/items/{itemId}/watchers/{userId}" },
  { method: "DELETE", pathTemplate: "/items/{itemId}/watchers/{userId}" },
  { method: "GET", pathTemplate: "/items/{itemId}/watchers" },
  { method: "POST", pathTemplate: "/items/{itemId}/documents" },
  { method: "GET", pathTemplate: "/items/{itemId}/documents" },
  { method: "GET", pathTemplate: "/items/{itemId}/documents/{documentId}" },
  { method: "DELETE", pathTemplate: "/items/{itemId}/documents/{documentId}" },
  { method: "POST", pathTemplate: "/items/{itemId}/documents/{documentId}/extractions/{runId}/fields/{fieldName}/confirm" },
  { method: "POST", pathTemplate: "/items/{itemId}/documents/{documentId}/extractions/{runId}/fields/{fieldName}/reject" },
  { method: "POST", pathTemplate: "/imports" },
  { method: "GET", pathTemplate: "/imports/{jobId}" },
  { method: "POST", pathTemplate: "/imports/{jobId}/commit" },
  // D-192 slice 9 (bulk-import-documents-requirements-scoping/estado-final-consolidado.md Â§3).
  { method: "GET", pathTemplate: "/import-jobs/{jobId}/schema" },
  { method: "POST", pathTemplate: "/import-jobs/{jobId}/mapping" },
  { method: "GET", pathTemplate: "/notifications/preferences" },
  { method: "PUT", pathTemplate: "/notifications/preferences" },
  { method: "POST", pathTemplate: "/reminders/policies" },
  { method: "GET", pathTemplate: "/reminders/policies/{policyId}" },
  { method: "PUT", pathTemplate: "/reminders/policies/{policyId}" },
  { method: "POST", pathTemplate: "/reminders/policies/{policyId}/disable" },
  { method: "POST", pathTemplate: "/subjects" },
  { method: "GET", pathTemplate: "/subjects/dashboard" },
  // D-194 Fatia 3 (search/filters).
  { method: "GET", pathTemplate: "/subjects/search" },
  { method: "GET", pathTemplate: "/subjects/document-request-delivery-preference" },
  { method: "PUT", pathTemplate: "/subjects/document-request-delivery-preference" },
  { method: "GET", pathTemplate: "/subjects/{subjectId}" },
  { method: "PUT", pathTemplate: "/subjects/{subjectId}" },
  { method: "DELETE", pathTemplate: "/subjects/{subjectId}" },
  { method: "POST", pathTemplate: "/subjects/{subjectId}/archive" },
  { method: "POST", pathTemplate: "/subjects/{subjectId}/requirements" },
  { method: "GET", pathTemplate: "/subjects/{subjectId}/requirements" },
  { method: "GET", pathTemplate: "/subjects/{subjectId}/requirements/{assignmentId}" },
  { method: "PUT", pathTemplate: "/subjects/{subjectId}/requirements/{assignmentId}" },
  { method: "DELETE", pathTemplate: "/subjects/{subjectId}/requirements/{assignmentId}" },
  { method: "POST", pathTemplate: "/subjects/{subjectId}/requirements/{assignmentId}/link" },
  { method: "POST", pathTemplate: "/subjects/{subjectId}/requirements/{assignmentId}/unlink" },
  { method: "GET", pathTemplate: "/subjects/{subjectId}/requirements/{assignmentId}/submissions" },
  { method: "GET", pathTemplate: "/subjects/{subjectId}/requirements/{assignmentId}/submissions/{submissionId}" },
  { method: "POST", pathTemplate: "/subjects/{subjectId}/requirements/{assignmentId}/document-requests" },
  { method: "GET", pathTemplate: "/subjects/{subjectId}/requirements/{assignmentId}/document-requests" },
  { method: "GET", pathTemplate: "/subjects/{subjectId}/document-requests/{documentRequestId}" },
  { method: "POST", pathTemplate: "/subjects/{subjectId}/document-requests/{documentRequestId}/revoke" },
  // Wave B2B-8 (D-099).
  { method: "POST", pathTemplate: "/organizations/members/invite" },
  { method: "POST", pathTemplate: "/organizations/invitations/{invitationId}/revoke" },
  { method: "GET", pathTemplate: "/organizations/members" },
  { method: "GET", pathTemplate: "/organizations/invitations" },
  { method: "PUT", pathTemplate: "/organizations/members/{userId}/role" },
  { method: "DELETE", pathTemplate: "/organizations/members/{userId}" },
  { method: "POST", pathTemplate: "/organizations/members/leave" },
  // Wave B2B-10 (Tenant-aware Frontend, "settings" scope item).
  { method: "PATCH", pathTemplate: "/organizations/settings" },
  // W3-07 (D-124): the organization-closure trigger. Must be allowlisted here AND routed in
  // infra/modules/api-gateway/main.tf - D-117/D-120 were both real production bugs where a
  // handler existed and one of the two wiring halves was silently missing.
  { method: "POST", pathTemplate: "/organizations/close" },
  // D-127 (quarantine/recovery window): the cancellation trigger. Same dual-wiring discipline.
  { method: "POST", pathTemplate: "/organizations/cancel-close" },
  // D-143 Nucleus 1 (Document Archive domain) - routed in infra/modules/api-gateway/main.tf's
  // `document_archive_routes` alongside the matching Lambda/IAM wiring in the same PR, so
  // neither half is ever silently missing (the exact D-117/D-120 bug class named above).
  { method: "POST", pathTemplate: "/document-archive/documents" },
  { method: "GET", pathTemplate: "/document-archive/documents/{documentId}" },
  { method: "GET", pathTemplate: "/document-archive/documents/{documentId}/versions" },
  { method: "POST", pathTemplate: "/document-archive/documents/{documentId}/versions" },
  // D-163/D-167: reserveFiles() - found missing during D-177's allowlist read (D-178), the same
  // D-117/D-120 gap class where the resource Lambda route existed but the BFF never proxied it.
  { method: "POST", pathTemplate: "/document-archive/documents/{documentId}/versions/{seq}/files" },
  { method: "POST", pathTemplate: "/document-archive/documents/{documentId}/versions/{seq}/commit" },
  { method: "POST", pathTemplate: "/document-archive/documents/{documentId}/versions/{seq}/claim" },
  { method: "POST", pathTemplate: "/document-archive/documents/{documentId}/versions/{seq}/accept" },
  { method: "POST", pathTemplate: "/document-archive/documents/{documentId}/versions/{seq}/reject" },
  // D-143 Nucleus 2, Requirement (Decision 5/D9, D-145) - same pairing discipline as above.
  { method: "POST", pathTemplate: "/document-archive/requirements" },
  // D-194 Fatia 3 (search/filters).
  { method: "GET", pathTemplate: "/document-archive/requirements/search" },
  { method: "GET", pathTemplate: "/document-archive/requirements/{subjectId}" },
  // Roadmap P0.6, fatia 2 - MUST stay before "{subjectId}/{requirementId}" below: this array is
  // matched by `.find()` (first match wins), unlike API Gateway itself (which resolves the
  // literal segment over a param regardless of declaration order).
  { method: "GET", pathTemplate: "/document-archive/requirements/{subjectId}/compliance" },
  { method: "GET", pathTemplate: "/document-archive/requirements/{subjectId}/{requirementId}" },
  { method: "PATCH", pathTemplate: "/document-archive/requirements/{subjectId}/{requirementId}" },
  { method: "POST", pathTemplate: "/document-archive/requirements/{subjectId}/{requirementId}/link-evidence" },
  { method: "POST", pathTemplate: "/document-archive/requirements/{subjectId}/{requirementId}/unlink-evidence" },
  { method: "POST", pathTemplate: "/document-archive/requirements/{subjectId}/{requirementId}/delete" },
  // D-143 Nucleus 2, entity 3/3, recurrence (Decision 8/D-147) - same pairing discipline as above.
  { method: "POST", pathTemplate: "/document-archive/series" },
  { method: "GET", pathTemplate: "/document-archive/series/{subjectId}" },
  { method: "GET", pathTemplate: "/document-archive/series/{subjectId}/{seriesId}" },
  { method: "POST", pathTemplate: "/document-archive/series/{subjectId}/{seriesId}/cancel" },
  { method: "POST", pathTemplate: "/document-archive/series/{subjectId}/{seriesId}/materialize" },
  { method: "POST", pathTemplate: "/document-archive/series/{subjectId}/{seriesId}/recipient" },
  // D-173 (DocumentType catalog), item 5 - same pairing discipline as above.
  { method: "POST", pathTemplate: "/document-archive/document-types" },
  { method: "GET", pathTemplate: "/document-archive/document-types" },
  { method: "GET", pathTemplate: "/document-archive/document-types/{documentTypeId}" },
  { method: "PATCH", pathTemplate: "/document-archive/document-types/{documentTypeId}" },
  { method: "POST", pathTemplate: "/document-archive/document-types/{documentTypeId}/deprecate" },
  { method: "POST", pathTemplate: "/document-archive/document-types/{documentTypeId}/reactivate" },
  // D-218 fatia 3 (Roadmap P1 "metadata configurÃ¡vel por Document Type") â€” same discipline.
  { method: "POST", pathTemplate: "/document-archive/document-types/{documentTypeId}/metadata-fields" },
  { method: "PATCH", pathTemplate: "/document-archive/document-types/{documentTypeId}/metadata-fields/{fieldId}" },
  { method: "PATCH", pathTemplate: "/document-archive/documents/{documentId}/metadata-values" },
  // RequirementTemplate (P0.1) â€” D-117/D-120/D-178 discipline: a route wired in Terraform but
  // absent here is a Lambda nothing can reach through the BFF.
  { method: "POST", pathTemplate: "/document-archive/requirement-templates" },
  { method: "GET", pathTemplate: "/document-archive/requirement-templates" },
  { method: "GET", pathTemplate: "/document-archive/requirement-templates/{templateId}" },
  { method: "PATCH", pathTemplate: "/document-archive/requirement-templates/{templateId}" },
  { method: "POST", pathTemplate: "/document-archive/requirement-templates/{templateId}/duplicate" },
  { method: "POST", pathTemplate: "/document-archive/requirement-templates/{templateId}/archive" },
  { method: "POST", pathTemplate: "/document-archive/requirement-templates/{templateId}/unarchive" },
  { method: "POST", pathTemplate: "/document-archive/requirement-templates/{templateId}/preview" },
  { method: "POST", pathTemplate: "/document-archive/requirement-templates/{templateId}/apply" },
  // D-205 fatia 1 (Roadmap P1 item 16, dossier export) â€” JSON envelope, same reasoning.
  { method: "POST", pathTemplate: "/document-archive/subjects/{subjectId}/dossier" },
  { method: "POST", pathTemplate: "/document-archive/subjects/{subjectId}/dossier/{runId}/confirm" },
  // D-205 fatia 3 â€” also JSON envelope (`{downloadUrl}`), same reasoning.
  { method: "GET", pathTemplate: "/document-archive/subjects/{subjectId}/dossier/{runId}/download" },
  // ReportSubscription CRUD (D-204 decision 1, Roadmap P1 item 15, implemented D-213) â€” JSON
  // envelope, no content-disposition/CSV gap the GET /reports/* report routes above have (those
  // are deliberately NOT proxied through the BFF, see reports-handler.ts's own comment).
  { method: "POST", pathTemplate: "/reports/subscriptions" },
  { method: "GET", pathTemplate: "/reports/subscriptions" },
  { method: "GET", pathTemplate: "/reports/subscriptions/{subscriptionId}" },
  { method: "POST", pathTemplate: "/reports/subscriptions/{subscriptionId}/delete" },
  // D-204 decision 7 (fatia 3): also JSON envelope (`{downloadUrl}`), same reasoning as the 4
  // CRUD routes above â€” never the file bytes themselves, so no content-disposition gap either.
  { method: "GET", pathTemplate: "/reports/subscriptions/{subscriptionId}/runs/{runId}/download" },
];

function pathMatchesTemplate(path: string, template: string): boolean {
  const pathSegments = path.split("/").filter(Boolean);
  const templateSegments = template.split("/").filter(Boolean);
  if (pathSegments.length !== templateSegments.length) return false;
  return templateSegments.every((seg, i) => (seg.startsWith("{") && seg.endsWith("}")) || seg === pathSegments[i]);
}

/** Returns the matched route (so the caller knows the real, un-templated backend path to
 * call) or undefined if this method+path is not explicitly allowlisted. */
export function matchAllowlistedRoute(method: string, path: string): AllowlistedRoute | undefined {
  return PROXY_ALLOWLIST.find((route) => route.method === method.toUpperCase() && pathMatchesTemplate(path, route.pathTemplate));
}


codex
# Stage 2 — proposta independente de inventário de telas P0

## 1. Premissas verificadas no código

Esta proposta mantém separados três conceitos que o backend também mantém separados:

1. **Vencimento (`ExpirationItem`)** — entidade original, com renovação, lembretes, watchers e documentos de armazenamento genérico.
2. **Fornecedor/Subject legado (`TrackedSubject`) + `RequirementAssignment`** — fluxo ainda vivo de acompanhamento, solicitação e guest upload legado.
3. **Arquivo documental (`Document`, `DocumentVersion`, `Requirement`)** — domínio novo, com versionamento, revisão, evidência, recorrência, templates, tipos documentais e guest upload próprio.

Não proponho fundi-los na interface sem uma mudança de backend. Para reduzir confusão:

- Navegação usa **Vencimentos** para `ExpirationItem`.
- Usa **Entidades acompanhadas** para `TrackedSubject`.
- Usa **Arquivo documental** para `Document`/`DocumentVersion`.
- No detalhe de Subject, as seções se chamam explicitamente:
  - **Acompanhamentos legados** (`RequirementAssignment`);
  - **Requisitos documentais** (`docarchive Requirement`).

### Legenda RBAC

- **Todos** = OWNER, ADMIN, MEMBER, VIEWER.
- **Escrita** = OWNER, ADMIN, MEMBER.
- **Admin** = OWNER, ADMIN.
- **Owner** = OWNER.
- VIEWER nunca vê controle com aparência acionável para uma operação de escrita.
- ADMIN/MEMBER também não veem controles Owner-only; uma explicação somente leitura pode aparecer quando necessária.

## 2. Estrutura de navegação autenticada

```text
Seletor da organização ativa
├── Visão geral
├── Vencimentos
├── Entidades acompanhadas
│   └── Subject
│       ├── Visão geral e compliance
│       ├── Requisitos documentais
│       ├── Acompanhamentos legados
│       ├── Documentos
│       └── Solicitações e recorrências
├── Arquivo documental
│   ├── Requisitos
│   └── Revisões
├── Importações
├── Relatórios
├── Atividade
└── Configurações
    ├── Minha conta e notificações
    ├── Equipe
    ├── Organização
    ├── Tipos de documento
    ├── Templates de requisitos
    └── Entrega de solicitações
```

Documentos não recebem uma coleção tenant-wide funcional no P0 atual porque o backend não oferece rota de listagem/pesquisa de `Document`. Eles são descobertos a partir do Subject, Requirement ou link direto conhecido; isso é registrado como gap adiante.

## 3. Contrato compartilhado de estados

Todas as telas autenticadas devem implementar:

- **Loading inicial**: skeleton estrutural; manter organização ativa visível.
- **Loading incremental**: preservar dados atuais e marcar somente painel/página em atualização.
- **Empty**: distinguir “nenhum registro existe”, “nenhum resultado para estes filtros” e “nenhum registro acessível”.
- **Success**: confirmação próxima à ação e anúncio em `aria-live`.
- **Validation**: resumo de erros, foco no primeiro campo inválido e mensagem por campo.
- **Authorization denial**: remover controles previsivelmente proibidos; tratar 403 residual como mudança de papel/sessão e oferecer voltar/recarregar.
- **Not found/stale link**: não mudar automaticamente para outra organização; oferecer voltar à coleção apropriada.
- **OCC conflict (409)**: nunca sobrescrever silenciosamente; mostrar “este registro mudou”, permitir recarregar e reaplicar.
- **Dependency unavailable/timeout/429**: preservar entrada local, mostrar retry e evitar duplo submit.
- **Partial result**: sinalizar `scanLimitReached`, relatório truncado ou importação parcialmente válida.
- **Organization lifecycle**: em tenant não ativo, bloquear mutações; `HELD_FOR_RECOVERY` só expõe recuperação Owner-only.
- **Offline/browser upload interruption**: manter seleção de arquivos quando seguro e permitir reiniciar a etapa.
- **Unknown asynchronous state**: nunca converter “ainda não observado” em “concluído”.

Padrão responsivo comum:

- Todas as telas têm **paridade funcional móvel**, exceto onde uma transformação é explicitada.
- Tabelas viram lista de cartões ou tabela com região horizontal rotulada; ações de linha ficam em menu com nome acessível.
- Diálogos críticos usam modal no desktop e drawer/tela inteira no móvel.
- Ordem de foco segue ordem visual; foco volta ao acionador ao fechar.
- Alvos mínimos de 44×44 CSS px, reflow a 320 CSS px, sem informação transmitida apenas por cor.
- Mudanças assíncronas, erro de upload e progresso são anunciados; barras de progresso têm nome e valor.

---

# 4. Inventário autenticado

## A01 — Entrada e sessão

**Rotas UI:** `/login`, `/auth/callback`, `/session-expired`

**Propósito:** autenticar, concluir callback e recuperar sessão expirada.

**Dados:** identidade do usuário, estado da sessão, `returnPath` validado.

**Ações:** não usa `Action`; é fronteira BFF/Cognito.

**Estados específicos:** sessão ausente, callback inválido, refresh em andamento, refresh falhou, reautenticação exigida. O retorno nunca aceita destino externo.

**Conexões:** entrada por URL protegida → organização/onboarding ou rota originalmente solicitada.

**Responsividade:** paridade total; formulário de uma coluna; foco no título/erro após callback.

---

## A02 — Onboarding e organizações

**Rotas UI:** `/onboarding`, `/organizations`, `/invitations/accept`

**Propósito:** criar a primeira organização, listar organizações acessíveis, aceitar convite e escolher organização ativa.

**Dados:** `Organization` (`organizationId`, `displayName`, `timezone`), Membership (`role`, `status`), convite (`email`, papel, expiração).

**Ações:** criação/listagem/seleção/aceite são operações BFF anteriores ao contexto tenant; não possuem `Action` na matriz. `membership:leave` fica em A19.

**Estados específicos:**

- zero memberships;
- convite válido, já aceito, revogado, expirado;
- e-mail do convite incompatível;
- Membership `SUSPENDED` ou `REMOVED`;
- organização selecionada tornou-se inacessível;
- GSI de memberships eventualmente consistente: seleção só é confirmada após validação base-table pelo backend.

**Conexões:** login → onboarding/seletor → A03. Convite por link → aceite → organização correspondente.

**Responsividade:** paridade total; cartões de organizações; nenhuma seleção só por cor.

---

## A03 — Visão geral operacional

**Rota UI:** `/app/:orgId/dashboard`

**Propósito:** entrada operacional do tenant.

**Dados:** organização ativa; contadores reais de `/dashboard/summary`: vencidos, vencendo na janela implementada de 7 dias, aguardando revisão e requisitos ausentes; atalhos para Subjects e trabalho recente.

**Ações:** leituras derivadas de `item:read`, `docarchive:read` e `docarchive:requirement-read` (**Todos**).

**Estados específicos:** cada contador carrega/falha independentemente; dado parcial não zera os demais. Não exibir “aguardando cliente” ou “renovações abertas”, pois esses contadores não existem no modelo.

**Conexões:** cards → A04 com filtro, A11 com status, A13. Cabeçalho → seletor de organização.

**Responsividade:** paridade total; cards refluem 4→2→1 colunas; ordem mantém severidade.

---

## A04 — Coleção de vencimentos

**Rota UI:** `/app/:orgId/expirations`

**Propósito:** pesquisar e operar `ExpirationItem`.

**Dados:** nome, categoria, due date, situação derivada, responsável, prioridade, tags, status; busca/filtros suportados pelo endpoint real.

**Ações:**

- `item:read` — **Todos**;
- `item:create`, `item:update` — **Escrita**;
- `item:delete` — **Admin**;
- `item:export` — **Admin**;
- bulk reassign/archive reutilizam `item:update` — **Escrita**;
- arquivar/renovar → A05.

**Estados específicos:** sem itens; nenhum resultado; seleção parcial; item alterado durante bulk; resultado por item em ação parcial; export truncado/indisponível.

**Conexões:** dashboard → filtros; linha → A05; “Novo” → formulário; Importar → A15; exportar permanece nesta tela.

**Responsividade:** paridade com transformação: tabela desktop; cartões selecionáveis no móvel; bulk toolbar sticky apenas dentro do fluxo, sem ocultar conteúdo.

---

## A05 — Detalhe e edição do vencimento

**Rota UI:** `/app/:orgId/expirations/:itemId`

**Propósito:** administrar um `ExpirationItem`, sua linhagem, lembretes, watchers e documentos genéricos.

**Dados:** todos os campos do item (`name`, `category`, `description`, datas, periodicidade, emissor, número, assignee, tags, prioridade, status, versão, `renewedFromId`).

**Ações:**

- `item:read` — **Todos**;
- `item:update`, `item:watch` — **Escrita**;
- `item:delete` — **Admin**;
- renovar/arquivar — `item:update`, **Escrita**;
- `reminder:manage` — **Escrita**, abre A06;
- `document:reserve-upload` — **Escrita**, abre A07;
- `document:read` — **Todos**;
- `document:delete` — **Admin**;
- `audit:read` — **Todos**, histórico técnico do agregado.

**Estados específicos:** ACTIVE/ARCHIVED/RENEWED/DELETED; sucessor/origem ausente; versão OCC; renovação idempotente em retry; arquivo em processamento.

**Conexões:** A04 ↔ A05; documentos → A07; política → A06; `renewedFromId`/sucessor → outro A05.

**Responsividade:** paridade total; abas viram navegação horizontal acessível ou seções; ações destrutivas não ficam no menu primário.

---

## A06 — Política de lembretes do vencimento

**Rota UI:** `/app/:orgId/expirations/:itemId/reminders/:policyId?`

**Propósito:** criar, consultar, editar ou desabilitar política real de lembrete.

**Dados:** policy id, offsets/agenda do contrato, canais e estado habilitado.

**Ações:** `reminder:manage` — **Escrita**.

**Estados específicos:** política inexistente, desabilitada, conflito de versão, canal sem entitlement, quiet hours, dependência Scheduler indisponível.

**Conexões:** somente A05 → A06 → A05. Preferências pessoais de recebimento → A18.

**Responsividade:** paridade total; editor de sequência em lista vertical no móvel.

---

## A07 — Documento genérico/OCR ligado ao vencimento

**Rota UI:** `/app/:orgId/expirations/:itemId/files/:documentId?`

**Propósito:** upload, leitura, remoção e confirmação/rejeição de campos extraídos no módulo de armazenamento antigo.

**Dados:** arquivo, mídia, tamanho, status PENDING_UPLOAD/SCANNING/CLEAN/REJECTED/UNSUPPORTED/TIMEOUT/DELETED; extração, campo, valor sugerido e confiança quando retornados.

**Ações:**

- `document:reserve-upload` — **Escrita**;
- `document:read` — **Todos**;
- `document:delete` — **Admin**;
- `extraction:confirm` — **Escrita**.

**Estados específicos:** reserva aceita ≠ bytes enviados; scanning; malware; tipo não suportado; timeout; campo sugerido ≠ confirmado; confirmação concorrente.

**Conexões:** A05 ↔ A07. Não confundir este documento com A12 (`DocumentVersion`).

**Responsividade:** paridade; comparação campo sugerido/confirmado empilha no móvel; preview pode abrir tela inteira.

---

## A08 — Coleção de entidades acompanhadas

**Rota UI:** `/app/:orgId/subjects`

**Propósito:** listar/pesquisar `TrackedSubject`.

**Dados:** `subjectId`, nome, tipo COMPANY/VENDOR/CLIENT/EMPLOYEE/ASSET/LOCATION/CUSTOM, identificador externo, contato, tags, assignee, status e resumo legado.

**Ações:**

- `subject:read` — **Todos**;
- `subject:create`, `subject:update` — **Escrita**;
- `subject:delete` — **Admin**.

**Estados específicos:** ACTIVE/ARCHIVED/DELETED; nenhum resultado; identificador duplicado; exclusão bloqueada por regra.

**Conexões:** dashboard/A11 → A08 filtrada; linha → A09; criar → formulário → A09.

**Responsividade:** paridade com tabela→cartões.

---

## A09 — Hub do Subject e compliance

**Rota UI:** `/app/:orgId/subjects/:subjectId`

**Propósito:** ponto canônico para tudo que pertence a um Subject.

**Dados:** cadastro do `TrackedSubject`; compliance real (`totalRequirements`, satisfied, expiring soon, missing, percentual ou `null`); contagens de documentos, requisitos e séries.

**Ações:**

- `subject:read` — **Todos**;
- `subject:update` — **Escrita**;
- `subject:delete` — **Admin**;
- `docarchive:requirement-read`, `docarchive:read`, `docarchive:series-read` — **Todos**;
- `docarchive:dossier-export` — **Admin**, A17.

**Estados específicos:** compliance `null` quando não há requisitos; painéis parcialmente indisponíveis; Subject arquivado; links para recursos removidos.

**Conexões:** A08 ↔ A09; abas/links → A10, A12, A14; dossier → A17.

**Responsividade:** paridade; resumo antes das abas; percentual sempre acompanhado de numerador/denominador explicável.

---

## A10 — Acompanhamentos legados do Subject

**Rotas UI:** `/app/:orgId/subjects/:subjectId/tracking`, `/.../tracking/:assignmentId`

**Propósito:** manter o domínio ainda vivo `RequirementAssignment`, suas submissões e solicitações legadas.

**Dados:** assignment id, label, description, status MISSING/SATISFIED, item vinculado, version; submissions; requests, recipient, expiry/revocation/delivery.

**Ações:**

- `requirement:read` — **Todos**;
- `requirement:assign`, `requirement:update`, `requirement:review`, `requirement:request-document` — **Escrita**;
- `requirement:delete` — **Admin**.

**Estados específicos:** item vinculado ausente/arquivado; MISSING/SATISFIED sem inferir compliance do domínio novo; request ativo/revogado/expirado; submissão PENDING_UPLOAD/SCANNING/CLEAN/REJECTED etc.; chasing agendado é informativo, não editável.

**Conexões:** A09 → A10; item vinculado → A05; criar solicitação → link guest G01; submissions → detalhe nesta tela.

**Responsividade:** paridade; timeline em lista; ações contextuais por assignment.

---

## A11 — Requisitos documentais tenant-wide

**Rota UI:** `/app/:orgId/requirements`

**Propósito:** fila pesquisável de `docarchive Requirement`.

**Dados:** nome, Subject, applicability, status MISSING/PENDING/SATISFIED/NOT_SATISFIED/NOT_APPLICABLE, assignee, evidence document/version, validity, origem de template.

**Ações:**

- `docarchive:requirement-read` — **Todos**;
- `docarchive:requirement-create`, `-update`, `-delete` — **Escrita**;
- link/unlink evidence usa `docarchive:requirement-update` — **Escrita**;
- `docarchive:requirement-export` — **Admin**;
- aplicar template usa `docarchive:requirementtemplate-apply` — **Escrita**.

**Estados específicos:** busca exige status; `scanLimitReached`; evidência pendente/rejeitada/vencida; assignee removido; `NOT_APPLICABLE`; colisão por nome; preview de template com itens `create` e `skip:DUPLICATE_NAME`.

**Conexões:** A03 card → A11 filtrada; linha → A09 na aba requisito; evidência → A12; template → A21.

**Responsividade:** paridade com filtros em drawer; filtros ativos anunciados; resultado parcial destacado.

---

## A12 — Documento e histórico de versões

**Rota UI:** `/app/:orgId/documents/:documentId`

**Propósito:** administrar o agregado documental descoberto a partir de Subject/requisito/link direto.

**Dados:**

- Document: Subject, Document Type, ACTIVE/ARCHIVED, `hasValidity`, versão aceita atual, metadata;
- versões: seq, DRAFT/RECEIVED/UNDER_REVIEW/ACCEPTED/REJECTED/SUPERSEDED/WITHDRAWN, origin, issued/valid dates, reviewer, rejection reason, scan counts;
- arquivos: nome, mídia, tamanho, principal/complementar, scan state.

**Ações:**

- `docarchive:read` — **Todos**;
- `docarchive:create`, `docarchive:upload`, `docarchive:document-metadata-update` — **Escrita**;
- `docarchive:review` — **Escrita**; claim/accept/reject, com gate adicional reviewer-or-admin do serviço.

Não existe ação de arquivar Document nem rota correspondente, apesar de `Document.status` admitir ARCHIVED; nenhum botão é inventado.

**Estados específicos:** upload em três etapas (reservar versão → reservar arquivos/enviar → commit); file set sealed; scan pendente/infectado; claim perdido/expirado; versão terminal; nova aceita supersede a anterior; metadata required ausente é mostrado como incompletude, não impede criação; metadata field/option arquivado mantém snapshot; OCC.

**Conexões:** A09/A11/A13 → A12; “nova versão” permanece em A12; revisão → A13; tipo → A20.

**Responsividade:** paridade; timeline de versões substitui tabela no móvel; preview de arquivo em tela inteira. Nenhuma operação review é degradada.

---

## A13 — Fila de revisão documental

**Rota UI:** `/app/:orgId/reviews`

**Propósito:** descobrir e revisar versões RECEIVED/UNDER_REVIEW.

**Dados:** versão, documento, Subject, origem, recebimento, reviewer, scan counters e validade proposta.

**Ações:** `docarchive:read` — **Todos**; `docarchive:review` — **Escrita**, sujeito ao gate reviewer-or-admin.

**Estados específicos:** item já reivindicado, claim expirou, scan ainda pendente, infectado, decisão concorrente, rejeição requer motivo fechado e “OTHER” quando aplicável.

**Conexões:** A03 → A13; item → A12 focado na versão; decisão → próximo item ou A12.

**Responsividade:** paridade; painel dividido vira sequência lista→detalhe no móvel.

**Gap importante:** o backend possui GSI de review queue e contador no dashboard, mas não expõe rota HTTP de listagem da fila. A tela só deve ser implementada após o gap G2 do registro de adiamentos.

---

## A14 — Solicitações e recorrências do Subject

**Rotas UI:** `/app/:orgId/subjects/:subjectId/requests`, `/.../series/:seriesId`

**Propósito:** criar e operar `DocumentRequestSeries`, visualizar materializações e destinatário.

**Dados:** Subject, Requirement, série, status, agenda/recorrência, próxima execução, recipientEmail, versões, tentativas/materializações conhecidas.

**Ações:**

- `docarchive:series-read` — **Todos**;
- `docarchive:series-create`, `-update`, `-cancel` — **Escrita**;
- `docarchive:series-materialize` — **Escrita**; controle “Gerar agora” separado da automação;
- `docarchive:request-create` — **Escrita**, mas sem rota HTTP tenant-facing disponível.

**Estados específicos:** ACTIVE/CANCELLED; destinatário ausente; tentativa ainda não materializada; geração idempotente; emissão/entrega de credencial incerta; série mudou por OCC; request expirado/revogado/resolvido conforme entidade.

**Conexões:** A09 → A14; request emitido → G02; Requirement → A11/A09; submissão recebida → A13/A12.

**Responsividade:** paridade; agenda resumida em linguagem natural e forma técnica acessível.

---

## A15 — Importações em massa

**Rotas UI:** `/app/:orgId/imports/new`, `/app/:orgId/imports/:jobId`

**Propósito:** upload CSV, inspeção do schema, mapeamento, preview e commit de Subjects/Documents/Requirements conforme contrato implementado.

**Dados:** job id, tipo/status, colunas, mapeamentos, linhas válidas/inválidas, dedupe, resultados e cursor/progresso.

**Ações:**

- `import:create`, `import:map`, `import:commit` — **Escrita**;
- `import:read` — **Todos**.

**Estados específicos:** parsing assíncrono; coluna obrigatória sem mapa; mapping inválido; falha por linha; sucesso parcial; job retomável; commit já executado/idempotente; limite/quota; arquivo incompatível.

**Conexões:** A04/A08/A11 → A15; conclusão oferece links aos recursos criados e à própria importação.

**Responsividade:** **transformação**, não degradação: mapeamento usa pares de campos empilhados no móvel em vez de grade larga; tabela de erros vira lista. Importação continua possível no móvel.

---

## A16 — Relatórios e exportações

**Rota UI:** `/app/:orgId/reports`

**Propósito:** gerar downloads CSV disponíveis e administrar relatórios agendados.

**Dados:** sete relatórios reais: expired-items, expiring-soon-items, renewed-items, expiration-items-by-assignee, missing-requirements, requirements-by-subject, requirements-by-assignee; subscriptions, recipients, periodicidade, runs/download.

**Ações:**

- relatórios de itens → `item:export` — **Admin**;
- relatórios de requisitos → `docarchive:requirement-export` — **Admin**;
- assinaturas → `reports:subscription-manage` — **Admin**;
- recipient de um run pode baixar aquele run por gate específico do backend, mesmo sem Admin.

**Estados específicos:** relatório vazio; geração/download falhou; CSV truncado via header; URL de download expirada e regenerável; assinatura apagada; run ausente; recipient removido da assinatura atual ainda pode acessar run que realmente recebeu.

**Conexões:** nav → A16; linhas podem abrir A04/A11 com filtro equivalente quando possível.

**Responsividade:** paridade; catálogo em cartões; editor de recipients pesquisável por teclado.

**Limitação:** os sete CSV endpoints não são proxied pelo BFF atual devido ao tratamento de `Content-Disposition`; ver gap G3.

---

## A17 — Dossiê do Subject

**Rota UI:** `/app/:orgId/subjects/:subjectId/dossier`

**Propósito:** preview, confirmação e download PDF/Excel do dossiê.

**Dados:** escopo congelado, documentos/requisitos incluídos, formato, `scopeHash`, run e validade do download.

**Ações:** `docarchive:dossier-export` — **Admin**.

**Estados específicos:** preview mudou antes da confirmação; hash obsoleto; geração pendente/falhou; export expirado; presign expirado e regenerável.

**Conexões:** A09 → A17 → download/A09.

**Responsividade:** paridade; preview longo em seções colapsáveis, nunca desktop-only.

---

## A18 — Minhas preferências de notificação

**Rota UI:** `/app/:orgId/settings/notifications`

**Propósito:** configurar preferências por usuário e organização.

**Dados reais:** `emailEnabled`, locale, quiet hours, consent source; entitlement/canal disponível quando exposto.

**Ações:** `notification:configure` — **Todos**, sempre para o próprio usuário.

**Estados específicos:** defaults ainda não persistidos; quiet-hours inválidas/atravessam meia-noite; canal indisponível por entitlement; WhatsApp sem opt-in gravável.

**Conexões:** avatar/settings → A18; A06 pode apontar para cá.

**Responsividade:** paridade total.

**Regra:** não mostrar toggle WhatsApp acionável enquanto não existir rota HTTP de opt-in. Pode mostrar “indisponível no momento” se o produto precisar explicar o canal.

---

## A19 — Equipe e organização

**Rotas UI:** `/app/:orgId/settings/team`, `/app/:orgId/settings/organization`

**Propósito:** membros, convites, identidade da organização, saída e encerramento.

**Dados:** Organization (`displayName`, timezone, quiet hours, ownerCount); Membership (`userId`, role, status); Invitation (email, role, status, expiresAt).

**Ações:**

- `membership:list-members`, `membership:leave` — **Todos**;
- `membership:invite`, `membership:list-invitations`, `membership:revoke-invitation`, `membership:role-change`, `membership:remove` — **Admin**;
- promover/rebaixar OWNER requer **Owner** adicional no serviço;
- `organization:update-settings`, `organization:close`, `organization:cancel-close` — **Owner**.

**Estados específicos:** último Owner; alvo é o próprio usuário; convite duplicado/expirado/revogado; membro SUSPENDED/REMOVED; organização ACTIVE/DELETING/HELD_FOR_RECOVERY/BLOCKED/DELETED; encerramento exige confirmação forte; cancelamento só em recovery window.

**Conexões:** settings → A19; convite emitido → A02; sair/fechar → A02.

**Responsividade:** paridade; membros em cartões no móvel; diálogo de encerramento em tela inteira e foco obrigatório na confirmação.

---

## A20 — Tipos documentais e metadata

**Rotas UI:** `/app/:orgId/settings/document-types`, `/.../document-types/:documentTypeId`

**Propósito:** catálogo compartilhado de `DocumentType` e definições de metadata.

**Dados:** display name, categoria/descrição e validade padrão conforme entidade; ACTIVE/DEPRECATED; campos metadata, valueType TEXT/NUMBER/DECIMAL/DATE/BOOLEAN/SINGLE_SELECT, required, opções e estados arquivados.

**Ações:**

- `docarchive:documenttype-read` — **Todos**;
- create/rename/deprecate/reactivate — ações `docarchive:documenttype-*`, **Admin**;
- `docarchive:documenttype-metadata-manage` — **Admin**.

**Estados específicos:** nomes duplicados; deprecated ainda referenciado; campo/opção arquivado; mudança OCC; tipo sem metadata; required não retrovalida automaticamente Documents existentes.

**Conexões:** settings → A20; tipo → A12 filtrado somente quando futuramente houver collection; A12 mostra link para tipo.

**Responsividade:** paridade; construtor de campos empilhado no móvel, reordenação não depende apenas de drag-and-drop.

---

## A21 — Templates de requisitos

**Rotas UI:** `/app/:orgId/settings/requirement-templates`, `/.../requirement-templates/:templateId`

**Propósito:** catálogo, edição, duplicação, archive/unarchive, preview e aplicação.

**Dados:** displayName, description, ACTIVE/ARCHIVED, itens (id estável, nome, notas, applicability, position), versão.

**Ações:**

- `docarchive:requirementtemplate-read` — **Todos**;
- create/update/duplicate/archive/unarchive — ações correspondentes, **Admin**;
- `docarchive:requirementtemplate-apply` — **Escrita**.

**Estados específicos:** template vazio inválido conforme schema; colisão de nome; preview por Subject; itens a criar versus skips `DUPLICATE_NAME`; aplicação parcial/conflito; archived somente leitura para não-admin.

**Conexões:** settings → A21; A09/A11 → seletor/preview → aplicar → A11/A09.

**Responsividade:** paridade; itens em lista reordenável também por botões/teclado, não só arraste.

---

## A22 — Entrega de solicitações

**Rota UI:** `/app/:orgId/settings/request-delivery`

**Propósito:** política tenant-wide do fluxo legado de solicitação documental.

**Dados:** `initialInviteDeliveryDefault`: MANUAL ou EMAIL.

**Ações:** `tenant:configure-document-request-delivery` — **Owner**.

**Estados específicos:** default ainda ausente; alteração OCC; email temporariamente indisponível; explicar que a mudança afeta novos convites, não revoga links existentes.

**Conexões:** settings → A22; A10 criação de request mostra o modo resultante.

**Responsividade:** paridade total.

---

## A23 — Atividade administrativa

**Rota UI:** `/app/:orgId/activity`

**Propósito:** exibir log tenant-wide de ações de membros.

**Dados:** ator, ação, tipo/id do recurso, timestamp e mudanças disponibilizadas pelo endpoint.

**Ações:** `activity:read` — **Admin**.

**Estados específicos:** nenhum evento; paginação; ator removido; recurso já apagado; payload não traduzível. Mostrar fallback legível sem expor JSON sensível indiscriminadamente.

**Conexões:** nav Admin → A23; recurso reconhecido → sua tela de detalhe.

**Responsividade:** paridade; timeline no móvel.

---

# 5. Superfícies guest

As duas famílias guest são estruturalmente separadas do app autenticado:

- sem shell, seletor ou cookie de organização;
- autorização exclusivamente pelo token/credential/session;
- nunca redirecionam para login;
- falhas de token inexistente, revogado, expirado ou tenant inacessível colapsam em mensagem segura equivalente;
- organização/solicitante só é exibido se o backend realmente fornecer identidade confiável.

## G01 — Guest upload legado

**Rota UI:** `/guest/document-requests/:token`

**Propósito:** atender `DocumentRequest` do domínio `subject`.

**Dados:** detalhes seguros da solicitação, arquivo esperado, prazo quando fornecido, upload/submission.

**Ações:** nenhuma `Action`; convidado é validado por `GuestTokenService`.

**Estados específicos:** token inválido/expirado/revogado indistinguíveis; request já satisfeito; reserva aceita; upload em andamento; upload concluído sem afirmar “aprovado”; scanning/malware quando observável; retry seguro.

**Conexões:** entrada somente por link entregue desde A10; sucesso termina em confirmação/reentrada segura.

**Responsividade:** paridade móvel prioritária; seletor de arquivo/câmera com label; progresso anunciado.

---

## G02 — Guest request do arquivo documental

**Rota UI:** `/document-archive/guest/document-requests/:token`

**Propósito:** resolver credencial, iniciar GuestSession com CSRF e enviar evidência para `docarchive DocumentRequest`.

**Dados:** request/requirement/Subject permitidos; catálogo público de Document Types; arquivo, `documentTypeId`, datas/validade exigidas pelo contrato.

**Ações:** nenhuma `Action`; credential + session + CSRF formam a fronteira guest.

**Estados específicos:**

- credential inválida, expirada ou revogada com resposta anti-enumeration;
- sessão não iniciada/expirada;
- CSRF inválido;
- Document Type deprecated ou deixou de existir;
- `documentTypeId` obrigatório;
- arquivo inválido, quota, scan;
- submissão aceita ≠ revisão concluída;
- request já resolvido;
- emissão/entrega anterior `SEND_UNCERTAIN` não deve ser revelada ao guest.

**Conexões:** entrada por link produzido por A14/materialização; sucesso → confirmação na mesma superfície; operador continua em A13/A12.

**Responsividade:** mobile-first, paridade total; fluxo em etapas curtas, resumo antes do envio e possibilidade de corrigir.

---

# 6. Matriz Action → superfície

| Família de Actions | Superfície |
|---|---|
| `item:create/read/update/delete/export/watch` | A04–A05 |
| `reminder:manage` | A06 |
| `document:reserve-upload/read/delete`, `extraction:confirm` | A07 |
| `notification:configure` | A18 |
| `audit:read` | A05 |
| `system:ping` | DEFERRED G1 |
| `subject:create/read/update/delete` | A08–A09 |
| `requirement:assign/read/update/delete/review/request-document` | A10 |
| `tenant:configure-document-request-delivery` | A22 |
| `import:create/read/map/commit` | A15 |
| `membership:*` | A19, com aceite em A02 |
| `organization:update-settings/close/cancel-close` | A19 |
| `docarchive:create/read/upload/document-metadata-update` | A12 |
| `docarchive:review` | A13/A12 |
| `docarchive:requirement-*` | A11 e detalhe em A09 |
| `docarchive:series-*` | A14 |
| `docarchive:request-create` | A14, bloqueado por G4 |
| `docarchive:documenttype-*` e metadata manage | A20 |
| `docarchive:requirementtemplate-*` | A21/A11 |
| `docarchive:requirement-export` | A16/A11 |
| `activity:read` | A23 |
| `reports:subscription-manage` | A16 |
| `docarchive:dossier-export` | A17 |

## 7. Mapa reverso superfície → capacidades

- A03 → reads de items, Requirements e review summary.
- A04/A05 → `item:*`, `item:watch`, `audit:read`.
- A06 → `reminder:manage`.
- A07 → `document:*`, `extraction:confirm`.
- A08/A09 → `subject:*` e reads do domínio documental.
- A10 → `requirement:*`.
- A11 → `docarchive:requirement-*`, template apply/export.
- A12/A13 → `docarchive:create/read/upload/review/document-metadata-update`.
- A14 → `docarchive:series-*`, `docarchive:request-create`.
- A15 → `import:*`.
- A16/A17 → exports, subscriptions e dossier.
- A18 → `notification:configure`.
- A19 → membership/organization.
- A20 → Document Type/metadata catalog.
- A21 → Requirement Template catalog/application.
- A22 → delivery policy.
- A23 → `activity:read`.
- G01/G02 → token/session-based guest services, sem RBAC `Action`.

# 8. Registro de gaps e adiamentos pela regra de seis condições

## G1 — DEFERRED: `system:ping` sem tela de produto

1. **Fora do P0:** rota M1 de diagnóstico, não capacidade de usuário.
2. **Motivo concreto:** criar uma tela confundiria health check técnico com produto.
3. **Destino/gatilho:** console interno de suporte/observabilidade, se existir operação humana real.
4. **Dependências:** autenticação de suporte e modelo de autorização operacional.
5. **Nenhuma jornada P0 pendente:** login e app não dependem de o usuário invocar ping.
6. **Registro:** ação deliberadamente DEFERRED, não omitida.

## G2 — DEFERRED/BACKEND GAP: descoberta da Review Queue e coleção de Documents

1. **Fora da implementação imediata da UI:** A13 e uma coleção tenant-wide de Documents não podem ser alimentadas integralmente.
2. **Motivo concreto:** há GSI/review count e `getDocument/listVersions`, mas nenhuma rota HTTP de `listReviewQueue`, `listDocuments` ou `searchDocuments`.
3. **Destino/gatilho:** antes de considerar A13 e “Documents Collection” P0 implementados; criar endpoints paginados e RBAC `docarchive:read`.
4. **Dependências:** contratos de paginação/filtros, BFF allowlist e Terraform.
5. **Jornada:** hoje há um dangling P0 real — o operador sabe que existem revisões pelo dashboard, mas não consegue descobri-las. Portanto isto é **blocker de frontend P0**, não adiamento aceitável até pós-lançamento.
6. **Registro:** DEFERRED somente até o backend gap ser fechado; não fingir coleção usando dados incompletos.

## G3 — DEFERRED/BACKEND-BFF GAP: CSVs diretos

1. **Fora da UI integrada atual:** sete rotas CSV não estão no proxy allowlist.
2. **Motivo concreto:** o próprio código registra o gap de `Content-Disposition`.
3. **Destino/gatilho:** antes de A16 ser launch-ready.
4. **Dependências:** proxy seguro para streaming/headers ou mecanismo autenticado de download alternativo.
5. **Jornada:** relatórios P0 ficam pendentes sem isso; é blocker de integração, embora os endpoints backend existam.
6. **Registro:** DEFERRED até fechamento do BFF, sem inventar download browser direto com JWT.

## G4 — DEFERRED/BACKEND GAP: `docarchive:request-create` avulso

1. **Fora da UI acionável atual:** nenhuma rota HTTP correspondente aparece no handler/allowlist.
2. **Motivo concreto:** a Action e o serviço existem, mas não há endpoint tenant-facing para A14 invocar.
3. **Destino/gatilho:** antes de oferecer “Solicitação avulsa” no P0.
4. **Dependências:** schema, handler, API Gateway, BFF allowlist e contrato de emissão/entrega da credencial.
5. **Jornada:** recorrência/materialização permanece utilizável; a jornada avulsa do roadmap, porém, fica pendente e deve ser tratada como blocker se exigida no launch.
6. **Registro:** controle oculto e capacidade marcada DEFERRED, não simulada.

## G5 — DEFERRED/BACKEND GAP: WhatsApp opt-in

1. **Fora da UI acionável:** A18 não oferece toggle WhatsApp.
2. **Motivo concreto:** `WhatsAppOptInService.recordOptIn()` não tem rota HTTP.
3. **Destino/gatilho:** antes de habilitar WhatsApp a usuários reais.
4. **Dependências:** endpoint autenticado, consentimento/auditabilidade, aceite DPA Meta, aviso de privacidade, residência de dados e credenciais/entitlement.
5. **Jornada:** email continua funcional; jornada WhatsApp real permanece explicitamente bloqueada, não aparenta estar concluída.
6. **Registro:** DEFERRED com canal apresentado como indisponível, nunca como preferência persistida.

## G6 — DEFERRED: dois cards desejados do dashboard

1. **Fora do P0 implementável agora:** “aguardando cliente” e “renovações abertas”.
2. **Motivo concreto:** nenhuma taxonomia atual modela ambos de forma confiável.
3. **Destino/gatilho:** milestone posterior à definição de estados de request/renewal que suportem contagem inequívoca.
4. **Dependências:** decisão de produto, modelo/índice e endpoint.
5. **Jornada:** dashboard mantém quatro métricas reais e links úteis; não apresenta números fabricados.
6. **Registro:** DEFERRED, conforme o próprio roadmap.

## G7 — DEFERRED: ExternalShareLink

1. **Fora do P0:** item P1; somente domínio/persistência foram implementados.
2. **Motivo concreto:** rotas anônimas e autenticadas, Actions, schemas e wiring ainda não existem.
3. **Destino/gatilho:** retomada do P1 após fechamento do P0.
4. **Dependências:** slices HTTP/RBAC/infra restantes.
5. **Jornada:** nenhum fluxo P0 depende de compartilhamento externo de leitura; guest upload é independente.
6. **Registro:** nenhuma tela/control “Compartilhar” em A12.

## G8 — DEFERRED: controles internos

1. **Fora do P0:** workers de chasing, `series-materialize` automático, notification attempts, entitlements, quotas internas, credential delivery e audit/security internals não são consoles de usuário.
2. **Motivo concreto:** não há Actions/rotas de administração humana para essas entidades.
3. **Destino/gatilho:** console operacional somente quando suporte/SRE tiver requisitos reais.
4. **Dependências:** modelo de suporte, segregação de privilégios e endpoints próprios.
5. **Jornada:** automações funcionam em background; estados relevantes aparecem no recurso do usuário.
6. **Registro:** DEFERRED; não inventar telas administrativas.

# 9. Jornadas principais e cobertura

| Jornada | Superfícies |
|---|---|
| Entrar/criar ou escolher organização | A01 → A02 → A03 |
| Cadastrar e renovar vencimento | A04 → A05 → A06/A07 → A05 |
| Cadastrar Subject e medir compliance | A08 → A09 → A11 |
| Criar requisitos por template | A09/A11 → A21 preview/apply → A11 |
| Solicitar evidência recorrente | A09 → A14 → G02 → A13 → A12/A11 |
| Solicitação/upload legado | A09 → A10 → G01 → A10 |
| Upload e nova versão documental | A09/A11 → A12 → A13 → A12 |
| Importação em massa | A04/A08/A11 → A15 → recursos criados |
| Relatório/dossiê/auditoria | A16/A17/A23 |
| Administrar tenant e equipe | A02/A03 → A19 → A02/A03 |
| Configurar catálogos | A20/A21 → A12/A11 |
| Preferências e canais | A18/A22 → A06/A10/A14 |

# 10. Autoavaliação

**Nota: 9,1/10.**

Por eixo:

- Backend-interface/traceabilidade: **9,4**
- Navegação e screen graph: **9,2**
- RBAC: **9,4**
- Estados/feedback/recovery: **9,2**
- Multi-tenant: **9,3**
- Guest/auth separation: **9,5**
- Responsivo/acessibilidade: **8,8**
- Handoff zero-context: **8,7**

Fraqueza honesta principal: alguns campos exatos dos contratos de importação, reminder policy, séries e ReportSubscription foram resumidos por domínio em vez de reproduzidos campo a campo a partir de cada JSON Schema. Um artefato final de implementação deveria anexar os schemas exatos a A06, A14–A16. Além disso, A13 e a coleção de Documents revelam gaps reais do backend; o inventário é coerente ao nomeá-los, mas o screen graph P0 só deixa de ter esse ponto pendente quando os endpoints de descoberta forem implementados.
tokens used
103.757
# Stage 2 — proposta independente de inventário de telas P0

## 1. Premissas verificadas no código

Esta proposta mantém separados três conceitos que o backend também mantém separados:

1. **Vencimento (`ExpirationItem`)** — entidade original, com renovação, lembretes, watchers e documentos de armazenamento genérico.
2. **Fornecedor/Subject legado (`TrackedSubject`) + `RequirementAssignment`** — fluxo ainda vivo de acompanhamento, solicitação e guest upload legado.
3. **Arquivo documental (`Document`, `DocumentVersion`, `Requirement`)** — domínio novo, com versionamento, revisão, evidência, recorrência, templates, tipos documentais e guest upload próprio.

Não proponho fundi-los na interface sem uma mudança de backend. Para reduzir confusão:

- Navegação usa **Vencimentos** para `ExpirationItem`.
- Usa **Entidades acompanhadas** para `TrackedSubject`.
- Usa **Arquivo documental** para `Document`/`DocumentVersion`.
- No detalhe de Subject, as seções se chamam explicitamente:
  - **Acompanhamentos legados** (`RequirementAssignment`);
  - **Requisitos documentais** (`docarchive Requirement`).

### Legenda RBAC

- **Todos** = OWNER, ADMIN, MEMBER, VIEWER.
- **Escrita** = OWNER, ADMIN, MEMBER.
- **Admin** = OWNER, ADMIN.
- **Owner** = OWNER.
- VIEWER nunca vê controle com aparência acionável para uma operação de escrita.
- ADMIN/MEMBER também não veem controles Owner-only; uma explicação somente leitura pode aparecer quando necessária.

## 2. Estrutura de navegação autenticada

```text
Seletor da organização ativa
├── Visão geral
├── Vencimentos
├── Entidades acompanhadas
│   └── Subject
│       ├── Visão geral e compliance
│       ├── Requisitos documentais
│       ├── Acompanhamentos legados
│       ├── Documentos
│       └── Solicitações e recorrências
├── Arquivo documental
│   ├── Requisitos
│   └── Revisões
├── Importações
├── Relatórios
├── Atividade
└── Configurações
    ├── Minha conta e notificações
    ├── Equipe
    ├── Organização
    ├── Tipos de documento
    ├── Templates de requisitos
    └── Entrega de solicitações
```

Documentos não recebem uma coleção tenant-wide funcional no P0 atual porque o backend não oferece rota de listagem/pesquisa de `Document`. Eles são descobertos a partir do Subject, Requirement ou link direto conhecido; isso é registrado como gap adiante.

## 3. Contrato compartilhado de estados

Todas as telas autenticadas devem implementar:

- **Loading inicial**: skeleton estrutural; manter organização ativa visível.
- **Loading incremental**: preservar dados atuais e marcar somente painel/página em atualização.
- **Empty**: distinguir “nenhum registro existe”, “nenhum resultado para estes filtros” e “nenhum registro acessível”.
- **Success**: confirmação próxima à ação e anúncio em `aria-live`.
- **Validation**: resumo de erros, foco no primeiro campo inválido e mensagem por campo.
- **Authorization denial**: remover controles previsivelmente proibidos; tratar 403 residual como mudança de papel/sessão e oferecer voltar/recarregar.
- **Not found/stale link**: não mudar automaticamente para outra organização; oferecer voltar à coleção apropriada.
- **OCC conflict (409)**: nunca sobrescrever silenciosamente; mostrar “este registro mudou”, permitir recarregar e reaplicar.
- **Dependency unavailable/timeout/429**: preservar entrada local, mostrar retry e evitar duplo submit.
- **Partial result**: sinalizar `scanLimitReached`, relatório truncado ou importação parcialmente válida.
- **Organization lifecycle**: em tenant não ativo, bloquear mutações; `HELD_FOR_RECOVERY` só expõe recuperação Owner-only.
- **Offline/browser upload interruption**: manter seleção de arquivos quando seguro e permitir reiniciar a etapa.
- **Unknown asynchronous state**: nunca converter “ainda não observado” em “concluído”.

Padrão responsivo comum:

- Todas as telas têm **paridade funcional móvel**, exceto onde uma transformação é explicitada.
- Tabelas viram lista de cartões ou tabela com região horizontal rotulada; ações de linha ficam em menu com nome acessível.
- Diálogos críticos usam modal no desktop e drawer/tela inteira no móvel.
- Ordem de foco segue ordem visual; foco volta ao acionador ao fechar.
- Alvos mínimos de 44×44 CSS px, reflow a 320 CSS px, sem informação transmitida apenas por cor.
- Mudanças assíncronas, erro de upload e progresso são anunciados; barras de progresso têm nome e valor.

---

# 4. Inventário autenticado

## A01 — Entrada e sessão

**Rotas UI:** `/login`, `/auth/callback`, `/session-expired`

**Propósito:** autenticar, concluir callback e recuperar sessão expirada.

**Dados:** identidade do usuário, estado da sessão, `returnPath` validado.

**Ações:** não usa `Action`; é fronteira BFF/Cognito.

**Estados específicos:** sessão ausente, callback inválido, refresh em andamento, refresh falhou, reautenticação exigida. O retorno nunca aceita destino externo.

**Conexões:** entrada por URL protegida → organização/onboarding ou rota originalmente solicitada.

**Responsividade:** paridade total; formulário de uma coluna; foco no título/erro após callback.

---

## A02 — Onboarding e organizações

**Rotas UI:** `/onboarding`, `/organizations`, `/invitations/accept`

**Propósito:** criar a primeira organização, listar organizações acessíveis, aceitar convite e escolher organização ativa.

**Dados:** `Organization` (`organizationId`, `displayName`, `timezone`), Membership (`role`, `status`), convite (`email`, papel, expiração).

**Ações:** criação/listagem/seleção/aceite são operações BFF anteriores ao contexto tenant; não possuem `Action` na matriz. `membership:leave` fica em A19.

**Estados específicos:**

- zero memberships;
- convite válido, já aceito, revogado, expirado;
- e-mail do convite incompatível;
- Membership `SUSPENDED` ou `REMOVED`;
- organização selecionada tornou-se inacessível;
- GSI de memberships eventualmente consistente: seleção só é confirmada após validação base-table pelo backend.

**Conexões:** login → onboarding/seletor → A03. Convite por link → aceite → organização correspondente.

**Responsividade:** paridade total; cartões de organizações; nenhuma seleção só por cor.

---

## A03 — Visão geral operacional

**Rota UI:** `/app/:orgId/dashboard`

**Propósito:** entrada operacional do tenant.

**Dados:** organização ativa; contadores reais de `/dashboard/summary`: vencidos, vencendo na janela implementada de 7 dias, aguardando revisão e requisitos ausentes; atalhos para Subjects e trabalho recente.

**Ações:** leituras derivadas de `item:read`, `docarchive:read` e `docarchive:requirement-read` (**Todos**).

**Estados específicos:** cada contador carrega/falha independentemente; dado parcial não zera os demais. Não exibir “aguardando cliente” ou “renovações abertas”, pois esses contadores não existem no modelo.

**Conexões:** cards → A04 com filtro, A11 com status, A13. Cabeçalho → seletor de organização.

**Responsividade:** paridade total; cards refluem 4→2→1 colunas; ordem mantém severidade.

---

## A04 — Coleção de vencimentos

**Rota UI:** `/app/:orgId/expirations`

**Propósito:** pesquisar e operar `ExpirationItem`.

**Dados:** nome, categoria, due date, situação derivada, responsável, prioridade, tags, status; busca/filtros suportados pelo endpoint real.

**Ações:**

- `item:read` — **Todos**;
- `item:create`, `item:update` — **Escrita**;
- `item:delete` — **Admin**;
- `item:export` — **Admin**;
- bulk reassign/archive reutilizam `item:update` — **Escrita**;
- arquivar/renovar → A05.

**Estados específicos:** sem itens; nenhum resultado; seleção parcial; item alterado durante bulk; resultado por item em ação parcial; export truncado/indisponível.

**Conexões:** dashboard → filtros; linha → A05; “Novo” → formulário; Importar → A15; exportar permanece nesta tela.

**Responsividade:** paridade com transformação: tabela desktop; cartões selecionáveis no móvel; bulk toolbar sticky apenas dentro do fluxo, sem ocultar conteúdo.

---

## A05 — Detalhe e edição do vencimento

**Rota UI:** `/app/:orgId/expirations/:itemId`

**Propósito:** administrar um `ExpirationItem`, sua linhagem, lembretes, watchers e documentos genéricos.

**Dados:** todos os campos do item (`name`, `category`, `description`, datas, periodicidade, emissor, número, assignee, tags, prioridade, status, versão, `renewedFromId`).

**Ações:**

- `item:read` — **Todos**;
- `item:update`, `item:watch` — **Escrita**;
- `item:delete` — **Admin**;
- renovar/arquivar — `item:update`, **Escrita**;
- `reminder:manage` — **Escrita**, abre A06;
- `document:reserve-upload` — **Escrita**, abre A07;
- `document:read` — **Todos**;
- `document:delete` — **Admin**;
- `audit:read` — **Todos**, histórico técnico do agregado.

**Estados específicos:** ACTIVE/ARCHIVED/RENEWED/DELETED; sucessor/origem ausente; versão OCC; renovação idempotente em retry; arquivo em processamento.

**Conexões:** A04 ↔ A05; documentos → A07; política → A06; `renewedFromId`/sucessor → outro A05.

**Responsividade:** paridade total; abas viram navegação horizontal acessível ou seções; ações destrutivas não ficam no menu primário.

---

## A06 — Política de lembretes do vencimento

**Rota UI:** `/app/:orgId/expirations/:itemId/reminders/:policyId?`

**Propósito:** criar, consultar, editar ou desabilitar política real de lembrete.

**Dados:** policy id, offsets/agenda do contrato, canais e estado habilitado.

**Ações:** `reminder:manage` — **Escrita**.

**Estados específicos:** política inexistente, desabilitada, conflito de versão, canal sem entitlement, quiet hours, dependência Scheduler indisponível.

**Conexões:** somente A05 → A06 → A05. Preferências pessoais de recebimento → A18.

**Responsividade:** paridade total; editor de sequência em lista vertical no móvel.

---

## A07 — Documento genérico/OCR ligado ao vencimento

**Rota UI:** `/app/:orgId/expirations/:itemId/files/:documentId?`

**Propósito:** upload, leitura, remoção e confirmação/rejeição de campos extraídos no módulo de armazenamento antigo.

**Dados:** arquivo, mídia, tamanho, status PENDING_UPLOAD/SCANNING/CLEAN/REJECTED/UNSUPPORTED/TIMEOUT/DELETED; extração, campo, valor sugerido e confiança quando retornados.

**Ações:**

- `document:reserve-upload` — **Escrita**;
- `document:read` — **Todos**;
- `document:delete` — **Admin**;
- `extraction:confirm` — **Escrita**.

**Estados específicos:** reserva aceita ≠ bytes enviados; scanning; malware; tipo não suportado; timeout; campo sugerido ≠ confirmado; confirmação concorrente.

**Conexões:** A05 ↔ A07. Não confundir este documento com A12 (`DocumentVersion`).

**Responsividade:** paridade; comparação campo sugerido/confirmado empilha no móvel; preview pode abrir tela inteira.

---

## A08 — Coleção de entidades acompanhadas

**Rota UI:** `/app/:orgId/subjects`

**Propósito:** listar/pesquisar `TrackedSubject`.

**Dados:** `subjectId`, nome, tipo COMPANY/VENDOR/CLIENT/EMPLOYEE/ASSET/LOCATION/CUSTOM, identificador externo, contato, tags, assignee, status e resumo legado.

**Ações:**

- `subject:read` — **Todos**;
- `subject:create`, `subject:update` — **Escrita**;
- `subject:delete` — **Admin**.

**Estados específicos:** ACTIVE/ARCHIVED/DELETED; nenhum resultado; identificador duplicado; exclusão bloqueada por regra.

**Conexões:** dashboard/A11 → A08 filtrada; linha → A09; criar → formulário → A09.

**Responsividade:** paridade com tabela→cartões.

---

## A09 — Hub do Subject e compliance

**Rota UI:** `/app/:orgId/subjects/:subjectId`

**Propósito:** ponto canônico para tudo que pertence a um Subject.

**Dados:** cadastro do `TrackedSubject`; compliance real (`totalRequirements`, satisfied, expiring soon, missing, percentual ou `null`); contagens de documentos, requisitos e séries.

**Ações:**

- `subject:read` — **Todos**;
- `subject:update` — **Escrita**;
- `subject:delete` — **Admin**;
- `docarchive:requirement-read`, `docarchive:read`, `docarchive:series-read` — **Todos**;
- `docarchive:dossier-export` — **Admin**, A17.

**Estados específicos:** compliance `null` quando não há requisitos; painéis parcialmente indisponíveis; Subject arquivado; links para recursos removidos.

**Conexões:** A08 ↔ A09; abas/links → A10, A12, A14; dossier → A17.

**Responsividade:** paridade; resumo antes das abas; percentual sempre acompanhado de numerador/denominador explicável.

---

## A10 — Acompanhamentos legados do Subject

**Rotas UI:** `/app/:orgId/subjects/:subjectId/tracking`, `/.../tracking/:assignmentId`

**Propósito:** manter o domínio ainda vivo `RequirementAssignment`, suas submissões e solicitações legadas.

**Dados:** assignment id, label, description, status MISSING/SATISFIED, item vinculado, version; submissions; requests, recipient, expiry/revocation/delivery.

**Ações:**

- `requirement:read` — **Todos**;
- `requirement:assign`, `requirement:update`, `requirement:review`, `requirement:request-document` — **Escrita**;
- `requirement:delete` — **Admin**.

**Estados específicos:** item vinculado ausente/arquivado; MISSING/SATISFIED sem inferir compliance do domínio novo; request ativo/revogado/expirado; submissão PENDING_UPLOAD/SCANNING/CLEAN/REJECTED etc.; chasing agendado é informativo, não editável.

**Conexões:** A09 → A10; item vinculado → A05; criar solicitação → link guest G01; submissions → detalhe nesta tela.

**Responsividade:** paridade; timeline em lista; ações contextuais por assignment.

---

## A11 — Requisitos documentais tenant-wide

**Rota UI:** `/app/:orgId/requirements`

**Propósito:** fila pesquisável de `docarchive Requirement`.

**Dados:** nome, Subject, applicability, status MISSING/PENDING/SATISFIED/NOT_SATISFIED/NOT_APPLICABLE, assignee, evidence document/version, validity, origem de template.

**Ações:**

- `docarchive:requirement-read` — **Todos**;
- `docarchive:requirement-create`, `-update`, `-delete` — **Escrita**;
- link/unlink evidence usa `docarchive:requirement-update` — **Escrita**;
- `docarchive:requirement-export` — **Admin**;
- aplicar template usa `docarchive:requirementtemplate-apply` — **Escrita**.

**Estados específicos:** busca exige status; `scanLimitReached`; evidência pendente/rejeitada/vencida; assignee removido; `NOT_APPLICABLE`; colisão por nome; preview de template com itens `create` e `skip:DUPLICATE_NAME`.

**Conexões:** A03 card → A11 filtrada; linha → A09 na aba requisito; evidência → A12; template → A21.

**Responsividade:** paridade com filtros em drawer; filtros ativos anunciados; resultado parcial destacado.

---

## A12 — Documento e histórico de versões

**Rota UI:** `/app/:orgId/documents/:documentId`

**Propósito:** administrar o agregado documental descoberto a partir de Subject/requisito/link direto.

**Dados:**

- Document: Subject, Document Type, ACTIVE/ARCHIVED, `hasValidity`, versão aceita atual, metadata;
- versões: seq, DRAFT/RECEIVED/UNDER_REVIEW/ACCEPTED/REJECTED/SUPERSEDED/WITHDRAWN, origin, issued/valid dates, reviewer, rejection reason, scan counts;
- arquivos: nome, mídia, tamanho, principal/complementar, scan state.

**Ações:**

- `docarchive:read` — **Todos**;
- `docarchive:create`, `docarchive:upload`, `docarchive:document-metadata-update` — **Escrita**;
- `docarchive:review` — **Escrita**; claim/accept/reject, com gate adicional reviewer-or-admin do serviço.

Não existe ação de arquivar Document nem rota correspondente, apesar de `Document.status` admitir ARCHIVED; nenhum botão é inventado.

**Estados específicos:** upload em três etapas (reservar versão → reservar arquivos/enviar → commit); file set sealed; scan pendente/infectado; claim perdido/expirado; versão terminal; nova aceita supersede a anterior; metadata required ausente é mostrado como incompletude, não impede criação; metadata field/option arquivado mantém snapshot; OCC.

**Conexões:** A09/A11/A13 → A12; “nova versão” permanece em A12; revisão → A13; tipo → A20.

**Responsividade:** paridade; timeline de versões substitui tabela no móvel; preview de arquivo em tela inteira. Nenhuma operação review é degradada.

---

## A13 — Fila de revisão documental

**Rota UI:** `/app/:orgId/reviews`

**Propósito:** descobrir e revisar versões RECEIVED/UNDER_REVIEW.

**Dados:** versão, documento, Subject, origem, recebimento, reviewer, scan counters e validade proposta.

**Ações:** `docarchive:read` — **Todos**; `docarchive:review` — **Escrita**, sujeito ao gate reviewer-or-admin.

**Estados específicos:** item já reivindicado, claim expirou, scan ainda pendente, infectado, decisão concorrente, rejeição requer motivo fechado e “OTHER” quando aplicável.

**Conexões:** A03 → A13; item → A12 focado na versão; decisão → próximo item ou A12.

**Responsividade:** paridade; painel dividido vira sequência lista→detalhe no móvel.

**Gap importante:** o backend possui GSI de review queue e contador no dashboard, mas não expõe rota HTTP de listagem da fila. A tela só deve ser implementada após o gap G2 do registro de adiamentos.

---

## A14 — Solicitações e recorrências do Subject

**Rotas UI:** `/app/:orgId/subjects/:subjectId/requests`, `/.../series/:seriesId`

**Propósito:** criar e operar `DocumentRequestSeries`, visualizar materializações e destinatário.

**Dados:** Subject, Requirement, série, status, agenda/recorrência, próxima execução, recipientEmail, versões, tentativas/materializações conhecidas.

**Ações:**

- `docarchive:series-read` — **Todos**;
- `docarchive:series-create`, `-update`, `-cancel` — **Escrita**;
- `docarchive:series-materialize` — **Escrita**; controle “Gerar agora” separado da automação;
- `docarchive:request-create` — **Escrita**, mas sem rota HTTP tenant-facing disponível.

**Estados específicos:** ACTIVE/CANCELLED; destinatário ausente; tentativa ainda não materializada; geração idempotente; emissão/entrega de credencial incerta; série mudou por OCC; request expirado/revogado/resolvido conforme entidade.

**Conexões:** A09 → A14; request emitido → G02; Requirement → A11/A09; submissão recebida → A13/A12.

**Responsividade:** paridade; agenda resumida em linguagem natural e forma técnica acessível.

---

## A15 — Importações em massa

**Rotas UI:** `/app/:orgId/imports/new`, `/app/:orgId/imports/:jobId`

**Propósito:** upload CSV, inspeção do schema, mapeamento, preview e commit de Subjects/Documents/Requirements conforme contrato implementado.

**Dados:** job id, tipo/status, colunas, mapeamentos, linhas válidas/inválidas, dedupe, resultados e cursor/progresso.

**Ações:**

- `import:create`, `import:map`, `import:commit` — **Escrita**;
- `import:read` — **Todos**.

**Estados específicos:** parsing assíncrono; coluna obrigatória sem mapa; mapping inválido; falha por linha; sucesso parcial; job retomável; commit já executado/idempotente; limite/quota; arquivo incompatível.

**Conexões:** A04/A08/A11 → A15; conclusão oferece links aos recursos criados e à própria importação.

**Responsividade:** **transformação**, não degradação: mapeamento usa pares de campos empilhados no móvel em vez de grade larga; tabela de erros vira lista. Importação continua possível no móvel.

---

## A16 — Relatórios e exportações

**Rota UI:** `/app/:orgId/reports`

**Propósito:** gerar downloads CSV disponíveis e administrar relatórios agendados.

**Dados:** sete relatórios reais: expired-items, expiring-soon-items, renewed-items, expiration-items-by-assignee, missing-requirements, requirements-by-subject, requirements-by-assignee; subscriptions, recipients, periodicidade, runs/download.

**Ações:**

- relatórios de itens → `item:export` — **Admin**;
- relatórios de requisitos → `docarchive:requirement-export` — **Admin**;
- assinaturas → `reports:subscription-manage` — **Admin**;
- recipient de um run pode baixar aquele run por gate específico do backend, mesmo sem Admin.

**Estados específicos:** relatório vazio; geração/download falhou; CSV truncado via header; URL de download expirada e regenerável; assinatura apagada; run ausente; recipient removido da assinatura atual ainda pode acessar run que realmente recebeu.

**Conexões:** nav → A16; linhas podem abrir A04/A11 com filtro equivalente quando possível.

**Responsividade:** paridade; catálogo em cartões; editor de recipients pesquisável por teclado.

**Limitação:** os sete CSV endpoints não são proxied pelo BFF atual devido ao tratamento de `Content-Disposition`; ver gap G3.

---

## A17 — Dossiê do Subject

**Rota UI:** `/app/:orgId/subjects/:subjectId/dossier`

**Propósito:** preview, confirmação e download PDF/Excel do dossiê.

**Dados:** escopo congelado, documentos/requisitos incluídos, formato, `scopeHash`, run e validade do download.

**Ações:** `docarchive:dossier-export` — **Admin**.

**Estados específicos:** preview mudou antes da confirmação; hash obsoleto; geração pendente/falhou; export expirado; presign expirado e regenerável.

**Conexões:** A09 → A17 → download/A09.

**Responsividade:** paridade; preview longo em seções colapsáveis, nunca desktop-only.

---

## A18 — Minhas preferências de notificação

**Rota UI:** `/app/:orgId/settings/notifications`

**Propósito:** configurar preferências por usuário e organização.

**Dados reais:** `emailEnabled`, locale, quiet hours, consent source; entitlement/canal disponível quando exposto.

**Ações:** `notification:configure` — **Todos**, sempre para o próprio usuário.

**Estados específicos:** defaults ainda não persistidos; quiet-hours inválidas/atravessam meia-noite; canal indisponível por entitlement; WhatsApp sem opt-in gravável.

**Conexões:** avatar/settings → A18; A06 pode apontar para cá.

**Responsividade:** paridade total.

**Regra:** não mostrar toggle WhatsApp acionável enquanto não existir rota HTTP de opt-in. Pode mostrar “indisponível no momento” se o produto precisar explicar o canal.

---

## A19 — Equipe e organização

**Rotas UI:** `/app/:orgId/settings/team`, `/app/:orgId/settings/organization`

**Propósito:** membros, convites, identidade da organização, saída e encerramento.

**Dados:** Organization (`displayName`, timezone, quiet hours, ownerCount); Membership (`userId`, role, status); Invitation (email, role, status, expiresAt).

**Ações:**

- `membership:list-members`, `membership:leave` — **Todos**;
- `membership:invite`, `membership:list-invitations`, `membership:revoke-invitation`, `membership:role-change`, `membership:remove` — **Admin**;
- promover/rebaixar OWNER requer **Owner** adicional no serviço;
- `organization:update-settings`, `organization:close`, `organization:cancel-close` — **Owner**.

**Estados específicos:** último Owner; alvo é o próprio usuário; convite duplicado/expirado/revogado; membro SUSPENDED/REMOVED; organização ACTIVE/DELETING/HELD_FOR_RECOVERY/BLOCKED/DELETED; encerramento exige confirmação forte; cancelamento só em recovery window.

**Conexões:** settings → A19; convite emitido → A02; sair/fechar → A02.

**Responsividade:** paridade; membros em cartões no móvel; diálogo de encerramento em tela inteira e foco obrigatório na confirmação.

---

## A20 — Tipos documentais e metadata

**Rotas UI:** `/app/:orgId/settings/document-types`, `/.../document-types/:documentTypeId`

**Propósito:** catálogo compartilhado de `DocumentType` e definições de metadata.

**Dados:** display name, categoria/descrição e validade padrão conforme entidade; ACTIVE/DEPRECATED; campos metadata, valueType TEXT/NUMBER/DECIMAL/DATE/BOOLEAN/SINGLE_SELECT, required, opções e estados arquivados.

**Ações:**

- `docarchive:documenttype-read` — **Todos**;
- create/rename/deprecate/reactivate — ações `docarchive:documenttype-*`, **Admin**;
- `docarchive:documenttype-metadata-manage` — **Admin**.

**Estados específicos:** nomes duplicados; deprecated ainda referenciado; campo/opção arquivado; mudança OCC; tipo sem metadata; required não retrovalida automaticamente Documents existentes.

**Conexões:** settings → A20; tipo → A12 filtrado somente quando futuramente houver collection; A12 mostra link para tipo.

**Responsividade:** paridade; construtor de campos empilhado no móvel, reordenação não depende apenas de drag-and-drop.

---

## A21 — Templates de requisitos

**Rotas UI:** `/app/:orgId/settings/requirement-templates`, `/.../requirement-templates/:templateId`

**Propósito:** catálogo, edição, duplicação, archive/unarchive, preview e aplicação.

**Dados:** displayName, description, ACTIVE/ARCHIVED, itens (id estável, nome, notas, applicability, position), versão.

**Ações:**

- `docarchive:requirementtemplate-read` — **Todos**;
- create/update/duplicate/archive/unarchive — ações correspondentes, **Admin**;
- `docarchive:requirementtemplate-apply` — **Escrita**.

**Estados específicos:** template vazio inválido conforme schema; colisão de nome; preview por Subject; itens a criar versus skips `DUPLICATE_NAME`; aplicação parcial/conflito; archived somente leitura para não-admin.

**Conexões:** settings → A21; A09/A11 → seletor/preview → aplicar → A11/A09.

**Responsividade:** paridade; itens em lista reordenável também por botões/teclado, não só arraste.

---

## A22 — Entrega de solicitações

**Rota UI:** `/app/:orgId/settings/request-delivery`

**Propósito:** política tenant-wide do fluxo legado de solicitação documental.

**Dados:** `initialInviteDeliveryDefault`: MANUAL ou EMAIL.

**Ações:** `tenant:configure-document-request-delivery` — **Owner**.

**Estados específicos:** default ainda ausente; alteração OCC; email temporariamente indisponível; explicar que a mudança afeta novos convites, não revoga links existentes.

**Conexões:** settings → A22; A10 criação de request mostra o modo resultante.

**Responsividade:** paridade total.

---

## A23 — Atividade administrativa

**Rota UI:** `/app/:orgId/activity`

**Propósito:** exibir log tenant-wide de ações de membros.

**Dados:** ator, ação, tipo/id do recurso, timestamp e mudanças disponibilizadas pelo endpoint.

**Ações:** `activity:read` — **Admin**.

**Estados específicos:** nenhum evento; paginação; ator removido; recurso já apagado; payload não traduzível. Mostrar fallback legível sem expor JSON sensível indiscriminadamente.

**Conexões:** nav Admin → A23; recurso reconhecido → sua tela de detalhe.

**Responsividade:** paridade; timeline no móvel.

---

# 5. Superfícies guest

As duas famílias guest são estruturalmente separadas do app autenticado:

- sem shell, seletor ou cookie de organização;
- autorização exclusivamente pelo token/credential/session;
- nunca redirecionam para login;
- falhas de token inexistente, revogado, expirado ou tenant inacessível colapsam em mensagem segura equivalente;
- organização/solicitante só é exibido se o backend realmente fornecer identidade confiável.

## G01 — Guest upload legado

**Rota UI:** `/guest/document-requests/:token`

**Propósito:** atender `DocumentRequest` do domínio `subject`.

**Dados:** detalhes seguros da solicitação, arquivo esperado, prazo quando fornecido, upload/submission.

**Ações:** nenhuma `Action`; convidado é validado por `GuestTokenService`.

**Estados específicos:** token inválido/expirado/revogado indistinguíveis; request já satisfeito; reserva aceita; upload em andamento; upload concluído sem afirmar “aprovado”; scanning/malware quando observável; retry seguro.

**Conexões:** entrada somente por link entregue desde A10; sucesso termina em confirmação/reentrada segura.

**Responsividade:** paridade móvel prioritária; seletor de arquivo/câmera com label; progresso anunciado.

---

## G02 — Guest request do arquivo documental

**Rota UI:** `/document-archive/guest/document-requests/:token`

**Propósito:** resolver credencial, iniciar GuestSession com CSRF e enviar evidência para `docarchive DocumentRequest`.

**Dados:** request/requirement/Subject permitidos; catálogo público de Document Types; arquivo, `documentTypeId`, datas/validade exigidas pelo contrato.

**Ações:** nenhuma `Action`; credential + session + CSRF formam a fronteira guest.

**Estados específicos:**

- credential inválida, expirada ou revogada com resposta anti-enumeration;
- sessão não iniciada/expirada;
- CSRF inválido;
- Document Type deprecated ou deixou de existir;
- `documentTypeId` obrigatório;
- arquivo inválido, quota, scan;
- submissão aceita ≠ revisão concluída;
- request já resolvido;
- emissão/entrega anterior `SEND_UNCERTAIN` não deve ser revelada ao guest.

**Conexões:** entrada por link produzido por A14/materialização; sucesso → confirmação na mesma superfície; operador continua em A13/A12.

**Responsividade:** mobile-first, paridade total; fluxo em etapas curtas, resumo antes do envio e possibilidade de corrigir.

---

# 6. Matriz Action → superfície

| Família de Actions | Superfície |
|---|---|
| `item:create/read/update/delete/export/watch` | A04–A05 |
| `reminder:manage` | A06 |
| `document:reserve-upload/read/delete`, `extraction:confirm` | A07 |
| `notification:configure` | A18 |
| `audit:read` | A05 |
| `system:ping` | DEFERRED G1 |
| `subject:create/read/update/delete` | A08–A09 |
| `requirement:assign/read/update/delete/review/request-document` | A10 |
| `tenant:configure-document-request-delivery` | A22 |
| `import:create/read/map/commit` | A15 |
| `membership:*` | A19, com aceite em A02 |
| `organization:update-settings/close/cancel-close` | A19 |
| `docarchive:create/read/upload/document-metadata-update` | A12 |
| `docarchive:review` | A13/A12 |
| `docarchive:requirement-*` | A11 e detalhe em A09 |
| `docarchive:series-*` | A14 |
| `docarchive:request-create` | A14, bloqueado por G4 |
| `docarchive:documenttype-*` e metadata manage | A20 |
| `docarchive:requirementtemplate-*` | A21/A11 |
| `docarchive:requirement-export` | A16/A11 |
| `activity:read` | A23 |
| `reports:subscription-manage` | A16 |
| `docarchive:dossier-export` | A17 |

## 7. Mapa reverso superfície → capacidades

- A03 → reads de items, Requirements e review summary.
- A04/A05 → `item:*`, `item:watch`, `audit:read`.
- A06 → `reminder:manage`.
- A07 → `document:*`, `extraction:confirm`.
- A08/A09 → `subject:*` e reads do domínio documental.
- A10 → `requirement:*`.
- A11 → `docarchive:requirement-*`, template apply/export.
- A12/A13 → `docarchive:create/read/upload/review/document-metadata-update`.
- A14 → `docarchive:series-*`, `docarchive:request-create`.
- A15 → `import:*`.
- A16/A17 → exports, subscriptions e dossier.
- A18 → `notification:configure`.
- A19 → membership/organization.
- A20 → Document Type/metadata catalog.
- A21 → Requirement Template catalog/application.
- A22 → delivery policy.
- A23 → `activity:read`.
- G01/G02 → token/session-based guest services, sem RBAC `Action`.

# 8. Registro de gaps e adiamentos pela regra de seis condições

## G1 — DEFERRED: `system:ping` sem tela de produto

1. **Fora do P0:** rota M1 de diagnóstico, não capacidade de usuário.
2. **Motivo concreto:** criar uma tela confundiria health check técnico com produto.
3. **Destino/gatilho:** console interno de suporte/observabilidade, se existir operação humana real.
4. **Dependências:** autenticação de suporte e modelo de autorização operacional.
5. **Nenhuma jornada P0 pendente:** login e app não dependem de o usuário invocar ping.
6. **Registro:** ação deliberadamente DEFERRED, não omitida.

## G2 — DEFERRED/BACKEND GAP: descoberta da Review Queue e coleção de Documents

1. **Fora da implementação imediata da UI:** A13 e uma coleção tenant-wide de Documents não podem ser alimentadas integralmente.
2. **Motivo concreto:** há GSI/review count e `getDocument/listVersions`, mas nenhuma rota HTTP de `listReviewQueue`, `listDocuments` ou `searchDocuments`.
3. **Destino/gatilho:** antes de considerar A13 e “Documents Collection” P0 implementados; criar endpoints paginados e RBAC `docarchive:read`.
4. **Dependências:** contratos de paginação/filtros, BFF allowlist e Terraform.
5. **Jornada:** hoje há um dangling P0 real — o operador sabe que existem revisões pelo dashboard, mas não consegue descobri-las. Portanto isto é **blocker de frontend P0**, não adiamento aceitável até pós-lançamento.
6. **Registro:** DEFERRED somente até o backend gap ser fechado; não fingir coleção usando dados incompletos.

## G3 — DEFERRED/BACKEND-BFF GAP: CSVs diretos

1. **Fora da UI integrada atual:** sete rotas CSV não estão no proxy allowlist.
2. **Motivo concreto:** o próprio código registra o gap de `Content-Disposition`.
3. **Destino/gatilho:** antes de A16 ser launch-ready.
4. **Dependências:** proxy seguro para streaming/headers ou mecanismo autenticado de download alternativo.
5. **Jornada:** relatórios P0 ficam pendentes sem isso; é blocker de integração, embora os endpoints backend existam.
6. **Registro:** DEFERRED até fechamento do BFF, sem inventar download browser direto com JWT.

## G4 — DEFERRED/BACKEND GAP: `docarchive:request-create` avulso

1. **Fora da UI acionável atual:** nenhuma rota HTTP correspondente aparece no handler/allowlist.
2. **Motivo concreto:** a Action e o serviço existem, mas não há endpoint tenant-facing para A14 invocar.
3. **Destino/gatilho:** antes de oferecer “Solicitação avulsa” no P0.
4. **Dependências:** schema, handler, API Gateway, BFF allowlist e contrato de emissão/entrega da credencial.
5. **Jornada:** recorrência/materialização permanece utilizável; a jornada avulsa do roadmap, porém, fica pendente e deve ser tratada como blocker se exigida no launch.
6. **Registro:** controle oculto e capacidade marcada DEFERRED, não simulada.

## G5 — DEFERRED/BACKEND GAP: WhatsApp opt-in

1. **Fora da UI acionável:** A18 não oferece toggle WhatsApp.
2. **Motivo concreto:** `WhatsAppOptInService.recordOptIn()` não tem rota HTTP.
3. **Destino/gatilho:** antes de habilitar WhatsApp a usuários reais.
4. **Dependências:** endpoint autenticado, consentimento/auditabilidade, aceite DPA Meta, aviso de privacidade, residência de dados e credenciais/entitlement.
5. **Jornada:** email continua funcional; jornada WhatsApp real permanece explicitamente bloqueada, não aparenta estar concluída.
6. **Registro:** DEFERRED com canal apresentado como indisponível, nunca como preferência persistida.

## G6 — DEFERRED: dois cards desejados do dashboard

1. **Fora do P0 implementável agora:** “aguardando cliente” e “renovações abertas”.
2. **Motivo concreto:** nenhuma taxonomia atual modela ambos de forma confiável.
3. **Destino/gatilho:** milestone posterior à definição de estados de request/renewal que suportem contagem inequívoca.
4. **Dependências:** decisão de produto, modelo/índice e endpoint.
5. **Jornada:** dashboard mantém quatro métricas reais e links úteis; não apresenta números fabricados.
6. **Registro:** DEFERRED, conforme o próprio roadmap.

## G7 — DEFERRED: ExternalShareLink

1. **Fora do P0:** item P1; somente domínio/persistência foram implementados.
2. **Motivo concreto:** rotas anônimas e autenticadas, Actions, schemas e wiring ainda não existem.
3. **Destino/gatilho:** retomada do P1 após fechamento do P0.
4. **Dependências:** slices HTTP/RBAC/infra restantes.
5. **Jornada:** nenhum fluxo P0 depende de compartilhamento externo de leitura; guest upload é independente.
6. **Registro:** nenhuma tela/control “Compartilhar” em A12.

## G8 — DEFERRED: controles internos

1. **Fora do P0:** workers de chasing, `series-materialize` automático, notification attempts, entitlements, quotas internas, credential delivery e audit/security internals não são consoles de usuário.
2. **Motivo concreto:** não há Actions/rotas de administração humana para essas entidades.
3. **Destino/gatilho:** console operacional somente quando suporte/SRE tiver requisitos reais.
4. **Dependências:** modelo de suporte, segregação de privilégios e endpoints próprios.
5. **Jornada:** automações funcionam em background; estados relevantes aparecem no recurso do usuário.
6. **Registro:** DEFERRED; não inventar telas administrativas.

# 9. Jornadas principais e cobertura

| Jornada | Superfícies |
|---|---|
| Entrar/criar ou escolher organização | A01 → A02 → A03 |
| Cadastrar e renovar vencimento | A04 → A05 → A06/A07 → A05 |
| Cadastrar Subject e medir compliance | A08 → A09 → A11 |
| Criar requisitos por template | A09/A11 → A21 preview/apply → A11 |
| Solicitar evidência recorrente | A09 → A14 → G02 → A13 → A12/A11 |
| Solicitação/upload legado | A09 → A10 → G01 → A10 |
| Upload e nova versão documental | A09/A11 → A12 → A13 → A12 |
| Importação em massa | A04/A08/A11 → A15 → recursos criados |
| Relatório/dossiê/auditoria | A16/A17/A23 |
| Administrar tenant e equipe | A02/A03 → A19 → A02/A03 |
| Configurar catálogos | A20/A21 → A12/A11 |
| Preferências e canais | A18/A22 → A06/A10/A14 |

# 10. Autoavaliação

**Nota: 9,1/10.**

Por eixo:

- Backend-interface/traceabilidade: **9,4**
- Navegação e screen graph: **9,2**
- RBAC: **9,4**
- Estados/feedback/recovery: **9,2**
- Multi-tenant: **9,3**
- Guest/auth separation: **9,5**
- Responsivo/acessibilidade: **8,8**
- Handoff zero-context: **8,7**

Fraqueza honesta principal: alguns campos exatos dos contratos de importação, reminder policy, séries e ReportSubscription foram resumidos por domínio em vez de reproduzidos campo a campo a partir de cada JSON Schema. Um artefato final de implementação deveria anexar os schemas exatos a A06, A14–A16. Além disso, A13 e a coleção de Documents revelam gaps reais do backend; o inventário é coerente ao nomeá-los, mas o screen graph P0 só deixa de ter esse ponto pendente quando os endpoints de descoberta forem implementados.
