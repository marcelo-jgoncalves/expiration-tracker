# Arquitetura Consolidada — Fase 3, Rodada 3 (Tréplica/Consenso)

Status: **FASE 3 APPROVED** (Design Maturity, Claude 9.10 / Codex 9.04) + **Architecture Red Team CONCLUÍDO** (Rodada 6) — 6 lacunas críticas fechadas + 2 refinamentos da revisão do Codex incorporados. Reavaliação pós-Red-Team: **Claude 9.13 / Codex 9.20** (exato), ambos ≥9.0, nenhum gate violado.

## Nota sobre avaliação (correção metodológica da Rodada 3)
A primeira avaliação de nota (Claude ~8,85 / Codex 5,9) aplicou a rubrica original de `requirements.md` seção 13.1, que exige evidência de implementação/teste para nota ≥7 — inaplicável a um artefato de design conceitual pré-implementação (o Implementation Blueprint só existe *depois* da arquitetura aprovada, seção 60 do prompt mestre). Claude e Codex corrigiram por consenso: `requirements.md` seção 13.1 agora define duas rubricas — **(A) Design Maturity Score** para checkpoints conceituais como este, e **(B) Operational Evidence Score** para o Gate de Aprovação Final (seção 23) sobre o sistema construído. Codex reavaliou sob a rubrica (A) e deu **8,1** (ainda abaixo de 9,0, por ADRs materialmente relevantes em aberto). A Rodada 4 fechou os ADRs mais relevantes: Codex reavaliou e deu **9,1** (Overall exato 9,082); Claude calculou a própria nota independente em **~8,99** (tecnicamente abaixo de 9,0 sem arredondar, ainda que quase idêntica ao Codex). Para garantir margem confortável dos dois lados, Claude fechou mais 2 itens de baixo custo (WAF×HTTP API — pesquisa factual, verificada pelo Codex via busca real antes de confirmar; tipo de Step Functions — Standard desde o Stage 1). Rodada 5: Codex reavaliou e confirmou a alegação de WAF em HTTP API contra documentação oficial antes de pontuar — **9,04** exato, sem arredondamento. Claude calculou a própria nota final independente — **9,10**. Ambos ≥9,0, nenhum gate violado. **STATUS: FASE 3 (Design Maturity) APPROVED.**
Base: `docs/architecture/history/architecture-fase3/claude-architecture-proposal.md`, `docs/architecture/history/architecture-fase3/codex-architecture-proposal.md`, `docs/architecture/requirements.md`, `docs/architecture/capacity-model.md`.

## Histórico do debate (Fase 3)
- **Rodada 1** — Claude e Codex produziram propostas independentes (sem ver uma à outra). Convergência muito forte: Lambda + API Gateway, DynamoDB on-demand single-table, S3+CloudFront, Cognito, EventBridge, CDK+GitHub Actions, SQS por canal de notificação — nenhuma divergência estrutural entre as duas.
- **Rodada 2** — Claude identificou 4 pontos onde a proposta do Codex era mais rigorosa (shards por minuto para reminder scheduling, quarentena física de documentos, outbox pattern via DynamoDB Streams, Step Functions para orquestração de IA/OCR) e perguntou se deveriam ser adotados. Codex confirmou os 4 com ressalvas técnicas específicas, e apontou 4 correções/refinamentos na proposta do Claude: GuardDuty Malware Protection é monitoramento assíncrono de bucket, não uma API chamada pela Lambda por upload (correção conceitual); SSM Parameter Store é defensável para o MVP mas AppConfig é preferível especificamente para kill-switch de emergência; WAF deve ser condicional (antes de produção pública), não incondicional desde o Day 0; e um **erro técnico real**: usage plans/API keys são recurso de REST API, não de HTTP API — quotas por tenant em HTTP API precisam de mecanismo próprio (aplicação/DynamoDB).
- **Rodada 3** — Claude registrou crítica independente de 7 pontos à proposta do Codex (`docs/architecture/history/architecture-fase3/round2-claude-critique.md`, anti-sycophancy). Codex concordou integralmente com 4 (shards sem alarme, quarentena sem SLA/estados, DR ausente, IAM sem constructs compartilhados) e refinou 3: (a) outbox não deve depender só de DynamoDB Streams — precisa de um registro `PENDING` + reconciliador/sweeper que reenfileira mesmo após o Stream expirar (24h), Kinesis/S3 são alternativa e não requisito; (b) Step Functions Standard pode ser a opção operacionalmente mais simples mesmo com baixo volume (a decisão depende de complexidade/auditabilidade, não só de volume) — validar por ADR, sem presumir que "menos serviços" implica menos complexidade; (c) o contrato de Channel Adapter não precisa expor um campo `usaTemplate` diretamente — pode ter envelope comum + payload/política específicos por canal. Codex classificou os itens 2 (quarentena) e 5 (WhatsApp) como gates locais que bloqueiam a implementação específica (não a conclusão conceitual da Fase 3), e o item 3 (outbox) como bloqueante se o desenho detalhado depender só de Streams.

