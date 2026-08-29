# Prompt — Context Architecture Reconciliation do Expiration Tracker

Você está assumindo uma tarefa específica de **Engenharia de Contexto** no projeto Expiration Tracker.

O objetivo NÃO é alterar funcionalidades do produto, implementar Multi-User B2B, mudar arquitetura de negócio, criar novas features ou fazer uma simples limpeza cosmética de documentação.

O objetivo é:

> **reconstruir e fortalecer a arquitetura de contexto do repositório para que Claude Code, Codex e futuros agentes consigam descobrir rapidamente a verdade corrente do projeto, carregar somente o contexto necessário, distinguir regra durável de estado temporário e não serem induzidos a erro por documentação histórica, duplicada ou stale.**

Esta tarefa deve ser executada de forma contínua e autônoma até o máximo de conclusão possível.

---

# 1. Autoridade e início obrigatório

Antes de qualquer alteração:

1. Leia `AGENTS.md` INTEGRALMENTE.
2. Confirme o branch e estado local do repositório.
3. Leia os documentos de entrada indicados pelo próprio `AGENTS.md`.
4. Leia `docs/engineering/change-risk-scale.md`.
5. Leia `docs/engineering/joint-review-criteria.md`.
6. Leia `docs/engineering/ai-governance.md`.
7. Leia o material vigente de Engenharia de Contexto/reviews existentes antes de redesenhar o sistema de contexto.

Se este prompt conflitar com `AGENTS.md`, **AGENTS.md vence**.

Trabalhe sempre dentro da pasta do projeto.

---

# 2. Regra de shell deste ambiente

Não encadeie comandos.

Não use:

```text
&&
||
;
```

para executar múltiplas ações numa única chamada.

Cada comando deve ser executado separadamente.

Sempre que houver uma lacuna entre comandos, retomada de sessão, espera de processo longo ou retorno de Codex, reafirme o diretório de trabalho com um comando isolado antes de continuar.

---

# 3. Estado do problema que motivou esta tarefa

A arquitetura de contexto existente possui boas fundações:

- `AGENTS.md` já é a fonte canônica das regras duráveis;
- `CLAUDE.md` importa `AGENTS.md` em vez de duplicá-lo;
- existe precedência formal de fontes;
- `NEXT_SESSION_PROMPT.md` é definido como estado corrente, não normativo;
- `docs/architecture/README.md`, `docs/engineering/README.md` e `docs/frontend/README.md` funcionam como índices/routers;
- `history/` e `reviews/` são explicitamente históricos/evidência;
- existe `npm run check-docs` no CI;
- existe `docs/architecture/session-log.md`;
- existem `decisions-log.md`/ADRs.

Portanto:

> **não redesenhe tudo do zero.**

O problema é que o projeto cresceu e o modelo atual começou a mostrar sinais concretos de saturação.

Problemas já observados contra o `develop`:

## 3.1 `NEXT_SESSION_PROMPT.md` tornou-se grande demais

Ele já possui centenas de linhas e contém:

- estado corrente;
- narrativa histórica;
- resultados de milestones antigos;
- notas de reviews;
- detalhes que já possuem documentos próprios;
- fatos que aparecem em outros índices;
- itens que ficaram stale dentro do próprio arquivo.

Exemplo já observado:

```text
uma linha afirma RPO não medido
↓
outra linha posterior registra o fechamento do RPO
```

Isso reduz a confiança no arquivo que deveria ser justamente o resumo da verdade corrente.

---

## 3.2 `AGENTS.md` mistura regra durável com implementação temporal

`AGENTS.md` corretamente declara que deve conter regras estáveis, mas sua seção de código real ainda carrega detalhes de milestones e status históricos como M0/M1/M2/M3/M4/M5.

O estado corrente do produto avançou muito além disso.

A consequência é que o próprio arquivo canônico de processo contém fatos que envelhecem.

