# Missão

Atue como **Principal Product Engineer / UX Architect / Interaction Engineer** responsável pelo planejamento da interface do projeto:

**Expiration Tracker**

Repositório:

**https://github.com/marcelo-jgoncalves/expiration-tracker**

Sua tarefa é realizar a **primeira etapa formal do planejamento da interface**:

> **Contexto de Uso + Papéis dos Usuários + Jobs to Be Done + Inventário e Classificação das Tarefas Críticas**

Você NÃO deve ainda:

- criar wireframes;
- desenhar telas;
- decidir sidebar;
- decidir dashboard;
- escolher cores;
- definir identidade visual;
- escolher componentes visuais;
- montar mockups;
- implementar frontend.

O objetivo desta etapa é responder:

> **Quem utiliza o Expiration Tracker, para fazer o quê, em quais contextos, manipulando quais objetos e com quais consequências quando algo dá errado?**

O resultado será utilizado posteriormente para derivar:

```text
modelo conceitual da interface
↓
arquitetura da informação
↓
jornadas
↓
screen/state model
↓
wireframes
↓
design system
↓
interface final
```

---

# 1. Regra fundamental

Não derive a interface da estrutura técnica do backend.

Não faça:

```text
src/modules/expiration
→ menu "Expiration"

src/modules/notification
→ menu "Notification"

src/modules/document
→ menu "Document"
```

A estrutura técnica existe para engenharia.

A interface deve nascer do:

- trabalho real do usuário;
- modelo mental do usuário;
- frequência das tarefas;
- criticidade;
- informação necessária para tomada de decisão.

Regra:

> **O domínio técnico informa a interface, mas não determina sua arquitetura.**

---

# 2. Material obrigatório de análise

Antes de produzir qualquer conclusão, faça uma leitura profunda do repositório.

Não se limite ao README.

Inspecione:

```text
README
AGENTS.md
docs/
schemas/
src/
infra/
.github/
```

e especialmente:

- requisitos;
- arquitetura;
- roadmap;
- milestones;
- ADRs;
- decisions log;
- data model;
- implementation blueprint;
- frontend quality standards;
- interface quality standard;
- documentação de identity;
- documentos;
- expiration;
- reminder;
- notification;
- subjects;
- requirements;
- external contacts;
- document request;
- upload;
- OCR/AI;
- organizations/memberships;
- billing/entitlements;
- qualquer feature já incorporada após versões anteriores do roadmap.

Analise o **estado atual do código**, não apenas planos antigos.

---

# 3. Primeiro entregável: estado funcional real do produto

Antes de pensar em usuários, produza uma tabela:

| Capability | Implementada | Parcial | Planejada | Não existe | Observação |
|---|---|---|---|---|---|

Inclua pelo menos:

- cadastro de vencimentos;
- edição;
- renovação;
- documentos;
- upload;
- malware scanning;
- OCR/extraction;
- reminders;
- notifications;
- responsáveis;
- subjects;
- requirements;
- external contacts;
- document requests;
- guest upload;
- import;
- organization/membership;
- RBAC;
- billing;
- WhatsApp;
- histórico;
- auditabilidade.

O objetivo é evitar projetar tarefas para funcionalidades que não existem nem estão planejadas.

---

# 4. Distinguir três horizontes

Para cada capacidade, classifique:

## NOW

Deve ser suportada pela primeira interface relevante.

## NEXT

Já faz parte da evolução próxima e deve influenciar decisões estruturais.

## LATER

Existe no roadmap, mas não deve complicar a primeira interface.

Isso será muito importante para evitar overdesign.

---

# 5. Identifique os papéis reais de usuário

Não crie personas fictícias cheias de detalhes demográficos.

Não precisamos de:

```text
Carlos, 37 anos, gosta de café e tecnologia...
```

Precisamos de **papéis funcionais**.

Exemplos apenas como hipóteses:

```text
dono de pequena empresa

responsável administrativo

responsável por documentos/compliance operacional

gestor

colaborador responsável por itens específicos

fornecedor/prestador externo

administrador do workspace
```

