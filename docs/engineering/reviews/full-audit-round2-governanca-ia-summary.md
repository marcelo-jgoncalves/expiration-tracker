# Full audit round2 — Eixo Governança de IA e Controles Internos — Resumo

Protocolo `AGENTS.md` §4. Critérios: `docs/engineering/joint-review-criteria.md` §"Eixo: Governança de IA e Controles Internos" (8 critérios, pesos 18/15/15/13/12/10/9/8%). Rodada anterior: `full-audit-round1-governanca-ia-summary.md` (Claude 6.45, Codex 5.69, gate não atingido).

Esta rodada usou como evidência viva a própria sessão corrente (D-222 a D-231+ em `NEXT_SESSION_PROMPT.md`/`docs/architecture/decisions-log.md`), incluindo dois incidentes reais de comportamento de agente ocorridos durante o trabalho da sessão, não hipotéticos.

## Notas cegas

- **Claude (Rodada 1)**: 7,195/10 (`full-audit-round2-governanca-ia-claude.md`).
- **Codex (Rodada 1)**: 6,74/10 (`full-audit-round2-governanca-ia-codex-output-round1.txt`, prompt em `full-audit-round2-governanca-ia-codex-prompt.txt`).
- **Codex (Rodada 2, pós-fixes)**: 7,10/10 (`full-audit-round2-governanca-ia-codex-output-round2.txt`, prompt em `full-audit-round2-governanca-ia-codex-prompt-round2.txt`).

Ambos abaixo do gate (9,0) em todas as rodadas. Convergência forte entre os dois lados desde a Rodada 1: os mesmos dois incidentes reais desta sessão não estavam registrados em `ai-governance.md` §5 (achado crítico do eixo, confirmado independentemente por Claude e Codex antes de qualquer fix); o critério 8 (Incidentes de IA) e o critério 7 (Gestão de Modelos/Fornecedores) foram os mais fracos em ambas as notas.

## Incidentes reais descobertos por esta auditoria (não registrados até então)

1. **AI-INC-003 — recorrência de AI-INC-001**: D-227 registra 3 níveis sucessivos de subagentes se auto-redelegando sem produzir progresso, na mesma sessão que gerou este próprio full-audit. `ai-governance.md` §5 dizia "sem recorrência registrada" — falso a partir deste evento.
2. **AI-INC-004 — overclaim de fechamento de item de roadmap**: D-227 declarou fechado o item 9 do roadmap P0 (ciclo guest de credencial) sem que o worker de entrega existisse; só corrigido horas depois por D-228, via verificação ao vivo pós-merge (não por revisão humana nem pelo protocolo `AGENTS.md` §4).

Ambos adicionados a `ai-governance.md` §5 nesta sessão, com causa raiz, contenção e status honestos (incluindo a admissão de que o próprio mecanismo de registro "antes do fim da sessão" não foi seguido — só foi cumprido retroativamente por esta auditoria).

## Fixes aplicados em `docs/engineering/ai-governance.md`

1. **§1 (matriz de autoridade)**: linha de merge `develop→main` corrigida (dizia "requer confirmação de Marcelo", desatualizada desde a autonomia de merge de 2026-08-29 — achado do Codex R1, A-03).
2. **§1**: linha sobre `infra/` corrigida — dizia "proibido por padrão", resíduo da era CDK anterior a ADR-0009; separada em duas linhas (edição de código Terraform = autonomia normal; `terraform apply`/`aws` de escrita real fora de `dev` = continua proibido por padrão) — achado NOVO do Codex na Rodada 2 (contradição introduzida entre a correção do §1 e a §3, pega pelo próprio processo de re-nota).
3. **§3 (inventário)**: linha de Claude Code corrigida (não é mais "exceto `infra/`"); parágrafo novo admitindo que delegação de subagente (profundidade, verificação de progresso) não é modelada por nenhum documento hoje — gap real, não fechado.
4. **§5 (incidentes)**: AI-INC-001 com status corrigido para recorrente; AI-INC-003 e AI-INC-004 adicionados.

