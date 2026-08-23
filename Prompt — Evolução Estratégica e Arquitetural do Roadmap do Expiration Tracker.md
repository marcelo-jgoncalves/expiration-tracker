# Missão

Você atuará como **Principal Software Engineer / Staff+ Architect responsável pela evolução do Expiration Tracker**.

Repositório:

**https://github.com/marcelo-jgoncalves/expiration-tracker**

Sua tarefa NÃO é simplesmente implementar uma lista de funcionalidades.

Sua tarefa é:

1. estudar profundamente o estado real do repositório;
2. entender a arquitetura atual, domínio, requisitos, ADRs, milestones, código, infraestrutura, testes e decisões já tomadas;
3. confrontar esse estado com as novas descobertas de produto descritas neste prompt;
4. identificar quais capacidades realmente precisam ser acrescentadas;
5. decidir quais mudanças arquiteturais são necessárias;
6. preservar o que continua correto;
7. refatorar o que precisar ser refatorado;
8. integrar essas capacidades ao roadmap existente;
9. reorganizar milestones se necessário;
10. produzir um plano de desenvolvimento implementável, auditável e coerente com o alto padrão de engenharia atual.

---

# 1. Contexto estratégico do projeto

O Expiration Tracker é um micro-SaaS voltado ao controle de:

- vencimentos;
- documentos;
- certificados;
- contratos;
- licenças;
- seguros;
- treinamentos;
- certidões;
- inspeções;
- manutenções;
- obrigações recorrentes;
- outros itens com validade ou necessidade periódica de renovação.

O objetivo comercial NÃO é dominar o mercado.

O objetivo é construir um produto tecnicamente excelente que possa gerar **renda recorrente adicional**, mesmo com uma quantidade relativamente pequena de clientes.

Um resultado como:

- 10 clientes;
- 20 clientes;
- 30 clientes;

já pode ser comercialmente interessante.

Uma faixa de lucro recorrente como:

**R$1.000–R$3.000/mês**

já representaria sucesso relevante para o projeto.

Portanto:

> não devemos avaliar features somente pela capacidade de escalar para uma startup enorme.

Devemos priorizar:

- facilidade de vender para os primeiros clientes;
- retenção;
- willingness to pay;
- baixo churn;
- automação;
- baixo suporte;
- baixo custo operacional;
- valor recorrente;
- possibilidade de operação semi-passiva.

---

# 2. Princípio fundamental de engenharia

Apesar da meta comercial modesta, o projeto deve manter **alto padrão de engenharia**.

NÃO simplifique engenharia apenas porque é um micro-SaaS.

Continuam sendo desejáveis, quando justificadas:

- arquitetura modular;
- separação clara de domínios;
- Domain-Driven Design quando apropriado;
- SOLID;
- Clean/Hexagonal Architecture quando fizer sentido;
- idempotência;
- optimistic concurrency;
- filas;
- DLQ;
- retries;
- transactional outbox quando apropriado;
- observabilidade;
- tracing;
- métricas;
- alarmes;
- segurança;
- testes unitários;
- integration tests;
- contract tests;
- IaC;
- CI/CD;
- rollback;
- documentação;
- ADRs;
- threat modeling;
- isolamento multi-tenant;
- auditabilidade.

Mas existe uma regra igualmente importante:

> **engenharia pode ser sofisticada; escopo funcional deve continuar disciplinado.**

Não criar complexidade simplesmente porque ela é tecnicamente interessante.

---

# 3. Regra importante sobre arquitetura

**Alterar a arquitetura atual NÃO é um problema.**

Não preserve decisões anteriores por apego ou compatibilidade conceitual.

Se uma mudança arquitetural:

- aumentar significativamente o valor do produto;
- corrigir uma abstração inadequada;
- preparar corretamente uma capacidade de alto valor;
- reduzir dívida técnica futura;
- melhorar segurança;
- melhorar confiabilidade;
- simplificar evolução;
- melhorar separação de responsabilidades;

ela deve ser proposta.

Entretanto:

> toda mudança deve ter justificativa técnica e de produto.

Não faça rewrites desnecessários.

---

# 4. Antes de qualquer proposta: estude profundamente o repositório

Faça uma análise real do código.

Não se baseie apenas no README.

Inspecione pelo menos:

- `src/`;
- módulos de domínio;
- application layer;
- ports;
- adapters;
- handlers Lambda;
- notification engine;
- reminder engine;
- expiration domain;
- document domain;
- identity;
- infraestrutura;
- Terraform;
- filas;
- DynamoDB;
- S3;
- SES;
- EventBridge;
- Step Functions, caso já existam;
- testes;
- `.github/workflows`;
- ADRs;
- requirements;
- data model;
- cost model;
- roadmap;
- milestones;
- documentos de sessão;
- documentos de engenharia;
- documentação de segurança;
- documentação de observabilidade.

Verifique especialmente:

- o que realmente existe;
- o que apenas está documentado;
- o que está planejado;
- o que ficou obsoleto;
- divergências entre documentação e implementação.

Não presuma que documentação antiga continua correta.

