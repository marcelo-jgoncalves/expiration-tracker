# Working Memory — Colaboração com Marcelo

> Memória de colaboração curada: preferências duráveis sobre COMO trabalhar neste projeto, distinta de decisões de arquitetura/produto (que vivem em `docs/architecture/decisions-log.md`). Lida a partir de `AGENTS.md` §2 quando a tarefa envolver processo/ferramentas.

## Como este arquivo funciona

Quatro classes de entrada, cada uma marcada explicitamente:

- **[regra obrigatória]** — processo que deve ser seguido sempre que aplicável (ex.: protocolo de nota cega).
- **[ferramenta]** — como invocar uma ferramenta específica corretamente.
- **[local/Windows]** — cautela ligada ao ambiente da máquina, não ao projeto em si.
- **[aprendizado]** — padrão ou armadilha descoberta que vale a pena não repetir.

**Regra de promoção/expiração**: uma entrada observada uma única vez fica aqui, provisória. Se recorrer e for universal ao processo do projeto, sobe para `AGENTS.md`. Se for resolvida e não tiver valor futuro (ex.: um bug de ferramenta corrigido em versão nova), remove-se daqui — o histórico já fica preservado no Git.

## Entradas atuais

- Invocação do Codex CLI e a regra de nota cega/anti-anchoring já foram promovidas a `AGENTS.md` §4 (fonte única) — removidas daqui por decisão explícita da própria regra de lifecycle deste arquivo (linha acima: "resolvida... remove-se daqui"), para não manter uma cópia que pode ficar desatualizada em relação a §4 (já aconteceu: esta entrada citava um comando simplificado que não refletia mais a orientação completa de §4 sobre stdin/backgrounding).
- **[local/Windows]** Não usar `Rename-Item`/`Move-Item` direto em pastas com `.git` ativo se houver risco de o Windows Defender escanear logo após commit/push — pode corromper o `.git`. Método seguro: garantir tudo commitado/pushado, deletar a pasta local, clonar de novo do GitHub com o nome novo.
- **[aprendizado]** Ao usar Codex para avaliação independente com régua de critérios combinada previamente, ele pode "derivar" para nomes de critério diferentes dos acordados na resposta seguinte — sempre conferir se os nomes/ordem batem com o que foi combinado antes de aceitar a nota; se não bater, pedir para refazer explicitamente com os nomes exatos.
- **[ferramenta]** Marcelo pediu explicitamente para não encadear comandos Bash com `&&` (ex.: `cd "..." && codex ...`) — rodar `cd`/mudança de diretório como chamada separada da ferramenta Bash e só then o comando seguinte (o working directory já persiste entre chamadas da ferramenta Bash nesta sessão, então normalmente nem precisa repetir `cd`).
