# Expiration Tracker — Revisão Estrutural de Multi-User B2B

**Data:** 2026-08-29  
**Branch analisada:** `develop`  
**Natureza:** análise estratégica + arquitetural + plano recomendado  
**Status:** `APPROVED` (qualidade técnica) via protocolo Claude↔Codex — 3 rodadas reais, Claude 9,2/10, Codex 9,2/10, ambos ≥9,0 (ver §125 para o registro completo). **A decisão de TIMING ("fazer agora" vs. manter o gatilho comercial de `roadmap-evolution/05`, primeira venda B2B) permanece integralmente reservada ao Marcelo (`AGENTS.md` §1) — o protocolo aprovou a qualidade técnica do design assumindo implementação futura, nunca decidiu quando implementar.** Não implementar sem essa decisão explícita do Marcelo.

---

# 1. Premissa estratégica atualizada

O Expiration Tracker está em fase de desenvolvimento e descoberta do produto.

Neste momento:

- não existe pressão de lançamento;
- não existem usuários de produção que exijam compatibilidade histórica;
- mudanças estruturais grandes são aceitáveis;
- refatorações profundas são desejáveis quando removem dívida futura;
- a arquitetura deve ser preparada para crescimento;
- o produto não precisa ser deliberadamente mínimo;
- funcionalidades plausivelmente necessárias não devem ser adiadas apenas porque dão trabalho;
- overengineering significa criar complexidade sem benefício plausível, e não evitar trabalho arquitetural importante.

Portanto, para Multi-User B2B, a estratégia recomendada muda.

Não devemos otimizar a implementação para preservar a convenção histórica:

```text
tenantId = userId
```

apenas para reduzir esforço imediato.

A recomendação passa a ser:

> **fazer agora um cutover estrutural limpo no qual User e Organization possuam identidades independentes e Organization seja definitivamente o boundary de tenancy.**

---

# 2. Conclusão executiva

A evolução Multi-User B2B deve ser tratada como uma **reformulação do modelo de identidade e tenancy**, não como uma simples feature de "adicionar usuários".

Modelo atual:

```text
Cognito identity
      ↓
IdentityMapping
      ↓
User
      ↓
tenantId = userId
      ↓
dados
```

Modelo recomendado:

```text
Cognito identity
      ↓
IdentityMapping
      ↓
UserAccount
      ↓
Membership
      ↓
Organization
      ↓
tenantId = Organization.id
      ↓
dados
```

Invariantes futuras:

```text
User != Tenant

Organization = Tenant

Membership = vínculo de autorização

tenantId = organizationId

userId != tenantId por construção normal
```

A igualdade entre IDs não deve ser mantida como mecanismo de compatibilidade.

Ela deve desaparecer como premissa do sistema.

---

# 3. O repositório já preparou parte dessa evolução

O modelo de dados atual já declara explicitamente:

```text
MVP: tenantId = userId
futuro: tenantId = organizationId
```

e já inclui conceitualmente:

```text
Organization
User
Membership
```

no agregado `Tenant/Access`.

Isso demonstra que a evolução B2B não é uma mudança arbitrária de direção.

Ela já era um target arquitetural previsto.

Entretanto, a implementação e partes do modelo físico ainda refletem a simplificação inicial.

---

# 4. Achados importantes no modelo atual

## 4.1 `User` ainda é tenant-scoped

O modelo físico vigente descreve:

```text
User
PK = TENANT#t#USER#u
SK = PROFILE
```

Isso funciona enquanto:

```text
tenantId = userId
```

Mas deixa de representar corretamente:

```text
U1 pertence a O1
U1 pertence a O2
```

No novo modelo, uma identidade humana deve sobreviver independentemente da Organization.

Portanto:

> **User precisa deixar de ser tenant-owned.**

---

# 5. `IdentityMapping` também precisa mudar

Hoje o design possui:

```text
IdentityMapping
  cognitoSub
  userId
  tenantId
```

Isso é incompatível com multi-organization.

Uma identidade global não possui um tenant único.

O novo contrato deve ser:

```text
IdentityMapping
  externalIdentity
  userId
```

ou equivalente.

A seleção de Organization não pertence ao IdentityMapping.

---

# 6. O GSI de Membership por usuário precisa ser redesenhado

O modelo atual prevê:

```text
GSI4
PK = TENANT#t#USER#u
SK = ORG#o#MEMBERSHIP#m
```

Esse access pattern pressupõe que já conhecemos o tenant.

Mas no modelo multi-org o primeiro problema depois do login é justamente descobrir:

```text
quais Organizations este User pode acessar?
```

Logo, o novo índice deve ser global por usuário.

Conceitualmente:

```text
GSI MembershipByUser

PK = USER#<userId>
SK = ORG#<organizationId>#MEMBERSHIP#<membershipId>
```

ou representação equivalente compatível com as convenções do single-table.

Esse é um exemplo concreto de por que o M13 precisa revisar o modelo de dados, e não apenas adicionar código.

---

# 7. `ItemWatch` já antecipa multi-user

O modelo atual possui:

```text
ItemWatch
  itemId
  userId
```

dentro de uma partição tenant-scoped.

Isso é um sinal positivo.

Ele já separa:

```text
tenant
```

de:

```text
usuário interessado naquele item
```

Esse padrão deve continuar.

Após o cutover:

```text
tenantId = organizationId
userId = membro global
```

---

# 8. AuditEvent também já está bem preparado

`AuditEvent` possui conceito de ator.

No novo modelo, cada evento humano relevante deve poder responder:

```text
qual tenant foi afetado?
quem agiu?
com qual autorização?
```

Portanto o contexto recomendado é:

```text
tenantId
actorUserId
actorRole / permission snapshot quando relevante
correlationId
causationId
```

Não misturar ator e tenant.

---

# 9. GuestTokenPointer também se adapta bem

O modelo atual já possui uma exceção tenantless:

```text
GuestTokenPointer
    ↓
tenantId
subjectId
assignmentId
documentRequestId
```

Esse mecanismo continua válido.

A única mudança semântica é:

```text
tenantId
=
Organization.id
```

O guest não precisa possuir Membership.

A autorização já está incorporada na capability específica do guest.

---

# 10. Full BFF é uma base excelente para Multi-User

O projeto implementou um Full BFF com:

- sessão server-side;
- cookie opaco HttpOnly;
- refresh token rotation;
- OCC/CAS;
- revocation;
- idle TTL;
- absolute TTL;
- CSRF;
- logout;
- logoutAll;
- proteção contra session resurrection.

Essa arquitetura permite implementar Organization switching sem colocar autorização no browser.

---

# 11. Active Organization deve ficar na sessão BFF

Recomendação:

```text
BFF Session
  userId
  activeOrganizationId
  ...
```

ou:

```text
activeTenantId
```

se o projeto preferir preservar o termo técnico.

Não armazenar essa preferência em:

```text
IdentityMapping
```

porque:

```text
mesmo User
sessão A → O1
sessão B → O2
```

é uma situação válida.

O IdentityMapping deve continuar estável.

---

# 12. Seleção não é autorização

Mesmo que o BFF mantenha:

```text
activeOrganizationId = O1
```

o backend deve validar:

```text
User
+
Organization
+
Membership
+
role/permission
+
TenantLifecycle
```

antes de produzir o `RequestContext`.

Nunca confiar apenas em:

- browser;
- header;
- session value;
- organizationId enviado pelo cliente.

---

# 13. API tenant-scoped

Uma abordagem limpa é utilizar um selection hint como:

```text
X-Organization-Id
```

ou contrato equivalente.

No browser:

```text
BFF
→ lê activeOrganization da sessão
→ adiciona selection hint
→ API
```

Na API:

```text
JWT identity
↓
IdentityMapping
↓
User
↓
Membership(user, organization)
↓
Organization
↓
TenantLifecycle
↓
RequestContext
```

Mesmo uma chamada direta com Bearer token continua segura.

---

# 14. RequestContext futuro

O contexto deve separar explicitamente:

```text
userId
tenantId
role
```

e, se necessário:

```text
membershipId
permissions
```

Conceitualmente:

```ts
{
  userId: "usr_...",
  tenantId: "org_...",
  membershipId: "mem_...",
  role: "ADMIN"
}
```

O código não deve derivar um campo do outro.

---

# 15. IDs independentes desde já

Recomendação:

```text
User.id         = UUIDv7/ULID
Organization.id = UUIDv7/ULID
Membership.id   = UUIDv7/ULID
```

ou equivalente segundo a convenção já adotada.

Não fazer:

```text
Organization.id = ownerUserId
```

nem para os dados atuais de `dev`, salvo se uma evidência técnica concreta mostrar necessidade.

A arquitetura deve provar sistematicamente:

```text
userId != tenantId
```

---

# 16. Organização como boundary permanente

O `tenantId` continua sendo um excelente identificador técnico.

Não é necessário substituir toda variável interna por:

```text
organizationId
```

A semântica recomendada é:

```text
tenantId
= technical isolation boundary

Organization.id
= value used as tenantId
```

Isso preserva:

- genericidade;
- isolamento;
- patterns existentes;
- S3;
- idempotência;
- outbox;
- quotas.

Externamente, a UX/API pode utilizar "Organization".

---

# 17. Novo modelo de `User`

A entidade atual mistura conceitos que precisam ser reavaliados.

Novo princípio:

> **User é global.**

Ela pode conter:

```text
userId
emailNormalized
name
locale
timezone default
identity/account status
createdAt
updatedAt
version
```

Avaliar cuidadosamente quais preferências atuais realmente são globais.

Preferências específicas da Organization não devem ser colocadas no User global apenas por conveniência.

---

# 18. Membership

Modelo mínimo recomendado:

```text
Membership
  membershipId
  organizationId
  userId
  role
  status
  joinedAt
  createdBy
  version
```

Possíveis estados:

```text
ACTIVE
SUSPENDED
```

Remoção pode seguir a disciplina de lifecycle/retention do projeto.

Invitation não deve ser representado como Membership pendente.

---

# 19. Invitation como entidade própria

Modelo recomendado:

```text
Invitation
  invitationId
  organizationId
  emailNormalized
  role
  status
  tokenDigest / pointer
  expiresAt
  createdBy
  createdAt
  acceptedAt?
  revokedAt?
  version
```

Estados:

```text
PENDING
ACCEPTED
REVOKED
EXPIRED
```

---

# 20. Token de Invitation

Seguir os padrões já maduros de guest/BFF:

```text
token opaco
alta entropia
secret nunca persistido puro
HMAC/hash no storage
TTL
one-time consumption
rate limiting
anti-enumeration
```

Uma opção robusta é usar:

```text
InvitationTokenPointer
```

tenantless, análogo conceitualmente a:

```text
GuestTokenPointer
```

para resolver o tenant depois de validar o token.

Não reutilizar a entidade GuestTokenPointer diretamente.

---

# 21. Aceitação de Invitation

Fluxo recomendado:

```text
invite link
↓
login/signup
↓
Cognito confirma identidade
↓
e-mail verificado
↓
e-mail == invitation.email
↓
TransactWrite
    consume Invitation
    create Membership
    audit/outbox quando necessário
↓
Organization disponível
```

O bearer token do convite não deve sozinho criar uma sessão autorizada.

---

# 22. Onboarding precisa deixar de criar tenant silenciosamente

A descoberta do W3-07 mostrou que reprovisionamento automático no login é perigoso.

No novo modelo:

```text
autenticação
```

não deve equivaler a:

```text
criar tenant automaticamente
```

Recomendação:

```text
primeiro login
↓
criar/resolver User global
↓
listar Memberships
```

Se existe Invitation:

```text
accept invitation
```

Se não existe Membership:

```text
onboarding explícito
→ "Criar organização"
```

---

# 23. Organization creation explícita

Criar Organization deve ser uma operação intencional.

Transação conceitual:

```text
Organization
+
Membership OWNER
+
TenantLifecycleRecord(ACTIVE)
+
TenantEntitlement defaults
+
outros registros obrigatórios mínimos
```

Tudo atomicamente quando tecnicamente possível.

Não criar Organization simplesmente porque o usuário voltou a autenticar.

---

# 24. Multi-organization deve funcionar de verdade desde o início

Não modelar:

```text
User.organizationId
```

como relação única.

Suportar:

```text
U1
├── OWNER O1
├── ADMIN O2
└── VIEWER O3
```

desde o modelo inicial.

Mesmo que um usuário típico possua apenas uma Organization, N:N é a relação correta.

---

# 25. Self-service de criação de Organizations

Com a estratégia atual de não limitar artificialmente o produto, é razoável que a arquitetura suporte:

```text
Create Organization
```

para um usuário autenticado.

A política comercial pode posteriormente limitar:

```text
MAX_ORGANIZATIONS_PER_USER
```

via entitlement.

Não hardcode:

```text
user can only ever have one organization
```

---

# 26. Roles recomendadas

Com a nova premissa, a recomendação é implementar:

```text
OWNER
ADMIN
MEMBER
VIEWER
```

`ADMIN` é simples, comum em B2B e evita uma limitação previsível.

Não implementar:

- custom roles;
- policy builder;
- ABAC;
- OPA;
- Cedar;
- IAM-like policies.

---

# 27. Múltiplos OWNERs

Também é recomendável permitir múltiplos OWNERs.

Isso evita:

- single point of account ownership;
- lockout organizacional;
- necessidade imediata de workflow formal de transferência.

Invariante:

> **uma Organization ativa deve possuir pelo menos um OWNER ativo.**

Operações proibidas:

```text
remover o último OWNER
demover o último OWNER
último OWNER sair da organização
```

Promover outro usuário a OWNER antes torna a operação válida.

---

# 28. Permission-based authorization

Apesar de existirem roles, o código de domínio não deve ficar cheio de:

```ts
if (role === "OWNER")
```

Criar uma matriz central de permissions.

Exemplo conceitual:

```text
organization.read
organization.update
organization.delete

membership.read
membership.invite
membership.updateRole
membership.remove

expiration.read
expiration.write
expiration.delete
expiration.renew

document.read
document.write
document.delete

subject.read
subject.write

requirement.read
requirement.write

import.read
import.execute

audit.read
```

Roles apenas agregam permissions.

---

# 29. Exemplo de matriz

## OWNER

```text
todas as operações normais
organization.update
organization.delete
membership.*
audit.read
```

## ADMIN

```text
operações normais
organization.update limitada
membership.invite
membership.updateRole para MEMBER/VIEWER
membership.remove MEMBER/VIEWER
audit.read quando apropriado
```

