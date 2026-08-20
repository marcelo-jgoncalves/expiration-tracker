# Escala de Risco de Mudança — Expiration Tracker

> Formaliza (padrão adotado do `event-discovery-platform`, escala Nível 1-6 de lá) o que `AGENTS.md` §4 já distinguia de forma binária ("Type 1" vs "correção mecânica"). A escala abaixo é a régua concreta para decidir isso sem depender de julgamento caso a caso repetido.

| Nível | Exemplo neste projeto | Exige |
|---|---|---|
| 1 — Cosmético | Typo em comentário, formatação, nome de variável local | Nada além do lint normal |
| 2 — Correção mecânica | Bug de teste (não de produto), ajuste de import, versão de dependência sem mudança de comportamento | `AGENTS.md` §3 (commit direto em `develop`, sem debate) |
| 3 — Implementação de decisão já aprovada | Escrever o handler Lambda que implementa um design já fechado no protocolo Claude↔Codex; adicionar teste cobrindo um caso já especificado | Julgamento de engenharia direto; documentar judgment calls não previstos no design em `NEXT_SESSION_PROMPT.md`/`session-log.md` |
| 4 — Judgment call de baixo risco/alta reversibilidade | Escolha de biblioteca não prescrita pelo blueprint (ex. Ajv, Vitest em M0); nome de variável de ambiente; heurística interna sem contrato externo | Julgamento de engenharia direto + nota explícita do porquê no commit/relatório de sessão |
| 5 — Muda contrato, chave de partição, fronteira de módulo, ou é difícil de reverter | Novo GSI ou mudança de chave existente; novo formato de evento/schema; nova exceção de particionamento (ex. GSI3/GSI6 globais); mudança de região AWS de produção | **Protocolo Claude↔Codex obrigatório** (`AGENTS.md` §4), mínimo 3 rodadas, nota ≥9.0 de ambos |
| 6 — Decisão arquitetural formal | Nova stack tecnológica, mudança de modelo de dados fundamental, novo domínio de risco (ex. dado sensível novo, novo terceiro com acesso a PII) | Protocolo Claude↔Codex **+ ADR formal** em `docs/architecture/adr/` + atualização de `decisions-log.md` |

## Regra prática

Ao ficar em dúvida entre dois níveis adjacentes, tratar como o nível mais alto — o custo de uma rodada de debate a mais é sempre menor que o custo de uma decisão Type 1 tomada sem revisão (ver `docs/engineering/principles.md` #2).

Isso não substitui o julgamento listado em `AGENTS.md` §4 ("aplicar bom senso de engenharia") — é uma referência para calibrar esse julgamento de forma consistente entre sessões.
