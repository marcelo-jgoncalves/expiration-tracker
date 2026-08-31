# Expiration Tracker
## Análise da Aplicação sob a Perspectiva do Synthetic Persona Evaluation Framework

**Data:** 2026-08-30  
**Repositório analisado:** https://github.com/marcelo-jgoncalves/expiration-tracker  
**Objetivo desta etapa:** analisar a aplicação com foco específico na futura criação de um framework de testes com personas sintéticas. Esta etapa **não define ainda o framework nem as personas finais**; ela mapeia a realidade atual da aplicação, suas superfícies, estados, fluxos, limitações e características de engenharia que deverão orientar o planejamento posterior.

---

# 1. Conclusão geral

O Expiration Tracker é **muito favorável tecnicamente** à criação futura de um framework de personas sintéticas.

A principal razão não é apenas o frontend, mas a combinação de:

- domínio fortemente modelado;
- estados explícitos;
- idempotência;
- OCC;
- transactional outbox;
- workers desacoplados do runtime AWS;
- relógio injetável;
- ambiente `dev` com dados sintéticos resetáveis;
- observabilidade;
- Playwright já presente;
- padrão normativo de Test Engineering já existente.

Ao mesmo tempo, existem quatro restrições importantes neste momento:

1. o produto ainda não possui usuários reais nem produção;
2. o frontend de produção implementa apenas parte das superfícies planejadas;
3. o modelo B2B/multiusuário está no meio de uma transição importante;
4. o Playwright atual testa o frontend predominantemente contra um **BFF mockado**, não contra o sistema completo.

Classificação geral:

| Aspecto | Situação para futuros testes sintéticos |
|---|---|
| Modelagem de domínio | **Excelente** |
| Estados verificáveis/oracles | **Excelente** |
| Testabilidade temporal | **Muito boa** |
| Isolamento de dados | **Muito bom** |
| Observabilidade backend | **Muito boa** |
| Test infrastructure existente | **Muito boa** |
| Frontend testável deterministicamente | **Muito bom** |
| Browser → sistema real integrado | **Ainda incompleto** |
| Papéis multiusuário estáveis | **Em transição** |
| Validação humana das hipóteses UX | **Ainda inexistente** |
| Guest journey no frontend de produção | **Ainda não exposto** |
| Superfícies planejadas vs. implementadas | **Parcialmente divergentes** |

A principal leitura é:

> Os problemas atuais são majoritariamente de fronteira e maturidade de produto, não de fragilidade arquitetural.

---

# 2. O produto real é maior do que um “tracker de vencimentos”

O núcleo continua sendo `ExpirationItem`, mas o domínio atual já representa algo mais próximo de uma plataforma de:

> **controle de obrigações, documentação e evidências**

A arquitetura inclui conceitos como:

- Organizations;
- Memberships;
- ExpirationItems;
- ReminderPolicies;
- ReminderOccurrences;
- Documents;
- extração de campos;
- NotificationIntents;
- NotificationAttempts;
- Subjects;
- quotas;
- audit events;
- submissions;
- requirements;
- processos assíncronos.

O frontend consolidou dois grandes anchors mentais:

```text
Vencimentos
     +
Fornecedores / Subjects
```

As rotas reais atuais incluem:

- Overview;
- coleção de vencimentos;
- criação;
- detalhe;
- renovação;
- fornecedores;
- detalhe do fornecedor.

Configurações ainda é explicitamente um placeholder.

Isso significa que, futuramente, o framework não estará testando apenas:

> “Usuário tentando descobrir o que vence.”

Também existirá o problema cognitivo:

> “Operador tentando descobrir se um terceiro cumpriu uma obrigação documental.”

Esses são modelos mentais diferentes e deverão ser tratados como tal.

---

# 3. O ator humano atual do frontend é essencialmente o operador interno

O frontend atual está sob `ProtectedRoute`.

Não existe atualmente no `App.tsx` uma rota pública equivalente ao External Submitter/guest.

