# Missão

Atue como **Principal Product Engineer + UX Architect + Software Architect** responsável pela próxima fase do **Expiration Tracker**.

Repositório:

```text
https://github.com/marcelo-jgoncalves/expiration-tracker
```

O projeto chegou a um ponto em que:

- a arquitetura/backend está madura;
- o padrão de qualidade de frontend já foi estabelecido;
- o padrão de engenharia de interface já foi estabelecido;
- o desenho de Full BFF já foi aprovado;
- o Context/Task Model da interface já foi produzido e reconciliado;
- ainda não existem wireframes ou design visual final;
- ainda não devemos implementar telas arbitrariamente.

Sua missão agora é coordenar a transição entre:

```text
fundamentos
↓
modelo conceitual da interface
↓
arquitetura da informação
↓
jornadas
↓
modelo de telas/estados
↓
wireframes
↓
implementação
```

Nesta sessão, entretanto, o **entregável principal é exclusivamente**:

> **Conceptual Model + Information Architecture**

Em paralelo, você deve registrar e organizar o trabalho técnico que precisa acontecer para viabilizar a interface, mas **não misturar implementação de backend/BFF com a modelagem da interface**.

---

# 1. Estado consolidado do projeto

Antes de fazer qualquer trabalho, leia e confirme no repositório o estado atual.

Não confie apenas neste prompt.

Use código, ADRs e documentação real.

## 1.1 Full BFF

A análise inicial do BFF identificou que o desenho anterior de “session BFF” não fechava a autenticação das chamadas de recurso do SPA.

O recurso existente utilizava:

```text
Authorization: Bearer
```

e o browser não deveria receber tokens.

Isso levou à decisão:

```text
D-053 — Full BFF
```

Arquitetura central:

```text
Browser
   ↓
opaque HttpOnly session cookie
   ↓
CloudFront
   ↓
BFF
   ↓
server-side access token
   ↓
Existing API Gateway
   ↓
JWT Authorizer
   ↓
ApiHandler
   ↓
Application / Domain
```

Princípios já aprovados:

```text
browser never receives access token
browser never receives refresh token
browser never receives ID token

BFF owns browser session

resource API remains authenticated with Bearer

JWT authorizer remains unchanged

backend remains source of truth

BFF does not own business rules
```

---

# 2. Amendment do Full BFF

Uma auditoria adversarial posterior identificou problemas adicionais.

Foi criado:

```text
D-054
```

como amendment ao D-053.

Entre as correções aprovadas:

- uso adequado de OIDC `state`/`nonce`/PKCE;
- correção do fluxo de refresh;
- abandono do mecanismo local de refresh que poderia invalidar sessões legítimas;
- uso da rotação nativa de refresh token do Cognito;
- isolamento das sessões BFF em tabela própria;
- least privilege IAM;
- revisão de cookies;
- CSRF;
- logout/revocation;
- proxy allowlists;
- hardening adicional.

O resultado da revisão foi aprovado por Claude e Codex.

Portanto:

> **NÃO reabra Full BFF como decisão arquitetural.**

A próxima preocupação sobre BFF é implementação, não redesenho conceitual.

---

# 3. Context/Task Model já aprovado

O documento:

```text
docs/frontend/interface-context-and-critical-tasks.md
```

é a principal entrada desta tarefa.

Ele já passou por:

- análise profunda do código;
- classificação de atores;
- Jobs to Be Done;
- inventário de tarefas;
- criticidade;
- frequência;
- Decision Inventory;
- mapeamento técnico → conceito de usuário;
- revisão Claude ↔ Codex;
- amendment metodológico.

Seu status esperado é:

```text
APPROVED AS INPUT FOR
CONCEPTUAL MODEL + INFORMATION ARCHITECTURE
```

Leia-o integralmente.

Não refaça essa análise.

---

# 4. Qualidade da interface

Leia também o padrão normativo da interface:

```text
docs/frontend/interface-quality-standard.md
```

ou arquivo equivalente no estado atual.

