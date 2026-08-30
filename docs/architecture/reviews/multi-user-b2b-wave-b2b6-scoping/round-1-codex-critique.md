# Rodada 1 — Crítica Codex (via MCP `mcp__codex__codex`, thread `01a051e3-b900-73c2-b3cd-625d73c096d4`)

**Régua contestada — nota da régua e nota do design registradas separadas per `research-protocol.md`:**

- Nota da régua: **8.2/10**
- Nota do design (contra a régua v1): **8.4/10**

## Achados

1. **Pesquisa incompleta para decisão de segurança/identidade** — faltou OWASP Multi Tenant Security Cheat Sheet, que `research-protocol.md` exige preferir quando a decisão envolve identidade/segurança (não só documentação de produto/blog técnico).
2. **Falta critério explícito de boundary BFF/browser** — a proposta AFIRMA que o browser nunca define o header, mas isso precisa virar critério testado (request com `x-organization-id` malicioso do browser deve ser descartado/sobrescrito pelo BFF, nunca repassado) — OWASP nomeia isso "Tenant Context Injection".
3. **`POST /bff/organization/select` não menciona CSRF** — todo POST mutável do BFF hoje faz `checkCsrf` antes da mutação (`handleCreateOrganization`, `handleProxy`); a proposta não tornou isso explícito para o novo endpoint.
4. **`GET /bff/organizations` deve filtrar por `TenantLifecycleRecord` ACTIVE, não só `Membership` ACTIVE** — sem esse filtro, a lista pode oferecer uma organização que `select`/o recurso rejeitariam depois (D-086 §11 exige a checagem dupla).
5. **Estado de sessão ambíguo (>1 Membership ACTIVE, sem seleção) não tem contrato explícito** — a proposta só diz "reporta onboardingState/lista se ambígua", frase aberta demais; precisa ser um campo tipado real na resposta de `GET /bff/session`.

## Respostas às perguntas abertas

1. Confirma: 2 erros nomeados distintos (`OrganizationSelectionRequiredError`/`OrganizationUnavailableError`) — representam ações diferentes para o cliente.
2. Helper compartilhado aceitável SE retornar um resultado semântico (`{ok} | {unavailable}`), nunca lançar o erro HTTP final diretamente — deixa BFF e recurso decidirem formato/status/mensagem próprios.
3. Falta OWASP Multi-Tenant Security como fonte + critério de defesa contra header malicioso do browser.

## Régua reconciliada sugerida

1. (30%) Revalidação server-side por request via GetItem Membership + lifecycle ACTIVE.
2. (20%) Boundary BFF/browser: header client-side descartado/sobrescrito, CSRF no `select`, contexto propagado só após sessão autenticada.
3. (20%) Erros/estados nomeados: selection required vs. unavailable, sem `InternalError`/500, contrato claro em `GET /bff/session`.
4. (15%) CAS/OCC e multi-sessão independente.
5. (10%) Listagem só de organizações efetivamente utilizáveis, filtrada por lifecycle.
6. (5%) Threading obrigatório nos 55 call sites reais, incl. tratamento explícito do `test-route-handler`.
