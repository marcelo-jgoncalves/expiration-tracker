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

## Próxima ação recomendada

**P0/P1/full-audit round2/auditoria externa são contexto histórico já fechado, não a próxima ação
— ver seções acima.** A ordem real de trabalho para a próxima sessão foi definida diretamente por
Marcelo em 2026-09-20 — ver seção dedicada **"PRÓXIMA SESSÃO — ordem definida por Marcelo
(2026-09-20)"** logo abaixo do mandato autônomo do Programa de Performance; ela tem prioridade sobre
retomar a escada 100k/500k.

**Regra permanente (2026-09-14)**: `terraform apply` NUNCA roda localmente — só via pipeline de CD. `plan`/`validate`/`fmt`/`test` locais continuam liberados.

**Lição de processo**: default é fork serial (não orquestração paralela via Workflow) — mais barato em token, evita o "imposto" de recontextualização de agente fresco. Paralelizar só se Marcelo pedir velocidade explicitamente.

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
revalidado 2026-09-20 (10.000/10.000, p100=230,26s, SLO 300s); 100k/500k ainda não executados (ver
seção de ordem de trabalho abaixo). D-304 continua `PENDING_PROTOCOL_REVIEW` (protocolo suspenso).

**Backlog registrado, não implementado**: `dispatch-outbox-relay-processor.ts` processa lotes de
stream sequencialmente (~14 registros/s, `map-with-concurrency.ts` existe mas não é usado aqui) —
risco real se 100k/500k reproduzirem o gargalo do D-304. Decisão de Marcelo: não implementar agora,
esperar o protocolo Claude↔Codex voltar antes de mexer no caminho crítico de dispatch.

## PRÓXIMA SESSÃO — mandato autônomo explícito (Marcelo, 2026-09-19, ler antes de qualquer outra coisa)