ADMIN não deve remover/demover OWNER por padrão.

## MEMBER

```text
operações normais do produto
sem administração da Organization
```

## VIEWER

```text
read-only
```

A matriz final precisa ser derivada das actions reais do código.

---

# 30. Default deny

Toda permission não explicitamente concedida deve resultar em:

```text
DENY
```

Não usar:

```text
"qualquer role desconhecida é MEMBER"
```

nem fallback permissivo.

---

# 31. Membership validation em cada request

No primeiro release, a recomendação é:

> **validar Membership no backend para cada request tenant-scoped.**

O custo é pequeno para o estágio atual e a semântica é excelente.

Benefícios:

```text
role change
→ próximo request já usa nova role

membership removal
→ próximo request negado
```

Não introduzir cache antes de haver necessidade.

---

# 32. Revogação de Membership

Contrato esperado:

```text
OWNER remove U2 from O1
↓
próximo request de U2 para O1
→ DENY
```

Mas:

```text
U2 continua autenticado
```

se ainda possuir acesso a outra Organization.

Não usar logout global como mecanismo de RBAC.

---

# 33. Active Organization no BFF

Regras:

## Uma Membership

```text
auto-select
```

## Várias Memberships

```text
usar última seleção válida
ou
pedir seleção
```

## Zero Memberships

```text
onboarding / invitation
```

---

# 34. Organization switching

Implementar operação explícita.

Exemplo:

```text
POST /bff/organization/select
```

ou equivalente.

A operação deve:

```text
validar Membership
validar TenantLifecycle
CAS/OCC na Session
gravar activeOrganizationId
```

Uma Organization `DELETING` ou `DELETED` nunca pode ser selecionada.

---

# 35. TanStack Query — risco importante no frontend

Organization switching cria risco real de vazamento de cache.

Query cache de:

```text
O1
```

não pode aparecer enquanto:

```text
O2
```

está ativa.

Todos os query keys tenant-scoped devem incluir:

```text
organizationId / tenantId
```

ou a mudança de Organization deve invalidar/remover completamente os caches tenant-scoped.

O mesmo vale para:

- optimistic updates;
- mutation cache;
- prefetch;
- cached details;
- stale route data.

Esse ponto deve receber testes próprios.

---

# 36. UI mínima necessária

Implementar:

```text
Organization onboarding
Organization switcher
Organization settings
Members list
Invite member
Pending invitations
Change role
Remove member
Leave organization
Accept invitation
Membership revoked / no access state
```

Não criar outro "admin console" separado sem necessidade.

Reusar o Design System.

---

# 37. Organization

Modelo inicial razoavelmente completo, mas simples:

```text
organizationId
displayName
timezone
defaultQuietHours?
createdAt
updatedAt
version
```

Status de lifecycle deve continuar vindo do `TenantLifecycleRecord`, salvo decisão contrária aprovada.

Evitar duplicar:

```text
Organization.status
vs
TenantLifecycleRecord.status
```

sem necessidade.

---

# 38. Guest Trust deve migrar para Organization

Hoje GTR-01 utiliza `UserProfile.requesterDisplayName`.

No modelo B2B, o guest deve normalmente enxergar:

```text
Organization.displayName
```

e não o nome pessoal de quem criou a request.

O nome do ator pode continuar auditado internamente.

---

# 39. Expiration responsável

`ExpirationItem` já possui conceito de responsável.

Multi-user torna desejável diferenciar:

```text
responsável interno
```

de:

```text
texto livre / responsável externo
```

A arquitetura deve avaliar introduzir algo como:

```text
responsibleUserId?
```

validado contra Membership ativa daquela Organization.

Não usar MembershipId como identidade humana se `userId` for a identidade estável desejada.

---

# 40. Notifications para responsáveis

Ao vincular um membro como responsável:

```text
ExpirationItem
→ responsibleUserId
```

a entrega de notificações pode resolver:

```text
User
+
active Membership
+
Channel/preferences
```

antes de criar `NotificationIntent`.

Se o membro for removido:

```text
não continuar enviando notificações pessoais
```

sem política explícita.

Definir fallback:

- owner;
- outro responsável;
- aviso de configuração incompleta;
- nenhuma entrega + alerta operacional.

A decisão precisa seguir Epistemic Integrity.

---

# 41. ItemWatch

`ItemWatch` já possui `userId`.

Após multi-user:

```text
watcher precisa ter Membership válida no tenant
```

Criar watch:

```text
membership authorization
+
tenantId = organizationId
```

Quando Membership for removida, watches daquele usuário devem ser:

- removidos;
- desativados;
- ou ignorados deterministicamente.

Escolher uma política explícita.

---

# 42. User preferences

Separar:

## Globais

Exemplos:

```text
locale
timezone default
nome
```

## Tenant-specific

Exemplos possíveis:

```text
notification preferences
role-related preferences
tenant-specific UI preferences
```

Não decidir automaticamente que tudo pertence ao User global.

Fazer inventário real do modelo atual.

---

# 43. Consequência para o W3-07

O W3-07 precisa de uma revisão formal, porque foi concebido inicialmente enquanto:

```text
tenant == user
```

A propriedade principal permanece:

```text
ACTIVE → DELETING
→ nenhuma nova admissão de trabalho
```

Mas agora:

```text
TenantLifecycleRecord
=
Organization lifecycle
```

---

# 44. Organization deletion ≠ User deletion

Essa distinção deve virar invariante formal.

## Organization deletion

Apaga/reconcilia:

```text
dados tenant-scoped
memberships
invitations
documentos
expiration data
subjects
requirements
quotas/entitlements
tenant-specific settings
```

segundo políticas de retenção.

## User deletion

É uma operação distinta que precisa considerar:

```text
global account
memberships em várias Organizations
audit/legal evidence
ownership
personal data
```

Não misturar as duas.

---

# 45. BFF session não é mais tenant-owned

Esse é um dos maiores impactos no W3-07.

No novo modelo:

```text
BFF Session
→ User
```

e apenas contém uma seleção:

```text
activeOrganizationId
```

Se O1 for apagada:

```text
session não precisa ser destruída
```

Se U1 ainda pertence a O2:

```text
U1 continua autenticado
→ seleciona O2
```

Portanto o purge de Organization não deve apagar indiscriminadamente toda sessão daquele User.

---

# 46. Session com Organization deletada

Se:

```text
session.activeOrganizationId = O1
```

e O1 fica `DELETING`:

no próximo request:

```text
membership/lifecycle validation
→ fail closed
```

A sessão pode limpar a seleção e retornar estado equivalente a:

```text
ORGANIZATION_UNAVAILABLE
```

sem encerrar a identidade global.

---

# 47. Upload URLs e Membership revocation

Uma URL presigned já emitida é uma capability portátil.

Membership removida depois da emissão não revoga magicamente a URL.

A arquitetura precisa declarar o contrato.

Opção recomendada:

> **a emissão da URL é o admission point daquela operação.**

Se a operação foi admitida enquanto o usuário possuía permission:

```text
pode concluir dentro do TTL
```

Isso é consistente com o contrato de concorrência do W3-07.

Não prometer revogação instantânea de uma capability impossível de revogar.

---

# 48. Melhorias opcionais para uploads

Mesmo aceitando admission semantics, é válido incluir no UploadSlot:

```text
actorUserId
admittedAt
```

para auditoria.

Se houver necessidade futura de revogação mais forte, o finalizer poderá avaliar estado de membership/policy.

Não criar essa complexidade apenas por especulação.

---

# 49. Async workers

Workers não precisam consultar Membership para cada etapa.

A autorização humana ocorre no admission point.

Depois:

```text
tenantId
+
lifecycle
+
idempotency
```

governam o workflow.

Exemplo:

```text
U2 MEMBER O1
↓
admite extração
↓
async worker recebe tenantId=O1
```

Se U2 perder Membership depois, o workflow já admitido segue a política de admission existente.

---

# 50. Actor em eventos assíncronos

Quando útil para auditoria, eventos podem carregar:

```text
actorUserId
```

como contexto histórico.

Mas o worker não deve tratar esse `actorUserId` como autoridade atual.

Autoridade da operação já foi decidida na admissão.

---

# 51. TenantLifecycle + Membership são controles diferentes

Uma mutation humana precisa passar por duas dimensões:

```text
Membership authorization
→ QUEM pode?

TenantLifecycle
→ O TENANT ainda pode receber trabalho?
```

Fluxo conceitual:

```text
authenticated User
↓
Membership + permission
↓
TenantLifecycle ACTIVE
↓
TenantBusinessMutation
↓
commit
```

Não fundir esses conceitos.

---

# 52. SystemMutation não é atalho para admin

Se W3-07 possui lanes como:

```text
TenantBusinessMutation
SystemMutation
```

ações humanas como:

```text
invite member
change role
rename Organization
```

não devem usar `SystemMutation`.

`SystemMutation` continua reservado para:

```text
lifecycle
purge
system bookkeeping
```

---

# 53. Entitlements

`TenantEntitlement` já é tenant-scoped.

Isso continua correto:

```text
tenantId = Organization.id
```

Não migrar quota para usuário.

---

# 54. Member limits

Pode existir uma capability:

```text
MAX_MEMBERS
```

ou equivalente.

Não hardcode:

```text
if plan === "premium"
```

O valor comercial pode ser decidido posteriormente.

---

# 55. Billing não precisa entrar agora

Apesar de Multi-User ficar completo, não é necessário implementar:

- Stripe;
- Mercado Pago;
- cobrança por assento;
- invoices automáticos.

O modelo deve ser compatível, mas billing continua capability separada.

---

# 56. Seat billing não deve virar arquitetura central

O roadmap já prioriza `TrackedSubject` como unidade comercial importante.

Multi-user não deve automaticamente transformar:

```text
seat count
```

na métrica principal do produto.

---

# 57. SSO/SCIM continuam adiáveis

Não implementar agora:

```text
SAML
enterprise SSO
SCIM
domain auto-join
JIT enterprise provisioning
```

Isso é facilmente adicionável no futuro porque a nova arquitetura já separará:

```text
external identity
User
Membership
Organization
```

Essa separação é justamente o que torna essas features futuras menos traumáticas.

---

# 58. Custom roles continuam adiáveis

Ao construir authorization por permissions agora:

```text
OWNER / ADMIN / MEMBER / VIEWER
→ permission sets
```

fica fácil introduzir custom roles no futuro.

Não há necessidade de criar policy engine hoje.

---

# 59. Single-table design precisa de revisão Type 1

Novos access patterns:

```text
User by id
Organizations for User
Members for Organization
Membership by User+Organization
Invitation by token
Invitations for Organization
Invitation by normalized email quando necessário
```

precisam ser formalmente adicionados ao data model.

A própria governança atual exige revisão explícita de todo novo access pattern.

---

# 60. Proposta conceitual de physical model

Não copiar cegamente.

## Global User

```text
PK = USER#<userId>
SK = PROFILE
```

## IdentityMapping

```text
PK = IDENTITY#COGNITO#<sub>
SK = MAP
→ userId
```

## Organization

```text
PK = TENANT#<organizationId>#ORG#<organizationId>
SK = META
```

ou forma equivalente consistente com os builders atuais.

## Membership org-side

```text
PK = TENANT#<organizationId>#ORG#<organizationId>
SK = MEMBER#<userId>
```

## MembershipByUser GSI

```text
GSI_PK = USER#<userId>
GSI_SK = ORG#<organizationId>
```

## Invitation

```text
tenant-scoped record
+
tenantless secure token pointer
```

O design final deve passar por Claude↔Codex.

---

# 61. IAM do GSI de Membership

Como `MembershipByUser` cruza tenants, seu IAM precisa ser tratado com cuidado.

Ele deve ser acessível somente por componentes que realmente precisam descobrir Organizations de um User:

- BFF/session context;
- identity/request context;
- talvez onboarding.

Não expor esse GSI como query tenant-facing genérica.

---

# 62. Migração — nova recomendação

Como ainda não existem usuários reais, evitar:

```text
dual write permanente
dual read
compatibility fallback duradouro
Organization.id = legacy userId
```

A estratégia preferida é:

```text
new schema
↓
controlled cutover
↓
dev data migration ou reset
↓
remove old semantics
```

---

# 63. Dados atuais de dev

Antes de migrar, classificar:

```text
synthetic/disposable
valuable test evidence
required persistent dev fixture
```

Se todos os dados forem sintéticos:

> **preferir reset/reseed do ambiente `dev`.**

Isso é mais limpo que desenvolver infraestrutura de migração para dados sem valor.

---

# 64. Se dados de dev precisarem ser preservados

Criar uma ferramenta one-shot:

```text
idempotent
restartable
dry-run
observable
```

Mas essa ferramenta não deve introduzir fallback permanente no runtime.

Após o cutover:

```text
nenhum código produtivo entende tenantId=userId
```

---

# 65. Migração de dados tenant-scoped

Se necessária:

```text
old tenantId = userId
↓
generate new organizationId
↓
rewrite DynamoDB tenant keys
↓
rewrite embedded tenantId
↓
rebuild GSIs
↓
move/copy S3 tenant prefixes
↓
rewrite object references
↓
verify
↓
delete old physical state
```

Tudo offline/controlado enquanto não existem clientes.

---

# 66. Dados efêmeros não precisam ser migrados cegamente

Classificar:

```text
BFF sessions
outbox pending
idempotency records
temporary OCR
upload slots
SQS/DLQ
temporary imports
```

Para ambiente sem usuários reais, muitas dessas classes podem ser:

```text
drained
invalidated
purged
regenerated
```

em vez de migradas.

Documentar a decisão.

---

# 67. BFF sessions durante o cutover

Como não existem sessões de clientes reais:

```text
invalidar todas
```

pode ser preferível a escrever uma migração complicada.

Depois do cutover, todas as sessões novas usam o modelo correto.

---

# 68. S3

A nova convenção deve permanecer:

```text
tenant/<organizationId>/...
```

Objetos atuais de dev podem ser:

- migrados;
- ou descartados/reseeded;

conforme valor real.

Não manter prefixos semanticamente associados a userId.

---

# 69. Idempotency

Após o cutover:

```text
idempotency key
→ usa organization tenantId
```

Não incluir `userId` só porque existem múltiplos usuários.

Idempotência é do efeito de negócio dentro da Organization, salvo operações explicitamente pessoais.

---

# 70. Outbox

Eventos continuam com:

```text
tenantId = organizationId
```

e podem adicionar:

```text
actorUserId
```

quando relevante.

Consumidores não resolvem Membership.

---

# 71. Threat model específico obrigatório

O design Multi-User deve adicionar cenários para:

- organization header spoof;
- IDOR cross-tenant;
- stale Membership;
- stale role;
- BFF org-switch race;
- query cache cross-org;
- invitation theft;
- invitation replay;
- invitation email mismatch;
- last-owner removal;
- confused deputy em BFF/API;
- guest token cross-org;
- presigned URL pós-revogação;
- async work pós-revogação;
- Organization deletion com User multi-org;
- global User data leakage;
- Membership GSI leakage;
- role escalation;
- mass assignment de role/organizationId.

---

# 72. Teste estrutural fundamental

A suite precisa deixar de usar por padrão fixtures como:

```text
tenantId = userId
```

Crie identities distintas.

Exemplo:

```text
O1 = org_100
U1 = usr_200
U2 = usr_300
```

Nenhum valor igual.

---

# 73. Cross-tenant matrix

Configuração:

```text
O1:
  U1 OWNER
  U2 MEMBER
  U3 VIEWER

O2:
  U4 OWNER
  U1 ADMIN
```

Testes:

```text
U2 → O1 write = ALLOW
U2 → O2 read = DENY

U3 → O1 read = ALLOW
U3 → O1 write = DENY

U1 → O1 owner action = ALLOW
U1 → O2 admin action = ALLOW conforme matriz

role de U1 em O1
não afeta O2
```

---

# 74. Multi-org E2E

Executar:

```text
login U1
↓
O1 ativa
↓
ler/escrever O1
↓
switch O2
↓
cache de O1 desaparece
↓
ler/escrever segundo permissions O2
```

Provar ausência de dados residuais do tenant anterior na UI.

---

# 75. Membership revocation E2E

```text
U2 logado em O1
↓
OWNER remove U2
↓
próximo request
→ DENY
↓
BFF remove/invalid activeOrganization
↓
U2 continua autenticado se possuir O2
```

---

# 76. Role change E2E

```text
U2 MEMBER
↓
OWNER muda para VIEWER
↓
próximo write
→ DENY
```

Sem esperar JWT expirar.

---

# 77. Invitation race

Duas chamadas simultâneas aceitando o mesmo invitation:

```text
uma ganha
outra recebe resultado idempotente/terminal
```

Nunca:

```text
duas Memberships
```

---

# 78. Last owner

Testar:

```text
O1 possui apenas U1 OWNER

U1 remove self
→ DENY

U1 demote self
→ DENY
```

Depois:

```text
promote U2 OWNER
↓
U1 pode sair/demote
```

---

# 79. Organization deletion multi-org

```text
U1 OWNER O1
U1 ADMIN O2

delete O1
```

Esperado:

```text
O1 → W3-07 lifecycle
O1 data purge
O1 Memberships removed/retained conforme policy
U1 global account permanece
U1 continua acessando O2
BFF session permanece válida
active O1 deixa de ser válida
```

---

# 80. User deletion

Mesmo que a UI de self-delete não seja implementada neste milestone, o design deve responder:

```text
User é último owner de Organization?
User pertence a várias Organizations?
Audit precisa manter pseudonymous actor?
Membership data é removida?
```

A distinção arquitetural deve estar pronta.

---

# 81. Privacy/LGPD

O documento atual já reconhece:

```text
Organization
Membership
```

como dados pessoais/relacionais B2B.

Atualizar:

- User global;
- Membership;
- Invitation;
- organization-scoped preferences;
- audit role snapshot;
- DSR split;
- retention.

---

# 82. Retention de Invitation

Convites expirados/revogados não devem manter e-mail indefinidamente.

Definir:

```text
short operational retention
+
minimized audit evidence
```

Token digest pode ser purgado.

---

# 83. Logging

Logs de request devem ser capazes de distinguir:

```text
correlationId
tenantId
userId
```

`tenantId` não deve virar dimensão de métrica de alta cardinalidade, conforme padrão atual.

A melhoria de join X-Ray deve ser preservada se já implementada.

---

# 84. Audit authorization snapshot

Para ações sensíveis:

```text
membership invite
role change
membership removal
organization delete
ownership change
```

é útil registrar:

```text
actorUserId
actorRoleAtDecisionTime
```

de forma redigida/minimizada.

Isso evita interpretar audit histórico usando a role atual.

---

# 85. Responsibility / assignee como sub-milestone B2B

Depois que Membership estiver estável, implementar integração com:

```text
ExpirationItem.responsável
```

para permitir selecionar membros reais da Organization.

Esse recurso é altamente coerente com o produto e deve ser incluído antes de considerar Multi-User funcionalmente completo.

---

# 86. Notification routing como sub-milestone

Depois do assignee:

```text
responsible member
→ reminder recipient
```

deve ser possível de forma explícita.

Não assumir que todos os membros recebem tudo.

Reaproveitar:

```text
ItemWatch
Channel
NotificationIntent
```

onde fizer sentido.

---

# 87. Organization-level defaults

Organization pode ser a fonte de defaults como:

```text
timezone
quiet hours
notification defaults
```

User pode sobrescrever apenas quando o domínio exigir.

Isso é especialmente útil em times.

---

# 88. Frontend Information Architecture

Adicionar um espaço de:

```text
Configurações da organização
Equipe
```

sem criar uma aplicação paralela.

Header/switcher deve tornar Organization ativa visível quando usuário possuir múltiplas.

---

# 89. No accidental destructive switch

Quando Organization muda:

- queries anteriores canceladas quando possível;
- forms/mutations pendentes precisam ser tratados;
- não permitir submit de formulário iniciado em O1 depois de switch para O2;
- mutation deve carregar tenant context capturado na criação.

Esse é um cenário de concorrência real.

---

# 90. Form state cross-org

Ao trocar Organization:

```text
dirty forms
pending upload
in-flight mutation
```

precisam de contrato.

Preferência:

- impedir switch durante operação crítica ou
- abortar/encerrar o contexto antigo de forma explícita.

Nunca reaproveitar formulário de O1 em O2.

---

# 91. Presigned upload cross-org

Upload iniciado em O1 precisa manter:

```text
tenantId=O1
```

mesmo se a UI mudar para O2 antes do upload terminar.

O slot/capability é ligado a O1.

Isso é mais um motivo para capturar contexto na admissão.

---

# 92. Organization-scoped query keys

Requisito estrutural:

```text
queryKey
=
[organizationId, resource, parameters...]
```

para todo dado tenant-scoped, ou equivalente centralizado.

Criar helper/factory para evitar esquecimento.

---

# 93. Authorization no frontend

O frontend pode usar permission snapshot para:

- esconder ação;
- desabilitar controle;
- evitar UX frustrante.

Mas nenhuma decisão de segurança depende disso.

Backend sempre revalida.

---

# 94. API de contexto

Pode ser útil um endpoint BFF/API como:

```text
GET /me
```

retornando:

```text
user
organizations
activeOrganization
role
permissions
```

ou contratos separados.

Não expor informações de outras Organizations além daquelas em que há Membership válida.

---

# 95. Organization list

`Organizations for User` usa o novo access pattern global de Membership.

A query precisa ser fortemente limitada ao `userId` autenticado.

Não aceitar:

```text
GET /users/{arbitraryUserId}/organizations
```

