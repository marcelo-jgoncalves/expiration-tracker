---
status: PROPOSED
owner: Marcelo Gonçalves
authority: frontend-engineering-standard
scope:
  - frontend/**
  - src/modules/bff/**
  - browser-facing API/contracts
  - frontend delivery/security configuration
  - frontend design-system implementation
last_reviewed: 2026-08-30
---

# Expiration Tracker — Frontend Engineering Quality Standard v1

## 1. Propósito

Este documento estabelece o padrão persistente de **engenharia de frontend** do Expiration Tracker.

Ele deve ser consultado e avaliado sempre que uma mudança afetar direta ou indiretamente:

```text
frontend/**
src/modules/bff/**
sessão/browser security boundary
contratos consumidos pelo browser
estado/cache do frontend
autenticação/autorização percebida pelo frontend
roteamento
forms
componentes
Design System
acessibilidade
performance
observabilidade do browser
deploy/entrega do frontend
```

O objetivo não é produzir apenas uma interface visualmente boa.

O objetivo é manter um frontend:

```text
correto
seguro
acessível
confiável
observável
testável
performático
manutenível
responsivo
coerente com o domínio
coerente com o Design System
fácil de diagnosticar quando algo falha
```

O frontend deve receber o mesmo rigor de engenharia aplicado ao backend.

---

# 2. Relação com o Definition of Done

Este documento **não substitui o Definition of Done global do projeto**.

O Definition of Done é o gate final de conclusão.

Este padrão é uma especialização que fornece:

```text
critérios
+
gates
+
métricas
+
evidências
```

para mudanças de frontend.

A relação normativa é:

```text
AGENTS.md
        ↓
Definition of Done global
        ↓
Frontend Engineering Quality Standard
        ↓
Interface Quality Standard
        ↓
Design System
        ↓
critério específico da task
```

Respeitar a precedência oficial corrente do repositório caso ela seja mais específica.

Uma mudança de frontend só é considerada **DONE** quando:

```text
acceptance criteria da mudança
+
gates aplicáveis deste padrão
+
Definition of Done global
```

estiverem satisfeitos.

Uma nota alta neste documento **não substitui** o DoD.

Exemplo:

```text
FrontendOverall = 9.4
```

mas:

```text
E2E obrigatório não executado
```

significa:

```text
NOT DONE
```

---

# 3. Definition of Done e epistemic integrity

O Expiration Tracker diferencia estados de evidência.

Manter essa disciplina também no frontend:

```text
DESIGNED
IMPLEMENTED
UNIT TESTED
INTEGRATION TESTED
DEPLOYED
E2E PROVEN
OPERATIONALLY PROVEN
USER VALIDATED
```

Nunca inferir:

```text
IMPLEMENTED
=
E2E PROVEN
```

ou:

```text
E2E PROVEN
=
USER VALIDATED
```

O relatório de qualquer trabalho de frontend deve declarar honestamente o nível alcançado.

---

# 4. Documentos complementares

Este padrão governa **engenharia**.

Não duplicar responsabilidades de outros documentos.

## 4.1 Interface Quality Standard

Documento corrente esperado:

```text
docs/frontend/interface-quality-standard.md
```

Responsável por:

- adequação à tarefa;
- arquitetura da informação;
- hierarquia visual;
- feedback percebido;
- prevenção/recuperação de erros;
- formulários enquanto interação;
- tabelas/listas/filtros enquanto UX;
- microcopy;
- confiança;
- qualidade da interação.

Mudança user-visible relevante precisa atender também esse padrão.

---

## 4.2 Design System

Documento corrente esperado:

```text
docs/frontend/design-system.md
```

ou o caminho reconciliado adotado pelo repositório.

Responsável por:

- tokens;
- tipografia;
- cores;
- spacing;
- radius;
- motion;
- componentes;
- padrões visuais;
- estados visuais;
- Operational Calm.

Este padrão de engenharia verifica **conformidade e qualidade de implementação** do Design System.

---

# 5. Stack de referência atual

A stack observada no frontend do projeto durante a elaboração deste padrão é:

```text
React
TypeScript
Vite
React Router
TanStack Query
Vitest
Testing Library
Playwright
eslint-plugin-jsx-a11y
```

As versões podem evoluir.

O padrão é durável; ele não deve ser reescrito apenas por upgrade de versão.

Qualquer mudança estrutural de stack deve ser tratada de acordo com:

```text
docs/engineering/change-risk-scale.md
```

e o protocolo Claude ↔ Codex quando aplicável.

---

# 6. Princípios fundamentais

## FE-P1 — Backend continua source of truth do domínio

O frontend apresenta, solicita e orquestra interação.

O frontend não redefine regras de domínio.

```text
Frontend pede
BFF adapta
Backend decide
```

Não duplicar no browser regras como:

- quando algo está vencido;
- autorização de negócio;
- tenant membership;
- validade de renovação;
- transições de Document;
- regras de Reminder;
- regras de extração;
- lifecycle do tenant.

---

## FE-P2 — Browser não é trust boundary

Nada recebido do browser é confiável por padrão.

Especialmente:

```text
organizationId
tenantId
role
permission
userId
price/entitlement
resource ownership
```

A UI pode usar essas informações para experiência.

O backend precisa verificar a autoridade real.

---

## FE-P3 — Epistemic Integrity

A interface nunca deve parecer saber mais do que o sistema sabe.

Estados diferentes permanecem diferentes:

```text
pending
confirmed
failed
unknown
scheduled
sent
delivered
clean
approved
```

Não comprimir estados para simplificar a UI quando isso cria falsa confiança.

---

## FE-P4 — Failure is a first-class state

Toda operação relevante precisa possuir comportamento claro para:

```text
loading
success
error
timeout
unknown outcome
conflict
unauthorized
forbidden
rate limited
stale data
```

quando aplicável.

Happy path sozinho não é implementação concluída.

---

## FE-P5 — Accessibility by construction

WCAG 2.2 Level AA é baseline.

Acessibilidade não é polish posterior.

Componente inacessível é componente incompleto.

---

## FE-P6 — Observable failures

Quando ocorrer problema, deve ser possível responder:

```text
o que falhou?
onde?
para qual request?
qual correlationId?
qual rota?
qual estado o usuário viu?
o retry é seguro?
```

sem depender de reprodução manual aleatória.

---

## FE-P7 — State ownership explícito

Cada estado precisa ter um dono claro.

Preferências:

```text
server state
→ TanStack Query

route state
→ router/URL quando apropriado

form state
→ formulário/componente

session state
→ BFF/session contract

global client state
→ somente quando realmente global
```

Não introduzir store global por conveniência.

---

## FE-P8 — Server state não é application state local

Não duplicar cache remoto em múltiplos estados React.

Evitar:

```text
query result
→ copiar para useState
→ editar silenciosamente
→ divergir do servidor
```

quando não houver razão explícita.

---

## FE-P9 — Segurança não depende da UI

Ocultar botão por permission é UX.

Não é autorização.

Toda operação sensível deve falhar corretamente quando chamada sem autoridade.

---

## FE-P10 — Trabalho difícil agora é aceitável

O projeto está em desenvolvimento e sem pressão artificial de lançamento.

Não preservar arquitetura inferior apenas porque a correção é trabalhosa.

Se uma decisão estrutural:

- reduz dívida futura;
- melhora isolamento;
- melhora segurança;
- melhora observabilidade;
- melhora extensibilidade;
- evita migração perigosa depois;

ela deve ser considerada seriamente agora.

Overengineering significa complexidade sem benefício plausível, não trabalho tecnicamente profundo.

---

# 7. Rubrica oficial

A rubrica preserva os 12 eixos já definidos anteriormente para engenharia de frontend.

| Eixo | Peso | Gate eliminatório |
|---|---:|---|
| 1. Correção funcional e de domínio | 15% | SIM |
| 2. Segurança / BFF / sessão | 15% | SIM |
| 3. Acessibilidade | 12% | SIM |
| 4. Confiabilidade / estado / recuperação | 10% | SIM |
| 5. UX / usabilidade / eficiência | 10% | via Interface Standard |
| 6. Performance | 10% | não |
| 7. Arquitetura / manutenibilidade | 8% | não |
| 8. Qualidade de testes e evidências | 7% | não |
| 9. Privacidade / minimização | 5% | SIM |
| 10. Observabilidade / supportability | 3% | não |
| 11. Design System / consistência | 3% | não |
| 12. Responsividade / compatibilidade | 2% | não |
| **Total** | **100%** | |

Cada eixo aplicável recebe:

```text
0.0 – 10.0
```

Fitness function:

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

---

# 8. Critérios N/A

Nem todo eixo precisa ser reavaliado integralmente em uma alteração pequena.

Quando um critério realmente não for aplicável:

```text
N/A
```

Os pesos aplicáveis são renormalizados.

Nunca usar:

```text
0
```

para representar "não aplicável".

Nunca usar `N/A` para escapar de um eixo afetado indiretamente.

Exemplo:

```text
refactor de API client
```

pode não alterar visual design, mas pode afetar:

```text
reliability
testing
architecture
privacy
observability
```

---

# 9. Gate geral de aprovação

Para uma avaliação formal completa:

```text
FrontendOverall >= 9.0
AND
nenhum gate eliminatório violado
AND
nenhum S4 aberto
AND
nenhum S3 aberto em fluxo crítico
AND
Definition of Done global satisfeito
```

Se protocolo Claude ↔ Codex for obrigatório:

```text
Claude >= 9.0
AND
Codex >= 9.0
AND
nenhum gate violado
```

Não arredondar:

```text
8.99 != 9.0
```

---

# 10. Eixo 1 — Correção funcional e de domínio

Peso:

```text
15%
```

Pergunta:

> O frontend apresenta e modifica o estado real do sistema corretamente?

Avaliar:

- contratos API corretos;
- datas;
- timezone;
- status;
- mutation payload;
- idempotency propagation;
- OCC/version;
- error mapping;
- query invalidation;
- cache;
- tenant context;
- organization switching;
- role/permission presentation;
- loading/result transitions;
- serialization;
- stale state.

Falhas críticas incluem:

```text
data errada
status incorreto
item errado alterado
renovação duplicada
sucesso mostrado quando operação falhou
UNKNOWN_OUTCOME mostrado como erro definitivo
conflito OCC sobrescrito
cache de outro tenant exibido
ação executada na Organization errada
```

---

# 11. Datas são domínio crítico

Sempre testar quando afetadas:

```text
date-only
timezone
DST quando aplicável
locale pt-BR
virada de dia
datas passadas
datas futuras
serialização
input
renderização
API round-trip
```

Nunca usar parsing implícito de data quando isso puder deslocar dia/calendário.

---

# 12. OCC

Quando o backend responde conflito:

```text
409
```

o frontend não deve:

```text
retry cegamente
```

nem:

```text
sobrescrever estado remoto
```

Deve permitir compreender e reconciliar o conflito.

O dado local do usuário deve ser preservado quando possível.

---

# 13. Idempotência

Mutations que possuem idempotency contract devem propagá-lo corretamente.

Testar:

```text
double click
retry
network timeout
browser retry
re-render
back navigation
```

O frontend não deve gerar efeitos duplicados por comportamento de UI.

---

# 14. Eixo 2 — Segurança / BFF / sessão

Peso:

```text
15%
```

Baseline arquitetural:

> **Full BFF como browser security boundary.**

O browser não recebe:

```text
access_token
refresh_token
```

Gate automático de reprovação se houver:

- OAuth token acessível ao JavaScript;
- token em `localStorage`;
- token em `sessionStorage`;
- token na URL;
- refresh token no browser;
- auth bypass;
- BFF open proxy;
- CSRF crítico;
- IDOR;
- cross-tenant;
- segredo no bundle;
- autorização apenas na UI;
- CSP criticamente permissiva sem decisão registrada;
- session fixation;
- session resurrection;
- erro expondo segredo;
- Organization selecionada tratada como autorização.

Base principal:

```text
OWASP ASVS 5.0.0
```

---

# 15. Full BFF

O BFF pode:

- manter sessão;
- armazenar tokens server-side;
- renovar tokens;
- aplicar CSRF;
- normalizar erros;
- compor view models;
- propagar correlation/idempotency;
- limitar chamadas;
- controlar upstream.

O BFF não pode:

- duplicar domínio;
- decidir autorização definitiva por conta própria quando backend é autoridade;
- aceitar upstream arbitrário;
- transformar-se em proxy aberto.

---

# 16. Cookies

Session cookie deve seguir o contrato arquitetural vigente.

Propriedades esperadas quando aplicáveis:

```text
HttpOnly
Secure
Path apropriado
Domain mínimo/ausente
SameSite conforme ADR
```

Não alterar cookie/security semantics localmente em uma feature.

Mudanças de session/cookie/CSRF são de alto risco e devem seguir `change-risk-scale.md`.

---

# 17. CSRF

Autenticação baseada em cookie exige defesa de CSRF comprovável.

Não assumir:

```text
SameSite
```

como defesa universal.

Mutation protegida precisa respeitar o contrato CSRF do BFF.

---

# 18. Multi-User B2B

Após a migração B2B:

```text
User != Tenant
Organization = Tenant
```

O browser pode selecionar:

```text
activeOrganizationId
```

mas isso nunca é autoridade.

O backend precisa revalidar Membership/permission/lifecycle.

Frontend deve testar explicitamente:

```text
userId != tenantId
```

e:

```text
mesmo User
→ múltiplas Organizations
```

---

# 19. Cache cross-Organization

Toda query tenant-scoped deve possuir Organization/tenant no identity da cache.

Exemplo conceitual:

```text
[organizationId, resource, params]
```

Trocar de Organization não pode exibir:

- lista;
- detail;
- form initial data;
- optimistic state;
- mutation result;

da Organization anterior.

Esse caso é security-sensitive.

---

# 20. Eixo 3 — Acessibilidade

Peso:

```text
12%
```

Alvo oficial:

```text
WCAG 2.2 Level AA
```

Referência:

https://www.w3.org/TR/WCAG22/

WCAG 2.2 recomenda:

- contraste mínimo 4.5:1 para texto normal;
- 3:1 para texto grande;
- foco visível;
- foco não obscurecido;
- target mínimo 24×24 CSS px ou exceção aplicável;
- reflow;
- labels;
- error identification;
- status messages;
- keyboard operability;
- accessible authentication.

O Design System adota targets maiores quando apropriado.

---

# 21. Acessibilidade automatizada

Para páginas/estados críticos:

```text
0 critical axe violations
0 serious axe violations
```

A automação não prova conformidade completa.

---

# 22. Acessibilidade manual

Quando a mudança afeta interação, verificar conforme aplicável:

```text
keyboard-only
focus order
focus visible
focus return
dialog focus trap
screen-reader semantics
accessible names
labels
validation messages
status announcements
contrast
200% text zoom
responsive reflow
target sizes
dragging alternatives
```

Uma jornada crítica impossível por teclado:

```text
NOT APPROVED
```

---

# 23. Componentes complexos

Para:

```text
dialog
menu
combobox
tabs
grid
listbox
tree
```

usar HTML nativo quando possível.

Quando ARIA pattern for necessário:

```text
WAI-ARIA Authoring Practices Guide
```

é a referência técnica.

Não criar widget customizado mais frágil que um elemento nativo.

---

# 24. Eixo 4 — Confiabilidade / estado / recuperação

Peso:

```text
10%
```

Toda operação assíncrona relevante deve representar estados coerentes.

Baseline:

```text
idle
loading
success
error
```

Quando aplicável:

```text
processing
retrying
stale
conflict
unknown outcome
session expired
forbidden
rate limited
```

---

# 25. Unknown Outcome

Timeout não significa automaticamente:

```text
FAILED
```

Se o backend pode ter processado a operação:

```text
resultado desconhecido
```

precisa ser representado honestamente.

A UX deve orientar:

- refresh/reconciliation;
- consulta de estado;
- safe retry quando provado;
- suporte/correlation ID quando necessário.

---

# 26. Form preservation

Erro recuperável não deve apagar silenciosamente dados digitados.

Testar:

```text
validation error
409
429
500
network failure
session refresh
```

quando aplicável.

---

# 27. Abort / request cancellation

Abortar request de leitura é diferente de desfazer mutation.

Não assumir que:

```text
AbortController.abort()
```

cancela side effect já admitido no servidor.

A UI deve preservar a semântica real.

---

# 28. TanStack Query

Usar TanStack Query como owner preferencial de server state.

Regras:

- query keys estáveis;
- tenant/Organization em keys tenant-scoped;
- invalidation explícita;
- mutation lifecycle previsível;
- optimistic updates somente quando rollback/reconciliation forem confiáveis;
- não configurar retry agressivo para mutations;
- erros auth não entram em loop;
- stale data precisa ser semanticamente aceitável.

---

# 29. Eixo 5 — UX / usabilidade / eficiência

Peso:

```text
10%
```

Este eixo é avaliado pelo:

```text
docs/frontend/interface-quality-standard.md
```

Não duplicar sua rubrica aqui.

Quando a mudança altera comportamento percebido pelo usuário:

```text
Interface Quality Standard
→ aplicável
```

A aprovação completa precisa satisfazer os gates de ambos os padrões.

---

# 30. Relação com InterfaceOverall

Quando houver mudança user-visible relevante:

```text
FrontendOverall >= 9.0
AND
InterfaceOverall >= 9.0
AND
nenhum Frontend Gate
AND
nenhum UI Gate
```

Uma refatoração interna sem impacto perceptível pode marcar InterfaceOverall:

```text
N/A
```

com justificativa.

---

# 31. Eixo 6 — Performance

Peso:

```text
10%
```

Core Web Vitals oficiais no p75:

```text
LCP <= 2.5 s
INP <= 200 ms
CLS <= 0.1
```

Referência:

https://web.dev/articles/vitals

Medir separadamente:

```text
mobile
desktop
```

quando houver RUM suficiente.

Durante pré-produção:

- Lighthouse;
- Playwright timing quando útil;
- bundle analysis;
- synthetic checks;

são leading indicators, não substitutos de RUM.

---

# 32. Performance não é só Lighthouse score

Avaliar também:

- JavaScript enviado;
- parsing/execution;
- route loading;
- request waterfalls;
- render loops;
- query fan-out;
- images/fonts;
- long tasks;
- layout shifts;
- unnecessary re-renders;
- loading de componentes pesados;
- cache correctness.

Não perseguir score cosmético sacrificando correctness.

---

# 33. Bundle regression

Não definir limite arbitrário universal antes de baseline confiável.

Entretanto:

> aumento relevante de bundle precisa ser visível e justificado.

Nova dependência grande exige:

```text
benefício
+
alternativas
+
impacto
+
evidência
```

---

# 34. Eixo 7 — Arquitetura / manutenibilidade

Peso:

```text
8%
```

O frontend deve possuir boundaries explícitos.

Estrutura conceitual:

```text
app/
features/
shared/
```

A estrutura real pode variar.

A regra é:

```text
feature não acessa internals de outra feature
```

sem contrato explícito.

---

# 35. Shared

`shared/` é para primitives realmente compartilhadas.

Não usar `shared` como pasta de tudo que não sabemos onde colocar.

Exemplos válidos:

```text
ui
api
dates
errors
forms
observability
```

quando reutilizados.

---

# 36. Domain logic

Não copiar regra do backend para:

```text
utils.ts
```

apenas para renderizar.

Preferir:

- contrato explícito;
- view model;
- campo derivado authoritative;
- helper de apresentação sem redefinir domínio.

---

# 37. API contracts

Não recriar manualmente tipos que já possuem contrato canônico.

Preferência:

```text
JSON Schema / canonical contract
        ↓
generated/validated TypeScript types
        ↓
BFF
        ↓
frontend
```

Mudança de contrato exige contract test.

---

# 38. TypeScript

Baseline:

```text
strict
```

Não introduzir:

```text
any
as unknown as
non-null assertions
```

como mecanismo rotineiro para silenciar o compilador.

Casting em boundary externo precisa ser precedido por validação real quando dado não é confiável.

---

# 39. React

Regras:

- componentes puros quando possível;
- efeitos apenas para sincronização externa;
- não usar `useEffect` como workflow engine;
- não duplicar derived state;
- keys estáveis;
- no state update after unmount bugs;
- side effects de mutation fora de render;
- Error Boundaries nas regiões apropriadas;
- Suspense apenas com semântica compreendida.

---

# 40. Global state

Introduzir state manager adicional somente com problema comprovado.

Não adicionar Redux/Zustand/etc. apenas por preferência.

Antes, provar que:

```text
URL
TanStack Query
React state/context
BFF session
```

não resolvem corretamente o caso.

---

# 41. Eixo 8 — Qualidade de testes e evidências

Peso:

```text
7%
```

Testes devem provar comportamento e risco.

Não buscar coverage numérico isoladamente.

A pergunta é:

> Os failure modes relevantes seriam detectados antes do merge?

---

# 42. Unit tests

Usar para:

- functions puras;
- date logic;
- mapping;
- parsing;
- formatting;
- reducers;
- local presentation rules.

---

# 43. Component tests

Usar Testing Library.

Preferir:

```text
getByRole
getByLabelText
getByText
```

conforme comportamento percebido.

Evitar:

```text
class selectors
DOM tree assumptions
implementation internals
```

---

# 44. Contract tests

Cobrir:

```text
frontend/BFF
BFF/backend
```

onde mudança de contrato cria risco.

Testar exemplos:

```text
valid
invalid
error
version evolution
```

quando aplicável.

---

# 45. Integration tests

Para BFF/session:

- login callback;
- session restore;
- refresh;
- CSRF;
- logout;
- logoutAll;
- session expiry;
- cookie semantics;
- upstream mapping;
- active Organization;
- membership revocation;
- error normalization.

---

# 46. E2E

Playwright é baseline.

Testar comportamentos críticos reais, não implementation detail.

Locators preferem:

```text
role
label
visible name
```

Evitar seletores frágeis.

---

# 47. Fluxos E2E críticos

Manter/expandir conforme produto evolui.

Baseline inclui:

```text
login
session restore
session refresh
logout
listar vencimentos
criar
editar
renovar
OCC
upload
processamento documental
401
403
409
429
500
timeout/network
keyboard critical journey
cross-tenant negative
```

Com B2B:

```text
create Organization
invite
accept
switch Organization
role change
membership revocation
cross-Organization denial
```

quando implementados.

---

# 48. Visual regression

Mudança visual em core surface exige:

```text
visual regression
```

quando o mecanismo existir e fizer sentido.

Baselines devem ser determinísticos.

Não atualizar snapshot automaticamente sem inspeção.

Uma mudança de screenshot precisa ser:

```text
esperada
+
revisada
```

---

# 49. Dense dataset

Telas data-dense precisam ser testadas com dados de stress plausíveis.

Não validar apenas:

```text
3 itens com nomes curtos
```

Testar:

- muitos registros;
- nomes longos;
- filtros combinados;
- estados variados;
- datas próximas;
- responsáveis diferentes;
- empty after filtering.

---

# 50. Eixo 9 — Privacidade / minimização

Peso:

```text
5%
```

Gate eliminatório.

Não expor desnecessariamente:

```text
tokens
PII
internal IDs sem necessidade
security metadata
membership internals
provider IDs
raw exception
```

em:

```text
URL
query string
localStorage
sessionStorage
console
analytics
telemetry
error tracking
breadcrumbs
```

---

# 51. Data minimization

BFF deve devolver apenas o necessário para a interface.

Não enviar um agregado inteiro apenas porque é fácil.

View models são válidos quando reduzem:

- exposição;
- acoplamento;
- round trips;
- parsing duplicado.

---

# 52. Client storage

Antes de persistir qualquer informação no browser, classificar:

```text
sensível?
PII?
tenant-scoped?
necessária após reload?
TTL?
```

OAuth/session secrets nunca pertencem a Web Storage.

---

# 53. Eixo 10 — Observabilidade / supportability

Peso:

```text
3%
```

O sistema deve permitir detectar:

- JS exceptions;
- route load failures;
- failed BFF requests;
- BFF 4xx/5xx;
- auth failure;
- session refresh failure;
- latency;
- Core Web Vitals;
- critical mutation failure.

---

# 54. Correlation

Quando disponível, preservar correlação:

```text
browser action
↓
BFF
↓
backend
↓
async workflow
```

Nunca logar token/segredo para obter correlação.

Idealmente, erro user-facing pode possuir um identificador de suporte seguro quando útil.

---

# 55. Error telemetry

Erro enviado à observabilidade deve incluir somente contexto necessário.

Evitar:

- form payload completo;
- document content;
- e-mail cru sem necessidade;
- JWT;
- cookie;
- invitation token.

---

# 56. Eixo 11 — Design System / consistência

Peso:

```text
3%
```

O frontend deve implementar o Design System corrente.

Para código novo:

```text
semantic tokens
```

são obrigatórios quando token correspondente existe.

Evitar hard-coded:

```text
hex
spacing
radius
font size
shadow
z-index
```

quando já há token.

---

# 57. Estados de componente

Componente interativo deve considerar os estados aplicáveis:

```text
default
hover
focus-visible
active
disabled
loading
error
selected
```

Não inventar estados sem significado.

Não omitir estado real.

---

# 58. Operational Calm

A implementação deve preservar:

```text
clareza
densidade útil
previsibilidade
calma
hierarquia
```

Cor forte comunica ação/estado, não decoração.

Design System não pode mascarar informação operacional.

---

# 59. Eixo 12 — Responsividade / compatibilidade

Peso:

```text
2%
```

Nenhuma tela crítica pode quebrar em viewport estreita.

Avaliar:

```text
desktop
tablet/narrow
mobile
```

conforme surface.

---

# 60. Reflow

Testar pelo menos a largura mínima definida pelo padrão de interface/Design System.

WCAG 2.2 reflow e zoom continuam gates de acessibilidade.

Responsive não significa:

```text
encolher desktop
```

Pode exigir:

- reorder;
- disclosure;
- cards;
- fewer columns;
- drawer;
- stacked controls.

---

# 61. Browser compatibility

Considerar navegadores modernos suportados pelo projeto:

```text
Chrome
Edge
Firefox
Safari
```

Não precisa executar toda matriz em todo PR local.

Milestones/release precisam de evidência compatível com a política vigente.

---

# 62. Severidade

Usar a escala oficial já adotada no frontend:

| Severidade | Significado |
|---|---|
| S4 — Critical | impede tarefa crítica, viola segurança/integridade ou pode induzir decisão perigosa |
| S3 — Major | grande fricção, risco alto de erro/abandono ou quebra relevante |
| S2 — Moderate | problema real, mas contornável |
| S1 — Minor | pequena inconsistência/fricção |
| S0 — Polish | refinamento sem impacto material |

Não criar escala paralela.

---

# 63. Gates eliminatórios

## FE-G1 — Functional Correctness

FAIL se:

- dado crítico incorreto;
- estado falso;
- mutation errada;
- corrupção;
- cache cross-tenant;
- conflito perdido;
- duplicate effect relevante.

---

## FE-G2 — Security / BFF

FAIL se:

- token exposto;
- auth bypass;
- CSRF crítico;
- IDOR;
- cross-tenant;
- open proxy;
- segredo no bundle;
- session vulnerability bloqueante.

---

## FE-G3 — Accessibility

FAIL se:

- jornada crítica inacessível;
- blocker WCAG A/AA conhecido;
- keyboard impossible;
- focus essencial indisponível.

---

## FE-G4 — Reliability / Epistemic Integrity

FAIL se:

- mutation pode duplicar/perder silenciosamente;
- pending/unknown apresentado como sucesso/falha definitiva;
- recovery crítica inexistente;
- conflito crítico escondido.

---

## FE-G5 — Privacy

FAIL se:

- token/PII sensível exposto indevidamente;
- dados de outro tenant exibidos;
- logging/telemetry vazando segredo.

---

# 64. Gate de nota mínima em eixo crítico

Mesmo com média >= 9.0:

```text
qualquer eixo com gate < 7.0
```

resulta:

```text
NOT APPROVED
```

Além disso, qualquer violação binária de gate resulta em reprovação independentemente da nota.

---

# 65. Avaliação por tipo de mudança

Não criar nova escala de risco.

Usar:

```text
docs/engineering/change-risk-scale.md
```

Mas aplicar esta matriz de escopo:

## Refactor interno sem alteração perceptível

Avaliar no mínimo:

```text
functional
architecture
tests
performance regression
security impact
```

Interface Standard:

```text
N/A quando realmente sem impacto
```

---

## Novo/alterado componente

Avaliar:

```text
functional behavior
accessibility
states
tests
Design System
responsive
interface consistency
```

---

## Nova/alterada tela ou journey

Avaliar:

```text
rubrica completa aplicável
Interface Standard
Design System
E2E
a11y manual
visual QA
responsive
failure states
```

---

## Auth/session/BFF/tenant

Avaliar:

```text
rubrica completa
security gate
privacy
integration
negative tests
E2E
threat model impact
Claude ↔ Codex quando risco exigir
```

---

# 66. Processo obrigatório por mudança

## Antes de implementar

1. ler o DoD global;
2. classificar risco;
3. identificar eixos aplicáveis;
4. identificar gates aplicáveis;
5. identificar critical journeys afetadas;
6. verificar Design System;
7. verificar Interface Standard se user-visible;
8. definir evidência necessária.

Não descobrir os critérios somente no final.

---

# 67. Durante implementação

Sempre que surgir novo failure mode:

```text
implementar
+
testar
+
documentar se durável
```

Não acumular uma lista mental de "depois corrigimos".

---

# 68. Antes do PR

Executar os checks aplicáveis do frontend.

Baseline atual:

```bash
cd frontend
npm ci
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e
```

Não encadear comandos no ambiente de trabalho se `AGENTS.md` proibir.

Também executar checks raiz afetados quando a mudança atravessar BFF/backend/contracts.

---

# 69. CI

CI-only failure é finding real.

Não classificar como:

```text
"funciona local, então pode ignorar"
```

sem causa comprovada.

Não fazer merge com gate relevante vermelho.

---

# 70. Evidência mínima de PR

Para mudança frontend relevante, registrar conforme aplicável:

```text
scope
risk classification
affected journeys
criteria evaluated
automated tests
manual QA
accessibility evidence
responsive evidence
visual evidence
security/negative tests
known limitations
deferred work
DoD status
```

---

# 71. Screenshots

Mudança visual relevante deve incluir screenshots suficientes para revisão.

Não anexar dezenas sem propósito.

Priorizar:

```text
before/after
desktop
narrow/mobile
critical state
error state
dense state
```

quando afetados.

---

# 72. Browser QA

Screenshots não substituem interação.

Manual/headed QA precisa verificar quando aplicável:

- focus;
- scrolling;
- menu/dialog;
- hover;
- keyboard;
- resize;
- forms;
- loading;
- error/retry;
- navigation.

---

# 73. DoD especializado por componente

Um componente novo/alterado está tecnicamente pronto apenas quando os itens aplicáveis forem verdade:

```text
semantic HTML correto
keyboard correto
accessible name correto
states completos
semantic tokens
contrast verificado
narrow + desktop verificados
long content verificado
pt-BR verificado
tests de comportamento
visual regression quando relevante
docs/story quando componente público do DS
```

Isso ainda não substitui o DoD global.

---

# 74. DoD especializado por feature

Uma feature de frontend está tecnicamente pronta quando:

```text
acceptance criteria satisfeitos
happy path testado
failure/recovery testados
auth/tenant negativos testados
a11y aplicável comprovada
state semantics corretas
responsive funcional
tests verdes
CI verde
docs correntes reconciliadas
evidência registrada
```

e o DoD global também está satisfeito.

---

# 75. Definition of Done como standing standard

O DoD não deve ser reescrito por feature.

Acceptance criteria mudam por feature.

O DoD permanece estável.

Este padrão também deve permanecer relativamente estável.

Se uma regra só vale para uma feature:

```text
não pertence aqui
```

Se uma regra deve orientar futuras mudanças de frontend em várias sessões:

```text
pode pertencer aqui
```

---

# 76. Documentação de decisões

Mudança de arquitetura frontend de alto impacto precisa de:

```text
ADR / design aprovado
```

quando exigido pelo risk scale.

Exemplos:

- trocar SPA por SSR framework;
- trocar Full BFF;
- alterar storage de sessão;
- introduzir global state framework;
- alterar auth model;
- introduzir offline-first;
- mudar estratégia de tenancy no browser.

---

# 77. Dependências

Antes de adicionar dependência:

```text
problema
alternativas
benefício
security
maintenance
bundle
license
test impact
```

Uma biblioteca grande não é proibida.

Ela precisa justificar seu custo.

---

# 78. Supply-chain

Dependências de frontend também entram na postura de segurança do projeto.

Aplicar:

- lockfile;
- audit;
- atualização controlada;
- scripts de instalação conforme política do repo;
- SBOM quando coberto pelo pipeline;
- avaliação de pacote crítico.

---

# 79. CSP

Frontend deve funcionar sob CSP rigorosa.

Não relaxar CSP para acomodar biblioteca sem análise.

Evitar:

```text
unsafe-eval
unsafe-inline
wildcards
```

sem decisão explícita e análise de risco.

---

# 80. XSS

Por padrão:

- React escaping é preservado;
- evitar `dangerouslySetInnerHTML`;
- HTML externo precisa sanitização explícita;
- URL externa precisa validação;
- rich text precisa threat model próprio.

---

# 81. File upload UI

Frontend deve refletir os estados reais do pipeline:

```text
selected
uploading
uploaded/admitted
scanning
clean
rejected
timeout
processing/extraction
```

conforme observabilidade real disponível.

Não usar:

```text
"aprovado"
```

como sinônimo de:

```text
malware scan clean
```

---

# 82. Session expiration

Session expiry deve ter recovery previsível.

Evitar:

```text
mutation em andamento
→ redirect abrupto
→ perda silenciosa do formulário
```

quando for tecnicamente possível preservar/reconciliar.

---

# 83. Network failures

Distinguir:

```text
offline/network
timeout
server error
auth
rate limit
validation
conflict
unknown outcome
```

quando isso altera a ação segura.

Não reduzir tudo a:

```text
Algo deu errado
```

---

# 84. Error boundaries

Falha de uma subtree não deve necessariamente derrubar todo shell.

Planejar boundaries conforme criticidade.

Fallback precisa permitir:

- compreender;
- recuperar;
- navegar;
- fornecer support context.

---

# 85. Forms

Além do Interface Standard:

- schema/contract consistente;
- client validation não substitui server validation;
- submit guard correto;
- double-submit seguro;
- preserve values;
- accessible errors;
- server errors mapeados;
- idempotency quando necessário.

---

# 86. Tables / data-dense UI

Não introduzir ARIA grid sem necessidade.

HTML table é preferida quando o comportamento é tabela convencional.

Grid/spreadsheet implica:

- keyboard model;
- focus management;
- additional a11y burden.

---

# 87. Search/filter state

Quando útil para retorno/navegação:

```text
URL
```

é boa candidata a owner de filtros.

Evitar filtros importantes presos em estado transitório impossível de compartilhar/reabrir sem razão.

---

# 88. Organization switch e forms

Não permitir que:

```text
form aberto em O1
↓
switch para O2
↓
submit altera O2 com dados de O1
```

Capturar tenant context corretamente.

Definir contrato para:

- dirty form;
- in-flight mutation;
- upload;
- switch.

---

# 89. Loading UX

Não introduzir spinner global por padrão.

Preferir:

- skeleton quando layout conhecido;
- local pending state;
- preserve previous data quando seguro;
- progress/status contextual em processos longos.

---

# 90. Mutation UX

Ao iniciar mutation:

- impedir duplicate action quando apropriado;
- manter feedback;
- não apagar contexto;
- distinguir acceptance de completion;
- reconciliar server response.

---

# 91. Query invalidation

Toda mutation precisa responder:

```text
quais queries ficaram stale?
```

Não depender de reload manual da página para correctness.

---

# 92. Prefetch

Prefetch é permitido quando:

- não vaza tenant;
- não cria tráfego excessivo;
- não dispara side effect;
- tem benefício de UX.

---

# 93. Error messages e security

User-facing error deve ser útil sem expor internals.

Não mostrar:

```text
stack trace
DynamoDB keys
Cognito sub
AWS resource ARN
raw provider error
```

---

# 94. Performance e observabilidade após lançamento

Quando houver tráfego real, RUM se torna fonte primária para Core Web Vitals.

Manter separação:

```text
synthetic
≠
real-user evidence
```

Não declarar performance "PROVEN" apenas por Lighthouse local.

---

# 95. User Validation

IA e engenharia podem provar:

- conformance;
- heuristics;
- correctness;
- a11y técnica;
- consistency.

Não podem provar sozinhas:

```text
USER VALIDATED
```

Isso exige usuários e tarefas reais.

---

# 96. Regressions

Toda regressão real descoberta em review, E2E ou produção deve gerar:

```text
fix
+
regression test
```

quando automatização for tecnicamente razoável.

Não corrigir apenas o sintoma visual.

---

# 97. Root cause

Bug de frontend deve ser investigado até a causa técnica relevante.

Exemplo ruim:

```text
adicionar setTimeout porque flaky
```

Exemplo correto:

```text
identificar race de session/query/mutation
→ corrigir ownership/ordering
→ adicionar regression
```

---

# 98. Accessibility regression

Correção visual não pode reduzir semântica.

Exemplo:

```text
button
→ div onClick
```

para facilitar styling é regressão e deve falhar review.

---

# 99. Quality score não é alvo cosmético

O score serve para:

- disciplinar avaliação;
- revelar pontos fracos;
- exigir convergência.

Não "otimizar para a nota" escondendo achados ou marcando N/A.

Finding real permanece real.

---

# 100. Review adversarial

Quando o protocolo for aplicável, Codex deve procurar especialmente:

```text
incorrect domain state
cross-tenant cache
stale permission
session race
CSRF
XSS
token exposure
blind mutation retry
OCC loss
idempotency gaps
timezone/date bugs
a11y regressions
missing error states
hidden failure
sensitive telemetry
query invalidation bugs
unsafe Organization switch
```

---

# 101. Checklist mínima de review

Para qualquer PR frontend, responder:

```text
[ ] Quais eixos deste padrão foram afetados?
[ ] Há gate eliminatório envolvido?
[ ] Qual risk level?
[ ] Acceptance criteria estão satisfeitos?
[ ] Há mudança user-visible? Interface Standard foi avaliado?
[ ] Há mudança visual? Design System foi respeitado?
[ ] Failure states foram testados?
[ ] A11y foi avaliada no nível adequado?
[ ] Tenant/session/security foram afetados?
[ ] Tests relevantes passam?
[ ] CI relevante passa?
[ ] Evidência está registrada?
[ ] DoD global está satisfeito?
```

---

# 102. Formato recomendado da avaliação

```markdown
## Frontend Quality Assessment

### Scope
...

### Risk
Level ...

### Applicable axes

| Axis | Score | Evidence | Findings |
|---|---:|---|---|
| Functional Correctness | ... | ... | ... |
...

### Gates
- FE-G1: PASS
- FE-G2: PASS
...

### FrontendOverall
9.xx

### Interface Standard
N/A ou 9.xx

### Design System
PASS / findings

### Definition of Done
PASS / NOT DONE

### Evidence level
IMPLEMENTED / UNIT TESTED / ...

### Remaining findings
...
```

---

# 103. Quando reavaliar a rubrica completa

Executar avaliação completa:

- novo vertical slice;
- nova área do produto;
- alteração importante do BFF;
- mudança de auth/session;
- mudança de tenancy;
- novo Design System major;
- release/milestone relevante;
- mudança arquitetural Type 1;
- antes de elevar readiness de produção.

Mudanças locais podem avaliar somente os eixos afetados.

---

# 104. Critério final de aprovação de frontend

Uma mudança significativa de frontend pode ser considerada tecnicamente aprovada quando:

```text
FrontendOverall >= 9.0
+
nenhum gate
+
InterfaceOverall >= 9.0 quando aplicável
+
Design System conforme
+
tests relevantes verdes
+
CI verde
+
evidência adequada
```

Mas só é:

```text
DONE
```

quando também cumprir:

```text
Definition of Done global
```

---

# 105. Padrão de qualidade desejado

O frontend do Expiration Tracker deve chegar a um estado em que problemas, quando ocorrerem, sejam:

```text
difíceis de introduzir
+
fáceis de detectar
+
fáceis de correlacionar
+
fáceis de reproduzir
+
seguros de recuperar
```

Essa propriedade é mais importante que simplesmente ter poucos bugs visíveis.

---

# 106. Referências normativas/técnicas

## W3C WCAG 2.2

https://www.w3.org/TR/WCAG22/

Baseline oficial de acessibilidade.

---

## WAI-ARIA Authoring Practices

https://www.w3.org/WAI/ARIA/apg/

Referência para widgets complexos.

---

## OWASP ASVS 5.0.0

https://owasp.org/www-project-application-security-verification-standard/

Baseline verificável de segurança de aplicação web.

---

## Core Web Vitals

https://web.dev/articles/vitals

Targets atuais:

```text
LCP <= 2.5 s
INP <= 200 ms
CLS <= 0.1
p75
```

---

## Testing Library

https://testing-library.com/

Princípio user-centric de component testing.

---

## Playwright

https://playwright.dev/

E2E e browser automation.

---

# 107. Integração no contexto persistente

Caminho recomendado:

```text
docs/frontend/frontend-engineering-quality-standard.md
```

O router:

```text
docs/frontend/README.md
```

deve apontar para este arquivo como:

```text
normativo atual
```

O router de engenharia:

```text
docs/engineering/README.md
```

deve referenciá-lo quando uma tarefa afetar frontend/BFF.

O `AGENTS.md` não deve duplicar esta rubrica.

Ele deve, no máximo, indicar que tarefas frontend devem carregar o router `docs/frontend/README.md`.

Isso preserva progressive context disclosure.

---

# 108. Integração com o Definition of Done

O Definition of Done deve continuar sendo o único padrão global de "DONE".

Este arquivo não deve copiar todo o DoD.

A integração deve ser por referência.

Recomendação para o DoD, se ainda não existir cláusula equivalente:

```text
Para mudanças em áreas que possuam quality standard especializado,
todos os gates aplicáveis desse standard devem estar satisfeitos
e a evidência correspondente deve estar registrada antes de "DONE".
```

Evitar duplicar dezenas de itens de frontend dentro do DoD global.

---

# 109. Regras de manutenção

Alterar este documento somente quando:

- uma regra demonstrou ser inadequada;
- o produto mudou estruturalmente;
- uma referência normativa mudou materialmente;
- um novo failure mode recorrente justificou nova regra;
- Claude ↔ Codex aprovou mudança quando risk level exigir.

Não alterar pesos a cada review para melhorar nota.

---

# 110. Status de adoção

Estado inicial deste documento:

```text
PROPOSED
```

Para se tornar norma persistente:

1. colocar em `docs/frontend/`;
2. reconciliar com o Definition of Done vigente;
3. reconciliar com `interface-quality-standard.md`;
4. reconciliar com o Design System vigente;
5. conferir stack/comandos atuais;
6. executar review Claude ↔ Codex conforme classificação de risco;
7. alcançar gate aplicável;
8. atualizar routers;
9. registrar decisão de engenharia quando apropriado.

Depois:

```text
APPROVED
```

---

# 111. Pergunta final obrigatória

Antes de aprovar qualquer trabalho relevante de frontend, responder:

> **Esta mudança mantém o frontend correto, seguro, acessível, confiável, observável, recuperável, performático e coerente com a interface e o Design System — e existe evidência suficiente para sustentar cada alegação feita sobre seu estado?**

Se a resposta for não:

```text
NOT DONE
```

---

# 112. Princípio final

O frontend do Expiration Tracker não deve ser tratado como uma camada cosmética sobre o backend.

Ele é parte do sistema de confiabilidade.

Uma interface que:

```text
mostra estado incorreto
perde dados do formulário
vaza tenant
esconde conflito
não permite teclado
não explica falha
não permite correlação
```

é um defeito de engenharia, mesmo que seja visualmente excelente.

O padrão é:

> **qualidade de interface + qualidade de engenharia + evidência + Definition of Done.**

Somente a combinação dessas quatro dimensões permite considerar o trabalho realmente concluído.
