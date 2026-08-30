# Multi-User B2B — Wave B2B-4 (Onboarding) escopo, Rodada 1 (proposta Claude)

Antes de qualquer código: esta é uma proposta de ESCOPO (o que B2B-4 deve/não deve tocar), não um design físico novo — não reabre o protocolo de D-086 (physical model), mas é a primeira wave desde B2B-2 que tocaria wiring de login real (`bootstrap-identity.ts`/`resolve-request-context.ts`/`bff-auth-service.ts`), por isso o Marcelo pediu para submeter ao protocolo Claude↔Codex antes de apresentar a ele.

## 1. O que o roadmap formalmente pede

`roadmap-evolution/17-multi-user-b2b-revised-strategy.md` §109 (Wave B2B-4): "Remover tenant auto-provision silencioso. Implementar: new User → Create Organization ou Accept Invitation."

## 2. Achado — o escopo literal do roadmap colide com a fronteira real de B2B-5, não é executável com segurança agora

`Accept Invitation` depende de `Invitation` (token pointer, dedup pointer) — escopo formal de Wave B2B-8 (§113), inexistente ainda. Isso já era esperado e está registrado no wave tracker.

**Achado mais sério, não registrado antes**: "remover tenant auto-provision silencioso" e "new User → gate em Memberships" não podem ser wireados na wave ATUAL sem quebrar todo usuário legado existente. Motivo concreto:

- Hoje, `TenantBootstrapService.createAll()` (`bootstrap-identity.ts`, mantido deliberadamente por B2B-2/D-087) continua criando `TenantLifecycleRecord`+`UserProfile` automaticamente no primeiro login — TODO usuário existente já tem acesso de tenant funcional via esse modelo legado.
- Nenhum desses usuários legados tem uma linha `Membership` real (Wave B2B-3 criou o mecanismo, mas `CreateOrganizationService` nunca foi chamado para eles).
- Se B2B-4 wireasse "checar GSI4 (`MembershipByUser`) → zero Memberships → oferecer onboarding/`CreateOrganization`" DENTRO do fluxo de login real (`RequestContextResolver`/`bff-auth-service.ts`) agora, TODO usuário legado (que tem tenant funcional, só não tem `Membership`) veria uma tela de onboarding pedindo para "criar uma organização" — UX quebrada/confusa para quem já tem acesso funcionando, não um caso genuinamente novo.
- Essa checagem só faz sentido semanticamente DEPOIS que o fallback legado for eliminado (B2B-5 — "RequestContext Cutover... eliminar fallback tenantId=userId" é literalmente a definição de quando `Membership` passa a ser a única fonte de verdade de acesso a tenant).

## 3. Proposta de escopo revisado para B2B-4

**Não tocar** `bootstrap-identity.ts`, `resolve-request-context.ts`, ou `bff-auth-service.ts` nesta wave — nenhum wiring em fluxo de login real ainda. Isso pertence estruturalmente a B2B-5 (que já é, por definição, a wave que remove o fallback legado).

**Escopo real de B2B-4 nesta fase**: expor `CreateOrganizationService` (já implementado, Wave B2B-3) como uma capability HTTP endereçável e testável de ponta a ponta — `src/modules/organization/http/` (handler real, mesmo padrão de `src/modules/subject/http/`ou equivalente), SEM decidir ainda QUANDO/COMO o frontend ou o fluxo de login a invoca. Isso:
- entrega valor real e testável (a capability passa a existir como rota real, não só classe de aplicação isolada);
- não toca nenhum código de login/bootstrap existente, zero risco de regressão para usuários legados;
- prepara o terreno para B2B-5 chamar essa mesma rota/serviço quando o gate de Membership for real.

"Remover tenant auto-provision silencioso" fica formalmente redesignado como parte de B2B-5 (onde já pertence semanticamente), não B2B-4 — isso é uma correção de fronteira de wave, não uma mudança do design aprovado em D-086.

## 4. Pergunta direta para o Codex

Esta reclassificação de fronteira (mover "remover auto-provision" + "gate em Memberships" de B2B-4 para B2B-5, deixando B2B-4 só como "expor `CreateOrganizationService` via HTTP") é uma correção real e segura, ou existe um jeito de fazer o gate de onboarding real funcionar HOJE sem quebrar usuários legados que eu não considerei (ex.: um flag/heurística que distingue "usuário legado com tenant funcional" de "usuário genuinamente novo sem nenhum tenant")? Se existir uma forma segura de fazer mais nesta wave, prefiro isso a diminuir o escopo desnecessariamente.
