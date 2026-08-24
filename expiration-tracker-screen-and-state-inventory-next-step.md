# Expiration Tracker — Próxima Etapa: Screen + State Inventory

## Status anterior

**Critical User Journeys**

```text
APPROVED AS INPUT FOR SCREEN + STATE INVENTORY
```

O protocolo Claude↔Codex foi concluído em quatro rodadas (A→D), com oito journeys mapeadas (`J-01` a `J-08`).

Todas partem de outcomes previamente aprovados, com uma exceção metodológica já registrada:

```text
J-02 — Criar vencimento
```

Essa journey nunca teve classificação formal própria no Context/Task Model e foi mantida com essa lacuna explicitamente documentada.

---

# 1. Achados relevantes vindos das Critical User Journeys

A revisão adversarial encontrou quatro furos reais.

## 1.1 POST /items não possui proteção de idempotência

Foi confirmado que:

```text
POST /items
```

não possui proteção equivalente à existente em fluxos como renovação e importação.

Consequência:

```text
usuário envia criação
↓
request sofre timeout
↓
frontend não sabe se o backend processou ou não
↓
retry automático
↓
possível criação duplicada
```

Portanto:

> **a interface não pode realizar retry automático de criação após timeout enquanto o backend não oferecer idempotência ou mecanismo confiável de reconciliação.**

Esse ponto deve sobreviver à próxima fase como constraint técnico.

Sugestão de identificador:

```text
CREATE-IDEMPOTENCY-01
```

---

## 1.2 Guest não consegue observar o resultado da verificação de segurança

O fornecedor externo consegue enviar o arquivo, mas não possui rota para descobrir posteriormente se:

```text
arquivo enviado
↓
scan executado
↓
arquivo verificado
```

O guest consegue saber que enviou o arquivo.

Mas atualmente não consegue saber que o arquivo passou pela verificação de segurança.

Portanto existe diferença entre:

```text
Guest-known state:
Arquivo enviado
```

e:

```text
Backend-known state:
Arquivo verificado
```

Essa distinção precisa permanecer explícita.

---

## 1.3 Anti-enumeration precisa ser preservado

A implementação atual deliberadamente evita revelar externamente diferenças entre:

```text
token inválido
token inexistente
token expirado
token revogado
request inexistente
```

A revisão detectou que mensagens de erro diferentes na futura UI violariam essa decisão de segurança.

Logo, internamente podem existir diferentes estados técnicos, mas externamente eles devem possivelmente convergir para algo como:

```text
GuestRequestUnavailable
```

com mensagem genérica.

A futura interface não deve introduzir distinções que revertam o hardening existente.

---

## 1.4 Guest submission não pode comprimir estados epistemicamente distintos

A jornada original comprimia:

```text
arquivo enviado
```

com:

```text
arquivo verificado
```

Isso foi corrigido.

Regra permanente:

> **o estado que o usuário conhece e o estado que somente o backend conhece devem permanecer separados quando essa diferença for material.**

---

# 2. Próxima etapa formal

A próxima etapa do planejamento da interface é:

# **Screen + State Inventory**

A pergunta deixa de ser:

> Como o usuário atravessa o sistema?

e passa a ser:

> **Quais superfícies de interação precisam existir para suportar essas jornadas e quais estados cada uma dessas superfícies pode assumir?**

---

# 3. Ainda não é Wireframe

Nesta fase não devemos decidir:

```text
sidebar
modal
drawer
cards
posição de botões
cores
tipografia
layout
```

Também não devemos decidir:

```text
isso será uma página
isso será um modal
isso será um drawer
isso será um wizard
```

Essas decisões pertencem às etapas posteriores.

O objetivo agora é descobrir a:

> **superfície funcional mínima e completa necessária para suportar as journeys aprovadas.**

---

# 4. Conceito de Interaction Surface

O termo `Screen` não deve ser entendido literalmente como:

```text
uma URL = uma tela
```