---

# 5. Reconstrua o estado atual do roadmap

Antes de adicionar qualquer coisa, produza uma tabela:

| Milestone | Objetivo | Estado real | Implementado | Faltante | Dependências | Observações |
|---|---|---|---|---|---|---|

Identifique claramente:

- concluído;
- parcialmente concluído;
- apenas desenhado;
- ainda não iniciado;
- obsoleto;
- substituído por ADR posterior.

Preste atenção especial a M0–M8 e a qualquer milestone posterior já existente.

---

# 6. Não assuma que as funcionalidades abaixo ainda não existem

As capacidades apresentadas neste prompt vieram de uma análise comercial externa.

Agora você deve verificar cada uma contra o código.

Para cada capacidade, classifique:

### IMPLEMENTADA

Já existe de forma funcional.

### PARCIALMENTE IMPLEMENTADA

Há componentes ou abstrações reutilizáveis.

### PLANEJADA

Já consta no roadmap/requisitos, mas não existe.

### NÃO CONTEMPLADA

Não existe nem como conceito suficientemente modelado.

### REQUER REARQUITETURA

A implementação correta exige mudança relevante de domínio ou infraestrutura.

Não crie duplicações.

---

# 7. Tese comercial que deve orientar a evolução

A pesquisa de mercado indicou que um simples:

> “cadastre uma data e receba um lembrete”

é útil, mas facilmente substituído por:

- Google Calendar;
- Excel;
- Outlook;
- ChatGPT;
- ferramentas gratuitas.

O valor aumenta muito quando o produto passa para:

> **“Eu ajudo sua empresa a manter documentos e obrigações efetivamente atualizados.”**

Especialmente em situações envolvendo:

- fornecedores;
- prestadores;
- clientes;
- funcionários;
- equipamentos;
- unidades;
- documentos obrigatórios;
- múltiplos responsáveis;
- terceiros externos;
- cobrança de renovação;
- histórico;
- compliance operacional leve.

A evolução desejada NÃO é virar:

- ERP;
- GRC;
- procurement platform;
- CLM completo;
- TPRM enterprise.

A fronteira desejada é:

> **Expiration Tracking + Document Collection + Renewal Workflow + Lightweight Compliance**

---

# 8. Nova entidade conceitual: TrackedSubject

Avalie profundamente a necessidade de introduzir uma entidade equivalente a:

`TrackedSubject`

Ela representa:

> a pessoa, empresa, fornecedor, cliente, funcionário, equipamento, unidade ou outro objeto ao qual os vencimentos pertencem.

Possíveis tipos:

```text
COMPANY
VENDOR
CLIENT
EMPLOYEE
ASSET
LOCATION
CUSTOM
```

Exemplo:

```text
Fornecedor ACME
 ├── Seguro RC
 ├── CND
 ├── Contrato
 └── Certificado
```

Outro:

```text
Funcionário João
 ├── ASO
 ├── NR-10
 └── NR-35
```

Outro:

```text
Elevador 02
 ├── inspeção
 ├── seguro
 └── manutenção
```

IMPORTANTE:

Verifique se `Organization` já possui significado de tenant/workspace.

Não reutilize conceitos com semânticas conflitantes.

Determine:

- agregado;
- lifecycle;
- ownership;
- tenant isolation;
- IDs;
- índices;
- relacionamentos;
- deletion semantics;
- eventual soft delete;
- queries;
- histórico;
- necessidade de custom fields.

---

# 9. Requirement / RequirementTemplate / RequirementAssignment

Avalie introduzir uma abstração capaz de representar:

> “Este sujeito deveria possuir determinado documento ou requisito.”

Esse conceito é diferente de um `ExpirationItem`.

Exemplo:

```text
Fornecedor ACME

Seguro RC → válido
CND → vence em 12 dias
NR-35 → ausente
ASO → vencido
```

O estado `MISSING` não é naturalmente um vencimento.

Avalie entidades como:

```text
RequirementTemplate
RequirementAssignment
```

Possíveis estados:

```text
MISSING
REQUESTED
SUBMITTED
UNDER_REVIEW
VALID
EXPIRING
EXPIRED
REJECTED
```

Mas NÃO aceite essa lista automaticamente.

Analise quais estados realmente pertencem ao domínio.

Pergunte:

- o estado pertence ao requirement?
- ao submission?
- ao document?
- ao expiration?
- ele deve ser derivado em vez de persistido?
- quais transições precisam ser protegidas?

Evite transformar `ExpirationItem` em um agregado monolítico.

---

# 10. Templates verticais

Avalie permitir templates reutilizáveis.

Exemplo:

```text
Template: Prestador Elétrico

CNPJ
Seguro RC
NR-10
NR-35
ASO
```

Aplicação:

```text
Template
    ↓
Fornecedor ACME
    ↓
RequirementAssignments
```

Isso permitiria no futuro templates para:

- contabilidade;
- licitações;
- construção;
- facilities;
- SST;
- indústria;
- condomínios;
- frotas;
- clínicas;
- outros.

O backend deve permanecer horizontal.

