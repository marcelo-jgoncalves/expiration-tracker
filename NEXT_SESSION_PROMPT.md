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
DPA Meta, residência de dados); **Identidade visual** (workstream paralelo de Marcelo) — Fase 1
concluída 2026-09-11, Fase 2 avançou nesta sessão (2026-09-20): design system v2 (violeta, Plus
Jakarta Sans, ícones Lucide) auditado, corrigido e adotado como base oficial —
`docs/architecture/adr/ADR-0015-visual-identity-v2-violet.md`/D-307, artefato em
`docs/frontend/design-system-v2/`. **Porte para o código real: 13/13 telas do protótipo original
FECHADAS** (avaliar protótipo → corrigir inconsistência → adequar à realidade do projeto quando o
protótipo simplifica demais → aplicar → screenshot → validação de Marcelo → próxima) — as 7
anteriores (Visão Geral/Vencimentos/Fornecedores/Criar/Detalhe/Renovar/Configurações, D-308/D-309)
mais 6 nesta sessão (2026-09-21, **NENHUM COMMIT AINDA** — ver aviso de estado abaixo): Documento
(`ItemDocuments.tsx`, manteve lista de N arquivos real em vez do modelo de 1 arquivo do protótipo),
Alerta (`ItemReminderPolicy.tsx`), Fornecedor Detalhe (`SubjectHub.tsx` — painel de Conformidade
que era HTML cru virou v2), Requisito Detalhe (**tela nova, não existia** — rota
`subjects/:subjectId/requirements/:requirementId`, construída só com dados/endpoints já reais),
Importar CSV (`ImportWizard.tsx`), Guest Submission (`GuestDocumentRequest.tsx`). Achado real no
processo: barra lateral virou sticky (`position: sticky` em `.app-shell__nav`) + rodapé de
identidade (avatar+nome+papel+logout só-ícone, `SidebarUserFooter`) — exigiu estender
`GET /bff/session` com `displayName`/`email` (nunca `userId`, que segue excluído por D-095/D-096).

**Próxima ação real deste workstream — NOVA RODADA, 2026-09-21**: levantamento completo de rotas
reais (`App.tsx`) encontrou **18 telas reais que nunca passaram pelo processo de protótipo**
(Onboarding, Aceitar convite, Form de Fornecedor, Requisitos/lista geral, Solicitações e
Recorrência, Rastreamento Legado, Exportar Dossiê, Fila de Revisão, Detalhe de Documento, Catálogo
de Tipos de Documento, Editor de Tipo de Documento, Templates de Requisito, Preferência de Entrega,
Preferências de Notificação, Membros, Log de Atividade, Relatórios, Upload Legado de Convidado —
`LegacyGuestUpload`, distinta do `GuestDocumentRequest` já portado). **Achado real, verificado
antes de gerar qualquer protótipo novo**: as 18 já importam os mesmos componentes v2 (`Panel`/
`Section`/`DataTable`/`Button`/`StatusBadge`/`InlineNotice`/`Dialog`) que as 13 já reskinadas — não
são HTML cru/v1, já herdam tokens/tipografia/radius do D-307 globalmente. Prints das 18 telas REAIS
como rodam hoje (dados mockados via `page.route`, mesma técnica de sempre) salvos em
`prototype/telas-sem-prototipo/` (18 arquivos `01-onboarding.png` a `18-guest-upload-legado.png`).

**PROTÓTIPOS NOVOS JÁ CHEGARAM (2026-09-21, Claude Design, a partir dos prints acima)**:
`prototype/ui_kits_2/webapp/screens-package-2/standalone/` — 18 arquivos `.html`, mesma numeração/
nomes dos prints (`01 - Onboarding.html` … `18 - Guest Upload Legado.html`). **Próxima sessão: retomar
o mesmo processo tela-por-tela das 13 anteriores** (avaliar protótipo → corrigir inconsistência →
adequar à realidade do projeto quando o protótipo simplificar/inventar algo que o backend não
suporta → aplicar no código real → screenshot em `prototype/_tmp_validacao/` → validação de Marcelo
→ próxima), reaproveitando os componentes v2 já existentes (nunca recriar `Panel`/`DataTable`/etc.).

