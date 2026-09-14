# PERF-08 — RequestContext (resolveRequestContext)

## Escopo

`RequestContextResolver.resolve()` (`src/modules/identity/application/resolve-request-context.ts`)
é o choke point de sessão/tenant/auth que roda antes da lógica de negócio em todo handler de
resource Lambda (56+ call sites, 13 arquivos HTTP, grep-verificado no próprio código-fonte).
Tarefa: medir antes de qualquer mudança ("medir antes; fast path só depois"), avaliar
BatchGet/paralelismo e verificar que qualquer paralelização proposta não enfraquece tenant
isolation/RBAC. **Nenhum código de produção foi alterado nesta tarefa.**

## O que o resolver faz, chamada por chamada

Lido diretamente de `resolve-request-context.ts` + os 5 arquivos que ele invoca
(`bootstrap-identity.ts`, `global-user-repository.ts`, `onboarding-state.ts`,
`resolve-active-membership.ts`, `resolve-working-organization.ts`, `hydrate-memberships.ts`).
Numeração = ordem real de execução (`resolveInner`, linhas 81–139):

1. **`bootstrap.bootstrapUser(claims.sub, newUserId)`** (`bootstrap-identity.ts:47`)
   - `store.get(IdentityMapping)` — GetItem 1.
   - Se existir: `store.get(GlobalUser)` — GetItem 2, **sequencial**, só roda porque GetItem 1
     devolveu o `userId` usado na chave do GetItem 2 (`identity-mapping-repository.ts` →
     `globalUserKey(existingMapping.userId)`). Dependência real de dado, não artificial.
   - Caminho de primeiro login (raro, fora do estado estacionário): `TransactWriteItems` de 2
     itens em vez dos 2 GetItems — não é o caminho medido aqui.
2. Checagem em memória: `user.identityStatus !== "ACTIVE"` (sem I/O).
3. Checagem em memória: `user.globalLogoutAfter` vs. `claims.issuedAt` (sem I/O, watermark
   global de logout, §10).
4. **`globalUsers.getDeviceSession(user.userId, claims.deviceId)`** — GetItem 3, só se
   `claims.deviceId` presente (linha 97). Chave = `(userId, deviceId)`, ambos já conhecidos antes
   do passo 1 terminar (userId vem do bootstrap, deviceId vem do JWT) — **não depende do
   resultado do passo 1 além do `userId`, que já está disponível no mesmo instante em que o passo
   5 abaixo também fica disponível**.
5. **`onboarding.resolve(user.userId)`** (`onboarding-state.ts:35`) — `queryGsi4` (Query 1,
   `MembershipByUser`) seguido de `hydrateMembershipsFromGsi4` (`hydrate-memberships.ts`):
   1 GetItem por Membership candidata, concorrência limitada a 5 (`mapWithConcurrency`, não
   `Promise.all` sem limite — já corrigido em E-021). No caso comum (1 org por usuário), é 1
   Query + 1 GetItem.
6. **`resolveActiveMembership(user.userId, organizationIdHint)`** — dois caminhos:
   - **Com hint** (`X-Organization-Id` presente, caso comum via BFF): chama
     `resolveWorkingOrganization()` diretamente — `organizations.get(Membership)` (GetItem) **então**
     `organizations.get(TenantLifecycleRecord)` (GetItem), hoje sequencial
     (`resolve-working-organization.ts:26-32`).
   - **Sem hint**: `resolveActiveMemberships()` repete Query GSI4 + hydrate (mesmo padrão do
     passo 5, porém não reaproveita o resultado já obtido no passo 5 — trabalho duplicado, ver
     achado abaixo) e, com exatamente 1 ACTIVE, chama `resolveWorkingOrganization()` de novo
     (mesmas 2 GetItems sequenciais do caminho com hint).
7. Montagem do `RequestContext` em memória (sem I/O).

### Contagem de I/O no caminho comum (usuário recorrente, com `deviceId`, com hint)

GetItem(IdentityMapping) → GetItem(GlobalUser) → GetItem(DeviceSession) → Query(GSI4) +
GetItem(Membership hydrate) → GetItem(Membership, de novo, dentro de
`resolveWorkingOrganization`) → GetItem(TenantLifecycleRecord) = **7 chamadas DynamoDB**, das
quais **6 rodam hoje em sequência estrita** (só o par IdentityMapping→GlobalUser é uma
dependência real de dado; as outras 5 estão sequenciadas por ordem de código, não por
necessidade).

