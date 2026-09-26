---
status: proposta Rodada 3 do protocolo Claude↔Codex
owner: Marcelo (decisão final)
authority: proposta, não normativa
---

# Rodada 3 — fechando os contratos de B e o inventário de A (Codex R2: 8,6/10 NEEDS FIXES)

Aceito todos os achados de `round-2-codex-output.txt`. Nenhum é descartado; endereço um a um.

## A — inventário: componentes compartilhados vs. exclusivos (achado 2 do Codex)

Correção de disciplina: retirar só os branches/imports/deps ligados a `RequirementAssignment`/
`DocumentSubmission`/DocumentRequest legado dentro de arquivos **compartilhados** — nunca o arquivo
inteiro:

**Exclusivo (apagar por completo)**: `RequirementService`+`requirement-assignment.ts`;
`DocumentRequestService`(subject)+`document-request.ts`(subject); `GuestSubmissionService`+
`document-submission.ts`; `document-chasing-dispatch/{dispatch,producer,materializer}.ts` +
`document-chasing-dispatch-handler.ts` + fila/Lambda dedicada (`infra/main.tf:2225-2242`);
`guest-documents-handler.ts` (backend de G01) + rotas públicas dedicadas
(`infra/modules/api-gateway/main.tf:443-471,547-592`) + guest-token/rate-limiter/quarantine-key
exclusivos de G01; `Tracking.tsx`+`LegacyGuestUpload.tsx`+hooks frontend já listados.

**Compartilhado (editar, nunca apagar o arquivo)**: `reminder-producer/producer.ts:178-190` e
`reminder-scan/scan-page.ts:166-168` (remover só o branch que produz candidatos `CHASING`,
preservar `ReminderOccurrence`/`ExpirationItem` intocados);
`reminder-claim-consumer-handler.ts:67`/`reminder-reconciliation/recover-expired-claims.ts:18-19`
(remover só a chamada a `claimChasingOccurrence`/recuperação de `DocumentChasingOccurrence`);
`upload-finalizer-handler.ts:113-128`/`malware-result-handler.ts:119-132` (remover só o branch que
invoca os workers de `DocumentSubmission` legado — continuam processando `document-archive` e
itens normalmente); `runtime/aws/composition/subject.ts` (remover `buildGuestSubmissionDeps`(:88) e
a composição de dispatch(:143+), preservar `SubjectService`/`TrackedSubject`); `subjects-handler.ts`
(remover só as rotas de submissions/chasing/document-requests legadas, preservar as de
`TrackedSubject`).

**Critério de saída** (nomeado, para o ADR formal quando a decisão fechar): zero referência ativa
aos componentes "exclusivo" acima; os arquivos "compartilhado" compilam/testam sem os branches
legados; fluxo criação→emissão→G02→submissão→revisão→status de `Requirement` funcional de ponta a
ponta; lembretes de `ExpirationItem` sem regressão (suíte de reminder existente continua verde).

## A22 — migração de ownership (achado 3 do Codex)

Mover o tipo + `resolveInitialInviteDeliveryMode` (função pura) de
`subject/domain/document-request-delivery-preference.ts` para
`document-archive/domain/document-request-delivery-preference.ts` — **mesma chave tenant-wide já
existente** (`TENANT#<tenantId>#SETTINGS`/`DOCUMENT_REQUEST_DELIVERY`), sem migração de dado, só de
código/módulo. Preservar OCC/auditoria/autorização hoje em `document-request-service.ts:250-300`
(`OWNER_ROLES`, corrigindo o comentário desatualizado que dizia `ADMIN_ROLES`). **Correção
aceita**: o resolvedor interno de default usado durante `createDocumentRequest` chama um método
interno do `DocumentArchiveService` (não gated a `OWNER_ROLES`) — quem cria uma solicitação
(`WRITE_ROLES`) não precisa poder administrar a configuração para lê-la; só `PUT` continua
`OWNER_ROLES`. Sem alias de URL legada — não há compatibilidade de produção a preservar
(`AGENTS.md` §1).

## B — os 4 contratos que faltavam (achado 5 do Codex), fechados nesta rodada

**(a) Idempotência**: `payloadHash` passa a incluir o modo efetivo normalizado (`EMAIL`/`MANUAL`) —
mesma chave de idempotência com modos diferentes gera `ConflictError`, igual a qualquer outro campo
do payload hoje. O modo **resolvido** (não o override bruto) é persistido num novo campo
(`resolvedInitialInviteDelivery: "EMAIL" | "MANUAL"`) na criação, calculado uma única vez.
Replay (mesma `idempotencyKey`+mesmo payload) sempre devolve o snapshot original — nunca reavalia
contra uma preferência de A22 mudada depois.