Os eixos de qualidade incluem:

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

A interface deverá posteriormente atingir o threshold definido no projeto.

Nesta etapa, use esses critérios para **orientar decisões**, mas não dê ainda nota visual para algo que não existe.

---

# 5. Importante: existem blockers reais de backend

Durante o Context/Task Model foram descobertos três problemas reais que precisam permanecer visíveis.

Eles não devem bloquear o planejamento conceitual agora, mas **bloqueiam determinadas experiências antes de release**.

---

# 6. BLOCKER A — leitura/listagem de documentos

Foi confirmado que existem rotas para:

```text
reserve upload
delete document
```

mas não existe API adequada para:

```text
listar documentos de um item
ler metadados de documentos
consultar persistentemente processamento
consultar DocumentSubmission recebido
```

Isso impacta:

```text
item detail
document visibility
upload feedback
renewal
external collection
document history
```

Regra:

> nenhuma arquitetura de informação deve fingir que a interface consegue mostrar informações que a API atual não expõe.

Mas o modelo conceitual pode dizer:

```text
Documento é um conceito necessário ao usuário
```

e registrar:

```text
Implementation Readiness: BLOCKED
```

---

# 7. BLOCKER B — reminder materialization

Foi confirmado que:

```text
ReminderPolicy
```

pode ser persistida, mas o caminho normal de materialização automática de ocorrências não está conectado corretamente.

Portanto:

```text
salvar política
```

não prova:

```text
usuário será avisado
```

Regra:

> a futura UI não poderá prometer reminders funcionando até esse blocker ser corrigido.

No modelo conceitual, entretanto, o outcome:

```text
ser avisado antes de um vencimento
```

continua sendo central.

Não remova o conceito de alerta só porque a implementação atual possui um bug.

---

# 8. BLOCKER C — fechamento da coleta externa

Hoje existe:

```text
DocumentRequest
↓
guest link
↓
DocumentSubmission
↓
security scan
↓
CLEAN
```

mas o ciclo não fecha automaticamente em:

```text
RequirementAssignment SATISFIED
```

e o operador interno não possui visibilidade completa da submissão.

Existe uma futura decisão de produto:

## alternativa A

```text
CLEAN
↓
automatic validation/linking
↓
SATISFIED
```

## alternativa B

```text
CLEAN
↓
awaiting human review
↓
operator confirms
↓
SATISFIED
```

Não decida isso arbitrariamente durante implementação.

A próxima modelagem deve mostrar claramente onde essa decisão impacta a experiência.

---

# 9. Duas trilhas a partir deste ponto

O projeto agora possui duas trilhas.

## Trilha A — Interface Design

```text
Context/Task Model             ✅
↓
Conceptual Model + IA          ← AGORA
↓
Critical User Journeys
↓
Screen/State Inventory
↓
Low-fi Wireframes
↓
Interaction Prototype
↓
Heuristic / Accessibility Review
↓
User Testing
↓
Visual Language / Design System
↓
High-fidelity UI
↓
Frontend Implementation
```

## Trilha B — Engineering Enablement

```text
Full BFF D-053/D-054
↓
implementation

Document read/list
↓
backend correction

Reminder materialization
↓
backend correction

External collection completion
↓
product/domain decision
↓
implementation
```

As trilhas podem avançar em paralelo.

Não espere todos os blockers serem corrigidos para continuar o modelo conceitual.

Mas também não permita que uma interface dependente de blocker seja considerada release-ready.

---

# 10. Objetivo principal desta sessão

Produzir:

```text
docs/frontend/interface-conceptual-model-and-information-architecture.md
```

O documento precisa responder:

> **Como o usuário deve compreender mentalmente o Expiration Tracker e como as informações e capacidades devem ser organizadas para apoiar suas tarefas críticas?**

Não quero ainda wireframes.

---

# 11. Regra principal: frontend não é espelho do backend

Não crie a arquitetura da informação simplesmente a partir de:

```text
ExpirationItem
TrackedSubject
RequirementAssignment
DocumentRequest
DocumentSubmission
ReminderPolicy
NotificationIntent
```

