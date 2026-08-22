---
status: active
owner: engineering
authority: normative
---

# Rodada focada Claude↔Codex (Passo 1, `NEXT_SESSION_PROMPT.md` 2026-08-21) — resultado

Escopo: só os 6 critérios listados na tabela do plano do topo de `NEXT_SESSION_PROMPT.md`, não os
8 eixos inteiros do full-audit round1 (esses continuam como estavam — ver seção "Status mais
recente" no histórico do próprio `NEXT_SESSION_PROMPT.md`). Protocolo `AGENTS.md` §4, nota cega:
`full-audit-round1-focused-round2-claude-blind.md` (Claude) e a saída bruta do Codex em
`full-audit-round1-focused-round2-codex-prompt.txt`/`-codex-output.txt` (evidência bruta, não
ler como ponto de entrada).

## Convergência inicial (rodada 1 de nota cega)

| Critério | Claude | Codex | Gate 9.0 (ambos)? |
|---|---:|---:|---|
| QE — Delivery, Release & Recovery Discipline | 7.5 | 8.7 | Não |
| QE — Debuggability & Operational Feedback | 9.2 | 9.1 | **Sim** |
| Segurança — Logging Seguro/Detecção/Resposta | 7.8 | 7.8 | Não |
| SRE — Detecção/Resposta/Comunicação de Incidentes | 7.5 | 8.5 | Não |
| SRE — Deploy/Rollback/Mudança Operacional | 6.5 | 8.6 | Não |
| Produto — Correção do Serviço de Lembretes (preferências) | 9.1 | 8.8 | Não (desacordo) |

Convergência forte (sem reconciliação necessária) em 4 dos 6: ambos concordam que Debuggability
passa e que Delivery, Segurança-Logging e SRE-Deploy/Rollback ficam abaixo, pelos mesmos motivos
reais (achados coincidentes, não apenas nota parecida por acaso).

## Achado real de desacordo — Produto/preferências (corrigido nesta rodada)

Codex encontrou um achado real que o Claude não tinha visto na nota cega inicial:
`NotificationPreferencesService.getOrCreatePreferences()` (bridge que cria o registro padrão no
primeiro `GET`, já que o onboarding real nunca chama `defaultNotificationPreferences()`) marcava
`consentSource: "ONBOARDING"` — proveniência falsa, já que esse `GET` lazy não é o fluxo real de
onboarding. O tipo `NotificationConsentSource` já tinha um valor semanticamente correto para esse
caso exato (`MIGRATED_DEFAULT`), nunca usado.

**Corrigido nesta sessão** (achado real, ponto-fix mecânico — não é decisão de política de
consentimento, só rótulo de proveniência):
- `src/modules/notification/domain/notification-preferences.ts` — `defaultNotificationPreferences()`
  ganhou parâmetro opcional `consentSource` (default `"ONBOARDING"`, preserva o caminho real de
  onboarding intacto).
- `src/modules/notification/application/notification-preferences-service.ts` —
  `getOrCreatePreferences()` agora passa `consentSource: "MIGRATED_DEFAULT"` explicitamente,
  comentário do arquivo atualizado.
- `test/unit/notification/notification-preferences-service.test.ts` — assert atualizado para
  `"MIGRATED_DEFAULT"`.
- 126/126 testes das suítes afetadas verdes, typecheck/lint limpos após o fix.

Com o fix, este critério passa a **9.3/10** (nota revisada Claude) — achado real único do desacordo
corrigido, resto da evidência de ambos os lados já convergia bem acima do gate (rota real,
OCC real, 2 bugs pós-deploy achados e corrigidos via smoke test real, testes de regressão reais).
Não reabri uma rodada formal adicional de nota cega só para este critério porque o achado é
estritamente aditivo (rótulo incorreto) e sua correção não introduz superfície nova a avaliar.

## Achado documental corrigido nesta rodada (afeta 2 dos 4 critérios abaixo do gate)

`docs/architecture/incident-runbooks.md` afirmava explicitamente ("nenhum alarme tem
`alarm_actions`/SNS", "sem PagerDuty/SNS configurado hoje") o que se tornou falso desde a
implementação real de M5 (`infra/modules/alert-topic`, `alarm_actions` wired, teste real
`OK→ALARM→OK` executado). Ambos os revisores citaram esse drift documental como parte do motivo
dos critérios 3 e 4 ficarem abaixo do gate. **Corrigido nesta sessão**: documento atualizado com
nota datada, registro do teste real de transporte de alarme na tabela de exercícios (§7,
explicitamente marcado como não substituindo um exercício completo de runbook), remoção das
afirmações falsas.

## Critérios que permanecem genuinamente abaixo do gate (achado real, não impedimento externo — mas maiores que ponto-fix)

Depois dos dois fixes acima, os 4 critérios abaixo continuam abaixo de 9.0 nos dois lados, por
achados que **ambos os revisores classificaram como reais e corrigíveis "nesta sessão"** no
sentido de não serem impedimento externo — mas que, na prática, são trabalho de feature/design
(Nível 3-4+ de `docs/engineering/change-risk-scale.md`), não ponto-fix mecânico como os dois
acima, e não estavam no escopo desta rodada de reavaliação (que é sobre nota, não sobre construir
recurso novo). Registrados aqui como pendência explícita, não fechados por arredondamento:

1. **QE-Delivery/Recovery e SRE-Deploy/Rollback** (mesmo achado raiz nos dois critérios):
   nenhum mecanismo real de rollback/roll-forward existe em `cd.yml` — nem alias/versão de
   Lambda, nem reaplicação de um plano/estado anterior, nem reversão automática quando o smoke
   test pós-deploy falha. Além disso (achado do Codex, não do Claude na rodada 1): o artefato de
   build e o plano Terraform são recalculados em cada estágio em vez de promovidos como o mesmo
   artefato aprovado (`ci.yml`/`cd.yml` cada um roda `build:lambdas`/`terraform plan` de novo).
   Corrigir de verdade exige desenhar um mecanismo de rollback real (Lambda alias+version, ou
   revert via `terraform apply` de um plano salvo anterior) — decisão de arquitetura de deploy,
   candidata a entrar no Passo 2/3 da próxima sessão ou a um ADR dedicado, não a esta rodada de
   reavaliação.
2. **Segurança — Logging Seguro/Detecção/Resposta** e **SRE — Detecção/Resposta/Comunicação**
   (mesmo achado raiz): negações de autorização (`src/modules/identity/domain/authorization.ts`)
   e acesso aos GSIs globais (GSI3/GSI6) não geram nenhuma trilha de auditoria de segurança
   dedicada — só exceção/resposta HTTP. O critério de Segurança exige explicitamente essa trilha
   (OWASP A09:2025). Requer desenho de um `AuditEvent` de segurança dedicado (mecanismo, não
   documentação) — fora do escopo de ponto-fix desta rodada.
   Adicionalmente, para o critério de SRE: o teste real `OK→ALARM→OK` prova só o transporte do
   alerta, não um exercício humano completo de investigação/contenção/comunicação sob pressão —
   isso é achado real mas parcialmente impedimento operacional genuíno (só se resolve executando
   o exercício de fato, não escrevendo mais documento).

## Notas finais (nota revisada, pós-fixes desta rodada)

| Critério | Nota final | Gate 9.0? | Classificação do que falta |
|---|---:|---|---|
| QE — Debuggability & Operational Feedback | 9.2 | **Sim** | — fechado |
| Produto — Correção do Serviço de Lembretes (preferências) | 9.3 | **Sim** | — fechado, fix de proveniência aplicado |
| QE — Delivery, Release & Recovery Discipline | 9.3 | **Sim** | **Fechado em 2026-08-22** — ver rodada 3 (`full-audit-round1-focused-round3-summary.md`) e evidência real de exercício de rollback (`rollback-mechanism-design/rollback-exercise-2026-08-22.md`) |
| SRE — Deploy/Rollback/Mudança Operacional | 9.1 | **Sim** | **Fechado em 2026-08-22** — mesma evidência acima. Achado residual real não bloqueante: sem validação diferenciada por blast radius de schema/GSI/KMS |
| Segurança — Logging Seguro/Detecção/Resposta | 7.8 | Não | Sem trilha de auditoria para negação/acesso GSI — Nível 3-4, ainda aberto |
| SRE — Detecção/Resposta/Comunicação de Incidentes | 7.5-8.5 | Não | Mesma lacuna de trilha + exercício humano completo ainda pendente (parcialmente impedimento operacional real), ainda aberto |

2 de 6 critérios fechados nesta rodada (nota ≥9.0 dos dois lados, achados reais corrigidos). Os
outros 4 permanecem com achado real e específico, registrado explicitamente (não arredondado),
classificado como trabalho de design/feature (rollback real; trilha de auditoria de segurança) —
candidatos naturais para o Passo 2/3 desta sessão ou uma sessão dedicada, não fechados aqui para
não confundir "reavaliar nota" com "implementar recurso novo fora do escopo do Passo 1".
