---
status: active
owner: engineering
authority: evidence
---

# Achado real e severo: EventBridge Scheduler `input` corrompido por `jsonencode()` — 2026-08-21

## Como foi encontrado

Não foi um teste planejado — foi encontrado ao investigar telemetria real durante o trabalho de
Camada 3 (`docs/architecture/reviews/camada3-dlq-redrive-test-2026-08-21.md`). A métrica
`AWS/Lambda Invocations` de `exptrk-dev-reminder-producer` mostrava exatamente 3
invocações/minuto, de forma perfeitamente consistente — suspeito para uma schedule de
`rate(1 minute)`. A métrica `Errors` no mesmo período mostrava exatamente 3 erros/minuto: **100%
de taxa de erro**, consistente com 1 tentativa + 2 retries automáticos de invocação assíncrona do
Lambda (comportamento padrão quando o alvo de um `EventBridge Scheduler` falha).

## Causa raiz real (confirmada via `aws logs filter-log-events`, não suposição)

```
ERROR	Invoke Error	{"code":"VALIDATION_FAILED","category":"VALIDATION",
"message":"reminder-producer: scheduledTime is not a valid date.","retryable":false,
"details":{"scheduledTime":"<aws.scheduler.scheduled-time>"}}
```

O handler recebia o **texto literal** `<aws.scheduler.scheduled-time>` como valor de
`scheduledTime`, em vez do timestamp real substituído pelo EventBridge Scheduler. Confirmado via
`aws scheduler get-schedule --name reminder-producer --query "Target.Input"`:

```
{"scheduledTime":"<aws.scheduler.scheduled-time>"}
```

`infra/modules/reminder-schedule/main.tf` construía esse campo com
`jsonencode({ scheduledTime = "<aws.scheduler.scheduled-time>" })`. A função `jsonencode()` do
Terraform herda o comportamento padrão do `encoding/json` do Go, que HTML-escapa `<`/`>` (e `&`)
para `<`/`>` por segurança contra XSS ao embutir JSON em HTML — comportamento correto
para esse caso de uso original, mas nunca documentado como afetando o texto de um valor de string
dentro do JSON. O EventBridge Scheduler faz **correspondência textual literal** do placeholder
`<aws.scheduler.scheduled-time>` no corpo do `Input` antes de invocar o alvo — como o texto
armazenado continha `<...>` (6 caracteres cada, não os 2 caracteres reais `<`/`>`), a
substituição nunca ocorria. O Lambda recebia o `Input` como JSON válido (`<` decodifica para
`<` normalmente ao fazer `JSON.parse`), então o valor chegava ao handler como a string literal
`"<aws.scheduler.scheduled-time>"` — nunca um timestamp real.

## Impacto real

**Desde `2026-08-20T14:41:39Z`** (primeiro `terraform apply` real que criou essas 4 schedules,
sessão de M5) **até a correção nesta sessão**, as 4 schedules afetadas nunca funcionaram de
verdade contra dados reais:
- `reminder-producer` (a cada 1 min): **nenhum lembrete real foi materializado** durante toda essa
  janela — o motor de lembretes esteve efetivamente parado em `dev`.
- `reminder-claim-reconciliation` (CLAIMS, a cada 5 min) e `reminder-dst-reconciliation` (DST,
  diário): mesma falha — reconciliação nunca rodou de verdade.
- `outbox-sweeper-reminder-dispatch` (a cada 5 min): mesma falha — sweeper do outbox nunca rodou.

Como o ambiente `dev` não tem usuários/tenants reais ainda, o impacto de produto é zero — mas isso
teria sido um incidente SEV-1/SEV-2 real (`incident-runbooks.md`) num ambiente com usuários. O
alarme de erros de cada função (`*ErrorsAlarm`, M5) deveria ter capturado isso e notificado via
SNS→e-mail — não capturou porque nenhum desses alarmes está configurado sobre invocações
assíncronas de Scheduler com essa cardinalidade/threshold específico ainda, achado adicional a
investigar (fora do escopo deste documento, registrar como follow-up).

## Correção real aplicada

`infra/modules/reminder-schedule/main.tf`: os 4 campos `target.input` deixaram de usar
`jsonencode(...)` e passaram a ser literais de string HCL manuais (ex.
`"{\"scheduledTime\":\"<aws.scheduler.scheduled-time>\"}"`), preservando o texto literal do
placeholder sem escaping. `terraform test` do módulo `reminder-schedule` e da raiz atualizados —
**achado real adicional**: os testes anteriores comparavam o valor contra o mesmo
`jsonencode(...)` usado no código de produção, então certificavam o bug como correto em vez de
pegá-lo; reescritos para comparar contra o texto literal esperado, e um teste novo na raiz
(`stack.tftest.hcl`) verifica explicitamente a ausência de `<` no input.

`terraform plan -var-file=env/dev.tfvars` real (`AWS_PROFILE=claude-dev`, plan-only, sem apply
local — política do projeto, `AGENTS.md` §7): confirma as 4 schedules como `update in-place`,
mudança isolada ao campo `input`. **Ainda não deployado** — decisão do usuário e política vigente
exigem que qualquer aplicação real vá só pela pipeline (`cd.yml`, merge para `main`); esta correção
está commitada em `develop`, aguardando decisão explícita do usuário sobre abrir o PR de deploy.

## Lição para o processo, não só para o código

Este bug sobreviveu a: `terraform test` (verde, porque testava o valor errado), `terraform plan`
real sem `0 a destruir/substituir` alarmante (era só um `update in-place` silencioso), e a revisão
de implementação do M3.5 original (nota final 9.3/10 — o revisor, cego ao comportamento real de
`jsonencode()` com HTML-escaping, não tinha motivo para suspeitar). Só foi encontrado porque a
Camada 3 finalmente olhou para telemetria real de invocação/erro, não para código ou teste. Isso
é evidência concreta do motivo pelo qual a Camada 3 é um gate estrutural, não redundante com
Camada 1/2 — nenhuma delas executa contra o serviço `EventBridge Scheduler` real.
