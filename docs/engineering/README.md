# docs/engineering/ — Índice e Mapa de Autoridade

```text
Rubrica de qualidade:     CONGELADA (01-engineering-quality-criteria.md)
Fitness functions:        ativas (02-engineering-fitness-functions.md), enforcement real em CI
Full-audit 9 eixos:       CONCLUÍDO em 2026-08-20 (9/9 avaliados, só Contexto bateu o gate ≥9.0 originalmente) — achados remediados/reavaliados em rodadas posteriores por eixo, ver decisions-log.md/pilot-readiness-program.md, não re-enumerado aqui
Programas posteriores:    test-engineering-standard.md (E-010, APPROVED), logging-observability-standard.md (E-011, APPROVED), definition-of-done.md (E-012, APPROVED — gate por item de todo list), Consolidation + Pilot Readiness Program (pilot-readiness-program.md/pilot-readiness-assessment.md, CONDITIONAL GO)
Last verified:            2026-08-29 (reconciliação de engenharia de contexto — ver docs/architecture/README.md para o estado vigente completo, não duplicado aqui)
```

Este diretório trata de **como o trabalho de engenharia é medido e revisado** (rubrica, critérios por eixo, protocolo de debate, achados de auditoria) — não confundir com `docs/architecture/`, que trata do que o sistema É (design, modelo de dados, decisões de arquitetura). Se a dúvida for "o GSI3 é consultável por quem", vá para `docs/architecture/`; se for "que nota isso tira / que processo formal se aplica aqui", este diretório é o certo.

## Precedência de fontes (quando houver divergência)

Mesma regra de `docs/architecture/README.md` — `AGENTS.md` (raiz) sempre vence sobre conteúdo deste diretório; um achado de auditoria (`reviews/full-audit-*-summary.md`) é evidência de uma rodada específica, nunca redefine os pesos/critérios de `joint-review-criteria.md` (ele mesmo linka para lá em vez de duplicar, ver seu próprio rodapé "Como adicionar um novo eixo").

## Quando carregar o quê (roteamento por tipo de tarefa)

| Sua tarefa é... | Carregue |
|---|---|
| Rodar o protocolo Claude↔Codex num eixo específico (`AGENTS.md` §4) | `joint-review-criteria.md` (seção do eixo) + o `full-audit-round1-<eixo>-summary.md` mais recente em `reviews/`, se existir (retomar em vez de reabrir do zero) |
| Entender que nota um achado específico do código tira / que critério ele afeta | `joint-review-criteria.md` (não precisa da rubrica congelada nem do bibliography) |
| Julgar se um teste automatizado ou drill operacional é válido/de qualidade suficiente (gate binário, critério ponderado, nota mínima) | `test-engineering-standard.md` — régua concreta que `joint-review-criteria.md`'s critério "Test Effectiveness & Coverage Discipline" passa a referenciar |
| Decidir se uma mudança precisa de ADR/protocolo formal ou é correção mecânica | `change-risk-scale.md` (a régua concreta) — `AGENTS.md` §4 só distingue os dois extremos de forma binária |
| Marcar um item de todo list de código como `completed` | `definition-of-done.md` — gate por item (não por PR/wave inteira): unidade de conclusão, gate por nível de risco, registro mínimo de evidência |
| Saber que comando roda em qual gate (PR vs. deploy) | `quality-gate-tiers.md` — mapeia Tier A/B/C (CI `guardrails`, `dynamodb-integration`, Camada 3 ainda pendente) aos comandos reais de `package.json` |
| Entender uma exceção/vulnerabilidade aceita (ex. EX-001) e seu prazo de revisão | `exceptions.md` |
| Ver o histórico completo de decisões de engenharia (não de arquitetura) com motivo | `decisions-log.md` — E-000 em diante, mesmo padrão de `docs/architecture/decisions-log.md` mas para decisões de processo/qualidade, não de sistema |
| Ver onde Claude e Codex genuinamente discordaram e como foi resolvido | `disagreement-log.md` |
| Entender a origem da rubrica de 12 critérios/gates G1-G6 (histórico, pré full-audit) | `01-engineering-quality-criteria.md` (CONGELADA — mudança exige nova rodada formal, não edição direta) + `00-research-bibliography.md` para as fontes que a fundamentam |
| Ver o estado exato do repositório no início da Engineering Maturity Review (checkpoint 0) | `03-repository-baseline.md` — histórico, não estado atual (ver aviso no próprio arquivo) |
| Consultar o resultado de uma auditoria específica dos 9 eixos formalizados | `reviews/full-audit-round1-<eixo>-summary.md` (ver convenção de nomenclatura abaixo) |
| Consultar evidência bruta de uma rodada específica (nota cega, prompt do Codex, saída bruta) | `reviews/full-audit-round1-<eixo>-{claude,codex-prompt,codex-output-roundN}.{md,txt}` — evidência, nunca ponto de entrada; leia o `-summary.md` primeiro |
| Rodar o checker de drift determinístico entre docs | `npm run check-docs` (`scripts/check-doc-drift.ts`) — link relativo quebrado + referência `AGENTS.md §N` desatualizada, bloqueante no CI (`guardrails`) |

