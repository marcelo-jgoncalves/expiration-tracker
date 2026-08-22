---
status: draft
owner: engineering
authority: evidence
---

# Proposta Claude (rodada 1, nota cega) — trilha de auditoria de segurança

Achado que motiva isso (`full-audit-round1-focused-round2-summary.md`, ainda aberto):
"negações de autorização (`src/modules/identity/domain/authorization.ts`) e acesso aos GSIs
globais (GSI3/GSI6) não geram nenhuma trilha de auditoria de segurança dedicada — só
exceção/resposta HTTP" (Segurança-Logging, OWASP A09:2025) e o mesmo achado reduz a nota do
critério paralelo de Operações/SRE-Detecção.

## Estado real levantado (evidência, não suposição)

- `authorize()` (`authorization.ts:94-125`) lança `AuthorizationDeniedError` com 4 motivos
  possíveis (`TENANT_MISMATCH`, `NO_MEMBERSHIP`, `INSUFFICIENT_ROLE`,
  `RESOURCE_OWNERSHIP_MISMATCH`). No MVP (`tenantId=userId`, tenant single-owner), o papel
  resolvido é sempre `OWNER` — `NO_MEMBERSHIP`/`INSUFFICIENT_ROLE`/`RESOURCE_OWNERSHIP_MISMATCH`
  são hoje teoricamente inalcançáveis por um chamador real (não há como um usuário autenticado
  ter outro papel). **`TENANT_MISMATCH` é o único motivo realmente exercitável hoje** — dispara
  quando alguém autenticado como tenant A tenta agir sobre um recurso lido do DynamoDB como
  pertencente a outro tenant (substituição de ID, o cenário OWASP A01/A09 relevante de verdade).
- GSI3/GSI6 têm exatamente 4 pontos de query no código real, todos em stores já
  estruturalmente restritos a 3 roles privilegiadas (verificado via IAM real,
  `camada3-iam-negative-test-2026-08-21.md`): `dynamodb-reminder-producer-store.ts:27` (GSI3),
  `dynamodb-reconciliation-candidate-source.ts:34,55` (GSI6 ×2), `dynamodb-outbox-relay-store.ts:64`
  (GSI6). Não há superfície de ataque real aqui hoje — a pergunta é "esses 3 workers estão se
  comportando dentro do esperado", não "alguém não autorizado está acessando" (isso o IAM real já
  impede, comprovado).

## Proposta: logging estruturado dedicado, não uma nova entidade DynamoDB

Dado que (a) o único cenário de negação realmente exercitável é `TENANT_MISMATCH`, e (b) o
acesso a GSI3/GSI6 já está IAM-restrito e comprovado, uma nova entidade persistida no DynamoDB
(padrão `AuditEvent` do módulo `expiration`, que exige a mesma `TransactWriteItems` da mutação
que audita) **não se aplica aqui** — uma negação de autorização não tem mutação nenhuma para
compartilhar transação (é exatamente o oposto: nada é escrito), e uma query em GSI3/GSI6 também
não é uma mutação.

Proposta: `SecureLogger` ganha um método dedicado `securityEvent()` (distinto de `.info()`/
`.warn()`/`.error()` genéricos), que:
1. Sempre inclui `correlationId`/`tenantId` do contexto ambiente (via `getContext()`, já
   automático) + um campo novo `securityEventType` (`"AUTHZ_DENIED"` | `"GLOBAL_INDEX_ACCESS"`) +
   `securityEventReason` (o motivo do `AuthorizationDeniedError`, ou o nome do índice/worker).
2. Nunca inclui payload de negócio — só os campos estruturados acima, já redigidos como todo log
   do `SecureLogger`.
3. `authorize()` NÃO chama isso diretamente (manter a função pura, sem I/O — decisão já registrada
   no design original de M1/M3.5). Em vez disso, a camada HTTP (`http-adapter.ts`'s
   `toApiGatewayResult` / o catch central de erro) chama `securityEvent()` quando captura
   `AuthorizationDeniedError`, no ponto único onde toda rota HTTP já converte erros em resposta.
4. Os 4 call sites de GSI3/GSI6 ganham uma chamada explícita a `securityEvent("GLOBAL_INDEX_ACCESS", ...)`
   antes de cada `Query`.

## Alarme real

Um novo `aws_cloudwatch_log_metric_filter` (filtra `securityEventType="AUTHZ_DENIED"` nos logs
de CloudWatch reais) alimenta um `aws_cloudwatch_metric_alarm` com threshold (ex. >5 negações do
mesmo `tenantId` em 5 minutos = possível ataque de enumeração/substituição de ID), ligado ao
`alert-topic` já real de M5 — reusa a infra existente, não cria destino novo.

## O que esta proposta explicitamente NÃO resolve

- Não cobre negação de autorização de workers (EventBridge/SQS) — hoje só a matriz HTTP chama
  `authorize()`; se um worker um dia chamar, precisa do mesmo tratamento no catch central dele.
- Não é uma trilha "imutável"/tamper-evident dedicada (CloudWatch Logs tem retenção e controle
  de acesso via IAM, mas não é WORM) — proporcional ao estágio, não uma exigência formal de
  compliance ainda.

## Alternativas consideradas e rejeitadas

- **Nova entidade `SecurityAuditEvent` no DynamoDB** (mesmo padrão de `AuditEvent`): rejeitada
  por desproporção — exigiria um novo `PutItem` best-effort sem transação (viola a garantia
  atômica que faz o padrão `AuditEvent` valioso hoje) só para registrar algo que já pode ser
  reconstruído via CloudWatch Logs Insights, sem ganho real de durabilidade neste estágio.
- **Serviço de log agregado dedicado (ex. um SIEM)**: desproporcional a um projeto solo
  pré-produção.
