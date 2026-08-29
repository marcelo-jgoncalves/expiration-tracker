---
status: draft
owner: Marcelo
authority: informativo (insumo de análise, não normativo — ver nota de escopo no final)
---

# Evolução Estratégica do Roadmap — Fase 1: Estado real e gap analysis

Origem: `00-mission-brief.md` (movido da raiz em 2026-08-29, originalmente escrito 2026-08-22,
mesma pasta). Este documento é a **Fase 1** de um processo de 3 fases decidido com Marcelo:
(1) auditoria + gap analysis (este documento), (2) pesquisa de mercado + modelagem de domínio +
protocolo Claude↔Codex por tema, (3) roadmap final + ADRs. Fases 2-3 ainda não começaram.

Metodologia: 7 investigações factuais paralelas (código real, não documentação) sobre
`src/modules/{identity,expiration,reminder,notification,document}`, `infra/`, `test/`,
`.github/workflows/`, `docs/architecture/{requirements,data-model,capacity-model,privacy-lgpd,
cost-model,evolution,mcp-readiness}.md`, os 10 ADRs, e o design aprovado de M7. Toda afirmação
abaixo tem base em citação `arquivo:linha` real (evidência completa nos transcripts dos
subagentes desta sessão) — nenhuma classificação é inferência sem leitura de código.

## A. Estado real do roadmap (milestones)

Nomenclatura real pós-renumeração de 2026-08-22 (`implementation-blueprint.md §19`): os títulos
escritos como "M5"/"M6"/"M7" no blueprint original **não foram reescritos** e correspondem hoje a
M6/M7/M8 reais.

| Milestone | Objetivo | Estado real | Implementado | Faltante | Dependências | Observações |
|---|---|---|---|---|---|---|
| M0 | Guardrails e contratos | **Concluído** | Schemas, logger/redactor, config, erros, idempotência, OCC, outbox, supply-chain | — | — | Base de todo o resto |
| M1 | Foundation, Identity, isolamento | **Concluído** | Cognito, resolver central, matriz de autorização, quotas, `ScopedLambdaFunction` | Membership real (só `OWNER` é atribuído; `MEMBER`/`VIEWER` existem na matriz mas nunca usados) | M0 | `tenantId=userId` é decisão MVP explícita, não bug |
| M2 | Expiration core e Audit | **Concluído** | CRUD/renew, dashboard GSI1, audit append-only | — | M1 | `ExpirationItem` é schema fixo, sem custom fields |
| M3 | Reminder Engine | **Concluído** | Policies, GSI3, producer/dispatch/reconciliação DST-safe | Múltiplos destinatários, digest, watchers | M2 | 1 destinatário por reminder hoje (`assigneeUserId?`) |
| M3.5 | Runtime real (Lambda handlers) | **Concluído** (inserção ad hoc) | Handlers reais, outbox+relay SQS/DLQ, EventBridge Scheduler | — | M3 | — |
| M4 | Notification Engine | **Concluído** (1 pendência externa) | Router, preferências, quiet hours, SES real | Digest, canais além de e-mail (WhatsApp parcialmente scaffolded) | M3, M1 | Spike de validação de tags SES em sandbox ainda bloqueado externamente |
| M5 | Observabilidade | **Concluído** (inserção ad hoc, fora do blueprint original) | `correlationId`/ADOT/X-Ray, alerta SNS→e-mail | — | M1-M4 | Renumeração real: este M5 não é o "M5" do blueprint original |
| M6 real | Document upload e malware boundary | **Concluído, deployado e verificado em produção real** | Presigned upload, quarentena S3, GuardDuty, promoção CLEAN, exclusão segura | Guest/terceiro sem conta (não existe caminho anônimo) | M1, M2, M0 | `Document` sempre exige `itemId` já existente — não há "documento solto" |
| M7 real | Extraction e confirmação | **Design aprovado (Claude 9,2/Codex 9,3), implementação não iniciada** | — (só design) | Tudo | M6 real, M2 | Fluxo sempre ancora em `ExpirationItem` já existente; nunca origina item novo |
| M8 real | Hardening operacional | **Não iniciado, nem design** | — | Tudo (SLOs, chaos, WAF, auditoria IAM) | M1-M6 real | — |
| (fora da sequência numerada) | Trilha de auditoria de segurança | **Concluído, deployado, verificado** | Eventos de negação/GSI, 3 alarmes | — | M5 | Achado de rodada de auditoria, não milestone numerado |
| (fora da sequência numerada) | Mecanismo de rollback | **Concluído, deployado, exercitado ponta a ponta** | Alias `live`+versão, manifesto S3, `rollback.yml` | Canários semânticos (entrega 2, futuro) | — | Genérico — toda Lambda nova herda automaticamente |
| M9-M12 (propostos no prompt estratégico) | TrackedSubject/Requirement/ExternalContact, chasing, Organization/RBAC/Billing | **Não decidido — objeto da Fase 2+** | — | Tudo | A determinar | Ver seção C e achados transversais |

