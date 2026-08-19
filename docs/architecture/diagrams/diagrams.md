# Diagramas de Arquitetura — Plataforma de Controle de Vencimentos

Status: **14 de 14 diagramas completos** (seção 52), sincronizados com `architecture-fase3-consolidada.md`, `data-model.md`, `slo.md`, `disaster-recovery.md`, `evolution.md`, `mcp-readiness.md`. Atualizar este arquivo sempre que uma decisão de arquitetura mudar — os diagramas não podem divergir do texto consolidado.

## 1. System Context

```mermaid
graph TD
    User[Usuário PF/MEI/PME] -->|HTTPS| FE[Frontend SPA S3+CloudFront]
    FE -->|HTTPS/JWT| API[API Gateway HTTP API]
    API --> App[Lambda monólito modular]
    App --> DB[(DynamoDB single-table)]
    App --> S3Q[S3 quarantine]
    App --> S3C[S3 clean]
    App --> Cognito[Cognito User Pools]
    App -->|eventos| EB[EventBridge]
    EB --> Reminder[Reminder Scanner]
    Reminder --> SQS1[SQS reminder-due]
    SQS1 --> Dispatcher[Reminder Dispatcher]
    Dispatcher --> SQSe[SQS email-queue]
    Dispatcher --> SQSt[SQS telegram-queue]
    Dispatcher --> SQSw[SQS whatsapp-queue]
    SQSe --> SES[Amazon SES]
    SQSt --> TG[Telegram Bot API]
    SQSw --> WA[WhatsApp Business API / BSP]
    App --> AI[Textract + Bedrock]
    SES -.->|email| User
    TG -.->|telegram| User
    WA -.->|whatsapp| User
```

## 2. Container/Service (visão de módulos do monólito)

```mermaid
graph LR
    subgraph "Lambda — monólito modular"
        Identity[Identity/Tenancy]
        Expiration[Expiration Items]
        ReminderMod[Reminder]
        NotifMod[Notification]
        DocMod[Document]
        AuditMod[Audit]
    end
    Identity --> DB[(DynamoDB)]
    Expiration --> DB
    ReminderMod --> DB
    NotifMod --> DB
    DocMod --> S3[(S3 quarantine/clean)]
    AuditMod --> DB
    Expiration -.evento ItemDueDateChanged.-> EB[EventBridge]
    DocMod -.evento DocumentUploaded.-> EB
    EB -.-> ReminderMod
    EB -.-> NotifMod
```

## 3. Reminder Flow (com shards por minuto)

```mermaid
sequenceDiagram
    participant Item as Expiration Item
    participant DB as DynamoDB (GSI DUE#yyyyMMddHHmm#NN)
    participant Tick as EventBridge tick (1 min)
    participant Scanner as Reminder Scanner (Lambda)
    participant SQS as SQS reminder-due-queue
    participant Dispatcher as Reminder Dispatcher (Lambda)
    participant Notif as Notification Engine

    Item->>DB: ReminderOccurrence materializada (UTC + tz + regra)
    Tick->>Scanner: invoca a cada minuto
    Scanner->>DB: query shards vencidos do minuto corrente
    DB-->>Scanner: lote de ocorrências devidas
    Scanner->>SQS: publica lote (idempotency key)
    SQS->>Dispatcher: consome com concorrência controlada
    Dispatcher->>DB: valida versão/status do item (evita obsoleto)
    Dispatcher->>Notif: gera NotificationIntent por canal configurado
    Note over Dispatcher,SQS: falha -> retry + DLQ + alarme (NFR-003)
```

## 4. Notification Flow (adapters por canal)

```mermaid
graph TD
    Intent[NotificationIntent] --> Policy{entitlement / quiet-hours / opt-out}
    Policy -->|e-mail| Qe[SQS email-queue]
    Policy -->|telegram| Qt[SQS telegram-queue]
    Policy -->|whatsapp| Qw[SQS whatsapp-queue]
    Qe --> Ae[Adapter SES]
    Qt --> At[Adapter Telegram]
    Qw --> Aw[Adapter WhatsApp]
    Ae --> SES[Amazon SES]
    At --> TGAPI[Telegram Bot API]
    Aw --> WABSP[WhatsApp BSP]
    Ae -.falha.-> DLQe[DLQ email]
    At -.falha.-> DLQt[DLQ telegram]
    Aw -.falha.-> DLQw[DLQ whatsapp]
    Ae --> Attempt[(NotificationAttempt)]
    At --> Attempt
    Aw --> Attempt
```

## 5. Document Upload (quarentena de 2 buckets)