Não aceite essa lista automaticamente.

Derive-a do produto.

---

# 6. Para cada papel, documente

Use formato:

```text
Role:
Primary objective:
Secondary objectives:
Responsibilities:
Information needed:
Actions performed:
Frequency:
Criticality:
Technical sophistication:
Typical environment:
Main risks:
```

Exemplo conceitual:

```text
Role:
Responsável administrativo

Primary objective:
Garantir que documentos e obrigações sob sua responsabilidade permaneçam atualizados.

Responsibilities:
- acompanhar vencimentos
- cadastrar documentos
- renovar
- cobrar terceiros
- responder a alertas

Information needed:
- o que está vencido
- o que vence em breve
- responsável
- documento atual
- status da renovação
```

---

# 7. Diferencie usuário interno de externo

Essa distinção é fundamental.

## Internal user

Usuário autenticado do SaaS.

Pode possuir:

- workspace;
- membership;
- role;
- permissões;
- responsabilidade por itens;
- acesso a dados internos.

## External participant

Pode ser:

- fornecedor;
- prestador;
- funcionário externo;
- contador;
- corretor;
- cliente;
- outro contato.

Pode receber:

```text
document request
magic link
guest upload
```

mas não necessariamente possuir conta.

Não trate esses dois grupos como a mesma coisa.

---

# 8. Identifique Jobs to Be Done

Para cada papel, derive Jobs to Be Done.

Use estrutura:

```text
Quando...
quero...
para que...
```

Exemplo:

```text
Quando começo o dia,
quero saber quais documentos precisam da minha atenção,
para evitar que algo importante vença sem ação.
```

Outro:

```text
Quando recebo um documento renovado,
quero atualizar o vencimento rapidamente,
para iniciar automaticamente o próximo ciclo de monitoramento.
```

Outro:

```text
Quando um fornecedor precisa atualizar um documento,
quero solicitar a atualização sem criar trabalho manual de acompanhamento,
para reduzir cobrança por e-mail/WhatsApp.
```

Não transforme cada botão potencial em JTBD.

JTBD deve representar intenção real.

---

# 9. Inventário completo de tarefas

Depois dos JTBD, produza um inventário detalhado de tarefas.

Exemplos a investigar:

```text
abrir aplicação

identificar o que precisa de atenção

ver vencidos

ver vencendo em breve

ver itens sem problema

buscar item

filtrar por status

filtrar por responsável

filtrar por subject

abrir detalhe

criar vencimento

editar vencimento

renovar vencimento

arquivar

associar documento

substituir documento

fazer upload

acompanhar processamento

confirmar data extraída

corrigir data extraída

atribuir responsável

consultar histórico

ver notificações enviadas

alterar política de reminder

criar subject

associar vencimento ao subject

ver todos os requisitos de um subject

identificar requirement ausente

solicitar documento

acompanhar request

reenviar request

aprovar submission

rejeitar submission

importar planilha

corrigir erros de importação

exportar dados

adicionar usuário

alterar permissões

configurar organização

configurar preferências

gerenciar assinatura
```

Mas derive a lista final do produto real.

---

# 10. Classificação de criticidade das tarefas

Classifique cada tarefa como:

## T0 — Mission Critical

Falha pode levar a:

- perda de vencimento;
- decisão operacional errada;
- documento permanecer irregular;
- falsa sensação de segurança;
- perda de informação relevante.

## T1 — Core

Parte central da proposta de valor e realizada com frequência.

## T2 — Supporting

Importante, mas secundária.

## T3 — Administrative

Configuração ou manutenção eventual.

---

# 11. Critério de classificação

Não classifique com base em complexidade técnica.

Exemplo:

```text
trocar avatar
```

pode ser fácil tecnicamente, mas T3.

Enquanto:

```text
confirmar corretamente uma nova validade
```

pode ser simples tecnicamente e T0.

A classificação é baseada em:

> impacto sobre o objetivo do usuário.

---

# 12. Para cada tarefa, estime frequência