Portanto, sob a perspectiva do SPA de produção atual, a experiência diretamente exposta é a de um:

> **usuário autenticado que opera a carteira de vencimentos e fornecedores**

Por outro lado, o domínio e o planejamento já contemplam um segundo ator conceitual:

## External Submitter

Pode ser, por exemplo:

- fornecedor;
- funcionário;
- contador;
- corretor;
- cliente.

Esse ator poderá receber uma solicitação específica e enviar documentação sem necessariamente possuir uma conta.

Há backend/workers relacionados a:

- submissions;
- malware result;
- finalização de envio;
- document chasing.

Situação atual:

| Ator | Estado atual |
|---|---|
| Operador interno autenticado | **Superfície de produção real** |
| External Submitter / guest | **Domínio/backend + planejamento/protótipo, mas não rota do SPA atual** |
| Owner/Admin/Member/etc. B2B | **Modelo em construção; experiência final ainda não estabilizada** |

Essa distinção deverá ser preservada futuramente para evitar testar como “produto atual” algo que existe apenas em backend, design ou planejamento.

---

# 4. O modelo multiusuário ainda não deve ser considerado estável

Este é um dos pontos de maior volatilidade arquitetural atual.

As Waves B2B-0 até B2B-4 estão concluídas.

Já existem:

- `Organization`;
- `Membership`;
- `CreateOrganizationService`;
- `OnboardingStateResolver`.

O `OnboardingStateResolver` possui quatro estados.

Porém, esses componentes ainda não estão completamente conectados ao fluxo real de login/onboarding.

A Wave B2B-5 deverá realizar o cutover efetivo:

```text
identity
   ↓
Organization selection
   ↓
Membership
   ↓
permission
   ↓
RequestContext
```

e remover o fallback atual:

```text
tenantId = userId
```

Isso é extremamente relevante para personas.

A diferença entre:

```text
"dono da conta"
```

e:

```text
"funcionário membro de uma organização"
```

não é apenas visual.

Ela altera:

- conhecimento;
- objetivos;
- permissões;
- expectativas;
- autonomia;
- caminhos possíveis.

Por isso, personas B2B podem ser previstas conceitualmente, mas ainda não devem ser tratadas como experiências estabilizadas.

---

# 5. O core de vencimentos já é uma superfície muito madura

O vertical slice atual possui:

```text
coleção
→ detalhe
→ criação
→ renovação
```

com tratamento explícito de:

- validação;
- conflitos;
- autenticação;
- idempotência.

Há Playwright cobrindo esses comportamentos.

## Criação

O formulário diferencia:

- validação client-side;
- erro retornado pelo backend.

Existe preocupação explícita em preservar o conteúdo digitado.

A suíte atual verifica que:

- tentativa inválida não dispara request;
- valores são preservados quando o servidor rejeita uma tentativa seguinte.

Isso cria uma futura superfície comportamental muito boa:

```text
erro
→ compreensão
→ correção
→ recuperação
```

em vez de avaliar apenas:

```text
task completed
```

---

# 6. Renovação possui semântica de domínio própria

A aplicação faz uma distinção importante:

> **renovar não é editar a data**

Uma renovação cria um novo ciclo e preserva a relação com o ciclo anterior.

O frontend apresenta essa distinção e a suíte Playwright a verifica.

Isso cria uma futura oportunidade muito relevante para avaliação de modelo mental:

> O usuário compreendeu a diferença entre editar e renovar?

Esse tipo de comportamento é particularmente apropriado para personas sintéticas e posteriormente validação humana.

---

# 7. Concurrency e recuperação já fazem parte da UX real

Conflitos não são escondidos como detalhe de infraestrutura.

O cenário `E2E-05` simula:

```text
409 VERSION_CONFLICT
```

durante renovação.

O frontend:

- informa que o vencimento mudou desde que a tela foi aberta;
- impede nova submissão;
- oferece reload antes de nova tentativa.

Fluxo conceitual:

```text
outro ator mudou o dado
        ↓
minha visão ficou stale
        ↓
sistema me impede de sobrescrever
        ↓
preciso recuperar contexto
        ↓
tentar novamente
```