A tarefa deve determinar quais informações dessa seção são:

```text
invariantes estáveis
```

e quais deveriam viver somente em:

```text
NEXT_SESSION_PROMPT.md
índices temáticos
documentos de arquitetura
```

---

## 3.3 Drift entre fontes correntes

Já foi observado, por exemplo:

```text
docs/architecture/README.md
→ M7 E2E ainda pendente

NEXT_SESSION_PROMPT.md
→ M7 E2E posteriormente executado
```

Isso é exatamente a classe de defeito semântico que `check-docs` atual não consegue detectar.

---

## 3.4 README raiz está stale

O README ainda resume o projeto como implementação M0-M3, enquanto o estado real avançou substancialmente.

README não precisa ser fonte normativa, mas também não deve ensinar uma imagem materialmente antiga do projeto.

---

## 3.5 Poluição da raiz

A raiz contém diversos artefatos como:

```text
Prompt ...
expiration-tracker-...-prompt.md
handoffs
master plans
relatórios de drills
prompts de próximas sessões antigas
```

Muitos foram úteis e devem ser preservados como história/evidência.

Mas eles competem visualmente com:

```text
AGENTS.md
ARCHITECTURE.md
ENGINEERING.md
NEXT_SESSION_PROMPT.md
README.md
```

e aumentam a chance de um agente novo carregar contexto histórico como se fosse corrente.

---

## 3.6 `check-docs` cobre sintaxe, não verdade semântica

O guardrail atual detecta pelo menos:

- links relativos quebrados;
- referências inválidas a seções de `AGENTS.md`.

Isso é bom e deve ser preservado.

Mas não detecta:

- dois documentos correntes com status divergente;
- fatos temporários em `AGENTS.md`;
- prompts temporários abandonados na raiz;
- documento de `history/` sendo apresentado como fonte corrente;
- `NEXT_SESSION_PROMPT.md` crescendo indefinidamente;
- múltiplos donos do mesmo fato volátil.

---

# 4. Princípio central da solução

A solução deve seguir:

# **Progressive Context Disclosure**

Um agente novo deve carregar contexto em camadas.

Modelo conceitual desejado:

```text
TIER 0 — durable agent contract
        AGENTS.md

TIER 1 — orientation / current truth routers
        NEXT_SESSION_PROMPT.md
        docs/architecture/README.md
        docs/engineering/README.md
        docs/frontend/README.md
        README.md quando apropriado

TIER 2 — current normative/thematic docs
        architecture
        security
        privacy
        frontend
        engineering standards
        ADRs

TIER 3 — evidence/history on demand
        reviews/
        history/
        session-log
        handoffs
        old prompts
        raw debate artifacts
```

Um agente NÃO deve precisar carregar TIER 3 para uma tarefa normal.

---

# 5. Regra de ownership de fatos

A nova arquitetura de contexto deve buscar a propriedade:

> **um fato volátil possui um único dono canônico.**

Exemplos conceituais:

```text
"Qual é a próxima ação?"
→ NEXT_SESSION_PROMPT.md

"Qual decisão Type 1 foi tomada?"
→ ADR / decisions-log

"Qual é a regra para agentes?"
→ AGENTS.md

"Qual é o contrato atual de privacidade?"
→ privacy-lgpd.md

"Como chegamos a esta decisão?"
→ reviews/history

"O que ocorreu em cada sessão?"
→ session-log.md
```

Índices podem resumir e apontar.

Eles NÃO devem replicar longamente fatos voláteis.

---

# 6. Objetivo de `AGENTS.md`

Preserve `AGENTS.md` como fonte canônica.

Ele deve conter somente informações que mudam o comportamento de diversas sessões futuras e são razoavelmente estáveis.

Exemplos apropriados:

- autoridade;
- branch strategy;
- protocolo Claude↔Codex;
- regras de shell realmente duráveis;
- precedência;
- como iniciar uma sessão;
- invariantes de escrita/OCC/outbox;
- comandos canônicos;
- maintenance rules.

