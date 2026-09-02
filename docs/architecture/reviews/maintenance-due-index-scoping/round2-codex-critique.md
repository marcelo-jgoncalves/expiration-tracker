# MaintenanceDueIndex — Rodada 2 (crítica Codex)

Invocação real: `codex exec --skip-git-repo-check - < codex-round2-prompt.txt` (background, nota cega — Codex
leu `round2-claude-revision.md` e sua própria crítica da Rodada 1 para conferir resolução real, não só
menção). Saída completa arquivada localmente (não versionada); resumo fiel abaixo.

**NOTA: 6.4/10 — não aprova a Rodada 2.**

## Achados bloqueantes (verificados contra o código real pelo Codex, com `arquivo:linha`)

1. **Plano de rollout via `npm run reset-dev-data` é inexequível como escrito.** O script não existe em
   `package.json` como comando `npm run`; e mais grave, `scripts/reset-dev-data.ts` **só apaga** DynamoDB/S3/
   SQS/Cognito (Fase B, `reset-dev-data.ts:348-385`) — não recria nenhum item. "Reseed completo",
   "100% dos itens nascem com o ponteiro" e "folga de minutos durante a execução" são afirmações falsas.
   Achado #5 da Rodada 1 continua totalmente aberto.
2. **A exclusão de `requirement-reindex` do escopo se baseia numa leitura invertida do código real.**
   `reindex.ts:46-47` compara `evidenceValidUntil` com `now` e dispara a transição `SATISFIED→NOT_SATISFIED`
   exatamente quando esse campo passa — isso **é** um `dueAt` natural. A Rodada 2 afirmou o oposto.
3. **Vários "relógios" da matriz da §4 não correspondem ao código real**: `quota-telemetry-purge` usa
   `resetAt + 30 dias` (`purge.ts:54`), não `resetAt` puro; `delivery-record-purge` usa `createdAt + 180 dias`
   (`purge.ts:66`), não `deliveredAt/failedAt`; `transient-purge`/`WebhookInbox` usa `createdAt`
   (`purge.ts:65`), não `receivedAt`; a matriz também omite `EphemeralTelemetryMutation` já incorporado ao
   candidate source de `quota-telemetry-purge`, e descreve `core-user-data-purge` vagamente quando o worker
   cobre concretamente `ExpirationItem`/`ReminderPolicy`.
4. **"Revalidação atômica" não é atômica** — `core-user-data-purge/purge.ts:78` (e o mesmo padrão nos outros
   workers com fence de tenant) lê `TenantLifecycleRecord.status` separadamente (com cache), sem participar da
   condição do delete; o tenant pode sair de `ACTIVE` entre a leitura e o delete. Precisa de
   `TransactWriteItems` com `ConditionCheck` do lifecycle na mesma transação do delete, ou invariante
   equivalente demonstrada.
5. **Custo de `KEYS_ONLY` como "zero-adicional" é falso.** Vários candidate sources hoje retornam os atributos
   necessários diretamente do `Scan` e fazem delete condicional sem `GetItem` intermediário — `KEYS_ONLY`
   adiciona sim uma leitura por candidato para esses workers. Falta modelo quantitativo mínimo comparando
   `Query+Get+Write` vs. `Scan` atual.
6. **Política contra poison records ainda incompleta**: falta condição exata do update de falha (versão +
   ponteiro observado + attempt count esperado), comportamento em resultado ambíguo, garantia de que o loop
   segue processando após falha individual, operação/redrive/permissão de leitura da quarentena, e
   `Count(GSI8PK="DLQ#...")` **não é métrica nativa** do CloudWatch/DynamoDB — precisaria de métrica
   customizada (EMF) ou consulta periódica.
7. **`dynamodb:LeadingKeys` é tecnicamente plausível** (confirmado contra a AWS Service Authorization
   Reference e a doc de fine-grained access control — aplicável a `Query` sobre recurso tipo índice, com
   `ForAllValues`), mas o desenho IAM ainda está incompleto: contagem de workers/políticas inconsistente (a
   Rodada 2 fala em "8 workers migrados" na §4 mas "9 políticas GSI8" na §2 — inconsistência introduzida pela
   própria correção desta rodada), falta permissão de leitura da quarentena, um teste Terraform sozinho não
   prova negação de `Query` em IAM real (precisa de teste comportamental contra `dev`), e falta listar as
   ações/recursos completos (`GetItem`, updates de backoff, remoção de ponteiro).
8. **Gatilho de shard usa granularidade que o CloudWatch não oferece nativamente** — `ThrottledRequests` é
   dimensionado por tabela+índice, não por valor de partition key/namespace; um alarme
   `GSI8-<workerType>-ThrottledRequests` como proposto não existe como métrica nativa. Precisaria de
   Contributor Insights (feature real da AWS para hot keys) ou telemetria customizada. O plano de shard também
   não define dual-read nem critério objetivo de conclusão do backfill entre `WORK#type` e `WORK#type#shard`.

## Achados considerados fechados ou substancialmente encaminhados pelo Codex

Contagem de 4 consumidores do GSI6 e remoção de "provado em produção" (achado #9); decisão de projeção
`KEYS_ONLY` em si, ainda que a justificativa de custo precise correção (achado #3, parcial); comparação de
alternativas (achado #11); checklist subordinado à rubrica normativa (achado #10); referências E-014
reproduzíveis e primárias (achado #12); auditoria de acesso ao GSI e métricas de progresso como direção correta
(achado #7, parcial — falta especificação operacional).

## Veredito

"A Rodada 2 melhorou bastante a estrutura, mas introduziu três erros factuais centrais: o reset não faz
reseed, `requirement-reindex` possui sim um `dueAt` natural, e múltiplas fórmulas da matriz não correspondem
aos workers reais." Dos 12 achados originais: 9, 10, 11, 12 fechados; 2, 3, 7 melhorados mas incompletos; 1, 4,
5, 6, 8 ainda bloqueantes. Abaixo do limiar de aprovação.