Pergunte:

> O usuário pensa nesses objetos dessa forma?

Por exemplo:

```text
Document
DocumentSubmission
```

podem precisar permanecer distintos no backend, mas talvez devam aparecer para o usuário simplesmente como:

```text
Documento
```

ou:

```text
Documento recebido
```

dependendo do contexto.

---

# 12. Construir o User Conceptual Model

Produza primeiro um inventário dos conceitos percebidos pelo usuário.

Comece a partir do documento de Context/Task Model.

Considere candidatos como:

```text
Vencimento

Documento

Fornecedor
Pessoa
Ativo
Local
ou outro Subject

Requisito

Solicitação de documento

Alerta / Lembrete

Responsável

Histórico

Importação
```

Não aceite essa lista automaticamente.

Derive o modelo.

---

# 13. Para cada conceito

Documente:

```text
Concept ID
User-facing name candidate
Definition
Why user needs it
Related tasks
Related decisions
Technical backing
Relationship to other concepts
Information priority
Readiness
Terminology risks
```

---

# 14. Classificar conceitos

Use:

```text
PRIMARY
SECONDARY
CONTEXTUAL
INTERNAL ONLY
```

## PRIMARY

Objeto que o usuário reconhece e manipula diretamente.

## SECONDARY

Objeto necessário, mas normalmente acessado através de outro.

## CONTEXTUAL

Informação/objeto que aparece apenas em determinado contexto.

## INTERNAL ONLY

Nunca deve aparecer como conceito para o usuário.

---

# 15. Teste de conceito

Para cada entidade técnica, pergunte:

> Se eu removesse este nome técnico da interface, o usuário ainda conseguiria atingir o objetivo normalmente?

Se sim, provavelmente não é um conceito primário.

Exemplo provável:

```text
NotificationIntent
```

deve continuar internal only.

---

# 16. Resolver relação Item × Document

Existe uma questão conceitual importante.

Hoje:

```text
ExpirationItem
```

e:

```text
Document
```

não possuem necessariamente relação 1:1.

O backend permite múltiplos documentos.

Também não existe ainda um conceito explícito totalmente resolvido de:

```text
current document
replacement
document version
```

Não invente uma falsa semântica na interface.

Documente:

- o que sabemos;
- o que o usuário provavelmente precisa compreender;
- que decisão de domínio pode ser necessária.

---

# 17. Resolver relação Subject × Requirement × Document

Estude cuidadosamente:

```text
TrackedSubject
↓
RequirementAssignment
↓
ExpirationItem
↓
Document
```

e também:

```text
RequirementAssignment
↓
DocumentRequest
↓
DocumentSubmission
```

Pergunte:

> Qual desses objetos é âncora mental para o usuário?

Talvez:

```text
Fornecedor
↓
Documentos/Requisitos necessários
```

Ou talvez:

```text
Vencimentos
↓
Fornecedor relacionado
```

Não presuma.

Derive pelas tarefas.

---

# 18. Modelo conceitual visual

Produza diagramas textuais claros.

Exemplo meramente ilustrativo:

```text
Subject
├── Requirement
│   ├── Current compliance state
│   ├── Expiration
│   └── Document Request
│       └── External Submission
│
└── Related Expirations
```

Mas não copie esse modelo se a análise indicar algo diferente.

---

# 19. Modelar outcomes, não mecanismos

O Context/Task Model já foi corrigido para distinguir:

```text
outcome
```

de:

```text
operation
```

Preserve isso.

Exemplo:

```text
OUTCOME
Ser avisado antes do vencimento

OPERATIONS
create reminder policy
edit reminder policy
disable reminder policy
```

Não transforme todas essas operações em áreas de navegação.

---

# 20. Modelo mental de alerta

Pergunte:

> O usuário pensa em “política de reminder”?

Provavelmente não.

Talvez pense em:

```text
Alertas
Avisos
Quando quero ser avisado
```

Determine o melhor conceito.

---

