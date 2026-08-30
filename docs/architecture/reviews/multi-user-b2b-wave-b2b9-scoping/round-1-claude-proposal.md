# Wave B2B-9 (W3-07 / Privacy Reconciliation) — Round 1 Proposal

Escopo per `roadmap-evolution/17-multi-user-b2b-revised-strategy.md` §114: Organization deletion,
global User survival, session behavior, User DSR distinction, Membership purge/retention,
invitation retention. Base obrigatória (não re-derivada): `docs/architecture/w3-07-writer-inventory.md`
e a tabela de impacto §125.4 do mesmo roadmap doc.

## Classificação de risco (`change-risk-scale.md`)

**Type 1, nível 5-6** — muda classificação de retenção LGPD (modelo de dados de privacidade), fecha
um gap real de purga de dado tenant-scoped (segurança/isolamento), e formaliza uma distinção de
Data Subject Rights ainda não decidida. Protocolo Claude↔Codex completo obrigatório (`AGENTS.md` §4).

## Declaração E-014 (pesquisa externa antes da Rodada 1)

**SIM** — "deletar minha conta pessoal" vs. "deletar a organização/workspace" sob LGPD/GDPR em SaaS
B2B multi-tenant é um padrão que sistemas fora deste projeto já resolveram de forma estabelecida.
Pesquisa real feita nesta sessão via `WebSearch`/`WebFetch` (verificado por fetch direto onde
possível, não só confiar no resumo do buscador — mesma disciplina já aplicada a OWASP em B2B-6):

