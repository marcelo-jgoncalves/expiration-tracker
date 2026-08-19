> **Status: histórico/supersedido.** Artefato de rodada do processo Claude↔Codex; não é normativo. Documento sucessor: `../../architecture-fase3-consolidada.md`.

# Proposta de Arquitetura — Claude (Fase 3, Rodada 1, Independente)

Status: proposta independente do Claude, **antes** de ver a proposta do Codex, conforme protocolo da seção 18/21 do prompt mestre.
Base: `docs/architecture/requirements.md` (Fase 1 APPROVED), `docs/architecture/capacity-model.md` (Fase 2 APPROVED), `docs/architecture/quality-criteria.md`, `docs/architecture/fitness-function.md`.

## Princípios que guiaram as escolhas
- Serverless-first, pay-per-use, idle ≈ 0 no Stage 0–1 (COST-001).
- Monólito modular serverless — não microsserviços, não Kubernetes, não event sourcing (CON-002).
- Toda escolha justificada por um requisito ou métrica de `capacity-model.md`, não por preferência.
- Nenhum serviço escolhido "porque é óbvio" — cada decisão abaixo é Type 1 (cara/difícil de reverter) ou Type 2 (fácil de reverter), classificado explicitamente.

---

## 1. Compute — AWS Lambda

**Decisão**: AWS Lambda (Node.js/TypeScript) para toda a lógica de aplicação, organizada como **monólito modular** (um único deployable lógico com módulos internos por domínio: Items, Reminders, Notifications, Documents, Extraction, Audit), não uma função por endpoint nem microsserviços separados por domínio.

**Justificativa**: COST-001 exige custo idle ≈ 0 no Stage 0–1; Lambda cobra por invocação, não por capacidade provisionada. O volume do capacity model (Stage 1: ~2.000 requests/dia) está muito abaixo do necessário para justificar compute always-on. Mesmo no Stage 5 (~1.160 RPS de pico), Lambda com concorrência reservada/provisionada seletiva atende sem redesenho estrutural (SCALE-001).

**Type**: Type 1 (migrar de Lambda para ECS/Fargate depois é possível mas caro — decisão de fundação).

**Rejeitado**: ECS/Fargate always-on (viola CON-002 e COST-001 nos estágios iniciais); Kubernetes (viola CON-002 explicitamente).

---

## 2. Frontend

**Decisão**: SPA/SSG (Next.js em modo estático ou híbrido) servido via **S3 + CloudFront**, com chamadas à API separada (não SSR em Lambda para todas as rotas, para manter custo mínimo e cache máximo no CDN).

**Justificativa**: dashboard e telas de CRUD não exigem SSR pesado; CloudFront cacheia assets estáticos a custo desprezível mesmo em Stage 5. Rotas que precisam de dado dinâmico (dashboard, lista de itens) chamam a API via client-side fetch.

**Type**: Type 2 (front-end é o componente mais barato de trocar).

---

## 3. API — Amazon API Gateway (HTTP API) + Lambda

**Decisão**: API Gateway HTTP API (não REST API — mais barato, latência menor) na frente das funções Lambda do monólito modular.

**Justificativa**: suporta rate limiting nativo (COST-005), autenticação via JWT authorizer, throttling por usage plan (COST-005/G6), integração nativa com WAF (SEC-*).

**Type**: Type 2.

---

## 4. Autenticação/Autorização — Amazon Cognito

**Decisão**: Cognito User Pools para autenticação (FR-001..004), com JWT validado no API Gateway authorizer; autorização fina (escopo por item/documento) verificada dentro de cada handler Lambda por requisição (SEC-007), nunca só por posse de token.

**Justificativa**: evita construir e manter fluxo de senha/reset/MFA à mão (reduz superfície de ataque, SEC-001); nativo AWS, sem custo fixo relevante em baixa escala.

**Type**: Type 1 (migrar de Cognito é doloroso — decisão de fundação, mas isolada atrás de uma camada de auth no backend para mitigar lock-in).

**Risco registrado**: Cognito tem limitações conhecidas de customização de fluxo — a validar em ADR dedicado na Fase 3 completa, comparando com Auth0/Ory como alternativas.

---

## 5. Banco de dados primário — DynamoDB (single-table design)

**Decisão**: DynamoDB como armazenamento primário de Items, ReminderPolicy/Occurrence, NotificationIntent/Attempt, Channel config, com padrão single-table e GSIs para os padrões de acesso conhecidos (por usuário, por data de vencimento/bucket, por status).

**Justificativa central**: COST-001 exige idle ≈ 0 — Aurora Serverless v2 tem piso de capacidade (ACU mínimo) mesmo parado, o que viola o gate de custo no Stage 0–1. DynamoDB on-demand não tem esse piso. O padrão de acesso do domínio (buscar itens por usuário, buscar lembretes por dia/hora de vencimento) é bem conhecido e cabe em single-table design com GSIs — não há necessidade de JOINs complexos ad-hoc.

