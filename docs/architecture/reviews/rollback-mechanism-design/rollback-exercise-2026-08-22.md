---
status: active
owner: engineering
authority: evidence
---

# Exercício real de `rollback.yml` contra `dev` — 2026-08-22

Motivação: rodada 3 focada (`full-audit-round1-focused-round3-summary.md`) — ambos os
revisores (Claude e Codex) concordaram que o achado central que impedia os 2 critérios de
rollback de bater o gate ≥9.0 era "`rollback.yml` nunca foi exercitado ponta a ponta contra uma
situação real". Este documento registra a evidência real que fecha esse achado.

## Sequência real executada

1. **Mudança trivial e reversível** (comentário, zero mudança de comportamento) em
   `test-ping-handler.ts` — força um novo bundle/versão publicada sem risco algum.
2. **Segundo deploy real** via `cd.yml` (PR #21, run `32548493395`): confirmado via
   `aws s3 cp s3://exptrk-dev-deploy-manifests/pointers/current-healthy.json -` — novo
   manifesto `32548493395-1` com `previousHealthyDeploymentId: "32547276849-1"` (o primeiro
   deploy da entrega 1) e `exptrk-dev-test-ping-handler` em `version: "2"` (as outras 12
   funções continuam em `v1`, confirmando que só a função tocada avançou de versão).
3. **Rollback real disparado** via `gh workflow run rollback.yml -f environment=dev
   -f deployment_id= -f "confirmation=ROLLBACK dev"` (target vazio = usa
   `previousHealthyDeploymentId` automaticamente, exatamente o caminho "undo do último
   deploy" que o design previa). Run real: `32548585356`, concluído com sucesso em ~1min.
4. **Verificação real independente** (fora do próprio workflow, via AWS CLI direto):
   - `aws lambda get-alias --function-name exptrk-dev-test-ping-handler --name live` →
     `FunctionVersion: "1"` — confirma que o alias voltou de fato para a versão anterior.
   - `pointers/current-healthy.json` restaurado ao manifesto `32547276849-1` original
     (bit-a-bit idêntico ao que existia antes do segundo deploy).
   - `rollbacks/rollback-32548585356-1.json` real: `routingStatus: "routing_restored"`,
     `healthStatus: "health_verified"`, `status: "completed"`.
   - Chamada HTTP real contra o endpoint real da API (`GET /test/ping` sem token) continuou
     retornando `401` (não 500/502) — confirma que a cadeia real (API Gateway→autorizer
     JWT→integração→alias `live`→Lambda) segue intacta depois do rollback.

## O que isso prova, e o que ainda não prova

Prova, com evidência real (não estrutural/simulada): o caminho de sucesso completo do
mecanismo — resolução de target via `previousHealthyDeploymentId`, validação de manifesto,
atualização real dos 13 aliases, verificação, pós-check, persistência do registro, avanço do
ponteiro `current-healthy` de volta.

**Não testado neste exercício** (ainda achado real, menor, não bloqueante): o caminho de
**falha parcial + compensação** (`Compensate on failure`) nunca foi exercitado de verdade — o
rollback real acima teve sucesso na primeira tentativa, então esse passo nunca rodou (aparece
como "skipped" no log do run real). A correção do bug de `id:` ausente (rodada 3) foi validada
por leitura de código e lógica, não por uma falha real induzida. Forçar uma falha parcial real
(ex. revogar temporariamente uma permissão de uma função no meio do rollback) é um exercício
maior, de risco mais alto, não justificado agora só para fechar este achado secundário.

## Nota final revisada (pós-exercício real)

| Critério | Nota revisada | Gate 9.0? |
|---|---:|---|
| QE — Delivery, Release & Recovery Discipline | 9.3 | **Sim** |
| SRE — Prontidão de Deploy, Rollback & Mudança Operacional | 9.1 | **Sim** |

Ambos os critérios agora têm evidência real do caminho de sucesso completo (não só desenho e
teste estrutural). Achados residuais explicitamente registrados, não escondidos, não
bloqueantes para o gate: caminho de compensação de falha parcial não exercitado com falha real
induzida; ausência de validação diferenciada por blast radius de schema/GSI/KMS (achado do
Codex na rodada 3, permanece real, candidato a design futuro, não fechado aqui).