```mermaid
sequenceDiagram
    participant User
    participant API
    participant S3Q as S3 quarantine (IAM próprio)
    participant GD as GuardDuty Malware Protection
    participant Fargate as Fargate scanner (fallback)
    participant S3C as S3 clean (IAM próprio)
    participant DocMod as Document Module

    User->>API: solicita presigned URL
    API-->>User: URL (expiração de minutos)
    User->>S3Q: upload direto (PUT)
    S3Q->>GD: evento ObjectCreated (monitoramento assíncrono)
    alt coberto pelo GuardDuty
        GD-->>DocMod: resultado CLEAN / REJECTED
    else fora da cobertura (UNSUPPORTED)
        DocMod->>Fargate: aciona scanner de fallback
        Fargate-->>DocMod: resultado
    end
    alt CLEAN
        DocMod->>S3C: copia objeto (promove)
        DocMod->>DocMod: status = CLEAN, disponível para OCR/usuário
    else REJECTED / UNSUPPORTED / TIMEOUT
        DocMod->>DocMod: fail-closed — documento não promovido, usuário notificado
    end
```

## 6. AI Extraction (fail-closed, FR-043)

```mermaid
graph TD
    Clean[Documento CLEAN em S3] --> OCR[Textract OCR]
    OCR --> Det[Parser determinístico]
    Det -->|confiança suficiente| Field[ExtractedField]
    Det -->|confiança insuficiente| LLM[Bedrock LLM fallback]
    LLM --> Compare[Comparação entre extratores]
    Compare -->|convergem, confidence >= threshold| Field
    Compare -->|divergem, timeout, erro, tipo desconhecido, confidence baixa/inválida| Pending[PENDING_CONFIRMATION]
    Field --> ItemUpdate[Sugestão aplicada ao Item]
    Pending --> Review[Fila de revisão humana]
    Review -->|usuário confirma/corrige| ItemUpdate
    ItemUpdate --> Audit[(AuditEvent: ator, valor anterior/proposto, versão do pipeline)]
```

## 7. Security Boundaries

```mermaid
graph TD
    subgraph Internet["Não confiável"]
        User[Usuário]
        Attacker[Tráfego anônimo/abusivo]
    end
    subgraph Edge["Borda — WAF condicional"]
        CF[CloudFront]
        WAF[AWS WAF — regras gerenciadas + rate-based]
        APIGW[API Gateway HTTP API]
    end
    subgraph AuthZ["Autenticação/Autorização"]
        Cognito[Cognito User Pools]
        Quota[TenantQuota — token bucket]
        DomainAuthZ[Verificação por requisição, SEC-007]
    end
    subgraph Trust["Confiável — dentro do domínio"]
        Lambda[Lambda — monólito modular]
        DDB[(DynamoDB — tenantId em toda chave)]
        S3Clean[S3 clean]
    end
    subgraph Quarantine["Zona de quarentena — não confiável até CLEAN"]
        S3Q[S3 quarantine]
        GD[GuardDuty Malware Protection]
    end

    User -->|HTTPS| CF --> WAF --> APIGW
    Attacker -.->|bloqueado/limitado| WAF
    APIGW --> Cognito
    APIGW --> Quota
    Quota --> DomainAuthZ
    DomainAuthZ --> Lambda
    Lambda --> DDB
    Lambda -->|presigned upload| S3Q
    S3Q --> GD
    GD -->|CLEAN apenas| S3Clean
    Lambda -->|leitura, só CLEAN| S3Clean
```

## 8. Data Flow completo (com outbox/sweeper)

```mermaid
graph LR
    Write[Escrita de domínio] -->|TransactWriteItems| DDB[(DynamoDB)]
    DDB -->|registro PENDING| Outbox[(Outbox)]
    Outbox -->|publicação bem-sucedida| EB[EventBridge]
    Outbox -.->|nunca confirmado| Sweeper[Sweeper/Reconciliador]
    Sweeper -->|reenfileira| EB
    EB --> Consumers[Módulos consumidores: Reminder, Notification, Audit]
    Consumers -->|dedup por eventId| Idempotent[Processamento idempotente]
```

## 9. Deployment

```mermaid
graph TD
    Dev[Commit aprovado] --> CI[GitHub Actions: lint/testes/scans]
    CI --> CDKDiff[cdk diff]
    CDKDiff --> Staging[Deploy Staging via CDK]
    Staging --> Smoke[Smoke test]
    Smoke --> Manual[Aprovação manual de produção]
    Manual --> Canary[Deploy canário — alias Lambda]
    Canary --> Monitor[Monitorar métricas/erros]
    Monitor -->|ok| Full[Rollout completo]
    Monitor -->|regressão| Rollback[Rollback de alias]
    Full -.->|mudança de schema/evento| ExpandContract[Estratégia expand/contract, nunca destrutiva in-place]
```