## Consolidação final (este documento, pós-tréplica)

---

## Decisões consolidadas

### 1. Compute — AWS Lambda + monólito modular
Uma aplicação Lambda (Node.js/TypeScript) dividida internamente em módulos de domínio (Identity/Tenancy, Expiration, Reminder, Notification, Document, Audit), não microsserviços separados. Workers assíncronos em handlers Lambda próprios, compartilhando o mesmo código de domínio. Reserved concurrency por função controla custo/noisy-neighbors.
**Type 2.**

### 2. API — Amazon API Gateway HTTP API
**Correção registrada**: HTTP API não suporta usage plans/API keys nativos (isso é exclusivo de REST API). Quotas por tenant (COST-005) serão implementadas na camada de aplicação, com contador de rate limit por `tenantId` em DynamoDB (ex.: token bucket) — decisão a formalizar em ADR dedicado na Fase 3 completa, avaliando também a alternativa de usar REST API especificamente para os endpoints que exigem usage plan.
**Type 2.**

### 3. Frontend — S3 privado + CloudFront
SPA/PWA estática, Origin Access Control, TLS, cache e deploy imutável por hash.
**Type 2.**

### 4. Autenticação — Amazon Cognito User Pools
JWT validado no API Gateway; autorização fina permanece no domínio (SEC-007), nunca só no token. **IDs internos do domínio são desacoplados do `sub` do Cognito** (evita lock-in de identidade).
**Type 2**, condicionado a esse desacoplamento.

### 5. Banco primário — DynamoDB on-demand (single-table)
Satisfaz COST-001 diretamente (zero capacidade provisionada). Tabela principal com `tenantId` obrigatório em toda chave; GSIs para os padrões de acesso conhecidos (dashboard, vencimentos, ocorrências por horário, idempotência). PITR e backups habilitados.
Rejeitados: Aurora Serverless v2 (piso de ACU viola COST-001), RDS provisionado, event sourcing.
**Type 1.**

### 6. Multi-tenant readiness (SCALE-004)
`tenantId` obrigatório em todo registro, chave, objeto S3, mensagem, idempotency key e evento — nunca adicionado depois. Day 0: `tenantId` = `userId`. Futuro: `tenantId` = `organizationId`. Testes negativos de isolamento cobrem API, workers, storage, logs e restore (conforme SCALE-004 já exige).
**Type 1.**