Esse fluxo será muito útil para distinguir comportamentos como:

- persistência;
- atenção;
- familiaridade digital;
- compreensão de conflito;
- capacidade de recuperação.

---

# 8. A recuperação de sessão está muito bem preparada

O `E2E-06` cobre uma situação rica:

> a sessão expira durante uma criação.

O frontend:

- aciona reautenticação;
- preserva o draft em `sessionStorage`;
- retorna à mesma rota;
- reutiliza a mesma idempotency key.

Fluxo lógico:

```text
tentativa lógica #1
    → interrupção de sessão
    → autenticação
    → tentativa lógica #1 retomada
```

e não:

```text
tentativa #1
+
tentativa #2
```

Isso produz propriedades observáveis tanto no frontend quanto no domínio.

É uma excelente futura superfície para medir:

- resiliência da UX;
- compreensão;
- recuperação;
- preservação de contexto;
- resultado funcional.

---

# 9. Fornecedores introduzem um segundo tipo de trabalho humano

`SubjectDetail.tsx` adiciona uma experiência distinta da área de vencimentos.

Para cada RequirementAssignment ainda não satisfeito, o operador pode:

1. abrir uma área de revisão;
2. visualizar `DocumentSubmission`s recebidos;
3. vincular manualmente um `ExpirationItem`;
4. considerar o requisito atendido.

O sistema deliberadamente **não realiza matching automático inseguro** quando a submissão não possui dados estruturados suficientes.

Estados revisáveis identificados:

```text
MISSING
REQUESTED
SUBMITTED
UNDER_REVIEW
REJECTED
```

Enquanto:

```text
SATISFIED
```

representa requisito já vinculado.

Também existem:

- unlink;
- tratamento de OCC;
- erro explícito quando o requisito mudou enquanto a página estava aberta.

Essa área introduz um princípio cognitivo importante:

> **A presença de um arquivo não significa automaticamente que a obrigação está satisfeita.**

Isso deverá ser preservado na avaliação futura.

---

# 10. A aplicação possui forte integridade epistêmica

Uma das melhores características do projeto é a separação clara entre eventos ou estados que poderiam ser confundidos.

Exemplos:

```text
arquivo enviado
≠
upload confirmado

upload confirmado
≠
documento verificado

documento recebido
≠
obrigação cumprida

request enviado
≠
request entregue

documento enviado
≠
requisito satisfeito

policy salva
≠
reminder agendado

reminder agendado
≠
notificação entregue
```

Essa distinção é consistente com a arquitetura.

Há estados separados para:

- ReminderOccurrence;
- NotificationIntent;
- tentativas de entrega;
- submissions;
- assignments;
- extracted fields;
- confirmação de IA.

Isso evita que o framework futuro precise confiar apenas em mensagens superficiais da UI.

---

# 11. O domínio oferece excelentes candidatos a oracles

A modelagem single-table possui:

- entidades versionadas;
- relações explícitas;
- idempotência;
- OCC;
- transactional outbox.

Com isso, afirmações como:

```text
"O vencimento foi criado."

"O ciclo anterior foi renovado."

"O requisito ficou satisfeito."

"A ocorrência foi disparada."

"Foi criado um NotificationIntent."

"A extração aguarda confirmação."

"O documento foi rejeitado."

"A política usada no reminder estava stale."
```

podem ser verificadas por estado real do domínio.

Isso é uma das maiores vantagens da aplicação para o futuro framework.

---

# 12. Reminder não é apenas um timer

O sistema de reminder é sofisticado.

O producer:

- varre shards temporais;
- possui lookback padrão;
- faz claim `SCHEDULED → CLAIMED`;
- possui TTL de claim;
- suporta partial batch failure;
- processa ReminderOccurrences e DocumentChasingOccurrences.

Formatos desconhecidos de entidade no índice são tratados de forma fail-closed.

Depois, o dispatch valida novamente:

```text
item ainda existe
item ainda está ACTIVE
itemVersion ainda é a esperada
policy ainda existe
policy ainda está enabled
policyVersion ainda é a esperada
scheduledAt ainda está dentro da tolerância
```

antes de produzir um NotificationIntent.

Isso significa que:

> “usuário esperou um reminder e não recebeu”

pode corresponder a muitos estados diferentes.

Nem toda ausência de notificação representa defeito.

---

# 13. O reminder possui proteção real contra race condition

O dispatch possui um segundo freshness fence atômico dentro da transação.

Se item ou policy forem alterados entre:

```text
leitura inicial
```

e:

```text
commit
```

os `ConditionCheck`s bloqueiam a criação de um NotificationIntent stale.

Um resultado possível é:

```text
ABORTED_FRESHNESS_RACE
```

Portanto:

```text
notificação não enviada
```

pode ser o comportamento correto.

Exemplo:

- o documento foi renovado;
- a policy foi desabilitada;
- o estado mudou durante a corrida.

Isso será crucial para futuros graders.

---

# 14. Controle temporal: excelente seam, mas não há ainda relógio global

Os workers críticos utilizam relógio injetado:

```ts
now: () => string
```

Isso aparece, entre outros, em:

- ReminderProducer;
- ReminderDispatch;
- ReminderMaterializationTrigger.

Essa decisão arquitetural permite testar lógica temporal sem esperar o relógio real.

Porém existe uma diferença entre:

> componentes críticos aceitam fake clock

e:

> sistema inteiro opera sob um único relógio virtual controlável.

Hoje existe claramente o primeiro.

O Playwright fixa:

```text
locale = pt-BR
timezoneId = UTC
```

mas isso não controla automaticamente:

- EventBridge;
- Lambda runtime;
- SQS;
- TTL;
- outros componentes AWS.

Conclusão:

> A arquitetura possui bons seams de tempo, mas ainda não existe um plano de controle temporal end-to-end unificado.

---

# 15. A aplicação possui muitos processos assíncronos

A estrutura atual contém workers para:

- outbox;
- document chasing;
- purge;
- malware result;
- parser sandbox;
- reminder dispatch;
- reminder materialization;
- reminder producer;
- reminder reconciliation;
- submissions;
- tenant purge;
- uploads;
- reconciliation de upload slots.

Isso significa que muitas jornadas seguem:

```text
Ação humana
    ↓
estado persistido
    ↓
evento
    ↓
fila
    ↓
worker
    ↓
novo estado
    ↓
feedback eventual
```

Por isso, futuramente:

> DOM + clique não serão suficientes para determinar corretamente o outcome de muitas jornadas.

---

# 16. Documentos e IA possuem fronteira de confiança bem definida

Pipeline conceitual:

```text
presigned upload
      ↓
quarantine
      ↓
malware verification
      ↓
CLEAN
      ↓
Textract OCR
      ↓
deterministic parser
      ↓
Bedrock quando necessário
      ↓
ExtractedField
      ↓
confirmação quando necessária
```

A arquitetura utiliza princípio fail-closed.

Situações como:

- baixa confiança;
- ausência de confiança;
- timeout;
- tipo desconhecido;
- divergência entre extratores;

não podem aplicar silenciosamente o dado.

Além disso, M7 OCR está registrado como `E2E PROVEN` em `dev`.

Isso produz outra importante distinção:

```text
IA sugeriu
≠
usuário confirmou
≠
dado virou verdade do domínio
```

---

# 17. A principal lacuna atual no browser testing

Playwright já está estruturado e saudável.

Porém a baseline atual de browser utiliza predominantemente:

```text
frontend
+
BFF mockado com page.route()
```

O vertical slice usa formatos e contratos reais do BFF, mas intercepta as requests.

Isso é excelente para:

- UX determinística;
- renderização;
- fluxos;
- tratamento de erro;
- acessibilidade;
- resiliência client-side.

Mas não prova:

```text
browser
→ BFF real
→ Lambda
→ DynamoDB
→ event
→ SQS
→ worker
→ provider
```