**AVISO DE ESTADO — nada desta sessão foi commitado ainda (2026-09-21, 79 arquivos modificados/
novos)**: além das 6 telas acima, esta sessão também fechou #15/#16 (ver lista de pendências
abaixo, já atualizada) e D-313 (download de documento) + D-314 (versionamento completo,
`PENDING_PROTOCOL_REVIEW`, sem código escrito). Confirmar com Marcelo se ele quer revisar/commitar
antes de continuar, ou se seguimos direto para a próxima rodada de protótipos.
(`Proximas_Tarefas_Identidade_Visual.md`, raiz do repo, deliberadamente fora do
`ROOT_MD_ALLOWLIST` — nunca commitar sem mover para `docs/` ou atualizar o allowlist.)

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

0. ~~CI quebrado (PR #380)~~ — **RESOLVIDO 2026-09-20**: Marcelo autorizou o reset de senha Cognito
   do "PERF Test Tenant" + atualização do secret `PERF_TEST_PASSWORD` do GitHub Actions; organização
   recriada via `POST /bff/organizations` (novo `organizationId=org_01M2ZS4523K9QBJ4DX223WGMFD`,
   substitui o antigo `org_01M2GE4F1SZPSJ47HCGRXH4XMN` apagado na limpeza de `dev`); todos os checks
   do PR #380 verdes; PR mergeado em `main` (`mergedAt=2026-09-20T16:08:53Z`).
1. Item 3 do backlog P1 (busca OCR/full-text) — escolher entre 3 caminhos nomeados em D-202.
2. `--include-cognito` de `scripts/reset-dev-data.ts` contra `dev` — não executado (fora do escopo autorizado 2026-09-20, ver seção de limpeza abaixo); postergado, não perguntar de novo até ele sinalizar.
3. `coverage.thresholds` em `vitest.config.ts` — ainda não decidido (E-023).
4. WhatsApp com usuário real (item 3 P0, engenharia 100% fechada desde D-286 — rota de opt-in também já construída) — resta só aviso de privacidade, DPA Meta, residência de dados (E-019).
5. Wave 1b (Design System) — quais componentes com overlay/focus-trap (`Combobox`/`DateInput`/`Tooltip`/`Popover`/`DropdownMenu`/`Modal`/`Drawer`/`Tabs`/`Pagination`/`Breadcrumb`/`Avatar`/`Card`) abordar primeiro — deliberadamente por último, por pedido de Marcelo.
6. User Validation (planejamento de interface) — aguarda sinal explícito dele.
7. Aplicar ao **Claude for Startups Program** (`claude.com/programs/startups`, até US$25.000 em créditos de API, sem exigir VC) — projeto se encaixa no perfil, mas o cadastro exige dados da empresa/ação direta de Marcelo. Ver `docs/project/integrations-and-tooling-research-2026-09-11.md` §6.
8. P0.5 — suíte "Real System E2E" contra `dev` real (browser→CloudFront→API Gateway→S3 sem mocks) — projeto de infra de teste novo, não correção pontual; precisa de decisão sobre credenciais/tenant de teste, cadência de execução e estratégia de limpeza antes de começar. Deliberadamente adiado, Marcelo 2026-09-14.
9. **Import CSV em massa para Items** (proposta, ainda não decidida) — hoje o import CSV (`src/modules/import/`) só cobre `TrackedSubject`/`Document`/`Requirement`, não `Item` (o vencimento em si, entidade mais central do produto). Identificado como lacuna real durante o Programa de Performance (PERF-12, 2026-09-14) ao precisar semear 10k Items para teste de carga do pipeline de lembretes — não existe hoje nenhum caminho de criação em massa para Items (nem CSV, nem bulk-create). Não é correção pontual: decisões de produto reais precisam ser tomadas antes de implementar — mapeamento de colunas, se a Política de Lembrete vem junto na mesma linha ou é configurada depois, estratégia de deduplicação, validação linha a linha (mesmo padrão já usado para os outros 3 tipos). Provável nível 5-6 na escala de risco (`docs/engineering/change-risk-scale.md`) — protocolo Claude↔Codex + possível ADR antes de implementar. Aguardando sinal de Marcelo para virar iniciativa.
10. **`NotificationEntitlements` nunca é provisionado para nenhum tenant, real ou sintético (achado real, 2026-09-19, ver Programa de Performance abaixo)** — todo tenant sem esse registro fica em `RETRY` infinito e nunca recebe e-mail de lembrete; único motivo de nenhuma rodada de teste anterior ter conseguido provar entrega real de e-mail até agora. Sem usuário real ainda (AGENTS.md §1), então não é um incidente em produção — mas é uma lacuna real que bloquearia o primeiro usuário de verdade a receber um lembrete por e-mail, então merece atenção antes do lançamento. Provável ligação com D-052 (billing bloqueado) — decisão de produto necessária (entitlement default sem plano pago? criar no onboarding ou lazy como `NotificationPreferences`?) antes de qualquer correção de código.
11. **Revisão adversarial Codex pendente — horário padrão de lembretes (`Organization.defaultReminderLocalTime`, sessão 2026-09-20)**: implementação já concluída e mergeada (nível 4 pela `change-risk-scale.md` — campo opcional aditivo, sem novo GSI/chave/schema/contrato externo, reaproveita `UpdateOrganizationSettingsService` já existente — o protocolo `AGENTS.md` §4 não é normativamente exigido neste nível). Marcelo pediu explicitamente, 2026-09-20, uma rodada adversarial extra do Codex mesmo assim, assim que ele voltar a responder (bloqueado até 2026-09-23, ver mandato do Programa de Performance acima) — não é `PENDING_PROTOCOL_REVIEW` (esse rótulo é para decisão nível 5-6 tomada sem o protocolo obrigatório; aqui é rigor extra voluntário, não uma dispensa de gate obrigatório). Contexto para a rodada: `docs/architecture/reviews/reminder-default-local-time/PROPOSAL.md`, diff em `src/modules/organization/{domain,application,http}/`, `frontend/src/{routes/Settings.tsx,routes/items/ItemReminderPolicy.tsx,lib/reminderDefaults.ts}`.
12. **Separação de ambientes (`ADR-0014`, D-305) — protocolo Claude↔Codex + autorização de Marcelo pendentes para as Fases 2-4**: decisão/pesquisa/Fase 1 completas (ver item 2 da ordem acima). Assim que o protocolo voltar (Codex 2026-09-23), rodar a revisão adversarial completa deste ADR (nível 6 — nota cega, ≥9,0, mínimo 3 rodadas). Independente disso, Fases 2-4 (criar conta AWS `staging`/`production`, provisionar, pipeline de promoção `dev→staging→produção`) exigem autorização explícita de Marcelo antes de qualquer execução — não é uma decisão que a rodada Claude↔Codex sozinha desbloqueia, é criação de fronteira de conta/billing real.
13. **`ci.yml` sem fila global de lock do Terraform (achado real, 2026-09-20, ver D-306)** — job "Validate Infra (Terraform)" tem `concurrency: group: ci-${{ github.ref }}` (por branch/PR, não global), então pushes simultâneos em branches diferentes rodam `terraform plan` em paralelo contra o mesmo lock S3 do backend `dev`, podendo colidir entre si ou com `cd.yml` (`group: cd-develop`). Já causou uma falha real (`Error acquiring the state lock`) nesta sessão. Candidato de correção: dar a esse job um concurrency group compartilhado com `cd.yml` (ou um lock/fila própria) — não implementado ainda.
14. **Endpoint agregado de contagem por urgência para a Visão Geral (D-308)** — os 3 contadores da Visão Geral (vencidos/vence em breve/em acompanhamento) usam dado PLACEHOLDER hoje (`useItemsDashboardBounded` só cobre 30 itens, subcontaria em silêncio acima disso). Precisa de endpoint agregado novo antes de virar dado real; decisão de Marcelo, adiado. Link "Ver todos os vencimentos" removido por redundância — não recriar como link nem "4º card" a menos que cubra escopo que os 3 cards não cobrem (detalhe: `decisions-log.md` D-308).
15. ~~Resolução de nome de usuário (Responsável)~~ — **RESOLVIDO 2026-09-21**: `GET /organizations/members` agora resolve `email`/`displayName` do `GlobalUser` (só quando identidade ACTIVE, mesma regra do `recipient-resolver.ts`); nome capturado via claim OIDC `name` no login (escopo `profile` adicionado). Frontend (Membros, "Responsável" no Detalhe) mostra nome/e-mail resolvido com fallback pro ID.
16. ~~Filtro de atividade por item/recurso~~ — **RESOLVIDO 2026-09-21**: `GET /activity` aceita `resourceId`, mesmo padrão já usado por `resourceType`. Card "Histórico de auditoria" do Detalhe agora mostra contagem real e leva a um log pré-filtrado.
17. **PR #382 (`develop`→`main`) aberto, não mergeado** — criado por engano (Claude leu "pode fazer o push também" como pedido de merge; Marcelo corrigiu pra "push pra dev"). Confirmar com ele se ainda quer esse merge ou se o PR deve ser fechado sem mergear.
18. **Falha pré-existente, não corrigida: `frontend/test/api/documents.test.ts` (`computeChecksumSha256`), 2 dos 415 testes** — `crypto.subtle.digest` no ambiente jsdom/Node atual rejeita o buffer retornado por `readAsArrayBuffer` (`ERR_INVALID_ARG_TYPE`). Confirmado não relacionado a nenhuma mudança desta sessão (arquivo não tocado desde D-2xx). Não bloqueia CI (esses 2 casos já falhavam antes do fix do CI, isolados dos outros 413). Sem prioridade definida.
19. **Versionamento completo de `Document` (item-level) — `PENDING_PROTOCOL_REVIEW` (D-314, 2026-09-21)**: pedido de Marcelo após comparar a tela "Documento" real com o protótipo, que assume um modelo de "substituir arquivo" inexistente hoje (`Document` é 1 linha = 1 arquivo, sem histórico/versão). Investigação confirmou que é mudança nível 5-6, estruturalmente equivalente ao D-143 (Domínio Documental, 6 rodadas de protocolo) — não implementado, nenhum código escrito. Assim que o protocolo Claude↔Codex voltar (Codex 2026-09-23), rodar a revisão adversarial completa, incluindo a alternativa de menor risco identificada (reaproveitar a máquina de versionamento já existente em `document-archive`/D-143 em vez de duplicá-la). "Baixar documento" (a outra metade do mesmo pedido) já foi implementado nesta sessão sem precisar de protocolo (D-313, nível 1-3, aditivo puro).

## Próxima ação recomendada

**P0/P1/full-audit round2/auditoria externa são contexto histórico já fechado, não a próxima ação
— ver seções acima.** Degrau de 100k do Programa de Performance encerrado (achado real confirmado,
ver seção própria abaixo — não é mais pendência).

**Próxima ação real (2026-09-21)**: workstream de identidade visual v2 — os 18 protótipos novos já
chegaram (`prototype/ui_kits_2/webapp/screens-package-2/standalone/`, ver seção "Identidade visual"
acima). **Retomar o processo tela-por-tela** aplicando cada um ao código real, mesma disciplina das
13 anteriores. **Antes disso, decidir com Marcelo o que fazer com os ~79 arquivos não commitados da
sessão de 2026-09-21** (ver aviso de estado na seção "Identidade visual"). Fora isso, resta só:
itens ainda não decididos de 2026-09-20 (seção própria abaixo, só "subagentes de aprovação por
domínio" — horário padrão de lembretes já estava implementado, ver correção 2026-09-21 na seção do
Roadmap).

**Regra permanente (2026-09-14)**: `terraform apply` NUNCA roda localmente — só via pipeline de CD. `plan`/`validate`/`fmt`/`test` locais continuam liberados.

**Lição de processo**: default é fork serial (não orquestração paralela via Workflow) — mais barato em token, evita o "imposto" de recontextualização de agente fresco. Paralelizar só se Marcelo pedir velocidade explicitamente.

## Manutenção de CI/testes (2026-09-21, achados reais desta sessão, ver D-311/D-312)

CI de `develop` ficou vermelho por toda a Fase 2 de identidade visual v2 (desde `686d944`) sem
ninguém perceber — bug de `vite.config.ts` (HTTPS vazando pro `vite preview` do Playwright)
travava o job `frontend` inteiro antes de rodar qualquer teste real, mascarando de quebra uma
regressão real de contraste WCAG em ~15 telas. Ambos corrigidos e verificados (commit
`1ee7dcb`, D-311) — checar se o run de CI deste commit passou antes de confiar em qualquer run
anterior a ele como sinal de saúde do frontend. Separadamente, backend: `vitest.config.ts` forçava
TODOS os 274 arquivos de teste a rodar em série por causa de só 7 (`test/architecture/**`)
precisarem disso — dividido em `vitest.workspace.ts` (D-312), sem perder a serialização onde é
realmente necessária.

## Programa de Performance (2026-09-14, iniciativa própria de Marcelo — foco real da sessão)

Fonte: `expiration-tracker-plano-acao-performance-world-class-2026-09-14.md` (raiz do repo, do
Marcelo — nunca mover/commitar sem pedir). Rastreamento vivo: `docs/engineering/performance/TODO.md`.
Ciclos A/B/C, PERF-13/14 completos e implantados (2026-09-18). PERF-11/11-b: teto real é o rate
limiter da própria app (100 req/60s/tenant), não infra AWS.

**PERF-12 (pipeline de lembretes)**: D-299 a D-304 (plano de controle dedicado por evento —
`DueWorkTable` autoritativa sem stream, outbox/stream/relay exclusivos para dispatch de reminders,
sub-shard da chave do outbox) implementados e implantados em `dev`. Narrativa completa de cada
decisão e dos incidentes reais pós-deploy (bug de checkpoint, gap de IAM em `PutItem` dentro de
`TransactWriteItems`, `reconcileDst` cancelando ocorrências atrasadas, sweeper travando por
partição compartilhada no GSI6) já está em `decisions-log.md` (D-299 a D-304) e
`docs/engineering/performance/TODO.md` — não recontar aqui. **Estado atual**: degrau de 10k padrão
revalidado 2026-09-20 (10.000/10.000, p100=230,26s, SLO 300s). D-304 continua
`PENDING_PROTOCOL_REVIEW` (protocolo suspenso). **Degrau de 100k — ENCERRADO 2026-09-21 (D-310):**
seed 100% completo, bug real de HARNESS achado e corrigido (buffer fixo de materialização não
escalava com o cohort), mas a própria recuperação LOCAL nunca terminou (`materialize` ficou 57min
fazendo polling sem produzir `cohort.json`, processo encerrado manualmente, lock removido — este
run nunca teve artefato oficial `cohort.json`/`result.json`). **O resultado real foi confirmado de
forma independente, direto na AWS** (DynamoDB `ConsistentRead` + CloudWatch, 2 investigações
separadas): 100% das 100k ocorrências chegaram a `TRIGGERED`, zero erro/throttle, mas o disparo
real levou ~16-17min — **SLO de 300s NÃO atingido nesta escala**. Não é bloqueador (sem usuário
real, `AGENTS.md` §1); mitigação já existe via `defaultReminderLocalTime` (sorteio de horário).
Decisão de Marcelo: não perseguir 500k nem otimizar `dispatch-outbox-relay-processor.ts` agora.

**Backlog registrado, não implementado**: `dispatch-outbox-relay-processor.ts` processa lotes de
stream sequencialmente (~14 registros/s, `map-with-concurrency.ts` existe mas não é usado aqui) —
risco real se 100k/500k reproduzirem o gargalo do D-304. Decisão de Marcelo: não implementar agora,
esperar o protocolo Claude↔Codex voltar antes de mexer no caminho crítico de dispatch.

## PRÓXIMA SESSÃO — mandato autônomo explícito (Marcelo, 2026-09-19, ler antes de qualquer outra coisa)

**Status 2026-09-21 — ESCADA ENCERRADA, não retomar sem novo pedido explícito de Marcelo.** 10k
revalidado (`accepted: true`, p100=230,26s). 100k rodou e teve seu resultado real confirmado
(SLO NÃO atingido nesta escala, zero erro — ver Programa de Performance acima/D-310); Marcelo
decidiu não perseguir 500k por ora. As regras desta seção (cohort padrão de tenants, cuidado com
e-mail real, protocolo suspenso) continuam válidas caso ele peça pra retomar a escada no futuro.

**Escada de escala, autônoma, sem parar para perguntar (SE retomada)**: rodar 10k → se `accepted:
true` (SLO 300s, zero perda, sem regressão), seguir para 100k → se passar, seguir para 500k. Parar
a escada (não avançar para o próximo degrau) só se um degrau reprovar — nesse caso, investigar a
causa raiz real (nunca supor; só concluir com evidência direta de logs/AWS, mesmo padrão desta
sessão), corrigir minimizando ao máximo o risco de regressão, e **re-rodar o MESMO degrau que
falhou** antes de tentar avançar — nunca pular para o próximo tamanho com um bug conhecido não
resolvido.

**Limite técnico real, verificado**: `perf-reminder-burst.mjs` hoje só aceita até
`PERF_REMINDER_BURST_SIZE=100000` (`requireThatBurstSize`, teto hardcoded). **500k não é possível
sem alterar o script primeiro** — decidir e implementar esse aumento de teto com o mesmo cuidado
de sempre (ler o motivo do teto atual antes de só apagar o número, considerar se o resto do
harness — paginação, sessão Cognito de 15min, cutoff de criação — ainda se comporta bem numa carga
5x maior) antes de tentar o degrau de 500k.

**Cota real da AWS que também limita a escala, verificada nesta sessão**: SES `Max24HourSend =
50.000`/24h. Qualquer tentativa de enviar e-mail real por item nos degraus de 100k/500k estouraria
essa cota sozinha, sem nem precisar do problema abaixo.

**MUITO IMPORTANTE — não repetir o problema dos e-mails reais chegando na caixa pessoal de
Marcelo** (8 notificações de reclamação simulada da AWS, `complaints@email-abuse.amazonses.com`,
recebidas durante a verificação de 1k desta sessão, quando o cohort `perf-12-email-tenants.json`
— que inclui de propósito um tenant `complaint@simulator.amazonses.com` e um `bounce@...` — foi
usado). Para os degraus de 10k/100k/500k, que servem para provar SLO/throughput de
scan→claim→dispatch→`TRIGGERED` (não para reprovar entrega de e-mail, já comprovada nesta sessão
em pequena escala): **usar o arquivo de tenants PADRÃO (`perf-11b-tenants.json`, sem passar
`PERF_REMINDER_BURST_TENANTS_FILE`), que não define `assigneeUserId`** — sem isso, o item vira
`NotificationIntent` `CANCELLED` de forma limpa e imediata (`RECIPIENT_NOT_FOUND`, comportamento
documentado, já observado em todas as rodadas antes da correção de assignee), **nunca chega a
tentar um envio real ao SES, nunca entra em `RETRY`**, e não afeta em nada o critério de sucesso
do teste (`TRIGGERED`, não entrega). Não usar `perf-12-email-tenants.json` nestes 3 degraus sob
hipótese alguma.

**Protocolo Claude↔Codex SUSPENSO até novo aviso (Marcelo, 2026-09-19)** — Codex bloqueado até
2026-09-23, Antigravity também sem cota até ~2026-09-26 (ver acima). Enquanto isso, Claude decide
sozinho qualquer questão de nível 5-6 que normalmente exigiria o protocolo, **mas toda decisão
tomada sem o protocolo formal deve ser marcada explicitamente com status `PENDING_PROTOCOL_REVIEW`**
(no documento de decisão/review correspondente, nunca `APPROVED_BY_OWNER` nem "protocolo
dispensado" — essas duas frases são para dispensa explícita por Marcelo, não para ausência de
ferramenta) e listada aqui em `NEXT_SESSION_PROMPT.md` para retomar assim que Codex ou Antigravity
voltarem a funcionar. Isto NÃO dispensa rigor — conclusões só a partir de fatos verificados ao
vivo (nunca suposição), e toda correção de código passa pela suíte de testes completa antes de
qualquer merge.

**Conclusão de cada etapa de ajuste**: só marcar uma correção como concluída depois de passar pela
skill `/task-checklist` (`docs/engineering/task-completion-checklist.md`, `AGENTS.md` §1) — não
antes. Isto vale para cada bug encontrado durante a escada de escala, individualmente.

**Se a sessão começar com a pipeline ainda rodando** (Marcelo pode iniciar a próxima sessão sem
esperar o teste atual terminar): primeiro checar `ps aux | grep perf-reminder-burst` e o estado
real na AWS antes de presumir uma sessão limpa — nunca lançar um novo run sem antes confirmar se
já existe um em andamento (risco de corrida de git/AWS entre dois runs concorrentes, já registrado
em memória).

**Achado incidental, não bloqueante, de sessão anterior**: gate `Authenticated k6 smoke`
reprovou 2x por `p(95)<3000`; confirmado via CloudWatch que é flakiness PRÉ-EXISTENTE
(cold start sob rajada de poucas requests, não causado por D-303) — nota em `performance/TODO.md`
§PERF-14, rerun resolve, threshold/concorrência do BFF é candidato a ajuste futuro.

**Checklist de conclusão de tarefa + skill (2026-09-18, decisão direta do Marcelo)**: `docs/engineering/task-completion-checklist.md` (gate checkbox derivado de `definition-of-done.md`+`change-risk-scale.md`+`quality-gate-tiers.md`+`joint-review-criteria.md`) + skill `.claude/skills/task-checklist/` — uso obrigatório ao fim de toda tarefa, ver `AGENTS.md` §1.

**Manutenção paralela, não bloqueante**: fix de redeploy do canário Synthetics mergeado (expôs e corrigiu um bug real no próprio script do canário, API confirmada saudável o tempo todo); consolidação de 23 PRs Dependabot duplicados do Terraform em andamento (cada módulo tem seu próprio lock file — achado real, `npm run check-dependency-freshness` pegou a inconsistência da primeira tentativa).

**Sweeper genérico de reconciliação** (mesma classe de gargalo do D-301/D-302/D-303 — partição compartilhada no GSI6) — corrigido e validado 2026-09-20 (10.000/10.000 sem gap pós-fix); proposta completa em `docs/architecture/reviews/outbox-sweeper-shared-partition/PROPOSAL.md` (Claude↔Antigravity, 9,5/10).

**Limpeza de dados sintéticos de `dev` — concluída 2026-09-20**: `scripts/reset-dev-data.ts --confirm` zerou tabela principal/sessão e filas, verificado pelo próprio script (evidência: `docs/architecture/reviews/multi-user-b2b-wave-b2b12-scoping/dev-reset-manifest-2026-09-20T05-59-14-325Z.json`). 4 bugs reais do script achados e corrigidos em escala real (OOM, região errada, overflow de string, `ThrottlingException` não tratada) — teste novo cobre o caso do throttle.

**Achado incidental, também pendente (não é do programa de performance)**: proposta de import CSV em massa para Items — ver item 9 da lista de pendências abaixo.

**Achado real não corrigido, 2026-09-19 (`ladder-email-25k`/`-retry`) — gargalo cosmético de
observabilidade, sem impacto funcional**: sob carga sustentada, o layer ADOT descarta lotes de
trace inteiros (timeout app→coletor→X-Ray real); zero requisição falhou, só falta trace completo
no X-Ray para as atingidas. Correção exigiria `collector.yaml` customizado empacotado em todas as
~69 Lambdas — mudança sistêmica de observabilidade, arriscada se malfeita. Decisão de Marcelo:
registrar como pendência, mesma categoria do débito técnico de infra do roadmap (`docs/project/
roadmap-competitivo-2026-09-01.md` §17/§18.6), não implementar agora.

## Itens de 2026-09-20 ainda não decididos/iniciados (ordem de Marcelo, itens 1-2 já resolvidos acima)

- ~~Horário padrão de lembretes~~ — **CORREÇÃO 2026-09-21**: a linha anterior deste arquivo dizia
  "não decidida nem iniciada" por engano (escrita por uma sessão sem contexto da implementação já
  feita ANTES da compactação que a originou). Já está 100% implementada e mergeada:
  `create-organization.ts`'s `pickReminderLocalTime()` sorteia um dos 15 horários BRT (10:00-17:00,
  meia/hora cheia) em `Organization.defaultReminderLocalTime` no onboarding; ajustável depois pelo
  Owner em Configurações; `ItemReminderPolicy.tsx` já propõe esse valor como default de gatilhos
  NOVOS (não retroativo). As 3 decisões que estavam em aberto já foram resolvidas pela própria
  implementação (nível=tenant, escopo=só novos, local=Configurações). Único resto: revisão
  adversarial Codex voluntária ainda pendente (item 11 da lista de pendências acima).
