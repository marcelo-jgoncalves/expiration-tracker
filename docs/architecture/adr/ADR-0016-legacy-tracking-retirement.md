# ADR-0016 — Retirada do "Rastreamento legado" (A10) e governança de entrega de solicitação por A22 em `document-archive`

**Status**: `APPROVED` via protocolo Claude↔Codex (nota cega final Claude 9,2/Codex 9,1, 4 rodadas) — Decisão A (nível 6) e Decisão B, escopo (b) (nível 5). **Implementação NÃO iniciada**: aguarda confirmação de Marcelo em 2 pontos de produto nomeados abaixo. | **Data**: 2026-09-25 | **Type**: Type 1 (`change-risk-scale.md` nível 6 para A) | **Decisor**: Marcelo (produto), Claude+Codex (desenho técnico)

Pedido de Marcelo (2026-09-25, sessão de port de `prototype/novasTelas`): avaliar se o "Rastreamento
legado" (A10, `Tracking.tsx`) ainda faz sentido, e permitir que o operador escolha a forma de
entrega no momento da solicitação de documento (A14). Evidência completa das 4 rodadas:
`docs/architecture/reviews/legacy-tracking-retirement/`.

## Pesquisa externa considerada

**NÃO**, para as duas decisões — ambas são puramente sobre como este projeto organiza seu próprio
modelo de dados/módulos (qual dos dois mecanismos internos de conformidade é a fonte de verdade;
como um parâmetro de entrega já existente num módulo é reaproveitado por outro), não um padrão
externo estabelecido (RBAC/invite/sessão) que pesquisa de mercado ajudaria a decidir
(`docs/engineering/research-protocol.md` §"Regra prática para a linha divisória"). Reavaliar como
`SIM PARCIAL` se/quando a pendência nomeada de exposição de link ao operador (abaixo) for aberta.

## Decisão A — retirar por completo o modelo de conformidade M9

`RequirementAssignment` (módulo `subject`, M9 — link/unlink manual de `ExpirationItem`, status
manual MISSING/SATISFIED) foi confirmado, por leitura direta do código nas 4 rodadas, como
plenamente substituído por `Requirement`/`document-archive` (M10+, status **derivado
automaticamente** de evidência real: `evidenceVersionId`+`validUntil`). O ponto de criação de
`DocumentRequest` legado (escopado por `assignmentId`) e o de A14 (escopado por
subject+requirement) são serviços/entidades distintos (`DocumentRequestService` vs.
`DocumentArchiveService`, chaves `REQASSIGN#...` vs. `DOCREQUEST#...`) — não a mesma linha de dado,
mas duas implementações paralelas da mesma capacidade de produto.

**Retirado por completo** (exclusivo, apagar): `RequirementService`+`requirement-assignment.ts`;
`DocumentRequestService`(subject)+`document-request.ts`(subject); `GuestSubmissionService`+
`document-submission.ts`; `document-chasing-producer.ts`+`document-chasing-materializer.ts`+
`domain/document-chasing.ts`+`advance-after-submission-evidence.ts`; `document-chasing-dispatch/
dispatch.ts`+handler+fila/Lambda dedicada; backend completo de G01 (`guest-documents-handler.ts`
para subjects, rotas públicas dedicadas, guest-token/rate-limiter/quarantine-key exclusivos,
`scripts/build-lambdas.ts:65-66`, `infra/main.tf:2202+/2261-2266`,
`infra/modules/api-gateway/main.tf:559-592` e suas referências dependentes — nunca o
`random_password.guest_token_pepper`, compartilhado com outros handlers); telas `Tracking.tsx`
(A10) + `LegacyGuestUpload.tsx` (G01) + hooks frontend dedicados.

**Editado, nunca apagado** (compartilhado): `reminder-producer/producer.ts`,
`reminder-scan/scan-page.ts`, `reminder-claim-consumer-handler.ts`,
`reminder-reconciliation/recover-expired-claims.ts` (remover só o branch `CHASING`, preservar
`ExpirationItem`/`ReminderOccurrence`); `upload-finalizer-handler.ts`/`malware-result-handler.ts`
(remover só o branch `DocumentSubmission` legado); `runtime/aws/composition/subject.ts` (preservar
`buildSubjectDeps`/`SubjectService`/`TrackedSubject`, remover `buildDocumentRequestDeps`/
`buildGuestSubmissionDeps`/`buildSubjectWorkerDeps`/`buildDocumentChasingDispatchDeps`);
`subjects-handler.ts` (remover só rotas de submissions/chasing/document-requests legadas);
`proxy-allowlist.ts`/`schema-validator.ts`/contratos e testes associados (remover só o exclusivo,
preservar A22 migrada).