# 21. Modelar decisões

Use diretamente o Decision Inventory já produzido.

A arquitetura precisa permitir responder rapidamente:

```text
O que precisa da minha atenção?

Isso já venceu?

Quando vence?

Preciso agir?

Quem é responsável?

Esse fornecedor está regular?

Esse documento já chegou?

Essa solicitação está pendente?

Esse documento pertence ao ciclo atual?

```

Para cada decisão, documente:

```text
Decision
Required information
Where information should conceptually live
Related concepts
Criticality
```

---

# 22. Information Hierarchy

Derive uma hierarquia da informação.

Exemplo:

```text
PRIMARY
nome
status
due date

SECONDARY
subject
responsible

CONTEXTUAL
last renewal
document
request state
```

Não aplique isso universalmente.

Defina por contexto.

---

# 23. Information Areas

Somente depois do conceptual model, derive grandes áreas conceituais do produto.

Possíveis exemplos, ainda hipotéticos:

```text
Visão geral
Vencimentos
Fornecedores
Solicitações
Importações
Configurações
```

Não aceite automaticamente.

Para cada área candidata, responda:

```text
Which user questions does this area answer?
Which critical tasks live here?
Which concepts belong here?
Why does it deserve top-level status?
Could it instead be contextual?
```

---

# 24. Critério para top-level navigation

Um conceito só deve virar área de primeiro nível se houver razão forte.

Possíveis razões:

- tarefa frequente;
- múltiplas tarefas associadas;
- necessidade recorrente de acesso direto;
- grande volume de informação;
- modelo mental forte;
- necessidade independente de exploração.

Não criar top-level menu simplesmente porque existe módulo no backend.

---

# 25. Evitar navegação excessiva

Se:

```text
Solicitações
```

só fizer sentido dentro de:

```text
Fornecedor → Requisito
```

talvez não deva ser top-level.

Por outro lado, se o usuário precisa responder diariamente:

> quais solicitações estão pendentes em todos os fornecedores?

então pode merecer uma visão global.

Essa análise deve ser explícita.

---

# 26. Global views versus contextual views

Para cada conceito, determine se precisa de:

```text
GLOBAL VIEW
```

ou apenas:

```text
CONTEXTUAL VIEW
```

Exemplos a investigar:

```text
todos os vencimentos → provavelmente global

documento de um item → possivelmente contextual

requisitos de fornecedor → contextual

solicitações pendentes de todos → talvez global

configuração de reminders → contextual por item?
```

Não presuma.

---

# 27. Entry Points por tarefa crítica

Para cada T0/P0 outcome, defina:

```text
Expected entry point
```

Exemplos:

### Outcome

```text
Saber o que precisa da minha atenção
```

entrada provável:

```text
application home / overview
```

### Outcome

```text
Renovar um vencimento
```

entrada possível:

```text
direct reminder link
item detail
attention queue
```

Mapeie múltiplos entry points quando fizer sentido.

---

# 28. Não confundir home com dashboard decorativo

A home deve responder perguntas operacionais.

Não criar métricas apenas porque são fáceis de mostrar.

Uma métrica só deve aparecer se responder uma pergunta real.

Exemplo potencialmente útil:

```text
7 vencendo nos próximos 30 dias
```

Exemplo possivelmente inútil:

```text
347 documentos cadastrados
```

a menos que haja um objetivo real ligado a essa informação.

---

# 29. Dashboard Information Questions

Use as perguntas já levantadas:

```text
o que está vencido?

o que vence em breve?

o que requer minha ação?

quais solicitações estão pendentes?

houve erro recente?

há processamento travado?
```

Revise e refine.

O entregável desta etapa é:

```text
questions
+
information model
```

e não cards.

---

# 30. Search Information Architecture

Defina o papel conceitual da busca.

Pergunte:

```text
o que o usuário procura?

nome do vencimento?

fornecedor?

documento?

CNPJ?

responsável?

tag?
```

Determine se devemos ter:

```text
global search
```

ou buscas locais por área.

Não implemente.

