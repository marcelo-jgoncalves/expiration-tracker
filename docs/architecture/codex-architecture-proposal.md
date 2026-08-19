# Proposta de Arquitetura — Codex (Fase 3, Rodada 1, Independente)

Status: proposta independente do Codex, produzida sem acesso à proposta do Claude, conforme protocolo da seção 18/21 do prompt mestre.
Base: `docs/architecture/requirements.md` (Fase 1 APPROVED), `docs/architecture/capacity-model.md` (Fase 2 APPROVED).

Princípio central: monólito modular para operações síncronas, com processos assíncronos desacoplados por eventos e filas. Todos os componentes de Stage 0–1 são pay-per-use e escalam a zero; nenhuma capacidade computacional ou de banco fica provisionada.

## 1. Compute e API — API Gateway HTTP API + AWS Lambda
API REST `/v1`, uma única aplicação Lambda inicialmente, dividida internamente em módulos de domínio: Identity/Tenancy, Expiration, Reminder, Notification, Document e Audit. Workers assíncronos usam handlers Lambda separados, compartilhando o mesmo código de domínio.
Justificativa: escala a zero, atende ~1.160 req/s no Stage 5 sem mudança estrutural, evita microsserviços prematuros. Reserved concurrency por função controla custo e noisy neighbors.
Trade-offs: cold starts, limite de duração, risco de "Lambda monolítica" grande — mitigado por bundle enxuto e separação posterior apenas por perfil de escala.
Rejeitados: ECS/EC2 always-on (piso de custo); Kubernetes (complexidade); AppSync (GraphQL sem valor comprovado).
**Type 2** — compute pode migrar por módulo sem mudar contratos.

## 2. Frontend — S3 privado + CloudFront
SPA/PWA estática, Origin Access Control, TLS, cache e deploy imutável por hash. WAF só quando tráfego/ameaça justificar seu custo fixo relativo.
Rejeitados: Amplify Hosting (abstração dispensável); Next.js SSR no MVP (compute adicional sem necessidade comprovada).
**Type 2**.

## 3. Autenticação — Amazon Cognito User Pools
E-mail confirmado, reset seguro, MFA opcional, expiração/revogação, JWT validado no API Gateway; autorização fina permanece no domínio, nunca apenas no token.
Trade-offs: UX/customização e portabilidade medianas.
Rejeitados: auth própria (risco de account takeover); Auth0 (custo/dependência externa inicial).
**Type 2**, desde que IDs internos não sejam o `sub` do Cognito.

## 4. Banco primário — DynamoDB on-demand
Tabela principal com entidades canônicas e `tenantId` obrigatório; GSIs orientados aos acessos de dashboard, vencimentos, ocorrências por horário e idempotência. TransactWrite grava agregado, versão otimista, ocorrência/outbox e auditoria crítica atomicamente. PITR e backups habilitados.
Satisfaz diretamente COST-001: zero capacidade provisionada, cobrança por uso em Stage 0–1.
Trade-offs: access patterns precisam ser antecipados; joins/relatórios ad hoc menos naturais — exportações analíticas futuras via DynamoDB Export → S3/Athena.
Rejeitados: Aurora Serverless v2 (piso de ACU/custo ocioso); RDS (instância permanente); event sourcing (complexidade); DynamoDB provisionado (inadequado no início).
**Type 1** — modelo e índices têm alto custo de reversão.

## 5. Multi-tenant readiness
Todos os registros, chaves, objetos, mensagens, idempotency keys e eventos carregam `tenantId`; `userId` é separado. Day 0: tenant = usuário. Futuro: tenant = Organization, com Membership/RBAC. Prefixo S3 `tenant/{tenantId}/...`; nenhuma consulta sem partição tenant-scoped. Quotas por tenant e testes negativos de isolamento abrangem API, workers, storage, logs e restore.
Rejeitado: adicionar tenancy posteriormente (exigiria migração estrutural, violaria SCALE-004).
**Type 1**.

## 6. Documentos — S3 com quarentena
Upload presigned de minutos para bucket/prefixo de quarentena, limitado por tamanho, MIME declarado e chave de objeto única. Validação por magic bytes e malware scan obrigatório; somente objeto marcado `CLEAN` pode ser copiado/promovido ao storage final. SSE-KMS, Block Public Access, versionamento, lifecycle e exclusão LGPD rastreável.
GuardDuty Malware Protection for S3 é a primeira opção; scanner isolado em tarefa Fargate sob demanda é fallback para formatos/limites não cobertos.
Rejeitados: parser na API e acesso direto ao objeto recém-enviado (documentos não confiáveis).
**Type 2** para scanner; **Type 1** para esquema de ownership/retention.