Evite nele:

- contagem corrente de testes;
- milestone corrente;
- PR corrente;
- quantidade de Lambdas;
- status transitório de M7/Waves;
- lista histórica detalhada de implementações.

Analise especificamente a atual seção `## 7. Código real (M0 em diante)`.

Não a apague cegamente.

Separe:

```text
stable engineering invariants
```

de:

```text
temporal project state
```

e mova somente o que for necessário.

Respeite a meta de tamanho já declarada pelo próprio `AGENTS.md`.

---

# 7. Objetivo de `NEXT_SESSION_PROMPT.md`

Transforme `NEXT_SESSION_PROMPT.md` novamente em:

> **estado corrente + próxima ação**

e NÃO em:

> história cumulativa do projeto.

Ele deve ser suficientemente curto para uma nova sessão conseguir lê-lo integralmente sem desperdiçar contexto em dezenas de milestones encerrados.

Estrutura recomendada, adaptável ao projeto real:

```text
# Current State

## Branch / as-of
commit ou data de reconciliação

## Current phase

## What is actually implemented

## What is currently in progress

## Open gates / blockers

## Decisions deliberately deferred

## Next actions

## Required reading for the next action

## Current evidence status
DESIGNED / IMPLEMENTED / DEPLOYED / E2E PROVEN etc.

## Links to history
session-log / decisions / reviews
```

Não copie histórico detalhado para esse arquivo.

Use links.

Meta inicial:

```text
aproximadamente 60–150 linhas
```

Não trate isso como gate artificial; se o código real justificar mais, explique.

O objetivo é densidade de informação, não apenas line count.

---

# 8. `README.md`

README deve ser:

```text
public / human entry point
```

Não fonte de estado normativo.

Atualize-o para não afirmar um estado materialmente antigo do sistema.

Ele deve apresentar de forma curta:

- o que é o produto;
- estágio aproximado;
- stack;
- quick start;
- estrutura;
- links para `AGENTS.md`, arquitetura e current state.

Evite duplicar detalhes de milestones.

---

# 9. Índices temáticos

Audite:

```text
docs/architecture/README.md
docs/engineering/README.md
docs/frontend/README.md
```

Cada índice deve:

- orientar navegação;
- declarar precedência relevante;
- classificar documentos;
- apontar para documentos correntes;
- distinguir corrente vs histórico;
- evitar repetir longos estados de implementação.

Eles devem funcionar como **routers de contexto**, não como handoffs extensos.

Se o índice de arquitetura possuir um enorme bloco `Last verified` duplicando `NEXT_SESSION_PROMPT.md`, considere reduzir esse bloco para um ponteiro de estado, mantendo apenas status arquitetural que realmente pertença ao índice.

---

# 10. Raiz do repositório

Faça inventário de TODOS os `.md` e artefatos de handoff/prompt existentes na raiz.

Classifique cada um como:

```text
CANONICAL_ROOT
CURRENT_ROUTER
CURRENT_NORMATIVE
TEMPORARY_HANDOFF
HISTORICAL_PROMPT
HISTORICAL_EVIDENCE
DUPLICATE
UNKNOWN
```

Não delete história útil.

Prefira `git mv`.

Determine a pasta correta segundo as convenções já existentes.

Se nenhuma pasta existente for semanticamente adequada, crie a menor estrutura possível, por exemplo conceitualmente:

```text
docs/project/handoffs/
```

ou equivalente melhor justificado contra o repo real.

Não crie uma taxonomia profunda desnecessária.

Objetivo:

> a raiz deve deixar visualmente óbvio quais arquivos são pontos de entrada canônicos.

---

# 11. Não transformar isso em uma nova documentação gigantesca

Evite criar:

```text
CONTEXT-SYSTEM-V2.md
CONTEXT-MANIFEST-FINAL.md
MASTER-CONTEXT.md
ULTIMATE-AGENT-GUIDE.md
```