Essa distinção será central posteriormente.

---

# 18. O projeto já possui um Test Engineering Standard compatível

O repositório possui um padrão normativo de Test Engineering.

Ele separa três dimensões:

1. nível do teste;
2. ambiente real/fake/emulado;
3. técnica/propósito.

O padrão também proíbe fazer claims sobre AWS real usando somente fakes.

Gates encontrados incluem:

```text
G-V1  reprodutibilidade do veredito
G-V2  isolamento de dado
G-V3  mutação nomeada que derrotaria o oracle
G-V4  intenção declarada
G-C1  claim compatível com a evidência
G-V5  blast radius pré-declarado em drills
G-V6  rollback tentado e registrado
```

Além disso, critérios como:

- oracle strength;
- evidence;
- honesty;

possuem peso importante.

Conclusão:

> O framework futuro não deverá criar uma filosofia paralela de qualidade. Ele deverá especializar e herdar o Test Engineering Standard do projeto.

---

# 19. Observabilidade é forte para o estágio atual

A aplicação já utiliza:

- CloudWatch EMF;
- X-Ray;
- correlation IDs.

O estado atual registra como `E2E PROVEN` o join:

```text
correlationId ↔ X-Ray
```

contra `dev`.

Isso permite investigar:

```text
request
evento
worker
falha
trace
```

Porém ainda não existe evidência clara de uma identidade única como:

```text
Synthetic Trial ID
       ↓
Browser
       ↓
BFF
       ↓
todos os eventos/filas/workers
```

O `correlationId` resolve parte importante da rastreabilidade técnica, mas ainda não equivale a uma identidade global da futura sessão sintética.

---

# 20. A aplicação é especialmente forte para fluxos de recuperação

Classes de comportamento já existentes:

| Classe | Exemplo real |
|---|---|
| Input error | client-side validation |
| Backend validation | HTTP 400 preservando formulário |
| Stale state | OCC 409 |
| Auth interruption | 401 durante criação |
| Idempotency | mesma logical submission |
| Concurrent update | freshness fence |
| Async stale state | occurrence cancelada |
| Duplicate processing | ALREADY_TRIGGERED |
| Race condition | ABORTED_FRESHNESS_RACE |
| Missing evidence | requirement sem submissions |
| Untrusted automation | IA em pending confirmation |
| Partial failure | producer batch failure |
| Recovery | reload/retry/reconciliation |

Essa diversidade de estados cria um ambiente muito mais interessante para personas do que um CRUD tradicional.

---

# 21. Acessibilidade já faz parte da engenharia real

Há suíte Playwright específica de acessibilidade.

O vertical slice também verifica comportamento de foco após navegação client-side.

Isso é importante para:

- leitores de tela;
- mudança de contexto;
- interação via teclado;
- personas de acessibilidade.

Existe também uma suíte visual separada.

Ela é deliberadamente local hoje porque:

- baseline foi gravado em Windows;
- CI usa Ubuntu;
- rasterização de fontes produziria falsos negativos.

Essa decisão mostra novamente prioridade para:

> validade da evidência

em vez de simplesmente ampliar cobertura de CI.

---

# 22. O ambiente `dev` é especialmente favorável à experimentação

Em 30 de agosto de 2026 o projeto declara:

```text
sem usuário real
sem produção
deploy apenas em dev
dado sintético resetável
```

Isso cria uma janela muito boa para experimentos sintéticos.

É possível testar com baixo blast radius humano:

- criação;
- destruição;
- concorrência;
- erros;
- estados incomuns;
- reset.

Ainda existem dependências AWS reais que precisam de cuidado, mas a ausência de usuários reais reduz significativamente o risco.

---

# 23. Dado sintético não significa execução fake

Embora `dev` utilize dados sintéticos, o ambiente contém serviços AWS reais.

Existem execuções E2E reais de:

- OCR;
- observabilidade;
- outros fluxos de runtime.

Portanto:

```text
dado sintético
```

não significa:

```text
execução completamente fake
```