## Índice por documento (nível raiz de `docs/engineering/`)

| Documento | Classificação | Do que trata |
|---|---|---|
| `principles.md` | normativo atual | Princípios de engenharia adotados (proporcionalidade, evidência antes de mecanismo) |
| `change-risk-scale.md` | normativo atual | Escala de risco de mudança Nível 1-6, régua concreta para "isso precisa de protocolo formal?" |
| `quality-gate-tiers.md` | normativo atual | Tiers de gate (PR vs. deploy), mapeados aos comandos reais |
| `definition-of-done.md` | normativo atual (APPROVED, protocolo Claude↔Codex 3 rodadas, Claude 9,1/Codex 9,2, E-012) | Definition of Done por item de todo list — granularidade ("unidade de conclusão"), gate por nível de risco, classificação de risco na prática, registro mínimo de evidência; complementa `quality-gate-tiers.md`/`change-risk-scale.md` sem substituí-los |
| `joint-review-criteria.md` | normativo atual | Critérios/pesos por eixo das revisões conjuntas Claude↔Codex (9 eixos formalizados + FinOps pendente) |
| `test-engineering-standard.md` | normativo atual (APPROVED, protocolo Claude↔Codex 8 rodadas, gate elevado 9,5/10) | Padrão de validade/qualidade para teste automatizado e drill operacional (chaos/DiRT) — gates binários (G-V1..G-V6, G-C1), critérios ponderados, fórmula de agregação, auditoria retroativa da Wave 2 (2026-08-28) |
| `logging-observability-standard.md` | normativo atual (APPROVED, protocolo Claude↔Codex 3 rodadas, gate elevado 9,5/10) | Régua concreta de qualidade para logging/tracing/taxonomia de erro (`src/shared/observability/**`, `app-error.ts`, wiring Terraform de detecção) — 8 critérios ponderados, âncoras de pontuação, gate de auditoria 9,0/10, escrita em resposta a achados reais de uma rodada Codex de 2026-08-29 |
| `exceptions.md` | normativo atual (registro vivo) | Exceções/vulnerabilidades aceitas com owner e prazo |
| `decisions-log.md` | decisão (log vivo) | Decisões de engenharia/processo, E-000 em diante |
| `disagreement-log.md` | histórico/registro vivo | Divergências materiais Claude↔Codex e como foram resolvidas |
| `ai-governance.md` | normativo atual (registro vivo) | Matriz de autoridade por agente, regra de quando `AGENTS.md` §4 pode ser dispensado, inventário de casos de uso de IA, registro de modelo/fornecedor, incidentes causados pelo próprio agente (distinto de `exceptions.md`) |
| `01-engineering-quality-criteria.md` | histórico (CONGELADA) | Rubrica original de 12 critérios/gates G1-G6 da Engineering Maturity Review — antecessora conceitual de `joint-review-criteria.md`, não superseded formalmente mas escopo majoritariamente absorvido pelos 9 eixos |
| `02-engineering-fitness-functions.md` | normativo atual | Verificações executáveis derivadas da rubrica CONGELADA |
| `00-research-bibliography.md` | histórico/fundamentação | Fontes de pesquisa que embasam a rubrica original |
| `03-repository-baseline.md` | histórico | Estado do repositório no início da Engineering Maturity Review — nunca estado atual |
| `pilot-readiness-program.md` | registro vivo de backlog (não normativo sobre arquitetura/design) | Backlog item-a-item do "Consolidation + Pilot Readiness Program" (`docs/project/handoffs/expiration-tracker-next-days-master-plan-and-ai-prompt.md`, movido da raiz em 2026-08-29) — DONE/PARTIAL/BLOCKED/DEFERRED/NOT STARTED por Wave 0-6, atualizado a cada milestone |
| `pilot-readiness-assessment.md` | síntese/recomendação (entregável final do programa, prompt mestre §42) | GO/CONDITIONAL GO/NO-GO por escopo de piloto, consolidando a evidência de `pilot-readiness-program.md` — não repete achado, só aponta; não é aprovação final, é insumo para a decisão do Marcelo |
| `reviews/` | histórico/evidência de rodada | Artefatos de toda rodada Claude↔Codex de processo/qualidade — ver seção própria abaixo |