**(b) EMAIL sem destinatário**: `createDocumentRequest` rejeita explicitamente
(`ValidationError`) quando o modo efetivo resolvido é `EMAIL` e `recipientEmail` está ausente ou
inválido — nunca cria a solicitação para depois o worker silenciosamente pular
(`SKIPPED_NO_RECIPIENT_EMAIL` continua existindo só para o caso real de série/materialização sem
destinatário cadastrado, não para o caminho avulso com EMAIL explícito).

**(c) Reemissão**: `resolvedInitialInviteDelivery` persiste pela vida inteira da solicitação
(recomendação mais simples do Codex, adotada) — `rejectVersion`/nova `issuanceGeneration` consulta
o mesmo campo já gravado, nunca recalcula. Testes cobrem 1ª emissão e reemissão sob EMAIL e MANUAL.

**(d) Séries**: escopo do override no formulário fica avulsas-only (`SubjectRequests.tsx`, sem
campo equivalente na criação de série nesta rodada) — mas o worker `guest-credential-delivery`
passa a checar `resolvedInitialInviteDelivery` em QUALQUER `DocumentRequest`, inclusive os
materializados por série (`document-request-recurrence-service.ts:97-111`, que já copia
`recipientEmail` da série). Para não introduzir supressão silenciosa numa superfície sem UI de
escolha: `buildMaterializeAttemptEntries` resolve o modo do mesmo jeito que o caminho avulso
`DEFAULT` resolveria (preferência de A22, sem override possível) e persiste
`resolvedInitialInviteDelivery` também nesses registros — governança de A22 passa a valer
igualmente para série e avulsa, sem tratamento especial.

## Consequência funcional de MANUAL — nomeada, não escondida (achado 4 do Codex)

Aceito a correção: não é "o mesmo gap de sempre". Hoje TODA solicitação A14 com `recipientEmail`
preenchido tenta e-mail incondicionalmente (nenhum conceito de supressão existe). Depois desta
mudança, com a preferência de A22 não explicitamente configurada (default real do código,
`preference?.initialInviteDeliveryDefault ?? "MANUAL"`), uma solicitação nova passa a ser criada
**sem nenhum canal de acesso ao convidado** — mudança funcional deliberada, registrada aqui como
tal.

Correções de copy exigidas antes de fechar a Decisão B (não é polimento cosmético, é parte do
contrato aprovado):
- `RequestDeliverySettings.tsx:39-42` para de prometer que "o link é compartilhado por fora" — não
  há mecanismo de obtenção de link nesta etapa (ver pendência nomeada abaixo).
- `SubjectRequests.tsx:373-379,394` (formulário "Solicitar documento") deixa de prometer envio
  incondicional; para o resultado MANUAL, informa explicitamente que a solicitação foi criada sem
  envio automático e sem link disponível nesta versão, referenciando a pendência nomeada.
- Correção de referência aceita: o comentário sobre fronteira D-146/D-226 fica em
  `SubjectRequests.tsx:19-25`, não `RequestDeliverySettings.tsx`.

**Pendência nomeada, owner Marcelo, gatilho "antes de oferecer entrega manual funcional ao
operador"**: obter um link acessível para MANUAL cruza a fronteira D-146/D-226
(`document-archive/domain/guest-credential-delivery.ts:2-16`) e precisa de rodada própria,
`SIM PARCIAL` de pesquisa externa (postura de exposição de token/magic-link) quando for aberta —
não faz parte desta decisão.

## Risco e pesquisa (mantidos da Rodada 2, sem mudança)

A = Nível 6. B = Nível 5 para o escopo fechado nesta rodada (b). Pesquisa externa: `NÃO` para o
escopo atual (política e fronteiras de credencial já existentes, problema é encaixe interno);
reavaliar como `SIM PARCIAL` só quando/se a pendência nomeada de exposição de link for aberta.

## O que seguirá pendente de Marcelo até a implementação (inalterado desde R2)

1. Vínculo `ExpirationItem`→requisito sem substituto: descartar sem substituto, salvo Marcelo
   confirmar caso real necessário.
2. Retirada completa confirmada (não ocultar).
3. Matriz manter/abandonar/adiar para: link manual+fallback de e-mail, revogação individual,
   timeline de chasing por solicitação avulsa — nenhuma tratada como resolvida pela recorrência.
