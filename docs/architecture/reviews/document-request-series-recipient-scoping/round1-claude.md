# Round 1 — Claude proposal: DocumentRequestSeries.recipientEmail (closes D-228's named pendency)

## Contexto e problema
D-228 (`decisions-log.md`) construiu o worker real de entrega de credencial de guest
(`src/workers/guest-credential-delivery/deliver.ts`) e adicionou `DocumentRequest.recipientEmail?:
string`, populado hoje SÓ pelo caminho avulso (`DocumentArchiveService.createDocumentRequest()`).
D-228 nomeou explicitamente, sem resolver, o gap: `DocumentRequestSeries`/`materializeAttempt`
(recorrência) não carrega contato nenhum — um ciclo materializado automaticamente por uma série
produz um `DocumentRequest` sem `recipientEmail`, e o worker de entrega o pula (skip terminal,
`SKIPPED_NO_RECIPIENT_EMAIL`, nunca erro). Isso significa que, hoje, NENHUM `DocumentRequest`
originado de uma série recorrente pode entregar um link de guest de verdade — só o caminho avulso
fecha ponta a ponta.

## Declaração E-014 (pesquisa externa obrigatória? SIM / SIM PARCIAL / NÃO)
**NÃO.** Não é um padrão de mercado a desenhar do zero — é a mesma decisão de fronteira interna já
resolvida duas vezes neste mesmo código-base para o MESMO problema ("como uma entidade sabe para
quem mandar um link de guest"): (1) `subject/domain/document-request.ts`'s `recipientEmail:
string`, obrigatório, sempre um input humano explícito no momento da criação; (2) D-228's
`DocumentRequest.recipientEmail?: string` no módulo `document-archive`, opcional, também um input
humano explícito (`CreateDocumentRequestInput.recipientEmail?`), seguindo deliberadamente o
precedente (1). A decisão aqui é apenas "em qual momento do ciclo de vida da SÉRIE o humano fornece
esse mesmo dado" — não há RBAC/convite/sessão para pesquisar externamente (critério de
`research-protocol.md` E-014).

## Investigação: onde um contato "armazenado" poderia vir de, e por que não existe
Grep exaustivo (`recipientEmail`, `contact`, `email` em `Requirement`/`TrackedSubject`/`Subject`
sob `document-archive`) confirma o que D-228 já registrou: não existe hoje NENHUMA entidade de
"contato armazenado" associada a `Requirement` ou ao Subject dono de uma série, no módulo
`document-archive`. (O módulo `subject` tem seu próprio `recipientEmail` mas é uma entidade
homônima não relacionada, mesma confusão de nomes já registrada em D-222/D-228.) Logo, não há
atalho de "puxar de outro lugar já modelado" — o dado só pode vir de um novo input humano explícito,
igual às duas vezes anteriores.

## Opções consideradas

**Opção A (proposta) — `recipientEmail?: string` em `DocumentRequestSeries`, fornecido uma única
vez no momento de `createSeries()`, copiado para cada `DocumentRequest` materializado.**
`CreateDocumentRequestSeriesInput.recipientEmail?: string` (mesmo padrão opcional de D-228, não o
padrão obrigatório mais antigo do módulo `subject` — uma série já existe sem humano "no loop" por
ciclo, então exigir o campo quebraria séries que hoje não têm nenhum destinatário e que continuam
válidas: o worker de entrega já trata a ausência como skip terminal, nunca erro, exatamente o
comportamento certo para uma série sem recipiente configurado). `buildMaterializeAttemptEntries`
copia `series.recipientEmail` para o novo `DocumentRequest.recipientEmail` do MESMO jeito que copia
`requirementId`/`subjectId` — nenhuma mudança em `buildDocumentRequestCreatedOutboxEntry` (ele já lê
o campo do `DocumentRequest` recém-criado, nunca de um input separado — confirmado lendo o código:
o evento que ele monta nem carrega `recipientEmail`, o worker de entrega SEMPRE re-lê o
`DocumentRequest` autoritativo, D-228 §"nunca confia em nada além das chaves do registro"). Uma
série sem `recipientEmail` continua produzindo ciclos exatamente como hoje — nenhuma mudança de
comportamento para séries existentes (campo ausente = `undefined`, mesmo default atual).

Vantagens: aditivo puro (campo opcional novo, nenhum campo removido/renomeado); zero mudança em
código que já funciona para séries sem destinatário; reaproveita literalmente o builder/outbox já
construído e testado por D-228, sem tocar sua assinatura; simetria total com o precedente
avulso — o humano fornece o e-mail uma vez no momento em que cria a coisa que vai gerar os
`DocumentRequest`s (para o avulso: no momento de criar o request; para a série: no momento de criar
a série, já que a série É o "criador" recorrente).

**Opção B — `recipientEmail` obrigatório em `CreateDocumentRequestSeriesInput` (rejeitada)**:
quebraria a compatibilidade com o padrão "opcional, sem fabricar valor" que D-228 estabeleceu
deliberadamente para este módulo (distinto do módulo `subject`, que pode exigir porque sua ÚNICA
via de criação já força o dado). Não há razão de produto para forçar todo `POST
/document-archive/series` a ter um destinatário — uma série pode legitimamente servir só para
rastrear o ciclo internamente (dashboard interno), sem gerar credencial de guest nenhuma.

**Opção C — permitir atualizar `recipientEmail` de uma série já existente via novo endpoint
(rejeitada nesta rodada)**: fora de escopo do gap nomeado por D-228 (que fala só de CRIAÇÃO da
série); adicionar um `updateSeriesRecipient()` é uma extensão de produto genuína não pedida, e
`cancelSeries`+`createSeries` novo já cobre o caso raro de "mudar o destinatário de uma série" sem
inventar mutabilidade nova. Pode ser retomada depois se o produto pedir.

**Opção D — modelar contato no nível do `Requirement`/`Subject` em vez da série (rejeitada)**:
mudaria o escopo de "quem recebe" de por-série para por-Requirement/Subject — decisão de produto
mais ampla (um Requirement pode ter múltiplas séries com destinatários diferentes ao longo do
tempo?) não pedida por D-228, que nomeou o gap especificamente como "a série não carrega contato".
Resolver no nível certo, mais estreito, sem inventar política nova.

**Decisão proposta: Opção A.**

## Mudanças concretas
1. `document-request-series.ts`: `DocumentRequestSeries.recipientEmail?: string` +
   `CreateDocumentRequestSeriesInput.recipientEmail?: string`.
2. `document-request-recurrence-service.ts`: `createSeries()` grava `input.recipientEmail` quando
   presente (mesmo `...(x !== undefined ? {...} : {})` já usado em D-228);
   `buildMaterializeAttemptEntries()` copia `series.recipientEmail` para o `request` que constrói.
3. `schemas/api/docarchive-series-create-request.v1.json`: novo `recipientEmail` opcional,
   `{"type": "string", "format": "email", "maxLength": 254}` (mesma forma de
   `create-document-request-request.v1.json`), sem adicionar a `required`.
4. Teste: estender `guest-credential-issuance-to-delivery-e2e.test.ts` com um segundo cenário —
   série COM `recipientEmail` → `materializeAttempt` → entrega real funciona; manter/confirmar
   cenário de série SEM `recipientEmail` → skip terminal, nunca erro (provavelmente já coberto
   implicitamente, mas tornar explícito).

## Classificação de risco (`change-risk-scale.md`)
Nível 3: aditivo (campo opcional novo em duas entidades, cópia de valor já existente entre elas),
mesmo padrão já `APPROVED` duas vezes no mesmo código-base para o mesmo problema, nenhuma política
nova (nenhuma nova regra de negócio sobre COMO/QUANDO enviar — só DE ONDE o destinatário vem),
nenhuma mudança em contrato existente (só adição opcional em schema/tipo), nenhuma mudança de
comportamento para dados existentes. Não é nível 4+ porque não há decisão de produto nova a
inventar (Opções B/C/D mostram que a pergunta de produto real — "obrigatório? mutável depois?
por-série ou por-Requirement?" — já tem resposta direta a partir de precedente, não exige uma nova
política a ser inventada aqui).

## Escopo desta rodada
Peço nota do Codex sobre: (1) se Opção A é de fato a menor extensão suficiente ou se falta alguma
peça (ex.: `payloadHash`/idempotência da série — series não tem idempotencyKey hoje, então isso não
se aplica, mas peço confirmação); (2) se a classificação nível 3 está correta ou se algo aqui
esconde uma decisão de produto que eu não nomeei; (3) se `buildDocumentRequestCreatedOutboxEntry`
realmente não precisa de nenhuma mudança (confirmar lendo o código, não assumir); (4) se o schema
HTTP precisa de mais validação além de `format: email`.
