# Multi-User B2B — Wave B2B-13 (E2E/Adversarial Security), escopo final

**Status: `APPROVED`** via protocolo Claude↔Codex (`AGENTS.md` §4, nível 5 de `change-risk-scale.md`),
3 rodadas, nota cega cada rodada: Rodada 1 Claude 8,4/Codex 7,2 (7 achados reais, incl. 1 achado de
produção novo do Codex); Rodada 2 Claude 8,8/Codex 8,8 (régua E-014 9,1/10, 4 achados de precisão/
completude); Rodada 3 Claude 9,1/Codex 9,2 (régua E-014 9,3/10, fechamento, ambos ≥9,0, sem
arredondar). Registrado como `docs/architecture/decisions-log.md` D-112. Evidência completa das 3
rodadas: `docs/architecture/reviews/multi-user-b2b-wave-b2b13-scoping/`.

Escopo per `roadmap-evolution/17` §118 (testar multi-user/multi-org/roles/cross-tenant/invitation/
revocation/last-owner/W3-07/BFF/cache/uploads/async/guest/S3/quota/audit) e §121 (25 perguntas
obrigatórias do review adversarial).

## Levantamento real contra as 25 perguntas — matriz final

Auditoria completa (leitura direta de código+testes, verificação própria + crítica do Codex) contra
as 25 perguntas de §121 — **20 já tinham teste adversarial real** (achado das próprias waves B2B-5 a
B2B-12), **2 fecham com fix real de produção** (mesmo bug em 2 pontos, achado #3 original + achado
#6 do Codex), **2 ganham teste novo** (comportamento já correto, nunca provado ponta-a-ponta), **1**
(auditoria de fixture IDs) é um passo de verificação, não um teste único.

| Q | Veredito | Evidência |
|---|---|---|
| 1 | COBERTA | `bootstrap-identity.ts:81` (transação 2 itens, sem `tenantId`); B2B-12/D-111 removeu `LEGACY_TENANT_ONLY` |
| 2 | COBERTA | `identity-mapping-repository.ts:19-26`; `resolver.test.ts:37` |
| 3 | COBERTA | `resolver.test.ts:37,54` |
| 4 | COBERTA | `organization-persistence.test.ts:128` |
| 5 | COBERTA | `bff-organization-context.test.ts:109-148` |
| 6 | **NOVO TESTE** | `resolver.test.ts` — revogação real (`RemoveMembershipService`) encadeada com `resolve()` subsequente |
| 7 | **NOVO TESTE** | `authorization.test.ts`/`resolver.test.ts` — roles DIFERENTES por Organization, mesmo usuário |
| 8 | COBERTA | `ActiveOrganizationContext.test.tsx:73` |
| 9 | COBERTA | `ActiveOrganizationContext.test.tsx:54` |
| 10 | COBERTA | `bff-organization-context.test.ts:204/228/247` |
| 11 | COBERTA | `dynamo-tenant-purge.test.ts:82` |
| 12 | COBERTA | `dynamo-tenant-purge.test.ts:82` + `privacy-lgpd.md` §4.1 |
| 13 | COBERTA | `accept-invitation.test.ts:105` |
| 14 | COBERTA | `accept-invitation.test.ts:119` |
| 15 | COBERTA | `membership-management.test.ts:110-156` |
| 16 | COBERTA (contrato §47/§48, não bug) | `document-service.ts:186-193`; `import-service.ts:91/172-219`+`import-service.test.ts:152-208`; ver nota de documentação abaixo |
| 17 | **FIX REAL** | `email-delivery-workflow.ts`/`dispatch.ts:178` via `DynamoDbNotificationRecipientResolver` reaproveitado |
| 18 | COBERTA | `quota.test.ts:39`; `cross-tenant.test.ts:148-172` |
| 19 | COBERTA | `idempotency.test.ts:167` |
| 20 | COBERTA | `document-service.test.ts:167/174/182` |
| 21 | COBERTA | `guest-upload-flow.test.ts:198` |
| 22 | COBERTA | `member-eligibility.ts:12`+`expiration-service.ts:705`+`expiration-service.test.ts:128`+`item-watch-service.test.ts:70` |
| 23 | COBERTA (roteamento) + **FIX REAL** (entrega) | `dynamodb-recipient-resolver.test.ts:79` (roteamento); entrega fechada pelo fix do Q17 |
| 24 | COBERTA | `frontend/src/api/queryKeys.ts` (organizationId obrigatório); `ActiveOrganizationContext.test.tsx` |
| 25 | **AUDITORIA** | busca sistemática por 10 palavras-chave (`cross-tenant`/`tenant`/`org`/`membership`/`document`/`quota`/`bff`/`notification`/`subject`/`import`) confirmando IDs distintos entre papéis adversariais |

## Achados reais (verificados por leitura de código, não hipotéticos)

**Achado #1 (Q6)** — nenhum teste encadeia uma revogação real de Membership
(`RemoveMembershipService`) com uma chamada subsequente a `RequestContextResolver.resolve()` —
`membership-management.test.ts` prova só a escrita, `resolver.test.ts` nunca testa `"REMOVED"`.

**Achado #2 (Q7)** — os 2 testes multi-org de `resolver.test.ts:161-184` usam `role: "OWNER"` nas
DUAS Organizations do mesmo usuário — nunca prova que um role de uma Organization não vaza para
`authorize()` de outra com role genuinamente diferente.

**Achado #3 (Q17/Q23, produção real)** — `resolveRecipientEmail()`
(`runtime/aws/composition/notification.ts:61-65`), usado no momento de ENVIO (não de roteamento),
lê só `GlobalUser`, nunca `Membership` — janela TOCTOU real entre o roteamento (que já checa
elegibilidade via `DynamoDbNotificationRecipientResolver`) e a entrega assíncrona.

**Achado #4 (Q17, achado do Codex, mesma classe)** — `resolveInternalUserEmail()`
(`runtime/aws/composition/subject.ts:128-132`, consumida por `document-chasing-dispatch/
dispatch.ts:178` no tier `EXPIRED`) tem o MESMO gap — a mesma função que D-109 corrigiu recentemente
por um motivo diferente (`UserProfile`→`GlobalUser`).

**Achado #5 (Q25)** — nenhuma sessão auditou fixture IDs de testes adversariais cross-tenant por
coincidência acidental atacante/vítima.

## Declaração E-014: SIM PARCIAL

Fonte: OWASP Web Security Testing Guide, seção de Authorization Testing/IDOR
(`owasp.org/www-project-web-security-testing-guide`, acessado 2026-08-30) — representativo por ser o
guia de teste de segurança mais citado para "revalidar autorização perto da ação sensível", não
documentação de vendor único. Escopo do `SIM`: Achados #3/#4 (recheck de elegibilidade imediatamente
antes de um efeito colateral externo irrevogável, após atraso assíncrono) são exatamente esse
padrão. Escopo `PARCIAL`/interno: o MECANISMO de correção (reaproveitar
`DynamoDbNotificationRecipientResolver` já testado, não inventar um terceiro) e os Achados #1/#2/#5
(disciplina de teste, não padrão externo) são decisão interna.

