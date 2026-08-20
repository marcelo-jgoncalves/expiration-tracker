# docs/engineering/ — Índice e Mapa de Autoridade

```text
Rubrica de qualidade:     CONGELADA (01-engineering-quality-criteria.md)
Fitness functions:        ativas (02-engineering-fitness-functions.md), enforcement real em CI
Full-audit 9 eixos:       em andamento (ver NEXT_SESSION_PROMPT.md para o eixo/rodada atual)
Last verified:            2026-08-20
```

Este diretório trata de **como o trabalho de engenharia é medido e revisado** (rubrica, critérios por eixo, protocolo de debate, achados de auditoria) — não confundir com `docs/architecture/`, que trata do que o sistema É (design, modelo de dados, decisões de arquitetura). Se a dúvida for "o GSI3 é consultável por quem", vá para `docs/architecture/`; se for "que nota isso tira / que processo formal se aplica aqui", este diretório é o certo.

## Precedência de fontes (quando houver divergência)

Mesma regra de `docs/architecture/README.md` — `AGENTS.md` (raiz) sempre vence sobre conteúdo deste diretório; um achado de auditoria (`reviews/full-audit-*-summary.md`) é evidência de uma rodada específica, nunca redefine os pesos/critérios de `joint-review-criteria.md` (ele mesmo linka para lá em vez de duplicar, ver seu próprio rodapé "Como adicionar um novo eixo").

## Quando carregar o quê (roteamento por tipo de tarefa)

| Sua tarefa é... | Carregue |
|---|---|
| Rodar o protocolo Claude↔Codex num eixo específico (`AGENTS.md` §4) | `joint-review-criteria.md` (seção do eixo) + o `full-audit-round1-<eixo>-summary.md` mais recente em `reviews/`, se existir (retomar em vez de reabrir do zero) |
| Entender que nota um achado específico do código tira / que critério ele afeta | `joint-review-criteria.md` (não precisa da rubrica congelada nem do bibliography) |
| Decidir se uma mudança precisa de ADR/protocolo formal ou é correção mecânica | `change-risk-scale.md` (a régua concreta) — `AGENTS.md` §4 só distingue os dois extremos de forma binária |
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
| `joint-review-criteria.md` | normativo atual | Critérios/pesos por eixo das revisões conjuntas Claude↔Codex (9 eixos formalizados + FinOps pendente) |
| `exceptions.md` | normativo atual (registro vivo) | Exceções/vulnerabilidades aceitas com owner e prazo |
| `decisions-log.md` | decisão (log vivo) | Decisões de engenharia/processo, E-000 em diante |
| `disagreement-log.md` | histórico/registro vivo | Divergências materiais Claude↔Codex e como foram resolvidas |
| `01-engineering-quality-criteria.md` | histórico (CONGELADA) | Rubrica original de 12 critérios/gates G1-G6 da Engineering Maturity Review — antecessora conceitual de `joint-review-criteria.md`, não superseded formalmente mas escopo majoritariamente absorvido pelos 9 eixos |
| `02-engineering-fitness-functions.md` | normativo atual | Verificações executáveis derivadas da rubrica CONGELADA |
| `00-research-bibliography.md` | histórico/fundamentação | Fontes de pesquisa que embasam a rubrica original |
| `03-repository-baseline.md` | histórico | Estado do repositório no início da Engineering Maturity Review — nunca estado atual |
| `reviews/` | histórico/evidência de rodada | Artefatos de toda rodada Claude↔Codex de processo/qualidade — ver seção própria abaixo |

## `reviews/` — convenção de nomenclatura e classificação

Evidência de rodada, mesmo papel que `docs/architecture/history/` tem para decisões de arquitetura: nunca normativo, só prova de como uma nota/decisão foi alcançada. Três gerações de conteúdo coexistem aqui, nesta ordem cronológica:

1. **Checkpoints da Engineering Maturity Review** (`checkpoint-01-rubric/`, `checkpoint-02-09-consolidated/`, `checkpoint-12-redteam/`, e os arquivos soltos `_codex-*-checkpoint1-*.txt` no nível raiz de `reviews/`) — produziram a rubrica CONGELADA (`01-engineering-quality-criteria.md`) e o red team que motivou G8. Prefixo `_` nos arquivos brutos é intencional (agrupa antes de outros nomes em ordem alfabética, sinaliza "transcript bruto, não leia direto").
2. **Convergência dos critérios por eixo** (`joint-review-criteria-round1-*`, `security-axis-criteria-round1-*`, `remaining-axes-round1-*`, `audit-areas-*`) — produziram `joint-review-criteria.md`.
3. **Full-audit dos 9 eixos formais** (`full-audit-round1-<eixo>-*`) — a rodada em andamento nesta sessão. Padrão de nomenclatura por eixo (`<eixo>` ∈ `arquitetura`, `qualidade`, `contexto`, `seguranca`, ...):
   - `full-audit-round1-<eixo>-claude.md`, `-claude-round2.md`, `-claude-round3.md`, ... — nota cega do Claude, uma por rodada.
   - `full-audit-round1-<eixo>-codex-prompt.txt` / `-codex-prompt-round2.txt`, ... — prompt enviado ao Codex CLI, um por rodada.
   - `full-audit-round1-<eixo>-codex-output-round1.txt`, `-round2.txt`, ... — saída bruta do Codex CLI. **Contém mojibake em trechos que ecoam saída de outros comandos de shell** (encoding double-decoded em algumas invocações via PowerShell) — a nota/parecer final do Codex, escrito por ele mesmo no fim do arquivo, não é afetado; se precisar do conteúdo, prefira o `-summary.md` correspondente, que já extrai a informação sem o ruído de encoding.
   - `full-audit-round1-<eixo>-summary.md` — **o único arquivo desta trinca que deveria ser lido diretamente.** Nota final por critério (ambos os lados), achados corrigidos com commit real, achados restantes classificados em "impedimento externo real" vs. "escopo maior que correção pontual".

Arquivos de transcript bruto (`.txt`, prefixo `_`, ou os `full-audit-*-codex-output-*.txt`) nunca são fonte de verdade por si só — sempre prefira o `.md` de resumo/nota que os acompanha. Nenhum foi expurgado nesta sessão apesar do achado de higiene (`full-audit-round1-contexto-summary.md`, critério "Higiene de Contexto"): a mistura de mojibake com conteúdo genuíno em texto corrido tornava a limpeza automática arriscada sem revisão humana linha a linha; a mitigação aplicada foi tornar a classificação explícita aqui (evidência bruta e não-autoritativa por design) em vez de apagar histórico real.