O conceito mais útil nesta fase é:

# **Interaction Surface**

Uma Interaction Surface é uma superfície em que o usuário:

- recebe informação suficiente;
- entende um estado;
- toma uma decisão;
- executa uma ação;
- recebe feedback.

Ela poderá futuramente ser implementada como:

- página;
- painel;
- diálogo;
- drawer;
- seção inline;
- outra representação.

Essa decisão vem depois.

---

# 5. Possíveis Interaction Surfaces

Exemplos conceituais a investigar:

```text
SURF-001
Overview

SURF-002
Expiration Collection

SURF-003
Expiration Detail

SURF-004
Expiration Creation

SURF-005
Expiration Renewal

SURF-006
Subject Collection

SURF-007
Subject Detail

SURF-008
External Request Context

SURF-009
Guest Submission

SURF-010
Import Flow
```

Esses nomes são apenas exemplos.

A IA engenheira deve derivar o inventário real a partir das oito journeys aprovadas.

---

# 6. O ponto central: State Inventory

Cada superfície precisa ter seus estados explicitamente modelados.

Por exemplo:

```text
Expiration Collection
```

não possui apenas:

```text
loaded
```

Ela pode estar em estados como:

```text
initial loading

loaded with records

loaded with no records

loaded with no results for current filters

refreshing

partial/stale data

load failed

session expired

permission denied
```

Esses estados representam experiências diferentes e não devem ser tratados como variações irrelevantes.

---

# 7. Estados assíncronos precisam ser formalizados

O Expiration Tracker possui vários workflows assíncronos.

Eles precisam ser modelados explicitamente.

## 7.1 Documento

Possíveis estados conceituais:

```text
not uploaded

upload reservation created

uploading

upload received

security verification pending

file verified

file blocked

verification timeout

unknown outcome
```

Regra:

```text
upload received
≠
security verification completed
```

e:

```text
file verified
≠
document validated for business/compliance
```

## 7.2 Importação

Possíveis estados:

```text
selecting

uploading

parsing

preview ready

committing

committed

failed

expired
```

A futura UI deverá permitir distinguir claramente:

```text
arquivo recebido
processamento em andamento
resultado disponível
aplicação dos dados
conclusão
falha
```

## 7.3 Solicitação externa

Possíveis estados:

```text
request being created

sent

opened

submitted

document received

security verification pending

file verified

BLOCKER-C boundary
```

O ciclo atual para em um ponto conhecido.

Essa interrupção precisa permanecer explícita.

---

# 8. Regra de não compressão semântica

Estados não devem ser comprimidos apenas para simplificar a interface quando representam conhecimentos ou consequências diferentes.

Exemplos:

```text
uploaded
≠
verified

verified
≠
approved

submitted
≠
requirement satisfied

policy saved
≠
reminder scheduled

reminder scheduled
≠
notification delivered
```

Essa regra continua derivando do princípio já aprovado de:

# **Epistemic Integrity**

> **A interface nunca deve prometer mais certeza do que o domínio sustenta.**

---

# 9. Novo constraint: criação sem idempotência

Para criação de vencimento:

```text
POST /items
```

existe um caso especialmente importante:

```text
user submits
↓
request timeout
↓
outcome unknown
```

A interface não sabe necessariamente se:

```text
item was not created
```

ou:

```text
item was created
```

Logo deve existir conceitualmente um estado equivalente a:

```text
OUTCOME_UNKNOWN
```

ou outra representação adequada.

Regra:

> **não fazer retry automático de criação enquanto CREATE-IDEMPOTENCY-01 permanecer aberto.**

---

# 10. Unknown Outcome como classe de estado

Esta etapa deve reconhecer explicitamente que:

```text
FAILED
```

e:

```text
UNKNOWN_OUTCOME
```

não são a mesma coisa.

## FAILED

O sistema sabe que a operação falhou.

## UNKNOWN_OUTCOME

O cliente perdeu a capacidade de saber se a operação foi ou não aplicada.