---

# 31. Filter Information Architecture

Derive filtros a partir das decisões/tarefas.

Possíveis:

```text
status
due date
subject
responsible
requirement state
```

Não criar filtros especulativos.

Classifique:

```text
ESSENTIAL
LIKELY
FUTURE
```

---

# 32. Organização temporal

Como vencimento é essencial, avalie como o tempo entra na IA.

Possíveis conceitos:

```text
Vencidos

Hoje

Próximos 7 dias

Próximos 30 dias

Depois
```

Não decida visualização.

Determine apenas se agrupamento temporal faz parte do modelo mental.

---

# 33. Status model

Liste todos os status que o usuário realmente precisa compreender.

Não exponha enums técnicos automaticamente.

Exemplo:

```text
ACTIVE
RENEWED
ARCHIVED
DELETED
```

pode precisar virar:

```text
Ativo
Renovado
Arquivado
```

E talvez:

```text
DELETED
```

nem seja um estado navegável.

Faça o mesmo para:

```text
RequirementAssignment
DocumentRequest
DocumentSubmission
Import
```

---

# 34. Status semantic normalization

É possível que diferentes entidades possuam status técnicos distintos, mas semanticamente semelhantes.

Exemplo:

```text
waiting
processing
completed
failed
expired
```

Avalie se a UI deveria possuir uma linguagem consistente.

Não esconda diferenças importantes.

---

# 35. First-use Information Architecture

Modele separadamente o primeiro uso.

Contexto:

```text
0 items
0 subjects
0 documents
```

Pergunta:

> Como o usuário entende o produto e chega ao primeiro valor?

Possíveis caminhos:

```text
Criar primeiro vencimento

OU

Importar CSV
```

Não desenhe onboarding ainda.

Defina apenas:

- conceitos que precisam aparecer;
- decisões iniciais;
- caminhos principais.

---

# 36. Established-user IA

Para usuário recorrente:

```text
muitos registros
várias pendências
ações recorrentes
```

o modelo muda para:

```text
scan
prioritize
investigate
act
```

Documente como a arquitetura deve favorecer esse padrão.

---

# 37. Guest Information Architecture

O External Submitter possui experiência separada.

Ele não precisa entender:

```text
Vencimentos
Subjects
Requirements
Dashboard
```

Provavelmente precisa apenas:

```text
quem está pedindo

o que está sendo pedido

prazo

como enviar

resultado
```

Defina a IA desse fluxo separadamente.

---

# 38. Guest boundary

A guest experience deve continuar:

```text
unauthenticated
magic-link scoped
task-focused
```

Não transformar o convidado em usuário do SaaS.

---

# 39. Future Organization/Membership impact

Hoje o sistema é single-owner.

M13 futuramente introduzirá:

```text
Organization
Membership
RBAC
```

A IA atual não deve superdimensionar isso.

Mas precisa evitar decisões que tornem impossível evoluir depois.

Por exemplo:

não codificar conceitualmente:

```text
Minha conta = meu tenant = meu usuário
```

se isso inevitavelmente mudará.

Documente:

```text
future compatibility constraints
```

sem projetar interface futura completa.

---

# 40. Internal Operator versus RBAC role

O Context/Task Model já deve distinguir:

```text
functional role:
Internal Operator
```

de:

```text
technical role:
OWNER
MEMBER
VIEWER
```

Preserve essa separação.

A IA deve ser baseada no papel funcional.

---

# 41. External Submitter

Da mesma forma:

```text
External Submitter
```

é o papel conceitual.

Fornecedor é um cenário atual importante, mas não precisa limitar o modelo se:

```text
employee
accountant
broker
client
contractor
```

podem futuramente desempenhar a mesma tarefa.

---

# 42. Navigation candidate model

Somente após todas as análises anteriores, proponha 2 ou 3 modelos candidatos.

Exemplo de formato:

## Candidate A

```text
Overview
Expirations
Subjects
Requests
Imports
Settings
```

## Candidate B