**Reminder scheduling sobre DynamoDB**: GSI com chave de partição `due_date_bucket` (ex.: `YYYY-MM-DD#HH`) permite que um scheduler periódico (seção 8 abaixo) faça query eficiente dos lembretes devidos na janela corrente, sem escanear a tabela inteira — isto é o que torna o cenário de pico extremo (1M no mesmo horário, `capacity-model.md`) tratável: o bucket já os agrupa, e o fan-out para SQS é feito em lote.

**Auditoria**: tabela separada (append-only), mesma engine, TTL não aplicado (retenção via política de PRIV-004), export periódico para S3/Athena se análise ad-hoc for necessária no futuro (não implementado agora).

**Type**: Type 1 (modelo de dados é a decisão mais cara de reverter no projeto inteiro).

**Rejeitado**: Aurora Serverless v2 (viola COST-001 pelo piso de custo; JOINs complexos não são um requisito comprovado — FR/NFR não exigem relatórios ad-hoc sofisticados no MVP); RDS Postgres provisionado (viola COST-001 diretamente — always-on).

**Risco registrado**: se, na Fase 3 completa, surgir requisito real de relatórios analíticos ad-hoc complexos (não coberto hoje em FR-050..053), reavaliar Aurora Serverless v2 ou exportação para um data warehouse — não redesenhar prematuramente agora (seção 51, evolução por estágio).

---

## 6. Armazenamento de documentos — S3

**Decisão**: bucket S3 privado, upload via presigned URL (SEC-005, expiração de minutos), versionamento habilitado, criptografia SSE-KMS com CMK dedicada (SEC-003a), Object Lock não habilitado no MVP (sem requisito de imutabilidade legal comprovado), lifecycle rules por classe de storage a partir de N dias (custo).

**Antimalware**: Lambda trigger em `s3:ObjectCreated`, chamando Amazon GuardDuty Malware Protection for S3 (nativo AWS, evita operar ClamAV própria) antes de o documento ficar disponível para OCR/usuário; documento fica em estado `PENDING_SCAN` até resultado (consistente com SEC-003, sem exceção silenciosa).

**Type**: Type 1 (estrutura de bucket/chave é cara de migrar depois de milhões de objetos).

---

## 7. Event backbone — Amazon EventBridge

**Decisão**: EventBridge (bus customizado) para eventos de domínio entre módulos do monólito modular (ex.: `ItemCreated`, `DocumentUploaded`, `ExtractionCompleted`, `ItemDueDateChanged`) — desacopla módulos sem exigir microsserviços separados.

**Justificativa**: permite que FR-014 (cancelar notificação obsoleta quando data muda) seja implementado como reação a evento, não como acoplamento direto de código entre módulos de Item e Notification.

**Type**: Type 2 (padrão de evento é reversível; implementação interna pode trocar de EventBridge para SNS sem redesenho de domínio, graças à abstração de Channel Adapter já exigida por FR-033/NFR-021).

---

## 8. Reminder Engine — scheduler periódico + SQS

**Decisão**: **não** usar EventBridge Scheduler por item individual (criar/cancelar um schedule por lembrete não escala bem para 24M+ gatilhos configurados no Stage 5, e a exclusão em massa por mudança de data — FR-014 — exigiria deletar schedules individualmente). Em vez disso:
1. Lambda "Reminder Scanner" roda em cron curto (ex.: a cada 5 min via EventBridge rule) e faz query no GSI `due_date_bucket` do DynamoDB pelos lembretes devidos na janela.
2. Lembretes devidos são publicados em lote numa fila SQS (`reminder-due-queue`).
3. Lambda "Reminder Dispatcher" consome a fila com concorrência controlada, gera `NotificationIntent` por canal configurado (fan-out FR-033), idempotente por `reminder_occurrence_id` (NFR-002).
4. DLQ com alarme (NFR-003) para falhas de dispatch; redrive manual/automático a definir em ADR.

**Justificativa direta do capacity model**: o cenário de pico extremo (`capacity-model.md`, 1M no mesmo horário) é absorvido pelo bucket + fila, não por milhões de schedules individuais — throughput de fila SQS + Lambda concorrente escala para os cenários de drenagem de 1/5/60 min modelados.

**Type**: Type 1 (é o coração do produto — mudar de abordagem depois é caro).

---

## 9. Notification Engine — SQS + Lambda por Channel Adapter

**Decisão**: uma fila SQS por canal (`email-queue`, `telegram-queue`, `whatsapp-queue`), cada uma consumida por uma Lambda "Channel Adapter" que implementa uma interface comum (`send(NotificationIntent) -> DeliveryResult`), conforme FR-033. Provedores:
- **E-mail**: Amazon SES (nativo, custo baixo, DKIM/SPF/DMARC gerenciável).
- **Telegram**: chamada HTTPS direta à Bot API a partir da Lambda adapter.
- **WhatsApp**: WhatsApp Business API (via provedor BSP a escolher em ADR dedicado — não decidido aqui, pesquisa de pricing pendente conforme UNK-003).

**Contract test (FR-033)**: cada adapter implementado contra a mesma interface TypeScript, testado com um harness de contrato compartilhado — permite trocar provedor de e-mail (ex.: SES → outro) sem tocar no domínio.

**Type**: Type 2 (adapters são desenhados para serem substituíveis por definição).

