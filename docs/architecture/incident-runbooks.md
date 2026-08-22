# Runbooks Operacionais, Matriz de Incidentes & Post-mortem — Expiration Tracker

Status: **draft operacional** — escrito para satisfazer OPS-006 (`requirements.md` §7) e fechar o achado classe (c) do eixo Operações/SRE (`full-audit-round1-operacoes-*`, 2026-08-20). Não passou pelo protocolo de nota cega Claude↔Codex de 3 rodadas (nível 2-3 de `docs/engineering/change-risk-scale.md` — processo/documentação operacional, não decisão de arquitetura Type 1) — texto de trabalho, reabrir se um exercício real (§5) encontrar passo errado.

**Atualizado em 2026-08-21** (achado real da rodada focada de revisão, `NEXT_SESSION_PROMPT.md`): M5 fechou a lacuna de destino de notificação descrita abaixo como pendente — `infra/modules/alert-topic` (SNS→e-mail) está real, `alarm_actions` está wired em todos os alarmes de `reminder-observability`/`sqs-worker-queue`, e um teste real `OK→ALARM→OK` (`aws cloudwatch set-alarm-state`) já foi executado com sucesso contra a subscription confirmada. As referências a `infra/lib/*.ts` neste documento são do CDK pré-ADR-0009 — a infra real hoje é Terraform (`infra/modules/`). Continua real e não fechado: negações de autorização e acesso a GSI3/GSI6 não geram trilha de auditoria de segurança dedicada (achado distinto, maior, ver eixo Segurança); nenhum exercício humano ponta a ponta de incidente foi executado ainda (§7 abaixo continua vazio — o teste de alarme é transporte, não exercício de investigação/contenção/comunicação).

Escopo: os 4 runbooks exigidos por OPS-006 (falha de disparo, DLQ crescendo, provedor indisponível, IA indisponível) + matriz de severidade/escalonamento + template de post-mortem sem culpa + registro de exercícios. Não duplica o runbook de credencial comprometida, que já existe em `disaster-recovery.md` §7, nem o procedimento de restore, em `disaster-recovery.md` §6.

**Lacuna fechada em 2026-08-21 (ver nota no topo)**: os alarmes de `infra/modules/reminder-observability/main.tf` e `infra/modules/sqs-worker-queue/main.tf` têm `alarm_actions` reais apontando para `infra/modules/alert-topic` (SNS→e-mail), testado de verdade. **Lacuna real ainda aberta**: nenhuma trilha de auditoria dedicada para negação de autorização/acesso a GSI3/GSI6 (achado distinto do eixo Segurança, não corrigido por este documento).

## 1. Matriz de severidade e escalonamento

| Severidade | Critério | Exemplo | Resposta esperada | Comunicação |
|---|---|---|---|---|
| SEV-1 | Indisponibilidade total, exposição cross-tenant, vazamento de dado pessoal, credencial comprometida | Auth fora do ar; alarme de leitura GSI3/GSI6 por role errada | Incident Commander imediato, todos os canais mobilizados | Tenants afetados + DPO/ANPD se aplicável (`disaster-recovery.md` §7) em até 3 dias úteis |
| SEV-2 | Degradação significativa de um fluxo crítico, sem exposição de dado | Backlog do dispatch > 15min sustentado (alarme real, `reminder-observability.ts`); DLQ crescendo | Dono do pipeline assíncrono investiga em até 1h corrido | Nota interna; comunicação a tenants só se SLO de reminder freshness for violado de forma perceptível |
| SEV-3 | Degradação localizada, com fallback ou impacto limitado a poucos tenants | Erros intermitentes de 1 função crítica (alarme `${name}ErrorsAlarm`) sem impacto em backlog | Investigar no próximo ciclo útil, sem acordar ninguém | Nenhuma, salvo se virar SEV-2 |
| SEV-4 | Anomalia sem impacto observável ao usuário | Log de retry isolado, sem alarme disparado | Registrar, revisar em lote | Nenhuma |

Notificação real via SNS→e-mail já existe (ver nota no topo) — "mobilizar"/"investigar" hoje significa: o e-mail de alarme chega ao único operador do projeto (sem rotação de plantão real, sem PagerDuty), que então segue o runbook correspondente abaixo.