**Achado adicional (fora do pedido de paralelismo, mas relevante para "onde o tempo vai")**: o
passo 5 (`onboarding.resolve`) já paga o custo de descobrir e hidratar a(s) Membership(s) via
GSI4, mas o passo 6 com hint **não reaproveita esse resultado** — ele faz um GetItem direto na
chave `(tenantId do hint, userId)`, que é uma leitura *diferente* da hidratação do passo 5 (chave
diferente: hint pode ser uma org diferente da que o passo 5 hidratou) e portanto não é
estritamente redundante quando o hint aponta para uma org fora da lista já hidratada — mas no
caso comum de hoje (usuário com exatamente 1 Membership ACTIVE, doc do sistema confirma que
multi-org por usuário ainda não é alcançável antes do Wave B2B-8), o hint quase sempre aponta
para a mesma org que o passo 5 já hidratou, e o passo 6 relê a mesma linha. Não é um bug de
paralelismo — é uma oportunidade de cache/memoização dentro de uma única resolução, fora do
escopo estrito de "paralelizar chamadas sequenciais", mas vale registrar para uma iteração futura
do fast path.

## Medição — o que foi possível obter sem deploy

### 1. EMF customizado (`lambda.request_context_ms`) — indisponível, confirmado

Confirmado no `PERF-04-bff-lambda-baseline.md` (seção "Correção: métricas EMF..."): a
instrumentação `timeSpan()` do PERF-02 existe só nesta branch (`perf/performance-program-v1`),
nunca implantada em `dev` (deploy real corresponde ao SHA `8ade669`, anterior a esse trabalho).
Não há como obter `ExpirationTracker/RequestContext` no CloudWatch desta conta hoje. Não
forçado/contornado (regra do projeto: nunca aplicar infra fora do pipeline CI/CD).

### 2. X-Ray — tentado, sem sub-segmentos de DynamoDB

`aws xray get-trace-summaries` (profile `claude-dev`, `us-east-1`) sobre
`exptrk-dev-items-handler` nas últimas 2h devolveu traces reais (tracing Active confirmado,
consistente com o achado do PERF-02 sobre cold start). `aws xray batch-get-traces` nos IDs
encontrados, porém, mostra que os segmentos capturados são apenas:

```
exptrk-dev-items-handler  159.0ms / 195.6ms  (+ subsegmento "Overhead" ~40.7ms)   -- request warm
exptrk-dev-items-handler   83.4ms / 2086.0ms (+ "Overhead" 26.8ms, "Init" 1746ms) -- request cold
```

Não existe nenhum subsegmento `AWS::DynamoDB` nem chamada nomeada de SDK dentro da árvore — o ADOT
Lambda layer está emitindo o segmento de invocação (e o `Init` do cold start, já documentado no
PERF-02), mas **não instrumenta automaticamente as chamadas `@aws-sdk/client-dynamodb`
individuais com sub-segmentos X-Ray nesta configuração** (aparentemente autoinstrumentação
OpenTelemetry sem o AWS SDK X-Ray middleware clássico, ou exportador não configurado para
sub-spans do SDK). Resultado: **X-Ray não deu números por chamada DynamoDB** — via alternativa
tentada e descartada com evidência (não é uma suposição).

### 3. `Duration` nativa (REPORT line) como limite superior — via PERF-04

Único número real disponível hoje, herdado do PERF-04 (mesma janela de 20 min, tráfego real):

| Função | Duration p50 | Duration p95 |
|---|---|---|
| `exptrk-dev-items-handler` | 213ms | 1005ms |
| `exptrk-dev-subjects-handler` | 213ms | 647ms |

Esse número é o tempo **total** do handler (RequestContext + lógica de negócio + todas as
chamadas DynamoDB de negócio) — não isola o RequestContext. É um **limite superior**, não uma
medição precisa: o RequestContext é necessariamente ≤ 213ms no p50, ≤ 1005/647ms no p95, mas a
fração exata não pode ser afirmada sem a instrumentação implantada. Dado o call count (6-7
GetItem/Query, a maioria de item pequeno, sem scan), e latência típica de GetItem/Query de
item único em DynamoDB on-demand (tipicamente single-digit a low-double-digit ms cada,
consistente com a soma ficar bem abaixo de 213ms mesmo com 6 chamadas sequenciais), a hipótese de
trabalho é que o RequestContext responde por uma fração minoritária, mas não desprezível, do
tempo total do handler — **isto é estimativa qualificada, não medição**, e deve ser tratada como
tal em qualquer decisão subsequente.

