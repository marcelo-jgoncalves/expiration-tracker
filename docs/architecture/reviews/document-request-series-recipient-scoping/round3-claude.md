# Round 3 — Claude final revision, fechando os 7 pontos da Rodada 2 (nota cega 8.6)

## 1. Reclassificação de risco: aceito, **Nível 5**
O Codex insiste, pela segunda vez, com o mesmo argumento textual da régua ("muda contrato", "novo
formato de schema") e a regra explícita de `change-risk-scale.md` ("na dúvida, tratar como o nível
mais alto"). Não vou insistir numa terceira vez no Nível 3 — o precedente D-228 é evidência de
como o projeto tratou um caso PARECIDO, não uma exceção normativa à régua, como o próprio Codex
aponta corretamente. Reclassifico para **Nível 5**: protocolo Claude↔Codex obrigatório (que já
está em curso, cumprido por esta própria rodada), nota ≥9,0 de ambos exigida antes de implementar
— é exatamente o que esta rodada 3 busca fechar.

## 2. `null` → `REMOVE`, não persistência de `null`
Especificado: `updateSeriesRecipient(..., recipientEmail: string | null, ...)` — quando o
CHAMADOR passa `null`, o `buildVersionedUpdate` usa `remove: ["recipientEmail"]` (mesmo mecanismo
já usado por `advanceCycle` para `latestRequestId`), nunca `set: { recipientEmail: null }`. O tipo
persistido continua `recipientEmail?: string` (nunca `string | null`) — `null` é só o VOCABULÁRIO
da API/input para dizer "remova", nunca um valor armazenado. Documentado no doc-comment do método
e no schema (`"recipientEmail": { "type": ["string", "null"], "format": "email", "maxLength": 254
}` — ajv aplica `format`/`maxLength` só quando o valor é string, `null` passa direto pela branch de
tipo `null`).

## 3. Série `CANCELLED`: rejeitar a atualização
`updateSeriesRecipient` passa a checar `current.status !== "ACTIVE"` e lança `ConflictError`
("Cannot update recipient of a cancelled series.", ...) antes de montar o update — mesma forma de
guard que outras mutações do projeto usam para estado terminal (ex.: `rejectVersion` já teve
guards equivalentes nomeados em D-222/D-226). Justificativa: uma série cancelada nunca mais
materializa ciclo nenhum (`materializeAttempt`/o worker produtor não agem sobre séries
`CANCELLED` — confirmado: `documentRequestSeriesGsi1Keys` já separa `ACTIVE`/`CANCELLED` em
partições GSI1 distintas, e o produtor consulta só a partição `ACTIVE`), então mutar o
destinatário de uma série morta não tem efeito observável — melhor recusar explicitamemente
(sinaliza erro de uso ao chamador) do que aceitar silenciosamente uma mutação sem efeito.

## 4. Caracterização de PII: corrigida
Retiro a frase "não é dado sensível de terceiro" — estava errada. Reformulado:
`DocumentRequestSeries.recipientEmail`/`DocumentRequest.recipientEmail` SÃO PII de terceiro (a
pessoa que vai receber o link de guest, tipicamente não um usuário do tenant). A decisão de NÃO
mascarar em `getSeries`/`listSeries`/`getRequest` continua a mesma (nenhuma mudança de política
nova nesta tarefa), mas a justificativa correta é: o tenant autenticado que já tem
`docarchive:series-read` é o CONTROLADOR desse dado dentro do próprio fluxo de negócio dele (ele
mesmo forneceu o e-mail para o PRÓPRIO caso de uso de pedir um documento a essa pessoa) — é
tratamento necessário e já autorizado pelo mesmo modelo de permissão que rege todo o resto da
série/request, não ausência de sensibilidade. Nenhuma mudança de código decorre disto (é uma
correção textual da justificativa, o comportamento já era o mesmo do precedente D-228). Testes de
exposição adicionados de volta ao plano (item 6 abaixo).

## 5. Normalização: ordem e semântica fechadas
Ordem: **trim primeiro, validação de schema depois, lowercase só na camada de aplicação (service),
nunca no schema**. Motivo técnico (correção ao apontamento do Codex sobre a parte local do e-mail
não ser universalmente case-insensitive): lowercase é aplicado SÓ ao domínio inteiro após o `@`
não é seguro em geral, então em vez de arriscar uma normalização tecnicamente incorreta, a decisão
revisada é: **normalizar apenas `.trim()`** (remoção de espaços) no service, antes de persistir;
**não fazer lowercase algum** — mesmo tratamento que o caminho avulso (D-228) já dá hoje
(nenhum `.toLowerCase()` existe em `createDocumentRequest`, confirmado lendo o código), preservando
consistência em vez de introduzir uma inconsistência nova entre os dois caminhos. O schema HTTP
continua validando `format: email` sobre a string já recebida (o `trim()` acontece no service,
depois da validação de schema, para não mascarar um erro real de input com espaços acidentais —
ajv v8 exige que o valor já bata com `format` como veio; um `"  a@b.com  "` passa `format: email`
porque a maioria dos validadores ajv ignora espaços de borda nesse formato — CONFIRMAR
empiricamente no teste, e se ajv rejeitar espaços de borda, mover o `trim()` para ANTES da
validação dentro do handler, documentado explicitamente qual dos dois é o comportamento real
observado).

## 6. Testes — lista final (substitui a da Rodada 2)
- `createSeries` persiste `recipientEmail` (trimmed) quando fornecido; ausente quando omitido.
- `buildMaterializeAttemptEntries` copia o campo (teste puro do builder).
- Materializador periódico (`document-request-recurrence-materializer.test.ts`): série com
  `recipientEmail` produz `DocumentRequest.recipientEmail` igual.
- `updateSeriesRecipient`: troca válida; remoção via `null` (assert `recipientEmail` ausente do
  objeto persistido, nunca `null`); `ConflictError` em OCC divergente; `ConflictError` em série
  `CANCELLED`; autorização (`VIEWER` rejeitado, reaproveitando `docarchive:series-update`).
- Preservação: request materializado ANTES de `updateSeriesRecipient` mantém seu valor antigo;
  PRÓXIMO ciclo usa o novo.
- Contrato HTTP: e-mail válido; formato inválido rejeitado; `> 254 chars` rejeitado; `null` aceito
  no update; `additionalProperties: false` continua valendo.
- `getSeries`/`listSeries` retornam `recipientEmail` quando presente (teste de exposição explícito,
  fechando o pedido da Rodada 1 que ficou de fora da Rodada 2).
- E2E (`guest-credential-issuance-to-delivery-e2e.test.ts`): série COM `recipientEmail` →
  `materializeAttempt` → entrega real funciona; série SEM `recipientEmail` → skip terminal
  (não-regressão).

## 7. Escopo desta rodada
Nível 5 aceito, protocolo em curso. Peço nota final do Codex: isto fecha as 7 lacunas apontadas? Há
algo que ainda impede liberar para implementação?
