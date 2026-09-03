# Rodada 3 - Crítica Codex

## 1. Régua v3

A redistribuição está estável. Ela incorpora corretamente as três objeções da Rodada 2:

- progresso de linhas rejeitadas passou a fazer parte explícita do critério principal;
- proveniência do resultado ganhou critério próprio;
- mapping e `/schema` voltaram a ter cobertura, ainda que com peso proporcional de 5%;
- “um tipo por job” caiu para 5%, compatível com seu papel de simplificação.

Não contesto mais os pesos. Minha única ressalva editorial é que o critério 2 deveria dizer “entrega durável do disparo de parse”, além de OCC-safe, porque o código real não possui um caminho genérico de EventBridge para eventos sem `destination`. Isso é uma lacuna do design, não motivo para redistribuir novamente a régua.

## 2. Reavaliação dos 12 achados da Rodada 2

### Bloqueantes

| Achado | Estado | Justificativa |
|---|---|---|
| 1. Protocolo executável para falha de linha | **FECHADO** | Para Document/Requirement, `ImportRowOutcome` e as transações alternativas TENTATIVA/FALLBACK fazem resultado e cursor avançarem atomicamente. O plano S3 permanece imutável. Conflitos concorrentes são detectáveis pelos guards do outcome e do cursor. |
| 2. Corrida mapping/parse e parse síncrono | **PARCIAL** | OCC e a retirada do parse do handler fecham o lost update. Porém o disparo assíncrono ainda não é executável contra a infraestrutura real: `OutboxDestination` é uma união fechada e não contém destino de parse; o comentário do próprio `outbox.ts` registra que o caminho genérico EventBridge nunca foi implementado. É necessário definir `SQS_IMPORT_PARSE_V1`, sender/queue/relay/sweeper/IAM, ou outro consumidor durável concreto. |
| 3. `createSubject()` não é builder mecânico | **FECHADO** | O design abandonou corretamente esse refactor e manteve `SubjectService.createSubject()` como caixa-preta. O escopo de builders transacionais ficou restrito a Document/Requirement. |

### Altos

| Achado | Estado | Justificativa |
|---|---|---|
| 4. `COMMIT_FAILED` sem armazenamento | **FECHADO** | `ImportRowOutcome` é um ledger separado, durável e job+row-scoped, contendo outcome, código de falha, timestamp e eventual `entityId`. |
| 5. Lifecycle de `Subject.externalId` | **FECHADO** | A semântica create-only está inequívoca: não há update, remoção nem atribuição posterior nesta fatia. |
| 6. Classificação posicional frágil | **FECHADO** | `{entries, labels}` segue o precedente estrutural real de Requirement e permite compor entries sem índices mágicos. Cursor/outcome também deverão receber labels próprios para distinguir conflitos técnicos dos fences de domínio. |
| 7. Contrato de `/schema` | **PARCIAL** | Estados, Range GET, ausência do objeto, forma da resposta e amostragem foram definidos. Ainda há três lacunas: `parseCsv()` não consegue identificar que o corte ocorreu dentro de um registro quoted e atualmente materializa esse registro parcial; não há limite/erro para header maior que 64 KiB; e não foi definida a identidade/checksum/version do objeto observado, deixando `/schema` potencialmente inspecionar bytes diferentes dos usados pelo parse. UTF-8 inválido também seria silenciosamente convertido por `Buffer.toString()`, não rejeitado. |

### Médios

| Achado | Estado | Justificativa |
|---|---|---|
| 8. `ColumnMapping` permissivo | **FECHADO** | A união por `schemaVersion + targetKind`, com campos nomeados e kinds de referência fechados, elimina o `Record<string,string>` como contrato. A checagem contra `job.targetEntityType` evita autoridade divergente. |
| 9. Resolução em lote em duas fases | **FECHADO** | Pointer→Subject, deduplicação por `Set`, paginação de 100 chaves e retry de `UnprocessedKeys` estão explícitos; a conta de pior caso foi corrigida para aproximadamente 100 chamadas. |
| 10. Colisão intra-arquivo | **FECHADO** | “Primeiro vence” foi escolhido inequivocamente e coincide com o algoritmo existente. |
| 11. Hash canônico do mapping | **PARCIAL** | A intenção correta está definida, mas “chaves ordenadas alfabeticamente” deve declarar ordenação recursiva de todos os objetos, tratamento de arrays e rejeição de valores fora do domínio JSON. Para a união atual, isso é uma lacuna pequena e facilmente fechável. |
| 12. Limites e encoding das chaves | **ABERTO** | A Rodada 3 não respondeu a este achado. Continuam faltando limites de comprimento e bytes, normalização/canonicalização, caracteres permitidos e composição sem ambiguidade para `externalId`, nomes normalizados e componentes usados em PK/SK. |

## 3. Verificações diretas no código

As alegações verificáveis foram confirmadas:

- `document-archive-service.ts` não contém referência a `quota` ou `entitlement`. A quota HTTP vive nos handlers, não nos métodos do serviço.
- `SubjectService.createSubject()` realmente chama `ensureEntitlement()`, compara `activeTrackedSubjectsCount` com o limite e executa até 20 tentativas sob contenção.
- `parseCsv()` não remove BOM. Hoje `\uFEFF` entra no primeiro header e sobrevive até o `trim().toLowerCase()`.
- `parseCsv()` também confirma a lacuna do Range parcial: no EOF, um campo ainda em estado `Quoted` é incluído como uma linha completa; portanto o contrato “última linha incompleta é descartada” não é implementável apenas chamando o parser atual.
- `createRequirement()` já usa `TransactEntryLabel[]` e `throwClassifiedCancellation()`, não índices literais.
- `seenExternalIdsInFile` implementa first-wins: a primeira ocorrência continua; as seguintes viram `REJECT`.
- O store de import atual usa `PutCommand` incondicional em `update()`, confirmando a necessidade real de substituir as transições relevantes por OCC.
- `OutboxDestination` é fechado e hoje inclui commit de import, mas não parse de import. O relay só publica destinos registrados em `senders`; eventos sem destino reconhecido são ignorados como `SKIPPED_WRONG_DESTINATION`.

## 4. Resultado

Não aprovo o design nesta rodada porque permanece um bloqueio arquitetural executável: o novo `ImportParseRequested` não possui rota real no outbox existente. Para aprovação na Rodada 4, falta objetivamente:

1. Definir o destino fechado e o wiring durável completo do sinal de parse.
2. Corrigir o contrato de Range parsing de `/schema`, incluindo detecção de registro incompleto, header que excede o range e identidade do objeto.
3. Fechar limites e canonicalização dos componentes usados em chaves DynamoDB.
4. Especificar que `canonicalJsonStringify()` ordena objetos recursivamente.

Os itens 2–4 são pequenos e não exigem mudar a arquitetura central. O item 1 é o único bloqueante restante.

**Nota Codex (cega), Rodada 3 - régua: 9.5/10.**  
**Nota Codex (cega), Rodada 3 - design: 8.8/10.**