Exemplos:

```text
network timeout after submit
connection dropped after request reached server
```

Essa distinção é importante para:

- criação;
- renovação;
- importação;
- outras operações mutáveis.

---

# 11. Guest: separar estado conhecido do estado do backend

No guest flow:

```text
upload enviado
```

pode ser conhecido pelo usuário.

Mas:

```text
security scan CLEAN
```

não é atualmente consultável por ele.

Portanto a futura State Inventory deve distinguir:

```text
User-visible state
```

de:

```text
System-only state
```

---

# 12. Anti-enumeration como state-mapping rule

Internamente, podem existir estados como:

```text
INVALID
EXPIRED
REVOKED
NOT_FOUND
```

Mas externamente, por decisão de segurança, eles podem todos mapear para:

```text
GuestRequestUnavailable
```

A próxima etapa deve formalizar esse mapeamento.

Isso permitirá que posteriormente o wireframe respeite a política de segurança sem precisar reinterpretá-la.

---

# 13. Entregável recomendado

Criar:

```text
docs/frontend/interface-screen-and-state-inventory.md
```

---

# 14. Estrutura recomendada do documento

```text
1. Scope and Method

2. Source Journeys

3. Interaction Surface Definition

4. Surface Inventory

5. Surface ↔ Journey Mapping

6. Surface ↔ Concept Mapping

7. Global Surfaces

8. Contextual Surfaces

9. Guest Surfaces

10. Utility Surfaces

11. State Taxonomy

12. Shared Loading States

13. Shared Empty States

14. Shared Error States

15. Authentication / Session States

16. Permission States

17. Async Processing States

18. Unknown-Outcome States

19. Concurrency / OCC States

20. Document States

21. Reminder States

22. External Collection States

23. Guest States

24. Import States

25. Creation States

26. Renewal States

27. Surface Transition Matrix

28. Journey → Surface Matrix

29. Journey → State Matrix

30. Re-entry Requirements

31. Persistent vs Ephemeral State

32. Epistemic Integrity Mapping

33. Trust-State Requirements

34. Accessibility-State Requirements

35. Backend Dependency Mapping

36. Engineering Blockers

37. Open Questions

38. Rejected Surface Assumptions

39. Codex Review

40. Reconciliation

41. Quality Evaluation

42. Final Status
```

---

# 15. Duas dimensões adicionais para cada estado

Cada estado deveria ser classificado em duas dimensões independentes.

# 16. Persistence

Classificar como:

```text
EPHEMERAL
PERSISTED
DERIVED
REMOTE_ASYNC
```

## EPHEMERAL

Existe apenas durante a interação atual.

Exemplo:

```text
uploading
```

## PERSISTED

É armazenado pelo sistema.

Exemplo:

```text
Document.status = CLEAN
```

## DERIVED

Não é necessariamente persistido como verdade própria; é calculado a partir de outros dados.

Exemplo:

```text
vence em 7 dias
```

## REMOTE_ASYNC

Depende de processo assíncrono executado fora do ciclo imediato da interação.

Exemplo:

```text
SCANNING
```

---

# 17. Visibility

Classificar como:

```text
USER_KNOWN
SYSTEM_ONLY
USER_INFERRED
NOT_CURRENTLY_OBSERVABLE
```

## USER_KNOWN

O usuário consegue observar diretamente o estado.

## SYSTEM_ONLY

O sistema conhece o estado, mas o usuário não possui exposição direta.

## USER_INFERRED

A interface pode inferir o estado a partir de informação disponível, mas ele não existe como verdade explícita.

## NOT_CURRENTLY_OBSERVABLE

O domínio pode possuir o estado, mas a interface atual não possui contrato/API para observá-lo.

---

# 18. Exemplo de matriz

