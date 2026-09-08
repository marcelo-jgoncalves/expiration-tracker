# Full audit round 2 — Eixo Operações, SRE e Continuidade de Negócio — Resumo

Protocolo: `AGENTS.md` §4. Critérios: `docs/engineering/joint-review-criteria.md` §"Eixo: Operações, SRE e Continuidade de Negócio" (8 critérios, pesos 16/11/15/14/18/10/9/7%). Baseline: `full-audit-round1-operacoes-summary.md` (2026-08-20, Claude 5,11/Codex 3,92, ambos <9,0 em todos os 8 critérios, fechado como impedimento externo legítimo em todos os critérios).

## Motivo da reabertura

Crescimento real do sistema desde a Rodada 1 (2026-08-20 → 2026-09-07): de ~32 Lambdas nomeadas para **61 invocações reais do módulo `lambda-function`** em `infra/main.tf`; de poucas filas para **18 filas via o módulo genérico `sqs-worker-queue`** + 1 fila standalone (D-228); rollback mechanism novo (`rollback.yml`, inexistente na Rodada 1); alarmes novos (D-228 `GuestCredentialDeliveryFailures`, D-229 WhatsApp). Reabertura por volume de mudança de escopo, mesmo padrão de `full-audit-round2-produto-multitenant-*` (E-016).

## Rodadas de nota cega

- **Rodada 1 (blind)**: Claude 5,18/10 (`full-audit-round2-operacoes-claude.md`), Codex 4,36/10 (`full-audit-round2-operacoes-codex-output-round1.txt`, prompt em `full-audit-round2-operacoes-codex-prompt.txt`).
- **Rodada 2 (reconciliação)**: Claude revisou a nota para baixo após aceitar um achado do Codex que eu tinha lido errado (`full-audit-round2-operacoes-claude-round2.md`) — convergência em **4,36/10** (idêntico ao Codex, sem arredondamento artificial, chegado por reconciliação de evidência real, não por concessão).

Duas rodadas reais de debate (blind + reconciliação), não três — decisão consciente de não forçar uma terceira rodada puramente formal quando a divergência de fundo (o achado do rollback quebrado) já convergiu por completo na Rodada 2 com evidência estática verificável por ambos os lados (mesmo raciocínio de "diminishing returns" que a Rodada 1 já havia registrado, aqui aplicado à convergência em vez de à divergência aceita).

## Achado principal (nível 5, corrige uma leitura errada da própria Rodada 1 desta auditoria)

O `rollback.yml` (`.github/workflows/rollback.yml`, introduzido depois da Rodada 1 original) **não é** um mecanismo de rollback de frontend apenas — ele reverte aliases de Lambda via um manifesto (`infra/outputs.tf`'s `lambda_published_versions`, mapa manualmente curado `function_name → published_version`). O workflow **hardcoda a expectativa de exatamente 13 funções no manifesto** (`rollback.yml:128`: `if [ "$fn_count" != "13" ]`), mas o manifesto real hoje tem **34 entradas** — o rollback falha determinística e imediatamente com `"Manifest has 34 functions, expected exactly 13"` antes de reverter qualquer alias. Verificado por leitura direta de `rollback.yml:114-129` e `infra/outputs.tf:63-96`, sem depender de incidente real algum — é um bug estático, não uma lacuna de "nunca exercitado por falta de oportunidade".

Achado derivado (nível 4-5): mesmo corrigindo o `13` hardcoded, **27 das 61 Lambdas reais (44%) não entram no manifesto/smoke test/rollback** — `lambda_published_versions`/`lambda_function_names` são listas manualmente mantidas que pararam de crescer junto com `infra/main.tf`.

## Outros achados reais (nível 3-4), não corrigidos nesta sessão (fora de escopo — auditoria, não implementação)

1. Alarme `GuestCredentialDeliveryFailures` (D-228, `infra/main.tf:564`) diz "investigate via runbook" mas `docs/architecture/incident-runbooks.md` não menciona essa fila em nenhum lugar — alarme existe tecnicamente, runbook prometido não existe.
2. Mesma lacuna para as filas WhatsApp novas (D-229) — DLQ+alarme herdados do módulo genérico, mas nenhuma resposta operacional específica ao canal (rate limits/rejeição de template/credenciais Meta).
3. `incident-runbooks.md` desatualizado desde 2026-08-21: referência cruzada quebrada (§2 cita "rollback via §6.6", documento só tem 7 seções) e caminhos de arquivo CDK pré-Terraform (`infra/lib/*.ts`) ainda citados nos runbooks individuais (§2-§5), apesar do aviso genérico no topo do documento.
4. `infra/tests/stack.tftest.hcl` afirma `length(output.lambda_function_names) == 34` — **passou de fato** (`terraform test` rodado com `AWS_PROFILE=claude-dev`, 23/23 real contra `dev`), não é um teste quebrado; mas é uma asserção vazia quanto à completude (verifica que a lista manual tem 34 nomes distintos, nunca compara com as 61 Lambdas reais) — mesma raiz do achado principal.
5. Cobertura DLQ+alarme é sistemática **só** para filas via o módulo genérico `sqs-worker-queue` (18 instâncias, todas com DLQ+alarme de idade por construção) — filas/destinos especiais (Streams, Step Functions) dependem de implementação manual caso a caso (D-228 replicou o padrão à mão em vez de reusar o módulo).
6. D-208 (migração ARM64, 52→61 Lambdas hoje) não teve plano de rollback específico documentado além da reversão genérica da variável `architectures` — tecnicamente possível pelo desenho do módulo, mas nunca formalizado como procedimento.
7. "Verificação ao vivo pós-merge" (usada extensivamente em D-208 a D-230) é disciplina cultural registrada em `decisions-log.md`, não processo codificado em CI/CD nem checklist obrigatório — depende de o autor da mudança lembrar de rodar comandos AWS manuais.

## Nota final

**4,36/10**, convergida entre Claude e Codex na Rodada 2, muito abaixo do gate de 9,0. Diferente da Rodada 1, nem todos os critérios têm impedimento puramente externo desta vez — o achado do rollback (critério 6, Deploy/Rollback) é um bug real e corrigível por leitura estática, não uma lacuna de "falta de tráfego/incidente real". Critérios 1, 2, 5, 7, 8 mantêm impedimento externo genuíno (sem dado de produção real, sem restore/game day/load-test executado). Este eixo permanece **aberto** — condição de reabertura futura sugerida: (a) o bug do `rollback.yml` ser corrigido e o manifesto passar a cobrir as 61 Lambdas reais; (b) `incident-runbooks.md` ser atualizado para refletir Terraform/alarmes novos; (c) o primeiro exercício real de DLQ redrive ou restore trimestral ser executado (gatilho já definido em `incident-runbooks.md` §7).

## Commits

Ver commit desta sessão (`git log`, mensagem referenciando E-020) para os arquivos desta rodada: `full-audit-round2-operacoes-{claude,claude-round2,codex-prompt,codex-output-round1,summary}.{md,txt}`.
