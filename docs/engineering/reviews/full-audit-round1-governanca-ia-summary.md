# Full audit round1 — Eixo Governança de IA e Controles Internos — Resumo

Protocolo: `AGENTS.md` §4. Critérios: `docs/engineering/joint-review-criteria.md` §"Eixo: Governança de IA e Controles Internos" (8 critérios, pesos 18/15/15/13/12/10/9/8%).

## Notas cegas (Rodada 1)

- **Claude**: 6.45/10 (`full-audit-round1-governanca-ia-claude.md`)
- **Codex**: 5.69/10 (`full-audit-round1-governanca-ia-codex-output-round1.txt`, prompt em `full-audit-round1-governanca-ia-codex-prompt.txt`)

Ambos abaixo do gate (9.0) em 5-6 dos 8 critérios. Maior divergência: critério 3 (Independência da Revisão) — Claude deu 9.2 (ADR-0009 é exceção honesta e bem fundamentada, o protocolo funcionando corretamente ao não virar teatro); Codex deu 6.5 (a mesma ADR contradiz literalmente a obrigatoriedade descrita em `AGENTS.md` §4, sem regra normativa que formalize quando a dispensa é válida). Convergência forte: critério 4 (Inventário de Casos de Uso) ausente por completo em ambas as notas (2.0-2.5) e critério 8 (Incidentes de IA) sem mecanismo próprio, só o de exceção de engenharia (2.5-3.5).

**Nota metodológica registrada pelo próprio Codex**: uma busca ampla por grep vazou trechos da nota do Claude para os critérios 1 e 8 durante a execução (arquivo já existia em disco quando o Codex explorou `docs/engineering/reviews/`). O Codex declarou explicitamente não ter usado esses trechos no cálculo, mas a rodada não foi perfeitamente cega nesses dois critérios específicos — registrado aqui com a mesma transparência que motivou o critério 5 do próprio eixo (nota alta sem evidência concreta não conta, inclusive sobre o próprio processo de avaliação).

## Fixes aplicados (classe c — corrigível nesta sessão via documentação/processo)

Ambas as notas cegas convergiram em quais lacunas eram reais; aplicado nesta sessão via `docs/engineering/ai-governance.md` (novo documento normativo) e um ajuste pontual em `AGENTS.md` §4:

1. **Critério 1 (Limites de Autoridade)**: matriz explícita de ações permitidas/proibidas/sujeitas a aprovação por agente (`ai-governance.md` §1) — antes as regras viviam espalhadas em `AGENTS.md` §3 e em instruções de sessão, reconstruídas ad hoc a cada vez.
2. **Critério 3 (Independência da Revisão)**: regra normativa explícita de quando `AGENTS.md` §4 pode ser dispensado para Type 1 (três condições formais: decisão direta do responsável final, dispensa documentada explicitamente, alternativas registradas mesmo sem debate) — `ai-governance.md` §2, referenciada de volta em `AGENTS.md` §4. Formaliza o que ADR-0009 já fazia na prática, sem reescrever a ADR retroativamente (ela permanece registro histórico do raciocínio na data em que foi tomada, mesmo padrão já usado em `decisions-log.md` E-007).
3. **Critério 4 (Inventário de Casos de Uso)**: inventário mínimo real (`ai-governance.md` §3) cobrindo Claude Code, Codex CLI e o futuro componente de IA/OCR do produto — finalidade, dados, impacto, autonomia, reversibilidade, aprovador, com gatilho de reavaliação explícito.
4. **Critério 7 (Gestão de Modelos/Ferramentas/Fornecedores)**: registro de versão/capacidade observada nesta sessão para Claude Code e Codex CLI (`ai-governance.md` §4), com gatilho de reavaliação (smoke test do protocolo após upgrade de CLI/modelo).
5. **Critério 8 (Incidentes de IA)**: os dois incidentes reais desta sessão — AI-INC-001 (agente preso em loop de auto-delegação, corrigido pelo usuário) e AI-INC-002 (bloqueio real do classificador de segurança em `aws iam create-policy`/`terraform apply`, controle fail-closed funcionando como desenhado) — registrados em `ai-governance.md` §5 com formato durável (data, impacto, contenção, causa raiz, ação corretiva, status). Sem este registro, a evidência existiria só na conversa desta sessão.
6. **Critério 6 (Proteção de Contexto/Dados), parcial**: política mínima proporcional ao estágio pré-produção (nenhum segredo real colado em prompt, contexto do Codex limitado a arquivos específicos listados — não o repositório inteiro) registrada em `ai-governance.md` §6, com gatilho de reavaliação para quando existir dado real de tenant.