## 2. Runbook — Falha de disparo de lembrete (reminder-dispatch)

Sintoma: alarme `ReminderDispatchErrorsAlarm` (`infra/lib/reminder-observability.ts:46-57`) ou `DispatchQueueBacklogAlarm` (linhas 63-72) disparado; ou reminder freshness (`slo.md` §2) visivelmente violado no dashboard/queries manuais.
1. Confirmar severidade pela matriz acima (backlog sustentado > 15min = SEV-2).
2. Checar `CloudWatch Logs` de `ReminderDispatch` (via `SecureLogger`, correlável por `correlationId`) para a causa: timeout de dependência, erro de contrato, exceção não tratada.
3. Se erro isolado e não recorrente: sem ação, monitorar próxima janela de 5min (o alarme exige 3 janelas consecutivas — `evaluationPeriods: 3`).
4. Se sustentado: verificar se é problema de código (rollback via §6.6 abaixo) ou de dependência externa (DynamoDB throttling, SQS indisponível — ver AWS Health Dashboard).
5. Mensagens que excederem `maxReceiveCount` (`infra/lib/reminder-queue.ts`) vão para a DLQ — seguir runbook §3.
6. Após mitigação: confirmar que `DispatchQueueBacklogAlarm` volta a `OK`, que o backlog decresce continuamente (mesmo critério do SLO de pico extremo, `slo.md` §3), e abrir post-mortem se SEV-1/2 (§4 abaixo).

## 3. Runbook — DLQ crescendo (fila principal ou reminder-dispatch)

Sintoma: alarme de idade da DLQ (`reminder-queue.ts`, threshold 1h/4h já fixado — ver `slo.md` §1) ou profundidade crescente observada manualmente (sem alarme de profundidade dedicado hoje — gap reconhecido).
1. Identificar o padrão das mensagens na DLQ: mesma poison message repetida (bug determinístico) vs. mensagens variadas (dependência externa instável).
2. Poison message: **não fazer redrive sem antes corrigir a causa** — redrive de uma mensagem que sempre falha só reincide e reconsome `maxReceiveCount` até voltar à DLQ, mascarando o problema.
3. Dependência externa instável: aguardar recuperação confirmada (ex.: SES/WhatsApp/Telegram operacional) antes do redrive.
4. Redrive real (Camada 3 de teste ainda pendente contra AWS real, `NEXT_SESSION_PROMPT.md` — este passo é o procedimento a seguir quando executado, não evidência de que já foi testado): `aws sqs start-message-move-task` (SQS `StartMessageMoveTask`) ou console, sempre em lote pequeno primeiro, confirmando processamento com sucesso antes do lote completo.
5. Toda ocorrência de trabalho na DLQ deve ser reconstruível a partir do DynamoDB/outbox (`disaster-recovery.md` §5) — se uma mensagem não tiver como ser reconstruída, isso é bug de design a corrigir, não a aceitar como perda silenciosa.
6. Escalonamento em 4h sem resolução (limiar já fixado em `slo.md` §1) → SEV-1 se afetar múltiplos tenants continuamente.

## 4. Runbook — Provedor de notificação indisponível (SES/Telegram/WhatsApp)

Sintoma: taxa de rejeição/erro do provedor sobe (sem alarme dedicado por canal hoje — gap reconhecido; hoje só visível via `NotificationAttempt.status` consultado manualmente ou logs).
1. Confirmar se é o provedor (status page/erro consistente do SDK) ou erro de configuração/credencial própria.
2. Acionar o kill-switch do canal correspondente (`ADR-0005-security-kill-switch.md`, wiring real em `infra/modules/reminder-schedule/variables.tf`) para não amplificar custo/retry contra um provedor fora do ar.
3. Mensagens desse canal ficam retidas de forma recuperável (nunca descartadas) — outros canais do mesmo alerta (fan-out multi-canal, `capacity-model.md`) continuam tentando normalmente.
4. Ao confirmar recuperação do provedor: desligar o kill-switch, drenar o backlog retido, monitorar `DispatchQueueBacklogAlarm`.
5. Se o SLO de tentativa de entrega por canal (`slo.md` §6) for violado de forma sustentada: SEV-2; se afetar o único canal ativo de tenants sem alternativa configurada: SEV-1.