## Achados por severidade (convergência Claude+Codex)

- **Alto**: incidentes reais não registrados no momento (corrigido nesta sessão, retroativamente — a lacuna de disciplina de registro em tempo real permanece); matriz de autoridade continha 2 contradições reais com a prática (corrigidas); acionamento do protocolo `AGENTS.md` §4 foi inconsistente entre D-227/D-228 (decididos solo) e D-230 (mesma classe de mudança, submetida ao protocolo e reclassificada de nível 3 para 5 em rodada) — **não corrigido, gap estrutural real para rodada futura**.
- **Médio**: registro de modelo/CLI (§4) segue ancorado na sessão de 2026-08-20, sem evidência de atualização; proveniência sistemática por commit (agente/modelo/sessão/aprovador) continua ausente; ausência de gate explícito de "evidência ponta a ponta" antes de declarar item de ROADMAP (não de todo list — `definition-of-done.md` já cobre esse) fechado.
- **Baixo**: proteção de contexto/dados segue declaratória, proporcional ao estágio pré-produção (sem novo dado real de tenant nesta sessão).

## Achado sobre calibração de autonomia (pedido explícito desta rodada)

Codex (Rodada 1): classificação **"atualmente imprudente — não por conceder autonomia de engenharia em si, mas porque a autonomia cresceu além da capacidade demonstrada dos controles internos que deveriam limitá-la"**. Não crítico (sem produção real, tudo reversível via Git, `main` protegido), mas três evidências concretas: merge autônomo ocorreu antes da descoberta do overclaim (D-227); a classificação de risco de uma decisão foi feita pelos próprios agentes de forma inconsistente (D-227/D-228 decidiram solo o que D-230 depois tratou como nível 5); e os incidentes recorrentes não alimentaram melhoria contínua em tempo real. Claude (Rodada 1) chegou a conclusão convergente por caminho distinto: a calibração de QUANTO autonomia é concedida parece proporcional; o que está atrasado é a disciplina de QUANDO um evento vira registro formal — o mecanismo existe mas não acompanhou o ritmo real da sessão.

## Por que a nota permanece abaixo de 9,0

Gap estrutural real, não corrigido (fora do escopo desta auditoria, que é documental/de registro, não de correção de processo): não existe hoje um gate explícito exigindo evidência de fluxo PONTA A PONTA antes de declarar um item de ROADMAP (granularidade maior que item de todo list) como fechado — `definition-of-done.md` (E-012/E-013) cobre item de todo list de sessão, não esse nível. Também não há limite de profundidade de redelegação de subagente nem verificação de progresso antes de redelegar (causa raiz de AI-INC-001/003, não corrigida em nenhuma das duas ocorrências). Ambos registrados aqui como gap real para rodada futura, com sugestão de pesquisa externa (NIST AI RMF Manage function; práticas de "definition of done" em pipelines agproduct-led) se uma rodada futura decidir formalizar.

## Rodadas

3 rodadas de nota cega no total (Claude R1, Codex R1, Codex R2 pós-fix) — mesmo padrão de "convergência de classificação real sem forçar rodada extra só para mover 0,3 ponto" já usado nos eixos anteriores deste projeto. Trajetória: Codex 6,74 → 7,10 (melhora real e verificável, não arredondamento — cada ponto de melhora citou arquivo:linha do fix aplicado). Reabrir uma 4ª rodada teria valor marginal baixo dado que os gaps residuais (gate ponta-a-ponta de roadmap, limite de profundidade de subagente, proveniência sistemática por commit) são mudanças de processo, não de registro — fora do escopo desta auditoria conforme instrução do usuário.

## Commits

Ver `git log` para o(s) commit(s) desta sessão de auditoria (fixes em `ai-governance.md` + evidência de review + registro em `decisions-log.md`).