---

## 10. AI/OCR — Amazon Textract + Amazon Bedrock

**Decisão**: pipeline determinístico primeiro (Textract para OCR/forms), fallback para LLM (Bedrock, modelo a definir em ADR) apenas quando parsing determinístico não atinge confiança suficiente (FR-042/FR-043) — consistente com "deterministic first, AI when useful" (seção 27).

**Justificativa**: manter tudo dentro da AWS reduz superfície de integração externa e simplifica IAM/observabilidade; Bedrock permite trocar de modelo sem trocar de provedor de infraestrutura (mitiga parcialmente NFR-021, embora não elimine lock-in de nuvem).

**Governança de confiança**: implementação direta de FR-043 — estado `PENDING_CONFIRMATION` gravado no domínio Extraction, nunca aplicado automaticamente ao Item quando abaixo do threshold.

**Type**: Type 1 (pipeline de extração é caro de trocar de arquitetura, mesmo que o modelo individual seja Type 2).

---

## 11. IaC — AWS CDK (TypeScript)

**Decisão**: AWS CDK em TypeScript, mesmo idioma do backend Lambda — reduz troca de contexto, tipagem compartilhada entre infra e handlers.

**Type**: Type 2 (IaC é código, migrar para Terraform depois é trabalhoso mas não bloqueia o produto).

---

## 12. CI/CD — GitHub Actions + CDK pipelines

**Decisão**: GitHub Actions executando lint → testes unitários → testes de contrato dos adapters → `cdk diff` → scan de dependências/IaC → deploy automático em ambiente de staging → aprovação manual → deploy em produção (OPS-004).

**Type**: Type 2.

---

## 13. Observabilidade — CloudWatch + X-Ray

**Decisão**: logs estruturados JSON (correlation ID via middleware Lambda Powertools), métricas customizadas via Embedded Metric Format (inclui custo/usuário, extraction confidence), X-Ray para tracing ponta a ponta (API Gateway → Lambda → SQS → Lambda), alarmes CloudWatch por SLO (a definir em `slo.md`).

**Type**: Type 2.

---

## 14. Segurança e controle de custo/abuso

- WAF na frente do API Gateway (rate limiting adicional, proteção contra padrões OWASP comuns).
- Secrets Manager para credenciais de provedores externos (WhatsApp BSP, etc.).
- KMS CMK dedicada para S3 e DynamoDB (SEC-003a).
- IAM por Lambda com least privilege (um role por função/módulo, não um role compartilhado amplo).
- AWS Budgets + Cost Anomaly Detection (COST-003/004).
- Kill switch: flag em SSM Parameter Store, checada no início de toda Lambda que dispara operação cara (chamada Bedrock, envio WhatsApp) — COST-004.
- Usage plans/throttling por tenant no API Gateway (COST-005, preparação para G6 e para skew de tenant, UNK-CAP-011).

---

## 15. Isolamento multi-tenant (readiness, SCALE-004)

Toda chave de partição do DynamoDB é prefixada por `tenant_id` (= `user_id` enquanto Organization não existir); todo IAM/autorização de handler valida `tenant_id` do token contra o registro sendo acessado por requisição (SEC-007), não apenas por posse de sessão. Quando Organization/Membership for habilitado, `tenant_id` passa a apontar para `organization_id`, sem mudança de particionamento física.

---

## 16. Mapeamento explícito para requisitos e capacity model

| Decisão | Requisitos atendidos | Métrica do capacity model que a justifica |
|---|---|---|
| Lambda + monólito modular | NFR-030 (IaC), CON-001/002 | Stage 1: ~2k req/dia não justifica compute always-on |
| DynamoDB single-table | COST-001, SCALE-001 | Stage 0–1 idle≈0; Stage 5: 8M itens, GSI por bucket resolve pico extremo |
| Scanner+SQS (não EventBridge Scheduler por item) | NFR-002, NFR-011 | Cenário de pico extremo (16.667–278 agendamentos/s conforme drenagem) |
| S3 + GuardDuty Malware Protection | SEC-003, SEC-003a | Stage 5: ~61 uploads/min, ~1.667/s no cenário extremo de 1 min |
| SES/Telegram/WhatsApp adapters | FR-030..034, COST-006 | Stage 5: ~200.000 notificações/dia, split e-mail/Telegram/WhatsApp |
| Textract+Bedrock com PENDING_CONFIRMATION | FR-041..044, gate G4 | Stage 5: ~1.584 itens/dia exigindo revisão humana |

---

## Riscos e trade-offs assumidos nesta proposta (a debater com o Codex)
- DynamoDB single-table é rígido a mudanças de padrão de acesso não previstas — aposta calculada em que os padrões de `requirements.md`/`capacity-model.md` são estáveis o suficiente.
- Cognito tem histórico de limitações de customização — mitigado por isolar auth atrás de uma camada própria, mas não elimina o risco.
- Scanner periódico (cron de 5 min) introduz latência mínima de até 5 min entre "devido" e "agendado" — aceitável frente a SLOs ainda não fixados (`slo.md` pendente), mas é uma escolha explícita que compromete "freshness" por simplicidade/custo.
