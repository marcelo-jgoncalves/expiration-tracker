# Expiration Tracker — Análise Profunda de BFF e Padrão de Qualidade do Frontend

**Data da análise:** 23 de agosto de 2026

---

## 1. Objetivo

Este documento consolida a análise do repositório do **Expiration Tracker** sob a perspectiva de **frontend + BFF (Backend for Frontend)** e estabelece um padrão objetivo para avaliar a qualidade do frontend ao longo do desenvolvimento.

A intenção é definir, antes da implementação avançar, um conjunto de:

- princípios arquiteturais;
- critérios de qualidade;
- gates eliminatórios;
- métricas objetivas;
- padrões de segurança;
- padrões de acessibilidade;
- padrões de testes;
- padrões de performance;
- requisitos de observabilidade;
- critérios de aprovação.

O objetivo é que o frontend seja avaliado com o mesmo rigor aplicado ao restante da engenharia do projeto.

---

# 2. Estado atual do repositório sob a perspectiva frontend/BFF

O projeto está muito bem preparado para receber um frontend de alto padrão.

O backend já possui capacidades que normalmente se tornam problemas somente depois que o frontend começa:

- contratos JSON Schema tratados como fonte de verdade;
- taxonomia de erros;
- optimistic concurrency;
- idempotência;
- isolamento de domínio;
- `RequestContext`;
- identidade interna separada do Cognito;
- tenant derivado da identidade e nunca do request;
- correlation IDs;
- observabilidade;
- segurança negativa;
- API Gateway + Lambda;
- arquitetura modular;
- enforcement de boundaries via dependency-cruiser;
- testes de integração e contrato.

O README atual deixa claro que TypeScript estrito, schemas, boundaries arquiteturais, testes e build já são gates formais de CI.

## 2.1 Frontend atual

O frontend propriamente dito ainda não existe em nível suficiente para uma avaliação de qualidade.

O blueprint prevê:

```text
Frontend
→ S3 privado
→ CloudFront
→ deploy imutável por hash
```

e a ordem de deployment já reserva explicitamente o frontend como camada posterior.

No código atual, a camada HTTP de `identity` ainda contém apenas infraestrutura inicial de rota de teste.

Portanto:

> **Nota atual do frontend: N/A**

Não existe implementação suficiente para receber nota.

O que podemos avaliar agora é a qualidade do desenho que orientará sua implementação.

---

# 3. Questão arquitetural importante no BFF atual

O blueprint já tomou várias decisões corretas:

- access token curto;
- refresh token com rotação;
- tokens fora de `localStorage`;
- tokens fora de `sessionStorage`;
- cookie `HttpOnly`;
- `Secure`;
- CSP;
- sessão intermediada pelo backend;
- logout por dispositivo/global.

Entretanto, há uma ambiguidade importante.

O blueprint descreve algo próximo de:

> **BFF de sessão**

com endpoints como:

```text
/session/refresh
/session/logout
```

e prevê que tokens OAuth permaneçam fora do JavaScript.

A questão fundamental passa a ser:

> Como o SPA chamará as APIs autenticadas se o access token não estiver acessível ao browser?

Esse boundary precisa ser definido de forma explícita antes da implementação.

---

# 4. Recomendação: Full BFF

A orientação atual do IETF para OAuth em aplicações browser-based apresenta o **Full Backend for Frontend** como a alternativa de maior segurança entre os padrões analisados.

O BFF completo assume três responsabilidades principais:

1. atuar como OAuth confidential client;
2. manter access token e refresh token fora do browser;
3. encaminhar as requisições ao resource server adicionando o access token server-side.

Esse padrão é especialmente recomendado para aplicações empresariais, sensíveis ou que manipulem dados pessoais.

O Expiration Tracker se encaixa bem nesse perfil.

## 4.1 Arquitetura recomendada

```text
Browser
   |
   | Cookie de sessão HttpOnly
   |
   v
CloudFront
   |
   +------------------------+
   |                        |
   | /*                     | /bff/*
   v                        v
S3 SPA                API Gateway
                           |
                           v
                       BFF Lambda
                           |
                   access token
                   somente servidor
                           |
                           v
                     Existing API
                     / ApiHandler
                           |
                           v
                    Application
                      Domain
```

O browser nunca recebe:

```text
access_token
refresh_token
```

Ele recebe apenas algo equivalente a:

```text
__Host-Http-session=<opaque-session-id>
```

---

# 5. A SPA estática pode ser mantida

