# Diagramas de Arquitetura — Plataforma de Controle de Vencimentos

Status: sincronizado com `docs/architecture/architecture-fase3-consolidada.md` (Rodada 4). Atualizar este arquivo sempre que uma decisão de arquitetura mudar — os diagramas não podem divergir do texto consolidado.
Conforme seção 52 do prompt mestre, 14 diagramas são exigidos ao final. Esta primeira leva cobre os 6 mais centrais às decisões já consolidadas; os demais (Security Boundaries, Data Flow, Deployment, Observability, DR, Growth Evolution, MCP Future Flow, Container/Service detalhado) ficam pendentes para quando os ADRs correspondentes fecharem (ver "Itens abertos" em `architecture-fase3-consolidada.md`).

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

## Diagramas pendentes (a produzir quando os ADRs correspondentes fecharem)
7. Security Boundaries — depende da decisão final de WAF×HTTP API (item aberto).
8. Data Flow completo (incluindo outbox/sweeper) — depende do ADR de replay (fechado conceitualmente, falta detalhar visualmente).
9. Deployment — depende do detalhamento de CI/CD (`ScopedLambdaFunction`, ambientes).
10. Observability — dashboards/alarmes concretos (depende de `slo.md`, Fase posterior).
11. Disaster Recovery — depende de `disaster-recovery.md` (RTO/RPO já têm meta, falta o fluxo de restore).
12. Growth Evolution — depende da seção "Evolução da Arquitetura" (ainda não escrita).
13. MCP Future Flow — depende de `mcp-readiness.md` (não iniciado).
14. Container/Service detalhado com todas as filas/DLQs nomeadas — versão expandida do diagrama 2 acima, a produzir junto do Implementation Blueprint (seção 60, pós-aprovação).
