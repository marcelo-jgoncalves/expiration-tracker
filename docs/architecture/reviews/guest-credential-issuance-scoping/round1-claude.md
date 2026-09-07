# Round 1 — Claude proposal: guest credential issuance orchestration (D-222)

## Contexto e problema
D-222 (`decisions-log.md`) auditou o item 9 do roadmap P0 e encontrou 4 gaps. O bloqueador
central (Achado 1): `GuestDocumentAccessService.issueCredential()` não tem call site em todo o
repositório. Nenhum `DocumentRequest` (criado manualmente ou via `materializeAttempt`,
interativo ou pelo worker `document-request-recurrence/materializer.ts`) resulta hoje na emissão
de um `RequestAccessCredential` — o guest nunca recebe um link utilizável.

Causa raiz nomeada em D-222: `composition/document-archive.ts` mantém duas Lambdas
deliberadamente sem overlap de segredo — `document-archive-handler` (autenticada, hospeda
`DocumentArchiveService`/`DocumentRequestRecurrenceService`, SEM o pepper) e
`document-archive-guest-handler` (`authorization_type=NONE`, com `DOCARCHIVE_GUEST_ACCESS_PEPPER`
próprio). Essa separação é uma decisão de segurança explícita de D-146 ("isolamento de superfície
guest"), não um acidente — qualquer solução que faça a Lambda autenticada gerar o `secretHash`
diretamente reverte D-146.

## Declaração E-014
**NÃO.** Isto não é um padrão de mercado a replicar (não é "como fazer magic link" — isso já foi
resolvido e pesquisado em D-143 Decisão 4, NIST SP 800-63B-4/OWASP, e permanece intocado). É uma
decisão de fronteira interna entre dois módulos/Lambdas deste projeto: como uma Lambda sem um
segredo aciona uma operação que só a Lambda com o segredo pode executar. O projeto já resolveu
esse tipo de acoplamento internamente pelo menos 4 vezes (outbox -> SQS -> worker dedicado, ver
abaixo) — a decisão aqui é qual dessas variações já-estabelecidas reaproveitar, não inventar uma
categoria nova. Confirmado lendo `docs/engineering/research-protocol.md` (E-014): pesquisa externa
é exigida quando a decisão "define um padrão que sistemas fora deste projeto já resolveram de
forma estabelecida (RBAC, convite, sessão multi-tenant, etc.)" — aqui a decisão é 100% sobre como
ESTE projeto liga dois dos seus próprios módulos, não sobre desenhar RBAC/convite do zero.

## O que D-143 já cogitou (não é lacuna de design não antecipada)
Lendo D-146 (comentário do próprio `GuestDocumentAccessService.issueCredential()`, linha 144-147):
> "Issuance entry point — normally invoked by an authenticated internal flow when a
> DocumentRequest is created (recurrence's job, D-143 Decision 8, a separate follow-up task).
> Kept here as the minimal, explicit extension point this task needs."

Ou seja: D-146 **já decidiu** que o acionamento fica a cargo de "recurrence's job" como tarefa de
follow-up — o método existe exatamente para ser chamado de fora, mas D-147 (a implementação real
da recorrência) não fechou essa ponta (documentado no próprio D-147: "**Desvio real, documentado**:
o design menciona apenas requestId/attemptIndex/... sem descrever como o worker descobre 'o que
está vencido'" — mas nada em D-147 fala do lado de emissão de credencial; a lacuna do
call site é genuína, D-147 não a fechou por engano de escopo, focado só em "quais Requests
materializar", não em "como o guest recebe o link"). Portanto: não é redesenhar do zero, é fechar
uma extensão já prevista, escolhendo o MECANISMO de acoplamento (que D-143/D-146 deixaram em
aberto) — outbox assíncrono é a opção que preserva D-146 sem alterações.

## Opções consideradas

**Opção A — outbox/SQS assíncrono (proposta)**: a Lambda autenticada, na MESMA
`TransactWriteItems` que cria o `DocumentRequest` (tanto o caminho interativo
`materializeAttempt`/nova `createDocumentRequest` avulsa, quanto o worker
`materializer.ts`), grava um `OutboxRecord` (`buildOutboxRecord`/`appendToTransaction`,
`src/shared/outbox/outbox.ts`) com um novo `OutboxDestination` dedicado
(`SQS_DOCUMENT_REQUEST_CREDENTIAL_ISSUANCE_V1`) e evento de domínio `DocumentRequestCreated`. A
Lambda guest (já tem o pepper) ganha um NOVO handler consumidor SQS
(`document-request-credential-issuance-handler.ts`) que lê o evento, chama
`GuestDocumentAccessService.issueCredential()` e (fatia futura, não desta sessão) despacha a
notificação ao guest pelo canal disponível (WhatsApp/e-mail, item 3/19 do roadmap, em paralelo por
outro agente — este design não implementa envio, só deixa o outbox pronto para consumi-lo, mesmo
padrão "row written before its consumer exists" já usado por
`SQS_REQUIREMENT_EVIDENCE_REFRESH_V1`/`SQS_REPORT_SUBSCRIPTION_DELIVERY_V1`).

Vantagens: reaproveita o ÚNICO mecanismo de acoplamento assíncrono cross-Lambda que o projeto já
usa consistentemente (`DispatchOutboxRelay`, ver M3.5); nunca expõe o pepper fora da Lambda guest;
nunca faz a Lambda autenticada chamar a guest sincronamente (sem acoplamento de disponibilidade);
DocumentRequest já é criado e visível ao tenant mesmo se a fila estiver atrasada (guest link chega
com atraso de segundos/minutos — aceitável, sem usuário real, `AGENTS.md` §1). Consistente com o
padrão de nunca tratar atraso assíncrono como bloqueador de engenharia.

**Opção B — invocação Lambda-a-Lambda síncrona (rejeitada)**: a Lambda autenticada invoca
`document-archive-guest-handler` via SDK (`InvokeCommand`) depois do commit da transação. Rejeitada:
não há precedente no projeto (toda comunicação cross-Lambda hoje é via outbox/SQS, nunca invocação
direta), acopla disponibilidade das duas Lambdas, exige nova IAM policy de invocação e um novo
"comando" HTTP interno na Lambda guest que teria que ser autenticado por outro segredo (reintroduz
exatamente o problema que se está tentando evitar: outro segredo compartilhado).

**Opção C — mover pepper para a Lambda autenticada também (rejeitada)**: violaria D-146
diretamente ("isolamento de superfície guest é decisão de segurança explícita") — fora de escopo,
não é uma correção de gap, é reabrir uma decisão já `APPROVED`.

**Opção D — Lambda guest faz polling do DynamoDB por `DocumentRequest`s sem credencial (rejeitada)**:
exigiria a Lambda guest fazer Scan cross-tenant continuamente (custo, latência, e reintroduz a
classe de problema que `scanActiveSeries`/`scanSatisfiedRequirements` já aceitam como tradeoff só
para jobs diários — fazer isso em polling frequente é pior).

**Decisão: Opção A.**

## Gaps derivados (D-222 Achados 2, 3, 4)

**Achado 2 — DocumentRequest avulso (não recorrente)**: novo método
`DocumentArchiveService.createDocumentRequest(ctx, input)` (fora de `DocumentRequestRecurrenceService`,
que continua exclusivamente para séries) — cria um `DocumentRequest` com `seriesId`/`occurrenceId`/
`attemptIndex`/`parentRequestId` todos ausentes (os 4 campos já são opcionais desde D-147,
ponto de extensão nomeado explicitamente ali), grava o MESMO evento `DocumentRequestCreated` no
outbox na mesma transação — o consumidor guest não distingue avulso de recorrente, o evento já
carrega `documentRequestId`/`tenantId`/`subjectId`/`requirementId`/`deadline`, suficiente para
`issueCredential` em ambos os casos.

**Achado 3 — vínculo reverso `Document`/`DocumentVersion` -> `DocumentRequest`**: `DocumentVersion`
já grava `requestId` no momento do `submitEvidence` do guest (linha 412,
`guest-document-access-service.ts`) — o vínculo reverso já existe fisicamente, mas só é
POPULADO no caminho guest. `rejectVersion()` (`document-archive-service.ts:902`) hoje nunca lê
esse campo nem toca o `DocumentRequest`. Proposta: `rejectVersion()`, quando
`version.requestId` está presente, inclui na MESMA `TransactWriteItems` um `Update` do
`DocumentRequest` correspondente: `status: "REQUESTED"` (reabre o ciclo — reflete a intenção real
"pedir de novo"), incrementa um novo contador `rejectionCount`, grava `lastRejectionReason`. Isto
substitui a ambiguidade hoje documentada em D-222 ("SUBMITTED indefinidamente, 'live' por
acidente da definição, não fluxo desenhado") por um estado explícito e correto.

**Achado 4 — automated chasing**: reaproveita o outbox+worker: quando `advanceCycle`/scheduler
avança e uma tentativa fica `OPENED`/`REQUESTED` além de um limiar configurável sem submissão,
um novo worker `document-request-chasing/producer.ts` (mesmo split produtor/materializador de
`subject/application/document-chasing-{producer,materializer}.ts`, nome deliberadamente distinto
de `document-chasing.ts` do módulo `subject` — D-222 já avisa que são conceitos homônimos não
relacionados) varre `DocumentRequest`s vencidos sem submissão via GSI1 (mesmo índice
`SERIESDUE`/status já existente) e escreve um evento `DocumentRequestChaseDue` no outbox, MESMO
destino de dispatch de notificação usado por `SQS_DOCUMENT_CHASING_DISPATCH_V1` do módulo
`subject` (reaproveitado, não duplicado — é o MESMO conceito "lembrar alguém que não respondeu",
já implementado e testado). Esta parte tem uma decisão de produto genuína embutida — ver seção
"Pendência de produto" abaixo.

## Pendência de produto (não é decisão de engenharia)
Quantos lembretes automáticos, com qual cadência, o worker de chasing deve disparar antes de
parar (e se precisa de aprovação humana por lembrete ou é 100% automático) é decisão de produto do
Marcelo — o texto de D-143 Decisão 8 nunca especificou isso porque a recorrência (repetir o
PEDIDO original) e o chasing (lembrar de um pedido já enviado que não foi respondido) são
conceitos distintos que D-222 encontrou ausentes juntos. Este design entrega o mecanismo
(outbox->worker->dispatch, reaproveitando o padrão já existente) mas NÃO decide os parâmetros de
produto (quantidade/cadência/aprovação). Proposta de engenharia: implementar o mecanismo com um
único lembrete automático (T+3 dias sem resposta, valor de exemplo) atrás de uma constante nomeada
e documentada como "placeholder, aguardando confirmação de produto", nunca escondida.

## Escopo desta rodada
Peço nota do Codex sobre: (1) a escolha de outbox/SQS sobre as 3 alternativas rejeitadas; (2) se
o vínculo reverso via `requestId` já existente é suficiente ou se `rejectVersion()` precisa de
mudança adicional; (3) se o novo `OutboxDestination` e o novo evento de domínio seguem a convenção
já estabelecida; (4) se a separação "chasing é decisão de produto, credential-issuance não é" está
corretamente justificada pelo critério real de `AGENTS.md`/`change-risk-scale.md`.
