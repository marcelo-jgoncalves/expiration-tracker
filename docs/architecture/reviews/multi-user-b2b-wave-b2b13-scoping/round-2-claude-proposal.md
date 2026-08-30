# Wave B2B-13 — Round 2 Proposal (7 achados reais, nota Codex 7,2/10)

Todos os 7 pontos aceitos como reais (achado #6 do Codex é um achado de produção genuíno, não
contestado; os demais são correções de escopo/rigor, também aceitas integralmente).

## Correção 1 (achado #6 do Codex) — mesmo TOCTOU confirmado em `document-chasing-dispatch`

Verificado por leitura própria antes de aceitar: `resolveInternalUserEmail()`
(`runtime/aws/composition/subject.ts:128-132`) — a MESMA função que D-109 corrigiu recentemente
para ler `GlobalUser` em vez de `UserProfile` (fechando um gap DIFERENTE, de sequência) — ainda lê
só `GlobalUser.emailNormalized`, nunca `Membership.status`, exatamente como `resolveRecipientEmail`
de `notification.ts`. Consumido por `document-chasing-dispatch/dispatch.ts:169` no tier `EXPIRED`
(e-mail interno para `request.requestedByUserId`). Mesma classe de bug, achado real e independente do
Achado #3 original — incorporado ao escopo com o MESMO fix.

## Correção 2 (achado do Codex) — helper compartilhado, não port novo, não 2 fixes duplicados

Aceito: 2 consumidores reais agora (notification e-mail + document-chasing EXPIRED) tornam um port
abstrato novo desproporcional, mas duplicar a mesma leitura DynamoDB 2 vezes seria pior. Novo helper
`resolveEligibleMemberEmail(client, tableName, tenantId, userId)` em
`src/runtime/aws/composition/member-eligibility.ts` (par com os outros composition roots, nunca um
port em `shared/` — `shared/` nunca importa de `modules/**`, e este helper precisa de `Membership`
do módulo `organization`): mesmas 2 condições de `dynamodb-recipient-resolver.ts`
(`Membership.status==="ACTIVE" && GlobalUser.identityStatus==="ACTIVE"`), retorna `email` só se
elegível. `notification.ts`'s `resolveRecipientEmail` e `subject.ts`'s `resolveInternalUserEmail`
passam a chamá-lo em vez de ler `GlobalUser` sozinho.

## Correção 3 (achado do Codex) — teste de presigned URL removido, recontextualizado como
cobertura já existente, não teste novo