## B. Classificação de cada capacidade proposta

| # | Capacidade | Classificação | Evidência-chave |
|---|---|---|---|
| 8 | `TrackedSubject` | **NÃO CONTEMPLADA** | Zero entidade entre tenant e `ExpirationItem`; zero menção em `data-model.md`/`requirements.md`; `ExpirationItem.tenantId` aponta direto ao tenant |
| 9 | `Requirement`/`RequirementTemplate`/`RequirementAssignment` | **NÃO CONTEMPLADA** | Zero menção nos 7 docs normativos lidos; estado `MISSING` não tem equivalente (schema de `ExpirationItem` é fixo, sempre pressupõe item já existente) |
| 10 | Templates verticais | **NÃO CONTEMPLADA** | Nenhum mecanismo de config/template reutilizável em nenhum módulo |
| 11 | `ExternalContact` | **NÃO CONTEMPLADA** | `privacy-lgpd.md` só modela titular=usuário do sistema; "fornecedor" no doc de privacidade é subprocessador técnico (AWS/IA), sentido totalmente distinto |
| 12 | `DocumentRequest` | **NÃO CONTEMPLADA** | Nenhum port/domain object equivalente; nenhum token de convite/solicitação existe |
| 13 | Guest upload / magic link | **NÃO CONTEMPLADA, requer capability nova** | API Gateway não tem NENHUMA rota sem JWT hoje (`infra/modules/api-gateway/main.tf`, todas as rotas checadas); `reserveUpload` exige usuário autenticado do tenant; pipeline pós-upload (quarentena→GuardDuty→promoção) é 100% reaproveitável e agnóstico a quem iniciou |
| 14 | `DocumentSubmission` | **NÃO CONTEMPLADA** | `Document.itemId` é campo obrigatório (`document.ts:34`) — impossível hoje "documento chega antes do item existir" |
| 15 | Integração com M6 | **Pipeline pós-upload reaproveitável; camada de autorização é nova** | Isolamento multi-tenant depende só de como a quarantine key é gerada, não de quem chamou — propriedade preservável num fluxo de convidado |
| 16 | Integração com M7/OCR | **Design atual sempre ancora em item existente** | Rota de confirmação (`.../extractions/{runId}/.../confirm`) tem `itemId` como path param, nunca cria item; ajuste seria necessário para fluxo "documento origina item novo" |
| 17 | Automated Document Chasing | **PARCIAL — mecânica reaproveitável, domínio precisa de extensão** | Producer/dispatch/reconciliação (OCC+outbox, DST-safe) são agnósticos ao domínio; MAS resolução de destinatário hoje só busca `TENANT#USER` (nunca contato externo) e o template é hardcoded para "seu item vence", não "envie documento" |
| 18 | Escalation / múltiplos recipients | **NÃO CONTEMPLADA** | Exatamente 1 destinatário (`assigneeUserId?: string`, singular, confirmado em `expiration-item.ts` e `notification-intent.ts`); zero fan-out |
| 19 | Watchers | **NÃO CONTEMPLADA** | Zero campo/tipo em qualquer módulo |
| 20 | Digest | **NÃO CONTEMPLADA** | 100% imediato; `quietHours` só atrasa dentro do mesmo dia, não agrega |
| 21 | Importação CSV/XLSX | **NÃO CONTEMPLADA** | Zero script/scaffolding em `package.json`; nenhum código de parsing/mapeamento |
| 22 | Exportação | **NÃO CONTEMPLADA** | idem |
| 23 | Custom fields | **NÃO CONTEMPLADA** | `ExpirationItem` é schema fixo; zero `FieldDefinition`/`FieldValue` |
| 24 | Organization/Membership/RBAC | **PLANEJADA (readiness formal), não implementada** | `ADR-0002` fixou `tenantId` em toda chave desde o Day 0 justamente para isso; `requirements.md` FR-005/FUT-001; `evolution.md` já tem gatilho formal ("primeira venda B2B exigindo múltiplos usuários por conta") com plano de migração de 3 fases (dual-write→backfill→cutover) e gate G5 — nunca disparado |
| 25 | Dashboard de compliance | **NÃO CONTEMPLADA** | Sem frontend; sem `TrackedSubject`/`Requirement` para agregar |
| 26 | Bulk operations | **NÃO CONTEMPLADA** | — |
| 27 | Histórico/audit log | **Já existe o mecanismo genérico** | `AuditEvent` append-only já implementado em M2; extensível a eventos novos sem rearquitetura |
| 28 | Billing | **NÃO CONTEMPLADA como componente; lacuna já registrada formalmente** | `cost-model.md` só modela custo de infra; `evolution.md:13` já registra explicitamente que o custo de habilitar Organization "depende de modelo de billing ainda não definido" — não é drift, é lacuna conhecida |
| 29 | Entitlements | **NÃO CONTEMPLADA (só menção conceitual)** | `requirements.md` COST-006 exige que regra comercial fique fora do adapter, mas nenhuma camada de entitlement existe |
| 30 | WhatsApp | **PARCIALMENTE IMPLEMENTADA** | Enum `NotificationChannel` já inclui `WHATSAPP`; router já modela `CHANNEL_UNAVAILABLE`; AppConfig kill switch já reserva a chave `WHATSAPP`; falta só port+adapter dedicado — `SUPPORTED_CHANNELS = ["EMAIL"]` |
| 31 | Entrada por e-mail | **NÃO CONTEMPLADA** | — |
| 32 | API/Webhooks | **NÃO CONTEMPLADA** | Nenhuma rota pública/sem-auth em todo `api-gateway` |