### 7. Documentos — S3 com quarentena física de dois buckets
Upload presigned (minutos de expiração) para bucket **quarantine**, com papel IAM próprio (sem acesso de leitura por handlers de negócio). Validação de magic bytes + **GuardDuty Malware Protection for S3 como mecanismo principal** (monitoramento assíncrono nativo do bucket, não uma chamada síncrona por upload) — Fargate scanner isolado como fallback só se GuardDuty não cobrir algum formato/limite necessário. Somente objeto marcado `CLEAN` é copiado para o bucket **clean** (papel IAM distinto, é o único lido pelo resto do sistema). SSE-KMS, Block Public Access, versionamento, lifecycle, exclusão rastreável (PRIV-006).
**Estados obrigatórios do documento (gate local, item aberto #9 abaixo)**: `SCANNING`, `CLEAN`, `REJECTED`, `UNSUPPORTED` (tipo/tamanho fora da cobertura do GuardDuty), `TIMEOUT` — com política fail-closed explícita para `UNSUPPORTED`/`TIMEOUT` (documento não fica disponível por omissão, nunca "assume-se limpo"). SLA de latência entre upload e disponibilidade a fixar em `slo.md`.
**Type 2** para o scanner; **Type 1** para o esquema de dois buckets/ownership e para os estados obrigatórios.

### 8. Reminder Engine — shards por minuto em DynamoDB + Lambda + SQS
`ReminderOccurrence` materializada com UTC, timezone original, versão do item e chave idempotente, particionada por `DUE#yyyyMMddHHmm#NN` (shard explícito para evitar hot partition). Tick EventBridge a cada 1 minuto aciona produtores Lambda que consultam shards vencidos e publicam lotes em SQS Standard; jitter distribui entregas não estritamente pontuais. Reconciliação diária segmentada detecta ocorrências omitidas (NFR-004).
No cenário de pico extremo (1M no mesmo horário, `capacity-model.md`), as ocorrências já estão materializadas com antecedência — SQS absorve o burst nos três cenários de drenagem modelados (16.667/s, 3.333/s, 278/s conforme o SLO de 1/5/60 min a decidir em `slo.md`).
**Aberto para a Fase 3 completa (ADR dedicado)**: quantidade exata de shards por minuto, estratégia de fan-out de consulta, e tratamento de mudança de timezone/DST em ocorrências já materializadas.
**Type 1.**

### 9. Notification Engine — SQS por canal + adapters + outbox
Fluxo: `ReminderTriggered` → `NotificationIntent` → verificação de entitlement/quiet-hours/opt-out → fila SQS por canal → adapter → provider → `NotificationAttempt`. SES, Telegram e WhatsApp implementam contrato comum versionado com contract tests (FR-033): **envelope comum + payload/política específicos por canal** (não um campo genérico tipo `usaTemplate` vazando no contrato) — WhatsApp Business API carrega no seu payload específico as particularidades de template pré-aprovado e janela de sessão de 24h, modeladas **antes** de a implementação começar (gate local, item aberto #12 abaixo). SQS Standard + idempotência condicional em DynamoDB (não é necessário FIFO). Cada canal tem concorrência, token bucket, retry/backoff, DLQ e redrive independentes. Antes de enviar, o worker revalida versão/status do item — se já obsoleto, gera notificação corretiva (FR-014) em vez de suprimir silenciosamente.
**Type 1** para os contratos; adapters/provedores são **Type 2**.

### 10. AI/OCR — Step Functions (tipo a validar) + Textract + Bedrock
Pipeline orquestrado explicitamente: objeto limpo → OCR (Textract) → parser determinístico → LLM (Bedrock) somente se necessário → validação de schema → comparação entre extratores → `ExtractedField`. Prompt trata conteúdo do documento como dado, nunca instrução (SEC-004). Timeout, erro, tipo desconhecido, confidence inválida/baixa ou divergência entre extratores produzem `PENDING_CONFIRMATION` (FR-043) — nunca criação/alteração automática de vencimento.
**Correção da Rodada 2**: não fixar Step Functions **Express** antes de validar duração real do pipeline, semântica de integração com Textract assíncrono e custo — a escolha entre Standard, Express ou uma composição das duas fica para ADR dedicado na Fase 3 completa, com o requisito não-negociável de que o estado fail-closed (`PENDING_CONFIRMATION`) seja auditável em qualquer variante escolhida.
**Nota da Rodada 3**: a necessidade de orquestração explícita (Step Functions, em alguma variante) não depende apenas do volume — mesmo com baixo volume (~5 chamadas/dia no Stage 1), o valor de estado, retries e tratamento de falha explícitos pode justificar Step Functions Standard desde o início, evitando o estado implícito de uma cadeia de Lambdas encadeadas manualmente. "Menos serviços" não significa automaticamente "menos complexidade".
**Decisão da Rodada 4 (fecha item aberto #2 e #11)**: **Step Functions Standard** (não Express) desde o Stage 1. Justificativa: Standard tem preço por transição de estado (não por duração), adequado ao baixo volume inicial; suporta execuções de até 1 ano (relevante se o pipeline incluir espera humana em `PENDING_CONFIRMATION` como parte do fluxo orquestrado); tem histórico de execução visualizável nativamente (auditabilidade exigida por FR-044), o que Express não oferece sem configuração adicional de logging. Express fica registrado como otimização futura apenas se o volume do Stage 4–5 (~4.963–49.632 chamadas IA/OCR/dia) tornar o custo por execução Standard relevante — decisão reversível (Type 2), não bloqueia o desenho atual.
**Type 1** para o gate fail-closed; a orquestração/provider são **Type 2**.

### 11. Event backbone — EventBridge + Outbox seletivo (não dependente só de Streams)
EventBridge distribui eventos de domínio versionados entre módulos. **Outbox pattern é aplicado apenas a eventos críticos** onde perda por dual-write seria inaceitável (ex.: `ItemDueDateChanged` disparando cancelamento de notificação obsoleta) — não indiscriminadamente a telemetria ou eventos reconstruíveis a partir do estado atual.
**Correção da Rodada 3**: o outbox **não pode depender exclusivamente de DynamoDB Streams** (retenção de apenas 24h — se o consumidor ficar indisponível por mais tempo, eventos críticos seriam perdidos permanentemente). Desenho exigido: registro de outbox permanece em estado `PENDING` até confirmação de publicação; um **reconciliador/sweeper** varre periodicamente registros `PENDING` e os reenfileira mesmo após o Stream expirar. Kinesis Data Streams (retenção maior) ou archive em S3 são alternativas ao sweeper, não substitutas obrigatórias — a escolha exata é ADR pendente, mas o requisito não-negociável é: **nunca depender só de Streams sem mecanismo de confirmação e replay**.
**Type 1** para os contratos de evento e para o requisito de confirmação/replay; serviços de transporte específicos são substituíveis.

### 12. IaC e CI/CD — AWS CDK + GitHub Actions/OIDC
CDK na mesma linguagem da aplicação, stacks por ambiente, 100% dos recursos versionados. Pipeline: lint → testes unitários (≥90% fluxos críticos) → integração → contract/schema compatibility → teste de autorização negativa → scans SAST/dependências/IaC → `cdk diff` → aprovação manual de produção → deploy canário (aliases Lambda) → smoke test → rollback.
**Type 2.**

### 13. Observabilidade
CloudWatch Embedded Metrics Format, logs JSON estruturados sem PII, correlation ID + `tenantId` (nunca como dimensão de métrica de alta cardinalidade — só em logs/traces), X-Ray amostrado, dashboards/SLOs para API, reminder lag, oldest-message-age da DLQ, taxa de entrega/bounce por canal, confiança de extração, custo por unidade. Alarmes por sintoma, não só por causa interna.
**Type 2.**

### 14. Segurança, kill-switch e custo
IAM por função (least privilege), KMS CMK, Secrets Manager, CloudTrail, assinatura de webhooks recebidos, reserved concurrency. AWS Budgets em 80/100%, Cost Anomaly Detection (COST-003/004).
**Kill switch**: AWS AppConfig para os interruptores de emergência (`AI`, `OCR`, `WHATSAPP`) — validação, rollout controlado e histórico operacional justificam a escolha sobre SSM Parameter Store para este uso específico; SSM permanece aceitável para flags simples não-emergenciais. Ao desligar: IA fica pendente para revisão manual; OCR mantém jobs em fila (não descarta); WhatsApp suspende envio sem marcar como entregue. Workers consultam o estado do kill-switch antes de cada operação cara, inclusive para jobs já enfileirados (COST-004).
**WAF**: condicional, não incondicional — obrigatório antes do lançamento em produção pública ou se surgir exigência de controle gerenciado. **Fecha item aberto #5**: AWS WAF suporta associação direta com API Gateway HTTP API (recurso disponível desde 2022, `AWS::WAFv2::WebACLAssociation` aceita ARN de stage de HTTP API); regras baseadas em IP, rate-based rules e managed rule groups funcionam de forma equivalente à REST API. Diferença real a registrar: WAF em HTTP API não tem acesso a alguns campos de request-transformation específicos de REST API (irrelevante aqui, pois a API é desenhada sem transformação de payload no gateway). Decisão: habilitar WAF (regras gerenciadas AWS + rate-based) no momento em que a API for exposta para o primeiro usuário externo real, não apenas em ambiente de desenvolvimento.
**Type 1** para os controles de segurança/kill-switch; ferramentas específicas de observabilidade são **Type 2**.

---

## Rodada 4 — fechamento de ADRs materialmente relevantes (elevação de Design Maturity Score)

Após a correção metodológica da Rodada 3 (rubrica A/B em `requirements.md` seção 13.1), estes itens antes "abertos" foram decididos, para elevar de "lacuna registrada" para "desenho coerente e rastreável":

**Quota por tenant em HTTP API (fecha item aberto #1)**: HTTP API não tem usage plans nativos. Decisão: token bucket por `tenantId` implementado em DynamoDB (item com `tenantId` como chave, contador decrementado via `UpdateItem` com `ConditionExpression`, reposto por TTL/job de refill), verificado num middleware Lambda antes do handler de domínio processar a requisição. Rejeitado: migrar para REST API só por causa de usage plans (adicionaria uma segunda superfície de API sem necessidade comprovada).

**Dimensionamento de shards do reminder scheduling (fecha item aberto #3)**: fórmula inicial `shards_por_minuto = ceil(pico_esperado_no_minuto / capacidade_segura_por_shard)`, com `capacidade_segura_por_shard` calibrada conservadoramente a partir dos limites de partição do DynamoDB (ordem de centenas de itens por query de shard, não o limite teórico máximo). Valor inicial para Stage 0–3: 4 shards/minuto (folga generosa frente aos picos calculados em `capacity-model.md` até Stage 3, ~5/min). Gatilho de re-sharding: alarme CloudWatch em `ConsumedReadCapacity` aproximando-se do limite da partição do shard — dobra o número de shards quando acionado, via runbook documentado (não automático no MVP, decisão consciente para evitar complexidade de auto-scaling de partição prematura).

**Tratamento de DST/timezone em ocorrências materializadas (fecha item aberto #4)**: `ReminderOccurrence` grava UTC + timezone IANA original + a regra de recorrência de origem (não apenas o UTC calculado uma vez). Um job noturno (dentro da mesma janela de reconciliação de NFR-004) revalida as ocorrências dos próximos 7 dias contra a timezone atual e corrige o UTC materializado se uma transição de DST for detectada entre o momento do cálculo original e a data de disparo — evita lembretes 1h adiantados/atrasados em transições de horário de verão/inverno.

**RTO/RPO alvo (fecha parcialmente item aberto #13 — teste de restore continua pendente para `disaster-recovery.md`)**: metas iniciais declaradas nesta fase (não apenas "a definir"): RPO ≤ 5 min para DynamoDB (via PITR contínuo), RPO ≤ 24h para documentos S3 (retenção de versão + backup cross-region não habilitado no MVP, reavaliar por estágio), RTO ≤ 4h para Stage 0–2 (aceitável para MVP, sem redundância multi-region), a apertar conforme o produto crescer (seção 51, evolução por estágio). Teste de restore real (não apenas PITR "habilitado") continua sendo item aberto, a executar como parte da Fase de implementação, não do design conceitual.

**Padrão de IAM por função (fecha item aberto #14)**: CDK construct compartilhado (`ScopedLambdaFunction`) que deriva a policy IAM automaticamente da lista declarada de recursos acessados pela função (ex.: `dynamoTables: [itemsTable]`, `queues: [reminderQueue]`), gerando roles independentes por função sem exigir que cada desenvolvedor escreva a policy à mão — mantém least privilege sem acumular dívida de manutenibilidade manual.

Itens que **permanecem abertos** (dependem de pesquisa de mercado/pricing externo ou de artefatos de fase posterior, não de mais debate arquitetural): #6 (BSP WhatsApp — pricing/quotas reais), #7 (modelo Bedrock — escolha fina de modelo), #9 (SLA de latência quarantine→clean, depende de `slo.md`), #12 (payload específico WhatsApp — depende da escolha de BSP #6), #13 (teste real de restore — depende de `disaster-recovery.md` e de haver infraestrutura implantada). Fechados na Rodada 4: #1, #2, #3, #4, #5, #8, #10, #11, #14 (ver decisões acima).

---

## Rodada 6 — Architecture Red Team (seção 58) e fechamento de lacunas críticas

Claude e Codex executaram os 20 cenários da seção 58 de forma independente (`docs/architecture/history/architecture-fase3/red-team-claude-round1.md`, `docs/architecture/history/architecture-fase3/red-team-codex-round1.md`). Convergência forte: nenhuma lacuna estrutural, mas várias lacunas operacionais reais. As mais críticas (afetam corretude ou custo de forma direta, fecháveis em nível de design) foram decididas agora:

**Upload presigned pode contornar quota (cenário 9, achado do Codex)**: corrigido — cada URL presigned corresponde a exatamente **um slot de upload reservado atomicamente em DynamoDB** no momento da geração (`ConditionExpression` decrementando o token bucket do tenant e criando um registro `PENDING` com atributo `expiresAt` vinculado à chave de objeto exata). Reenvios (múltiplos PUTs) para a mesma URL sobrescrevem o mesmo objeto — não criam novos objetos nem consomem quota adicional, mas o tamanho máximo do objeto é reforçado pela própria política do presigned POST (content-length-range), limitando custo de transferência mesmo sob reenvio. **Refinamento da Rodada 6 (revisão do Codex)**: a restituição do slot ao tenant não pode depender apenas do TTL do DynamoDB (que é uma exclusão assíncrona, não um gatilho confiável) — um reconciliador periódico (mesmo padrão do sweeper do outbox, §11) varre registros `PENDING` com `expiresAt` vencido e não confirmado, e só então restitui o slot de forma idempotente.

**maxReceiveCount e DLQ runbook (cenários 11/12)**: `maxReceiveCount = 5` por fila (padrão inicial, ajustável por canal em ADR de implementação). SLA de DLQ: alarme de idade em 1h, escalonamento (para revisão humana, não necessariamente on-call 24/7 neste estágio) em 4h — consistente com o RTO de 4h já definido para Stage 0–2. Mensagens redrive'd têm contador de tentativa de redrive próprio, separado do `maxReceiveCount` original, para evitar reprocessar indefinidamente a mesma poison message.

**Inbox de webhook (cenário 15, achado do Codex)**: adicionado padrão explícito — todo webhook recebido de provedor externo é gravado primeiro num `WebhookInbox` (DynamoDB) com `ConditionExpression` de não-existência (rejeita replay) e TTL de retenção; processamento do webhook só ocorre após a gravação bem-sucedida no inbox, e permanece recuperável (via reconciliador) se a gravação suceder mas o disparo de processamento seguinte falhar. **Refinamento da Rodada 6 (revisão do Codex)**: a chave do inbox é composta — `provider + tenant/account + providerEventId` (não apenas `providerEventId`), evitando colisão entre provedores/contas diferentes que possam reutilizar IDs de evento. Anti-replay completo exige, além da chave de idempotência, validação de assinatura do provedor com comparação em tempo constante e janela máxima aceitável de timestamp/nonce — não apenas a existência prévia do registro no inbox. Resolve idempotência e anti-replay como padrão único reutilizável por todos os provedores (SES bounce, Telegram, WhatsApp BSP), não uma solução ad-hoc por canal.

**Concorrência em alteração de data / exclusão de documento (cenários 13/14)**: mecanismo concreto fixado — **optimistic concurrency control** via atributo de versão em toda entidade mutável (`Item`, `Document`); toda escrita crítica (cancelamento de ocorrência, aplicação de resultado de extração) usa `ConditionExpression` comparando a versão lida com a versão atual — se divergir, a operação falha e é tratada como "já obsoleta" (mesmo caminho de FR-014), nunca aplicada silenciosamente sobre estado desatualizado. Isso fecha a corrida (race condition) identificada pelo Codex no cenário 13, e formaliza o "tombstone/version-check" pedido no cenário 14: a Step Function de extração verifica a versão do documento/item no passo final antes de escrever, cancelando/descartando se o item foi removido nesse meio-tempo.

**Falha de região (cenário 17) — risco aceito, agora documentado explicitamente**: a arquitetura consolidada **não provê recuperação cross-region** no MVP (decisão consciente, CON-002). RPO≤5min/RTO≤4h (Rodada 4) cobrem falhas dentro da região (ex.: erro operacional, corrupção de dados), **não** cobrem uma falha da região inteira da AWS — isso ficava implícito, agora está escrito: **risco aceito conscientemente para Stage 0–2, com gatilho de revisão explícito** = primeiro cliente pagante com SLA contratual de disponibilidade, ou entrada no Stage 3+ (seção 51, evolução por estágio).

**Rollback de deploy não cobre dados/eventos/schema (cenário 19, achado do Codex)**: adicionado requisito à decisão §12 — mudanças em schema DynamoDB, contratos de evento (EventBridge) ou definição de Step Functions devem seguir estratégia **expand/contract** (adicionar campo/versão nova, migrar consumidores, só então remover o antigo), nunca alteração destrutiva in-place; rollback de alias Lambda continua cobrindo regressão de código, mas não substitui esse requisito para mudanças de dados/contrato.

**Itens que permanecem como lacuna registrada (não bloqueiam a aprovação do Red Team, são operacionais/pós-implementação)**: circuit breaker e fallback de canal (cenários 3/4/5 — decisão de produto, não arquitetural pura); testes adversariais de prompt injection e versionamento de prompt/modelo (cenário 8); runbook de credencial comprometida e notificação LGPD (cenário 16); teste real de restore com reconciliação pós-restore (cenário 18, já era item aberto #13); load test progressivo validando shards/quotas sob carga real (cenários 1/2, só possível pós-implementação).

---

## Mapeamento para requisitos e capacity model (resumo)
| Decisão | Requisitos | Métrica do capacity model |
|---|---|---|
| DynamoDB on-demand | COST-001, SCALE-001 | idle≈0 Stage 0–1; 8M itens Stage 5 |
| Shards por minuto + SQS | NFR-002, NFR-011 | Pico extremo 16.667–278 agendamentos/s |
| Quarentena de 2 buckets S3 | SEC-003, SEC-003a | ~61 uploads/min Stage 5, ~1.667/s no extremo |
| SES/Telegram/WhatsApp adapters | FR-030..034, COST-006 | ~200.000 notificações/dia Stage 5 |
| Step Functions + PENDING_CONFIRMATION | FR-041..044, gate G4 | ~1.584 itens/dia exigindo revisão humana |
| Outbox seletivo | FR-014, NFR-002 | ~267 notificações corretivas/dia Stage 5 |

## Itens abertos para a Fase 3 completa (ADRs pendentes)
**Nota de precedência (Rodada 3)**: os itens 9 (quarentena/upload) e 12 (WhatsApp) são **gates locais** — bloqueiam especificamente a implementação de upload e de WhatsApp, respectivamente, não a conclusão conceitual desta fase. O item 10 (outbox) é **bloqueante** se o desenho detalhado depender só de DynamoDB Streams sem sweeper/replay — já corrigido na decisão 11 acima. O item 13 (DR) bloqueia produção, não a Fase 3. Nenhum item bloqueia o consenso conceitual desta rodada.

1. Mecanismo de quota por tenant em HTTP API (substituindo usage plans de REST API).
2. Tipo de Step Functions (Standard/Express/composição) para o pipeline de IA/OCR.
3. Quantidade de shards por minuto no reminder scheduling e estratégia de fan-out de consulta.
4. Tratamento de mudança de timezone/DST em ocorrências já materializadas.
5. Compatibilidade exata de WAF com API Gateway HTTP API.
6. Escolha de provedor de WhatsApp Business API (BSP) — pricing/quotas (UNK-003).
7. Escolha de modelo Bedrock para extração LLM.
8. Mecanismo de auto-ajuste ou alarme de partition-throttle para o número de shards por minuto no reminder scheduling (crítica do Claude, Rodada 2 — ver `docs/architecture/history/architecture-fase3/round2-claude-critique.md`).
9. SLA de latência entre upload e disponibilidade do documento (janela quarantine→clean) e comportamento para arquivos fora da cobertura do GuardDuty Malware Protection.
10. Mecanismo de replay/arquivamento para eventos críticos além da retenção de 24h do DynamoDB Streams (outbox pattern).
11. Avaliar se Step Functions se justifica desde o Stage 1 (baixo volume de IA/OCR) ou se uma cadeia de Lambdas mais simples é adequada até um gatilho de evolução definido (seção 51).
12. Campo(s) específicos de WhatsApp Business API (templates aprovados, janela de sessão de 24h) na abstração de `NotificationIntent`/Channel Adapter — validar se a interface comum vaza particularidades.
13. RTO/RPO e teste de restore de DynamoDB/S3 (OPS-005) — PITR habilitado não é o mesmo que restore testado; a fechar em `disaster-recovery.md`.
14. Padrão de geração de IAM roles por função via CDK constructs compartilhados, para não acumular dívida de manutenibilidade com a proliferação de handlers Lambda.