## Oportunidade de paralelização / BatchGet

### Onde HÁ oportunidade real (independência de dados confirmada por leitura do código)

**A. `getDeviceSession()` (passo 4) e `onboarding.resolve()` (passo 5) — independentes entre si.**
Ambos dependem apenas de `user.userId` (já disponível após o passo 1) e, no caso do device
session, de `claims.deviceId` (disponível desde o início, do JWT). Nenhum lê o resultado do
outro. Hoje rodam em sequência (`resolve-request-context.ts:96-110`, um `await` depois do outro).
Podem virar `Promise.all([getDeviceSession(...), onboarding.resolve(...)])`, com as checagens de
erro (device revogado / onboarding state) feitas depois que ambos resolvem — mesma lógica
fail-closed, só reordenada no tempo.

**B. Dentro de `resolveWorkingOrganization()` (chamado no passo 6, 2x no pior caso): GetItem
Membership + GetItem TenantLifecycleRecord.** Lido em `resolve-working-organization.ts:26-32`: a
chave do TenantLifecycleRecord (`tenantLifecycleKey(tenantId)`) usa só o `tenantId` já conhecido
(do hint ou do passo 5), **não** um campo devolvido pelo GetItem de Membership. As duas chaves são
computáveis a partir do input antes de qualquer um dos dois GetItems rodar. Podem virar
`Promise.all([organizations.get(Membership), organizations.get(TenantLifecycleRecord)])`,
avaliando os dois `status` só depois que ambos retornam.

Ambos os pontos A e B são reais oportunidades de `Promise.all` (não BatchGet, porque as chaves
não compartilham partição/tabela de forma que valha a pena um único `BatchGetItem` sobre 2 itens
não relacionados — `BatchGetItem` economiza round-trips de rede, mas para apenas 2 itens o ganho
sobre 2 `Promise.all`'d GetItems é marginal e adiciona complexidade de parsing de resposta em
lote; não recomendado aqui).

### Onde NÃO há oportunidade (dependência real de dado)

- Passo 1 (IdentityMapping → GlobalUser): a chave do segundo GetItem vem do resultado do
  primeiro. Sequencial por necessidade.
- Passo 5 → passo 6: `resolveActiveMembership()` só é chamado depois que
  `onboarding.resolve()` confirma `HAS_USABLE_MEMBERSHIP` — tecnicamente o passo 6 não *precisa*
  logicamente do resultado do passo 5 para funcionar (ele revalida tudo de novo, independente), mas
  paralelizá-los mudaria a semântica de erro: hoje, se o onboarding classifica o usuário como
  `NO_TENANT_NO_MEMBERSHIP`, a função lança `OnboardingRequiredError` **sem nunca tentar** resolver
  Membership. Rodar os dois em paralelo faria o passo 6 executar leituras DynamoDB
  desnecessárias no caminho comum de "usuário sem org ainda" (fluxo de onboarding, não raro) só
  para descartar o resultado. **Não recomendado** — o ganho de latência não compensa o I/O extra
  sistemático em um caminho de erro esperado.
- Caminho sem hint (`resolveActiveMemberships()` → depois `resolveWorkingOrganization()`): o
  `organizationId` usado na segunda chamada só existe depois que a primeira devolve a Membership
  ACTIVE. Sequencial por necessidade.

## Análise de segurança — tenant isolation / RBAC

Para os dois pontos identificados (A e B):

- **Ponto A (deviceSession || onboarding em paralelo)**: nenhum dos dois resultados autoriza
  nada por si só antes de ambos serem checados. O código já lança erro se `deviceSession.status
  === "REVOKED"` ou se `onboardingState !== "HAS_USABLE_MEMBERSHIP"` — paralelizar não muda
  *quando* esses erros são detectados (ainda antes de qualquer tenant/Membership ser resolvido),
  só faz as duas leituras baratas acontecerem ao mesmo tempo em vez de uma após a outra. Nenhum
  TOCTOU: não há uma leitura que "confia" no resultado da outra para decidir uma chave a
  consultar depois. **Seguro.**
