---
status: active
owner: engineering
authority: normative
---

# Rodada 3 focada — reavaliação dos 2 critérios de rollback pós-entrega 1

Escopo: os 2 critérios que ficaram abaixo do gate na rodada 2 pelo mesmo achado raiz (ausência de
rollback real), reavaliados agora que a entrega 1 (`docs/architecture/reviews/
rollback-mechanism-design/codex-round2-final-design.md`) foi implementada e deployada.

## Convergência inicial (nota cega)

| Critério | Claude | Codex |
|---|---:|---:|
| QE — Delivery, Release & Recovery Discipline | 9.1 | 8.8 |
| SRE — Prontidão de Deploy, Rollback & Mudança Operacional | 9.0 | 8.5 |

Desacordo real: eu tinha marcado os dois como batendo o gate; Codex encontrou 2 achados
concretos que eu não vi na nota cega, além de reforçar um terceiro que eu já sabia mas não
considerei suficiente para reabrir.

## Achados reais do Codex, corrigidos nesta rodada

1. **Bug real de classificação de falha em `rollback.yml`**: o passo "Compensate on failure"
   escrevia `status=...` em `$GITHUB_OUTPUT`, mas não tinha `id:` — nada consegue ler esse
   output. O passo final ("Record failed/compensated rollback") só lia
   `steps.rollback.outputs.status`, que **nunca é setado** numa falha no meio do loop de
   atualização de aliases (a linha que o define só é alcançada se o loop terminar sem erro).
   Resultado: uma falha parcial **compensada com sucesso**, ou uma **compensação que também
   falhou**, seria registrada incorretamente como `failed_before_routing_change` (como se nada
   tivesse sido tocado) — informação de auditoria falsa exatamente no cenário mais crítico
   (rollback que deu errado). Corrigido: `id: compensate` adicionado, resolução de status agora
   prioriza `steps.compensate.outputs.status`.
2. **Validação de manifesto incompleta**: só checava `schemaVersion`/`environment`/contagem de
   13 funções — um manifesto malformado com 13 nomes errados (mesma contagem, nomes diferentes)
   ou uma versão não-numérica passaria. Corrigido: comparação do conjunto exato de nomes de
   função contra o manifesto `current-healthy` real, e validação de que toda versão bate o
   padrão `^[0-9]+$`.
3. **Pós-check do rollback mais raso que o do `cd.yml`**: só verificava a tabela DynamoDB,
   enquanto `cd.yml` verifica tabela+Cognito+SQS+aliases. Corrigido: alinhado para verificar
   também Cognito e a fila de dispatch (verificação de alias já é feita num passo anterior
   dedicado).

## Achados que permanecem, registrados explicitamente, não escondidos

- **`rollback.yml` nunca foi exercitado ponta a ponta contra uma situação real** — só
  `terraform test`/`plan` e o smoke estrutural do `cd.yml`. Ambos os revisores concordam que
  isso é o achado central que ainda impede o 9.0 limpo nos dois critérios: "evidência de
  recuperação" e "prontidão de deploy/rollback" pedem, na própria definição, prova de que o
  mecanismo funciona sob uma situação real, não só que ele foi bem desenhado e testado
  estruturalmente. **Ação tomada nesta mesma sessão para fechar esse gap com evidência real**:
  uma mudança trivial e reversível (comentário, sem mudança de comportamento) em
  `test-ping-handler.ts` força um segundo deploy real → segundo manifesto real → primeiro
  exercício real de `rollback.yml` contra `dev`. Resultado registrado em
  `docs/architecture/reviews/rollback-mechanism-design/rollback-exercise-2026-08-22.md`.
- **Ausência de validação diferenciada por blast radius** para mudança de schema/GSI/KMS/
  provider — Codex reforça que isso "não satisfaz a definição normativa do critério" mesmo
  registrado como fora de escopo explícito. Este é um achado real, não impedimento externo, mas
  é trabalho de design maior (validação proporcional por tipo de mudança) — não fechado nesta
  rodada, candidato a uma "entrega 3" ou revisão futura do design de deploy.

## Notas finais (pós-fixes + exercício real de rollback, ver documento de evidência)

Ver `docs/architecture/reviews/rollback-mechanism-design/rollback-exercise-2026-08-22.md` para o
resultado real do exercício e a nota final revisada dos dois critérios à luz dessa evidência.
