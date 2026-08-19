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

- **[ferramenta]** Invocação do Codex CLI: `codex exec --skip-git-repo-check "<prompt>"`, sempre em background. Ver `AGENTS.md` §3 para a regra de crases (já promovida por ser crítica e recorrente).
- **[regra obrigatória]** Perguntar ao Codex ANTES de revelar a posição/nota do Claude em qualquer avaliação independente — regra anti-anchoring. Já promovida a `AGENTS.md` §3 por ser central ao processo; mantida aqui como referência cruzada.
- **[local/Windows]** Não usar `Rename-Item`/`Move-Item` direto em pastas com `.git` ativo se houver risco de o Windows Defender escanear logo após commit/push — pode corromper o `.git`. Método seguro: garantir tudo commitado/pushado, deletar a pasta local, clonar de novo do GitHub com o nome novo.
- **[aprendizado]** Ao usar Codex para avaliação independente com régua de critérios combinada previamente, ele pode "derivar" para nomes de critério diferentes dos acordados na resposta seguinte — sempre conferir se os nomes/ordem batem com o que foi combinado antes de aceitar a nota; se não bater, pedir para refazer explicitamente com os nomes exatos.
