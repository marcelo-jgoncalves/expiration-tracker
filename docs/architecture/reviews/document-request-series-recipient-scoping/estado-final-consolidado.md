# Estado final consolidado — DocumentRequestSeries.recipientEmail (fecha o gap nomeado em D-228)

Protocolo Claude↔Codex completo (`AGENTS.md` §4), 3 rodadas, convergência real: Claude 9.2 / Codex
9.2 (nota cega em cada rodada, ambos ≥9,0 sem arredondar na rodada final). Ver `round1-claude.md`,
`round1-codex-critique.md` (7.6), `round2-claude.md`, `round2-codex-critique.md` (8.6),
`round3-claude.md`, `round3-codex-critique.md` (9.2).

## Classificação de risco final: **Nível 5**
Reclassificado a partir do Nível 3 inicial (proposta da Rodada 1) após a crítica do Codex
(Rodadas 1 e 2): muda contrato HTTP (schema novo `docarchive-series-update-recipient-request.v1.
json` + campo novo em `docarchive-series-create-request.v1.json`) e introduz uma ação nova
(`updateSeriesRecipient`) com semântica própria (mutabilidade, remoção via `null`, snapshot). A
régua manda tratar como o nível mais alto na dúvida — aplicado aqui.

## Decisão final
1. **`DocumentRequestSeries.recipientEmail?: string`** — opcional, fornecido pelo humano na
   criação da série (`CreateDocumentRequestSeriesInput.recipientEmail?`). Ausente = comportamento
   atual preservado (worker de entrega pula, skip terminal).
2. **`buildMaterializeAttemptEntries` copia `series.recipientEmail` para `request.recipientEmail`**
   no momento da materialização — snapshot imutável por request, nunca reescrito depois. Cobre os
   dois call sites (`materializeAttempt` interativo E o worker periódico
   `document-request-recurrence/materializer.ts`, ambos passam pelo mesmo builder).
   `buildDocumentRequestCreatedOutboxEntry` não muda (confirmado lendo o código: só emite chaves +
   `issuanceGeneration`, o consumidor sempre relê o `DocumentRequest` autoritativo).
3. **`updateSeriesRecipient(ctx, subjectId, seriesId, expectedVersion, recipientEmail: string |
   null)`** — nova mutação em `DocumentRequestRecurrenceService`, reaproveitando a action
   `docarchive:series-update` já existente (hoje só usada por `advanceCycle`, sem rota HTTP
   própria — sem conflito). `null` → `remove: ["recipientEmail"]` no `buildVersionedUpdate` (nunca
   persiste `null` — o tipo do domínio continua `string | undefined`). Rejeita com `ConflictError`
   quando `series.status !== "ACTIVE"` (série cancelada nunca mais materializa ciclo, mutar seu
   destinatário não teria efeito observável). Mesmo padrão OCC de `cancelSeries`.
4. **Normalização: apenas `.trim()`, sem `.toLowerCase()`.** Ordem final: trim ANTES da validação
   de schema (decisão fechada, não condicionada a comportamento do Ajv). Sem lowercase — a parte
   local de um e-mail não é universalmente case-insensitive; alinhado ao caminho avulso de D-228
   (que também não normaliza), evita introduzir inconsistência nova entre os dois caminhos.
5. **PII**: `recipientEmail` é dado pessoal de terceiro; a decisão de não mascarar em
   `getSeries`/`listSeries` segue o precedente já aceito em D-228 (mesma superfície de autorização
   do tenant que forneceu o dado para o próprio fluxo dele) — não por ausência de sensibilidade.
6. **Rota HTTP nova**: `POST /document-archive/series/{subjectId}/{seriesId}/recipient`, handler
   `handleUpdateSeriesRecipient`, schema `docarchive-series-update-recipient-request.v1.json`
   (`{recipientEmail: string|null, expectedVersion: number}`).
7. **Schema `docarchive-series-create-request.v1.json`**: `recipientEmail` opcional,
   `{"type": "string", "format": "email", "maxLength": 254}`.

## Testes exigidos (G-V3)
`createSeries` persiste/omite corretamente; `buildMaterializeAttemptEntries` copia o campo (teste
puro); materializador periódico produz `DocumentRequest.recipientEmail` correto;
`updateSeriesRecipient` (troca, remoção via `null`, OCC, série `CANCELLED` rejeitada, autorização);
preservação de snapshot entre ciclos; contrato HTTP (válido/inválido/maxLength/`null`);
`getSeries`/`listSeries` expõem o campo; E2E estendido (série COM `recipientEmail` entrega de
verdade; série SEM `recipientEmail` continua fazendo skip terminal, não regressão).