- **Ponto B (Membership || TenantLifecycleRecord em paralelo, dentro de
  `resolveWorkingOrganization`)**: aqui é preciso mais cuidado, porque hoje o código só busca o
  `TenantLifecycleRecord` *depois* de confirmar `membership.status === "ACTIVE"` — uma leitura
  "a mais" antecipada do TenantLifecycleRecord de uma organização à qual o usuário **não**
  pertence (Membership ausente ou não-ACTIVE) seria feita em paralelo, mas o **resultado dessa
  leitura nunca é usado nem exposto** se a checagem de Membership falhar (o `if (!membership ||
  membership.status !== "ACTIVE") return { status: "UNAVAILABLE" }` continua sendo avaliado antes
  de qualquer decisão final, só que agora os dois `await` já retornaram). Não há vazamento de
  dado — o comportamente observável de fora (o `WorkingOrganizationResult` devolvido) é idêntico
  ao de hoje: `UNAVAILABLE` se Membership não-ACTIVE, independentemente do estado do
  TenantLifecycleRecord. Nenhuma decisão de autorização passa a ser tomada com base numa leitura
  cuja chave dependeria de um resultado ainda não confiável — ambas as chaves (`tenantId`,
  `userId`) já são conhecidas e legítimas antes de qualquer um dos dois GetItems rodar (vêm do
  `organizationIdHint`/Membership já hidratada no passo anterior, nunca de input não validado).
  **Seguro, com uma ressalva de implementação**: o código que fizer essa paralelização deve
  continuar avaliando `membership.status !== "ACTIVE"` **antes** de olhar o resultado do
  TenantLifecycleRecord (`return UNAVAILABLE` cedo, ignorando a segunda promise já resolvida) —
  nunca inverter para "se qualquer um dos dois falhar, retorna OK se o outro passar", o que
  criaria um bypass real. Isso é uma regra de implementação a documentar no código quando essa
  fatia for feita, não uma razão para não fazer.

Nenhuma das duas paralelizações propostas altera a ordem em que watermarks de logout (global ou
por dispositivo) são checados em relação à resolução de Membership — ambos os watermarks (passo
3, em memória, e passo 4, device session) continuam sendo avaliados antes do passo 6
(`resolveActiveMembership`), que é onde a confiança em "este usuário pode agir neste tenant" é
estabelecida. A proposta A move o *momento em que a leitura do device session é feita* (mais cedo,
em paralelo com onboarding), não o *momento em que seu resultado é avaliado* — o `throw` por
device revogado continua acontecendo antes de qualquer resolução de Membership, porque o código
resultante teria que checar `deviceSession` antes de seguir para o passo 6, exatamente como hoje.

## Recomendação

**Não vale a pena implementar agora.** Razões:

1. Sem a instrumentação `lambda.request_context_ms` implantada em `dev` (bloqueada só por
   aguardar o próximo merge/deploy normal, não por nenhum problema técnico), não há como
   quantificar o ganho real das duas paralelizações antes/depois — só a estimativa qualificada de
   que o RequestContext é uma fração minoritária dos ~213ms (p50)/~1005ms (p95) observados no
   handler completo. Implementar uma otimização sem conseguir medir seu efeito viola a própria
   regra do programa ("medir antes; fast path só depois").
2. O ganho teórico máximo dos dois `Promise.all` propostos é de, no limite, **2 round-trips de
   rede economizados de 6-7 GetItem/Query sequenciais** (o par A economiza 1, o par B economiza
   1) — em DynamoDB on-demand com latência típica de poucos ms por GetItem de item único, isso é
   plausivelmente uma economia de baixa dezena de ms no p50, não uma mudança de ordem de
   grandeza. Não é "não vale nunca fazer", é "não é a prioridade agora sem dado que confirme o
   tamanho do ganho".
3. O ponto B carrega uma ressalva de segurança que precisa de revisão de código cuidadosa
   (documentada acima) — não é uma mudança trivial de "só adicionar `Promise.all`", exige um
   comentário explícito no código sobre por que a ordem de avaliação dos dois resultados
   continua importando mesmo com leitura paralela.

**Próximo passo recomendado, não parte desta tarefa**: assim que esta branch for mergeada e
`lambda.request_context_ms` começar a aparecer no CloudWatch (`ExpirationTracker/RequestContext`),
reavaliar com números reais. Se o RequestContext se confirmar como ≥15-20% do tempo do handler,
os pontos A e B acima já estão especificados com precisão suficiente (arquivos, linhas, chaves
envolvidas, ressalva de segurança) para serem implementados numa fatia futura sem nova
investigação — o que falta então é só a implementação e o teste, não a análise.

## Ciclo B — status

Este era o último item pendente do Ciclo B (`docs/engineering/performance/TODO.md`) — PERF-06,
PERF-07, PERF-09 e PERF-10 já estavam concluídos de trabalho anterior desta sessão. **Ciclo B
está completo.**