A adoção de um Full BFF não exige abandonar a arquitetura de SPA estática.

CloudFront pode utilizar múltiplos origins e cache behaviors.

Exemplo:

```text
/*
→ S3
```

e:

```text
/bff/*
→ API Gateway / BFF
```

Tudo pode permanecer sob a mesma origem percebida pelo browser.

Exemplo:

```text
https://app.expirationtracker.com/
https://app.expirationtracker.com/assets/...
https://app.expirationtracker.com/bff/expirations
https://app.expirationtracker.com/bff/documents
```

Isso favorece:

- cookies;
- CSRF;
- CORS;
- CSP;
- simplicidade operacional;
- isolamento dos tokens.

Ao mesmo tempo, preserva:

- frontend estático;
- baixo custo;
- cache eficiente;
- deploy simples;
- operação reduzida.

---

# 6. Não há necessidade de adotar Next.js apenas para implementar BFF

Next.js suporta oficialmente o padrão BFF através de Route Handlers.

Essa seria uma opção tecnicamente válida.

Porém, neste projeto existem duas opções conceituais:

## Opção A

```text
SPA estática + BFF Lambda dedicado
```

```text
CloudFront
├── static → S3
└── /bff → API Gateway/Lambda
```

## Opção B

```text
Next.js runtime + Route Handlers
```

A opção B alteraria:

- deployment;
- caching;
- infraestrutura;
- runtime;
- boundary server/client;
- observabilidade;
- custos;
- CSP.

Sem necessidade clara de SSR ou Server Components, a **Opção A é mais coerente com a arquitetura atual**.

Regra:

> Não escolher framework apenas para resolver um problema que a infraestrutura serverless existente já resolve adequadamente.

---

# 7. Responsabilidades do BFF

O BFF deve atuar como uma camada de adaptação, segurança e orquestração orientada ao frontend.

## Pertence ao BFF

```text
OAuth/OIDC
session management
CSRF
cookie management
token refresh
logout
proxy seguro
UI-specific composition
DTO shaping
error normalization para UI
correlation propagation
idempotency propagation
request limits
timeouts
safe caching policy
```

O BFF também pode realizar composição específica para telas.

Exemplo:

```text
GET /bff/dashboard
```

poderia consultar internamente:

```text
expirations
notifications
document status
```

e retornar um view model adequado à UI.

---

# 8. O que NÃO pertence ao BFF

O BFF **não deve virar um segundo backend de negócio**.

Ele não deve decidir:

```text
quando algo está vencido
quando um reminder deve acontecer
se determinada renovação é válida
qual tenant deve ser usado
se determinado usuário possui autorização de negócio
como um documento muda de estado
como OCR é confirmado
como OCC funciona
como requisitos de domínio são calculados
```

Essas regras permanecem no backend atual.

Princípio arquitetural:

> **Frontend pede.  
> BFF adapta/orquestra.  
> Backend decide.**

O BFF não deve se tornar uma segunda fonte de verdade do domínio.

---

# 9. Revisão de cookies: SameSite

O blueprint atual define algo próximo de:

```text
HttpOnly
Secure
SameSite=Lax
```

A orientação atual de BFF recomenda preferencialmente:

```text
Secure
HttpOnly
SameSite=Strict
Path=/
Domain não definido
prefixo __Host-Http-* quando aplicável
```

Não deve ser feita uma troca cega de `Lax` para `Strict`.

A decisão precisa considerar:

- OAuth redirect;
- callback;
- login;
- logout;
- domínio;
- fluxos entre origens;
- comportamento real do IdP.

Regra:

> Se `SameSite=Strict` funcionar com o fluxo completo, deve ser preferido.

Se `Lax` for necessário, sua justificativa deve constar em ADR.

---

# 10. CSRF deve ser requisito de primeira classe

A adoção de autenticação baseada em cookie torna proteção contra CSRF um requisito explícito.

Não devemos confiar apenas em:

```text
SameSite=Lax
```

ou:

```text
SameSite=Strict
```

como defesa única.

O BFF deve possuir uma estratégia de CSRF comprovável.

Possíveis mecanismos devem ser avaliados formalmente de acordo com o fluxo adotado.

Gate obrigatório:

> **cookie-based authentication sem defesa CSRF comprovada = NOT APPROVED**

---

# 11. O BFF nunca deve ser um proxy aberto

Uma rota como:

```text
/bff/proxy?url=https://qualquer-destino.com
```

é proibida.

O browser nunca deve controlar arbitrariamente:

- hostname upstream;
- resource server;
- protocolo;
- destino do access token.

O BFF deve trabalhar com allowlists explícitas de:

- resource servers;
- paths;
- métodos;
- operações.

Exemplo aceitável:

```text
/bff/expirations/:id
```

mapeado explicitamente para:

```text
GET Backend /expirations/:id
```

---

# 12. Referenciais externos para o padrão de qualidade

O padrão de qualidade do frontend deve utilizar principalmente:

| Área | Referência |
|---|---|
| Segurança | OWASP ASVS 5.0 |
| OAuth/BFF | IETF OAuth Browser-Based Applications |
| Acessibilidade | WCAG 2.2 |
| Performance | Core Web Vitals |
| Testes de UI | Testing Library |
| Testes E2E | Playwright |
| Usabilidade | Nielsen Usability Heuristics |

Essas referências devem ser traduzidas para requisitos específicos do Expiration Tracker.

---

# 13. Frontend Quality Standard v1

A rubrica oficial recomendada é:

| Critério | Peso | Gate |
|---|---:|---|
| Correção funcional e de domínio | 15% | SIM |
| Segurança / BFF / sessão | 15% | SIM |
| Acessibilidade | 12% | SIM |
| Confiabilidade / state / recuperação | 10% | SIM |
| UX / usabilidade / eficiência | 10% | não |
| Performance | 10% | não |
| Arquitetura / manutenibilidade | 8% | não |
| Qualidade dos testes/evidências | 7% | não |
| Privacidade / minimização de dados | 5% | SIM |
| Observabilidade / supportability | 3% | não |
| Design system / consistência visual | 3% | não |
| Responsividade / compatibilidade | 2% | não |
| **Total** | **100%** | |

---

# 14. Fitness Function

Cada dimensão recebe nota:

```text
0.0 – 10.0
```

A nota geral será calculada como:

```text
FrontendOverall =
  0.15 FunctionalCorrectness
+ 0.15 SecurityBFF
+ 0.12 Accessibility
+ 0.10 Reliability
+ 0.10 UX
+ 0.10 Performance
+ 0.08 Architecture
+ 0.07 Testing
+ 0.05 Privacy
+ 0.03 Observability
+ 0.03 DesignSystem
+ 0.02 Compatibility
```

## Aprovação

```text
Overall >= 9.0
AND
nenhum gate violado
```

Se forem utilizadas avaliações independentes de dois agentes:

```text
Claude >= 9.0
AND
Codex >= 9.0
AND
nenhum gate
```

Critérios ainda não aplicáveis devem receber:

```text
N/A
```

e os pesos restantes devem ser renormalizados.

---

# 15. Gate FG1 — Correção funcional

Um frontend visualmente excelente que apresenta informação incorreta é inaceitável.

Exemplos de reprovação:

```text
data errada por timezone
status VALID para item vencido
renovação duplicada
salvamento apresentado como sucesso quando falhou
conflito OCC sobrescrito silenciosamente
estado de extração incorreto
ação executada no item errado
```

## Datas

Datas precisam ser tratadas como área crítica.

Devem existir testes para:

- date-only;
- timezone;
- DST;
- locale;
- virada de dia;
- datas futuras;
- datas passadas;
- input;
- serialização;
- API;
- renderização.

---

# 16. Gate FG2 — Segurança / BFF

Reprovação automática se houver:

- access token acessível ao JavaScript;
- refresh token acessível ao JavaScript;
- token em `localStorage`;
- token em `sessionStorage`;
- token em URL;
- BFF como proxy aberto;
- bypass de autenticação;
- falha crítica de CSRF;
- IDOR;
- cross-tenant;
- segredo dentro do bundle;
- autorização baseada somente na UI;
- CSP criticamente permissiva sem justificativa;
- erro expondo informação sensível.

OWASP ASVS 5.0 deve ser a principal referência verificável.

---

# 17. Gate FG3 — Acessibilidade

Alvo oficial:

> **WCAG 2.2 Level AA**

Não é necessário exigir AAA.

## Avaliação automatizada

Utilizar ferramentas como axe.

Objetivo mínimo em páginas e estados críticos:

```text
0 critical violations
0 serious violations
```

Entretanto, ferramentas automáticas não substituem avaliação humana.

## Avaliação manual obrigatória

Verificar:

- keyboard-only;
- focus order;
- visible focus;
- screen-reader semantics;
- labels;
- mensagens de validação;
- dialog focus trapping;
- status announcements;
- contraste;
- zoom;
- responsive reflow.

