# Multi-User B2B — Wave B2B-6 (BFF Organization Context), Rodada 1 — Proposta Claude

Contexto: Waves B2B-0 a B2B-8 `DONE`. Escopo textual original (`roadmap-evolution/17` §111): `active org session field; org list; switch; CAS; invalid selection recovery; revoked membership behavior; multi-session semantics`. O mecanismo central já está `APPROVED` desde D-086 (`multi-user-b2b-physical-model.md` §11/§12) — esta rodada fecha o gap de TRANSPORTE que B2B-5 deixou deliberadamente aberto (achado 2.1, D-095: "a BFF encaminha só o access token Cognito bruto — não existe nenhum canal que carregue `activeOrganizationId` até o resolver do lado do recurso").

## Achado real que motiva esta wave agora (não antes): B2B-8 tornou o gap explorável

`RequestContextResolver.resolveActiveMembership()` (`resolve-request-context.ts:165-179`) hoje lança `InternalError` (500 genérico) se um usuário tiver **mais de uma** `Membership` `ACTIVE` — comentário no próprio código já nomeia isso como "not supported until Wave B2B-6". Até B2B-8, isso era inatingível (nenhum writer real produzia uma 2ª `Membership` para o mesmo usuário). **Agora é atingível**: qualquer usuário que aceite um 2º convite (`AcceptInvitationService`, D-100) entra nesse estado e quebra com 500 em toda chamada autenticada subsequente. B2B-6 fecha um bug real, não só uma lacuna arquitetural teórica.

## Pesquisa externa considerada: SIM

**Critério (research-protocol.md)**: nível 5 (novo contrato de transporte entre BFF e API de recurso, muda `RequestContextResolver`) + padrão externo estabelecido — `research-protocol.md` já nomeia "sessão/contexto multi-tenant" explicitamente como exemplo de decisão que exige pesquisa.

**Fontes consultadas 2026-08-30**:

1. [The x-tenant-id Pattern: Multi-Tenant API Without Multi-Tenant Complexity](https://dev.to/akshay_nikhare/the-x-tenant-id-pattern-multi-tenant-api-without-multi-tenant-complexity-4cn9) (DEV Community) — padrão de header + revalidação via membership lookup no banco.
2. [Identity Base: Header-Based Organization Context](https://amarettosoftware.com/news/identity-base-organization-context-header) — padrão de header + revalidação via claims de JWT.
3. [Multi-Tenant Identity Management for SaaS: Architecture & Best Practices](https://ssojet.com/blog/multi-tenant-identity-management) (SSOJet) — postura de segurança geral (gateway nunca confia em header de tenant sem revalidar).
4. Slack ([Switch between workspaces](https://slack.com/help/articles/1500002200741-Switch-between-workspaces)) e Notion ([Intro to workspaces](https://www.notion.com/help/intro-to-workspaces)) — confirmação de UX (troca de workspace nunca exige novo login).

**Representatividade**: 2 fontes técnicas específicas sobre o padrão header+revalidação (arquiteturas genéricas de API multi-tenant, não amarradas a um produto/nicho único) + 1 fonte de postura de segurança geral + 2 produtos reais (dev-first e produtividade geral) confirmando a UX de troca sem reautenticação — mesma lógica de amostra já usada em B2B-7/B2B-8.

**Achado central — convergência total (2/2 fontes técnicas) na regra de segurança, divergência no MECANISMO de revalidação**: as 2 fontes concordam sem exceção que **o header nunca é a fonte de autorização por si só** — precisa ser revalidado contra algo verificado a cada request, e uma falha de validação retorna `403`, nunca deixa o request prosseguir com o valor do header cru. Onde divergem: uma revalida contra **claims de JWT em cache** (`org:memberships` no token), a outra revalida contra **uma consulta real ao banco de membership**. **Este projeto já usa exclusivamente o segundo padrão** (nenhuma autorização deste código depende de claims custom no JWT do Cognito — `authorize()`/`RequestContext` são sempre derivados de leitura real de `Membership`, D-086 em diante) — a pesquisa CONFIRMA que o padrão já em uso (revalidação via banco, não via cache de claims) é um dos dois padrões estabelecidos, na verdade o mais forte dos dois (nunca sofre staleness de cache de claims entre uma revogação e a próxima renovação de token). Divergência registrada explicitamente, não escondida: não sigo o padrão de embutir organização no JWT (SSOJet também recomenda isso) porque este produto exige "switch sem reautenticação" (requisito textual do roadmap) — embutir no JWT exigiria reemissão de token a cada troca, incompatível com esse requisito; Slack/Notion confirmam que produtos reais de mercado tratam troca de workspace como estado de sessão/app, não como evento de re-autenticação.

## Checklist de critérios de nota

```text
1. (peso 30%) O header de seleção de organização NUNCA é fonte de autorização por si só —
   sempre revalidado contra uma leitura real de Membership (GetItem), nunca contra um cache de
   claims. Atende: toda decisão de acesso após o header ser lido ainda passa por GetItem +
   checagem de status ACTIVE + TenantLifecycleRecord ACTIVE, exatamente como já acontece hoje
   sem o header. Não atende: qualquer atalho que confie no valor do header sem essa
   revalidação completa.
2. (peso 25%) Fail-closed nomeado substitui o `InternalError` 500 genérico atual — hint
   ausente/inválido/revogado E o caso de múltiplas Memberships ativas sem hint nunca crasham
   com um erro não-classificado. Atende: 2 erros nomeados novos (`OrganizationUnavailableError`
   para hint inválido/revogado - reaproveita o nome `ORGANIZATION_UNAVAILABLE` já usado no
   physical model §12 para o caso simétrico da sessão BFF -, `OrganizationSelectionRequiredError`
   para ambiguidade sem hint), cada um com teste dedicado. Não atende: qualquer desses casos
   ainda produzir `InternalError`/500.
3. (peso 20%) Troca de organização não exige reautenticação (achado de pesquisa/UX de mercado)
   e reaproveita CAS/OCC já `APPROVED` (D-086 §12), nunca um mecanismo de concorrência novo.
   Atende: `POST /bff/organization/select` usa `sessionStore.updateConditional` (mesmo padrão
   já usado por `createOrganization`/self-heal), sem nenhum novo primitivo de concorrência.
4. (peso 15%) Multi-sessão real — provado por teste que 2 sessões do mesmo usuário (dispositivos
   diferentes) mantêm `activeOrganizationId` independentes, nunca compartilhado por usuário.
5. (peso 10%) Threading mecânico do header pelos ~12 arquivos de handler HTTP reais que chamam
   `resolver.resolve()` não muda nenhum comportamento existente para o caso de organização única
   (ainda majoritário) — proporcionalidade, `principles.md` #1.
```

## Design proposto

### 1. Transporte: `X-Organization-Id`, injetado pelo BFF, nunca pelo browser

`ProxyService.forward()` passa a adicionar `x-organization-id: session.activeOrganizationId` (quando presente) em toda chamada proxied — **não** um header repassado de `FORWARDED_REQUEST_HEADERS` (que só encaminha o que o browser já mandou); este é um header **novo, gerado pelo BFF a partir da própria sessão server-side**, o browser nunca o define nem o vê (mesma disciplina de "o browser nunca vê o token", D-053). Isso fecha a preocupação da pesquisa sobre "nunca confiar em header de um cliente não confiável" — do ponto de vista da API de recurso, o BFF é o único chamador real (mesmo modelo de confiança de hoje, só um header a mais).

### 2. `RequestContextResolver` aceita o hint, revalida sempre

```ts
export interface ResolveRequestContextInput {
  claims: ValidatedClaims;
  requestId: string;
  correlationId: string;
  // Campo OBRIGATÓRIO (não `?:`), mesmo aceitando `undefined` como valor válido — força o
  // TypeScript a barrar em tempo de compilação qualquer um dos ~55 call sites reais que
  // esqueça de repassar o header (verificado por leitura direta, não estimativa: 12 arquivos
  // de handler HTTP, contagem exata por arquivo abaixo), em vez de deixar uma rota
  // silenciosamente sem suporte a multi-org até um teste específico pegar.
  organizationIdHint: string | undefined; // de X-Organization-Id, nunca confiado sem revalidação
}
```

**Contagem real de call sites de `resolver.resolve()`/`deps.resolver.resolve()` a atualizar** (verificado por `grep -c`, não estimado): `document-handlers.ts` 4, `item-handlers.ts` 7, `item-watch-handlers.ts` 3, `extraction-handlers.ts` 2, `profile-handlers.ts` 2, `import-handlers.ts` 3, `preferences-handlers.ts` 2, `membership-handlers.ts` 7, `policy-handlers.ts` 4, `document-request-handlers.ts` 6, `requirement-handlers.ts` 9, `subject-handlers.ts` 6 — **55 call sites em 12 arquivos**, cada um ganhando `organizationIdHint: req.headers?.["x-organization-id"]`.

`resolveActiveMembership` (privado) muda de "deriva via GSI4 sempre" para:
- Se `organizationIdHint` presente: `GetItem(membershipKey(hint, userId))` direto (§11 literal: "GetItem direto Membership(userId, organizationId)"). Ausente ou `status !== "ACTIVE"` → `OrganizationUnavailableError` (nunca cai para a derivação via GSI4 — um hint explícito que não bate é tratado como seleção inválida, não como "sem preferência").
- Se ausente: comportamento de hoje via `resolveActiveMembership()`/GSI4 — 0 já tratado antes (onboarding); exatamente 1 → usa; **mais de 1 → `OrganizationSelectionRequiredError`** (nunca mais `InternalError`).

`TenantLifecycleRecord` ACTIVE continua checado depois, sem mudança (já existe, linha 112-115).

### 3. `POST /bff/organization/select`

Valida `Membership(userId, organizationId)` `ACTIVE` + `TenantLifecycleRecord(organizationId)` `ACTIVE` (mesma checagem dupla que `RequestContextResolver` já faz — reaproveitada, não duplicada: novo helper compartilhado `resolveWorkingOrganization()` em `organization/application/`, chamado por AMBOS). CAS via `sessionStore.updateConditional` (mesmo padrão de `createOrganization`). Falha de validação → `OrganizationUnavailableError` (mesmo nome do item 2 — o BFF e o recurso usam o MESMO erro para "essa organização não é uma opção válida para você agora").

### 4. `GET /bff/organizations` (list)

Reaproveita `resolveActiveMembership()` (já existe, `organization/application/resolve-active-membership.ts`) — lista todas as `Membership` `ACTIVE`, retorna `{organizationId, role, displayName}[]` (busca `Organization.displayName` por item — N GetItems, aceitável para uma lista pessoal de poucos itens, nunca uma Query nova).

### 5. Self-heal estendido (`resolveSessionWithOnboarding`)

Hoje só trata `activeOrganizationId` AUSENTE. Passa a também tratar **inválido** (presente mas a Membership não é mais ACTIVE ou a Organization não é mais ACTIVE): mesma checagem dupla do item 2/3, limpa o campo e re-deriva (ou reporta `onboardingState`/lista se ambígua), nunca deixa uma sessão apontar silenciosamente para uma organização inacessível.

### 6. Multi-sessão

Nenhuma mudança de schema necessária — **verificado por leitura direta** (`session.ts`/`dynamodb-session-store.ts`): a tabela de sessão não tem nenhum GSI/índice secundário, só `sessionKey(selectorHash)` — um item por sessão, sem nenhum agrupamento por `userId` que pudesse vazar uma troca de organização de uma sessão para outra. Item desta wave é só **prova por teste**, não código novo.

## Decomposição (per `definition-of-done.md`)

| Subitem | Camada | Risco |
|---|---|---|
| B2B-6.1 | Domain (`app-error.ts`) — `OrganizationUnavailableError`/`OrganizationSelectionRequiredError`; Application (`organization/`) — `resolveWorkingOrganization()` helper compartilhado | 5 (novo contrato de erro no gate real de login) |
| B2B-6.2 | Application (`resolve-request-context.ts`) — `organizationIdHint` no input, `resolveActiveMembership()` reescrito para revalidar hint ou cair no fallback com erro nomeado em vez de crash | 5 (muda o gate real de toda chamada autenticada) |
| B2B-6.3 | Application/HTTP (BFF) — `ProxyService.forward()` injeta o header; `POST /bff/organization/select`; `GET /bff/organizations`; self-heal estendido para "inválido" | 5 (novo endpoint + mudança de contrato de proxy) |
| B2B-6.4 | HTTP — threading mecânico de `organizationIdHint` (extraído do header) nos 55 call sites reais (12 arquivos) que chamam `resolver.resolve()`; campo obrigatório no tipo (não opcional) para o compilador barrar qualquer site esquecido | 3 (mecânico, sem decisão nova por arquivo, mas volume real de edição alto) |
| B2B-6.5 | Testes — G-V3 desde a escrita: hint válido usado direto; hint inválido/revogado → `OrganizationUnavailableError`; ausência + >1 → `OrganizationSelectionRequiredError`; ausência + exatamente 1 → comportamento inalterado (regressão zero para usuário de org única); switch via CAS; multi-sessão independente; self-heal de sessão inválida | 2-3 |

## Fora de escopo desta wave

- UI/IA do switcher (frontend) — Wave B2B-10.
- Migração de dados legados / cutover de `dev` — Wave B2B-12.
- Qualquer mudança em `Membership`/`Invitation`/RBAC — já fechado em B2B-7/B2B-8.

## Pergunta aberta para a Rodada 1 do Codex

1. `OrganizationSelectionRequiredError`/`OrganizationUnavailableError` como 2 erros nomeados distintos é a granularidade certa, ou deveriam ser o mesmo erro (a distinção prática para o cliente — "escolha uma" vs. "essa não é mais válida" — importa o bastante para a UX do switcher)?
2. O helper compartilhado `resolveWorkingOrganization()` entre `RequestContextResolver` (recurso) e `BffAuthService` (BFF/select) é a abstração certa, ou os dois contextos são distintos o bastante (erro relevante para HTTP 403 de API vs. resposta JSON amigável de BFF) para justificar duplicação deliberada, como o projeto já prefere em outros pontos?
3. Falta alguma fonte ou caso real não coberto pela pesquisa?
