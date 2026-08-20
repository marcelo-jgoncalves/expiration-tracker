# M4 — Nota cega de Claude, Rodada 2 (documento convergido)

Avaliado: `docs/architecture/m4-notification-engine-design.md` (rodada 2) + `codex-proposal-round1.md` (base técnica) + `round1-decisions-resolved.md` (deltas). Nota cega — ainda não vi a nota do Codex para esta rodada.

## Nota: 8.6/10

Não bate o gate de 9.0. Achados que impedem, por ordem de severidade:

### 1. Item aberto #7 (lookup de attempt) não está fechado — e isso bloqueia a implementação, não é só um detalhe

A base técnica lista duas opções (ponteiro `TENANT#t#ATTEMPT#a/LOOKUP` vs. SK derivável) e diz "minha preferência é o ponteiro", mas isso nunca foi formalmente decidido — ficou em "itens abertos". Sem essa decisão, não dá pra escrever o schema de `NotificationAttempt` nem o `SesCallbackWorker`: o mecanismo de correlação callback→attempt é o componente central do milestone (§11.3 da base), não é incidental. Isso deveria ter virado uma decisão fechada nesta rodada, não permanecer como "técnico, não bloqueante" — discordo da classificação do documento convergido.

**Proposta de fechamento**: adotar o ponteiro (`PK=TENANT#t#ATTEMPT#<attemptId>`, `SK=LOOKUP`, atributos `intentId`+`attemptSk`), criado na mesma `TransactWriteItems` que cria a tentativa (§9.1 passo 10 da base) — evita `Query`, é O(1), e generaliza para qualquer canal futuro (WhatsApp) sem precisar de outro desenho. Custo: uma escrita a mais por tentativa, desprezível.

### 2. Item aberto #8 (GSI5 tenant-scoped vs. exemplo global do blueprint) tem risco de recriar o erro já cometido duas vezes no projeto (GSI3, depois GSI6)

O documento convergido cita isso como "item técnico, não bloqueante" — discordo. `m3.5-runtime-design.md` documenta explicitamente que a mesma classe de erro (GSI com chave tenant-scoped que um worker global não consegue consultar) já foi cometida no GSI3 e de novo no GSI6 antes de ser corrigida. Se o comportamento correto do GSI5 para callback (tenant-scoped, segundo a proposta base) depende de o `SesCallbackWorker` sempre já saber o `tenantId` antes de consultar — o que é verdade, porque a correlação primária é por tags SES que já carregam `tenantId` — então tenant-scoped está certo e não é um risco real. Mas o documento não registra *por que* está certo, só lista como pendência. Isso precisa virar uma frase explícita no design (não uma reavaliação nova), para não ser reaberto por engano numa sessão futura pensando que é o mesmo erro de GSI3/GSI6.

### 3. Nenhuma decisão sobre DLQ própria para `SesCallbackQueue`

A proposta base já assume implicitamente que existe DLQ (menciona "maxReceiveCount=5" na lista de alarmes agregada, seção 14, para "SesCallbackQueue DLQ age") — mas a proposta original de Claude (rodada 1) tinha isso como item aberto explícito ("se `EmailCallbackQueue` precisa de DLQ própria"), e o documento convergido nunca resolveu essa contradição entre as duas propostas. Preciso que isso seja uma frase fechada: sim, `SesCallbackQueue` tem DLQ (a base técnica já assume isso na seção de alarmes, então a resposta prática já é "sim" — só falta a frase explícita).

### 4. Falta um teste negativo explícito para o achado de segurança que motivou o delta #2 (destinatário)

O delta 2 (validação tenant-scoped do `assigneeUserId`) foi um achado real de isolamento cross-tenant — mas nenhum dos dois documentos (base + convergência) lista um caso de teste específico tipo "assigneeUserId aponta para usuário de outro tenant → RECIPIENT_NOT_ELIGIBLE, nenhum e-mail enviado" na Camada 1. A lista de testes da base (§13) tem "tenant divergente no callback é rejeitado" mas não tem o equivalente para o router/resolver. Isso é a mesma classe de omissão que o full-audit já penalizou em outros eixos (achado sem teste de regressão correspondente).

## O que já está acima de 9.0 e não precisa de mais rodada

Fluxo ponta a ponta, matriz fail-closed/fail-open, outbox/sweeper, modelagem de idempotência do SES (estados `SUBMITTING`/`UNKNOWN`), callbacks e transições monotônicas, IAM por role, os 3 deltas de produto resolvidos (consentimento, destinatário na parte de precedência, complaint) — nenhum achado novo nessas áreas.

## Itens abertos remanescentes (#3,4,5,6,9,11,12 da base) — concordo que são follow-up técnico de implementação, não bloqueiam nota de design.
