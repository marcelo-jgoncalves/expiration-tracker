# Rodada 1 — Proposta Claude — Otimização de performance (frontend startup + hot path)

## Contexto e gatilho real

Marcelo (product owner) reportou dois problemas concretos de UX, sentidos por ele mesmo usando o app: (1) a tela demora a mostrar conteúdo; (2) durante essa espera aparece uma mensagem tipo "validando sessão" que ele considera desnecessária de mostrar ao usuário. Duas sessões anteriores produziram documentos de auditoria/pesquisa de performance (`expiration-tracker-performance-audit-2026-08-31.md`, `expiration-tracker-performance-strategies-research-2026-08-31.md`) com achados mais amplos (P0 a P3). Esta rodada foca nos itens que (a) explicam diretamente a queixa do Marcelo e (b) são Type 1 (arquitetura/segurança) exigindo o protocolo — não nos itens puramente operacionais (Node version, Lambda memory, ADOT, SQS batch), que são mecânicos e não precisam de rodada.

## Declaração E-014 (pesquisa externa antes da Rodada 1)

**SIM PARCIAL.** Unificação de sessão/BFF em uma única query compartilhada é um padrão já resolvido (TanStack Query docs, múltiplas fontes 2026 confirmam: staleTime=0 causa duplicate-fetch em múltiplos consumidores, a correção documentada é reusar a mesma queryKey/queryFn — não há debate real aqui). Rate limiting multi-tenant (API Gateway throttling vs. quota de aplicação) tem um padrão estabelecido de **abordagem em camadas**, mas a escolha exata de onde colocar cada camada depende do modelo de tenant do projeto — não é um "SIM" completo.

Checklist de critérios pesados derivado da pesquisa:

1. **Sessão compartilhada**: uma única fonte de verdade (`queryKey`) para dados de sessão consumida por todo componente interessado — nunca duas chamadas de rede para a mesma informação no mesmo bootstrap (confirmado: TanStack Query docs + múltiplas fontes independentes 2026).
2. **Rate limiting em camadas**: proteção contra abuso deve combinar uma camada barata/coarse (API Gateway throttling, por rota/stage) com uma camada tenant-aware quando justiça entre tenants importa — a pesquisa 2026 (Medium/system-design, oneuptime.com, AWS throttling guides) não recomenda eliminar a camada tenant-aware inteiramente e depender só do API Gateway quando há requisito real de isolamento por tenant.
3. **UX de loading/autenticação**: nenhuma fonte contradiz o princípio já adotado no próprio design system do projeto (`design-system.md` §69, "direto/calmo/natural") de nunca expor terminologia técnica interna ("validating", nomes de estado) como texto de UI voltado ao usuário.

Fontes:
- https://tanstack.com/query/latest/docs/framework/react/guides/important-defaults
- https://github.com/TanStack/query/discussions/6542
- https://medium.com/@khalilsayed/system-design-multi-tenant-rate-limiting-service-32c63ade5ec7
- https://oneuptime.com/blog/post/2026-02-12-implement-api-rate-limiting-with-api-gateway-and-waf/view
- https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-throttling.html
- https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.ReadConsistency.html
- https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_UpdateItem.html

## Achado real que os 2 documentos de auditoria NÃO tinham (verificado por mim no código real antes desta proposta)

`src/modules/expiration/http/item-handlers.ts` chama `consumeApiRequestQuota()` (TenantQuotaService, `Get + TransactWriteItems`) em TODOS os handlers, incluindo GETs — mas isso **não é um descuido**: o comentário no código referencia explicitamente `full-audit round1/Seguranca criterio 9 (Resistência a Abuso/DoS)`, um achado de segurança real de uma auditoria anterior que identificou que `/items*` não aplicava NENHUMA quota, permitindo um tenant autenticado gerar carga ilimitada. Ou seja: a proposta PERF-04 dos documentos de auditoria ("tirar quota transacional do GET") reabriria um achado de segurança já fechado, se implementada como "remover" em vez de "substituir por algo mais barato que preserva a mesma garantia". Isso muda a decisão de "remover" para "redesenhar mantendo a garantia".