Classifique aproximadamente:

```text
many times per day
daily
weekly
monthly
occasional
rare
event-driven
```

Isso será usado mais tarde para hierarquia da interface.

Uma tarefa:

```text
daily + T0
```

merece muito mais proeminência do que:

```text
annual + T3
```

---

# 13. Crie uma matriz Criticidade × Frequência

Exemplo:

| Tarefa | Criticidade | Frequência | Prioridade UI |
|---|---|---|---|
| ver vencidos | T0 | diária | máxima |
| renovar documento | T0 | event-driven | máxima |
| criar item | T1 | semanal | alta |
| editar billing | T3 | rara | baixa |

Derive uma coluna:

```text
UI Priority
```

com algo como:

```text
P0
P1
P2
P3
```

Não confundir essa classificação com roadmap técnico.

---

# 14. Descubra tarefas de leitura versus tarefas de ação

Classifique:

## Awareness / Monitoring

Usuário precisa saber:

```text
o que está vencido?
o que vence em breve?
qual fornecedor está irregular?
qual documento ainda está processando?
```

## Investigation

Usuário precisa entender:

```text
por que está vencido?
quem é responsável?
qual documento atual?
qual foi a última renovação?
```

## Action

Usuário faz:

```text
renovar
corrigir
solicitar
aprovar
atribuir
```

## Configuration

Usuário define:

```text
política de alerta
membros
preferências
billing
```

Essa separação ajudará posteriormente a projetar dashboard, detalhes e ações.

---

# 15. Contexto de uso

Identifique contextos concretos.

Exemplos:

### Morning operational review

```text
usuário entra no sistema
↓
quer responder:
"o que precisa da minha atenção hoje?"
```

### Reactive reminder

```text
usuário recebe e-mail
↓
abre item específico
↓
age
```

### New document received

```text
documento chega por e-mail/WhatsApp
↓
usuário abre sistema
↓
faz upload
↓
renova
```

### External document collection

```text
supplier receives request
↓
opens magic link
↓
uploads document
```

### Audit/investigation

```text
gestor precisa saber:
quem alterou?
quando?
qual documento estava vigente?
```

Não aceite esses cenários automaticamente.

Encontre os cenários realmente suportados pelo produto.

---

# 16. Para cada contexto, documente

```text
Trigger
Actor
Goal
Starting point
Information needed
Actions
Decision points
Success condition
Failure conditions
Frequency
Criticality
```

---

# 17. Identifique tarefas críticas T0

Produza uma seção separada:

# Mission-Critical Task Inventory

Para cada T0:

```text
Task ID
Actor
Goal
Trigger
Preconditions
Happy path
Error paths
Required information
Required feedback
Success definition
Failure consequences
```

Essas tarefas serão posteriormente tratadas como **gates de interface**.

---

# 18. Não modele apenas happy path

Para cada tarefa crítica, considere:

```text
API offline

session expired

item alterado por outra pessoa

upload falhou

malware detectado

OCR não encontrou data

OCR encontrou data errada

notification failed

document already replaced

permission changed

supplier link expired

duplicate submit

network timeout
```

A interface precisa nascer já consciente desses estados.

---

# 19. Crie inventário de decisões do usuário

Uma interface operacional frequentemente existe para permitir decisões.

Mapeie explicitamente:

```text
o que exige minha atenção?

isso está vencido?

devo renovar?

essa data está correta?

esse documento pode ser aprovado?

quem deve agir?

esse fornecedor está regular?

preciso reenviar solicitação?
```

Para cada decisão:

> qual informação o usuário precisa enxergar para decidir corretamente?

Essa análise será muito importante para o futuro screen model.

---

# 20. Modelo conceitual visto pelo usuário

A partir do repositório, liste as entidades técnicas.

Depois traduza para conceitos de usuário.

Exemplo hipotético:

| Backend | Conceito potencial na interface |
|---|---|
| ExpirationItem | Vencimento |
| TrackedSubject | Fornecedor / Pessoa / Equipamento |
| RequirementAssignment | Documento obrigatório |
| DocumentSubmission | Documento recebido |
| NotificationIntent | não precisa aparecer |
| ReminderPolicy | Alertas |

Não aceite esses nomes automaticamente.

Pergunte:

> O usuário realmente pensa nesse conceito?

---

# 21. Classifique conceitos técnicos em três grupos

## USER-FACING

Devem existir como objeto compreensível.

## SUPPORTING

Precisam aparecer apenas em contexto.

## INTERNAL ONLY

Não devem aparecer na interface.

Exemplo:

```text
NotificationIntent
```

provavelmente é internal only.

Mas confirme.

---

# 22. Identifique possíveis conflitos terminológicos

Procure termos como:

```text
item
document
requirement
subject
contact
responsible
assignee
owner
manager
notification
reminder
request
submission
expiration
renewal
```

Pergunte:

- usuário diferencia esses conceitos?
- há nomes melhores em português?
- algum nome técnico criará confusão?
- existe termo diferente dependendo da vertical?

Não resolva definitivamente naming ainda.

Apenas registre ambiguidades.

---

# 23. Identifique informações críticas

Produza um inventário das informações que provavelmente precisam ser rapidamente perceptíveis.

Exemplos:

```text
nome

status

data de vencimento

dias restantes

responsável

subject

documento associado

última renovação

alerta enviado

processamento pendente

request pendente

erro
```

Classifique:

```text
Primary
Secondary
Contextual
Advanced
```

Isso posteriormente orientará hierarquia visual.

---

# 24. Identifique relações importantes

Exemplo:

```text
Subject
  ↓
Requirements
  ↓
Current documents
  ↓
Expiration status
```

ou:

```text
Expiration
  ↓
Responsible user
  ↓
Reminder
  ↓
Notification history
```

A interface não precisa mostrar todas simultaneamente.

Mas precisamos entender o modelo.

---

# 25. Considere densidade e escala

Analise como as tarefas mudam para:

```text
5 itens
50 itens
500 itens
5.000 itens
```

Pergunte:

- quando cards deixam de funcionar?
- quando tabela passa a ser necessária?
- quando busca vira essencial?
- quando filtros são necessários?
- quando bulk actions surgem?
- quando dashboard agregado passa a fazer sentido?

Não desenhe nada ainda.

Apenas documente necessidades derivadas da escala.

---

# 26. Diferencie primeiro uso de uso recorrente

## First-use

Usuário pode ter:

```text
0 vencimentos
0 documentos
0 subjects
```

Seu objetivo pode ser:

```text
entender o produto
criar primeiro item
importar planilha
```

## Established account

Pode possuir:

```text
300 itens
50 suppliers
20 pending requests
```

Seu objetivo muda para:

```text
scan
prioritize
act
```

Esses contextos devem ser modelados separadamente.

---

# 27. Analise onboarding

Pergunte:

> Qual é o menor conjunto de ações que leva o usuário ao primeiro valor?

Possibilidades:

```text
criar primeiro vencimento

importar planilha

adicionar fornecedor

fazer upload de documento
```

Determine a hipótese mais plausível.

Não desenhe onboarding ainda.

---

# 28. Identifique "time to first value"

Defina qualitativamente:

```text
user signs up
↓
...
↓
first meaningful value
```

Exemplo:

```text
cadastro
↓
primeiro vencimento
↓
primeiro reminder configurado
↓
produto já é útil
```

ou talvez:

```text
importar planilha
↓
dashboard mostra riscos
```

Avalie.

---

# 29. Identifique tarefas de alta repetição

Procure tarefas que podem ocorrer dezenas de vezes.

Exemplo:

```text
renovar
aprovar submission
atribuir responsável
filtrar por vencimento
```

Para essas tarefas:

> qualquer fricção pequena se multiplica.

Marque:

```text
HIGH REPETITION
```

para uso posterior na interface.

---

# 30. Identifique tarefas de alta consequência

Exemplo:

```text
delete
approve document
confirm expiration
reject submission
change responsibility
```

