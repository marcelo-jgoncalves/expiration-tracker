# Multi-User B2B — Wave B2B-6 (BFF Organization Context), Rodada 2 — Proposta Claude

Resposta à Rodada 1 do Codex (régua 8,2/design 8,4). Os 5 achados são reais — adoto a régua reconciliada sugerida quase verbatim (pequenos ajustes de redação) e corrijo o design em cada ponto.

## Pesquisa externa — fonte adicional (fecha o achado 1)

**OWASP Multi Tenant Security Cheat Sheet**, consultado 2026-08-30: [cheatsheetseries.owasp.org/cheatsheets/Multi_Tenant_Security_Cheat_Sheet.html](https://cheatsheetseries.owasp.org/cheatsheets/Multi_Tenant_Security_Cheat_Sheet.html). Nomeia **"Tenant Context Injection"** explicitamente ("manipulating tenant identifiers in requests, tokens, or headers") como o risco central de um mecanismo como este. Confirma (não redesenha) exatamente a postura já proposta na Rodada 1: "never trust client-supplied tenant IDs without validation... derive tenant context from authenticated sessions... always validate tenant ownership at the data access layer, not just API layer." Aplica-se diretamente: o design já propunha o header como algo o BFF gera a partir da própria sessão, nunca repassado do browser — a fonte confirma essa é a postura correta, e nomeia o risco de não fazer isso explicitamente o bastante para virar critério de nota (achado 2).

## Checklist v2 (Rodada 2) — adota a régua reconciliada da Rodada 1

```text
1. (peso 30%) Revalidação server-side por request via GetItem Membership real + lifecycle
   ACTIVE — nunca cache de claims. Inalterado da v1.
2. (peso 20%, NOVO — achados 1/2 da crítica) Boundary BFF/browser contra Tenant Context
   Injection (OWASP): um `X-Organization-Id` que o BROWSER envie é descartado/sobrescrito pelo
   BFF, nunca repassado como está - `ProxyService.forward()` NUNCA lê `req.headers["x-
   organization-id"]`, só grava o valor derivado de `session.activeOrganizationId`. `POST
   /bff/organization/select` faz `checkCsrf()` antes de qualquer mutação, mesmo padrão de
   `handleCreateOrganization`/`handleProxy`. Atende: teste prova que um request de browser
   com `x-organization-id` malicioso forjado não influencia o header realmente enviado ao
   recurso; `select` sem CSRF válido retorna 403 antes de tocar a sessão.
3. (peso 20%, era critério "fail-closed" — achado 5 da crítica) Erros/estados nomeados com
   CONTRATO EXPLÍCITO, nunca uma frase aberta: `GET /bff/session` ganha um campo tipado novo
   (`organizationSelectionRequired`) para o caso >1 Membership ACTIVE sem seleção válida -
   mutuamente exclusivo com `activeOrganizationId`/`onboardingState`. Nunca `InternalError`/500
   em nenhum caso.
4. (peso 15%) CAS/OCC (reaproveitado de D-086 §12) e multi-sessão independente (verificado:
   tabela de sessão sem GSI por userId). Inalterado da v1.
5. (peso 10%, achado 4 da crítica) `GET /bff/organizations` lista só organizações
   EFETIVAMENTE utilizáveis - `Membership` ACTIVE **E** `TenantLifecycleRecord` ACTIVE, nunca só
   o primeiro (D-086 §11 exige a checagem dupla; sem isso a lista ofereceria algo que `select`
   rejeitaria depois).
6. (peso 5%, achado da crítica) Threading obrigatório nos call sites reais de
   `resolver.resolve()` - contagem corrigida nesta rodada (ver achado abaixo) inclui
   `test-route-handler.ts`, que a Rodada 1 esqueceu.
```

## Achado corrigido durante a própria escrita desta rodada (antes de qualquer nova crítica)

A contagem da Rodada 1 (55 call sites, 12 arquivos) **esqueceu `src/modules/identity/http/test-route-handler.ts`** (1 call site) — a crítica do Codex já citava esse arquivo no item 6 da régua reconciliada, o que motivou eu refazer a busca de forma exaustiva (`grep -rl` em todo `src/`, não uma lista de arquivos já assumida) em vez de confiar na lista da Rodada 1. **Contagem real corrigida: 56 call sites em 13 arquivos.**

## Correções ao design (1 por achado, além da fonte/checklist acima)

### Achado 2 — boundary BFF/browser, `ProxyService.forward()`

```ts
async forward(session: Session, req: ProxyRequest): Promise<ProxyResponse> {
  const route = matchAllowlistedRoute(req.method, req.path);
  if (!route) throw new NotFoundError(...);

  const headers: Record<string, string> = { authorization: `Bearer ${session.accessToken}` };
  for (const name of FORWARDED_REQUEST_HEADERS) { ... } // inalterado - allowlist de hoje
  // NUNCA lê req.headers["x-organization-id"] - o único valor possível vem da sessão
  // server-side, nunca do request do browser (Tenant Context Injection, OWASP).
  if (session.activeOrganizationId) {
    headers["x-organization-id"] = session.activeOrganizationId;
  }
  ...
}
```

`x-organization-id` **não entra em `FORWARDED_REQUEST_HEADERS`** (essa lista é literalmente "o que o browser pode influenciar") — é atribuído numa linha separada, fora do loop, fonte única = sessão. Teste dedicado: um `ProxyRequest` com `headers: { "x-organization-id": "org-attacker" }` forjado não aparece nos headers realmente enviados ao backend quando a sessão tem um `activeOrganizationId` diferente (ou nenhum).

### Achado 3 — CSRF em `POST /bff/organization/select`

Handler segue o MESMO padrão literal de `handleCreateOrganization` (`bff-handlers.ts:179-208`): resolve sessão → `checkCsrf()` (retorna 403 `CSRF_CHECK_FAILED` se falhar, ANTES de qualquer leitura/escrita de Membership) → só então processa o body/muta a sessão.

### Achado 4 — `GET /bff/organizations` filtra por lifecycle também

```ts
async listOrganizations(userId: string): Promise<Array<{ organizationId: string; displayName: string; role: string }>> {
  const memberships = await resolveActiveMembership(this.organizations, userId); // já filtra Membership ACTIVE
  const results = await Promise.all(memberships.map(async (m) => {
    const lifecycle = await this.organizations.get<TenantLifecycleRecord>(tenantLifecycleKey(m.organizationId));
    if (!lifecycle || lifecycle.status !== TENANT_ACTIVE_STATUS) return undefined; // nunca oferece o que select rejeitaria
    const org = await this.organizations.get<Organization>(organizationKey(m.organizationId));
    return org ? { organizationId: m.organizationId, displayName: org.displayName, role: m.role } : undefined;
  }));
  return results.filter((r): r is NonNullable<typeof r> => r !== undefined);
}
```

### Achado 5 — contrato explícito para o estado ambíguo

`OnboardingStateResolver` (B2B-4, D-092/094, já `APPROVED`) **não é reaberto** — seu contrato de 4 estados continua sendo só sobre "esta identidade tem alguma Membership utilizável" (eixo diferente de "qual das várias usar"). Novo campo, camada BFF apenas:

```ts
export interface SessionWithOnboarding {
  session: Session;
  activeOrganizationId?: string;
  onboardingState?: OnboardingState;
  // NOVO - mutuamente exclusivo com os 2 campos acima: >1 Membership ACTIVE (+ lifecycle
  // ACTIVE) e nenhuma seleção válida na sessão ainda.
  organizationSelectionRequired?: { organizations: Array<{ organizationId: string; displayName: string; role: string }> };
}
```

`resolveSessionWithOnboarding()`: quando `deriveActiveOrganizationId` hoje retorna `undefined` por causa de `active.length > 1` (não mais o único motivo silencioso - antes o mesmo `undefined` cobria 0 e >1 sem distinguir), passa a distinguir os 2 casos: 0 → comportamento atual (`onboardingState`); >1 → `organizationSelectionRequired` com a lista já filtrada por lifecycle (reaproveita `listOrganizations()` do achado 4, não uma segunda implementação).

## Helper compartilhado (resposta à pergunta 2 da Rodada 1) — resultado semântico, nunca erro HTTP direto

```ts
export type WorkingOrganizationResult =
  | { status: "OK"; membership: Membership }
  | { status: "UNAVAILABLE" }; // Membership não ACTIVE, ou lifecycle não ACTIVE, ou nenhuma das duas encontrada

export async function resolveWorkingOrganization(organizations: OrganizationStore, userId: string, organizationId: string): Promise<WorkingOrganizationResult> { ... }
```

`RequestContextResolver` mapeia `UNAVAILABLE` → `OrganizationUnavailableError` (AppError, 409); `BffAuthService.selectOrganization()` mapeia `UNAVAILABLE` → resposta JSON amigável própria (não precisa ser o mesmo formato de erro da API de recurso) — aceito exatamente como o Codex propôs na resposta à pergunta 2.

## Decomposição atualizada

| Subitem | Camada | Risco |
|---|---|---|
| B2B-6.1 | Domain (`app-error.ts`) — `OrganizationUnavailableError`/`OrganizationSelectionRequiredError`; Application — `resolveWorkingOrganization()` (resultado semântico, nunca lança) | 5 |
| B2B-6.2 | Application (`resolve-request-context.ts`) — `organizationIdHint` obrigatório no input, `resolveActiveMembership()` reescrito usando `resolveWorkingOrganization()` | 5 |
| B2B-6.3 | Application/HTTP (BFF) — `ProxyService.forward()` injeta o header SEM nunca ler o do browser; `POST /bff/organization/select` com CSRF; `GET /bff/organizations` filtrado por lifecycle; `SessionWithOnboarding.organizationSelectionRequired` tipado | 5 |
| B2B-6.4 | HTTP — threading obrigatório de `organizationIdHint` nos 56 call sites reais (13 arquivos, incl. `test-route-handler.ts`) | 3 |
| B2B-6.5 | Testes — G-V3 desde a escrita: os itens do checklist v2 (revalidação real, header de browser descartado, CSRF no select, filtro de lifecycle na lista, contrato tipado do estado ambíguo, CAS, multi-sessão, regressão zero para organização única) | 2-3 |

## Pergunta para a Rodada 2 do Codex

A régua v2 converge para ≥9,0 do seu lado? Se sim, avalie o design corrigido contra ela.
