# ADR Index — Expiration Tracker

ADRs formais (modelo da seção 24 do prompt mestre) para as decisões **Type 1** (caras/difíceis de reverter) já aprovadas em `decisions-log.md`. Consistente com a seção 2 do prompt mestre ("invista mais debate em Type 1"), decisões Type 2 (reversíveis — Compute/Lambda, Frontend, Auth/Cognito, IaC/CDK, Observabilidade, adapters/provedores individuais) permanecem documentadas inline em `architecture-fase3-consolidada.md`, sem ADR formal separado — a justificativa e o debate já estão registrados lá com o mesmo rigor, e um ADR redundante não agregaria informação nova.

Nenhum ADR abaixo representa nova rodada de debate — cada um formata uma decisão já aprovada (nota ≥9.0 de ambos) no documento-fonte correspondente, com referência cruzada ao histórico completo de debate.

| ADR | Decisão | Fonte |
|---|---|---|
| [ADR-0001](ADR-0001-dynamodb-single-table.md) | DynamoDB on-demand single-table | `architecture-fase3-consolidada.md` §5, `data-model.md` |
| [ADR-0002](ADR-0002-multi-tenant-readiness.md) | `tenantId` em toda chave desde o Day 0 | `architecture-fase3-consolidada.md` §6 |
| [ADR-0003](ADR-0003-reminder-engine-shards.md) | Reminder Engine — shards por minuto | `architecture-fase3-consolidada.md` §8 |
| [ADR-0004](ADR-0004-event-backbone-outbox.md) | EventBridge + outbox seletivo com sweeper | `architecture-fase3-consolidada.md` §11 |
| [ADR-0005](ADR-0005-security-kill-switch.md) | Kill switch via AppConfig | `architecture-fase3-consolidada.md` §14 |
| [ADR-0006](ADR-0006-document-quarantine.md) | Quarentena física de 2 buckets S3 | `architecture-fase3-consolidada.md` §7 |
| [ADR-0007](ADR-0007-disaster-recovery-rpo-rto.md) | RPO/RTO e risco de região aceito | `disaster-recovery.md` |
| [ADR-0008](ADR-0008-notification-engine-adapters.md) | Notification Engine — adapters por canal | `architecture-fase3-consolidada.md` §9 |