se os documentos atuais podem assumir corretamente essas responsabilidades.

A regra é:

> **consolidar antes de adicionar.**

Novo arquivo só deve existir se houver uma responsabilidade que não pertence claramente a nenhum documento existente.

---

# 12. Context graph

Construa durante a análise um mapa real de dependências de contexto.

Exemplo conceitual:

```text
AGENTS
├── NEXT_SESSION
├── architecture/README
│   ├── ADR
│   ├── data-model
│   ├── privacy
│   └── ...
├── engineering/README
└── frontend/README
```

Procure:

- ciclos desnecessários;
- referências bidirecionais que duplicam verdade;
- documento histórico referenciado como normativo;
- fontes com ownership ambíguo.

A versão final desse mapa pode ficar apenas no relatório/review se não houver valor em mantê-la permanentemente.

---

# 13. Current truth reconciliation

Antes de reescrever qualquer status:

1. confirme branch `develop`;
2. inspecione `git log`;
3. inspecione PRs/branches quando disponível;
4. verifique código;
5. verifique testes;
6. verifique infra;
7. consulte documentação normativa;
8. trate `NEXT_SESSION_PROMPT.md` como uma pista de estado, nunca como prova suficiente.

Corrija divergências conhecidas e quaisquer outras descobertas.

Não "atualize" uma informação apenas copiando de outro documento stale.

---

# 14. Automação / guardrails

Avalie criticamente como ampliar `npm run check-docs` sem tentar resolver semântica humana com regex frágil.

Candidatos úteis:

## 14.1 Root context allowlist

Falhar CI quando um novo `.md` de prompt/handoff for adicionado à raiz fora de uma allowlist explícita de documentos canônicos.

Exemplo conceitual:

```text
allowed root docs:
AGENTS.md
CLAUDE.md
README.md
ARCHITECTURE.md
ENGINEERING.md
NEXT_SESSION_PROMPT.md
LICENSE-related docs se houver
```

Adapte à realidade.

Isso impediria regressão da poluição da raiz.

---

## 14.2 Limite/alerta de contexto

Avalie um guardrail para detectar crescimento anormal de:

```text
AGENTS.md
NEXT_SESSION_PROMPT.md
```

Pode ser:

- limite rígido quando já existir regra normativa;
- warning/test baseado em linhas/bytes;
- teste específico.

Não imponha limites arbitrários sem justificativa.

Para `AGENTS.md`, respeite a própria meta existente.

---

## 14.3 History boundary

Avalie se é possível detectar referências que tratem arquivos sob:

```text
history/
reviews/
handoffs/
```

como fonte normativa direta.

Não implemente heurística frágil que gere falsos positivos em massa.

Se não houver enforcement robusto, documente como check manual.

---

## 14.4 Canonical source assertions

Procure checks baratos e determinísticos.

Exemplo:

- `CLAUDE.md` continua importando/apontando para `AGENTS.md` e não duplica regras;
- links dos routers existem;
- root allowlist;
- `NEXT_SESSION_PROMPT` aponta para `session-log` e `decisions-log`;
- índices não apontam para arquivos inexistentes.

---

# 15. Não overengineer semantic drift detection

Não tente escrever um "AI semantic docs validator" ou parser complexo para decidir automaticamente se duas frases contradizem.

O CI deve automatizar aquilo que pode provar deterministicamente.

Contradições semânticas continuam sendo verificadas por:

```text
milestone reconciliation checklist
+
review humano/IA
```

A automação deve diminuir regressões óbvias, não fingir resolver verdade semântica.

---

# 16. Processo de milestone

A solução deve estabelecer uma rotina simples para cada milestone relevante.

Exemplo:

```text
code/infra milestone concluído
↓
reconcile current truth
↓
update canonical thematic doc if needed
↓
update decision record
↓
update NEXT_SESSION
↓
append session-log
↓
run check-docs
```

