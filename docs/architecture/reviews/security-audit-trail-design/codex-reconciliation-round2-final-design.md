---
status: approved
owner: engineering
authority: design
---

# Reconciliação Codex — rodada 2 (desenho final, MVP desta sessão) — trilha de auditoria de segurança

Convergência Claude↔Codex sobre a trilha de auditoria de segurança para negação de autorização e
acesso a GSI3/GSI6 (`AGENTS.md` §4). Claude propôs logging estruturado genérico (round1); Codex
propôs o mesmo mecanismo com taxonomia fechada de 3 eventos, call sites exatos verificados, evento
de sucesso de GSI (não só negação), achado real do gap de correlationId no sweeper, e alarmes
calibrados (round1, nota cega). Claude aceitou como base (round2 crítica, 9.3/10), pedindo só a
divisão explícita MVP-desta-sessão vs. entrega futura. Codex concordou e produziu este desenho
final.

## 1. Contrato compartilhado

`src/shared/observability/security-audit.ts` — 3 funções tipadas, taxonomia fechada:
- `auditAuthorizationDenied(...)` → evento `security.authorization_denied`
- `auditGlobalIndexAccess(...)` → evento `security.global_index_access`
- `auditGlobalIndexAccessDenied(...)` → evento `security.global_index_access_denied`

Todos passam pelo `SecureLogger` existente, herdam `correlationId`/`tenantId` do contexto
automaticamente. Campos permitidos por evento:

| Evento | Campos específicos |
|---|---|
| `security.authorization_denied` | `reason`, `action` |
| `security.global_index_access` | `indexName`, `operation`, `component`, `pageCount`, `resultCount` |
| `security.global_index_access_denied` | `indexName`, `operation`, `component`, `awsErrorCode` |

Nunca registrar: IDs de recurso, chaves DynamoDB, expressões de consulta, payloads, tokens,
e-mail, conteúdo de negócio, stack trace. `authorize()` permanece pura, sem I/O — o módulo não é
chamado de dentro dela.

## 2. Negações de autorização HTTP (4 call sites verificados)

`item-handlers.ts`, `policy-handlers.ts`, `preferences-handlers.ts`, `test-route-handler.ts` — os
4 pontos reais que já fazem `instanceof AuthorizationDeniedError`. Emitir exatamente 1 evento por
negação capturada, sem alterar a resposta HTTP existente.

## 3. Acesso privilegiado a GSI3/GSI6 (4 chamadas lógicas, 3 adapters)

`DynamoDbReminderProducerStore` (GSI3), `DynamoDbReconciliationCandidateSource` (GSI6, 2
consultas), `DynamoDbOutboxRelayStore` (GSI6). Sucesso: 1 evento por chamada lógica (não por
página), com `pageCount`/`resultCount` agregados. `AccessDeniedException`: 1 evento de negação,
erro original relançado sem alterar retry/DLQ.

## 4. Fix real: contexto do outbox sweeper

`outbox-sweeper-handler.ts` não chama `runWithContext` hoje — sem isso, os eventos de GSI6 do
sweeper não têm `correlationId` real. Corrigido como parte do MVP (não é oportunista, é
pré-requisito para a trilha ficar correlacionável).

## 5. Infraestrutura e alarmes (módulo novo `security-audit-observability`)

3 alarmes fecháveis nesta sessão, todos com `alarm_actions`/`ok_actions` para o `alert-topic`
real, `treat_missing_data = "notBreaching"`:
1. `SecurityAuthorizationTenantBoundaryDenied` — `TENANT_MISMATCH`, limiar 1.
2. `SecurityAuthorizationDeniedBurst` — qualquer negação, limiar 5 em 5min.
3. `SecurityGlobalIndexAccessDenied` — `AccessDeniedException` real, limiar 1.

## (a) Arquivos do MVP desta sessão

**Criados**: `src/shared/observability/security-audit.ts`,
`test/unit/security-audit.test.ts`,
`infra/modules/security-audit-observability/{main,variables,outputs,versions}.tf` +
`tests/security_audit_observability.tftest.hcl`.

**Modificados**: os 4 handlers HTTP; os 3 adapters de persistência GSI3/GSI6;
`outbox-sweeper-handler.ts`; testes unitários existentes desses 7 arquivos; `infra/main.tf`;
`infra/tests/stack.tftest.hcl`; `NEXT_SESSION_PROMPT.md`.

## (b) Entrega futura, explicitamente fora do MVP

- **Alarme de anomalia de volume de acesso a GSI3/GSI6**: a instrumentação (`pageCount`/
  `resultCount`) entra no MVP para começar a gerar dados, mas o alarme em si só pode ser fechado
  depois de observar baseline real em `dev` por um período, nunca com limiar especulativo.
- Retenção WORM/tamper-evident, exportação SIEM/Security Lake, auditoria persistida em
  DynamoDB, detecção individualizada por tenant, cobertura de `authorize()` em workers
  (nenhum chama hoje), dashboards/ML de anomalia, exercício humano completo de resposta a
  incidente.

## (c) Critérios de aceitação do MVP (18 itens, ver reconciliação completa)

Resumo: módulo com só as 3 funções tipadas; testes de formato/redação/contrato; 1 evento exato
por negação nos 4 handlers sem alterar resposta HTTP; 1 evento exato por chamada lógica de
GSI (mesmo paginada) com `pageCount`/`resultCount` corretos; `AccessDeniedException` sintético
testado por adapter, sem alterar retry/DLQ; sweeper com `correlationId` real; 3 alarmes reais no
Terraform com `terraform test`; todos os gates de qualidade verdes; **exercício real em `dev`**
(evento real localizável por `correlationId`, os 3 alarmes exercitados `OK→ALARM→OK` reais,
nenhum resíduo operacional); documentação registrando o alarme de volume como futuro, não
concluído.

## Notas finais

Codex: **9.4/10**, atinge o gate. Claude: **9.3/10** (round2 crítica), atinge o gate. Convergido,
aprovado para implementação do MVP desta sessão.
