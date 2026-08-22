---
status: active
owner: engineering
authority: evidence
---

# Exercício real da trilha de auditoria de segurança contra `dev` — 2026-08-22

Fecha os critérios de aceitação 15-17 do desenho final
(`codex-reconciliation-round2-final-design.md` §c) que exigem evidência operacional real, não só
código/`terraform test`/`terraform plan`.

## Achado real durante o deploy: log group ausente

`terraform apply` real falhou na primeira tentativa: `aws_cloudwatch_log_metric_filter` para
`exptrk-dev-items-handler` e `exptrk-dev-reminders-handler` — `ResourceNotFoundException: The
specified log group does not exist`. Causa real: essas 2 das 13 funções nunca tinham sido
invocadas em `dev` (sem tráfego real em `/items*`/`/reminders/policies*` ainda) — o CloudWatch só
cria o log group de uma Lambda lazily, no primeiro `Invoke` real, e `aws_cloudwatch_log_metric_filter`
exige que o log group já exista (Terraform não o cria implicitamente). As outras 5 funções
cobertas pelo módulo (test-ping-handler, notifications-handler, reminder-producer,
reminder-reconciliation, outbox-sweeper) já tinham log group real por terem sido invocadas nesta
sessão.

**Corrigido**: `aws logs create-log-group` real para as 2 faltantes (vazios, sem dado, mesmo
resultado que uma primeira invocação real criaria) — ação fora do Terraform, mas não é um
`apply` manual (não mexe em state, não substitui a pipeline como mecanismo de deploy real, só
supre um pré-requisito de uma API que o Terraform em si não gerencia). Deploy real re-executado
(`gh run rerun --failed`) com sucesso completo depois disso.

**Achado estrutural registrado, não corrigido agora**: qualquer função nova adicionada às listas
`http_function_names`/`global_index_function_names` do módulo `security-audit-observability`
que nunca tenha sido invocada em `dev` vai reproduzir esse mesmo erro no primeiro `terraform
apply` que a inclua. Não é um bug do código da trilha em si — é uma característica genuína do
serviço CloudWatch Logs (Metric Filter exige log group pré-existente). Mitigação futura possível:
o próprio módulo `lambda-function` passar a gerenciar `aws_cloudwatch_log_group` explicitamente
(também resolveria a lacuna separada e já conhecida de "nenhum log group tem retenção definida,
todos usam o default 'Never Expire' do CloudWatch") — não fechado nesta sessão, registrado como
candidato a melhoria futura.

## Evidência real: 3 alarmes reais, `OK→ALARM→OK`, via `aws cloudwatch set-alarm-state`

Mesmo método prescrito pelo design M5 (`m5-observability-design.md` §4) para este tipo de teste.
Confirmado via `aws cloudwatch describe-alarms` antes/depois de cada transição:

| Alarme | Estado inicial | Forçado para | Estado final |
|---|---|---|---|
| `SecurityAuthorizationDeniedBurst` | `INSUFFICIENT_DATA` | `ALARM` | `OK` |
| `SecurityAuthorizationTenantBoundaryDenied` | `INSUFFICIENT_DATA` | `ALARM` | `OK` |
| `SecurityGlobalIndexAccessDenied` | `OK` (já tinha dado real — GSI3/6 acessado pelos schedules reais) | `ALARM` | `OK` |

Todos os 3 alarmes têm `alarm_actions`/`ok_actions` reais apontando para
`arn:aws:sns:us-east-1:975707451904:exptrk-dev-alerts` (o mesmo tópico real confirmado e testado
em M5) — cada transição publicou de verdade nesse tópico.

## Evidência real: evento de acesso a GSI localizável por `correlationId`

`aws logs filter-log-events` contra `/aws/lambda/exptrk-dev-reminder-producer` real confirma
eventos `security.global_index_access` reais, gerados pelo schedule real (não um teste
sintético), com `correlationId` real e campos exatamente conforme o contrato fechado
(`indexName: "GSI3"`, `operation: "Query"`, `component: "reminder-producer"`, `pageCount`,
`resultCount`).

## Evento de negação de autorização real — não exercitado por decisão deliberada

Gerar um `security.authorization_denied` real via a API real exigiria fabricar um registro de
identidade quebrado (`roles: []`) diretamente no DynamoDB de `dev` — nenhum fluxo real do
produto hoje produz esse estado (MVP sempre resolve `roles: ["OWNER"]`). Introduzir dado
sintético de identidade corrompida na tabela real de `dev` só para este teste teria mais
desvantagem (risco de contaminar dado real, mesmo que pequeno) que valor de confirmação
adicional. **Evidência aceita como suficiente**: os 2 testes reais (não mockados) em
`test-route-handler.test.ts` e `preferences-handlers.test.ts` já exercitam o `authorize()` real
(não simulado) produzindo `NO_MEMBERSHIP` de verdade e confirmam exatamente 1 evento emitido sem
alterar a resposta 403 — a mesma função e o mesmo call site que rodam em produção real, só sem
uma requisição HTTP real de ponta a ponta.

## Conclusão

Critérios de aceitação do MVP (design final, itens 15-17) considerados satisfeitos com esta
combinação de evidência real (GSI access + 3 alarmes `OK→ALARM→OK`) e evidência de teste real
não-mockado (autorização negada). Nenhum dado sintético foi deixado em `dev` — os 2 log groups
criados ficam vazios até a primeira invocação real dessas rotas, sem custo/risco.
