# Multi-User B2B — Wave B2B-4 escopo, Rodada 2 (proposta Claude)

Rodada 1: Claude 7,2/Codex 8,4, ambos abaixo do gate — convergência real e independente na mesma fraqueza: "expor `CreateOrganizationService` via HTTP" é superfície de deploy real (handler novo, Lambda, rota API Gateway em Terraform) sem nenhum consumidor real ainda (nenhum frontend/onboarding UI/outra wave chama isso) — viola `principles.md` #1 na direção oposta ao problema original (construir mecanismo antes de evidência de necessidade). Os dois lados propuseram, de forma independente e convergente, a mesma alternativa melhor: um classificador de estado de onboarding, puro e testado, NÃO wireado a nenhum fluxo real.

## Escopo revisado de B2B-4

**Removido**: exposição HTTP de `CreateOrganizationService` (achado de ambos os lados — sem consumidor real, superfície de deploy desnecessária nesta fase).

**Deliverable real de B2B-4**: `OnboardingStateResolver` (novo, `src/modules/organization/application/onboarding-state.ts`) — serviço puro, sem wiring em nenhum fluxo de login real, que dado um `userId` determina um de três estados:

```text
HAS_MEMBERSHIPS        — existe ao menos uma Membership real (via GSI4, MembershipByUser)
LEGACY_TENANT_ONLY     — TenantLifecycleRecord existe para tenantId=userId (bootstrap legado
                          já rodou) E zero Memberships — usuário pré-cutover, continua
                          funcionando sob o modelo antigo sem interrupção
NO_TENANT_NO_MEMBERSHIPS — nem tenant legado nem Membership — só pode existir DEPOIS que
                          Wave B2B-5 parar de criar tenant legado automaticamente; é o
                          estado real que un dia vai acionar "mostrar onboarding"
```

Isso resolve o problema central (distinguir "usuário legado com tenant funcional" de "usuário genuinamente novo sem nenhum tenant") sem:
- tocar `bootstrap-identity.ts`/`resolve-request-context.ts`/`bff-auth-service.ts` (zero risco de regressão para usuários legados);
- criar superfície de deploy sem consumidor (é uma classe de aplicação testável, não uma rota).

É trabalho real que Wave B2B-5 vai precisar (a decisão de quando mostrar onboarding é exatamente essa classificação), resolvido e testado agora enquanto o contexto do design de Membership/GSI4 está fresco, sem exigir deploy nem tocar o caminho de login ao vivo.

`CreateOrganizationService` (já implementado em B2B-3) permanece como está — capability de aplicação isolada, consumida por B2B-5/B2B-6 quando o gate real existir. Não exposta via HTTP nesta wave.

"Remover tenant auto-provision silencioso" e o gate real em login continuam formalmente redesignados para Wave B2B-5 (RequestContext Cutover, §110 do roadmap já define isso textualmente: "eliminar fallback tenantId=userId").

## Pergunta para o Codex

Isto fecha a fraqueza real da Rodada 1 (HTTP sem consumidor) com um deliverable genuinamente melhor, ou ainda falta algo? Em particular: o terceiro estado (`NO_TENANT_NO_MEMBERSHIPS`) é hoje inalcançável no fluxo real (porque bootstrap-identity.ts sempre cria tenant legado) — isso torna o classificador prematuro/não-testável de forma significativa, ou é aceitável testar esse ramo com um fixture sintético que simula o estado pós-cutover (já que é exatamente isso que Wave B2B-5 vai produzir)?