### Checklist de critérios de nota (subordinado a `joint-review-criteria.md`, eixo Segurança/AppSec)

1. (35%) Recheck de elegibilidade o mais próximo possível do efeito colateral externo, cobrindo
   TODOS os envios assíncronos internos que resolvem usuário por e-mail (2 consumidores reais).
2. (25%) Nenhum teste novo desta wave usa fixture IDs coincidentes entre papéis logicamente
   diferentes.
3. (25%) Cada gap fechado tem teste que FALHARIA sem a correção (G-V3 nomeado).
4. (15%) Nenhuma mudança de produção fora do fix de elegibilidade — Achados #1/#2/#5 são só teste.

## Escopo final aprovado

### 1. Fix real — `DynamoDbNotificationRecipientResolver` reaproveitado (2 consumidores)

`ResolvedRecipient` (`notification/ports/recipient-resolver.ts`) ganha `email?: string` (aditivo,
mesmo `Promise.all` que já lê `Membership`+`GlobalUser`, sem 3ª leitura). `notification.ts`'s
`resolveRecipientEmail` e `subject.ts`'s `resolveInternalUserEmail` passam a instanciar
`DynamoDbNotificationRecipientResolver` e usar `result?.active ? result.email : undefined` — nunca
mais leem `GlobalUser` sozinho. `subject.ts` já importa de `notification/` hoje
(`ses-email-adapter.ts`), não é fronteira de módulo nova. Comentário em `recipient-resolver.ts`
documenta que este resolver (2 consumidores) e `MemberEligibilityChecker`
(`expiration/ports/member-eligibility.ts`, forma diferente — boolean, não e-mail) usam a MESMA regra
(`Membership.status==="ACTIVE" && GlobalUser.identityStatus==="ACTIVE"`), nunca fundidos (formas de
retorno genuinamente diferentes).

### 2-3. Testes novos (Achados #1/#2) — Q6/Q7

Novo teste em `test/unit/identity/resolver.test.ts`: `RemoveMembershipService` real remove uma
Membership ACTIVE, `RequestContextResolver.resolve()` subsequente lança. Novo teste (mesmo arquivo
ou `authorization.test.ts`): usuário `MEMBER` numa Organization e `OWNER` noutra, `authorize()`
respeita o role da Organization ativa no momento, nunca vaza entre elas.

### 4. Teste G-V3 do fix (document-chasing)

`test/unit/subject/document-chasing-dispatch.test.ts` ganha teste estendendo o padrão de `:274`:
fake `resolveInternalUserEmail` simulando Membership revogada → `undefined` → intent `FAILED`, zero
envio. Nota de DoD (achado do Codex, Rodada 3, não bloqueante): este teste prova a lógica de
`dispatch.ts`'s branch `!email`, não a fiação real da composição — a regra de 2 condições em si
continua provada por `dynamodb-recipient-resolver.test.ts` (já existente, estendido para cobrir o
campo `email` novo).

### 5. Documentação (Q16, não teste novo)

Comentário em `document-service.ts` citando §47/§48: nova admissão negada após revogação de
Membership → prova pela Correção do Achado #1 (nível resolver, antes de `DocumentService` ser
chamado); nova admissão negada após Organization `DELETING` → já provado (`TenantNotActiveError`
fencing existente); capability já emitida sobrevive dentro do TTL → nunca revalidada pela aplicação
por design (S3 valida a assinatura), não testável no nível de app.

### 6. Auditoria (Achado #5, Q25)

Busca sistemática pelas 10 palavras-chave nos testes adversariais reais, confirmando IDs distintos
entre papéis (atacante/vítima, membro A/membro B) — corrige qualquer coincidência real encontrada,
documenta a auditoria como evidência mesmo se zero achados.

## Fora de escopo desta wave

Re-testar as 20 perguntas já `VERIFIED-COVERED`. Orquestrador do purge W3-07 (pendência separada).
Qualquer mudança de UI/frontend. Migração de `import-service.ts` para o mesmo resolver reaproveitado
(nenhum bug ali, `principles.md` #1 — proporcionalidade).