## `reviews/` — convenção de nomenclatura e classificação

Evidência de rodada, mesmo papel que `docs/architecture/history/` tem para decisões de arquitetura: nunca normativo, só prova de como uma nota/decisão foi alcançada. Três gerações de conteúdo coexistem aqui, nesta ordem cronológica:

1. **Checkpoints da Engineering Maturity Review** (`checkpoint-01-rubric/`, `checkpoint-02-09-consolidated/`, `checkpoint-12-redteam/`, e os arquivos soltos `_codex-*-checkpoint1-*.txt` no nível raiz de `reviews/`) — produziram a rubrica CONGELADA (`01-engineering-quality-criteria.md`) e o red team que motivou G8. Prefixo `_` nos arquivos brutos é intencional (agrupa antes de outros nomes em ordem alfabética, sinaliza "transcript bruto, não leia direto").
2. **Convergência dos critérios por eixo** (`joint-review-criteria-round1-*`, `security-axis-criteria-round1-*`, `remaining-axes-round1-*`, `audit-areas-*`) — produziram `joint-review-criteria.md`.
3. **Full-audit dos 9 eixos formais** (`full-audit-round1-<eixo>-*`) — a rodada em andamento nesta sessão. Padrão de nomenclatura por eixo (`<eixo>` ∈ `arquitetura`, `qualidade`, `contexto`, `seguranca`, ...):
   - `full-audit-round1-<eixo>-claude.md`, `-claude-round2.md`, `-claude-round3.md`, ... — nota cega do Claude, uma por rodada.
   - `full-audit-round1-<eixo>-codex-prompt.txt` / `-codex-prompt-round2.txt`, ... — prompt enviado ao Codex CLI, um por rodada.
   - `full-audit-round1-<eixo>-codex-output-round1.txt`, `-round2.txt`, ... — saída bruta do Codex CLI. Alguns trechos que ecoam saída de outros comandos de shell continham mojibake (encoding double/triple-decoded em algumas invocações via PowerShell) — revertido deterministicamente para os arquivos anteriores a cada rodada (achado real de higiene, corrigido, não só mitigado); a saída de uma rodada em andamento pode ainda conter mojibake até a rodada seguinte revisá-la, por ser evidência datada do que o Codex realmente viu naquele momento — nunca editada retroativamente. Se precisar do conteúdo, prefira o `-summary.md` correspondente, que já extrai a informação sem o ruído de encoding.
   - `full-audit-round1-<eixo>-summary.md` — **o único arquivo desta trinca que deveria ser lido diretamente.** Nota final por critério (ambos os lados), achados corrigidos com commit real, achados restantes classificados em "impedimento externo real" vs. "escopo maior que correção pontual".

Arquivos de transcript bruto (`.txt`, prefixo `_`, ou os `full-audit-*-codex-output-*.txt`) nunca são fonte de verdade por si só — sempre prefira o `.md` de resumo/nota que os acompanha. **Política de proveniência/metadata**: os `.md` de nota/resumo carregam frontmatter (`status`/`owner`/`authority`, mais `Last verified` nos routers); os `.txt` brutos não — exigir frontmatter em cada transcript violaria proporcionalidade (`principles.md` #1) sem ganho real, já que sua proveniência é herdada do `.md` que os acompanha (mesmo prefixo de nome) e da posição cronológica descrita nesta seção. Isso é uma decisão de design, não uma lacuna: um transcript nunca é lido isoladamente por convenção (ver acima), então não precisa carregar sua própria metadata.