para usuários normais.

---

# 96. Admin de plataforma continua fora

Não criar agora:

- SUPER_ADMIN;
- PLATFORM_ADMIN;
- cross-tenant support console;
- impersonation.

Esses recursos têm risco alto e não são necessários para o produto B2B normal.

---

# 97. O que vale fazer agora por ser difícil mudar depois

Implementar agora:

```text
Organization como tenant
User global
Membership N:N
Invitation
OWNER/ADMIN/MEMBER/VIEWER
permissions centralizadas
multi-org
active org no BFF
RequestContext correto
single-table revisado
tenant IDs independentes
W3-07 reconciliado
LGPD User vs Organization
query cache tenant-aware
guest identity organizacional
responsible member
notification routing básico
cross-tenant tests
```

---

# 98. O que continua sensato adiar

Mesmo com a nova filosofia, ainda não há benefício suficiente em:

```text
custom roles
ABAC
policy language
SAML
SCIM
department/team hierarchy
resource-level ACLs
cross-org resource sharing
platform admin
support impersonation
enterprise provisioning
seat billing
advanced approval workflows
```

Essas capacidades permanecem fáceis de adicionar sobre a fundação proposta.

---

# 99. Document Lifecycle ficará melhor preparado

A arquitetura futura poderá ficar:

```text
Organization
│
├── Memberships
├── TrackedSubjects
├── ExpirationItems
├── Documents
├── DocumentVersions
├── RenewalCases
└── SignatureEnvelopes
```

Isso evita construir Document Lifecycle sobre uma premissa de tenant temporária.

---

# 100. Alterações documentais necessárias

O current architecture ainda declara Multi-User/RBAC como non-goal do MVP.

Essa decisão foi superada pela estratégia atual.

Não alterar história retroativamente.

Mas atualizar fontes correntes.

Provavelmente:

```text
ARCHITECTURE.md
requirements.md
data-model.md
privacy-lgpd.md
threat-model.md
BFF design/current docs
W3-07 docs/current state
frontend IA
roadmap
NEXT_SESSION_PROMPT
decisions-log
```

Criar ADR Type 1 equivalente a:

```text
Organization as Tenant Boundary
```

---

# 101. ADR principal recomendado

Título conceitual:

```text
ADR — Organization as the Permanent Tenant Boundary
```

Deve fechar:

- global User;
- independent IDs;
- Membership;
- multi-org;
- active Organization selection;
- RequestContext;
- tenant lifecycle;
- migration/cutover;
- async semantics.

---

# 102. ADR de authorization

Pode ser separado se o debate justificar.

Tema:

```text
Role and Permission Model
```

Fechar:

```text
OWNER
ADMIN
MEMBER
VIEWER
permission mapping
last-owner invariant
revocation semantics
```

Evitar fragmentar em muitos ADRs.

---

# 103. ADR / amendment BFF

O Full BFF provavelmente precisa de um amendment explícito para:

```text
activeOrganizationId
org switching
membership revalidation
session after org deletion
cache/session semantics
```

Como é security-sensitive, merece Claude↔Codex.

---

# 104. W3-07 amendment

Formalizar:

```text
TenantLifecycle
= Organization lifecycle

BFF session
!= tenant-owned record

organization DSR
!= user-account DSR
```

Reexecutar análise adversarial das invariantes.

---

# 105. Estratégia de execução recomendada

## Wave B2B-0 — Current Truth + Inventory

Read-only.

Inventariar:

```text
toda ocorrência semântica de tenantId=userId
User storage
IdentityMapping
BFF sessions
RequestContext
authorization
all tenant-scoped stores
S3
events
queues
W3-07
frontend caches
```

---

# 106. Wave B2B-1 — Type 1 Design

Produzir desenho completo.

Claude ↔ Codex até gate.

Não implementar enquanto:

```text
User ownership
Organization lifecycle
Membership access patterns
BFF switching
RBAC
migration
W3-07
```

não estiverem fechados.

---

# 107. Wave B2B-2 — Global Identity Foundation

Implementar:

```text
global User
IdentityMapping → userId only
```

Remover dependência de tenant único da identidade.

---

# 108. Wave B2B-3 — Organization + Membership

Implementar:

```text
Organization
Membership
MembershipByUser
TenantLifecycle
default entitlements
```

com IDs independentes.

---

# 109. Wave B2B-4 — Onboarding

Remover tenant auto-provision silencioso.

Implementar:

```text
new User
↓
Create Organization
ou
Accept Invitation
```

---

# 110. Wave B2B-5 — RequestContext Cutover

Backend passa definitivamente para:

```text
identity
→ User
→ Organization selection
→ Membership
→ permission
→ lifecycle
→ RequestContext
```

Eliminar fallback `tenantId=userId`.

---

# 111. Wave B2B-6 — BFF Organization Context

Implementar:

- active org session field;
- org list;
- switch;
- CAS;
- invalid selection recovery;
- revoked membership behavior;
- multi-session semantics.

---

# 112. Wave B2B-7 — RBAC

Implementar:

```text
OWNER
ADMIN
MEMBER
VIEWER
permissions
default deny
```

Migrar autorização existente.

---

# 113. Wave B2B-8 — Invitations / Team

Implementar:

```text
Invitation
Invite
Accept
Revoke
List
Members
Role change
Remove
Leave
```

com segurança e auditoria.

---

# 114. Wave B2B-9 — W3-07 / Privacy Reconciliation

Atualizar:

- Organization deletion;
- global User survival;
- session behavior;
- User DSR distinction;
- Membership purge/retention;
- invitation retention.

---

# 115. Wave B2B-10 — Tenant-aware Frontend

Implementar:

- switcher;
- members;
- settings;
- invitation;
- permission UX;
- tenant-scoped query keys;
- cache isolation;
- switch race handling.

---

# 116. Wave B2B-11 — Responsibility + Notifications

Integrar:

```text
responsible member
ItemWatch
notification routing
```

para que Multi-User seja funcionalmente útil, não apenas infra de autorização.

---

# 117. Wave B2B-12 — Cutover de dev

Se dados sintéticos:

```text
snapshot
reset/reseed
```

Se necessário preservar:

```text
one-off migration
```

Nenhum compatibility fallback permanente.

---

# 118. Wave B2B-13 — E2E / Adversarial Security

Testar:

- multi-user;
- multi-org;
- roles;
- cross-tenant;
- invitation;
- revocation;
- last owner;
- W3-07;
- BFF;
- cache;
- uploads;
- async workflows;
- guest;
- S3;
- quota;
- audit.

---

# 119. Wave B2B-14 — Operational Evidence

Executar contra `dev`:

```text
real signup
create org
invite second account
accept
work in same tenant
change roles
switch organizations
revoke membership
delete org
verify other org survives
```

Registrar evidência.

---

# 120. Wave B2B-15 — Documentation Reconciliation

Atualizar current truth e remover semantic drift.

Só então considerar milestone fechado.

---

# 121. Claude ↔ Codex — perguntas obrigatórias

O review adversarial deve atacar:

1. Ainda existe algum `tenantId=userId` implícito?
2. `IdentityMapping` ainda possui tenant único?
3. User realmente é global?
4. MembershipByUser consegue descobrir todas as Organizations sem tenant prévio?
5. Organization header pode ser spoofado?
6. Revogação de Membership é efetiva?
7. Roles vazam entre Organizations?
8. Cache do frontend pode mostrar dados de tenant anterior?
9. BFF switch possui race?
10. Session de User multi-org sobrevive corretamente à deleção de uma Organization?
11. W3-07 consegue apagar um User global por acidente?
12. User DSR e Organization DSR foram confundidos?
13. Invitation permite account takeover?
14. Invitation pode ser replayed?
15. Last OWNER pode desaparecer?
16. Presigned URLs possuem overclaim de revogação?
17. Async workers dependem incorretamente de Membership atual?
18. Quotas continuam por Organization?
19. Idempotency continua tenant-scoped?
20. S3 está organization-scoped?
21. Guest trust usa Organization?
22. Responsible user precisa Membership?
23. Removed member continua recebendo notificações?
24. Query keys incluem tenant?
25. Tests usam IDs realmente diferentes?

---

# 122. Gates mínimos do design

Nenhuma implementação deve iniciar se o design não provar:

```text
User global
+
Organization tenant
+
multi-org
+
Membership resolution
+
RBAC
+
BFF session semantics
+
W3-07 semantics
+
data model access patterns
+
cutover strategy
+
cross-tenant security
```

---

# 123. Critério de conclusão

Multi-User B2B não estará concluído apenas quando:

```text
"há uma tela de equipe"
```

Ele estará concluído quando for verdade:

```text
User != Tenant

Organization = Tenant

userId != tenantId funciona em todos os vertical slices

um User usa múltiplas Organizations

uma Organization possui múltiplos Users

roles funcionam

revogação funciona

convites funcionam

cross-tenant é impossível pelos boundaries previstos

frontend não vaza cache entre tenants

async pipelines continuam tenant-safe

W3-07 continua correto

guest flows representam Organization

responsible/notifications fazem sentido em equipe

evidência real em dev existe
```

---

# 124. Parecer final

Com a estratégia de produto atual, **fazer Multi-User B2B agora é recomendável**.

Mais especificamente:

> **é recomendável aproveitar a fase pré-produção para eliminar completamente a simplificação `tenantId=userId` e implantar o modelo definitivo de tenancy.**

A arquitetura atual já preparou parte do caminho:

- `Organization` e `Membership` já existem no design;
- `tenantId=organizationId` já era target futuro;
- `ItemWatch` já separa tenant de user;
- AuditEvent já possui ator;
- privacy model já reconhece Organization/Membership;
- BFF já fornece sessão server-side adequada;
- W3-07 já fornece um lifecycle tenant-scoped forte.

Mas há mudanças fundamentais que precisam ser feitas corretamente:

```text
User global
IdentityMapping sem tenantId
Organization IDs independentes
MembershipByUser global
multi-org real
active Organization no BFF
permission-based RBAC
Invitation
W3-07 multi-org
Organization DSR vs User DSR
frontend tenant-aware
responsibility/notification integration
```

A principal recomendação é:

> **não carregar para frente compatibilidade arquitetural com um modelo que sabemos ser temporário apenas para economizar trabalho agora.**

Se algum dado atual de `dev` precisar ser perdido ou migrado, este é o momento mais barato e mais seguro para isso.

A meta deve ser entrar no primeiro uso real já com:

```text
clean tenant boundary
+
clean identity boundary
+
clean authorization boundary
+
clean lifecycle boundary
```

evitando que futuras capacidades — especialmente Document Lifecycle, assinatura eletrônica, canais premium e colaboração documental — sejam construídas sobre uma fundação transitória.

---

# Fontes principais do repositório analisadas

- `AGENTS.md`
- `NEXT_SESSION_PROMPT.md`
- `ARCHITECTURE.md`
- `docs/architecture/data-model.md`
- `docs/architecture/privacy-lgpd.md`
- roadmap e decisões existentes sobre Organization/Membership/RBAC
- estado corrente documentado do Full BFF
- estado corrente de W3-07 / tenant lifecycle
- modelos existentes de `IdentityMapping`, `ItemWatch`, `GuestTokenPointer`, `TenantEntitlement`, `AuditEvent`

---

# 125. Reconciliação Claude↔Codex (2026-08-29/30)

Rodada 1 de revisão adversarial deste documento (protocolo `AGENTS.md` §4, nota cega — cada avaliador registrou a nota sem ver a do outro): **Claude 6,8/10, Codex 8,0/10**. Ambos abaixo do gate de 9,0 — acordo em não aprovar como está, desacordo real na magnitude. Achados reais de ambos os lados, corrigidos abaixo (não editados nas seções originais §1-124, que permanecem como o documento externo original — correções entram aqui, mesmo padrão já usado em `roadmap-evolution/05-domain-model-organization-billing.md`).

## 125.1 Achado bloqueante de governança — conflito não reconciliado com decisão já aprovada (Claude + Codex, ambos independentemente)

`roadmap-evolution/05-domain-model-organization-billing.md` já é `APPROVED` via protocolo completo (Claude 9,2/Codex 9,2) e decide, textualmente: **"Organization/Membership/RBAC só no gatilho real... nunca por estágio numérico"** — reafirmado depois em `docs/engineering/pilot-readiness-program.md` (auditoria Wave 4/W4-02, "M13 gated por gatilho comercial real que não disparou"). Este documento (§1, §124) recomenda o oposto ("fazer agora") sem citar, reconhecer ou tentar reconciliar essa decisão — a própria lista de "Fontes principais" (§ acima) não menciona `roadmap-evolution/05` nem `decisions-log.md`.

**Isto não é um erro técnico do design em si** — é um gap de completude/rigor: um documento que analisa "profundamente o repositório real" deveria ter encontrado uma decisão formal e diretamente conflitante antes de recomendar o oposto dela. **Resolução**: este documento passa a ser tratado explicitamente como uma **proposta de supersessão** de parte da decisão do cluster 05 (especificamente o gatilho de timing, não o modelo de dados em si, que os dois documentos concordam em linhas gerais) — a decisão de aceitar ou não essa supersessão é do Marcelo (`AGENTS.md` §1), nunca do protocolo Claude↔Codex. O protocolo desta rodada refina só a qualidade técnica do design abaixo, sob a premissa "se/quando isto for implementado".

## 125.2 Last OWNER — falta mecanismo transacional concreto (Codex)

§27/§78 corretamente exigem a invariante "uma Organization ativa deve possuir pelo menos um OWNER ativo", mas não definem como isso é **provado sob concorrência** no single-table. "Consultar membros, depois decidir" é uma corrida real em DynamoDB (TOCTOU clássico, mesma classe de achado que W3-07 já levou várias rodadas para fechar).

**Correção**: manter um contador `ownerCount` no item `META` da própria `Organization` (mesma partição, sempre lido/escrito na mesma `TransactWriteItems` que qualquer mudança de role/remoção de Membership que envolva um OWNER). `ownerCount` é definido precisamente como **a contagem de Memberships `ACTIVE` com `role = OWNER`** — logo, toda transição que reduziria essa contagem (remoção, demote para outra role, **e também suspensão/desativação de uma Membership OWNER**, não só remoção/demote) precisa passar pela mesma transação e pela mesma `ConditionExpression` (`ownerCount > :one`) antes de decrementar. Se falhar, a operação inteira é rejeitada atomicamente, mesma disciplina de `extraConditions`/fence já estabelecida em `occ.ts`/W3-07. Nenhuma leitura solta antes da decisão. (Refinamento de especificação, Codex Rodada 3 — não é um achado bloqueante novo.)

