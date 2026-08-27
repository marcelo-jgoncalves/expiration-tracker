# docs/architecture/ — Índice e Mapa de Autoridade

```text
Design maturity:        APPROVED (arquitetura conceitual + Implementation Blueprint)
Operational architecture: NOT APPROVED
Current phase:           Implementação real (código/infra/testes) — Implementation Blueprint concluído
Last verified:           2026-08-27 (M6/M9/M10/M11 deployados em `main`/`dev`; **M7 (extração/OCR) code-complete e deployado em `dev`** — todos os 9 itens da lista original reais de ponta a ponta (Textract/parser determinístico/Bedrock/validação, state machine real, rotas HTTP confirm/reject, quota AI_CALL), PR #60 mergeado em `main`; **verificação E2E real executada em 2026-08-27** contra `dev` (cadeia real S3→SQS→Step Functions→Textract→parser→persistência, ver `NEXT_SESSION_PROMPT.md`) — achou 3 bugs reais, 2 corrigidos e mergeados em `main` via PR #67 (envelope de feature flags do AppConfig lido no nível errado, deixando o pipeline permanentemente fail-closed; rotas HTTP `confirm`/`reject` 100% quebradas por schema nunca registrado + chave OCC malformada), 1 gap real deliberadamente não corrigido e aguardando decisão de produto do Marcelo (campo auto-`CONFIRMED` pelo pipeline nunca propaga para `ExpirationItem.dueDate` — nenhuma rota escreve isso hoje); M12 bloqueado por decisão de produto (D-052); Full BFF — D-053/D-054 — **implementado e `APPROVED AS FRONTEND PRODUCTION FOUNDATION`** (`src/modules/bff/`, infra Terraform, frontend real em `frontend/`, protocolo Claude↔Codex completo em `docs/frontend/frontend-production-foundation.md` — Rodada D levou 6 passagens/5 achados bloqueantes reais de segurança de sessão até convergir); planejamento de interface concluído — 8 de 9 etapas `APPROVED` em `docs/frontend/`, só falta User Validation (em suspenso a pedido do Marcelo); os 3 blockers técnicos de backend descobertos no planejamento de interface (BLOCKER-A/B/C) estão **todos resolvidos** (backend + frontend onde aplicável — BLOCKER-C via Variante B, revisão humana explícita, primeira fatia real do anchor Fornecedor/Subject); infra de hospedagem do SPA (CloudFront+S3, ADR-0011) fechada de ponta a ponta e deployada — ver `NEXT_SESSION_PROMPT.md` para o estado exato e a próxima ação concreta, este bloco pode ficar temporariamente atrás dele)
```

Ver `ARCHITECTURE.md` (raiz do repo) para o resumo executivo consolidado e `NEXT_SESSION_PROMPT.md` para a próxima ação concreta.

## Precedência de fontes (quando houver divergência)

1. `AGENTS.md` (raiz) — processo de trabalho dos agentes, sempre vence sobre conteúdo de arquitetura.
2. ADR aceito em `adr/` — decisão arquitetural específica e formal.
3. Documento temático corrente (tabela abaixo, coluna "normativo atual") — especificação detalhada do domínio.
4. `ARCHITECTURE.md` — visão consolidada e índice executivo; não sobrescreve silenciosamente um ADR ou documento temático divergente — divergência entre eles é defeito a corrigir, não licença para escolher.
5. `NEXT_SESSION_PROMPT.md` — estado de execução, nunca fonte normativa de arquitetura.
6. `docs/architecture/history/` — evidência histórica de como se chegou a uma decisão, nunca normativo.

## Índice por documento