Essa distinção está alinhada ao Test Engineering Standard.

Posteriormente será possível ter:

- dados artificiais;
- infraestrutura real;
- browser real;
- resultado operacional real.

Mas cada claim deverá declarar corretamente o nível de evidência.

---

# 24. Há capacidades backend sem superfície humana equivalente no SPA atual

A estrutura modular possui:

```text
identity
expiration
reminder
notification
document
subject
import
extraction
bff
```

Enquanto o frontend atual expõe principalmente:

```text
Overview
Items
Create Item
Item Detail
Renew Item
Subjects
Subject Detail
Settings placeholder
```

Portanto, funcionalidades como:

- CSV/import;
- partes do document workflow;
- guest submission;
- reminder configuration;
- evolução multiusuário;

não devem ser automaticamente tratadas como jornadas de browser disponíveis hoje.

---

# 25. O protótipo continua útil, mas não é evidência da aplicação atual

A documentação separa:

```text
Full BFF + production frontend
```

de:

```text
interface planning
```

e:

```text
standalone prototype
```

O protótipo possui mais superfícies e jornadas do que a aplicação atual.

Ele será útil para:

- hipóteses;
- vocabulário;
- fluxos projetados;
- estados UX desejados;
- planejamento.

Mas não poderá fornecer evidência sobre:

> o que a aplicação atualmente faz.

---

# 26. Drift documental identificado

Foram encontrados casos em que documentos/comentários históricos ficaram atrás do código.

## Exemplo 1

O `NEXT_SESSION_PROMPT.md` afirma que alguns blockers já foram resolvidos.

O código atual de `SubjectDetail.tsx` confirma que a review queue correspondente já existe.

## Exemplo 2

O `playwright.config.ts` contém comentário histórico dizendo que OCC/idempotência não são cobertos porque não existe mutation UI.

Porém `expiration-vertical-slice.spec.ts` já cobre:

- criação;
- renovação;
- OCC;
- recuperação de idempotency key.

Isso é drift normal de projeto em evolução, mas exige uma hierarquia de confiança.

Proposta:

```text
código atual
     ↓
testes atuais
     ↓
estado atual / NEXT_SESSION
     ↓
documentação normativa vigente
     ↓
planning / prototype
     ↓
documentos históricos
```

---

# 27. Existe também drift arquitetural deliberado

`ARCHITECTURE.md` ainda registra multi-tenancy plena/RBAC como non-goal do MVP original.

Porém o projeto já está implementando evolução Multi-User B2B.

Isso é evolução de escopo, não necessariamente contradição.

O framework futuro deverá diferenciar:

```text
architecture baseline original
```

de:

```text
current product evolution
```

principalmente em:

- papéis;
- permissões;
- organizações;
- onboarding.

---

# 28. “Architecture Status: NOT APPROVED” não significa baixa qualidade

O documento consolidado mantém formalmente:

```text
DESIGN MATURITY STATUS: APPROVED
ARCHITECTURE STATUS: NOT APPROVED
```

porque a rubrica operacional exige:

- sistema construído;
- testes sob falhas reais;
- carga;
- evidência operacional suficiente.

A existência da implementação não é considerada prova suficiente.

Essa filosofia está fortemente alinhada ao framework de personas.

O futuro framework também deverá distinguir:

```text
design says X
code implements X
test proves X locally
E2E proves X against dev
human observed X
```

sem reduzir tudo a:

```text
"funciona"
```

---

# 29. Mapa de maturidade das capacidades relevantes

