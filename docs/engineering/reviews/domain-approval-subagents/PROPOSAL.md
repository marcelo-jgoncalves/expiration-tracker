---
status: draft — pesquisa e planejamento, não implementado, não submetido ao protocolo Claude↔Codex
owner: Marcelo (decisão final)
authority: proposta, não normativa
---

# Proposta — Subagentes de aprovação por domínio técnico

Pedido de Marcelo, 2026-09-20: avaliar subagentes customizados acionados ao final de toda tarefa,
cada um responsável por um domínio técnico já estabelecido no projeto, aprovando (ou não) antes da
tarefa ser considerada de fato concluída. Escopo desta rodada: **só pesquisa/design, nada
implementado**. Este documento é o entregável.

## 1. Domínio a reaproveitar: os 9 eixos já formalizados, não uma taxonomia nova

O projeto já tem uma taxonomia de domínios técnicos madura e calibrada:
`docs/engineering/joint-review-criteria.md` — 9 eixos convergidos por protocolo Claude↔Codex
(Arquitetura, Qualidade de Engenharia, Engenharia de Contexto, Segurança da
Informação/AppSec, Privacidade e Governança de Dados, Operações/SRE e Continuidade de Negócio,
Governança de IA, Governança Jurídica/Contratual/Terceiros, Governança de Produto/Multi-tenant),
cada um com critérios ponderados e definições próprias. Não observabilidade como eixo isolado —
hoje ela é um critério dentro de Qualidade de Engenharia (`Debuggability & Operational Feedback`) e
de Operações/SRE (`Observabilidade Operacional & Visão por Tenant`), não um domínio de primeira
classe por si só.