- **Subagentes de aprovação por domínio** (Marcelo): pesquisa/planejamento (não implementar ainda)
  de subagentes acionados ao fim de toda tarefa, um por eixo de `joint-review-criteria.md`. Não
  iniciado nesta sessão.

## Status de evidência (não presumir E2E sem checar)

A maioria dos mecanismos do roadmap P0/backlog P1 está `IMPLEMENTED`/`UNIT TESTED` e confirmada `Active` contra `dev` via `aws --profile claude-dev`, mas **nem todo mecanismo tem prova E2E de ponta a ponta disparando pelo gatilho real** (cron/SQS real, não só G-V3/unit) — isso é nomeado individualmente nas linhas do roadmap acima onde relevante ("nunca testado ponta a ponta com... real"). Não assumir E2E PROVEN sem checar a linha específica do item ou `decisions-log.md`.

## Links para histórico (não reler por padrão — só sob demanda)

- `docs/architecture/session-log.md` — linha do tempo compacta, uma entrada por sessão.
- `docs/architecture/decisions-log.md` / `docs/engineering/decisions-log.md` — toda decisão com nota Claude/Codex e status (D-0xx / E-0xx).
- `docs/architecture/reviews/` — artefatos de cada rodada Claude↔Codex por tema.
- `docs/project/handoffs/` — prompts de handoff de sessões anteriores, superseded por este arquivo.
- `docs/frontend/` — planejamento de interface + `interface-quality-standard.md` + `prototype/`.
- `docs/architecture/multi-user-b2b-wave-tracker.md` — detalhe fatia-a-fatia do Multi-User B2B (15 waves, D-084 a D-120).