## C. Achados estruturais transversais (afetam múltiplas capacidades, não amarrados a uma só)

1. **Nenhuma rota pública/sem-auth existe hoje** (`infra/modules/api-gateway/main.tf`) — bloqueio de
   infra real para guest upload, webhook de billing, ou qualquer entrada não-JWT. Qualquer uma
   dessas capacidades precisa de um padrão de autorização novo (token validado na aplicação), não
   coberto pelo authorizer atual.
2. `evolution.md` **já tem** o gatilho e o plano de migração de 3 fases para Organization/
   Membership — não é uma decisão nova a desenhar do zero, é destravar algo já projetado.
3. **Feature-flags/AppConfig não existe em Terraform ainda** — é só design aprovado (M7, nunca
   implementado). Qualquer toggle novo (`GUEST_UPLOAD`, `CSV_IMPORT`) depende desse módulo existir
   primeiro. O schema já é genérico o suficiente (objeto JSON plano) para não exigir redesenho.
4. **GSI novo não é plugin point genérico** — a tabela hoje hardcoda GSI1-GSI6; adicionar GSI7
   é edição direta do módulo `dynamo-table`, nível 5 da escala de risco por definição.
5. Reminder Engine (producer/dispatch/reconciliação) é **domain-agnostic na mecânica** (OCC+outbox,
   DST-safe) mas **domain-specific na resolução de destinatário e no template** — chasing reaproveita
   a mecânica, não o domínio inteiro.
6. `Document`/M7 sempre exigem `ExpirationItem` pai já existente — o caso "requisito ausente, sem
   item ainda" (estado `MISSING` do prompt estratégico) não tem caminho hoje em nenhum dos dois
   módulos.
7. Rate limiting hoje é só por tenant autenticado (`TenantQuotaService`) — não há limite por
   token/convite/IP, lacuna real para qualquer fluxo de acesso de terceiro.

## Nota de escopo e limitação

Este documento é **insumo de análise, não decisão** — nenhuma arquitetura nova foi decidida aqui.
Pesquisa de mercado externa, scoring ponderado de features, modelagem de domínio (nomes de
entidade, agregados, ADRs) e as rodadas do protocolo Claude↔Codex por tema ficam para a Fase 2+,
conforme decidido com Marcelo em 2026-08-23. Este documento não deve ser tratado como normativo por
sessões futuras — é ponto de partida factual para a Fase 2, e será supersedido pelos entregáveis de
domínio/roadmap quando produzidos.