| Estado | Persistência | Visibilidade |
|---|---|---|
| Uploading | EPHEMERAL | USER_KNOWN |
| Upload concluído | PERSISTED | USER_KNOWN |
| SCANNING | REMOTE_ASYNC | depende da superfície/API |
| CLEAN | PERSISTED | SYSTEM_ONLY para guest hoje |
| Requirement SATISFIED | PERSISTED | USER_KNOWN quando exposto |
| Item vence em 7 dias | DERIVED | USER_INFERRED |

Essa matriz é especialmente valiosa para preservar a epistemic integrity.

---

# 19. Loading States

Não tratar todos os loading states como um único estado genérico.

Investigar pelo menos:

```text
initial loading
background refresh
loading after explicit action
polling/async refresh
pagination/loading more
```

Cada um pode exigir tratamento diferente na futura interface.

---

# 20. Empty States

Distinguir:

```text
no data exists

no results for filter/search

data unavailable

permission prevents visibility

processing has not produced result yet
```

Exemplo:

```text
0 vencimentos
```

não é equivalente a:

```text
erro ao carregar vencimentos
```

nem a:

```text
nenhum resultado com os filtros atuais
```

---

# 21. Error States

A próxima etapa deve reutilizar a taxonomia de falhas derivada das journeys.

Exemplos:

```text
Validation

Conflict

Permission

Authentication

Network

Processing

Security rejection

External dependency

Domain state changed

Unknown outcome
```

---

# 22. Authentication / Session States

Como o Full BFF ainda não está implementado, a State Inventory deve modelar as necessidades conceituais sem redesenhar autenticação.

Estados relevantes:

```text
authenticated

session missing

session expired

refresh in progress

refresh failed

reauthentication required
```

Pergunta importante:

> Após reautenticar, qual contexto precisa ser recuperado?

---

# 23. Permission States

O sistema deve diferenciar conceitualmente:

```text
resource does not exist
```

de:

```text
resource exists but user cannot access it
```

quando a política de segurança permitir essa distinção.

Onde anti-enumeration for necessário, o estado externo pode ser propositalmente indistinguível.

---

# 24. OCC / Concurrency States

Onde o backend usa optimistic concurrency control, a UI deve possuir um estado específico para:

```text
resource changed since it was loaded
```

Isso é diferente de:

```text
generic error
```

Casos relevantes:

```text
edit
renew
archive
delete
```

A próxima etapa deve modelar:

```text
CONFLICT
```

e o caminho de recuperação.

---

# 25. Renewal States

Renovação precisa manter distinção entre:

```text
editing current record
```

e:

```text
creating a new renewal cycle
```

Possíveis estados:

```text
renewal initiated

new due date being prepared

validation failed

submitting

unknown outcome

renewal succeeded

OCC conflict

renewal not allowed because source state changed
```

---

# 26. Creation States

Para criação:

```text
initial

editing

validation errors

submitting

created

failed

unknown outcome
```

O estado:

```text
unknown outcome
```

é especialmente importante por causa de `CREATE-IDEMPOTENCY-01`.

---

# 27. Reminder States

Preservar distinções:

```text
no alert configured

policy configured

materialization pending

occurrence scheduled

notification dispatch pending

notification delivered

notification failed
```

Mas não expor estados que o backend atual não consegue sustentar.

`BLOCKER-B` continua válido.

---

# 28. External Collection States

Modelar pelo menos:

```text
requirement pending

request creating

request sent

request opened

submission started

file uploaded

security verification pending

file verified

file blocked

BLOCKER-C boundary
```

Depois do boundary, existem duas alternativas ainda não decididas:

```text
automatic completion
```

ou:

```text
human review
```

Não escolher nesta fase.

---

# 29. Guest States

Guest flow precisa preservar:

```text
request available

request unavailable

ready to upload

uploading

file received

upload failed

completion uncertain
```

Não criar:

```text
file verified
```

como estado visível ao guest enquanto não houver API/contrato que permita essa observação.

---

# 30. Import States

Modelar:

```text
file selection

uploading

uploaded

parsing

preview ready

validation issues

committing

committed

failed

expired

unknown outcome
```

