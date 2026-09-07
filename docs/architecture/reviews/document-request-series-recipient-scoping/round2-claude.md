# Round 2 — Claude revision, respondendo à crítica do Codex (nota cega 7.6)

## Aceito, e o que muda

**1. Mutabilidade — aceito integralmente.** Adiciono `updateSeriesRecipient(ctx, subjectId,
seriesId, expectedVersion, recipientEmail)` em `DocumentRequestRecurrenceService`, reaproveitando a
action `docarchive:series-update` que JÁ EXISTE em `authorization.ts` (usada hoje só por
`advanceCycle`, que não tem rota HTTP própria — confirmado por grep, é chamada só internamente/por
worker futuro; não há conflito de reuso). Nova rota HTTP `POST
/document-archive/series/{subjectId}/{seriesId}/recipient` + handler
`handleUpdateSeriesRecipient` + schema novo `docarchive-series-update-recipient-request.v1.json`
(`{recipientEmail: string|null, expectedVersion: number}` — `null` explícito permite REMOVER o
destinatário, não só trocá-lo, já que "parar de mandar link automaticamente" é uma operação
legítima). Mesmo padrão OCC de `cancelSeries`/`advanceCycle` (Update condicionado a
`expectedVersion`, `ConflictError` em corrida).

**2. Semântica de snapshot — declarada explicitamente agora, não implícita.** Documentado no
doc-comment de `DocumentRequestSeries.recipientEmail` e no builder: `buildMaterializeAttemptEntries`
copia `series.recipientEmail` para `request.recipientEmail` NO MOMENTO da materialização — cada
`DocumentRequest` já criado é um snapshot IMUTÁVEL desse valor (nenhum mecanismo o reescreve depois
que o request existe; isso já é verdade estruturalmente, hoje, para TODO campo copiado de um
`DocumentRequest` — `requirementId`/`subjectId` também não são "sincronizados" retroativamente).
`updateSeriesRecipient` afeta só CICLOS FUTUROS. Requests já materializados nunca são
reendereçados — nomeado explicitamente como comportamento pretendido, não descoberto depois.

**3. Exposição/PII em `getSeries`/`listSeries` — aceito o ponto, resposta: nenhuma mudança de
política nova é necessária.** `DocumentRequest.recipientEmail` (D-228) já é retornado por
`getRequest`/rotas equivalentes sem mascaramento — o precedente já aceito é "e-mail de destinatário
externo, visível ao tenant autenticado que já tem `docarchive:series-read`/`request-read`,
mesma superfície de autorização de todo outro campo da série/request". Isto não é dado sensível de
terceiro anônimo: é o contato que O PRÓPRIO TENANT forneceu para o PRÓPRIO fluxo dele. Introduzir
mascaramento aqui e não em D-228 seria inconsistente sem motivo novo — fora de escopo real, não uma
lacuna evitada por conveniência.

**4. Normalização — aceito, ação mínima.** `recipientEmail` é `.trim().toLowerCase()` antes de
persistir (série e avulso, alinhando também com D-228 retroativamente seria um scope-creep —
proponho normalizar SÓ o caminho novo (série) nesta rodada, documentado como inconsistência
pré-existente conhecida no avulso, não uma regressão introduzida aqui).

**5. Endereço errado / permanentemente inutilizável — resolvido pelo item 1** (mutabilidade real via
`updateSeriesRecipient`, não cancelar/recriar).

**6. Plano de testes — expandido, incorporando a lista completa do Codex:**
- `createSeries` persiste `recipientEmail` quando fornecido; ausente quando omitido (comportamento
  atual preservado).
- `buildMaterializeAttemptEntries` copia o campo para o `request` — teste unitário direto do
  builder (já teste puro, sem I/O).
- Caminho do MATERIALIZADOR PERIÓDICO (`document-request-recurrence-materializer.test.ts` já testa
  esse worker; estendo com um cenário de série COM `recipientEmail` confirmando que o
  `DocumentRequest` resultante o carrega — cobre a preocupação real do Codex de que o E2E só prova
  o caminho interativo).
- `updateSeriesRecipient`: troca válida, remoção via `null`, OCC/`ConflictError` em versão
  divergente, autorização (`VIEWER` rejeitado).
- Preservação: request já materializado ANTES de um `updateSeriesRecipient` mantém seu
  `recipientEmail` antigo; o PRÓXIMO ciclo materializado usa o novo valor.
- Contrato HTTP: schema aceita e-mail válido, rejeita formato inválido e string > 254 chars;
  `updateSeriesRecipient` aceita `null`.
- `guest-credential-issuance-to-delivery-e2e.test.ts`: estendido com o cenário ponta-a-ponta
  série→materialize→entrega real (mantém o pedido original do enunciado da tarefa), MAIS um
  cenário de série sem `recipientEmail` confirmando skip terminal (não regressão).

## Classificação de risco — resposta à objeção do Codex

Mantenho **Nível 3**, com justificativa explícita (não recuso o ponto, respondo com o precedente
real do próprio projeto): `change-risk-scale.md` nível 5 fala de mudança de contrato que ALTERA
significado/formato existente ("novo formato de evento/schema", "muda... chave de partição").
D-228 — a decisão IMEDIATAMENTE anterior, no MESMO módulo, resolvendo o MESMO problema (campo
opcional novo em domínio + schema HTTP, para permitir entrega de guest) — se autoclassificou
"Nível 3-4" com a mesma régua, pelo mesmo raciocínio: campo aditivo/opcional, sem quebra de
contrato existente, mesmo padrão já convergido. Tratar esta extensão (idêntica em forma, um passo
adiante no mesmo gap nomeado por D-228) como Nível 5 exigiria também reclassificar D-228
retroativamente — inconsistente sem motivo novo.

O que MUDA de fato com a Rodada 2, e que o Codex está certo em apontar como não-trivial: a
mutabilidade (`updateSeriesRecipient`) introduz uma AÇÃO nova (não só um campo), com sua própria
superfície de autorização/OCC — isso é engenharia direta seguindo o padrão idêntico de
`cancelSeries`/`advanceCycle` (mesmo shape: subjectId+seriesId+expectedVersion+authorize), não uma
categoria nova. Não upgrada a classificação: mantenho Nível 3, mas registro que esta é a peça que
mais se aproxima de "decisão de produto" (permitir remoção via `null`) — decisão de engenharia
razoável dentro do espaço já aberto por D-228, não uma política nova sobre COMO/QUANDO entregar.

## Escopo desta rodada
Peço nota do Codex: (1) a resposta sobre snapshot/mutabilidade fecha a lacuna apontada; (2) reuso da
action `docarchive:series-update` (hoje só usada por `advanceCycle`, sem rota HTTP) para a nova
mutação é apropriado ou merece action dedicada; (3) a defesa do Nível 3 via precedente D-228 é
válida ou o Codex insiste em Nível 5; (4) falta algo mais antes de implementar.