| Capacidade | Domínio/backend | Frontend produção | Evidência atual | Estado para futura análise de personas |
|---|---|---|---|---|
| Overview / atenção | Sim | Sim | Frontend tests + Full BFF E2E | **Madura** |
| Listar vencimentos | Sim | Sim | Playwright + BFF | **Madura** |
| Criar vencimento | Sim | Sim | Playwright | **Madura** |
| Ver detalhe | Sim | Sim | Playwright | **Madura** |
| Renovar | Sim | Sim | Playwright/OCC | **Madura** |
| Recuperar conflito | Sim | Sim | Playwright | **Madura** |
| Recuperar sessão | Sim | Sim | Playwright | **Madura** |
| Subjects/Fornecedores | Sim | Sim | Produção atual | **Madura/recente** |
| Requirement review | Sim | Sim | Código atual | **Madura/recente** |
| Link/unlink item | Sim | Sim | OCC presente | **Madura/recente** |
| Reminder engine | Sim | Exposição parcial | backend forte | **Backend maduro, UX menos clara** |
| Notifications | Sim | Não é anchor atual | backend async | **Backend maduro** |
| Upload/document pipeline | Sim | Exposição precisa ser verificada | M7 E2E PROVEN | **Backend maduro** |
| OCR/IA | Sim | fluxo humano não totalmente mapeado na SPA atual | E2E PROVEN | **Backend maduro** |
| Guest submission | Sim/conceitual | Não há rota atual no SPA | planning/backend | **Ainda não superfície atual** |
| CSV import | Módulo existe | Sem rota atual | parcial | **Ainda não superfície atual** |
| Configurações | — | Placeholder | — | **Não implementada** |
| Multi-user organizations | Fundação | Não wireado | B2B-0..4 | **Em transição** |
| RequestContext multi-org | Escopo aprovado | Não | B2B-5 pendente | **Não implementado** |
| Purge/LGPD completo | Parcial | Não é jornada principal | parcialmente E2E | **Engenharia interna** |

---

# 30. Pontos fortes para o futuro framework

A aplicação combina:

```text
estado de domínio explícito
+
eventos
+
versionamento
+
OCC
+
idempotência
+
transactional outbox
+
workers puros
+
relógio injetável
+
dados dev resetáveis
+
Playwright
+
a11y
+
correlation ID / X-Ray
+
Test Engineering Standard
```

Essa é uma base muito melhor do que tentar adicionar personas sintéticas a uma aplicação sem disciplina de estados ou evidência.

---

# 31. Principal limitação técnica atual

O principal gap não é a ausência de tecnologia de agentes.

Hoje existem separadamente:

```text
Playwright
     → frontend com BFF mockado

Backend tests
     → domínio/runtime

AWS dev
     → testes E2E específicos

Injected clocks
     → workers

CloudWatch/X-Ray
     → backend observability
```

Mas ainda não existe uma unidade completa equivalente a:

```text
uma sessão controlada
     ↓
browser real
     ↓
BFF real
     ↓
AWS/dev
     ↓
workers
     ↓
estado final observável
     ↓
reset completo
```

Essa será uma questão central no planejamento futuro.

---

# 32. Segunda limitação: ausência de ground truth humano

A Visual Language está classificada como provisória até User Validation.

O projeto ainda não possui usuários reais.

Portanto, qualquer afirmação do tipo:

```text
"um dono de pequena empresa pouco técnico se comporta assim"
```

deverá ser classificada como:

```text
HYPOTHESIS
```

e não:

```text
HUMAN-OBSERVED
```

Isso está perfeitamente alinhado ao modelo de provenance definido na Research & Quality Baseline v1.

---

# 33. Terceira limitação: identidade B2B em transição

B2B-5 alterará:

```text
login
→ organization
→ membership
→ role
→ RequestContext
```

Esse boundary é central para personas.

Não é recomendável congelar agora personas rígidas como:

```text
OWNER
ADMIN
MEMBER
VIEWER
```

como se a experiência final já estivesse estabilizada.

A arquitetura de papéis deverá ser reavaliada depois do cutover B2B.

---

# 34. Fotografia atual da aplicação para o framework