**Status 2026-09-20**: degrau de 10k revalidado (`accepted: true`, p100=230,26s — ver D-304 acima),
limpeza de `dev` concluída, checklist de conclusão aplicado (ver `decisions-log.md`). Marcelo
inseriu 3 itens antes de retomar a escada (ver seção **"PRÓXIMA SESSÃO — ordem definida por Marcelo
(2026-09-20)"** mais abaixo) — quando chegar a hora de retomar em 100k, as regras desta seção
inteira continuam todas válidas (cohort padrão, sem protocolo, etc.).

**Escada de escala, autônoma, sem parar para perguntar**: rodar 10k → se `accepted: true` (SLO
300s, zero perda, sem regressão), seguir para 100k → se passar, seguir para 500k. Parar a escada
(não avançar para o próximo degrau) só se um degrau reprovar — nesse caso, investigar a causa raiz
real (nunca supor; só concluir com evidência direta de logs/AWS, mesmo padrão desta sessão),
corrigir minimizando ao máximo o risco de regressão, e **re-rodar o MESMO degrau que falhou**
antes de tentar avançar — nunca pular para o próximo tamanho com um bug conhecido não resolvido.

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

**Manutenção paralela, não bloqueante**: fix de redeploy do canário CloudWatch Synthetics (`aws_synthetics_canary` não tem `source_code_hash`, zip nunca era redeployado por mudança de conteúdo) mergeado — esse redeploy expôs, em 2026-09-19, um bug real no PRÓPRIO script do canário (lia o corpo da resposta via `for await...of`, que não funciona de forma confiável no runtime do Synthetics; corrigido para o padrão oficial `'data'`/`'end'` da AWS, confirmado que a API estava saudável o tempo todo). Consolidação de 23 PRs Dependabot duplicados/parados (`hashicorp/aws` 6.62.0→6.65.0, só tocavam `infra/.terraform.lock.hcl`) em andamento — cada módulo tem seu próprio lock file (achado real: a primeira tentativa só atualizou o da raiz, `npm run check-dependency-freshness` pegou a inconsistência).

**Sweeper genérico de reconciliação, mesma classe de gargalo do D-301/D-302/D-303** (`exptrk-dev-outbox-sweeper-reminder-dispatch`, cobre ~12 destinos: e-mail, WhatsApp, importação, etc.) — travava por timeout a cada execução (5 em 5 min) desde pelo menos 2026-09-17 porque os 12 destinos compartilhavam a MESMA partição no GSI6. Proposta (query única + roteamento por registro) aprovada em protocolo Claude↔Antigravity, 3 rodadas, 9,5/10 (`docs/architecture/reviews/outbox-sweeper-shared-partition/PROPOSAL.md`). **Implementada e validada 2026-09-20**: revalidação de 10k fechou 10.000/10.000 sem gap de materialização após o fix (a tentativa anterior tinha 1/10.000 preso pelo mesmo timeout).

**Limpeza de dados sintéticos de `dev` — concluída 2026-09-20**: `scripts/reset-dev-data.ts --confirm` (sem `--include-cognito`) esvaziou a tabela principal (1.854.709→0), a tabela de sessão (874→0) e purgou as 36 filas; S3/Cognito já estavam vazios. Verificação final do próprio script confirma tudo zerado. Evidência: `docs/architecture/reviews/multi-user-b2b-wave-b2b12-scoping/dev-reset-manifest-2026-09-20T05-59-14-325Z.json`. Achado incidental no processo: o script tinha 3 bugs reais em escala real (OOM no parse do Scan, região errada no S3 pelo profile `claude-dev`, overflow de string serializando ~1,85M itens) e um 4º achado ao vivo já com a correção de concorrência (`ThrottlingException` lançada, não só `UnprocessedItems`, travava o run inteiro) — todos corrigidos, com teste novo cobrindo o caso do throttle.

**Achado incidental, também pendente (não é do programa de performance)**: proposta de import CSV em massa para Items — ver item 9 da lista de pendências abaixo.

**Achado real não corrigido, 2026-09-19 (rodadas de 25k reais com e-mail, `ladder-email-25k`/`-retry`)
— gargalo cosmético de observabilidade, sem impacto funcional**: sob carga sustentada de 10
tenants por horas, o layer ADOT de `bff-handler`/`items-handler`/`reminders-handler` (e
provavelmente outras Lambdas sob a mesma carga) descarta lotes de trace inteiros — timeout local
app→coletor (`Error: Request Timeout`, `otlp-exporter-base`) e timeout coletor→X-Ray real
(`OTLPExporterError`/408, `"msg":"Exporting failed. Rejecting data"`, 60-96 itens por lote
descartado). Confirmado sem nenhum impacto funcional: zero requisição falhou, zero item de
journal de seed travado nas duas rodadas — só fica sem trace completo no X-Ray para as
requisições atingidas. Correção real exigiria `collector.yaml` customizado via
`OPENTELEMETRY_COLLECTOR_CONFIG_URI` (doc oficial: `aws-otel.github.io/docs/getting-started/
lambda/lambda-custom-configuration`), empacotado no build de TODAS as ~69 Lambdas + variável de
ambiente compartilhada (`local.common_env`) — mudança sistêmica de observabilidade, com risco real
de quebrar tracing por completo se mal configurada, não um ajuste pontual. Decisão do Marcelo,
2026-09-19: registrar como pendência, não implementar agora — mesma categoria de item que o
débito técnico de infra do roadmap (`docs/project/roadmap-competitivo-2026-09-01.md` §17/§18.6).

## PRÓXIMA SESSÃO — ordem definida por Marcelo (2026-09-20), tem prioridade sobre a escada 100k/500k

Ordem literal pedida por ele, autônoma (sem parar para confirmar entre os itens, só nos pontos de
decisão de produto explicitamente marcados abaixo):

1. ~~Corrigir o CI quebrado (PR #380)~~ — **RESOLVIDO 2026-09-20**, ver item 0 da lista de
   pendências acima.
2. ~~Corrigir a separação de ambientes~~ — **DECIDIDO 2026-09-20** (`ADR-0014`, D-305,
   `PENDING_PROTOCOL_REVIEW` — protocolo ainda suspenso). AWS Organizations + conta por ambiente
   (nunca `terraform workspace`, desaconselhado pela própria HashiCorp), pesquisa externa SIM
   PARCIAL (AWS Well-Architected + docs oficiais HashiCorp). Fase 1 (aditiva, sem custo) feita:
   `infra/variables.tf` aceita `"staging"`/`"production"`; achado real corrigido no processo —
   `document-malware-protection`'s fail-closed guard esperava a string `"prod"` (nunca alcançável
   antes), alinhado para `"production"` antes de virar bypass silencioso do GuardDuty. **Fases
   2-4 (criar contas `staging`/`production`, provisionar, pipeline de promoção) aguardam
   autorização explícita de Marcelo** — confirmado por ele, 2026-09-20: nenhum deploy de produção
   real ainda, só preparação. Revisão adversarial Codex também pendente (mesma fila do item 11 da
   lista de pendências acima).
3. **Avaliação de horário padrão de envio de lembretes/alertas** (proposta de Marcelo, não
   decidida): horário padrão sorteado aleatoriamente na entrada do cliente no sistema (onboarding),
   restrito a horas cheias/meias BRT entre 10:00 e 17:00 (10:00, 10:30, 11:00, ..., 17:00 — nunca
   minutos quebrados como 10:23), e ajustável depois pelo próprio cliente. **Estado real hoje**
   (achado, nada disto implementado ainda): `ReminderPolicy.localTime`
   (`src/modules/reminder/domain/reminder-policy.ts`) já é um campo `HH:mm` por trigger, totalmente
   editável pelo cliente — mas o valor DEFAULT que a UI propõe ao criar um trigger novo é hardcoded
   `"09:00"` para todo mundo (`DEFAULT_LOCAL_TIME`,
   `frontend/src/routes/items/ItemReminderPolicy.tsx`), nunca sorteado, nunca ciente do tenant.
   `Organization.timezone` já existe e é setado no onboarding (`POST /bff/organizations`) — gancho
   natural para o sorteio. `quietHours` (`notification-preferences.ts`) é um conceito DIFERENTE
   (janela de supressão de envio, não horário preferido) — não confundir os dois na proposta. O
   pipeline de disparo (`reminder-producer`, `infra/modules/reminder-schedule/main.tf`) roda
   `rate(1 minute)` 24/7 sem geofencing de horário comercial — o que estiver due dispara na hora,
   então mudar só a UI/onboarding basta, não o pipeline em si. Decisões de produto reais antes de
   implementar (ponto de parada — perguntar a Marcelo): nível do default (por tenant ou por
   usuário individual dentro do tenant), se aplica só a triggers NOVOS ou também retroativamente
   aos já existentes, e onde exatamente em Configurações o cliente ajusta isso.
4. **Antes da decisão sobre o item 3 vs. 100k**: Marcelo pediu, 2026-09-20, rodar primeiro um
   degrau extra de **50** (mesmo tenant file padrão `perf-11b-tenants.json`, mesma regra de
   segurança de e-mail do mandato acima) como sanity check pós-limpeza de `dev`/pós-fix do
   sweeper, antes de escolher entre implementar a feature do item 3 ou seguir para 100k.
5. **Novo item, 2026-09-20 (Marcelo)**: pesquisa/planejamento (sem implementar ainda) de
   subagentes customizados de aprovação por domínio técnico, acionados ao final de toda tarefa —
   cada um responsável por um eixo já formalizado em `joint-review-criteria.md`
   (Arquitetura/Qualidade de Engenharia/Observabilidade-Operações-SRE/etc.); tarefa só
   considerada concluída quando aprovada por todos. Entregável: documento de proposta (não
   subagente real ainda) para revisão de Marcelo.

## Status de evidência (não presumir E2E sem checar)

A maioria dos mecanismos do roadmap P0/backlog P1 está `IMPLEMENTED`/`UNIT TESTED` e confirmada `Active` contra `dev` via `aws --profile claude-dev`, mas **nem todo mecanismo tem prova E2E de ponta a ponta disparando pelo gatilho real** (cron/SQS real, não só G-V3/unit) — isso é nomeado individualmente nas linhas do roadmap acima onde relevante ("nunca testado ponta a ponta com... real"). Não assumir E2E PROVEN sem checar a linha específica do item ou `decisions-log.md`.

## Links para histórico (não reler por padrão — só sob demanda)

- `docs/architecture/session-log.md` — linha do tempo compacta, uma entrada por sessão.
- `docs/architecture/decisions-log.md` / `docs/engineering/decisions-log.md` — toda decisão com nota Claude/Codex e status (D-0xx / E-0xx).
- `docs/architecture/reviews/` — artefatos de cada rodada Claude↔Codex por tema.
- `docs/project/handoffs/` — prompts de handoff de sessões anteriores, superseded por este arquivo.
- `docs/frontend/` — planejamento de interface + `interface-quality-standard.md` + `prototype/`.
- `docs/architecture/multi-user-b2b-wave-tracker.md` — detalhe fatia-a-fatia do Multi-User B2B (15 waves, D-084 a D-120).