A verticalização deve ocorrer preferencialmente através de:

- templates;
- configuração;
- metadata;
- custom fields;

e não forks de código.

---

# 11. ExternalContact

Hoje deve existir uma distinção entre:

```text
User
```

e:

```text
ExternalContact
```

Avalie formalmente essa nova entidade.

Ela representa:

- fornecedor;
- funcionário externo;
- contador;
- cliente;
- corretor;
- prestador;
- qualquer pessoa que precise fornecer/renovar documentos sem ser usuário do SaaS.

Um `ExternalContact`:

- não necessariamente possui login;
- pode estar associado a um `TrackedSubject`;
- possui e-mail;
- futuramente telefone/WhatsApp;
- pode receber solicitações;
- pode estar relacionado a requisitos específicos;
- não deve ganhar implicitamente acesso ao tenant.

Considere que um fornecedor pode ter:

```text
Contato administrativo
Contato financeiro
Contato de segurança
Contato de seguros
```

Não limite prematuramente a:

```text
subject.email
```

---

# 12. DocumentRequest

Introduza ou avalie uma entidade explícita para:

> solicitar um documento a alguém.

Exemplo:

```text
RequirementAssignment
        ↓
DocumentRequest
        ↓
ExternalContact
```

Ela deve poder registrar:

- requestedAt;
- requestedBy;
- recipient;
- deadline;
- status;
- reminder/chasing state;
- token/link;
- lastSentAt;
- attempts;
- completion;
- cancellation;
- expiration do link;
- audit events.

Não presuma que tudo isso precisa ser campo persistido.

Projete corretamente.

---

# 13. Guest upload / magic link

Essa é considerada uma das capacidades comerciais mais importantes.

Workflow desejado:

```text
documento está ausente ou perto do vencimento
        ↓
sistema envia solicitação
        ↓
terceiro recebe e-mail
        ↓
abre link seguro
        ↓
NÃO cria conta
        ↓
visualiza o documento solicitado
        ↓
faz upload
        ↓
pipeline de segurança existente
        ↓
extração
        ↓
revisão humana
        ↓
renovação concluída
```

Avalie:

- signed token;
- token hashing;
- TTL;
- single-use vs reusable;
- revocation;
- rate limiting;
- tenant isolation;
- replay protection;
- upload quotas;
- file-type restrictions;
- malware pipeline;
- audit logging;
- privacy;
- enumeration attacks.

Não crie autenticação completa para convidados se não for necessária.

---

# 14. DocumentSubmission

Analise se o modelo atual de documentos assume:

```text
ExpirationItem existe
    ↓
documento é anexado
```

Se sim, avalie introduzir uma abstração intermediária equivalente a:

```text
DocumentSubmission
```

para suportar também:

```text
Requirement existe
    ↓
terceiro envia documento
    ↓
documento é processado
    ↓
data é extraída
    ↓
humano confirma
    ↓
ExpirationItem nasce ou é renovado
```

Esse fluxo é importante.

Não crie um `ExpirationItem` artificial apenas para possibilitar upload.

---

# 15. Integração com o M6 existente

Se o M6 já implementa:

- presigned upload;
- S3;
- quarantine;
- malware detection;
- promotion;
- storage metadata;
- auditabilidade;

reutilize esse pipeline.

Não crie outro sistema paralelo para guest upload.

Generalize o que precisar ser generalizado.

Identifique claramente:

- componentes reutilizados;
- componentes modificados;
- novos ports;
- novos adapters;
- novas policies.

---

# 16. Integração com M7 — OCR / IA

Não remova automaticamente M7.

Avalie a implementação planejada envolvendo:

- Textract;
- Bedrock;
- Step Functions;
- confidence;
- human confirmation.

A nova aplicação de maior valor pode ser:

```text
ExternalContact
     ↓
magic link
     ↓
upload
     ↓
M6 security
     ↓
M7 extraction
     ↓
confidence score
     ↓
human confirmation
     ↓
Requirement valid
     ↓
ExpirationItem created/renewed
```

Nesse contexto, OCR/IA passa a automatizar uma etapa recorrente de trabalho.

Mantenha obrigatoriamente:

> human-in-the-loop

quando a data extraída puder gerar consequências reais.

Não trate LLM como fonte de verdade.

---

# 17. Automated Document Chasing

Projete capacidade para o sistema cobrar automaticamente documentos ausentes ou vencendo.

Exemplo:

```text
T-30
→ fornecedor

T-14
→ fornecedor

T-7
→ fornecedor

T-3
→ fornecedor + responsável interno

EXPIRED
→ fornecedor + responsável + gestor
```

Mas não hardcode este workflow.

Avalie uma modelagem simples o suficiente para:

- presets;
- políticas;
- audiences;
- offsets;
- canais.

Evite construir um BPMN engine.

---

# 18. Escalation e múltiplos destinatários

Hoje pode existir algo equivalente a:

```text
ExpirationItem
    ↓
assigneeUserId
    ↓
recipient
```

Precisamos avaliar evolução para:

```text
Rule
   ↓
Recipient Resolution
      ├── assignee
      ├── owner
      ├── watcher
      ├── manager
      ├── explicit internal user
      └── external contact
```

Audiences possíveis:

```text
ASSIGNEE
OWNER
WATCHERS
MANAGER
EXPLICIT_USER
EXTERNAL_CONTACT
```

A lista é hipótese.

Valide.

Evite colocar simplesmente:

```text
recipientIds[]
```

em estruturas que deveriam representar uma unidade de entrega.

Prefira, se coerente com a arquitetura atual:

> uma delivery/intent independente por recipient.

Isso favorece:

- retries independentes;
- idempotência;
- bounce tracking;
- suppression;
- preferences;
- status;
- auditoria.

---

# 19. Watchers / Followers

Avalie permitir que usuários internos acompanhem determinados itens sem serem responsáveis primários.

Exemplo:

```text
Responsável: João

Watchers:
- Maria
- Carlos
```

Mas diferencie claramente:

- responsável;
- observador;
- gestor;
- owner.

Evite semântica ambígua.

---

# 20. Digest notifications

Adicione ao roadmap a avaliação de:

```text
IMMEDIATE
DAILY_DIGEST
WEEKLY_DIGEST
```

Problema:

um cliente com centenas de vencimentos pode receber dezenas de e-mails.

Isso cria notification fatigue e aumenta churn.

Determine:

- quais notificações podem entrar em digest;
- quais devem ser imediatas;
- precedence rules;
- comportamento para vencido;
- timezone;
- quiet hours;
- retries;
- idempotência;
- aggregation window.

---

# 21. Importação CSV/XLSX

Esta deve ser considerada funcionalidade de altíssimo valor.

Cliente provável já possui planilhas.

Fluxo desejado:

```text
upload
  ↓
parse
  ↓
mapping de colunas
  ↓
preview
  ↓
validation
  ↓
duplicate detection
  ↓
dry-run
  ↓
commit
  ↓
relatório
```

Suportar, quando razoável:

- items;
- subjects;
- external contacts;
- requirements.

Não tentar suportar todos no primeiro incremento se isso tornar a feature excessivamente grande.

Considere:

- limites;
- background processing;
- idempotency key;
- retries;
- partial failure;
- transactional boundaries;
- rollback;
- observabilidade;
- arquivo com erros;
- rows rejected;
- duplicate semantics.

Avalie CSV primeiro versus XLSX simultaneamente.

---

# 22. Exportação

Também incluir:

- CSV export;
- export de vencimentos;
- subjects;
- requirements;
- histórico básico.

Isso reduz medo de lock-in e melhora confiança B2B.

---

# 23. Custom fields

Não adicione dezenas de campos específicos a `ExpirationItem`.

Avalie infraestrutura para:

```text
FieldDefinition
FieldValue
```

Tipos iniciais possíveis:

```text
TEXT
NUMBER
DATE
SELECT
BOOLEAN
URL
```

Pode haver custom fields em:

- TrackedSubject;
- ExpirationItem;
- Requirement;

mas questione se todos realmente precisam.

Considere:

- tenant-defined schemas;
- validation;
- indexes;
- search;
- migrations;
- DynamoDB implications;
- limits;
- API representation.

Evite construir um Airtable.

---

# 24. Organization / Membership / RBAC

Se isso já estiver no roadmap futuro, reavalie sua prioridade.

Para B2B serão necessários:

- organization/workspace;
- membership;
- roles;
- invitations;
- user lifecycle.

Roles iniciais possíveis:

```text
OWNER
ADMIN
MEMBER
VIEWER
```

Talvez:

```text
MANAGER
```

Não aceite a lista automaticamente.

Projete o menor RBAC que resolve necessidades reais.

Preserve isolamento multi-tenant.

---

# 25. Dashboard de compliance operacional

Além do dashboard de vencimentos, planejar visão por `TrackedSubject`.

Exemplo:

```text
Fornecedor ACME

5 requisitos

3 válidos
1 vence em 7 dias
1 ausente

Compliance: 60%
```

Tenha cuidado com a palavra **compliance**.

O sistema não deve prometer:

> “empresa legalmente em conformidade”.

Melhor semântica:

> requisitos documentais configurados pelo usuário.

O score deve refletir apenas o que o cliente cadastrou.

---

# 26. Bulk operations

Avalie incluir posteriormente:

- alterar responsável em massa;
- aplicar template a vários subjects;
- criar reminders em massa;
- arquivar;
- exportar;
- enviar solicitações em lote.

Isso pode ter alto valor em contas maiores.

---

# 27. Histórico e audit log

A arquitetura já pode ter histórico de renovação.

Agora avaliar auditabilidade de:

- requirement criado;
- request enviado;
- documento submetido;
- documento rejeitado;
- aprovação;
- renovação;
- mudança de responsável;
- mudança de validade;
- escalation;
- notification delivery.

Não criar event sourcing sem necessidade.

---

# 28. Billing

Transforme o conceito futuro de billing em roadmap concreto.

NÃO implemente um billing engine do zero.

Projete integração com provider externo.