```text
Overview
Expirations
Subjects
Settings

Requests exist contextually
```

## Candidate C

outro modelo fundamentado.

Não escolha baseado em preferência estética.

---

# 43. Avaliar candidatos

Avalie cada modelo segundo:

```text
Task Suitability
Findability
Cognitive Load
Frequency alignment
Conceptual coherence
Scalability
Future compatibility
Guest separation
Risk of duplicated navigation
```

Use nota ou avaliação estruturada.

---

# 44. Escolher IA recomendada

Ao final:

```text
RECOMMENDED INFORMATION ARCHITECTURE
```

com justificativa.

Explique:

- top-level areas;
- contextual areas;
- relationships;
- cross-links;
- entry points;
- concepts deliberately hidden.

---

# 45. Não desenhar sidebar

Pode haver uma estrutura conceitual como:

```text
Overview
Expirations
Subjects
...
```

mas não decidir:

- esquerda/direita;
- iconografia;
- collapsed sidebar;
- top nav;
- hamburger;
- width.

Isso pertence ao screen/wireframe design.

---

# 46. Global versus contextual actions

Liste ações como:

```text
create expiration
renew
upload document
request document
archive
delete
import
```

Determine:

```text
global action
contextual action
bulk action
```

Exemplo:

```text
Renew
```

provavelmente exige contexto de item.

Não deveria ser uma ação global.

---

# 47. High-consequence operations

Para:

```text
delete
archive
revoke request
renew with new date
```

marque explicitamente:

```text
HIGH CONSEQUENCE
```

Isso influenciará mais tarde o design de interação.

---

# 48. Backend blockers dentro da IA

Para cada área/conceito dependente de blocker, marque:

```text
Readiness:
BLOCKED
```

Por exemplo:

```text
Document history
Readiness: BLOCKED — missing GET/list API
```

Não remova o conceito.

---

# 49. Readiness não altera IA

Regra:

> a arquitetura da informação descreve o produto correto, não apenas as APIs incompletas existentes hoje.

Mas também:

> uma funcionalidade bloqueada não pode ser considerada pronta para implementação de UI.

Preserve as duas verdades.

---

# 50. Engineering Enablement Plan

Como segundo entregável da sessão, produza uma seção curta:

```text
Engineering Enablement Dependencies
```

com:

| Dependency | Why needed | Blocks which UI outcome | Priority |
|---|---|---|---|

Inclua pelo menos:

```text
D-053/D-054 Full BFF implementation

Document read/list API

Reminder materialization correction

External collection completion decision
```

---

# 51. Prioridade técnica recomendada

Avalie, sem implementar ainda, a sequência:

```text
1. Full BFF implementation

2. Document read/list

3. Reminder materialization

4. External collection completion
```

Mas tente refutá-la.

Determine se dependências reais exigem ordem diferente.

---

# 52. External collection decision

Não imponha ainda:

```text
automatic satisfaction
```

ou:

```text
human review
```

Mas use a Conceptual Model para demonstrar:

- diferença de UX;
- impacto sobre tarefas;
- riscos;
- informação necessária;
- complexidade.

Produza uma pequena decision brief para isso.

---

# 53. Critérios de evidência

Continue utilizando:

```text
FACT
STRONG INFERENCE
HYPOTHESIS
OPEN QUESTION
```

Para conclusões importantes, indique origem:

```text
SOURCE:
code
schema
ADR
roadmap
context-task-model
UX inference
business inference
```

---

# 54. Pesquisa externa

Pesquise padrões reais quando isso ajudar a decidir questões de Information Architecture.

Procure especialmente:

```text
expiration tracking SaaS
document compliance SaaS
vendor compliance
certificate tracking
document collection
administrative SaaS information architecture
```

Concorrentes podem ser usados para identificar:

- conceitos recorrentes;
- terminologia;
- estrutura informacional;
- organização de workflows.

NÃO copiar layout ou identidade visual.

Fontes externas são evidência complementar.

O repositório e o Context/Task Model continuam sendo fonte primária do produto.

---