Marque:

```text
HIGH CONSEQUENCE
```

Essas tarefas precisarão de maior proteção contra erro.

---

# 31. Produza matriz Frequência × Consequência

| Tarefa | Frequência | Consequência | Implicação |
|---|---|---|---|

Exemplo conceitual:

```text
alta frequência + baixa consequência
→ otimizar velocidade

baixa frequência + alta consequência
→ priorizar clareza/segurança

alta frequência + alta consequência
→ design extremamente cuidadoso
```

---

# 32. Identifique tarefas que exigem reconhecimento versus memorização

Exemplo:

Ruim:

```text
usuário precisa lembrar qual fornecedor estava irregular
```

Melhor:

```text
interface mostra isso.
```

Documente informações que a interface deve tornar visíveis para evitar memorização desnecessária.

---

# 33. Identifique necessidades de comparação

Pergunte onde o usuário precisa comparar:

```text
datas

fornecedores

documentos

statuses

responsáveis

requirements
```

Comparação é sinal de que a futura interface pode precisar de:

- tabela;
- alinhamento consistente;
- filtros;
- sorting.

Não escolha componente ainda.

---

# 34. Identifique necessidades de busca

Pergunte:

> O que o usuário provavelmente digitará na busca?

Possibilidades:

```text
nome de documento
empresa
fornecedor
CNPJ
número
responsável
tag
```

Isso ajuda posteriormente a definir search model.

---

# 35. Identifique necessidades de filtragem

Possíveis dimensões:

```text
status
due date
responsible
subject
category
priority
tags
requirement state
```

Não crie vinte filtros por precaução.

Priorize pelo contexto de uso.

---

# 36. Identifique necessidades de bulk operations

Somente se tarefas reais justificarem.

Possíveis:

```text
atribuir vários itens
arquivar
exportar
solicitar vários documentos
aplicar template
```

Classifique como:

```text
NOW
NEXT
LATER
```

---

# 37. Não desenhar dashboard ainda

Você pode identificar **perguntas que um dashboard deveria responder**, mas não seu layout.

Exemplos:

```text
o que está vencido?

o que vence nos próximos dias?

o que aguarda ação minha?

quais documentos ainda não chegaram?

houve falha de notificação?
```

Produza:

# Dashboard Information Questions

Não produza cards.

---

# 38. Não decidir navegação ainda

Pode identificar possíveis **áreas conceituais**, mas não definir menu final.

Por exemplo:

```text
vencimentos
documents
subjects
requests
settings
```

devem ser considerados hipóteses.

A arquitetura da informação será a próxima etapa.

---

# 39. Escopo da primeira interface

Ao final, proponha uma divisão:

## MUST SUPPORT

Tarefas que a primeira interface funcional precisa permitir.

## SHOULD SUPPORT

Importantes, mas não bloqueiam o primeiro release de UI.

## LATER

Podem esperar.

Isso deve ser derivado de:

```text
criticidade
+
frequência
+
roadmap
+
estado técnico
```

---

# 40. Não confundir MVP comercial com baixa qualidade

Mesmo tarefas reduzidas em escopo devem ser desenhadas com alto padrão.

Não recomendar:

> "faça uma tela provisória ruim e depois melhora."

O escopo pode ser pequeno.

A qualidade das tarefas implementadas deve ser alta.

---

# 41. Interface Quality Standard

Utilize como referência o documento:

```text
docs/frontend/interface-quality-standard.md
```

ou equivalente existente.

A análise deve respeitar os 12 eixos:

```text
TaskSuitability
InformationArchitecture
InformationPresentation
SystemFeedback
ErrorRobustness
Forms
DataOperations
Accessibility
Consistency
Content
Responsiveness
Trust
```

Mas nesta etapa NÃO dê nota de interface, pois ainda não existe design suficiente.

Use o padrão para orientar requisitos.

---

# 42. Critérios de evidência

Para cada conclusão importante, indique:

```text
SOURCE:
code
requirement
ADR
roadmap
business inference
UX inference
```

