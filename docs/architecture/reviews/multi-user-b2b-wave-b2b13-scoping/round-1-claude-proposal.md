# Wave B2B-13 (E2E/Adversarial Security) — Round 1 Proposal

Escopo per `roadmap-evolution/17-multi-user-b2b-revised-strategy.md` §118/§121: atacar
multi-user/multi-org/roles/cross-tenant/invitation/revocation/last-owner/W3-07/BFF/cache/uploads/
async/guest/S3/quota/audit usando as 25 perguntas de §121 como checklist.

## Levantamento real contra as 25 perguntas (não hipotético)

Auditoria linha-a-linha de toda a suíte de testes real (backend+frontend) contra cada uma das 25
perguntas — **20 de 25 já têm teste adversarial real e verificado** (achado das próprias waves
B2B-5 a B2B-12, cada uma testando o bug específico que corrigiu). Detalhe completo por pergunta
não repetido aqui (seria redundante com o código-fonte dos testes já citados); resumo: Q1-Q5,
Q8-Q15, Q18-Q24 `VERIFIED-COVERED` com arquivo:linha real confirmado por leitura. **5 pontos reais
restantes** — os únicos que justificam trabalho novo nesta wave (proporcionalidade,
`principles.md` #1: não retestar o que já está provado):

## Achados reais (verificados por leitura de código, não hipotéticos)

**Achado #1 (Q6) — revogação de Membership nunca testada ponta-a-ponta.**
`test/unit/organization/membership-management.test.ts:161/199` prova só que
`RemoveMembershipService`/`ChangeMembershipRoleService` gravam `status="REMOVED"` corretamente.
`test/unit/identity/resolver.test.ts` (grep exaustivo, zero ocorrências de `"REMOVED"`) nunca
encadeia essa remoção com uma chamada real subsequente a `RequestContextResolver.resolve()` — o
lado da ESCRITA (revogar) está provado, o lado da LEITURA (a revogação é respeitada por quem
autoriza depois) nunca foi encadeado no mesmo teste. Gap real, não hipotético: nenhum teste hoje
prova que revogar de fato nega acesso subsequente.

**Achado #2 (Q7) — nenhum teste usa roles DIFERENTES por Organization.**
`test/unit/identity/resolver.test.ts:161-184` (2 testes de multi-org, incl. o de hint) usa
`role: "OWNER"` nas DUAS Organizations do mesmo usuário — nunca MEMBER numa e OWNER noutra. Não
prova que `resolveRoles(membership.role)` (`resolve-request-context.ts`) reflete só o role da
Organization ATIVA no momento, e não um valor vazado/cacheado de outra Membership do mesmo GSI4.

**Achado #3 (Q16/Q17/Q23) — gap real de TOCTOU entre roteamento e entrega assíncrona de
notificação.** `resolveRecipientEmail()` (`runtime/aws/composition/notification.ts:61-65`), usado
só no momento de ENVIO real (`email-delivery-workflow.ts:127-128`), lê exclusivamente `GlobalUser`
— nunca `Membership`. O ROTEAMENTO (`notification-router-workflow.ts` via
`DynamoDbNotificationRecipientResolver.resolve()`, migrado em B2B-11/D-108) já checa as 2 condições
reais (`Membership.status==="ACTIVE" && GlobalUser.identityStatus==="ACTIVE"`) — mas entre o
roteamento (que admite o envio, gravando `NotificationAttempt`) e o ENVIO real (assíncrono, pode
levar minutos por retry/backoff/SQS), a elegibilidade nunca é reverificada. Se a Membership for
revogada NESSE intervalo, o e-mail ainda é enviado ao usuário removido — o roteamento nega
corretamente ROTEAR para um removido (Q23 confirmado coberto NESSE sentido), mas não garante que um
envio JÁ roteado antes da remoção seja cancelado — janela real de TOCTOU (time-of-check-to-time-of-
use), não hipotética: `dynamodb-recipient-resolver.ts` e `runtime/aws/composition/notification.ts`
são dois pontos de leitura DIFERENTES do mesmo dado, um correto e um desatualizado por design atual.
Distinto de Q16 (presigned URLs), que **não é um gap** — `roadmap-evolution/17` §47/§48 já decidiu
formalmente "emissão da URL é o admission point... não prometer revogação instantânea de uma
capability impossível de revogar", e `document-service.ts:186-193`'s comentário confirma a mesma
semântica de admissão já implementada para presign — só falta um teste que PROVE esse contrato
intencional, não uma correção de código.

**Achado #4 (Q25) — nenhuma auditoria real de higiene de fixture IDs entre testes adversariais de
isolamento cross-tenant.** `docs/architecture/multi-user-b2b-wave-b2b0-inventory.md` já catalogou
12 ocorrências de fixture `tenantId=userId` em 10 arquivos de teste (cosmético, não produtivo) — mas
nenhuma sessão verificou se algum teste ESPECIFICAMENTE adversarial de isolamento cross-tenant usa,
por acidente, o MESMO ID literal para "atacante" e "vítima" (o que tornaria a asserção de isolamento
vacuously true — passa mesmo se o isolamento real estivesse quebrado).

## Declaração E-014

**SIM PARCIAL.** Fontes: OWASP Testing Guide (`owasp.org/www-project-web-security-testing-guide`,
seção de Authorization Testing, "Testing for Insecure Direct Object References"/re-teste de
autorização pós-mudança de estado) e o princípio TOCTOU (time-of-check-to-time-of-use) de segurança
de sistemas distribuídos — ambos amplamente estabelecidos, não específicos deste projeto. Escopo do
`SIM`: o Achado #3 (recheck de elegibilidade imediatamente antes de um efeito colateral externo
irrevogável, especialmente após atraso/fila assíncrona) é exatamente o padrão que essas fontes
descrevem — "revalidar autorização o mais próximo possível da ação sensível, nunca confiar numa
decisão tomada num momento anterior para uma ação que só executa depois de um atraso". Escopo do
`PARCIAL`/interno: o MECANISMO de correção (reaproveitar o mesmo par
`Membership.status==="ACTIVE" && GlobalUser.identityStatus==="ACTIVE"` já usado por
`dynamodb-recipient-resolver.ts`, não inventar um terceiro) é decisão interna, já convergida por
D-108; os Achados #1/#2/#4 são só disciplina de teste faltando (nenhum padrão externo ajudaria a
decidir COMO testar isolamento multi-tenant que este projeto já não soubesse).