## 7. Reminder scheduling — buckets temporais em DynamoDB + Lambda + SQS
Cada `ReminderOccurrence` materializada possui UTC, timezone original, versão do item e chave idempotente. Ocorrências particionadas por minuto e shard: `DUE#yyyyMMddHHmm#NN`. Tick EventBridge por minuto invoca produtores Lambda que consultam shards vencidos e enviam lotes ao SQS Standard. Jitter distribui entregas não estritamente pontuais.
No evento extremo, 1M ocorrências já estão materializadas (não criadas no instante). SQS absorve o burst: 1min→16.667/s (~25.000 intents/s); 5min→3.333/s (~5.000 intents/s); 60min→278/s (~417 intents/s). Concorrência produtor/consumidor define o SLO escolhido. Rate limits de provider ficam em filas separadas, não bloqueando drenagem interna. Reconciliação diária segmentada detecta buckets/ocorrências omitidos.
Rejeitados: EventBridge Scheduler por ocorrência (custo/quotas/cancelamento em massa); scans periódicos globais (hot partitions); Step Functions por milhão de timers (custo).
**Type 1**.

## 8. Notification engine — intents e adapters
Fluxo: ReminderTriggered → NotificationIntent → entitlement/quiet-hours/opt-out → filas SQS por canal → adapter → provider → NotificationAttempt/webhook.
SES, Telegram e WhatsApp implementam contrato versionado comum, com contract tests. FIFO não é necessária: SQS Standard + idempotência condicional em DynamoDB fornece at-least-once sem efeito duplicado. Cada canal possui concorrência, token bucket, retry/backoff, DLQ e redrive independentes. Antes de chamar o provider, o worker revalida versão/status do item; se já entregue e tornado obsoleto, cria intent corretiva (FR-014).
Rejeitados: chamadas diretas no request; fila única (propagaria falha/rate limit entre canais).
**Type 1** para contratos; adapters/provedores são **Type 2**.

## 9. AI/OCR — Step Functions Express assíncrona
Pipeline: objeto limpo → Textract/OCR → parser determinístico → LLM somente se necessário → validação de schema → comparação entre extratores → `ExtractedField`.
Provider OCR/LLM atrás de interface versionada. Prompt fixo trata conteúdo como dados, sem ferramentas/URLs/instruções externas. Timeout, erro, tipo desconhecido, confidence inválida/baixa ou divergência produzem `PENDING_CONFIRMATION`; jamais criam/alteram vencimento ou lembrete. Resultado descartado se versão/documento foi removido. Modelo, prompt, custo, provenance e scores auditados.
Rejeitados: LLM-first; escrita direta no item (custo, prompt injection, violação de FR-043).
**Type 1** para o gate fail-closed; provider é **Type 2**.

## 10. Event backbone — EventBridge + DynamoDB outbox/Streams + SQS
EventBridge distribui eventos de domínio versionados; SQS representa trabalho/backpressure/isolamento. Outbox gravada atomicamente e publicada por DynamoDB Streams evita dual-write. Consumidores deduplicam por `eventId`.
Rejeitados: Kafka/MSK e Kinesis (overengineering); SNS isoladamente (menos roteamento/governança de schemas).
**Type 1** para envelopes/event contracts; serviços substituíveis.

## 11. IaC e CI/CD — AWS CDK + GitHub Actions/OIDC
CDK na linguagem da aplicação, stacks por ambiente, 100% dos recursos versionados. Pipeline: lint, unitários (≥90% fluxos críticos), integração, contract/schema compatibility, autorização negativa, scans SAST/dependências/IaC, `cdk diff`, aprovação de produção, deploy canário de aliases Lambda, smoke test, rollback.
Rejeitados: configuração manual; Terraform/OpenTofu (outra linguagem/state sem benefício imediato).
**Type 2**.

## 12. Observabilidade, segurança e custo
CloudWatch Embedded Metrics, logs JSON sem PII, correlation/tenant ID, X-Ray amostrado, dashboards/SLOs (API, reminder lag, oldest-message age, DLQs, entrega, bounce, extração, custo/unidade). Alarmes sintomáticos e runbooks.
IAM por função, KMS, Secrets Manager, CloudTrail, assinatura de webhooks, API throttling/usage quotas, limites por IP/usuário/tenant, reserved concurrency. AWS Budgets 80/100%, Cost Anomaly Detection.
Kill switches auditados em AWS AppConfig para `AI`, `OCR`, `WHATSAPP`, alteráveis sem deploy. Ao desligar: AI fica pendente para revisão; OCR mantém jobs em fila; WhatsApp suspende/redireciona sem marcar entregue. Workers consultam estado antes de cada operação cara, inclusive jobs já enfileirados.
Rejeitados: flags em variáveis de deploy (não atendem COST-004); desligamento bruto de filas (perde controle de trabalhos pendentes).
**Type 1** para controles de segurança/kill-switch; ferramentas de observabilidade são **Type 2**.