Isso evita misturar:

> algo que o produto realmente faz

com:

> hipótese nossa sobre comportamento do usuário.

---

# 43. Diferencie fato de hipótese

Utilize labels:

```text
FACT
STRONG INFERENCE
HYPOTHESIS
OPEN QUESTION
```

Exemplo:

```text
FACT:
ExpirationItem possui assignee.

STRONG INFERENCE:
Usuário precisa saber rapidamente quem é o responsável.

HYPOTHESIS:
Responsável deve aparecer na tabela principal.
```

Essa disciplina será muito importante antes dos wireframes.

---

# 44. Não invente pesquisa com usuários

Se não existem dados reais de usuários:

não diga:

```text
"usuários preferem..."
```

Diga:

```text
"HYPOTHESIS: usuários provavelmente..."
```

Mais tarde validaremos com testes.

---

# 45. Pesquisar padrões externos quando necessário

Se surgir dúvida sobre:

- workflows de expiration management;
- vendor compliance;
- document tracking;
- administrative SaaS;
- task-heavy applications;

pesquise produtos reais.

Mas o objetivo NÃO é copiar telas.

Pergunte:

```text
que tarefas esses produtos tratam como centrais?

que informação colocam em destaque?

onde existem padrões convergentes?
```

Use concorrentes apenas como evidência complementar.

---

# 46. Concorrentes relevantes para referência

Quando útil, pesquise:

- Expiration Reminder;
- Remindax;
- Doc Warden;
- SubCompliant;
- VendorJot;
- ferramentas de document compliance;
- vendor document tracking;
- certification tracking.

Procure principalmente:

- workflows;
- terminology;
- navigation concepts;
- information hierarchy;
- onboarding;
- tables;
- renewal flows.

Não copie aparência.

---

# 47. Avaliação adversarial

Se Codex estiver disponível, faça uma revisão independente.

Claude deve produzir:

```text
Context and Task Model v1
```

Codex deve receber esse documento e tentar encontrar:

- tarefas esquecidas;
- tarefas superestimadas;
- papéis falsos;
- mistura de backend e modelo mental;
- classificação T0/T1 errada;
- product creep;
- workflows contraditórios;
- tasks que não existem no roadmap.

Claude responde às críticas.

Faça pelo menos uma rodada de reconciliação.

---

# 48. Entregável principal

Criar:

```text
docs/frontend/interface-context-and-critical-tasks.md
```

ou caminho equivalente coerente com o repositório.

O documento deve ser suficientemente completo para servir como entrada para a próxima etapa:

> **Conceptual Model + Information Architecture**

---

# 49. Estrutura obrigatória do documento

## 1. Executive Summary

Principais conclusões.

## 2. Product State Relevant to UI

Estado funcional real.

## 3. UI Planning Horizon

NOW / NEXT / LATER.

## 4. Context of Use

Ambientes e situações.

## 5. User Roles

Papéis funcionais.

## 6. Internal vs External Actors

Separação formal.

## 7. Jobs to Be Done

Por papel.

## 8. Complete Task Inventory

Inventário.

## 9. T0/T1/T2/T3 Classification

Criticidade.

## 10. Frequency Classification

Frequência.

## 11. UI Priority Matrix

Criticidade × frequência.

## 12. Awareness / Investigation / Action / Configuration

Tipo de tarefa.

## 13. Mission-Critical Tasks

Detalhes completos.

## 14. Error and Exception Scenarios

Falhas.

## 15. Decision Inventory

Decisões que o usuário precisa tomar.

## 16. User Conceptual Objects

Conceitos vistos pelo usuário.

## 17. Technical-to-User Concept Mapping

Mapeamento.

## 18. User-Facing / Supporting / Internal Concepts

Classificação.

## 19. Terminology Risks

Ambiguidades.

## 20. Critical Information Inventory

Informação necessária.

## 21. Information Priority

Primary / Secondary / Contextual / Advanced.

## 22. Scale Considerations

5 / 50 / 500 / 5.000 registros.