### Checklist de critérios de nota (subordinado a `joint-review-criteria.md`, eixo Segurança/AppSec)

1. (peso 35%) O recheck de elegibilidade no Achado #3 acontece o mais próximo possível do efeito
   colateral externo (a chamada real a `emailProvider.send()`), nunca só no roteamento — fecha a
   janela TOCTOU de verdade, não só reduz.
2. (peso 25%) Nenhum teste novo desta wave usa fixture IDs coincidentes entre papéis logicamente
   diferentes (atacante/vítima, membro A/membro B) — Achado #4 aplicado aos PRÓPRIOS testes novos,
   não só auditoria dos antigos.
3. (peso 25%) Cada gap fechado (Achados #1/#2/#3) tem um teste que FALHARIA sem a correção (G-V3),
   não um teste que já passaria mesmo sem nenhuma mudança.
4. (peso 15%) Nenhuma mudança de produção fora do Achado #3 — Achados #1/#2/#4 são só teste novo,
   não tocam `src/modules/organization`/`identity` (já corretos, só não provados).

## Proposta concreta

### 1. (Achado #1) Teste real de revogação ponta-a-ponta

Novo teste em `test/unit/identity/resolver.test.ts`: `RemoveMembershipService` real remove uma
Membership ACTIVE; `RequestContextResolver.resolve()` subsequente para o mesmo usuário/Organization
deve lançar (via `resolveWorkingOrganization`) em vez de resolver — prova a cadeia
escrita-then-leitura no mesmo teste, não em arquivos separados.

### 2. (Achado #2) Teste real de roles diferentes por Organization

Novo teste em `test/unit/identity/authorization.test.ts` (ou `resolver.test.ts`): usuário com
`MEMBER` numa Organization e `OWNER` noutra — `authorize()` para uma action `OWNER_ROLES` deve
permitir quando o hint aponta para a Organization onde é OWNER e negar quando aponta para a onde é
MEMBER, mesmo usuário, mesma sessão.

### 3. (Achado #3) Fix real + teste — recheck de Membership no envio de e-mail

`resolveRecipientEmail` (`runtime/aws/composition/notification.ts`) passa a checar
`Membership.status==="ACTIVE" && GlobalUser.identityStatus==="ACTIVE"` (mesmo par de
`dynamodb-recipient-resolver.ts`, reaproveitando a leitura, não duplicando lógica — a decidir com o
Codex se via composição direta ou extraindo um helper compartilhado em `notification/`) antes de
retornar o e-mail; retorna `undefined` se não elegível — o caminho `!to` já existente em
`email-delivery-workflow.ts:130-135` já trata isso como falha terminal conclusiva, nenhuma mudança
de contrato adicional necessária. G-V3: teste prova que revogar a Membership DEPOIS do roteamento
(`NotificationAttempt` já em `SUBMITTING`) mas ANTES do envio real bloqueia o envio.

### 4. (Achado #3, Q16) Teste do contrato de admissão de presigned URL (não é fix)

Novo teste em `test/unit/document/document-service.test.ts`: emite presigned URL enquanto Membership
ACTIVE, revoga a Membership, confirma que o upload ainda completa dentro do TTL (prova o contrato
intencional de §47/§48, não um bug) — e que uma NOVA tentativa de reserva após a revogação é negada
pelo gate de autorização normal (não por lógica nova em `document-service.ts`).

### 5. (Achado #4) Auditoria de higiene de fixture IDs

Revisão dos testes adversariais cross-tenant reais (`test/integration/cross-tenant.test.ts`,
`test/unit/document/document-service.test.ts`, `test/unit/identity/quota.test.ts`) confirmando que
IDs de "atacante"/"vítima" são sempre literais distintos — corrige qualquer coincidência real
encontrada; se nenhuma for encontrada, documenta a auditoria como evidência (não um not-applicable
silencioso).

## Fora de escopo desta wave

Re-testar as 20 perguntas já `VERIFIED-COVERED` (proporcionalidade — já provadas por waves
anteriores, listadas com arquivo:linha na seção de levantamento). Orquestrador do purge W3-07
(D-083, já registrado como pendência separada). Qualquer mudança de UI/frontend (nenhum dos 5
achados toca frontend).

## Perguntas abertas para a Rodada 1 do Codex

1. O recheck do Achado #3 (item 3) deveria ficar inline em `resolveRecipientEmail` (composição) ou
   virar um port/helper compartilhado explícito (`notification/ports/`) reaproveitável por outros
   consumidores futuros — dado que hoje só há este um call site real?
2. Existe algum OUTRO ponto de entrega assíncrona (não só e-mail) que sofra do mesmo TOCTOU e que
   esta leitura não tenha encontrado?
3. O teste de presigned URL (item 4) deveria também cobrir o cenário de a Organization inteira ser
   revogada/deletada (não só a Membership de um usuário) durante a janela do TTL, ou isso já está
   coberto por `document-service.ts`'s fencing de `TenantBusinessMutation` existente?
4. A auditoria do Achado #4 (item 5) é suficientemente escopada aos 3 arquivos citados, ou deveria
   cobrir toda a suíte de testes de forma exaustiva (custo vs. valor a decidir)?