Precisamos conceitualmente de:

```text
Plan
Subscription
Entitlement
UsageQuota
BillingWebhookInbox
GracePeriod
Dunning
```

Avalie quais são realmente entidades internas.

Pricing deverá poder variar por:

- número de tracked subjects;
- número de active requirements;
- usuários;
- canais;
- features.

Não acople regras comerciais profundamente ao domínio central.

---

# 29. Entitlements

Avalie capacidade centralizada para verificar:

```text
canUseFeature()
limitFor()
remainingQuota()
```

Evite:

```text
if plan == "PRO"
```

espalhado pelo código.

Entitlements precisam permitir evolução dos planos sem grande refatoração.

---

# 30. WhatsApp

Se já estiver planejado, mantenha como evolução posterior.

Avalie especialmente seu papel em:

- alertas;
- chasing;
- document requests.

Considere:

- opt-in;
- templates;
- custos;
- Meta API;
- retries;
- delivery receipts;
- rate limits;
- fallback;
- preferencias.

Não torná-lo requisito para MVP inicial.

---

# 31. Entrada por e-mail

Avalie para fase posterior:

```text
docs+tenant@produto.com
```

ou outra estratégia segura.

Possíveis usos:

- encaminhar contrato;
- encaminhar certificado;
- encaminhar documento recebido.

Mas considere:

- spam;
- spoofing;
- malware;
- routing;
- parsing;
- duplicidade;
- LGPD;
- tenant identification.

Não priorize acima das capacidades P0.

---

# 32. API / Webhooks

Se já estiverem no roadmap, manter.

Possíveis eventos futuros:

```text
expiration.created
expiration.expiring
expiration.expired
document.requested
document.submitted
requirement.valid
requirement.expired
```

Mas não expor uma API pública prematuramente.

---

# 33. Funcionalidades que NÃO devem ser adicionadas agora

A menos que a análise do repositório ou evidência forte justifique, NÃO colocar como prioridade:

- BPMN/workflow builder;
- procurement;
- supplier risk scoring sofisticado;
- GRC completo;
- e-signature;
- CRM;
- ERP;
- marketplace;
- SSO enterprise imediato;
- app mobile nativo;
- white-label imediato;
- dezenas de integrações;
- due diligence;
- financial risk assessment;
- full contract lifecycle management.

Queremos impedir product creep.

---

# 34. Nova priorização sugerida

Considere inicialmente esta classificação, mas NÃO a aceite sem análise:

## P0

- TrackedSubject;
- CSV import;
- ExternalContact;
- Requirement;
- DocumentRequest;
- guest upload/magic link;
- automated chasing;
- billing mínimo comercial.

## P1

- escalation;
- múltiplos recipients;
- watchers;
- custom fields;
- digest;
- organization/membership;
- RBAC;
- compliance dashboard.

## P2

- WhatsApp;
- e-mail ingestion;
- API/webhooks;
- richer bulk operations;
- integrations.

Sua tarefa é confirmar, rejeitar ou reorganizar isso.

---

# 35. Revise a sequência dos milestones

A sequência conceitual sugerida após os milestones existentes é algo como:

```text
M7
Extraction / Human Confirmation

M8
Operational Hardening

M9
Commercial Domain Foundation
- TrackedSubject
- ExternalContact
- Custom Fields
- CSV Import/Export

M10
Requirement & Collection Workflow
- RequirementTemplate
- RequirementAssignment
- DocumentRequest
- Guest Upload
- Review/Approve/Reject

M11
Automation
- Automated Chasing
- Multiple Recipients
- Escalation
- Watchers
- Digest

M12
Commercial Accounts
- Organization
- Membership
- RBAC
- Billing
- Entitlements
- Quotas
```

MAS:

> não siga esses números cegamente.

Reorganize conforme dependências reais.

Talvez `Organization/Membership` precise vir antes de algumas capacidades.

Talvez `Requirement` precise preceder `ExternalContact`.

Talvez billing seja melhor colocado mais tarde.

Sua função é determinar a sequência tecnicamente correta.

---

# 36. Dependências

Para cada milestone novo, produza um DAG conceitual ou tabela:

| Capability | Depends on | Unlocks |
|---|---|---|

Exemplo:

```text
TrackedSubject
     ↓
RequirementAssignment
     ↓
DocumentRequest
     ↓
Guest Submission
     ↓
Automated Chasing
```

Evite milestones artificialmente independentes quando o domínio mostrar dependência forte.

---

# 37. ADRs

Identifique todas as decisões novas que merecem ADR.

Possíveis:

- introducing TrackedSubject;
- separating Requirement from ExpirationItem;
- guest token model;
- DocumentSubmission lifecycle;
- recipient fan-out model;
- custom fields strategy;
- billing/entitlement boundary;
- organization model;
- import architecture.

Não crie ADR para detalhes triviais.

---

# 38. DynamoDB / persistence review

Como o sistema usa DynamoDB, cada nova modelagem deve ser revisada em função dos access patterns.

Para cada entidade, responda:

> Quais são as consultas reais?

Exemplos:

```text
todos os subjects do tenant
todos os vencimentos de um subject
todos os requisitos de um subject
todos os requests pendentes
requests esperando resposta
documents submitted awaiting review
all items assigned to user
all items expiring in N days
```

Projete:

- PK/SK;
- GSIs;
- cardinalidade;
- hotspots;
- TTL;
- transactional writes;
- OCC;
- item sizes;
- pagination.

Não desenhe modelo relacional em cima de DynamoDB.

Mas também não sacrifique clareza de domínio apenas para economizar índices.

---

# 39. Eventos de domínio

Analise eventos que podem surgir naturalmente:

```text
RequirementAssigned
DocumentRequested
DocumentSubmitted
DocumentApproved
DocumentRejected
ExpirationRenewed
RequirementBecameValid
RequirementExpired
```

Não crie eventos apenas porque o sistema é event-driven.

Use apenas quando existir consumidor ou valor claro de desacoplamento/auditoria.

---

# 40. Segurança

Faça threat modeling específico para as novas features.

Principalmente:

### Guest links

- token theft;
- replay;
- brute-force;
- enumeration;
- cross-tenant access.

### Upload

- malware;
- oversized files;
- content-type spoofing;
- zip bombs;
- malicious PDFs.

### Contacts

- PII;
- enumeration;
- leakage.

### Import

- CSV injection;
- formula injection;
- oversized imports;
- parser attacks.

### Billing

- forged webhooks;
- replay;
- inconsistent subscription state.

### Multi-user

- privilege escalation;
- IDOR;
- tenant isolation.

Produza mitigação para cada risco relevante.

---

# 41. LGPD

Considere:

- minimização;
- purpose limitation;
- retention;
- deletion;
- export;
- access controls;
- auditability;
- documents containing personal data;
- external contacts;
- employees.

Mas não transforme a aplicação em projeto burocrático de compliance antes da hora.

Separe:

### obrigatório tecnicamente

de:

### melhoria futura.

---

# 42. Reliability

Especial atenção ao fato de que a promessa do produto é:

> “não deixar o vencimento passar despercebido.”

Portanto, reliability faz parte do produto.

Revise se os novos workflows preservam:

- idempotência;
- retries;
- DLQs;
- reconciliation;
- health checks;
- dead-letter alarms;
- notification observability;
- bounce handling;
- request state reconciliation.

---

# 43. Observabilidade

Cada novo fluxo importante deve possuir sinais úteis.

Exemplo:

```text
document_requests_created
document_requests_completed
document_requests_overdue
guest_upload_failures
document_submissions_rejected
requirements_missing
chasing_messages_sent
notification_escalations
import_rows_processed
import_rows_rejected
```

Não crie métricas sem uso.

Defina:

- metric;
- purpose;
- alarm?
- dashboard?
- SLO?

---

# 44. Test strategy

Para cada milestone, defina:

### Unit tests

Domínio e regras.

### Integration tests

DynamoDB, SQS, S3, SES, Step Functions etc.

### Contract tests

Quando existir boundary importante.

### Security tests

Cross-tenant, guest URLs, permissions.

### End-to-end

Fluxos críticos.

Exemplo E2E futuro:

```text
criar supplier
↓
aplicar requirement template
↓
request document
↓
guest upload
↓
malware clean
↓
extract
↓
approve
↓
expiration created
↓
reminder scheduled
```

Esse será um dos principais acceptance tests do produto.

---

# 45. Migration strategy

Se precisar alterar estruturas existentes:

- não quebrar dados;
- considerar dual-read/dual-write quando necessário;
- backfill;
- versionamento;
- migration tooling;
- rollback;
- feature flags.

Não fazer rewrite destrutivo do ambiente atual sem estratégia.

---

# 46. API contracts

Se novos endpoints forem necessários, defina-os em alto nível.

Exemplo:

```text
POST /subjects
POST /subjects/{id}/requirements
POST /document-requests
GET  /guest/requests/{token}
POST /guest/requests/{token}/uploads
POST /submissions/{id}/approve
POST /submissions/{id}/reject
```

Não aceite esses paths automaticamente.

Use a arquitetura/API style já adotada no projeto.

---

# 47. Não implemente frontend nesta tarefa

Frontend será tratado no momento oportuno.

Não use a ausência dele como problema arquitetural.

Entretanto:

- APIs;
- contracts;
- workflows;
- permissions;

devem deixar claro como frontend futuro interagirá com o sistema.

---

# 48. Pesquisa externa obrigatória

Antes de finalizar o roadmap, faça pesquisa atualizada na internet.

Pesquise pelo menos:

- Expiration Reminder;
- Remindax;
- Doc Warden;
- SubCompliant;
- VendorJot;
- TrustLayer;
- Certificial;
- ferramentas de vendor document tracking;
- compliance document tracking;
- expiration tracking;
- employee certification tracking.

Busque:

- features;
- pricing;
- plan differentiation;
- complaints;
- reviews;
- workflows;
- onboarding;
- bulk import;
- guest upload;
- escalation;
- dashboards.