Uma jornada essencial impossível sem mouse:

> **NOT APPROVED**

---

# 18. Gate FG4 — Confiabilidade e recuperação

Toda operação assíncrona importante deve possuir estados coerentes:

```text
idle
loading
success
error
```

Quando aplicável:

```text
retrying
processing
stale
conflict
```

## Exemplo OCC

```text
Usuário A abre item v3
Usuário B altera → v4
Usuário A salva v3
Backend → 409
```

O frontend não deve realizar retry cego.

Ele deve informar que o item foi alterado e permitir reconciliação.

Também são requisitos:

- double-click não criar mutação duplicada;
- retry não duplicar comandos;
- timeout não ser tratado como falha definitiva quando o resultado é desconhecido;
- sessão expirada possuir recuperação adequada;
- dados de formulário não desaparecerem após erro recuperável.

---

# 19. UX / Usabilidade

UX deve ser avaliada por tarefas e heurísticas, não por preferência estética.

Referenciais:

- visibilidade do estado;
- linguagem compatível com o usuário;
- controle e liberdade;
- consistência;
- prevenção de erro;
- reconhecimento em vez de memorização;
- recuperação de erros;
- eficiência.

O sistema deve evitar exigir que o usuário memorize:

```text
quem era o responsável
qual documento faltava
qual status significa o quê
qual data estava cadastrada
qual item acabou de ser alterado
```

A interface deve tornar essas informações perceptíveis.

---

# 20. Performance

Os Core Web Vitals serão utilizados como métricas objetivas.

Alvo no percentil 75:

| Métrica | Alvo |
|---|---:|
| LCP | ≤ 2,5 s |
| INP | ≤ 200 ms |
| CLS | ≤ 0,1 |

Esses valores devem ser medidos em produção através de RUM quando houver volume suficiente de usuários.

Enquanto isso, métricas sintéticas podem ser utilizadas como leading indicators.

Lighthouse é útil para CI e desenvolvimento, mas não substitui dados reais de usuários.

---

# 21. Arquitetura do frontend

O frontend deve possuir boundaries claros.

Estrutura conceitual possível:

```text
app/

features/
  expirations/
  documents/
  reminders/
  notifications/
  identity/

shared/
  ui/
  api/
  forms/
  errors/
  dates/
```

Os nomes podem mudar.

O princípio é mais importante:

```text
feature expiration
não importa internals de document

feature document
não manipula internal state de reminder
```

O frontend pode utilizar enforcement automático semelhante ao `dependency-cruiser` usado no backend.

---

# 22. Contratos de API

O frontend não deve recriar manualmente tipos que já possuem contrato canônico no backend.

Idealmente:

```text
JSON Schema
     ↓
generated types/client
     ↓
BFF/API boundary
```

Isso reduz divergência entre:

```text
backend contract
```

e:

```text
frontend assumption
```

Devem existir contract tests no boundary BFF ↔ backend.

---

# 23. Estratégia de testes

## Unit tests

Para:

- funções puras;
- datas;
- transforms;
- mappers;
- formatters;
- reducers;
- regras locais de apresentação.

## Component tests

Utilizar Testing Library.

Princípio:

> Quanto mais o teste se aproxima da forma como o usuário interage com o software, maior sua capacidade de gerar confiança.

Preferir consultas baseadas em semântica, especialmente:

```text
getByRole
```

em vez de seletores estruturais frágeis.

## Contract tests

Testar BFF ↔ backend.

## Integration tests

Testar:

- BFF;
- sessão;
- cookies;
- autenticação;
- refresh;
- upstream;
- error mapping.

## E2E

Utilizar Playwright.

Os testes devem ser:

- isolados;
- orientados a comportamento visível;
- baseados em locators perceptíveis ao usuário.

## Accessibility

axe + avaliação manual.

## Performance

Lighthouse durante desenvolvimento + RUM em produção.

---

# 24. Fluxos E2E obrigatórios

Antes de produção, devem existir testes reais para:

```text
login
session restore
session refresh
logout

listar vencimentos
criar vencimento
editar vencimento
renovar vencimento
conflito OCC

upload
malware processing states
extraction pending
confirmação/rejeição da extração

erro 401
erro 403
erro 409
erro 429
erro 500
timeout/network failure

cross-tenant negativo

timezone/DST

keyboard-only critical journey
```

Conforme novas features forem introduzidas:

```text
supplier
requirement
document request
guest link
guest upload
approval
automated chasing
```

---