## Verificação de código real feita antes desta proposta (não confiar cegamente nos 2 docs de auditoria)

- `frontend/src/auth/AuthContext.tsx`: `probe()` chama `fetchSessionInfo()` imperativamente (não via TanStack Query), guarda só `authenticated: true/false`, descarta o resto. **Confirmado.**
- `frontend/src/auth/ActiveOrganizationContext.tsx`: `useQuery({ queryKey: sessionQueryKey, queryFn: fetchSessionInfo, staleTime: 0 })` — segunda chamada real a `/bff/session`, só montada DEPOIS que `AuthContext` já resolveu `AUTHENTICATED`. **Confirmado — waterfall sequencial real, não hipotético.**
- `frontend/src/auth/ProtectedRoute.tsx:26`: `"Verificando sua sessão…"` — exatamente a mensagem que Marcelo reportou como desnecessária, mostrada durante a 1ª chamada.
- `frontend/src/auth/OnboardingGate.tsx:21`: `"Carregando sua organização…"` — 2ª mensagem, mostrada durante a 2ª chamada (sequencial à primeira).
- `frontend/src/App.tsx`: nesting real é `AuthProvider > ProtectedRoute > ActiveOrganizationProvider > OnboardingGate > rotas` — confirma que as 2 mensagens aparecem em sequência, nunca em paralelo, antes de qualquer conteúdo real da tela aparecer. **Isto explica tecnicamente e por completo a queixa do Marcelo.**
- `frontend/src/App.tsx`: todas as rotas (`Overview`, `ItemsCollection`, `ItemDetail`, `CreateItem`, `RenewItem`, `SubjectsCollection`, `SubjectDetail`, `Members`, `Settings`, `AcceptInvitation`) são `import` estático, não `React.lazy`. **Confirmado.**
- `src/modules/identity/application/resolve-request-context.ts`: toda `resolve()` chama, em sequência, `bootstrap.bootstrapUser()` (atomic create-if-absent), lookup de `deviceSession` (se `deviceId` presente), `onboarding.resolve()` (query de memberships), resolução de membership ativa, e `createProfileIfAbsent()` — 4-5 operações DynamoDB antes de qualquer dado de negócio, em TODA request autenticada, não só na primeira. **Confirmado.**
- `src/modules/identity/application/quota.ts`: `consume()` usa `buildConditionalPut`/`buildVersionedCreate` dentro de `executeTenantBusinessMutation` (que por sua vez faz `TransactWriteItems` fenced pelo mecanismo W3-07) — confirma o custo relativo descrito pelos 2 docs de auditoria (transação, não `UpdateItem` simples).

## Proposta (5 decisões, nesta ordem de prioridade)

### D-A — Sessão frontend: fonte única + UX de loading sem terminologia técnica

**Mecanismo**: `AuthContext` para de chamar `fetchSessionInfo()` imperativamente; passa a derivar `AuthState` a partir do MESMO `useQuery({ queryKey: sessionQueryKey, queryFn: fetchSessionInfo })` que `ActiveOrganizationContext` já usa (um único Provider de sessão acima de ambos, ou os dois lendo do mesmo hook — desenho exato fica para implementação, mas a regra é: uma query, um resultado, dois consumidores). `staleTime` deixa de ser `0`; usar algo como 30-60s (ajustável), invalidado explicitamente em `logout`/`logout all`/`troca de organização`/`401` — exatamente como a pesquisa recomenda, sem enfraquecer autorização (o BFF continua validando a sessão de verdade a cada operação real).