```text
                   EXPIRATION TRACKER
                         │
          ┌──────────────┴───────────────┐
          │                              │
     HUMAN SURFACE                  SYSTEM SURFACE
          │                              │
   Internal Operator              Strong domain states
          │                              │
  ┌───────┴────────┐             ┌───────┴─────────┐
  │                │             │                 │
Vencimentos   Fornecedores    Async engine     Documents/AI
  │                │             │                 │
create          requirements   reminders       quarantine
detail          submissions    chasing         malware
renew           review         notification    OCR
recovery        link/unlink    reconciliation  extraction
  │                │             │                 │
  └────────────────┴───────┬─────┴─────────────────┘
                           │
                     Observable state
                           │
                   DynamoDB / events /
                   outbox / traces
```

Em volta desse núcleo existem três zonas ainda não estabilizadas:

```text
External Submitter UI
Multi-User B2B
Planned interface surfaces
```

Infraestrutura de engenharia transversal:

```text
Playwright
Vitest
DynamoDB Local
AWS dev
Test Engineering Standard
Claude↔Codex protocol
CloudWatch/X-Ray
```

---

# 35. Conclusão da análise

A aplicação **não precisa ser artificialmente adaptada para que personas sintéticas façam sentido**.

Ela já possui vários dos elementos mais difíceis de introduzir posteriormente:

- estados determinísticos;
- seams de dependência;
- relógio injetável;
- idempotência;
- concorrência explícita;
- evidência operacional;
- isolamento;
- observabilidade.

A principal conclusão é:

> O framework não deverá ser pensado apenas como um “agente que navega no frontend”.

O Expiration Tracker possui três camadas reais que precisarão ser respeitadas:

```text
experiência humana
        +
estados de domínio
        +
processos assíncronos
```

Qualquer avaliação confiável precisará correlacionar essas três dimensões.

Também ficou claro que:

- o modelo de papéis B2B ainda não deve ser congelado;
- guest/external submitter não é ainda superfície atual do SPA;
- planejamento/protótipo não deve ser confundido com implementação;
- código e testes atuais devem ter prioridade sobre documentação histórica;
- o core mais estável hoje é:

```text
Internal Operator
      ↓
Vencimentos
+
Fornecedores
```

Com isso, existe agora uma fotografia suficientemente precisa da aplicação para que a próxima etapa possa começar a derivar o framework a partir da realidade do código.

---

# Referências principais do repositório

- Repositório principal:  
  https://github.com/marcelo-jgoncalves/expiration-tracker

- Arquitetura:  
  https://github.com/marcelo-jgoncalves/expiration-tracker/blob/main/ARCHITECTURE.md

- Estado atual / próxima sessão:  
  https://github.com/marcelo-jgoncalves/expiration-tracker/blob/main/NEXT_SESSION_PROMPT.md

- Test Engineering Standard:  
  https://github.com/marcelo-jgoncalves/expiration-tracker/blob/main/docs/engineering/test-engineering-standard.md

- Frontend App:  
  https://github.com/marcelo-jgoncalves/expiration-tracker/blob/main/frontend/src/App.tsx

- Subject Detail:  
  https://github.com/marcelo-jgoncalves/expiration-tracker/blob/main/frontend/src/routes/subjects/SubjectDetail.tsx

- Playwright config:  
  https://github.com/marcelo-jgoncalves/expiration-tracker/blob/main/frontend/playwright.config.ts

- Vertical slice E2E:  
  https://github.com/marcelo-jgoncalves/expiration-tracker/blob/main/frontend/e2e/expiration-vertical-slice.spec.ts

- Workers:  
  https://github.com/marcelo-jgoncalves/expiration-tracker/tree/main/src/workers

- Reminder Producer:  
  https://github.com/marcelo-jgoncalves/expiration-tracker/blob/main/src/workers/reminder-producer/producer.ts

- Reminder Dispatch:  
  https://github.com/marcelo-jgoncalves/expiration-tracker/blob/main/src/workers/reminder-dispatch/dispatch.ts

- Frontend E2E directory:  
  https://github.com/marcelo-jgoncalves/expiration-tracker/tree/main/frontend/e2e

---

**Status:** Application Analysis for Synthetic Persona Framework v1  
**Uso pretendido:** servir como registro técnico da análise da aplicação antes do planejamento e implementação do Synthetic Persona Evaluation Framework.