# 25. Gate FG5 — Privacidade

Dados sensíveis não devem aparecer desnecessariamente em:

```text
URL
query string
localStorage
sessionStorage
logs
analytics
error tracking
telemetry breadcrumbs
```

O BFF deve aplicar data minimization.

Se uma tela precisa apenas:

```json
{
  "id": "...",
  "name": "...",
  "status": "EXPIRING"
}
```

não deve receber por conveniência:

```text
Cognito sub
internal membership state
provider IDs
security metadata
audit internals
```

---

# 26. Observabilidade de frontend

O sistema deve permitir responder com dados a:

> O frontend está saudável?

Devem ser observáveis pelo menos:

```text
JS exceptions
failed requests
BFF 4xx
BFF 5xx
BFF latency
upstream latency
Core Web Vitals
authentication failures
session refresh failures
route load failures
```

Quando fizer sentido, o correlation ID deve atravessar:

```text
browser request
      ↓
BFF
      ↓
ApiHandler
      ↓
worker/event
```

sem expor informações sensíveis.

---

# 27. Design System

O objetivo não é construir um framework visual próprio.

O objetivo é consistência.

Primitivas reutilizáveis esperadas:

```text
Button
Input
Select
DateInput
Dialog
Toast
Table
Badge
EmptyState
ErrorState
Skeleton
```

Especial atenção aos estados semânticos do domínio:

```text
VALID
EXPIRING
EXPIRED
PENDING
ERROR
```

Sempre que possível, utilizar componentes acessíveis e já testados.

---

# 28. Responsividade e compatibilidade

O Expiration Tracker é um SaaS administrativo e provavelmente terá grande uso em desktop.

Portanto, não existe obrigação ideológica de "mobile-first".

Entretanto:

- nenhuma tela pode quebrar em mobile;
- ações essenciais devem continuar disponíveis;
- tabelas precisam de estratégia responsiva;
- touch targets devem ser adequados;
- zoom não pode destruir a experiência;
- Chrome, Edge, Firefox e Safari modernos devem ser considerados.

---

# 29. Processo de avaliação durante o desenvolvimento

A avaliação deve ocorrer em três níveis.

## 29.1 Durante cada PR

Gates automáticos:

```text
typecheck
lint
architecture boundaries
unit tests
component tests
contract tests
a11y automated
build
security/dependency checks
```

---

## 29.2 Ao terminar cada feature

Exemplo:

```text
Create Expiration
```

avaliar:

```text
functional
security
accessibility
UX
reliability
tests
```

Critérios não aplicáveis recebem:

```text
N/A
```

Os pesos aplicáveis são renormalizados.

---

## 29.3 Ao finalizar milestone/release

Aplicar a rubrica completa.

Exemplo:

```text
Claude independent score
Codex independent score

Overall >= 9.0
nenhum gate
```

---

# 30. Gates eliminatórios oficiais

| Gate | Reprovação automática |
|---|---|
| FG1 Security/BFF | token exposure, auth bypass, CSRF crítico, IDOR/cross-tenant, open proxy |
| FG2 Functional Correctness | informação ou ação crítica incorreta, corrupção silenciosa |
| FG3 Accessibility | jornada essencial inacessível ou blocker WCAG A/AA conhecido |
| FG4 Reliability | mutação perdida/duplicada ou estado crítico inconsistente |
| FG5 Privacy | token ou PII sensível exposto indevidamente |

Além disso:

```text
nota de qualquer gate < 7.0
→ NOT APPROVED
```

mesmo que a média geral seja ≥ 9.0.

---

# 31. Avaliação atual do desenho do BFF

## Fundamentos

Muito bons:

- tokens fora do Web Storage;
- session abstraction;
- CSP;
- RequestContext;
- tenant resolution;
- authz centralizada;
- API contracts;
- security-negative testing;
- static SPA;
- immutable deploy.

## Principal problema

O conceito atual de:

```text
small session BFF
```

é insuficientemente definido.

A recomendação é evoluir para:

```text
browser
  ↓
FULL BFF
  ↓
resource API
```

## Segunda revisão

Reavaliar formalmente:

```text
SameSite=Lax
```

versus:

```text
SameSite=Strict
```

## Terceira revisão

Formalizar:

- CSRF;
- outbound proxy allowlisting;
- token lifecycle;
- cookie semantics;
- session storage.

---

# 32. ADR recomendado

Criar antes da implementação:

```text
ADR-XXXX
Full BFF as Browser Security Boundary
```