## 10. Observability

```mermaid
graph TD
    Lambda[Lambda/Step Functions] -->|EMF| CW[CloudWatch Metrics]
    Lambda -->|logs JSON + correlationId| CWLogs[CloudWatch Logs]
    Lambda -->|traces amostrados| XRay[X-Ray]
    CW --> Dashboards[Dashboards por SLO]
    CW --> Alarms[Alarmes por sintoma]
    Alarms -->|DLQ idade 1h/4h| OnCall[Revisão humana]
    Alarms -->|Cost Anomaly| KillSwitch[Kill switch AppConfig]
    Dashboards --> SLOReview[Revisão de SLO — slo.md]
```

## 11. Disaster Recovery

```mermaid
sequenceDiagram
    participant IC as Incident Commander
    participant DDB as DynamoDB (PITR)
    participant NewT as Tabela nova (restore)
    participant S3 as S3 quarantine/clean
    participant Recon as Reconciliação

    IC->>DDB: fixa T0 (último instante íntegro)
    IC->>DDB: interrompe writers/consumidores
    DDB->>NewT: restore PITR para tabela nova
    IC->>NewT: valida contagens, hashes, GSIs, isolamento tenantId
    IC->>S3: restaura buckets versionados se necessário
    NewT->>Recon: reconcilia registros PENDING e intervalo T0-retomada
    Recon->>IC: smoke test + canário
    IC->>IC: corte para nova tabela, mede RPO/RTO observados
```

## 12. Growth Evolution

```mermaid
graph LR
    MVP[Day 0 / MVP] -->|1o cliente pagante| Early[Early Traction]
    Early -->|alarme ConsumedReadCapacity >70%| Growth[Growth 10k+]
    Growth -->|SLA contratual ou Stage 3| Scale[Scale 100k+]
    Scale -.->|gatilho: multi-region ativo-passivo| ScaleDR[Revisão de postura de região]
    Scale -->|volume Stage 5 medido| Large[Large Scale 1M+]
    MVP -.->|1a venda B2B| Org[Habilitar Organizations]
    Org -.->|dual-write→backfill→cutover| OrgDone[Migração de tenantId concluída]
```

## 13. MCP Future Flow

```mermaid
graph TD
    Agent[Cliente MCP / Agente] -->|OAuth scope, ex: items:read| Cognito[Cognito]
    Cognito -->|tenantId do token, nunca do agente| MCPGateway[MCP Tool Gateway]
    MCPGateway -->|1 tool = 1 operação da API| API[API HTTP interna]
    API --> DomainAuthZ[Autorização por objeto, SEC-007]
    DomainAuthZ --> Lambda[Domínio]
    Lambda --> Audit[AuditEvent — actorUserId + origin + actingOnBehalfOf]
    Lambda -->|campo de baixa confiança| Pending[PENDING_CONFIRMATION — mesmo gate G4]
```

## 14. Container/Service detalhado

```mermaid
graph TD
    subgraph API_Layer["API Layer"]
        APIGW[API Gateway HTTP API]
    end
    subgraph Domain["Lambda — monólito modular"]
        Identity[Identity/Tenancy]
        Expiration[Expiration Items]
        ReminderMod[Reminder]
        NotifMod[Notification]
        DocMod[Document]
        AuditMod[Audit]
    end
    subgraph Async["Workers assíncronos"]
        Scanner[Reminder Scanner]
        Dispatcher[Reminder Dispatcher]
        AdapterE[Adapter SES]
        AdapterT[Adapter Telegram]
        AdapterW[Adapter WhatsApp]
        ExtractSF[Step Function Extração]
    end
    subgraph Queues["Filas/DLQs nomeadas"]
        QReminder[SQS reminder-due + DLQ]
        QEmail[SQS email-queue + DLQ]
        QTelegram[SQS telegram-queue + DLQ]
        QWhatsApp[SQS whatsapp-queue + DLQ]
        QWebhook[WebhookInbox]
    end
    APIGW --> Identity & Expiration & ReminderMod & NotifMod & DocMod
    Scanner --> QReminder --> Dispatcher
    Dispatcher --> QEmail --> AdapterE
    Dispatcher --> QTelegram --> AdapterT
    Dispatcher --> QWhatsApp --> AdapterW
    DocMod --> ExtractSF
    AdapterE & AdapterT & AdapterW -.webhook.-> QWebhook --> AuditMod
```

Todos os 14 diagramas exigidos pela seção 52 do prompt mestre estão agora presentes, sincronizados com `architecture-fase3-consolidada.md`, `data-model.md`, `slo.md`, `disaster-recovery.md` e `evolution.md`.