# 55. Evitar product creep

Não inventar nesta etapa:

```text
calendar view
kanban
AI assistant
chat
bulk editor
complex analytics
CRM
workflow builder
custom dashboards
```

a menos que exista evidência real.

A IA deve ser suficiente para o produto atual e sua evolução já aprovada.

---

# 56. Não escolher UI framework

Não decidir ainda:

```text
Material UI
shadcn
Radix
Tailwind
Chakra
Ant
Carbon
```

Isso virá depois.

---

# 57. Não escolher visual design

Não produzir:

```text
paleta
fontes
radius
shadow
logo
visual identity
```

---

# 58. Não criar wireframes

Nenhuma imagem/tela deve ser necessária neste entregável.

Diagramas de relação conceitual são permitidos.

---

# 59. Não implementar código

Não modificar:

```text
src/
infra/
schemas/
```

exceto se a tarefa for explicitamente autorizada depois.

Esta fase continua sendo design/documentação.

---

# 60. Revisão adversarial Claude ↔ Codex

Depois de produzir:

```text
Conceptual Model + IA v1
```

faça revisão adversarial independente.

## Rodada A

Claude produz proposta completa.

## Rodada B

Codex tenta quebrá-la.

Pedir para procurar especificamente:

- arquitetura derivada do backend;
- conceitos técnicos expostos ao usuário;
- áreas top-level desnecessárias;
- tarefa crítica escondida;
- duplicação de navegação;
- confusão Subject × Requirement × Document;
- confusão Expiration × Document;
- IA acoplada a bugs atuais;
- blockers ignorados;
- future-proofing excessivo;
- product creep;
- papéis de RBAC tratados como personas;
- dashboard decorativo;
- navegação baseada em feature e não task.

## Rodada C

Claude responde às divergências.

## Rodada D

Codex valida reconciliação.

---

# 61. Quality review

Use o:

```text
Interface Engineering Quality Standard
```

para avaliar os aspectos aplicáveis.

Especialmente:

```text
TaskSuitability
InformationArchitecture
InformationPresentation
Consistency
Content
Trust
```

Critérios não aplicáveis:

```text
N/A
```

Não penalizar ausência de wireframe.

---

# 62. Gate específico desta etapa

A Information Architecture deve ser reprovada se:

```text
tarefa T0/P0 não tiver entry point claro

conceito técnico desnecessário for exposto

mesmo conceito aparecer com significados diferentes

navegação exigir conhecer arquitetura do backend

blocker técnico for mascarado como feature pronta

modelo não diferenciar internal operator de guest

status crítico for conceitualmente ambíguo
```

---

# 63. Entregável principal

Criar:

```text
docs/frontend/interface-conceptual-model-and-information-architecture.md
```

---

# 64. Estrutura obrigatória

## 1. Executive Summary

## 2. Inputs and Scope

## 3. Constraints Inherited from Context/Task Model

## 4. User Conceptual Model

## 5. Concept Inventory

## 6. Primary / Secondary / Contextual / Internal Concepts

## 7. Technical-to-User Concept Mapping

## 8. Concept Relationships

## 9. Expiration ↔ Document Model

## 10. Subject ↔ Requirement ↔ Document Model

## 11. Document Request / Submission Model

## 12. Alert/Reminder Conceptual Model

## 13. Status Vocabulary

## 14. Terminology Decisions

## 15. Terminology Open Questions

## 16. User Decision → Information Mapping

## 17. Information Hierarchy

## 18. Candidate Information Areas

## 19. Global vs Contextual Views

## 20. Entry Points for T0/P0 Outcomes

## 21. Global vs Contextual Actions

## 22. Search Architecture

## 23. Filter Architecture

## 24. Temporal Information Architecture

## 25. First-use IA

## 26. Recurring-use IA

## 27. Guest IA

## 28. Future Organization/Membership Compatibility

## 29. Candidate Navigation Model A

## 30. Candidate Navigation Model B

## 31. Candidate Navigation Model C, if justified

## 32. Candidate Comparison

