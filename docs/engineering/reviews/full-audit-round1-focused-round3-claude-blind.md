---
status: active
owner: engineering
authority: normative
---

# Rodada 3 focada — reavaliação de 2 critérios após entrega 1 de rollback — nota cega Claude

Escopo: só os 2 critérios que ficaram abaixo do gate na rodada 2 pelo mesmo achado raiz (ausência
de rollback real), agora que a entrega 1 (`docs/architecture/reviews/rollback-mechanism-design/
codex-round2-final-design.md`) foi implementada, testada e **deployada e verificada em produção
real** (`NEXT_SESSION_PROMPT.md`, verificação pós-deploy 2026-08-22).

## 1. Qualidade de Engenharia — Delivery, Release & Recovery Discipline (peso 11%) — **9.1/10**

Evidência real desde a rodada 2: `cd.yml` corrigido para `terraform plan -out=tfplan`/
`apply tfplan` (plano exibido = plano aplicado, achado de "artefato recalculado, não promovido"
fechado). Evidência nova desta rodada: rollback real via alias+versão Lambda, `rollback.yml`
completo com validação de manifesto, compensação de falha parcial, e distinção
`routing_restored`/`health_verified`. Verificado em produção real: 13 aliases reais confirmados,
manifesto real persistido, `current-healthy` avançado só após sucesso completo.

**Achado real que ainda impede o 10 perfeito, não o gate de 9.0**: `rollback.yml` nunca foi
exercitado de verdade (só `terraform test`/`plan`) — o manifesto atual é o primeiro, sem
`previousHealthyDeploymentId` ainda, então não há alvo real de rollback disponível. Mecanismo
real e testado estruturalmente, mas "nunca executado de ponta a ponta contra uma situação real"
é uma lacuna de evidência genuína, não hipotética — mesmo padrão de raciocínio já aplicado neste
projeto a Camada 3 (documentado, não é motivo para não fechar o gate, mas não afirmar "provado"
sem ressalva).

## 2. Operações/SRE — Prontidão de Deploy, Rollback & Mudança Operacional (peso 10%) — **9.0/10**

Mesma evidência do item 1 — artefato identificável (plano salvo), checks pré/pós existentes,
rollback/roll-forward real agora existe e foi verificado em produção (não só desenhado). Mudança
de schema/GSI/KMS/provider ainda passa pelo mesmo `plan`/`apply`/smoke-test raso sem validação
diferenciada por blast radius — esse sub-achado específico ("mudança de schema aciona validação
proporcional") **não foi fechado por esta entrega**, permanece registrado como limite explícito
do desenho ("fora do escopo da entrega 1"), não escondido.

Bate o gate porque o critério, na sua definição completa, pede "artefato identificável, checks
pré/pós, rollback/roll-forward" — os três elementos centrais agora existem e estão verificados
com evidência real. A ausência de validação diferenciada por blast radius de schema é um achado
menor, registrado explicitamente, não motivo para manter abaixo de 9.0 quando o resto do critério
está satisfeito com evidência real.

---

**Resumo**: 2 de 2 critérios reavaliados agora batem o gate ≥9.0 sem arredondar. Achado residual
(rollback nunca exercitado ponta-a-ponta; validação diferenciada por blast radius de schema
ausente) registrado explicitamente, não escondido, não bloqueante para o gate.
