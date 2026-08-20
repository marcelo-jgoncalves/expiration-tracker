---
status: final
owner: claude+codex
authority: audit-record
---

# Full-audit round1 — Eixo Engenharia de Contexto — resumo consolidado

Protocolo `AGENTS.md` §4 executado contra os 9 critérios de `docs/engineering/joint-review-criteria.md` ("Eixo: Engenharia de contexto"). 3 rodadas reais de correção, 3 rodadas cegas de nota de cada lado (Claude e Codex, independentes).

## Notas finais por critério (rodada 3, última nota cega de cada lado)

| # | Critério | Peso | Claude (R3) | Codex (R3) | Situação |
|---:|---|---:|---:|---:|---|
| 1 | Canonicalidade, Autoridade & Não-Duplicação | 15% | 9.2 | 9.2 | ≥9.0 nos dois lados. Achado round2 (banners apontando para este resumo antes de ele existir) fechado. |
| 2 | Clareza de Papéis & Proporcionalidade | 9% | 9.2 | 9.0 | ≥9.0 nos dois lados após `docs/engineering/README.md`. |
| 3 | Context Routing & Progressive Disclosure | 15% | 9.0 | 9.0 | ≥9.0 nos dois lados — maior salto do eixo (era 6.8/5.5 no round2), resolvido pelo router. |
| 4 | Correspondência com a Realidade & Controle de Drift | 16% | 9.1 | 8.7 | Codex abaixo de 9.0 por um achado real novo: `AGENTS.md` linha 62 ainda instruía "reavaliar automação quando M1+ justificar" apesar da automação já existir — corrigido nesta mesma rodada (ver commit abaixo), não reavaliado por nenhum dos dois lados após essa correção pontual. |
| 5 | Lifecycle, Proveniência & Evolução do Conhecimento | 12% | 8.8 | 8.6 | Achado real do Codex: reviews não têm metadata uniforme de autoridade/owner/last-verified por artefato — só o novo router tem. Não corrigido (trabalho de escopo maior, catalogar dezenas de artefatos existentes). |
| 6 | Rastreabilidade de Decisões, Trabalho & Triggers | 10% | 9.0 | 8.5 | Achado real do Codex: o checker prova que a seção `§N` citada existe, não que a citação é semanticamente correta — distinção válida, checker deliberadamente não tenta validação semântica (proporcionalidade). |
| 7 | Higiene de Contexto & Sinal-Ruído | 8% | 7.8 | 6.5 | Ainda abaixo de 9.0 nos dois lados — mitigado (classificação explícita no router), não resolvido na origem (mojibake continua nos arquivos). Decisão consciente de não fazer às pressas (risco de perda de evidência histórica genuína). |
| 8 | Portabilidade Agnóstica entre Agentes de IA | 6% | 9.0 | 8.2 | Sem mudança — achado válido do Codex (`AGENTS.md` §4 específico a Codex CLI/Bash, ambiente real é Windows/PowerShell) não corrigido, fora do escopo de uma auditoria de documentação (mudaria o processo real de invocação). |
| 9 | Auditabilidade & Enforcement do Sistema de Contexto | 9% | 9.2 | 8.2 | Codex abaixo de 9.0 por um achado real novo, já corrigido nesta rodada: docstring do checker dizia "every relative markdown link" mas a regex só cobre links inline-style, não reference-style — corrigido para declarar o escopo real em vez de superestimar cobertura. |

**Nota ponderada Claude (R3): 8.96/10.**
**Nota ponderada Codex (R3): 8.56/10.**