| Documento | Classificação | Do que trata |
|---|---|---|
| `../ARCHITECTURE.md` | resumo/índice | Documento consolidado final, aponta para todos os outros |
| `../docs/00-prompt-mestre.md` | histórico/processo (ciclo concluído) | Processo Claude↔Codex que produziu o design; não é ponto de entrada de sessão |
| `quality-criteria.md` | normativo atual | 12 critérios de qualidade, pesos, gates G1-G6 |
| `fitness-function.md` | normativo atual | Fitness function derivada dos critérios |
| `requirements.md` | normativo atual | Requisitos funcionais/não-funcionais, unknowns |
| `capacity-model.md` | normativo atual | Modelo de capacidade Stage 0-5 |
| `architecture-fase3-consolidada.md` | normativo atual | Arquitetura AWS conceitual, 14 decisões numeradas |
| `data-model.md` | normativo atual | Modelo de domínio/dados, DynamoDB single-table, 6 GSIs |
| `slo.md` | normativo atual | SLOs, incluindo drenagem de pico extremo |
| `disaster-recovery.md` | normativo atual | RPO/RTO, teste de restore, runbook |
| `incident-runbooks.md` | normativo atual (draft operacional) | Runbooks OPS-006 (falha de disparo, DLQ, provedor, IA), matriz de severidade/escalonamento, template de post-mortem, registro de exercícios |
| `privacy-lgpd.md` | normativo atual | Classes de retenção, direitos do titular |
| `cost-model.md` | normativo atual | Modelo de custo por estágio |
| `mcp-readiness.md` | normativo atual | Prontidão de domínio para MCP futuro |
| `evolution.md` | normativo atual | Transições de estágio, gatilhos |
| `aws-well-architected-review.md` | normativo atual | Revisão pelos 6 pilares AWS, riscos conhecidos |
| `threat-model.md` | normativo atual | Threat model STRIDE, seção 33 — APPROVED (Claude ~9.05 / Codex 9.002) |
| `implementation-blueprint.md` | normativo atual | Implementation Blueprint, seção 60 — componentes, interfaces, eventos/schemas, ordem de deploy, milestones — APPROVED (Claude 9.20 / Codex 9.2) |
| `m3.5-runtime-design.md` | normativo atual | Design do milestone M3.5 (runtime real do Reminder Engine, fechamento de G8) — adapters DynamoDB, handlers Lambda, outbox+relay SQS/DLQ, EventBridge Scheduler+GSI6, testes em 3 camadas — APPROVED (Claude 9.0 / Codex 9.3) |
| `reminder-delivery-pipeline.md` | normativo atual | BLOCKER-B — pipeline real de materialização/entrega de lembretes: event taxonomy (`expiration.item-due-date-changed.v1`/`item-deactivated.v1`/`reminder.policy-changed.v1`), lifecycle do ponteiro `POLICYREF#`, fencing de concorrência (dispatch + reconciliação), backfill — APPROVED (arquitetura, Codex 9.2/10, rodadas B-H; implementação, Codex 9.2/10, 2 rodadas) |
| `blocker-b-recon-handoff.md` | histórico/evidência (citado por `reminder-delivery-pipeline.md` §3/§3.2) | Recon pré-implementação de BLOCKER-B (materializer/trigger de materialização, infra Terraform) confirmado contra o código real antes do design ser escrito; BLOCKER-B está implementado e mergeado (PR #50) — este documento só registra a evidência que fundamentou o design |
| `blocker-b-mission-brief.md` | histórico/evidência | Texto verbatim do prompt de missão original (2026-08-24) que abriu o recon de BLOCKER-B acima; persistido porque só existia em histórico de conversa de uma sessão específica |
| `decisions-log.md` | decisão/ADR (log vivo) | D-000 a D-043 (a numeração não é sequencial na ordem das linhas — D-024 a D-028 foram inseridas antes de D-010 a D-023 no arquivo), nota Claude/Codex, status |
| `reviews/m7-extraction-design/` | histórico/evidência de rodada | Artefatos do protocolo Claude↔Codex de M7 (proposta Claude, proposta Codex, crítica, reconciliação final aprovada — D-035) |
| `adr/` | decisão/ADR | 11 ADRs formais para decisões Type 1 |
| `reviews/spa-hosting-cloudfront-bff/` | histórico/evidência de rodada (protocolo `AGENTS.md` §4) | Debate de 6 rodadas que produziu ADR-0011 (coexistência CloudFront + Full BFF) — nota final 9,2/9,3 |
| `diagrams/diagrams.md` | normativo atual (visual) | 14 diagramas Mermaid |
| `diagrams/project-status.html` | resumo/índice (visual) | **O documento de status do projeto** — painel visual (timeline de marcos, achados reais, pendências); abrir no navegador para uma visão executiva rápida, mais legível que `NEXT_SESSION_PROMPT.md` para esse fim (que continua sendo a fonte de estado detalhado por sessão) |
| `session-log.md` | histórico | Log cronológico compacto por sessão |
| `roadmap-evolution/01-gap-analysis.md` | informativo (rascunho, não normativo) | Fase 1 da evolução estratégica do roadmap (2026-08-23): estado real dos milestones + classificação de cada capacidade comercial proposta contra o código real. Insumo para a Fase 2 (pesquisa de mercado + modelagem de domínio + protocolo Claude↔Codex por tema), nunca decisão fechada |
| `roadmap-evolution/02-market-research.md` | informativo (rascunho, não normativo) | Fase 2a: pesquisa de mercado real sobre concorrentes (TrustLayer, Certificial, SubCompliant, VendorJot, Remindax, categoria ampla) e tentativa de refutar cada capacidade proposta na Fase 1 — achado central: billing por sujeito rastreado é padrão de mercado dominante |
| `roadmap-evolution/03-domain-model-tracked-subject-requirement.md` | informativo (decisão reconciliada via protocolo AGENTS.md §4, ADR formal só na Fase 3) | Fase 2b, primeiro cluster de modelagem de domínio (`TrackedSubject`+`RequirementAssignment`) — protocolo Claude↔Codex completo via MCP, nota final 9,1/9,1 |
| `roadmap-evolution/04-domain-model-guest-upload.md` | informativo (decisão reconciliada via protocolo AGENTS.md §4, ADR formal só na Fase 3) | Fase 2b, segundo cluster (guest upload/magic link, `DocumentRequest`+`DocumentSubmission`) — protocolo Claude↔Codex completo via MCP, nota final 9,2/9,2; achado real: GSI novo evitado reaproveitando padrão de `IdentityMapping` |
| `roadmap-evolution/05-domain-model-organization-billing.md` | informativo (decisão reconciliada via protocolo AGENTS.md §4, ADR formal só na Fase 3) | Fase 2b, terceiro cluster (Organization/Membership/RBAC + Billing/Entitlements) — protocolo Claude↔Codex completo via MCP, nota final 9,2/9,2; reordena billing por `TrackedSubject` antes de Organization; achado real de correção pendente em `evolution.md:13` |
| `roadmap-evolution/06-domain-model-automated-chasing.md` | informativo (decisão reconciliada via protocolo AGENTS.md §4, ADR formal só na Fase 3) | Fase 2b, quarto cluster (automated document chasing via Reminder Engine) — protocolo Claude↔Codex completo via MCP, nota final 9,1/9,2; agregados-irmãos em vez de generalizar `NotificationIntent`/`ReminderOccurrence` já em produção, aplicando o precedente de M7; GSI3 reaproveitado sob condição de mini-revisão de capacidade |
| `roadmap-evolution/07-domain-model-escalation-watchers-digest.md` | informativo (decisão reconciliada via protocolo AGENTS.md §4, ADR formal só na Fase 3) | Fase 2b, quinto cluster (escalation/watchers/digest) — protocolo Claude↔Codex completo via MCP, nota final 9,2/9,4; `ItemWatch` como extensão direta de padrão já em produção (mesma partição de `Document`/M6); digest registrado como questão aberta, não decidida |
| `roadmap-evolution/08-domain-model-custom-fields.md` | informativo (decisão reconciliada via protocolo AGENTS.md §4, lista de rejeitados formal só na Fase 3) | Fase 2b, sexto cluster — custom fields genérico (`FieldDefinition`/`FieldValue`) rejeitado/adiado por padrão (nota 9,1/9,0), valor já servido por `tags[]`+`notes?`+`requirementName`; emenda registrada nos clusters 1 e 2 |
| `roadmap-evolution/09-domain-model-csv-import.md` | informativo (decisão reconciliada via protocolo AGENTS.md §4, ADR formal só na Fase 3) | Fase 2b, sétimo e último cluster (CSV import/export) — protocolo Claude↔Codex completo via MCP, nota final 9,2/9,4; formula injection mitigada na exportação (não na entrada); plano linha-a-linha em S3, não DynamoDB; **Fase 2b concluída, 7/7 clusters ≥9,0** |
| `roadmap-evolution/10-phase3-scoring-and-roadmap.md` | informativo (síntese proposta, não autorização de implementação) | Fase 3: executive summary, feature score ponderado, roadmap revisado M9-M13 (milestone-a-milestone, formato completo), dependency graph — consolida os 7 clusters da Fase 2b |
| `roadmap-evolution/11-phase3-impacts-and-closing.md` | informativo (síntese proposta, ADRs formais só com decisão do Marcelo) | Fase 3: domain model antes/depois, impacto de arquitetura/segurança/persistência/custo, lista de 10 ADRs candidatos, estratégia de teste/migração, perguntas abertas reais, capacidades rejeitadas — inclui revisão adversarial final de coerência do pacote completo (nota 8,2/10, achados corrigidos) |
| `roadmap-evolution/12-automated-chasing-capacity-review.md` | verificação de pré-requisito (D-046) | Mini-revisão de capacidade de GSI3 antes de M10 cluster 4 (automated chasing) — pico orgânico ~220× abaixo do SLO de drenagem de pico extremo, GSI3 reaproveitado sem shard/índice novo |
| `roadmap-evolution/13-guest-link-delivery-design.md` | decisão reconciliada via protocolo AGENTS.md §4 (D-047/D-048) | Fecha D-047 — entrega/reenvio do link de guest upload: rotação de token a cada disparo de chasing, sem KMS/secret cifrado persistido; nota final 9,2/9,4 |
| `roadmap-evolution/14-document-request-initial-invite-design.md` | decisão reconciliada via protocolo AGENTS.md §4 (D-049) | Fecha "Decisão B" de D-048 — automatiza o convite inicial de guest upload (hoje manual) atrás de preferência de tenant + kill switch global default `false`; nota final 9,2/9,4 |
| `roadmap-evolution/15-m12-billing-scope-decision.md` | decisão reconciliada via protocolo AGENTS.md §4 (D-052) | Pós-M11: M12 (Billing) fica bloqueado por decisão de produto (fornecedor de pagamento) — zero código novo; achado real de que o projeto não tem conceito de "platform staff" cross-tenant, descartando até a fatia manual de entitlement; nota final 9,3/9,4 |
| `reviews/bff-full-vs-session-design/` | decisão reconciliada via protocolo AGENTS.md §4 (D-053/D-054) | Full BFF como fronteira de sessão do browser — decide o mecanismo de autenticação das chamadas de recurso que o "BFF de sessão" original (D-034) nunca cobriu. D-053 (Claude 9,2/Codex 9,3): browser nunca recebe token OAuth, cookie de sessão opaco, PKCE+`state`. D-054, amendment de auditoria adversarial de 16 pontos (Claude 9,2/Codex 9,4): rotação nativa do Cognito no refresh (não contador local — evita falso-positivo de invalidação), tabela de sessão dedicada IAM-isolada, cookies login/sessão com `SameSite` diferenciado. **Implementado e `APPROVED AS FRONTEND PRODUCTION FOUNDATION`** (`src/modules/bff/`, `infra/modules/bff-*`) — ver `docs/frontend/frontend-production-foundation.md` para o registro completo da implementação e do protocolo Claude↔Codex (Rodada D: 6 passagens, 5 achados bloqueantes reais de segurança de sessão corrigidos) |
| `reviews/` | histórico/evidência de rodada (protocolo `AGENTS.md` §4, pós-M0) | Artefatos de revisão Claude↔Codex de implementação real, por milestone (ex. `reviews/m3.5-runtime-design/`) — mesmo papel de `history/` (evidência, nunca normativo), mas para rodadas ocorridas depois que código passou a existir, em vez das rodadas de design conceitual pré-implementação |
| `history/` | histórico/supersedido | Artefatos de rodada (propostas, críticas, red team) que produziram os documentos normativos acima — ver subseção |

## `history/` — evidência de rodada, por tema

Cada subpasta contém os artefatos de proposta/crítica/tréplica que antecederam o documento normativo correspondente. Nunca tratar como fonte de decisão vigente — só como prova de como o consenso foi alcançado.

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