Use a pesquisa para confirmar ou contestar este prompt.

Não copie features cegamente.

---

# 49. Procure evidências negativas

Tente refutar cada nova feature.

Exemplo:

> Custom fields realmente aumentam valor ou só adicionam complexidade?

> Requirement precisa existir como agregado?

> Guest upload poderia ser apenas presigned upload + request token?

> TrackedSubject precisa ser entidade ou simples metadata?

> Automated chasing poderia reutilizar Reminder Engine?

> Digests precisam estar no backend ou poderiam ser derivados?

Queremos decisões defendidas, não concordância automática.

---

# 50. Compare com a arquitetura atual

Para cada feature recomendada, produzir:

| Feature | Situação atual | Mudança | Impacto arquitetural | Valor comercial | Complexidade | Prioridade |
|---|---|---|---|---:|---:|---|

---

# 51. Score das funcionalidades

Dê nota 0–10 para:

- valor ao cliente;
- capacidade de aumentar ticket;
- impacto em retenção;
- impacto em aquisição;
- diferenciação;
- reutilização entre verticais;
- complexidade;
- risco;
- suporte;
- fit arquitetural.

Para:

**complexidade e risco: 10 = favorável/baixo.**

Calcule uma nota ponderada.

Dê peso maior a:

1. valor;
2. retenção;
3. ticket;
4. aquisição;
5. reutilização horizontal.

---

# 52. Roadmap resultante

Ao final, produza um roadmap revisado completo.

Formato:

```text
M0 ...
M1 ...
...
M7 ...
M8 ...
M9 ...
...
```

Para cada milestone:

## Objetivo

Por que existe.

## Business value

Que problema comercial resolve.

## Scope

O que implementar.

## Out of scope

O que deliberadamente não implementar.

## Domain changes

Entidades, value objects, aggregates, policies.

## Infrastructure changes

AWS/Terraform.

## API changes

Contratos.

## Security

Principais controles.

## Observability

Sinais.

## Tests

Tipos obrigatórios.

## Migration

Quando aplicável.

## Dependencies

Milestones/capabilities anteriores.

## Acceptance criteria

Critérios objetivos de conclusão.

---

# 53. Critérios de aceite devem ser concretos

Evite:

> “Sistema deve ser robusto.”

Prefira:

> “Um guest token expirado deve retornar 401/403 e nunca revelar se o requirement existe.”

Ou:

> “Reprocessar o mesmo DocumentSubmission não pode gerar dois ExpirationItems.”

Ou:

> “Um import contendo 1.000 linhas, sendo 20 inválidas, deve produzir relatório determinístico sem criar registros duplicados em retry.”

---

# 54. Definition of Done

Cada milestone deve exigir, quando aplicável:

- código;
- unit tests;
- integration tests;
- Terraform;
- IAM;
- observability;
- dashboards;
- alarms;
- documentation;
- ADR;
- threat-model update;
- cost-model update;
- CI;
- deployment dev;
- smoke test;
- rollback validation.

Adapte ao caso.

---

# 55. Engenharia de contexto

Atualize a documentação necessária para que futuras sessões de IA entendam:

- estado real do roadmap;
- decisões novas;
- invariantes;
- padrões;
- próximos milestones;
- armadilhas;
- decisões explicitamente rejeitadas.

Revise arquivos como:

- README;
- architecture docs;
- requirements;
- ADRs;
- roadmap;
- NEXT_SESSION_PROMPT;
- engineering docs;

ou equivalentes existentes.

Não deixe informação contraditória entre arquivos.

---

# 56. Processo de revisão adversarial

Se Codex ou outro agente revisor estiver disponível, use processo adversarial.

A IA principal atuará como:

> Principal Engineer / Architecture Owner.

O revisor atuará como:

> skeptical Staff/Principal Engineer.

Faça pelo menos três rodadas para decisões arquiteturais relevantes.

O revisor deve procurar:

- overengineering;
- underengineering;
- domínio mal modelado;
- acoplamento;
- duplication;
- security gaps;
- scalability traps;
- DynamoDB anti-patterns;
- reliability problems;
- migration risk;
- product creep.

Não aceite objeções automaticamente.

Faça réplica técnica.

Registre:

- crítica;
- resposta;
- decisão.

---

# 57. Não implemente imediatamente todo o roadmap

Nesta tarefa, o objetivo principal é:

> **integrar corretamente essas capacidades ao roadmap e à arquitetura.**

Você pode fazer pequenos ajustes/documentação necessários para tornar o roadmap coerente.

Mas NÃO comece automaticamente a implementar todos os milestones novos.

Primeiro precisamos terminar:

- análise;
- arquitetura;
- sequencing;
- requirements;
- ADRs;
- roadmap.

A implementação ocorrerá milestone por milestone.

---

# 58. Entregáveis obrigatórios

Ao terminar, quero:

## A. Executive summary

O que mudou e por quê.

## B. Current state

Estado real do projeto.

## C. Gap analysis

O que falta para a nova visão.

## D. Feature score

Tabela completa.

## E. Domain model proposal

Antes/depois.