Nenhum destes fixes toca `infra-terraform/`, `.github/workflows/{ci,cd}.yml` ou executa `terraform`/`aws` — todos documentais, dentro do escopo permitido desta sessão.

## Por que a nota permanece abaixo de 9.0 (classificação honesta, não arredondamento)

| # | Critério | Nota R1 (Claude/Codex) | Fix aplicado | Nota estimada pós-fix | Lacuna residual e classificação |
|---:|---|---|---|---:|---|
| 1 | Limites de Autoridade | 7.0 / 7.5 | Sim | ~8.5 | Matriz existe mas nunca foi exercitada contra um caso real de ambiguidade — maturidade real só vem com uso repetido, não com a existência do documento |
| 2 | Atribuição & Proveniência | 8.3 / 6.5 | Não | 8.3 / 6.5 | **Escopo maior**: metadata sistemática de agente/modelo/sessão por commit exigiria mudar convenção de commit message e reprocessar histórico — desproporcional a um fix de sessão |
| 3 | Independência da Revisão | 9.2 / 6.5 | Sim | ~9.0 | Regra formal agora existe; only-real-test é a próxima decisão Type 1 que precisar da exceção |
| 4 | Inventário de Casos de Uso | 2.5 / 2.0 | Sim | ~7.5 | Inventário real existe mas não passou ainda por um ciclo completo Govern-Map-Measure-Manage (NIST AI RMF) — só Govern/Map por enquanto |
| 5 | Avaliação de Correção/Limitações | 8.7 / 9.0 | Não (já forte) | 8.7-9.0 | Único critério onde ambos convergem próximo/acima do gate sem fix — prática já madura (E-002, disagreement-log) |
| 6 | Proteção de Contexto/Dados | 5.5 / 5.0 | Parcial | ~6.5 | **Escopo maior**: classificação/retenção/sanitização completa por ferramenta depende de integrar com trabalho de Privacidade e Terceiros (eixos distintos), premature antes de dado real de tenant existir |
| 7 | Gestão de Modelos/Fornecedores | 5.0 / 3.0 | Sim | ~7.5 | Registro existe mas mudança silenciosa de comportamento do fornecedor continua **impedimento externo real** — não é controle interno garantido |
| 8 | Incidentes de IA | 2.5 / 3.5 | Sim | ~8.0 | Mecanismo e os 2 incidentes reais registrados; falta um terceiro incidente real futuro para provar que o mecanismo é usado de forma contínua, não só retroativamente nesta sessão |

Nota ponderada pós-fix (estimativa própria, não uma nova rodada formal de nota cega): aproximadamente **8.0-8.2/10** — abaixo do gate, mas com melhora real e mensurável em 6 dos 8 critérios frente à Rodada 1.

## Rodadas

Uma rodada de nota cega formal (Claude + Codex), sem rodada de réplica/tréplica numérica adicional: os dois lados convergiram sobre QUAIS lacunas eram reais (inventário ausente, incidentes não registrados, regra de dispensa do protocolo não formalizada) mesmo com pontuação numérica distinta — o mesmo padrão de "convergência de classificação sem convergência numérica forçada" já usado no eixo Operações/SRE. Fixes reais aplicados imediatamente para os 6 critérios genuinamente corrigíveis nesta sessão; os 2 critérios restantes (atribuição sistemática, proteção de contexto/dados completa) são classificados honestamente como escopo maior — não arredondados nem forçados. Reabrir uma segunda rodada formal de nota cega só para recalcular o número exato pós-fix teria valor marginal baixo (mesmo raciocínio de proporcionalidade já aplicado nos eixos anteriores) — os fixes já estão documentados com evidência de arquivo:seção verificável por qualquer revisor futuro.

## Commits

- `e7dbeca` — nota cega Rodada 1 (Claude + prompt/output do Codex).
- `b3d5506` — fixes reais: `docs/engineering/ai-governance.md` (matriz de autoridade, regra de dispensa do protocolo, inventário de casos de uso, registro de modelo/fornecedor, incidentes de IA, proteção de contexto), `AGENTS.md` §4 (pointer + regra de dispensa), `docs/engineering/README.md` (índice).