Criar um vocabulário de domínio paralelo (ex. "agente de observabilidade", "agente de
performance") duplicaria essa taxonomia em vez de reaproveitá-la, e já existe um comando explícito
contra isso: `joint-review-criteria.md` §"Como adicionar um novo eixo" veta redefinir critérios
fora do processo de convergência. **Recomendação**: um subagente por eixo formalizado, nunca um
subagente por conceito ad-hoc — se um domínio novo (ex. FinOps, já citado como 10º eixo aprovado
mas sem critérios definidos) precisar de agente, ele passa primeiro pela convergência do eixo em
si, não ganha agente antes de ter critério.

## 2. O que já existe e faria parte da mesma máquina, sem duplicar

- `docs/engineering/task-completion-checklist.md` + skill `/task-checklist` — já pede, por tarefa,
  marcar cada um dos 9 eixos como N/A ou avaliado (§3 do documento). Hoje isso é feito por UM agente
  (quem executou a tarefa) aplicando a checklist inteira sozinho.
- `docs/engineering/definition-of-done.md` — já escala o gate pelo nível de risco
  (`change-risk-scale.md`); nível 5-6 já exige protocolo Claude↔Codex (nota cega, ≥9,0, dois
  agentes independentes).
- `AGENTS.md` §4 — já é, na prática, um subagente de aprovação por domínio: o protocolo
  Claude↔Codex É um mecanismo de segunda opinião obrigatória para decisões Type 1.

O pedido de Marcelo generaliza esse padrão (hoje só para decisões Type 1) para **toda tarefa**, e
o especializa por eixo em vez de um revisor genérico único.

## 3. Desenho técnico — onde os agentes vivem

Duas opções viáveis com o Agent tool disponível nesta sessão:

**Opção A — subagentes nomeados (`.claude/agents/<eixo>.md`)**. Hoje `.claude/agents/` não existe
neste repo (só `.claude/skills/task-checklist/`). Cada eixo ganharia um arquivo de agente com
frontmatter (nome, descrição, ferramentas permitidas) e um system prompt fixo: a seção do eixo em
`joint-review-criteria.md` + instrução de aprovar/reprovar com achado concreto arquivo:linha,
nunca nota alta sem evidência (mesmo princípio de `principles.md` #7). O agente é acionado via
`Agent` tool com `subagent_type: "<eixo>"`, sempre um agente fresco (sem contexto da sessão) — bom
para independência de revisão, ruim para custo (ver §5).

**Opção B — uma skill orquestradora (`/domain-approval` ou similar) que dispara N chamadas do
Agent tool em sequência ou paralelo**, cada uma com o prompt do eixo embutido, sem precisar de N
arquivos de agente separados. Mais barato de manter (um só arquivo), mas perde a listagem
individual dos agentes na lista de "Available agent types" — não há diferença de custo em token de
execução real entre as duas opções, só de manutenção do artefato.

Nenhuma das duas precisa do `Workflow` tool (orquestração multi-agente declarada) — isso é
"paralelizar por padrão", que o próprio `AGENTS.md` §1 já rebaixou de default (achado de custo real
da mesma sessão que o registrou). Se algum dia os N agentes precisarem rodar em paralelo de forma
determinística com resultado agregado, `Workflow` é a ferramenta certa — não para o volume normal
de tarefas de uma sessão.

## 4. O que "aprovação" significa, concretamente

Duas réguas possíveis, não mutuamente exclusivas:

1. **Binária por eixo tocado** (mais barata): o agente do eixo lê o diff real e responde
   `APROVADO` / `REPROVADO com achado <arquivo:linha, descrição, severidade>` — não há nota
   numérica, é o mesmo padrão N/A-ou-avaliado que `task-completion-checklist.md` §3 já usa, só que
   feito por um agente independente em vez de autoavaliação.
2. **Nota ponderada por eixo** (mesma régua do protocolo Claude↔Codex): reaproveita os pesos de
   `joint-review-criteria.md`, gate ≥9,0. Mais caro (mais raciocínio por chamada) e só se justifica
   para decisões que já seriam nível 5-6 — que já têm o protocolo Claude↔Codex fazendo exatamente
   isso hoje.

**Recomendação**: opção 1 (binária) para todo item nível 1-4, reaproveitando o protocolo
Claude↔Codex já existente (opção 2) só para nível 5-6 — não duplicar a régua de nota mínima em dois
mecanismos paralelos.

## 5. Custo real — o problema central desta proposta

Cada eixo tocado por uma tarefa = 1 chamada de agente completa (não é grátis: contexto do eixo +
diff da tarefa + raciocínio). Para uma tarefa nível 1-2 (ex. corrigir um typo), rodar N agentes de
aprovação custaria ordens de magnitude mais caro que a própria correção — viola diretamente
`principles.md` #1 (sofisticação segue complexidade observada) se aplicado sem escala pelo risco.

**Mitigação proposta**: acoplar a ativação de cada agente de eixo à mesma tabela de
`task-completion-checklist.md` §3 — só agentes dos eixos marcados como "tocados" (não N/A) rodam, e
só a partir de um nível mínimo de risco a decidir (candidato: nível 3+, mesmo piso que
`definition-of-done.md` já usa para exigir a linha `DoD:` formal). Nível 1-2 continua na disciplina
atual (autoavaliação + typecheck/lint), sem agente de aprovação — o custo de errar um cosmético é
desproporcional ao custo de rodar N agentes para pegá-lo.

## 6. Risco real: "teatro de aprovação"

`ai-governance.md` §1 critério 3 (Independência da Revisão) já registra por que isso importa: "sem
[nota cega/segregação real], revisão Claude↔Codex viraria teatro". O mesmo risco se aplica aqui —
um agente-por-eixo que sempre aprova, ou que aprova sem ler o diff real, não é um controle, é
latência e custo sem benefício. Mitigações já usadas no protocolo existente e diretamente
reaproveitáveis:

- Nota cega não se aplica da mesma forma (não há segunda IA independente rodando o mesmo protocolo
  Claude↔Codex aqui — são N agentes do mesmo Claude Code, não um segundo fornecedor). Isso é uma
  diferença material: **estes agentes não têm a mesma independência de fornecedor que o protocolo
  `AGENTS.md` §4 tem com o Codex** — são todos o mesmo modelo avaliando a si mesmo por ângulos
  diferentes, não uma segunda opinião genuinamente externa. Vale para reprovar bugs
  mecânicos/checklist esquecido, não substitui o valor específico de nota cega Claude↔Codex para
  decisões Type 1.
- Achado exige `arquivo:linha` concreto, nunca aprovação genérica (`principles.md` #7 já é a
  régua).
- Reprovação de um agente bloqueia o fechamento do item (senão a aprovação não significa nada) —
  mas precisa de um caminho de "aceitar o risco e prosseguir mesmo assim" com dono e justificativa
  (mesmo padrão de `exceptions.md`), para não travar a sessão indefinidamente num achado de baixa
  severidade contestável.

## 7. Isto é, em si, uma decisão de processo de escopo permanente

`definition-of-done.md` (E-012) e `task-completion-checklist.md` só existem hoje porque passaram
pelo protocolo Claude↔Codex (3 rodadas, ≥9,0) — mudam como todo trabalho futuro é avaliado, mesmo
não sendo decisão de arquitetura de sistema. Implementar de fato N subagentes de aprovação
obrigatórios muda a mesma coisa, na mesma escala. **Se/quando isto sair de proposta para
implementação real, é candidato ao mesmo tratamento** (nível 5-6 da `change-risk-scale.md`,
protocolo `AGENTS.md` §4 completo) — não porque seja tecnicamente complexo, mas porque redefine o
gate de conclusão de toda tarefa futura, mesmo critério que classificou E-012.

## 8. Recomendação e perguntas em aberto para Marcelo

**Recomendação desta rodada**: começar pequeno e medir antes de generalizar (`principles.md` #1) —
pilotar com 2-3 eixos de maior sinistralidade real observada neste projeto (Qualidade de
Engenharia, Segurança da Informação/AppSec, Engenharia de Contexto — os três com mais achados
reais registrados em `decisions-log.md`), só para itens nível 3+, opção binária (§4.1), antes de
estender aos 9 eixos e a todo nível de risco.

Perguntas de decisão, não técnicas:

1. Generalizar para os 9 eixos de uma vez, ou pilotar com um subconjunto primeiro (recomendação
   acima)?
2. A partir de qual nível de risco (`change-risk-scale.md`) os agentes de aprovação entram? (
   recomendação: nível 3+, nível 1-2 continua só com typecheck/lint)
3. Reprovação de um agente é bloqueante de fato (item não pode virar `completed`) ou apenas um
   achado registrado que a sessão pode decidir aceitar com justificativa?
4. Vale a pena pilotar como Opção A (agentes nomeados) ou B (skill orquestradora) primeiro — ou
   pilotar as duas em paralelo por 1-2 sessões e comparar custo/sinal real antes de escolher?