Evite que cinco documentos precisem receber a mesma frase de status.

Se isso estiver acontecendo, corrija ownership.

---

# 17. Engenharia de contexto para forks/agentes especializados

Preserve a regra existente:

```text
RESEARCH / RECON / REVIEW / CODEX
→ read-only
```

e garanta que prompts de fork forneçam apenas:

- objetivo;
- arquivos relevantes;
- invariantes;
- output esperado.

Não mande cada fork reler todo o repositório indiscriminadamente.

Avalie se os routers atuais fornecem progressive disclosure suficiente para isso.

---

# 18. Claude ↔ Codex

Mudanças em:

- `AGENTS.md`;
- precedência;
- ownership de fonte;
- fluxo de início de sessão;
- regras de agente;
- enforcement estrutural da documentação;

possuem alto blast radius sobre futuras sessões.

Classifique o risco segundo `change-risk-scale.md`.

Quando o protocolo for aplicável, execute Claude↔Codex conforme `AGENTS.md`.

O Codex deve atuar adversarialmente.

Peça que procure especificamente:

1. fonte com ownership ambíguo;
2. regra durável removida por engano;
3. fato corrente escondido em histórico;
4. prompt histórico ainda apresentado como entrada;
5. novo ciclo de duplicação;
6. links quebrados após `git mv`;
7. `NEXT_SESSION` ainda acumulando história;
8. `AGENTS` ainda carregando fatos temporais;
9. guardrail que pode gerar falso positivo ou ser trivialmente burlado;
10. perda de audit trail/history causada pela limpeza.

Continue reconciliando findings reais até atender o gate aplicável.

---

# 19. Preservação de histórico

Muito importante:

> **context minimization não significa apagar história.**

Reviews adversariais, prompts importantes, relatórios de drills e handoffs podem possuir valor de auditoria.

Mova para a camada correta.

Não reescreva documento histórico para fazê-lo parecer corrente.

Quando necessário:

```text
historical document
→ permanece intacto

current router
→ deixa claro que é histórico

current state
→ aponta para a fonte vigente
```

---

# 20. Escopo explicitamente fora desta tarefa

NÃO implementar nesta tarefa:

```text
Organization
Membership
RBAC
tenantId migration
Billing
Document Lifecycle
Archive
Signature
SMS
WhatsApp
new product features
large backend refactors
```

Multi-User B2B será um milestone posterior.

Pode ser mencionado como estado/deferred decision se necessário para reconciliar documentação, mas não deve ser implementado.

---

# 21. Entregáveis esperados

Produza e/ou atualize, conforme necessário:

## A. Context Inventory

Uma tabela ou relatório contendo:

```text
arquivo
responsabilidade
classificação
autoridade
volatilidade
problema encontrado
ação
```

## B. Source Ownership Matrix

Algo equivalente a:

| Informação | Fonte canônica |
|---|---|
| processo de agente | AGENTS |
| estado atual | NEXT_SESSION |
| decisão Type 1 | ADR/decisions |
| arquitetura temática | docs/architecture |
| histórico | session-log/reviews/history |

Não precisa criar novo arquivo permanente se essa matriz puder ser incorporada elegantemente ao router existente.

## C. Root cleanup

Mover prompts/handoffs históricos para local apropriado.

## D. `AGENTS.md` reconciliation

Remover/realocar estado temporal sem perder invariantes.

## E. `NEXT_SESSION_PROMPT.md` compaction

Reescrever para current truth + next action.

## F. README reconciliation

Atualizar sem transformá-lo em fonte normativa.

## G. Router reconciliation

Architecture / Engineering / Frontend indexes coerentes.

## H. Guardrails

Melhorias determinísticas em `check-docs` ou scripts equivalentes, se justificadas.

## I. Tests

Testes para qualquer mudança de script/guardrail.