Considerar que erros detalhados por linha possuem limitações atuais conhecidas.

---

# 31. Surface Transition Matrix

Produzir uma matriz:

| From Surface | State/Event | To Surface | Context that must survive |
|---|---|---|---|

Exemplo conceitual:

```text
Overview
→ selected expiration
→ Expiration Detail
→ expirationId + originating attention context
```

Não decidir URL.

---

# 32. Journey → Surface Mapping

Para cada journey:

| Journey | Required Surfaces |
|---|---|

O objetivo é identificar superfícies compartilhadas.

Exemplo:

```text
Expiration Detail
```

pode servir:

```text
J-01
J-03
J-04
J-05
```

Isso será extremamente útil para reduzir duplicação na próxima fase.

---

# 33. Journey → State Mapping

Produzir:

| Journey | Critical States |
|---|---|

O objetivo é garantir que nenhum estado importante descoberto nas journeys seja perdido ao criar superfícies.

---

# 34. Re-entry Requirements

Para cada processo assíncrono ou longo, perguntar:

> Se o usuário fechar a aplicação e voltar depois, o sistema consegue mostrar corretamente onde o processo parou?

Avaliar especialmente:

```text
document scan

external submission

import

reminder scheduling

renewal after uncertain timeout
```

---

# 35. Persistent vs Ephemeral State

A próxima fase deve decidir conceitualmente quais estados precisam sobreviver a:

```text
page refresh

logout/login

browser close

new device

next day
```

Isso não significa decidir onde armazenar tudo.

Significa determinar requisitos.

---

# 36. Epistemic Integrity Mapping

Criar uma tabela:

| Domain/System State | What system knows | What internal user knows | What guest knows | Allowed UI claim |
|---|---|---|---|---|

Exemplos importantes:

```text
Document CLEAN
```

```text
DocumentSubmission received
```

```text
Requirement SATISFIED
```

```text
ReminderPolicy persisted
```

```text
Notification delivered
```

---

# 37. Trust-State Requirements

Mapear requisitos de confiança, especialmente:

```text
GTR-01
```

Para guest:

```text
requester identity known
```

deve existir antes do envio se essa constraint permanecer aprovada.

Também avaliar:

```text
who will receive this?
what exactly is being changed?
is this irreversible?
has the operation completed?
```

---

# 38. Accessibility-State Requirements

Mesmo sem componentes visuais, alguns estados já geram requisitos de acessibilidade.

Exemplos:

```text
loading completion must be announced

async processing change must not rely only on color

error must identify what happened

focus/context must survive recoverable failure

drag-and-drop must not be the only upload method
```

Registrar requisitos, não implementação.

---

# 39. Backend Dependency Mapping

Cada superfície/estado deve indicar dependências relevantes.

Pelo menos:

```text
Full BFF D-053/D-054

BLOCKER-A
Document read/list

BLOCKER-B
Reminder materialization

BLOCKER-C
External collection completion

GTR-01
Requester identity

CREATE-IDEMPOTENCY-01
Idempotent item creation

Guest verification visibility gap

tenant-wide request query
```

---

# 40. Engineering Blockers

Produzir uma tabela:

| ID | Dependency | Blocks Surface/State | Severity | Required before |
|---|---|---|---|---|

---

# 41. Open Questions

Manter as questões ainda não resolvidas.

Entre elas:

```text
automatic completion vs human review

document current/version semantics

final naming of TrackedSubject

resend of request

tenant-wide requests query
```

Adicionar novas apenas se realmente surgirem desta etapa.

---

# 42. Rejected Surface Assumptions

Registrar explicitamente ideias rejeitadas.

Exemplos:

```text
one URL = one screen

every backend entity needs a surface

every technical status needs a visible state

all errors can share a generic error state

all loading states are equivalent

guest knows security verification result

timeout = failure

retry is always safe
```

---