**UX de loading**: substituir as 2 mensagens sequenciais atuais (`"Verificando sua sessão…"` → `"Carregando sua organização…"`) por UM único estado de carregamento, sem texto técnico exposto — usar um skeleton estrutural (padrão já adotado em `AsyncStates.tsx`/`components/ui`) em vez de texto, e só mostrá-lo depois de um pequeno atraso (ex. 150-200ms) para não "piscar" em conexões rápidas. Isso resolve as DUAS queixas do Marcelo ao mesmo tempo: menos round-trips (mais rápido de verdade) e nenhuma mensagem "tipo debug" visível.

### D-B — Session touch coalescing (backend)

Manter `ConsistentRead=true` na leitura da sessão (não negociável — revogação real importa). Mudar a renovação de idle TTL de "toda request" para "só quando o tempo restante cair abaixo de um threshold" (ex. renovar só quando restarem menos de 5 min de um idle timeout de 30 min — valor exato a calibrar, não um número final desta rodada). Resultado: a esmagadora maioria das requests deixa de escrever na tabela de sessão.

### D-C — RequestContext fast path (backend)

Sem enfraquecer o que precisa ser revalidado a cada request (membership ACTIVE, tenant lifecycle ACTIVE): mover `onboarding.resolve()` e `createProfileIfAbsent()` para fora do caminho recorrente. Ambos pertencem a login/seleção-de-organização/fluxos de onboarding explícitos, não a uma leitura normal de dashboard/item. Avaliar se `bootstrapUser()` (create-if-absent) pode virar um fallback condicional (só executa a escrita quando o `GlobalUser` genuinamente não existe, nunca um round-trip de escrita "so-what-if" em toda request de um usuário que já existe há muito tempo).

### D-D — Quota: substituir, não remover (reconcilia com o achado de segurança já fechado)

Não remover `TenantQuotaService` de GETs (isso reabriria o achado de DoS já corrigido). Em vez disso: (1) manter throttling de API Gateway como camada coarse adicional (barata, já disponível); (2) redesenhar o consumo de `API_REQUEST` para um contador atômico mais barato (`UpdateItem` com `ADD`/`SET ... if_not_exists`, sem `Get` prévio nem `TransactWriteItems`) em vez do mecanismo transacional pesado hoje compartilhado com quotas comerciais (`AI_CALL`, `UPLOAD_*`, etc.); (3) manter o mecanismo transacional forte exatamente onde há significado comercial/custo real (IA, upload, import, notificações pagas). Isso preserva a garantia de segurança (nenhum tenant autenticado gera carga ilimitada) a um custo por request muito menor.

### D-E — Dashboard paginado (backend + frontend)

`listDashboard()` já aceita `limit` — o handler HTTP do dashboard passa a exigir/aplicar um `limit` (ex. 20-30) e ordenação por `dueDate` já existente via GSI, sem introduzir nenhum índice novo. Coleção completa usa `limit`+`cursor` (`LastEvaluatedKey`), nunca `FilterExpression` sobre uma query ilimitada.

## Fora de escopo desta rodada (não Type 1, não precisa de protocolo — mecânico/operacional)

Lazy-loading de rotas (`React.lazy`), migração Node 20→22/24, ADOT seletivo/atualização de versão, benchmark de memória Lambda, ARM64/Graviton, batch/concorrência de SQS, `staleTime` por tipo de query fora da sessão, N+1 de `BatchGetItem` na renovação — todos válidos, nenhum deles é decisão de arquitetura/segurança que precise de nota cega Claude↔Codex; ficam como itens de implementação direta em sessão(ões) futura(s), priorizados por valor/esforço mas fora desta rodada de protocolo.

## Pergunta para a Rodada de crítica

A D-D é a decisão mais arriscada tecnicamente (redesenhar um mecanismo de segurança já auditado). Peço avaliação adversarial específica: o contador atômico simples (`UpdateItem ADD`) é genuinamente equivalente em garantia de segurança ao mecanismo `Get+TransactWrite` atual, ou existe uma classe de corrida/bypass que o mecanismo transacional evita e o contador simples não evita? Se houver diferença real, ela é aceitável para uma quota de "não deixe alguém martelar a API" (não uma garantia financeira/comercial)?