O ADR deve decidir explicitamente:

```text
browser never receives OAuth tokens

opaque session cookie

cookie attributes

CSRF strategy

same-origin deployment

CloudFront routing

BFF → resource API authentication

token refresh lifecycle

session storage model

logout semantics

proxy allowlist

error mapping

correlation IDs

cache policy

rate limiting

BFF vs domain responsibility
```

Essa é uma decisão arquitetural estrutural e deve ser tratada como Type 1.

---

# 33. Documentos normativos recomendados

Criar:

```text
docs/frontend/
    bff-architecture.md
    bff-threat-model.md
    frontend-quality-criteria.md
    frontend-fitness-function.md
```

Posteriormente:

```text
frontend-testing-strategy.md
```

Esses documentos devem traduzir as referências externas para regras verificáveis do Expiration Tracker.

---

# 34. Baseline oficial para avaliações futuras

## Arquitetura

> **Full BFF + browser sem OAuth tokens + backend como source of truth do domínio**

## Segurança

> **OWASP ASVS 5.0 + guidance atual do IETF para BFF**

## Acessibilidade

> **WCAG 2.2 AA**

## Performance

> **Core Web Vitals p75**
>
> - LCP ≤ 2,5 s
> - INP ≤ 200 ms
> - CLS ≤ 0,1

## UX

> **avaliação heurística + tarefas reais**

## Testes

> **user-centric component tests + Playwright E2E + contract/integration tests + accessibility**

## Qualidade final

> **12 eixos ponderados**
>
> **Overall ≥ 9.0**
>
> **nenhum gate eliminatório**

---

# 35. Exemplo de avaliação futura

O frontend poderá receber algo como:

```text
Functional Correctness       9.4
Security / BFF              9.2
Accessibility               8.7
Reliability                 9.3
UX                          9.1
Performance                 9.0
Architecture                9.4
Testing                     9.2
Privacy                     9.5
Observability               8.8
Design System               9.1
Compatibility               9.0

Overall                     9.12
```

Se não houver gate:

```text
APPROVED
```

Mas mesmo com média 9.5:

```text
CSRF vulnerability
```

resultaria em:

```text
NOT APPROVED
```

---

# 36. Conclusão

O estado atual do Expiration Tracker é particularmente favorável para começar a implementação do BFF e do frontend.

O backend já possui boundaries e garantias que normalmente são introduzidas muito mais tarde em projetos de software.

A principal recomendação arquitetural é:

> **não implementar literalmente um pequeno "session BFF" limitado a refresh/logout.**

A camada deve evoluir para um:

> **Full Backend for Frontend**

onde:

```text
Browser
   ↓
Full BFF
   ↓
Existing Resource API
   ↓
Application
   ↓
Domain
```

O browser não recebe tokens OAuth.

O BFF se torna a security boundary do browser, mas permanece apenas como:

- adaptador;
- session manager;
- proxy controlado;
- orchestration layer orientada à UI.

O backend continua como fonte de verdade de:

- domínio;
- autorização;
- tenant;
- regras;
- workflows;
- consistência.

Também fica estabelecido o padrão de qualidade que será utilizado ao longo do desenvolvimento.

A partir desse ponto, a avaliação do frontend deixa de ser subjetiva.

Ela passa a considerar objetivamente:

- correção;
- segurança;
- acessibilidade;
- confiabilidade;
- UX;
- performance;
- arquitetura;
- testes;
- privacidade;
- observabilidade;
- consistência visual;
- compatibilidade.

Esse padrão deve acompanhar o frontend desde o primeiro PR até cada release posterior.

---

# 37. Referências utilizadas na análise

- OWASP Application Security Verification Standard 5.0
- IETF OAuth 2.0 for Browser-Based Applications
- W3C Web Content Accessibility Guidelines 2.2
- web.dev — Core Web Vitals
- Testing Library documentation
- Playwright documentation
- Nielsen Norman Group — 10 Usability Heuristics
- AWS CloudFront documentation
- Next.js Backend for Frontend guidance

Também foram analisados os documentos e estruturas do repositório do Expiration Tracker, incluindo:

- README;
- implementation blueprint;
- quality criteria;
- fitness function;
- módulos de identity;
- contratos;
- arquitetura;
- infraestrutura;
- CI/CD;
- boundaries existentes.

---

## Decisão principal

> **Adotar Full BFF como fronteira de segurança do browser e utilizar a rubrica definida neste documento como padrão oficial para todas as avaliações futuras do frontend do Expiration Tracker.**