## 125.3 Invitation/Membership — falta constraint de unicidade além do token one-time (Codex)

§21/§77 fecham a corrida do MESMO token de convite (consumo one-time), mas não tratam: (a) dois convites diferentes para o mesmo e-mail/Organization; (b) um convite aceito por um usuário que já é Membership ativo daquela Organization — nenhum dos dois é impedido só pelo consumo one-time do token.

**Correção**: a transação de aceite de convite deve incluir um `ConditionCheck` de **inexistência** de Membership ativa para `(organizationId, userId)` antes de criar uma nova (mesma convenção `attribute_not_exists(PK) AND attribute_not_exists(SK)` já usada em toda escrita condicional do projeto) — falha aqui deve resolver para um outcome terminal idempotente ("já é membro"), nunca criar uma segunda Membership para o mesmo par.

**Correção adicional (Rodada 2, Codex)**: o `ConditionCheck` acima fecha a duplicidade de Membership, mas não fecha um segundo problema real — dois convites PENDENTES diferentes simultâneos para o mesmo `(organizationId, emailNormalized)` (spam, estado ambíguo para quem convida, corrida de auditoria). Um pointer único tenantless (mesma família de `GuestTokenPointer`/`InvitationTokenPointer` já proposta em §20) chaveado por `(organizationId, emailNormalized)` — não só pelo token — resolve isso: criar um novo convite para um par já com convite `PENDING` deve **reenviar/rotacionar o convite existente** (mesmo padrão já usado para reenvio de link de guest upload, `roadmap-evolution/13-guest-link-delivery-design.md`), nunca criar um segundo `Invitation` PENDING concorrente para o mesmo par.

## 125.4 W3-07 — escala da emenda subestimada, falta tabela mantém/emenda/refaz (Codex)

§43/§104 tratam a revisão do W3-07 como uma emenda relativamente contida. O design/implementação real do W3-07 levou múltiplas rodadas adversariais pesadas (D-066 a D-083, algumas peças levando 4-5 rodadas de correção-e-reconfirmação sobre o MESMO achado até convergir ≥9,0). Uma futura sessão de emenda precisa de uma tabela explícita por componente, não uma afirmação genérica:

| Componente W3-07 | Impacto de Organization-as-tenant |
|---|---|
| Fence transacional de admissão (`TenantBusinessMutation`/`ConditionCheck ACTIVE`) | **Mantém** — mecanismo é agnóstico ao significado de `tenantId`, só troca de `userId` para `organizationId` |
| `TenantLifecycleRecord` | **Mantém estruturalmente** — já é keyed por `tenantId`; semântica passa a ser "Organization lifecycle", sem mudança de chave física |
| Purge pipeline (D-081-083) | **Emenda** — precisa incluir `Membership`/`Invitation` no inventário de entidades tenant-scoped purgadas; mecanismo de scan/purge em si mantém |
| BFF session ownership | **Refaz** — §45/§46 deste documento corretamente identificam que a sessão deixa de ser tenant-owned; isto é mudança estrutural real no design do Full BFF, não uma emenda pontual, e precisa do mesmo rigor adversarial (D-053/D-054 levaram 6 passagens) |
| Admission semantics (presigned URLs, async workers) | **Mantém o contrato**, já estabelecido em D-067 ("admitido enquanto ACTIVE pode terminar") — só a fonte do `tenantId` muda |

## 125.5 GTR-01 — reabre D-060 sem reconhecer a supersessão (Codex)

§38 recomenda migrar guest trust de `UserProfile.requesterDisplayName` (D-060, decidido e implementado há poucos dias) para `Organization.displayName`. Tecnicamente correto no modelo B2B, mas deve ser expresso explicitamente como uma **supersessão proposta de D-060**, não como uma lacuna nova — evita o mesmo tipo de gap do achado 125.1 em escala menor.

## 125.6 Escala mecânica do "MVP: tenantId=userId" — parcialmente mitigada, não eliminada

Verificação direta no código (não confiar só na análise): a premissa está **deliberadamente isolada** a poucos pontos de origem real — `bootstrap-identity.ts:163-174` (fluxo de login via API direta), `bff-auth-service.ts:158-161` (fluxo de login via BFF, mesmo comentário citando a mesma regra de `data-model.md` §7.3/`RequestContextResolver.resolve()`), e `recipient-resolver.ts` (fallback `assigneeUserId ?? tenantId`, documentado no próprio arquivo como válido só enquanto o produto for single-user-per-tenant). Isso é um fator atenuante real: a migração do CÓDIGO DE PRODUÇÃO não está espalhada por dezenas de arquivos — são poucos pontos de origem, já conscientemente documentados como tal em cada um.

O que **não** está isolado é a suíte de testes (~1104 testes de backend hoje) — muitos fixtures fabricam `tenantId=userId` como atalho de setup, exatamente o que §72 já pede para mudar. Não foi possível obter uma contagem exata e verificável nesta rodada (uma tentativa de reproduzir uma contagem específica citada informalmente não bateu com busca própria) — **isto reforça, não enfraquece, a necessidade da Wave B2B-0 (§105) como primeiro passo real**: inventariar antes de estimar esforço, não estimar de memória.

## 125.7 Registro de convergência

| Rodada | Nota Claude | Nota Codex | Achado principal |
|---|---:|---:|---|
| 1 | 6,8/10 | 8,0/10 | Conflito não reconciliado com cluster 05 (governança); last OWNER sem mecanismo transacional; Invitation sem constraint de unicidade; tabela W3-07 ausente; GTR-01/D-060 não reconhecido como supersessão; escala mecânica não verificada |
| 2 | 9,1/10 | 8,8/10 | 125.1-125.5 confirmados corrigidos; 2 achados residuais menores: convite pendente duplicado por e-mail+org (não só token), e `bff-auth-service.ts` faltando na lista de origem real do 125.6 |
| 3 | 9,2/10 | **9,2/10** | Ambos os residuais da Rodada 2 corrigidos e confirmados fechados; 1 refinamento de especificação não-bloqueante aplicado (`ownerCount` = Memberships `ACTIVE` com `role=OWNER`, suspensão de OWNER também passa pela mesma transação) |

**Nota de Claude, Rodada 3 (independente)**: **9,2/10** — concordo com a avaliação do Codex: os dois residuais da Rodada 2 foram fechados com mecanismos concretos (pointer único de convite pendente por e-mail+org com reenvio/rotação, terceiro ponto de origem real incluído sem inflar contagem), e o refinamento de `ownerCount` é precisão de especificação bem-vinda, não um achado novo que justifique reabrir rodada.

**Status: TECNICAMENTE CONVERGIDO — `APPROVED` via protocolo Claude↔Codex (Claude 9,2/10, Codex 9,2/10, ambos ≥9,0, sem arredondamento, 3 rodadas reais).** Isto aprova a qualidade técnica do design de Multi-User B2B assumindo implementação futura — **não aprova, recomenda, nem decide "fazer agora"**. A decisão de timing (implementar agora vs. manter o gatilho comercial de `roadmap-evolution/05`, primeira venda B2B) permanece explícita e integralmente reservada ao Marcelo (`AGENTS.md` §1), independente deste resultado técnico.