## 23. First-use Context

Primeiro uso.

## 24. Recurring-use Context

Uso recorrente.

## 25. Time to First Value

Hipótese.

## 26. High-Repetition Tasks

Lista.

## 27. High-Consequence Tasks

Lista.

## 28. Frequency × Consequence Matrix

Matriz.

## 29. Search Needs

Necessidades.

## 30. Filter Needs

Necessidades.

## 31. Comparison Needs

Necessidades.

## 32. Bulk-operation Needs

Necessidades.

## 33. Dashboard Information Questions

Perguntas, não layout.

## 34. Candidate Information Areas

Hipóteses, não menu.

## 35. Initial UI Scope

MUST / SHOULD / LATER.

## 36. Assumptions

Hipóteses explícitas.

## 37. Open Questions

Questões ainda não resolvíveis.

## 38. Rejected Assumptions

Ideias rejeitadas.

## 39. Codex Review

Críticas.

## 40. Reconciliation

Decisões finais.

---

# 50. Tabela principal de tarefas

Produza também uma tabela consolidada:

| ID | Actor | Task | JTBD | Type | Criticality | Frequency | Consequence | UI Priority | Horizon |
|---|---|---|---|---|---|---|---|---|---|

Exemplo:

```text
TASK-001
Responsible user
Identify expired items
Awareness
T0
Daily
High
P0
NOW
```

---

# 51. Matriz de tarefas críticas

Para cada T0/T1, documente:

| Campo | Conteúdo |
|---|---|
| Task ID | |
| Actor | |
| Trigger | |
| Goal | |
| Preconditions | |
| Required information | |
| Happy path | |
| Decisions | |
| Error paths | |
| Feedback required | |
| Success state | |
| Failure consequence | |
| Frequency | |
| Related domain concepts | |

---

# 52. Não implementar interface

Esta tarefa termina com:

```text
context model
+
task model
```

Não começar:

- React;
- CSS;
- components;
- route implementation;
- Figma;
- wireframes;
- design tokens.

A implementação ocorrerá posteriormente.

---

# 53. Não criar arquitetura da informação final

Você pode preparar a matéria-prima para ela.

Mas não decidir ainda definitivamente:

```text
Sidebar:
Dashboard
Items
Documents
Suppliers
Settings
```

Essa será a tarefa seguinte.

---

# 54. Critério de conclusão

Esta etapa está pronta quando pudermos responder claramente:

1. Quem usa o sistema?
2. Quais objetivos cada papel possui?
3. Quais são as tarefas essenciais?
4. Quais tarefas são T0?
5. Quais são frequentes?
6. Quais têm alto impacto quando erradas?
7. Que informações cada tarefa exige?
8. Que decisões o usuário precisa tomar?
9. Quais conceitos do backend realmente pertencem ao modelo mental do usuário?
10. Quais conceitos devem permanecer internos?
11. Quais tarefas a primeira UI precisa obrigatoriamente suportar?
12. O que pode esperar?
13. Que perguntas a futura visão inicial deve responder?
14. Quais hipóteses ainda precisam de usuários reais para validação?

Se alguma dessas perguntas continuar vaga, a análise ainda não está pronta.

---

# 55. Próxima etapa após aprovação

Somente depois da aprovação deste documento iniciar:

> **Conceptual Model + Information Architecture**

Essa próxima fase transformará:

```text
roles
+
jobs
+
tasks
+
information needs
```

em:

```text
user-facing concepts
+
navigation model
+
information architecture
```

Ainda sem preocupação com estética final.

---

# Resultado esperado

Não quero uma lista genérica de personas ou features.

Quero uma análise profunda capaz de responder:

> **Qual trabalho real a interface do Expiration Tracker precisa permitir que cada tipo de usuário execute, com qual frequência, criticidade, informação e contexto?**

O documento produzido deverá ser robusto o suficiente para que a arquitetura da informação e as futuras telas sejam **derivadas dessas evidências**, e não de preferências estéticas ou da estrutura do backend.