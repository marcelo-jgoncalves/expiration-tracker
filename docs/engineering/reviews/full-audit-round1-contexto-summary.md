---
status: final
owner: claude+codex
authority: audit-record
---

# Full-audit round1 — Eixo Engenharia de Contexto — resumo consolidado

Protocolo `AGENTS.md` §4 executado contra os 9 critérios de `docs/engineering/joint-review-criteria.md` ("Eixo: Engenharia de contexto"). 5 rodadas cegas de nota (Claude e Codex, independentes) intercaladas com rodadas reais de correção. **Gate atingido na rodada 5**: nota ponderada final ≥9.0 dos dois lados.

## Notas finais por critério (rodada 5, última nota cega de cada lado)

| # | Critério | Peso | Claude (R5) | Codex (R5) | Situação |
|---:|---|---:|---:|---:|---|
| 1 | Canonicalidade, Autoridade & Não-Duplicação | 15% | 9.2 | 9.3 | ≥9.0 nos dois lados desde R3. |
| 2 | Clareza de Papéis & Proporcionalidade | 9% | 9.0 | 9.2 | ≥9.0 nos dois lados desde R3 (router). |
| 3 | Context Routing & Progressive Disclosure | 15% | 9.0 | 9.1 | ≥9.0 nos dois lados desde R3 — maior salto do eixo (era 6.8/5.5 no R2), resolvido pelo router `docs/engineering/README.md`. |
| 4 | Correspondência com a Realidade & Controle de Drift | 16% | 9.1 | 9.1 | ≥9.0 nos dois lados desde R5 — última correção: docstring de `check-doc-drift.ts` citava texto de `AGENTS.md` §6 já substituído como se fosse atual. |
| 5 | Lifecycle, Proveniência & Evolução do Conhecimento | 12% | 9.1 | 9.0 | ≥9.0 nos dois lados desde R5 — 6 arquivos `.md` de `reviews/` sem frontmatter ganharam `status`/`owner`/`authority`; política de proveniência herdada por `.txt` documentada explicitamente no router. |
| 6 | Rastreabilidade de Decisões, Trabalho & Triggers | 10% | 8.8 | 9.0 | Único critério Claude abaixo de 9.0 — limite estrutural proporcional já documentado (checker prova existência de `§N`, não correção semântica; NLP/revisão semântica automática seria desproporcional ao estágio, `principles.md` #1). Codex concorda que é proporcional e pontua 9.0. |
| 7 | Higiene de Contexto & Sinal-Ruído | 8% | 9.2 | 8.9 | Único critério Codex abaixo de 9.0 — mojibake real corrigido nos arquivos históricos (verificado por amostra independente do Codex em 4 arquivos, todos limpos), mas o transcript bruto da própria rodada 4 (`full-audit-round1-contexto-codex-output-round4.txt`) ainda contém ruído de mojibake por ser evidência datada do que o Codex viu naquele momento — nunca editada retroativamente, por política explícita do router. Classificado como limite estrutural proporcional, não achado ativo. |
| 8 | Portabilidade Agnóstica entre Agentes de IA | 6% | 9.1 | 9.1 | ≥9.0 nos dois lados desde R4 — `AGENTS.md` §4 agora demarca explicitamente as regras específicas do ambiente Windows/prompt-de-aprovação como não-universais. |
| 9 | Auditabilidade & Enforcement do Sistema de Contexto | 9% | 9.2 | 9.0 | ≥9.0 nos dois lados desde R5 — achados reais do Codex R4 (drift semântico interno do checker, alegação de mojibake não reproduzível) corrigidos. |

**Nota ponderada Claude (R5): 9.078/10.**
**Nota ponderada Codex (R5): 9.092/10.**

Progressão: Claude 7.93 (R1) → 8.17 (R2) → 8.96 (R3) → 9.08 (R4, calculado) → **9.08 (R5)**. Codex 5.86 (R1) → 6.30 (R2) → 8.56 (R3) → 8.86 (R4) → **9.09 (R5)**.

**Gate do eixo (`AGENTS.md` §4, nota ≥9.0 sem arredondar) atingido por ambos os lados na rodada 5.** 8 de 9 critérios ≥9.0 em cada lado (não os mesmos 8 dos dois lados: Claude fica abaixo só em #6, Codex só em #7) — ambos os déficits são classificados por ambos os avaliadores como limite estrutural proporcional documentado, não achado ativo corrigível por mais um ponto-fix sem desproporção de engenharia (ver `principles.md` #1).

## Commits reais desta sessão (ordem cronológica)

1. `48aad11` — achados pré-nota-cega: 2 referências `AGENTS.md §3`→`§4` quebradas, `docs/architecture/reviews/` não indexado.
2. `d941a35` — R1→R2: threat model descrito como não-produzido, banner `ENGINEERING.md` pré-M3.5, 6 referências de seção quebradas, contagem de decisões incorreta.
3. (mesmo commit) — R2→R3: banner apontando para resumo inexistente, `ARCHITECTURE.md:116`, tabela de risco WAR review, referências residuais.
4. `ddf4bc9` — router `docs/engineering/README.md` + `scripts/check-doc-drift.ts` (`npm run check-docs`, bloqueante no CI), pedido explícito do usuário após revisar o resumo R2.
5. `1c8059e` — resumo atualizado.
6. `d1e48cd` — R3: nota cega (Claude 8.96, Codex 8.56) + `AGENTS.md:62` morto removido, docstring do checker corrigida.
7. `e9d4b79` — mojibake revertido em 22 transcripts (`docs/engineering/reviews/`, `docs/architecture/reviews/m3.5-runtime-design/`), 0 `U+FFFD` introduzidos.
8. `c71a189` — `AGENTS.md` §4: regras específicas do ambiente Windows/aprovação-por-comando demarcadas explicitamente.
9. `f761791` — R4: nota cega (Claude 9.08, Codex 8.855) + mojibake residual real (padrão `â€.` não coberto antes) corrigido + docstring do checker corrigida de novo (autorreferência obsoleta).
10. `c984bed` — R5: frontmatter retroativo em 6 arquivos `.md` de `reviews/` + política de proveniência explícita no router.
11. Nota cega R5 (este documento): Claude 9.078, Codex 9.092 — **gate atingido**.

## Critérios abaixo de 9.0 (nota R5) — classificação final

Nenhum critério deste eixo teve impedimento externo real em nenhuma rodada — confirma a expectativa de `NEXT_SESSION_PROMPT.md` ("Eixos sem esse tipo de impedimento... não têm desculpa para não chegar a 9.0"). Os 2 déficits residuais (1 por lado) são classificados por AMBOS os avaliadores como limite estrutural proporcional, não achado corrigível:

- **Rastreabilidade de Decisões, Trabalho & Triggers** (#6, Claude 8.8): `check-doc-drift.ts` prova que `§N` existe, não que a citação é semanticamente correta. Corrigir exigiria NLP ou revisão semântica automatizada — desproporcional ao estágio do projeto (`principles.md` #1). Documentado explicitamente no próprio docstring do script como limite reconhecido, não bug.
- **Higiene de Contexto & Sinal-Ruído** (#7, Codex 8.9): o transcript bruto da rodada 4 do Codex ainda contém mojibake porque é evidência datada (captura do que o Codex viu no momento em que rodou, antes da correção da própria rodada 4 ser aplicada) — editá-lo retroativamente destruiria a integridade da evidência de auditoria. Política explícita no router (`docs/engineering/README.md`).

## Recomendação

Eixo fechado com gate atingido. Se uma sessão futura quiser perseguir os últimos 0.1-0.2 pontos em cada lado, as únicas ações não-desproporcionais seriam: (a) para #6, um linter leve que verifica se o texto ao redor de uma citação `§N` menciona palavras-chave do título real da seção (heurística barata, não NLP completo); (b) para #7, gerar uma versão "normalizada" separada do transcript round4 preservando o original intocado como evidência — ambas ficam como backlog explícito, não bloqueiam nada.
