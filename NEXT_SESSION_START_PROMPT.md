Leia este arquivo inteiro, depois apague-o (`rm -f --`). É temporário — não é fonte
normativa, só transfere contexto entre sessões. Estado real e duradouro já está em
`NEXT_SESSION_PROMPT.md`/`docs/architecture/decisions-log.md`/`AGENTS.md`.

Confirme `git branch --show-current` (deve ser `develop`) e rode `git pull` antes de
seguir — múltiplas máquinas/sessões trabalham neste repo, e a sessão anterior (2026-08-31)
mergeou 7 decisões (D-124 a D-131) em poucas horas.

## Tarefa desta sessão: implementar a Wave 1b (Design System Implementation Gap)

A sessão anterior fechou a reconciliação de documentação do Design System (item 4 da fila,
D-130, protocolo Claude↔Codex completo, 5 rodadas, Claude 9,2/Codex 9,5) — mas foi
**puramente documental, nenhum código de frontend foi alterado**. O trabalho real de
implementação ficou nomeado como "Wave 1b", sem data, para ser tratado quando priorizado.
Leia primeiro:

- `docs/architecture/reviews/design-system-reconciliation-scoping/estado-final-consolidado.md`
  (o registro completo da decisão, inclui a tabela de reconciliação de valores primitivos)
- `docs/frontend/design-system.md` (arquitetura/catálogo adotado — a fonte de processo/roadmap)
- `docs/frontend/visual-language-and-design-system.md` (a fonte de verdade dos valores
  primitivos REAIS já implementados — `#2F4FD0`, System UI, radius 4/6/8px etc. — **nunca**
  os valores da proposta original, já substituídos na reconciliação)
- `frontend/src/components/ui/tokens.css` e `frontend/src/components/ui/` (estado real do
  código hoje — a Wave 1b só avança a partir daqui, não do zero)

Escopo nomeado explicitamente pela Rodada 5 do protocolo, em ordem de menor risco/maior valor
esperado (seu julgamento para a ordem exata, mas comece pelo que tem menos ambiguidade):

1. Implementar os componentes do catálogo (~30) ainda faltantes em `design-system.md`,
   usando a camada de tokens já real (primitive→semantic→component quando justificado).
2. Decidir se/quando adicionar variante `lg` ao `Button.tsx` (hoje só `sm`/`md`, `height:44px`
   da proposta original não corresponde a nada implementado) — resíduo nomeado, não decidido.
3. Avaliar motion `slow`/z-index/breakpoints nomeados no CSS real (a proposta original
   nomeou esses tokens, ainda não confirmados/implementados de fato).

**Antes de escrever qualquer componente**: confira se cada peça do catálogo é genuinamente
nova ou se já existe implementada sob outro nome — a Rodada 1 do protocolo anterior já errou
uma vez por afirmar "nada conflita" sem checar o código real; não repita esse padrão.

## Processo obrigatório — siga exatamente como a sessão anterior seguiu

- **Leia `AGENTS.md` inteiro primeiro.** Ele é a fonte de processo (branch strategy, DoD por
  item, regras de shell no Windows, protocolo Claude↔Codex §4, e duas regras novas desta
  sessão: nunca fazer polling de "existe um run de CI/CD completo" sem capturar o
  `databaseId` baseline antes — §4 do AGENTS.md tem o padrão exato; e `terraform force-unlock`
  em `dev` está pré-autorizado sem confirmação, §7).
- **Qualquer decisão de arquitetura/design não trivial passa pelo protocolo Claude↔Codex
  completo** (`AGENTS.md` §4): mínimo 3 rodadas, nota cega, gate ≥9,0 sem arredondar,
  pesquisa externa quando aplicável (`docs/engineering/research-protocol.md`). A autoridade
  ampliada registrada em `docs/engineering/ai-governance.md` §1 (2026-08-31) continua valendo:
  resíduos de decisão de produto também são seus para decidir via protocolo, não reservados
  ao Marcelo — revertível por ele depois, não dispensa rodar o protocolo em si, nunca se
  estende a execução real/destrutiva.
- **Definition of Done por item** (`docs/engineering/definition-of-done.md`, E-012/E-013):
  G-V3 (mutação nomeada, verificada e revertida) em qualquer lógica não trivial, nunca só
  "suíte verde". Suíte completa antes de fechar qualquer item: `typecheck`/`lint`/
  `check-boundaries`/`test`/`validate-schemas`/`check-docs`, mais `vitest`/Playwright do
  frontend se tocar `frontend/`.
- **Registro de decisão**: cada implementação real ganha uma entrada nova em
  `docs/architecture/decisions-log.md` (confira o D-number mais alto lendo o arquivo — a
  sessão anterior terminou em D-131) e atualização correspondente em `NEXT_SESSION_PROMPT.md`.
- **Trabalho autônomo, sem parar para perguntar**: commit/push em `develop` sem confirmação
  prévia (`AGENTS.md` §3), PR→`main` e merge quando a suíte estiver genuinamente verde. Só
  pare para confirmação explícita do Marcelo antes de comando destrutivo real contra a conta
  AWS fora de `dev` — nunca antes de planejar/decidir/commitar.
- **Nunca delegue para um sub-agente que só vai delegar de novo.** Se você mesmo (a sessão
  principal) decidir usar um agente de background para uma frente de trabalho, instrua
  explicitamente "faça o trabalho você mesmo, não spawn outro sub-agente" — isso já causou
  perda real de tempo nesta sessão (2 camadas de delegação recursiva antes de qualquer
  trabalho real acontecer).
- **Rodar itens que tocam os mesmos arquivos compartilhados sequencialmente, nunca em
  paralelo** — `decisions-log.md`/`NEXT_SESSION_PROMPT.md` são tocados por quase toda
  decisão; paralelismo real só quando as áreas de código genuinamente não se sobrepõem.
- **Ao aguardar um run de CI/CD recém-disparado**: capture o `databaseId` mais recente ANTES
  do trigger, espere um `databaseId` diferente aparecer, só então faça polling desse run
  específico até `completed` — nunca "existe algum run completo" (um run antigo/falho
  satisfaz essa condição na hora e produz falso "concluído"). Confira o estado com uma
  chamada direta de vez em quando em vez de confiar cegamente numa única espera longa.
- **Todo retorno de status ao Marcelo deve incluir, de forma concisa, o que ainda falta** —
  nunca só o que foi concluído (regra registrada em `docs/project/working-memory.md`).

## Depois da Wave 1b (fila mais ampla, sem urgência declarada)

`NEXT_SESSION_PROMPT.md` tem a fila completa e atualizada — leia a seção "Branch / as-of" e
"Próximos itens" para o estado exato. Resumo: os 5 itens originalmente autorizados (quarentena+
LGPD/D-127, `AppError.retryable`/D-128, GTR-01/D-129, Design System/D-130, audit log admin/D-131)
já têm design aprovado; a implementação real de D-127 (tamanho de wave) e do mecanismo de
cursor/idempotência de D-131 seguem nomeadas como trabalho futuro, sem data. Item de execução
destrutiva (`reset-dev-data.ts --confirm`) continua explicitamente postergado pelo Marcelo — não
tratar, não perguntar de novo até ele sinalizar.