## 5. Runbook — IA/OCR indisponível (extração de documento)

Sintoma: uploads presos em estado não-terminal além do SLO (`slo.md` §4: 99,9% devem alcançar estado terminal em ≤15min) ou erro sustentado do provedor de IA/OCR.
1. Confirmar se é o provedor externo (Bedrock/OCR) fora do ar ou erro de contrato/parsing interno.
2. Documentos afetados devem permanecer em estado não-terminal recuperável (nunca promovidos a `CLEAN` por omissão — política fail-closed já fixada em `disaster-recovery.md` §4) — não há perda de dado, só atraso.
3. Se provedor externo: aguardar recuperação, monitorar fila de retry; se sustentado > SLO de p99 (`slo.md` §4, ≤30min), tratar como SEV-2 e comunicar atraso aos usuários afetados quando o produto tiver canal de UX para isso (hoje sem frontend — registrar internamente).
4. Reprocessar em lote ao normalizar, respeitando quota de custo (`TenantQuota`, `capacity-model.md`) para não gerar pico de custo pós-incidente.

## 6. Post-mortem sem culpa — template

Usar para todo incidente SEV-1/SEV-2, e para SEV-3 recorrente (mesma causa raiz 2+ vezes em 30 dias).

```
# Post-mortem — <título curto> (<data>)

Severidade: SEV-<N>
Duração: <início> – <fim> (<detecção> → <mitigação> → <resolução>)
Impacto: tenants afetados, SLO violado (qual e por quanto), dado pessoal envolvido (sim/não)
Detecção: como foi percebido (alarme / manual / relato) — se manual, registrar como gap de observabilidade

## Linha do tempo
<timestamps + eventos, sem juízo de culpa individual>

## Causa raiz
<técnica, nunca "erro do operador X" como causa raiz — perguntar "o que no sistema/processo permitiu isso" >

## O que funcionou / o que não funcionou
<inclui se o runbook usado (se houve) estava correto>

## Ações
| Ação | Dono | Prazo | Status |
|---|---|---|---|

## Recorrência
<esta causa raiz já apareceu antes? se sim, por que a ação anterior não preveniu?>
```

Publicar como `AuditEvent` tipo apropriado quando o incidente envolver segurança/dado pessoal (mesma regra já fixada em `disaster-recovery.md` §7); post-mortems operacionais puros (sem dado pessoal) ficam neste diretório (`docs/architecture/history/postmortems/`, criar sob demanda no primeiro incidente real — não criar pasta vazia antecipadamente).

## 7. Registro de exercícios (game days, testes de restore, testes de runbook)

Nenhum exercício foi executado até 2026-08-20 — consistente com o estágio pré-produção do projeto (zero incidente real, zero deploy validado ponta a ponta). Proporcionalidade (`docs/engineering/principles.md` #1): exercitar um runbook antes de existir infraestrutura real implantada e validada seria simulação sem lastro. Gatilho concreto para o primeiro exercício: primeiro deploy real confirmado bem-sucedido pela pipeline Terraform (`cd.yml`) + smoke test verde — nesse ponto, executar pelo menos 1 exercício de DLQ redrive (§3) e o teste de restore trimestral já definido (`disaster-recovery.md` §6) antes do primeiro usuário externo, ambos com registro nesta tabela.

| Data | Tipo | Runbook exercitado | Resultado | Ações decorrentes |
|---|---|---|---|---|
| 2026-08-21 | Teste de transporte de alarme (`aws cloudwatch set-alarm-state`, `OK→ALARM→OK` real em `exptrk-dev-reminder-producer-errors`) | Nenhum (só prova que SNS→e-mail entrega) | Sucesso — e-mail confirmado recebido na subscription confirmada | Nenhuma ação corretiva. **Não conta como exercício de §2-§5** (não testou investigação/contenção/comunicação) — primeiro exercício real de runbook completo continua pendente. |
