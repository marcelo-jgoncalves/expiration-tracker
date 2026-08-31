# Rodada 5 — Tréplica Claude — Admin Activity/Audit Log View

Nota cega Rodada 4: Claude (auto) 9,1. Codex: 8,70. Aceito o achado restante — é real, o LEK de
uma `Query` de `limit` itens não é o mesmo que "a posição do último item efetivamente
consumido" quando o merge descarta o excedente daquela partição.

## Cursor — correção final

Erro: usar o `LastEvaluatedKey` bruto da `Query` (posição após os `limit` itens BUSCADOS) como
`ExclusiveStartKey` da próxima página perde os itens buscados mas não consumidos por aquela
partição no merge atual.

Correção (opção "cursor por chave do último item efetivamente consumido", primeira alternativa
listada pelo Codex — mais simples de implementar e testar): o `ExclusiveStartKey` do DynamoDB
aceita qualquer chave primária válida do schema, não precisa ser um `LastEvaluatedKey` devolvido
por uma `Query` anterior — é só `{ PK, SK }` de um item real. Cada campo do cursor composto
passa a ser a `{ PK, SK }` do ÚLTIMO ITEM DAQUELA PARTIÇÃO EFETIVAMENTE INCLUÍDO na página
devolvida ao cliente (não o LEK do fetch bruto). Algoritmo revisado:
1. Para cada uma das 4 partições ainda ativas (sem cursor `null`/exaurida), `Query` com
   `limit` = o `limit` da página solicitada (não mais, não menos) e `ExclusiveStartKey` = a
   chave salva no cursor recebido (ou nenhuma, na primeira página).
2. Merge k-way dos 4 buffers por `(occurredAt, auditEventId)`, corta em `limit` itens totais.
3. Para cada partição, o próximo cursor = a chave `{PK, SK}` do último item DAQUELA partição
   que entrou nos `limit` itens finais devolvidos — se a partição contribuiu 3 de seus 10 itens
   buscados, o cursor aponta para o item #3 dela (não para o LEK do fetch de 10), e os 7
   restantes serão buscados de novo (re-lidos) na próxima chamada, a partir dessa chave.
4. Se uma partição contribuiu ZERO itens nesta página (todos os itens finais vieram de outras
   partições), o cursor dela permanece o cursor de ENTRADA desta chamada (não avança) — ela
   ainda não foi consumida, precisa ser tentada de novo do mesmo ponto.

Custo aceito conscientemente: até `limit` itens por partição podem ser relidos do DynamoDB em
mais de uma chamada (nunca perdidos, no pior caso re-buscados) — trade-off de uma leitura
extra ocasional contra a alternativa (perda determinística de evento), mesmo tipo de trade-off
que a Rodada 4 já aceitou para consistência entre páginas, desta vez sobre correção, não estilo.

## Lock de idempotência do export — precisão adicional

Aceito a nota do Codex: o item de lock (`PK=TENANT#<id>#EXPORTLOCK#<exportRequestId>`, `SK=LOCK`)
já não depende de `occurredAt` — confirmando explicitamente aqui que a chave do lock usa
SOMENTE `exportRequestId` (do header `Idempotency-Key` ou do UUID gerado por requisição), nunca
timestamp, exatamente como a Rodada 4 descreveu para o item de lock (a ambiguidade apontada
pelo Codex era sobre a SK do `TenantAuditEvent` em si, que legitimamente inclui `occurredAt`
por convenção dos outros 3 agregados-irmãos — o lock, que é o mecanismo real de dedupe, não).

## Fechamento

Único achado material restante da Rodada 4 corrigido. Peço avaliação final.