# 43. Revisão adversarial Claude ↔ Codex

Depois da primeira versão, executar revisão focada.

Codex deve tentar encontrar:

1. journey sem superfície necessária;
2. superfície sem journey real;
3. duplicação desnecessária;
4. estado técnico sem significado para o usuário;
5. estado do usuário omitido;
6. async states comprimidos;
7. unknown outcome tratado como failure;
8. retry inseguro;
9. criação duplicável após timeout;
10. guest sabendo mais que o backend expõe;
11. anti-enumeration quebrado;
12. `CLEAN` tratado como aprovação;
13. `SATISFIED` tratado como compliance atual;
14. BLOCKER-A/B/C mascarados;
15. GTR-01 omitido;
16. estado persistente tratado como efêmero;
17. estado efêmero tratado como persistido;
18. re-entry inexistente;
19. session expiry sem recovery;
20. OCC tratado como erro genérico;
21. componente visual decidido cedo demais;
22. page/URL confundida com Interaction Surface.

---

# 44. Quality Evaluation

Aplicar os eixos do Interface Engineering Quality Standard que fizerem sentido.

Especialmente:

```text
TaskSuitability

InformationArchitecture

SystemFeedback

ErrorRobustness

Accessibility

Consistency

Content

Trust
```

Nesta etapa, `InformationPresentation` visual ainda pode ser N/A.

---

# 45. Gates específicos de Screen + State Inventory

## SSI-G1 — Missing Surface

Uma journey crítica exige interação que não possui superfície conceitual.

## SSI-G2 — Missing State

Um estado conhecido da journey não existe no inventário.

## SSI-G3 — State Compression

Estados epistemicamente distintos foram fundidos.

## SSI-G4 — Unsafe Retry

A UI presumiria que retry é seguro sem idempotência/reconciliação.

## SSI-G5 — Unknown Outcome Misclassified

`UNKNOWN_OUTCOME` foi tratado como `FAILED`.

## SSI-G6 — Hidden Async State

Processamento assíncrono ocorre sem estado correspondente.

## SSI-G7 — Broken Re-entry

Processo longo não pode ser retomado conceitualmente.

## SSI-G8 — Security State Leak

Anti-enumeration ou outra decisão de segurança é revertida pela UI.

## SSI-G9 — Trust State Missing

Jornada sensível não possui contexto suficiente para ação segura.

## SSI-G10 — Premature Component Decision

A fase escolhe modal/drawer/page/layout antes de wireframes.

---

# 46. Final Status esperado

Se aprovado:

```text
APPROVED AS INPUT FOR LOW-FIDELITY WIREFRAMES
```

ou, se o processo quiser manter uma etapa intermediária específica:

```text
APPROVED AS INPUT FOR INTERACTION STRUCTURE / LOW-FI
```

Se houver gaps estruturais:

```text
NOT APPROVED
```

---

# 47. Sequência atual do projeto

```text
Context / Task Model                 ✅

Conceptual Model + IA                ✅

Critical User Journeys               ✅

Screen + State Inventory             ← AGORA

Low-fi Wireframes

Interaction Prototype

Heuristic + Accessibility Review

User Validation

Visual System

High-fidelity UI

Frontend Implementation
```

---

# 48. Por que essa etapa é importante

Depois do Screen + State Inventory, wireframe deixa de ser um exercício criativo aberto.

Passaremos a saber:

- quais superfícies precisam existir;
- quais journeys cada superfície atende;
- quais informações precisam estar presentes;
- quais estados precisam ser representados;
- quais falhas precisam de recovery;
- quais estados persistem;
- quais são efêmeros;
- o que o usuário sabe;
- o que apenas o backend sabe;
- quais claims a interface pode fazer;
- quais partes continuam tecnicamente bloqueadas.

Assim, o wireframe terá sua função correta:

> **encontrar a melhor organização espacial para requisitos de interação já conhecidos, em vez de descobrir o produto enquanto desenha telas.**
