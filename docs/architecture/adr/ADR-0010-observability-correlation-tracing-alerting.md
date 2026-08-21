# ADR-0010 — Observabilidade: correlationId contextual, ADOT/X-Ray, alerta SNS→e-mail

**Status**: Aceito | **Data**: 2026-08-20 | **Type**: Type 1 | **Requisitos**: full-audit round1 (Qualidade/Debuggability, Segurança/Incident Response, Tracing distribuído)

## Contexto

O full-audit round1 encontrou 3 achados relacionados sem dono único: `SecureLogger` não propaga `correlationId`/`tenantId` automaticamente; nenhum tracing distribuído ponta a ponta; alarmes CloudWatch existentes sem destino de notificação real. Design completo, protocolo Claude↔Codex (4 rondas, nota final Claude 9,1 / Codex 9,3): `docs/architecture/m5-observability-design.md`.

## Options Considered

1. **`AsyncLocalStorage` para correlationId/tenantId contextual, granularidade por-record em handlers batch, propagado via campo já-obrigatório `DomainEvent.correlationId` copiado ao `OutboxRecord`** (escolhida). Alternativa rejeitada: capturar do contexto ambiente no momento do envio SQS — quebra causalidade (a correlação do relay/sweeper, não da operação original que criou o outbox record).
2. **ADOT (AWS Distro for OpenTelemetry) Lambda layer exportando para X-Ray como backend**, preservando D-022 (decisions-log.md). Alternativa rejeitada: `aws-xray-sdk-core` (SDK legado, modo de manutenção) — corrigido durante a revisão do Codex (ronda 1). Alternativa rejeitada: Collector OTel dedicado (ECS/Fargate) — desnecessário com Lambda+ADOT.
3. **SNS→e-mail** como primeiro destino real de alarme. Alternativas rejeitadas nesta ronda: Slack/PagerDuty (exigem vendor/webhook não contratado) — aditivas depois, não bloqueiam este design.

## Limites explícitos (não decisão pendente, decisão consciente)

APIs são HTTP API (D-011), não REST API — sem segment X-Ray nativo do API Gateway; o trecho cliente→gateway→Lambda é correlacionado por log (`correlationId`), não por span de tracing. Confirmação da subscription SNS→e-mail é passo manual (Terraform não confirma por outrem) — critério de aceite explícito, não implícito.

## Evidence

`docs/architecture/m5-observability-design.md`; `docs/architecture/reviews/m5-observability-design/codex-round{1,2,3,4}.txt`.

## Consequences

Aditivo: nenhuma mudança de schema JSON (`DomainEvent.correlationId` já era obrigatório); mudança de tipo interna em `OutboxRecord`. Novo módulo Terraform `alert-topic`; novo campo `adot_layer_arn` (sem default) em `lambda-function`; `alarm_actions` adicionado aos alarmes existentes.