## F. Architecture impact

Mudanças necessárias.

## G. Revised roadmap

Milestone por milestone.

## H. Dependency graph

Ordem correta.

## I. ADR list

Novas decisões necessárias.

## J. Security impact

Threats e controles.

## K. Persistence impact

DynamoDB/access patterns/indexes.

## L. Cost impact

Mudanças esperadas no cost model.

## M. Testing strategy

Por milestone.

## N. Migration strategy

Quando aplicável.

## O. Documentation updates

Arquivos alterados.

## P. Open questions

Somente questões realmente ainda não resolvíveis.

## Q. Rejected ideas

Funcionalidades que deliberadamente não devem entrar agora.

---

# 59. Perguntas obrigatórias que devem ser respondidas

1. `TrackedSubject` deve realmente existir como entidade?
2. Qual nome de domínio é melhor?
3. `Requirement` deve ser agregado próprio?
4. `RequirementTemplate` é necessário inicialmente?
5. `RequirementAssignment` deve persistir status ou derivá-lo?
6. `ExternalContact` merece entidade própria?
7. Como relacionar contatos a requirements?
8. Como modelar `DocumentRequest`?
9. Como modelar guest access?
10. Precisamos de `DocumentSubmission`?
11. O pipeline atual de upload precisa ser generalizado?
12. M7 precisa ser ajustado para processamento document-centric?
13. Como criar/renovar `ExpirationItem` após confirmação?
14. Como evitar duplicidade em retries?
15. Como implementar automated chasing reutilizando o Reminder Engine?
16. Como modelar múltiplos recipients?
17. Cada destinatário deve gerar intent separado?
18. Como fazer escalation?
19. Watchers são necessários?
20. Digest é necessário?
21. Custom fields são necessários?
22. Em quais entidades?
23. CSV deve vir antes de XLSX?
24. Como garantir import idempotente?
25. Organization/Membership deve ser antecipado?
26. Qual RBAC mínimo?
27. Billing deve entrar antes ou depois dos workflows?
28. Como estruturar entitlements?
29. Como impedir product creep?
30. Qual sequência ideal de milestones?
31. Que partes existentes precisam ser refatoradas?
32. Quais partes devem permanecer exatamente como estão?

---

# 60. Regra de decisão

Quando houver conflito entre:

```text
arquitetura atual
```

e:

```text
uma arquitetura nova comprovadamente melhor
```

escolha a melhor arquitetura.

Quando houver conflito entre:

```text
feature tecnicamente interessante
```

e:

```text
feature com valor comercial real
```

priorize valor comercial.

Quando houver conflito entre:

```text
velocidade
```

e:

```text
correção de um componente crítico de confiabilidade/segurança
```

priorize correção.

Quando houver conflito entre:

```text
enterprise flexibility
```

e:

```text
simplicidade suficiente para os primeiros 10–30 clientes
```

priorize simplicidade.

---

# 61. Visão final desejada

O produto deve conseguir evoluir naturalmente para algo como:

```text
Empresa
   ↓
Fornecedores / funcionários / equipamentos
   ↓
Requisitos
   ↓
Documentos
   ↓
Vencimentos
   ↓
Alertas
   ↓
Solicitações
   ↓
Upload pelo terceiro
   ↓
Validação
   ↓
Renovação
   ↓
Histórico
```

Sem deixar de ser:

- simples;
- confiável;
- barato;
- modular;
- automatizado;
- operável por uma equipe mínima.

---

# 62. North Star arquitetural

A arquitetura deve permitir que este fluxo seja eventualmente verdadeiro:

```text
Requirement está prestes a vencer
        ↓
sistema identifica contato responsável
        ↓
cria DocumentRequest idempotente
        ↓
envia solicitação
        ↓
terceiro acessa magic link
        ↓
envia PDF
        ↓
malware pipeline
        ↓
extração OCR/IA
        ↓
confidence evaluation
        ↓
humano confirma
        ↓
documento aprovado
        ↓
ExpirationItem renovado
        ↓
Requirement fica válido
        ↓
novo ciclo de reminder é criado
        ↓
todo processo permanece auditável
```

Esse workflow deve ser possível **sem hacks no domínio**.

---

# 63. Resultado esperado

Não quero apenas uma lista de novas features.

Quero que você transforme essas descobertas em:

> **uma evolução arquitetural coerente e um roadmap executável no mesmo padrão de excelência de engenharia que já está sendo aplicado ao Expiration Tracker.**

Se descobrir que alguma premissa deste prompt está errada:

**corrija-a.**

Se uma feature não agrega valor suficiente:

**rejeite-a.**

Se uma abstração existente já resolve o problema:

**reutilize-a.**

Se uma abstração atual dificultará significativamente a evolução:

**proponha a refatoração.**

Se houver uma solução melhor do que a sugerida neste prompt:

**adote-a e justifique.**

A meta não é obedecer ao prompt.

A meta é deixar o Expiration Tracker com **o melhor roadmap técnico e comercial possível para se tornar um micro-SaaS pequeno, confiável, recorrente e lucrativo.**