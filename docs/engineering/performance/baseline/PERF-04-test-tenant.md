# PERF-04 — Tenant de teste sintético (usuário + organização)

Pré-requisito de dados para os experimentos PERF-04 (baseline BFF/HTTP/Resource Lambda), PERF-05
(Power Tuning) e PERF-11 (load testing): um tenant real, com dados mínimos, para que os endpoints
alvo devolvam respostas não vazias em vez de listas zeradas.

## Usuário Cognito (já existia, reaproveitado)

- User pool: `us-east-1_NZlvr5IIn` (`exptrk-dev-user-pool`), app client `7n8g55k4vsmg9rat962666jthd`
  (`WebClient`)
- E-mail: `marcelo.mjgoncalves+perf-test-2026-09-14@gmail.com`
- Status: `CONFIRMED`, senha permanente já definida (criado em sessão anterior, antes desta).
- **Senha**: NÃO está neste arquivo. Fica só em
  `docs/engineering/performance/.local/perf-test-tenant-credentials.txt` (gitignored, nunca
  commitado).

## Organização/tenant criada nesta sessão

O usuário não tinha nenhuma organização (`GET /bff/session` retornava
`onboardingState: "NO_TENANT_NO_MEMBERSHIP"`). Criada **uma única** organização via
`POST /bff/organizations` (fluxo normal de onboarding, não escrita direta no DynamoDB):

- `organizationId`: `org_01M2GE4F1SZPSJ47HCGRXH4XMN`
- `displayName`: "PERF Test Tenant"
- `timezone`: "America/Sao_Paulo"

Após a criação, `GET /bff/session` passou a retornar
`{"authenticated":true,"activeOrganizationId":"org_01M2GE4F1SZPSJ47HCGRXH4XMN"}`.

## Como obter uma sessão BFF programaticamente

O BFF (`src/modules/bff`) é um "Full BFF" (D-053/D-054): não existe endpoint de password-grant
direto — a única forma de logar é o fluxo OIDC Authorization Code + PKCE completo contra o Cognito
Hosted UI (`/bff/login` → redirect para o Hosted UI → login → redirect para `/bff/callback?code=
...&state=...` → o BFF troca o code no backchannel e seta os cookies de sessão). Não há atalho:
`handleCallback` (`src/modules/bff/application/bff-auth-service.ts`) só aceita um `code` real
emitido pelo Hosted UI para o `code_challenge` que o próprio `/bff/login` gerou.

Script reutilizável: **`docs/engineering/performance/traces/perf-04-auth.mjs`**. Usa o Playwright
já instalado em `frontend/node_modules` (headless Chromium) para:

1. Acessar `https://d1mbs2t047qo9d.cloudfront.net/bff/login?returnTo=/` (302 para o Hosted UI).
2. Preencher e submeter o formulário de login do Hosted UI com as credenciais lidas de
   `docs/engineering/performance/.local/perf-test-tenant-credentials.txt`.
3. Aguardar o redirect de volta para o `APP_ORIGIN` (passando por `/bff/callback`, que seta os
   cookies `__Host-et_session` e `__Host-et_csrf`).
4. Extrair os cookies do `BrowserContext` e gravar em
   `docs/engineering/performance/.local/perf-04-session-cookies.json` (gitignored) — inclui o
   `cookieHeader` pronto para reuso em `curl -H "Cookie: ..."` ou `fetch`, e o valor do CSRF
   token (necessário no header `X-CSRF-Token` em toda chamada de mutação, junto com
   `Sec-Fetch-Site: same-origin` — ver `src/modules/bff/domain/csrf.ts`).

Uso:

```bash
node docs/engineering/performance/traces/perf-04-auth.mjs
```

A sessão emitida tem TTL bem acima de uma sessão de trabalho (`SESSION_ABSOLUTE_TTL_SECONDS` em
`src/modules/bff/domain/cookies.ts`), então o JSON gravado pode ser reaproveitado em chamadas
subsequentes sem rerodar o script, até expirar.

Nota de implementação: o Hosted UI renderiza dois elementos `#signInFormUsername` idênticos no DOM
(um oculto); o script usa o seletor `:visible` do Playwright para escapar do modo estrito.

## Dados semeados (via API normal do produto, nunca escrita direta no DynamoDB)

- **7 Items** (`POST /bff/api/items`), categoria "Licenca", `dueDate` em 2026-12-01, nomes
  "PERF Test Item 1".."PERF Test Item 7" — todos `201 Created`.
- **2 Subjects** (`POST /bff/api/subjects`):
  - `subject_01M2GE65D5XGV7CXQ6ECB9YYAD` — type `VENDOR`, "PERF Test Vendor A"
  - `subject_01M2GE66E87WZVGDDSAXE0QN5V` — type `CLIENT`, "PERF Test Client B"
  - Ambos `201 Created`.
- **Document Archive**: **não semeado**. Tentativa de `POST /bff/api/document-archive/requirements`
  (payload mínimo válido: `subjectId` + `name` + `applicability: "APPLICABLE"`) retornou
  `500 INTERNAL` — `"DynamoDB access denied during OrganizationStore.queryGsi4."`. Isso é uma
  lacuna de permissão IAM real no ambiente dev (não um erro de payload), fora do escopo desta
  tarefa de preparar o tenant. Registrado aqui como achado, não corrigido.

Escala deliberadamente pequena (5-10 registros) — este tenant é para medir latência (PERF-04/05),
não para carga (isso é PERF-11).

## Verificação dos endpoints (sessão real, tenant real)

| Endpoint | Método | Status | Resultado |
|---|---|---|---|
| `/bff/session` | GET | 200 | `{"authenticated":true,"activeOrganizationId":"org_01M2GE4F1SZPSJ47HCGRXH4XMN"}` |
| `/bff/api/items/dashboard` | GET | 200 | `{"items":[...7 itens...],"nextCursor":...}` — 7 items confirmados |
| `/bff/api/subjects/dashboard` | GET | 200 | 2 subjects (Vendor A, Client B) |
| `/bff/api/subjects/{subjectId}` | GET | 200 | Subject individual (Vendor A) retornado completo |
| `/bff/api/reports/expiring-soon-items` | GET | 500 | `INTERNAL` — `"Unexpected token 'i', \"itemId,nam\"... is not valid JSON"`. Achado real: o handler de reports devolve CSV, mas `handleProxy` (`src/modules/bff/http/bff-handlers.ts`) sempre faz `JSON.parse(result.body)` — gap não relacionado à preparação do tenant, fora do escopo desta tarefa. |

4 dos 5 endpoints checados confirmaram 2xx com corpo não vazio. O 5º (`reports/expiring-soon-items`)
expôs um bug pré-existente no proxy do BFF para rotas de relatório CSV — vale um item de
acompanhamento separado antes de usar essa rota em qualquer medição de PERF-04.

## Arquivos

- `docs/engineering/performance/traces/perf-04-auth.mjs` — script de autenticação reutilizável (committed).
- `docs/engineering/performance/.local/perf-test-tenant-credentials.txt` — credenciais (gitignored, já existia).
- `docs/engineering/performance/.local/perf-04-session-cookies.json` — sessão obtida nesta execução (gitignored, gerado pelo script acima).