**Preservado**: `Requirement`/`DocumentArchiveService`/A14 (`SubjectRequests.tsx`)/G02
(`GuestDocumentRequest.tsx`) — o modelo M10+ inteiro; `TrackedSubject`/`ExpirationItem` intocados.

**Critério de saída**: zero referência ativa a qualquer componente "exclusivo" acima (código,
rotas, BFF, build, infra, schemas, testes); fluxo criação→emissão→G02→submissão→revisão→status de
`Requirement` funcional de ponta a ponta; suíte de lembretes de `ExpirationItem` sem regressão.

## Decisão B — escolha de entrega por solicitação em A14 (escopo fechado nesta rodada)

`A22` (`RequestDeliverySettings.tsx`, preferência tenant-wide EMAIL/MANUAL) migra de dono: sai do
`DocumentRequestService`(subject, sendo retirado) e passa a viver em `document-archive` — mesma
chave tenant-wide (`TENANT#<tenantId>#SETTINGS`/`DOCUMENT_REQUEST_DELIVERY`), mesma
autorização HTTP (`OWNER_ROLES` em GET e PUT, sem mudança), mesma OCC/auditoria. Uma leitura
**interna** separada (não exposta por rota própria, escopada ao tenant já autorizado no contexto)
é usada durante criação/materialização — não gated a `OWNER_ROLES`.

`docarchive-request-create-request.v1.json` ganha `initialInviteDelivery?: "DEFAULT" | "MANUAL" |
"EMAIL"`. `DocumentRequestCreated`/materialização de série persistem `resolvedInitialInviteDelivery`
(modo efetivo, resolvido uma única vez: override → preferência A22 → `MANUAL`) pela vida inteira da
solicitação, inclusive reemissão. `guest-credential-delivery/deliver.ts` passa a checar esse campo
(`EMAIL` tenta envio como hoje; `MANUAL` pula deliberadamente, novo `SKIPPED_MANUAL_DELIVERY`,
distinto de `SKIPPED_NO_RECIPIENT_EMAIL`). Séries (`document-request-recurrence-service.ts`,
`document-request-recurrence` worker) resolvem e persistem o modo do mesmo jeito, sem UI de
override própria — A22 passa a governar igualmente avulsas e recorrentes.

**Idempotência**: fingerprint do payload calculado sobre o INPUT normalizado
(`initialInviteDelivery ?? "DEFAULT"`), nunca sobre o modo resolvido — replay de uma chave `DEFAULT`
sempre devolve o snapshot original, mesmo que A22 mude depois; chaves `EMAIL`/`MANUAL` explícitas
conflitam entre si mesmo sob corrida real (a mesma comparação de fingerprint se aplica também no
caminho de corrida perdida do `createDocumentRequest`, fechando um bug pré-existente de reread sem
comparação). `EMAIL` sem destinatário válido é rejeição explícita (`ValidationError`) no caminho
avulso; séries sem destinatário mantêm `SKIPPED_NO_RECIPIENT_EMAIL` como hoje, documentado como
comportamento distinto e intencional.

**Consequência funcional aceita, não escondida**: hoje toda solicitação A14 com `recipientEmail`
tenta e-mail incondicionalmente (nenhuma supressão existe). Depois desta mudança, com a preferência
A22 no default real do código (`MANUAL` quando não configurada), solicitações novas passam a ser
criadas **sem nenhum canal de acesso ao convidado** — mudança deliberada. Copy corrigida em
`RequestDeliverySettings.tsx` (para de prometer link compartilhado por fora) e em
`SubjectRequests.tsx` (formulário avulso e texto de série, para de prometer envio incondicional).

**Pendência nomeada, owner Marcelo, gatilho "antes de oferecer entrega manual funcional"**: obter um
link acessível ao operador para o modo `MANUAL` cruza a fronteira de isolamento de credencial
D-146/D-226 (`document-archive/domain/guest-credential-delivery.ts`) — fora do escopo desta decisão,
exige rodada própria com `SIM PARCIAL` de pesquisa externa (postura de exposição de magic-link).

## Pontos de decisão de produto — respondidos por Marcelo (2026-09-25)

1. **Vínculo `ExpirationItem`→requisito**: descartado sem substituto.
2. **Escopo da retirada**: completa (código+backend+infra), não só ocultar a tela do menu.
3. **Capacidades órfãs** (link manual imediato com fallback de e-mail; revogação individual de
   solicitação avulsa; timeline de chasing por solicitação): as três abandonadas — nenhuma tem
   equivalente em A14 hoje, e nenhuma é reintroduzida por esta decisão.

**Status: `APPROVED` — decisão de produto e desenho técnico ambos fechados. Implementação
liberada.**
