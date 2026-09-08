---
status: final
owner: claude+codex
authority: audit-record
---

# Full-audit Round 2 — Eixo Engenharia de Contexto — resumo consolidado

Protocolo `AGENTS.md` §4 executado contra os 9 critérios de `docs/engineering/joint-review-criteria.md` ("Eixo: Engenharia de contexto"). Rodada 2 do ciclo de auditoria cíclica pedido por Marcelo (Round 1 fechou em 2026-08-20, Claude 9.078/Codex 9.092 — ver `full-audit-round1-contexto-summary.md`). 3 rodadas reais (`codex exec`, nota cega na Rodada 1), reavaliando o estado do sistema de contexto depois de ~150 decisões novas (D-084 a D-231+) desde o baseline.

## Resultado: gate ≥9.0 NÃO atingido — regressão real desde o Round 1, causa raiz identificada

| Rodada | Claude | Codex | Notas |
|---|---:|---:|---|
| R1 (nota cega) | 8.18 | 5.99 | Codex achou mais achados reais que Claude na proposta inicial (autocontradição em `docs/architecture/README.md`, teto fixo `D-000 a D-043`, status stale do smoke test correlationId/X-Ray). Claude aceitou todos. |
| R2 | 6.94 | 6.25 | Claude revisou a nota para baixo incorporando os achados válidos do Codex; aplicou 3 correções factuais mecânicas (nível 1-2). Codex, revisitando, confirmou 2/3 plenamente corrigidas e achou 1 correção incompleta + 1 achado novo (linha 72 stale sobre B2B-12). Ambos concordaram em reclassificar o achado de frontmatter de ALTA para MÉDIA/BAIXA (não é violação de política escrita — a política citada cobre só `docs/engineering/reviews/`, não `docs/architecture/reviews/`). |
| R3 (fechamento) | 7.24 | 6.84 | Claude aplicou as 2 correções restantes. Codex confirmou as 5 correções mecânicas totais como plenamente resolvidas, mas contestou 3 subidas de nota de Claude sem evidência de mudança real (Clareza/Proporcionalidade, Rastreabilidade, Higiene) — crítica aceita. |

**Nota final reconciliada (adotando a tabela mais conservadora do Codex R3, aceita por Claude após a crítica): 6.84/10.** Não atinge o gate ≥9.0. Consistente com o precedente já registrado deste projeto (ex. D-159, proposta rejeitada com nota confirmada 5.5 em vez de forçada para 9) — convergência aqui significa **acordo honesto sobre o estado real**, não inflar a nota para fechar a rodada; a própria tarefa desta auditoria proibiu corrigir os achados estruturais (nível 3+) que mantêm a nota abaixo do gate.

## Nota final por critério (reconciliada)

| # | Critério | Peso | Nota final | Situação |
|---:|---|---:|---:|---|
| 1 | Canonicalidade, Autoridade & Não-Duplicação | 15% | 7.5 | Autocontradições reais corrigidas (ver achados); risco residual de recorrência sem gatilho automático. |
| 2 | Clareza de Papéis & Proporcionalidade | 9% | 6.5 | Papéis dos routers continuam corretos; proporcionalidade do handoff é o problema, sem mudança nas 3 rodadas. |
| 3 | Context Routing & Progressive Disclosure | 15% | 6.0 | **Critério mais afetado** — mesmo diagnóstico do Round 1 ("maior lacuna do eixo"), agora regredido em vez de resolvido. |
| 4 | Correspondência com a Realidade & Controle de Drift | 16% | 8.3 | Todos os 5 drifts factuais concretos encontrados nesta auditoria foram corrigidos e reverificados (`check-docs` limpo, leitura direta). |
| 5 | Lifecycle, Proveniência & Evolução do Conhecimento | 12% | 7.5 | Convenção de gerações/nomenclatura seguida corretamente; gap real de escopo (frontmatter não estendido a `docs/architecture/reviews/`) registrado, não decidido. |
| 6 | Rastreabilidade de Decisões, Trabalho & Triggers | 10% | 7.5 | D-2xx bem conectados a evidência/gatilho; descontado pelo handoff cumulativo misturar estados intermediários e finais na mesma seção. |
| 7 | Higiene de Contexto & Sinal-Ruído | 8% | 3.5 | **Critério mais baixo do eixo** — contraste direto e objetivamente mensurável com a promessa da reconciliação de 2026-08-29 (1067→78 linhas) hoje falsa (277 linhas, ~134 KB). |
| 8 | Portabilidade Agnóstica entre Agentes de IA | 6% | 8.0 | Sem regressão — `AGENTS.md` continua neutro de agente; custo de handoff caro onera qualquer agente igualmente. |
| 9 | Auditabilidade & Enforcement do Sistema de Contexto | 9% | 5.5 | `check-docs` determinístico e reproduzível, mas dá falso "guardrails clean" para uma propriedade real (densidade) que não mede. |

**Cálculo**: 0.15×7.5 + 0.09×6.5 + 0.15×6.0 + 0.16×8.3 + 0.12×7.5 + 0.10×7.5 + 0.08×3.5 + 0.06×8.0 + 0.09×5.5 = 1.125+0.585+0.90+1.328+0.90+0.75+0.28+0.48+0.495 = **6.843/10.**

## Achados corrigidos nesta sessão (nível 1-2, mecânicos, verificados)

Todos em `docs/architecture/README.md`, confirmados por `npm run check-docs` limpo (2074 arquivos, sem links quebrados, sem referência `§N` obsoleta) após as edições:

1. Autocontradição interna no bloco de status: dizia "orquestrador real ... ainda não decidido" e, no mesmo parágrafo, "orquestrador de purga ganhou design `APROVADO` (D-121)" — reconciliado com referência cruzada explícita.
2. Índice de `decisions-log.md` afirmava teto fixo "D-000 a D-043" com o arquivo real em D-231+ — generalizado para "D-000 em diante", removendo a causa raiz (um teto fixo garante drift a cada sessão futura), não só o sintoma.
3. Índice de `correlationid-xray-trace-join.md` afirmava "smoke test real em `dev` ainda pendente" quando já está `E2E PROVEN` desde 2026-08-29 (mesma data do fechamento do Round 1) — corrigido.
4. Frase sobrevivente no bloco de status ("implementação real [do orquestrador W3-07] ainda não construída") contradizia D-124 `IMPLEMENTED`/`DEPLOYED` — corrigida com evidência (PR #122, CD `success`, state machine/sweeper `ENABLED` ao vivo).
5. Linha do índice sobre `roadmap-evolution/17` apresentava a Wave B2B-12 como "próxima ação real, escopo ainda não debatido" (verdade histórica do documento-fonte, não do estado atual) sem deixar isso explícito, contradizendo a linha seguinte da mesma tabela (`APPROVED`/`IMPLEMENTADO`, D-110/D-111) — corrigido.

## Achados PENDENTES (nível 3+, exigem decisão de reestruturação — não corrigidos nesta auditoria por instrução explícita da tarefa)

| Achado | Severidade | Critério(s) | Descrição |
|---|---:|---|---|
| `NEXT_SESSION_PROMPT.md` satisfaz o guardrail de linhas (277 < 300) mas não sua intenção | **ALTA** | #3, #7, #9 | Medição real: ~134 KB, ~15.600 palavras, ~134 tokens médios/linha (algumas linhas isoladas ultrapassam 1.500-2.000 tokens). É a mesma classe de narrativa acumulada sessão-a-sessão que a reconciliação de 2026-08-29 removeu (de 1067 linhas para 78) — reencarnada numa forma que o guardrail de contagem de linhas não detecta. Decidir o que compactar em ~150 decisões (D-084 a D-231) é uma decisão editorial substantiva, não um fix mecânico. |
| `scripts/check-doc-drift.ts` mede só `split("\n").length` para o guardrail de tamanho | **ALTA** (causa raiz do achado acima) | #9 | Sem limite de bytes/caracteres/palavras/tokens/densidade por parágrafo. Um arquivo pode ficar abaixo do teto de linhas e ainda assim ser caro de carregar por completo — o guardrail dá "clean" para uma propriedade que não mede. Requer decisão de instrumentação (qual métrica adicionar, qual limiar). |
| Ausência de política de frontmatter para `docs/architecture/reviews/**/estado-final-consolidado.md` | MÉDIA/BAIXA | #5 | A política de frontmatter obrigatório documentada em `docs/engineering/README.md` cobre explicitamente só a 3ª geração de `docs/engineering/reviews/` (`full-audit-round1-<eixo>-*`) — nunca foi escrita nem decidida para o diretório irmão `docs/architecture/reviews/`. Não é violação de regra existente (reclassificado de uma avaliação inicial errada do Codex R1, corrigida por ambos os lados na R2); é um gap de escopo real: decidir se estender a política. |
| Índice manual dos 2 READMEs (`docs/architecture/README.md`, `docs/engineering/README.md`) sem checagem automática de completude contra o volume real de `reviews/` | BAIXA/observação | #3 | 62 entradas em `docs/architecture/reviews/` e ~116 em `docs/engineering/reviews/` (crescimento substancial desde o Round 1). Ambos os índices ainda cobrem corretamente o volume atual por amostragem — não é um defeito ativo hoje, mas nenhum mecanismo detecta uma pasta nova em `reviews/` sem entrada correspondente em nenhum dos dois READMEs. Risco de escala a monitorar. |

## Gap de escopo/design para rodada futura (não decidido aqui)

A pergunta central que este eixo levanta — **o guardrail de tamanho de `NEXT_SESSION_PROMPT.md`/`AGENTS.md` deveria medir bytes/tokens/palavras em vez de (ou além de) linhas físicas?** — não foi decidida nesta auditoria (decisão de reestruturação/instrumentação, fora do escopo de uma auditoria). Pesquisa rápida de precedente: ferramentas de linting de documentação (`markdownlint`, `vale`) tipicamente oferecem regras de "line length" mas não "arquivo inteiro em tokens"; o padrão mais próximo observado em convenções de `AGENTS.md`/`CLAUDE.md` de projetos abertos é recomendar um teto de tamanho de arquivo em KB, não em linhas — exatamente pelo motivo identificado nesta auditoria. Candidato a decisão formal (E-01x) numa sessão futura, incluindo se a recompactação de `NEXT_SESSION_PROMPT.md` deveria acontecer antes ou depois de decidir a métrica nova.

## Evidência

- `full-audit-round2-contexto-claude.md` (R1), `-claude-round2.md` (R2), `-claude-round3.md` (R3) — notas cegas/revisões Claude.
- `full-audit-round2-contexto-codex-prompt.txt`/`-prompt-round2.txt`/`-prompt-round3.txt` — prompts enviados ao Codex CLI.
- `full-audit-round2-contexto-codex-output-round1.txt`/`-round2.txt`/`-round3.txt` — saída bruta do Codex CLI (nota: as 2 primeiras rodadas de leitura do Codex via PowerShell produziram mojibake ao ecoar o conteúdo de `AGENTS.md`/`joint-review-criteria.md` de volta no transcript — mesma classe de achado já documentada no Round 1 como limite conhecido de ambiente, nunca editado retroativamente por ser evidência datada; não afeta a nota, que o próprio Codex calculou sobre o conteúdo correto).
- `npm run check-docs` rodado 2x nesta sessão (antes e depois das 5 correções), ambos limpos.