## 33. Recommended Information Architecture

## 34. Dashboard Information Questions

## 35. Backend Readiness Mapping

## 36. Engineering Enablement Dependencies

## 37. External Collection Decision Brief

## 38. Assumptions

## 39. Open Questions

## 40. Rejected Alternatives

## 41. Codex Review

## 42. Reconciliation

## 43. Quality Evaluation

## 44. Final Status

---

# 65. Segundo entregável

Produza dentro do mesmo documento ou em arquivo complementar:

```text
Engineering Enablement Matrix
```

Formato:

| Technical dependency | Status | UI outcomes blocked | Required before | Recommended priority |
|---|---|---|---|---|

---

# 66. Status esperado

Se aprovado:

```text
APPROVED AS INPUT FOR
CRITICAL USER JOURNEYS
```

Se ainda houver problemas conceituais:

```text
NOT APPROVED
```

com motivos objetivos.

---

# 67. Próxima etapa após aprovação

Não começar wireframes imediatamente.

A próxima fase será:

> **Critical User Journeys**

Ela deverá transformar os outcomes mais importantes em sequências como:

```text
trigger
↓
entry point
↓
information
↓
decision
↓
action
↓
feedback
↓
success/failure
```

Exemplos candidatos:

```text
revisão diária de vencimentos

renovação de vencimento

upload de documento

solicitação de documento externo

guest submission

import CSV
```

Somente depois:

```text
Screen + State Inventory
```

---

# 68. Sequência completa a preservar

```text
Interface Quality Standard                 ✅

Context of Use                             ✅
User Roles                                 ✅
JTBD                                       ✅
Task Inventory                             ✅
Criticality / Readiness                    ✅

Conceptual Model                           ← ESTA TAREFA
Information Architecture                   ← ESTA TAREFA

Critical User Journeys                     ← PRÓXIMA

Screen + State Inventory

Low-fi Wireframes

Interaction Prototype

Heuristic Review

Accessibility Review

User Validation

Visual Language / Design System

High-fidelity UI

Frontend Implementation
```

---

# 69. Engenharia em paralelo

Enquanto a trilha de interface avança, o projeto pode posteriormente implementar:

```text
D-053 + D-054 Full BFF

document read/list capability

reminder materialization fix
```

A quarta questão:

```text
external collection completion
```

deve esperar a decisão de produto que esta análise ajudará a esclarecer.

---

# 70. Critério final desta missão

Ao terminar, devemos conseguir responder sem ambiguidade:

1. Quais conceitos existem para o usuário?
2. Quais conceitos são apenas técnicos?
3. Como Vencimento, Documento, Subject e Requirement se relacionam mentalmente?
4. Como uma solicitação externa se encaixa nesse modelo?
5. Qual vocabulário deve aparecer para o usuário?
6. Quais grandes áreas de informação realmente existem?
7. Quais merecem navegação global?
8. Quais devem ser apenas contextuais?
9. Como cada tarefa T0/P0 é encontrada?
10. Quais informações permitem cada decisão crítica?
11. O que a home precisa responder?
12. Qual deve ser a arquitetura de busca/filtros?
13. Como o guest experience permanece isolado e simples?
14. Como evitar acoplamento ao single-owner atual?
15. Quais partes da IA estão tecnicamente bloqueadas?
16. Qual modelo de navegação é recomendado e por quê?
17. Que decisões ainda precisam ser validadas antes das journeys?

Se essas perguntas não puderem ser respondidas claramente:

> a fase ainda não está concluída.

---

# Resultado esperado

Não quero telas.

Não quero código.

Não quero design visual.

Quero uma resposta arquitetural para a interface:

> **qual é o modelo mental correto do Expiration Tracker e como devemos estruturar sua informação para que as tarefas críticas sejam encontráveis, compreensíveis e executáveis sem expor a complexidade interna do sistema?**

O documento final deverá ser robusto o suficiente para que a próxima etapa — **Critical User Journeys** — possa ser derivada diretamente dele, sem precisar reinventar o produto.