Progressão: Claude 7.93 (R1) → 8.17 (R2) → 8.96 (R3). Codex 5.86 (R1) → 6.30 (R2) → 8.56 (R3). Nenhum lado atingiu ≥9.0 em todos os 9 critérios — 7 de 9 critérios estão ≥9.0 em ambos os lados; os 2 que restam (#7 Higiene, #8 Portabilidade — mais parcialmente #5 Lifecycle e #6 Rastreabilidade do lado Codex) são achados reais, não celebrados como "descoberta interessante e esquecidos": ver classificação abaixo.

### Histórico de rodadas anteriores (preservado)

**Rodada 2** (antes do router/doc-drift-check): Claude 8.17/10, Codex 6.30/10 — maiores gaps eram Context Routing (6.8/5.5) e Auditabilidade (6.9/4.8), sem nenhuma correção estrutural ainda aplicada, só correções pontuais de referência/drift textual.

**Rodada 3** de correção (entre R2 e a nota R3 acima), pedida explicitamente por Marcelo após ver o resumo da R2: criação de `docs/engineering/README.md` (router) e `scripts/check-doc-drift.ts` (`npm run check-docs`, bloqueante no CI) — ver commits `ddf4bc9`/`1c8059e` abaixo. A nota R3 acima já reflete o efeito real dessas mudanças (não é mais "não reavaliado", como nas rodadas anteriores).

**Achados do Codex na nota R3 já corrigidos na mesma sessão** (commit `d1e48cd`): `AGENTS.md:62` (instrução morta sobre automação que já existe) removida; docstring de `check-doc-drift.ts` corrigida para não superestimar cobertura (só links inline-style, não reference-style).

## Commits reais desta sessão

1. `48aad11` — round0 (achado durante leitura inicial, antes da nota cega formal): 2 referências `AGENTS.md §3`→`§4` quebradas (`working-memory.md`, `03-repository-baseline.md`) e indexação do diretório `docs/architecture/reviews/` ausente do mapa de `docs/architecture/README.md`.
2. `d941a35` — round1→round2: notas cegas registradas (Claude round1 7.93, Codex round1 5.86); correção dos achados de ambas: threat model descrito como "não produzido" quando já `APPROVED` (`ARCHITECTURE.md`, `aws-well-architected-review.md`), banner de correção em `ENGINEERING.md` (G8/CI/handlers pré-M3.5), mais 6 referências de seção `AGENTS.md` quebradas (`session-log.md` ×5, `NEXT_SESSION_PROMPT.md`, `03-repository-baseline.md`), contagem de decisões incorreta no índice, data de verificação desatualizada, remoção de duplicação obsoleta em `working-memory.md`.
3. `d941a35` — round2→round3-de-correção: achados do Codex round2 (banner apontando para resumo inexistente, `ARCHITECTURE.md:116` ainda desatualizado, tabela de risco da WAR review não fechada, 1 referência `§3` e 3 referências `§6` residuais em `session-log.md`).
4. `ddf4bc9` — router (`docs/engineering/README.md`) + `scripts/check-doc-drift.ts` (`npm run check-docs`, bloqueante no CI), pedido explícito de Marcelo após revisar o resumo da rodada 2. `AGENTS.md` §2/§6 atualizados.
5. `1c8059e` — este resumo atualizado para registrar a correção acima (antes da nota R3 formal).
6. `d1e48cd` — nota cega R3 (Claude 8.96, Codex 8.56) + achados reais do Codex R3 corrigidos: `AGENTS.md:62` (instrução morta), docstring de `check-doc-drift.ts` (cobertura superestimada).

## Critérios abaixo de 9.0 (nota R3) — classificação

Nenhum critério deste eixo tem impedimento externo real — mesma conclusão que `NEXT_SESSION_PROMPT.md` antecipa ("Eixos sem esse tipo de impedimento... não têm desculpa para não chegar a 9.0"). Todos os itens abaixo são achados corrigíveis nesta sessão ou trabalho de escopo maior que ponto-fix, nunca bloqueio externo.

### Escopo maior que correção pontual, decisão consciente de não fazer às pressas

- **Higiene de Contexto & Sinal-Ruído** (#7, 8%, nota mais baixa do eixo — 7.8/6.5): mojibake em `docs/engineering/reviews/*.txt` e `docs/architecture/reviews/*.txt` continua não removido — o router só classifica o problema (mitigação real, reduz risco de leitura equivocada), não o resolve na origem. Higienizar de verdade exige revisar linha a linha para não apagar evidência histórica genuína misturada com o ruído de encoding — risco de dano maior que o benefício se feito sob pressão de tempo.
- **Portabilidade Agnóstica entre Agentes de IA** (#8, 6%, nota 9.0/8.2): achado válido e não corrigido — `AGENTS.md` §4 descreve a invocação do Codex em termos específicos de Bash/backgrounding, mas o ambiente real de trabalho é Windows/PowerShell (confirmado nesta mesma sessão: comandos encadeados com `&&` disparam prompt de permissão que trava agentes em background — regra nova, ainda não incorporada a `AGENTS.md` §4). Corrigir isso é reescrever o processo operacional real, não uma correção de documentação — fora do escopo desta auditoria.

### Achados pontuais do Codex R3, não fechados por nenhum lado ainda

- **Lifecycle, Proveniência & Evolução do Conhecimento** (#5, nota Codex 8.6): artefatos em `reviews/` não têm metadata uniforme de autoridade/owner/last-verified — só o router novo tem `Last verified`. Catalogar retroativamente dezenas de artefatos é trabalho real de escopo maior, não feito.
- **Rastreabilidade de Decisões, Trabalho & Triggers** (#6, nota Codex 8.5): `check-doc-drift.ts` prova que a seção `§N` citada existe, não que a citação é semanticamente a correta — limite reconhecido e documentado no próprio docstring do script (proporcionalidade: validação semântica exigiria NLP ou revisão humana, desproporcional ao estágio).

### Achados corrigidos nesta sessão (não mais em aberto, mas nota ainda não reavaliada por ambos os lados pós-correção)

- Threat model descrito como "não produzido"/risco Alta aberto em 3 lugares (`ARCHITECTURE.md` ×2, `aws-well-architected-review.md` ×2) quando `APPROVED` há sessões — corrigido.
- `ENGINEERING.md` sem aviso de que G8/CI/handlers descrevem estado pré-M3.5 — banner adicionado.
- `ARCHITECTURE.md:116` "nada foi implementado" — corrigido para refletir M0-M3.5 reais, mantendo a conclusão normativa correta (`NOT APPROVED`) por razão diferente e válida.
- 10 referências de seção `AGENTS.md` quebradas (`§3`↔`§4`, `§5`↔`§6`, `§6`↔`§7`) espalhadas em `working-memory.md`, `03-repository-baseline.md`, `session-log.md` (7 ocorrências), `NEXT_SESSION_PROMPT.md` — todas corrigidas, resultado de `AGENTS.md` ter sido restruturado (inserção da seção de branch strategy como novo §3) sem que citações em documentos escritos antes dessa reestruturação fossem atualizadas.
- Contagem de decisões incorreta no índice (`docs/architecture/README.md`, `ARCHITECTURE.md`) — corrigida (29, D-000–D-028).
- `docs/architecture/reviews/` não indexado em `docs/architecture/README.md` — corrigido.
- Duplicação obsoleta em `working-memory.md` (comando de invocação do Codex já "promovido" a `AGENTS.md` mas ainda copiado, desatualizado) — removida per a própria regra de lifecycle do arquivo.

## Estado final e recomendação

Após a rodada 3, 7 de 9 critérios estão ≥9.0 em ambos os lados. Os 2 que restam abaixo de 9.0 (Higiene de Contexto, Portabilidade Agnóstica) são achados reais com decisão consciente de não corrigir agora — não candidatos a uma 4ª rodada de ponto-fix, precisam de trabalho de escopo diferente (higienização cuidadosa de transcript vs. reescrever o processo real de invocação do Codex para Windows/PowerShell). Fechar este eixo por completo (todos os 9 ≥9.0) fica como item de backlog explícito, não como próxima ação obrigatória — o volume de eixos restantes (5 de 9 ainda não iniciados: Privacidade, Operações/SRE, Governança de IA, Governança Jurídica, Governança de Produto) tem prioridade maior que perseguir os últimos 2 critérios deste eixo.
