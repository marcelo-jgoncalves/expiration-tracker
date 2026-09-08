# Full audit round 2 — Eixo Operações, SRE e Continuidade de Negócio — Claude (reconciliação pós-Codex)

Minha nota cega inicial (`full-audit-round2-operacoes-claude.md`) foi **5,18/10**, baseada numa leitura errada do `rollback.yml`: eu tinha classificado o mecanismo como "rollback real de frontend (S3/CloudFront), sem cobertura de Lambdas/infra". O Codex (nota cega independente, `full-audit-round2-operacoes-codex-output-round1.txt`) corrigiu isso com evidência que verifiquei e confirmei diretamente:

## Achado aceito integralmente (Codex estava certo, eu estava errado)

`rollback.yml` **não é** um mecanismo de frontend — ele reverte **aliases de Lambda** via manifesto de `lambda_published_versions` (`infra/outputs.tf:63`, mapa manualmente curado `function_name → published_version`). Confirmei ao ler `rollback.yml:114-129`:

```
fn_count=$(echo "$manifest" | jq '.functions | length')
...
if [ "$fn_count" != "13" ]; then
  echo "::error::Manifest has $fn_count functions, expected exactly 13"
```

O workflow **hardcoda a expectativa de exatamente 13 funções** no manifesto. `lambda_published_versions` hoje tem 34 entradas (confirmado por leitura de `infra/outputs.tf:63-96` — dezenas de `module.*.function_name = module.*.published_version`). **Isso significa que o rollback, hoje, falha determinística e imediatamente com "Manifest has 34 functions, expected exactly 13" antes de reverter qualquer alias** — nunca foi atualizado desde que o manifesto cresceu de 13 para 34 funções rastreadas. É um mecanismo real, bem desenhado (confirmação textual, manifesto imutável, ordem de restauração), mas **está quebrado em produção hoje**, não "não exercitado" como eu e a Rodada 1 havíamos classificado.

Isso muda a natureza do achado: não é mais um impedimento externo ("nunca testado por falta de incidente real") — é um **bug real e verificável de nível 5**, sem incidente ou tráfego real necessário para confirmá-lo (a contagem hardcoded vs. a contagem real do output são fatos estáticos, comparáveis por leitura). Não corrijo aqui (instrução da tarefa: documentar achados nível 3+, não implementar).

Segundo achado do Codex que confirmo por leitura direta (`infra/main.tf`, contagem `source = "./modules/lambda-function"` = 61 vs. `lambda_published_versions`/`lambda_function_names` com 34 entradas cada): **27 das 61 Lambdas reais (44%) não entram no manifesto de rollback nem no smoke test pós-deploy** — mesmo se o bug dos "13" for corrigido, essas 27 nunca teriam alias revertido nem seriam verificadas no smoke test do `cd.yml`. Isso é estrutural, não incidental: o output é uma lista manualmente mantida que não foi atualizada ao ritmo de crescimento do projeto.

## Nota revisada por critério (aceitando os achados do Codex)

| # | Critério | Peso | Nota (Rodada 1 minha) | Nota revisada | Motivo da revisão |
|---:|---|---:|---:|---:|---|
| 1 | SLIs/SLOs & Error Budgets | 16% | 5.5 | 4.5 | Convirjo com o Codex — não achei instrumentação de error-budget-gate-release, minha nota original não tinha peso suficiente pra isso. |
| 2 | Observabilidade por tenant | 11% | 4.0 | 4.0 | Sem mudança — concordância total com o Codex. |
| 3 | Detecção/Resposta a incidentes | 15% | 5.0 | 5.5 | Aceito a nota do Codex — a matriz+4 runbooks+SNS testado valem um pouco mais que minha nota original, mesmo com o drift documental. |
| 4 | Pipeline assíncrono & backlog | 14% | 6.0 | 6.0 | Concordância — cobertura sistemática real via módulo, sem alarme de profundidade/redrive real. |
| 5 | Backup/Restore/RTO/RPO | 18% | 5.0 | 3.5 | Aceito a nota do Codex, mais rigorosa: maior peso do eixo, e "documentado mas nunca restaurado" é exatamente o padrão de risco que `joint-review-criteria.md` cita como o mais repetido do projeto. |
| 6 | Deploy/Rollback | 10% | 6.0 | **2.5** | Revisão para baixo mais forte do eixo — o rollback não é "parcial" (só frontend), é **quebrado por um bug de contagem hardcoded** que nem chega a executar contra o manifesto real. Aceito a nota do Codex integralmente. |
| 7 | Capacidade/Degradação | 9% | 5.0 | 4.5 | Aceito a nota do Codex — mais rigorosa quanto a "números largamente estimados". |
| 8 | Post-mortem/Exercícios | 7% | 4.5 | 3.5 | Aceito a nota do Codex — mais rigorosa. |

**Nota ponderada revisada**: `16×4.5 + 11×4.0 + 15×5.5 + 14×6.0 + 18×3.5 + 10×2.5 + 9×4.5 + 7×3.5 = 72+44+82.5+84+63+25+40.5+24.5 = 435.5 → 4.36/10`

Converjo, após reconciliação, com a nota final do Codex: **4,36/10** (idêntica, não coincidência — usei a mesma fundamentação de evidência que ele trouxe, sem arredondar).

## Por que não é mais "impedimento externo genuíno" em todos os 8 critérios (diferença real da Rodada 1)

A Rodada 1 (2026-08-20) classificou todos os 8 critérios como tendo pelo menos um bloqueador genuinamente externo (falta de tráfego/incidente/deploy real). Isso permanece verdadeiro para os critérios 1, 2, 5, 7, 8. Mas o **critério 6 (Deploy/Rollback) não é mais um caso de "não exercitado por falta de oportunidade"** — é um bug estático, descobrível e corrigível por leitura de código, sem precisar de incidente real algum. Isso é uma categoria de achado diferente da que justificou a nota baixa sem fix na Rodada 1: aqui há uma correção mecânica clara e pequena (sincronizar o `13` hardcoded com o tamanho real do manifesto, ou melhor, tornar a checagem dinâmica against uma lista de nomes esperados, mais o achado maior de completar a lista de 34→61) — nível 4-5 pela superfície que toca (`rollback.yml` + `outputs.tf`), então documentado aqui e não corrigido, mas **não é** um impedimento externo — é dívida real, decidível, priorizável já.