Aceito o achado #5 do Codex integralmente — a proposta original (item 4, Rodada 1) estava mal
desenhada: `DocumentService.reserveUpload()` recebe um `RequestContext` JÁ resolvido e nunca
reconsulta `Membership` (`document-service.ts:76-78`) — um teste unitário nesse nível não pode provar
"nova reserva negada após revogação" porque essa negação acontece numa camada ANTES de
`DocumentService` sequer ser chamado (a HTTP request seguinte seria barrada por
`RequestContextResolver`/`resolveWorkingOrganization()`, já provado pela Correção 1 (nova) do
Achado #1 desta wave). E "URL já emitida continua válida" não é algo que o código da aplicação
verifica (S3 valida a assinatura SigV4 sozinho) — não há comportamento de app para testar ali.
Corrigido: **removido** o item 4 original como teste novo; substituído por uma nota explícita no
próprio `document-service.ts` (comentário, não código) citando o contrato de §47/§48 e apontando
para onde cada metade já é provada: (a) nova admissão negada após revogação de Membership → prova
da Correção do Achado #1 (nível resolver); nova admissão negada após Organization `DELETING` → já
provado (`document-service.test.ts`'s fencing de `TenantNotActiveError` existente); (b) capability já
emitida sobrevive dentro do TTL → não testável no nível de aplicação (nunca revalidado por design),
documentado como tal.

## Correção 4 (achado do Codex) — evidência de Q16 estendida a `ImportService`

Aceito: `import-service.ts:91/172-177/211-219` tem o mesmo padrão de presign+fence de Organization
(`TenantNotActiveError` na admissão), já coberto por `test/unit/import/import-service.test.ts:152-208`
— nenhum bug real ali (confirmado pelo Codex e por leitura própria), só faltava citar como evidência
de Q16 em vez de só `DocumentService`. Adicionado à matriz da Correção 7 abaixo, sem teste novo
(proporcionalidade — já coberto).

## Correção 5 — declaração E-014 com data de acesso + checklist ampliado

Aceito: faltava data de acesso verificável na Rodada 1. Fonte: OWASP Web Security Testing Guide,
"Testing for Insecure Direct Object References"/seção de Authorization Testing
(`owasp.org/www-project-web-security-testing-guide`, acessado 2026-08-30) — representativo por ser
o guia de teste de segurança mais citado para exatamente esta classe de problema (revalidar
autorização perto da ação sensível), não documentação de um único vendor. Checklist (critério #1 da
Rodada 1) ampliado: "todos os envios assíncronos internos que resolvem usuário por e-mail" (não só
notification), cobrindo agora os 2 consumidores reais confirmados (Correção 1).

## Correção 6 — matriz compacta Q→arquivo:linha (as 25 perguntas)

| Q | Veredito | Evidência |
|---|---|---|
| 1 | COBERTA | `bootstrap-identity.ts` (só GlobalUser+IdentityMapping); B2B-12/D-111 removeu `LEGACY_TENANT_ONLY` |
| 2 | COBERTA | `identity-mapping-repository.ts:19-26`; `resolver.test.ts:37` |
| 3 | COBERTA | `resolver.test.ts:37,54` |
| 4 | COBERTA | `organization-persistence.test.ts:128` |
| 5 | COBERTA | `bff-organization-context.test.ts:109-148` |
| 6 | **NOVO TESTE** (Achado #1) | `resolver.test.ts` (a escrever) |
| 7 | **NOVO TESTE** (Achado #2) | `authorization.test.ts`/`resolver.test.ts` (a escrever) |
| 8 | COBERTA | `ActiveOrganizationContext.test.tsx:73` |
| 9 | COBERTA | `ActiveOrganizationContext.test.tsx:54` |
| 10 | COBERTA | `bff-organization-context.test.ts:204/228/247` |
| 11 | COBERTA | `dynamo-tenant-purge.test.ts:82` |
| 12 | COBERTA | `dynamo-tenant-purge.test.ts` + `privacy-lgpd.md` §4.1 |
| 13 | COBERTA | `accept-invitation.test.ts:105` |
| 14 | COBERTA | `accept-invitation.test.ts:119` |
| 15 | COBERTA | `membership-management.test.ts:110-156` |
| 16 | COBERTA (contrato, não bug) | `roadmap-evolution/17` §47/§48; `document-service.ts:186-193`; `import-service.test.ts:152-208`; fencing existente — ver Correção 3 |
| 17 | **FIX REAL** (Achado #3+#6 do Codex) | `email-delivery-workflow.ts`/`dispatch.ts` via `resolveEligibleMemberEmail` novo |
| 18 | COBERTA | `quota.test.ts:39`; `cross-tenant.test.ts:148-172` |
| 19 | COBERTA | `idempotency.test.ts:167` |
| 20 | COBERTA | `document-service.test.ts:167/174/182` |
| 21 | COBERTA | `guest-upload-flow.test.ts:198` |
| 22 | COBERTA | B2B-11/D-107-108, `MemberEligibilityChecker` |
| 23 | COBERTA (roteamento) + **FIX REAL** (entrega, Achado #3) | `dynamodb-recipient-resolver.test.ts:79` (roteamento); entrega fechada pela Correção 2 |
| 24 | COBERTA | `frontend/src/api/queryKeys.ts` (organizationId obrigatório); `ActiveOrganizationContext.test.tsx` |
| 25 | **AUDITORIA AMPLIADA** (Achado #4 do Codex) | ver Correção 7 abaixo |

## Correção 7 (achado do Codex) — auditoria de fixture IDs ampliada a toda a suíte relevante

Aceito: 3 arquivos era escopo insuficiente para uma decisão Type 1. Ampliado para busca sistemática
em toda a suíte por palavra-chave (`cross-tenant`, `tenant`, `org`, `membership`, `document`, `quota`,
`bff`, `notification`, `subject`, `import` — os 10 termos do próprio achado do Codex) confirmando que
nenhum teste adversarial de isolamento usa o MESMO ID literal para papéis logicamente diferentes
(atacante/vítima, membro A/membro B) — corrige qualquer coincidência real encontrada, documenta a
auditoria completa como evidência.

## Sem mudanças

Classificação de risco (nível 5) e a escolha de reaproveitar o par
`Membership.status==="ACTIVE" && GlobalUser.identityStatus==="ACTIVE"` (não inventar um terceiro
critério) — o Codex concordou explicitamente com ambos na Rodada 1.