1. **GitHub** — `docs.github.com/.../deleting-your-personal-account` (conteúdo consistente através de
   6 versões arquivadas do Enterprise Server: 3.2, 3.4, 3.6, 3.10, mais a doc atual — não uma
   afirmação isolada de uma única página): "If you're the only owner of an organization, you must
   transfer ownership to another person or delete the organization before you can delete your
   personal account" — regra explícita: "an organization must always have at least one owner, so
   you can never remove the last owner." Fetch direto (`docs.github.com/en/enterprise-cloud@latest/
   organizations/managing-organization-settings/deleting-an-organization-account`, 2026-08-30)
   confirmou literalmente: "Deleting your organization account permanently removes all repositories,
   forks of private repositories, wikis, issues, pull requests, and project or organization pages" —
   irreversível, cascateia para TODO dado da organização, não só o do usuário que aciona.
2. **Slack** — `slack.com/help/articles/360000360443-Delete-profile-information-from-Slack` (via
   busca, conteúdo consistente com a política pública conhecida de Slack): a exclusão de conta
   individual remove só informação de perfil; conteúdo de mensagens/canais é "Customer Data"
   controlado pelo Primary Owner do workspace (o controlador de dados sob GDPR/CCPA para aquele
   workspace) — "Content that isn't considered profile information won't be removed from Slack,
   including a member's message content from any channels or direct messages."
3. **Atlassian** — `support.atlassian.com/user-management/docs/delete-a-managed-account/` +
   `atlassian.com/trust/privacy/gdpr`: conta gerenciada por uma organização não pode se
   autodeletar — precisa passar pelo admin da organização; contatos de billing/técnico são
   bloqueados de deleção para preservar a relação de negócio; Primary Owner é o "data controller"
   dos dados do workspace.

**Representatividade**: 3 vendors B2B multi-tenant reais e amplamente usados, convergindo
independentemente no mesmo par de regras (não é 1 fonte isolada). Nenhuma fonte contradiz o padrão.

**Regra derivada (checklist da Rodada 1, âncoras concretas, não critério vago)**:

| # | Critério (peso) | Âncora concreta |
|---|---|---|
| C1 | Last-owner block (peso alto) | Um `User` que é `OWNER` `ACTIVE` único de qualquer `Organization` `ACTIVE` não pode ter seu `GlobalUser` apagado/anonimizado até transferir a role `OWNER` (mecanismo já existe: `change-membership-role.ts`, B2B-8) ou até a `Organization` ser deletada primeiro. Fonte: GitHub. |
| C2 | Fronteira de dado Organization-owned vs. User-owned (peso alto) | Apagar/anonimizar um `User` (DSR individual) nunca cascateia para apagar dado de negócio pertencente à `Organization` (Items/Documents/DocumentRequests/etc.) que outros membros ainda usam — só a linha `GlobalUser` e as `Membership`s do próprio usuário são afetadas. Só deletar a `Organization` inteira (mecanismo já existe: W3-07 purge, D-081-083) apaga o dado de negócio, e isso afeta TODOS os membros, não só quem pediu. Fonte: Slack. |
| C3 | Purge pipeline cobre as entidades novas desde B2B-3/8 (peso alto, achado de código real, não só pesquisa externa) | `Membership`/`Invitation`/`MembershipAuditEvent` (todos `PK=TENANT#<organizationId>#...`) já caem estruturalmente sob o scan `begins_with(PK,"TENANT#<id>#")` de `dynamo-tenant-purge.ts` — verificado por leitura de `membership.ts:41`, `invitation.ts:33/50`, `audit-event.ts:45`. `InvitationTokenPointer` (`PK=INVITATION_TOKEN#<selectorHash>`, tenantless por design, mesma família de `GuestTokenPointer`) **NÃO** cai — declara `organizationId`, não `tenantId`, e o fix de D-082/B1 só amplia o filtro para `tenantId = :tenantId` (verificado em `invitation-token.ts:25`, contra `dynamo-tenant-purge.ts`/`tenant-purge-scan.ts`). Gap real, não hipotético: uma `Organization` deletada deixa `InvitationTokenPointer`s órfãos para sempre. |
| C4 | Sobrevivência do `GlobalUser`/outras Memberships provada por teste adversarial, não só por leitura de chave (peso médio) | Mesma disciplina já usada em toda a sessão (B2B-6/7/8): "provar por teste, não só por leitura de chave". |
| C5 | Comportamento de sessão na exclusão de Organization provado por teste adversarial contra o estado terminal `DELETED`, não só `DELETING` (peso médio) | `resolveWorkingOrganization()`/B2B-6 já trata qualquer status de lifecycle não-`ACTIVE` como indisponível — falta teste nomeando `DELETED` explicitamente, e um cenário multi-org (2 orgs, 1 deletada, sessão se autocura para a outra). |
| C6 | Proporcionalidade — não construir endpoint DSR real (peso médio, `principles.md` #1) | `privacy-lgpd.md` já registra `DataSubjectRequest`/endpoints como "Não implementado ainda (design-only)" — decisão pré-existente, não desta wave. Construir um guard de "bloquear exclusão de User" sem nenhum call site real de exclusão de User seria código morto (mesmo raciocínio já usado em B2B-3 para adiar o decremento de `ownerCount` até B2B-7/8 terem call sites reais). Esta wave formaliza a REGRA (C1/C2) em `privacy-lgpd.md`, não a implementação do endpoint. |
| C7 | Classes de retenção novas para as entidades B2B ausentes da tabela (peso médio, achado de código real) | `privacy-lgpd.md`'s tabela de `retentionClass` (linha 35+) não tem NENHUMA linha para `Membership`/`Invitation`/`InvitationTokenPointer`/`MembershipAuditEvent` — confirmado por grep, essas entidades não existiam quando o documento foi escrito. |

## Proposta concreta (Rodada 1)

### 1. Fix de código real — `InvitationTokenPointer` alcançável pela purga (C3)

`src/shared/dynamodb/tenant-purge-scan.ts`: ampliar o `FilterExpression` do Scan da tabela principal
de `begins_with(PK, :prefix) OR tenantId = :tenantId` para também aceitar
`OR organizationId = :tenantId` (terceira cláusula OR, mesmo padrão do fix B1 de D-082).
`src/shared/tenant-lifecycle/system-mutation.ts`'s `PURGE_DELETE` `ConditionExpression`: espelhar a
mesma cláusula adicional (senão a condição de segurança rejeitaria a exclusão de um item que o Scan
amplo agora encontra, travando a convergência — exatamente o modo de falha que o próprio B1
documentou). `dynamo-tenant-purge.ts`'s `isNeverPurgeCanonicalKey`: **não precisa mudar** —
`InvitationTokenPointer` deve ser purgado, não protegido.

Alternativa considerada e rejeitada: renomear `organizationId` para `tenantId` dentro de
`InvitationTokenPointer` para eliminar a necessidade de uma terceira cláusula. Rejeitada porque (a)
o campo já está em produção via B2B-8 (`AcceptInvitationService`, `create-invitation.ts`,
`revoke-invitation.ts`) — renomear é um refactor mecânico maior sem benefício de segurança adicional
sobre simplesmente ampliar o filtro; (b) o nome `organizationId` é mais preciso semanticamente pós-B2B
(125.4: "tenantId" é só o nome histórico do conceito, "organizationId" é o nome real agora) — a
convenção correta daqui para frente é o filtro de purga aceitar QUALQUER um dos dois nomes de atributo
conhecidos, não forçar todo writer novo a usar o nome antigo.

### 2. Testes adversariais novos (C4, C5) — nenhuma mudança de comportamento, só prova

- `test/unit/workers/tenant-purge/dynamo-tenant-purge.test.ts`: novo teste plantando um
  `InvitationTokenPointer` real (via fixture) associado à organização purgada, confirmando que
  sobrevive ANTES do fix (mutação: reverter o fix faz este teste falhar) e é purgado DEPOIS.
- Novo teste (mesmo arquivo ou `test/unit/organization/`): purgar a Organization A não afeta o
  `GlobalUser` do usuário nem sua `Membership` ativa em uma Organization B distinta (mutação: remover
  o filtro `begins_with(PK,"TENANT#<A>#")` faria o teste falhar por apagar dado da Organization B).
- `test/unit/bff/bff-organization-context.test.ts`: estender o teste de invalid-selection-recovery
  já existente (D-102/B2B-6) para nomear explicitamente o status terminal `DELETED` (hoje só testa
  `DELETING` — verificar antes de escrever se já existe cobertura equivalente, para não duplicar).

### 3. `privacy-lgpd.md` — nova seção "User-level vs. Organization-level erasure" + 4 linhas de
   retenção novas (C1, C2, C6, C7)

Nova subseção formalizando C1/C2 como decisão, citando as 3 fontes acima, e explicitamente
registrando que o endpoint de DSR real permanece "não implementado ainda" (não reabre essa decisão
pré-existente). 4 novas linhas na tabela de `retentionClass`: `Membership`/`Invitation` seguem a
retenção da própria `Organization` (dado de negócio, apagado só via purga de Organization);
`InvitationTokenPointer` — mesma classe de `GuestTokenPointer` (token efêmero, TTL 14 dias,
`purgeAfterTtl` físico já implementado); `MembershipAuditEvent` — dado de auditoria, mesma retenção
já aplicada a outros audit trails do sistema (verificar qual classe já existe para audit trail antes
de inventar uma nova).

### 4. `decisions-log.md` — novas entradas D-103 (escopo, este debate) / D-104 (implementação)

## Fora de escopo desta wave (registrado, não silenciosamente ignorado)

- Endpoint HTTP real de DSR (`DataSubjectRequest`) — decisão pré-existente de `privacy-lgpd.md`,
  não revisitada aqui.
- Guard de "bloquear exclusão de User" em código — sem call site real (C6), seria código morto.
- Orquestrador de purga (Step Functions vs. Lambda+EventBridge Scheduler) — D-083 registrou isso como
  a "próxima etapa real" depois do purge pipeline, mas é uma decisão de INFRAESTRUTURA/operação
  (como disparar `purgeTenant()` de forma durável), ortogonal ao escopo de retenção/modelo de dados
  desta wave. Esta wave não precisa dele: o gap C3 e as provas C4/C5 são sobre o CONTEÚDO da purga e
  o comportamento de sessão, não sobre QUEM/QUANDO a invoca. Registrado como pendência separada,
  não bloqueia B2B-9.

## Perguntas abertas para a Rodada 1 do Codex

1. A ampliação do filtro de purga (item 1) cobre todos os casos reais, ou existe outro atributo de
   nome diferente (`orgId`, etc.) usado em algum writer B2B que eu não tenha encontrado por grep?
2. A tabela de retenção nova (item 3) precisa de uma classe própria para `MembershipAuditEvent`, ou
   deve reusar uma já existente (evitar fragmentação de classes de retenção sem necessidade real)?
3. C1 (last-owner block) — a regra deveria também impedir SUSPENDER (não só deletar) o último OWNER
   ativo, dado que `125.2` já trata suspensão de OWNER como equivalente a remoção para fins de
   `ownerCount`? Proponho SIM (consistência com `ownerCount`), mas registrando como pergunta aberta.