## J. Context Architecture Review

Registro da revisão Claude↔Codex quando aplicável.

---

# 22. Critério de sucesso

A tarefa só deve ser considerada concluída se um agente novo puder responder rapidamente, sem abrir dezenas de arquivos:

```text
1. O que é o produto?
2. Em que fase está?
3. Qual é a próxima ação?
4. Que documentos preciso ler para esta tarefa específica?
5. Qual fonte vence em caso de divergência?
6. Onde estão as decisões?
7. Onde está o histórico?
8. O que é normativo e o que é evidência?
```

E, ao mesmo tempo:

```text
não perdeu história
não duplicou regras
não criou novo "master context"
não moveu fatos sem atualizar links
não introduziu guardrail frágil
```

---

# 23. Métricas comparativas antes/depois

Antes de alterar, capture pelo menos:

```text
número de .md na raiz
linhas/bytes de AGENTS.md
linhas/bytes de NEXT_SESSION_PROMPT.md
linhas/bytes de README.md
quantidade de prompts/handoffs na raiz
links quebrados detectados
```

Depois da mudança, capture os mesmos dados.

Não use redução de linhas como objetivo absoluto.

Use-a como evidência de redução de superfície de contexto.

---

# 24. Validação final

Execute todos os checks pertinentes.

No mínimo, conforme aplicável:

```text
npm run check-docs
npm run lint
npm run typecheck
```

Se scripts/testes forem alterados:

```text
testes específicos
npm test quando proporcional
```

Não declare o milestone aprovado com CI quebrado.

---

# 25. Git

Use commits pequenos e semanticamente coerentes.

Exemplos conceituais:

```text
docs(context): reconcile canonical context ownership
```

```text
docs(context): archive historical root handoffs
```

```text
test(context): enforce canonical root documentation
```

Siga as convenções reais do projeto.

Faça commit e push conforme `AGENTS.md`.

Não termine com trabalho relevante apenas local.

Se a branch strategy exigir PR, siga-a.

Não faça merge `develop → main` sem respeitar a confirmação exigida pelo `AGENTS.md`.

---

# 26. Decisões que dependerem do usuário

Se surgir decisão genuinamente de produto ou preferência pessoal de Marcelo:

1. registre a pendência;
2. escolha a opção mais conservadora apenas quando permitido;
3. não bloqueie todo o milestone;
4. continue com tudo que for independente dessa decisão.

Não pergunte ao usuário sobre decisões técnicas ordinárias de organização documental quando elas puderem ser resolvidas pelos princípios e evidência existentes.

---

# 27. Relatório final

Ao terminar, reporte:

```text
1. Diagnóstico inicial.
2. Root context surface antes/depois.
3. Arquivos movidos.
4. Arquivos reduzidos/reconciliados.
5. Novo ownership de cada tipo de contexto.
6. Drift semântico corrigido.
7. Guardrails adicionados.
8. Testes executados.
9. Findings do Codex.
10. Commits.
11. Push/PR status.
12. Pendências reais.
13. Como um agente novo deve iniciar uma sessão agora.
```

---

# 28. Princípio final

O objetivo não é ter "mais documentação".

O objetivo é:

> **dar ao agente certo a menor quantidade de contexto correta, no momento certo, a partir de fontes cuja autoridade seja inequívoca.**

A solução ideal deve tornar o repositório:

```text
mais fácil de entender
+
mais difícil de interpretar errado
+
mais barato em contexto
+
mais resistente a drift
+
mais auditável
```

sem perder a disciplina e a evidência histórica que já são pontos fortes do Expiration Tracker.

Faça primeiro a auditoria read-only.

Depois proponha o desenho mínimo.

Submeta mudanças de alto blast radius ao protocolo aplicável.

Implemente.

Teste.

Peça ao Codex para tentar quebrar.

Corrija.

Faça commit.

Faça push.

Continue até concluir o milestone.
