# Round 5 — Claude final correction

Nota 8,8/10 aceita. Um gap real (mecanismo de descoberta do worker não especificado) + uma
inconsistência de contagem. Ambos corrigidos, sem mudar mais nada do desenho já fechado.

## Correção 1 (descoberta/entrega — DynamoDB Streams, não Query/Scan)
A tabela dedicada `exptrk-<env>-guest-credential-delivery` ganha **DynamoDB Streams**
(`NEW_IMAGE`) habilitado, com um **Event Source Mapping** direto para a Lambda de entrega
dedicada (mesmo mecanismo já usado no projeto para acionar Lambdas a partir de eventos —
consistente com a disciplina geral de "nunca inventar polling quando um trigger nativo existe").
Isso substitui inteiramente a ideia de `Query`/`Scan` periódico do Round 4: o worker nunca
precisa "descobrir" nada — cada `Put` na tabela dedicada invoca automaticamente a Lambda de
entrega com o item recém-criado no próprio evento do Stream, batch size 1 (item pequeno,
sensível, sem necessidade de agrupar). Resolve os 5 sub-pontos do Round 4 de uma vez: não há
partição quente (não há Query nenhuma), não há Scan periódico, e o TTL da tabela passa a ter o
papel correto e único que o Round 4 pediu para esclarecer: limpeza de segurança tardia
(housekeeping) para o caso raro em que o Stream falhe em entregar (ex.: Lambda de entrega
indisponível além do retry do Streams) — nunca o mecanismo primário de descoberta.

**Semântica at-least-once explicitada**: o Event Source Mapping do DynamoDB Streams garante
entrega pelo menos uma vez ao worker, com retry automático em caso de erro (configurável via
`maximum_retry_attempts`/DLQ do próprio event source mapping, mesmo padrão Terraform que outras
Lambdas orientadas a evento deste projeto já usam). Uma invocação duplicada do worker (Streams
reprocessando um lote) pode, na pior hipótese, chamar o provedor de envio duas vezes para o mesmo
item — **explicitamente aceito como responsabilidade do worker de entrega (item 3/19, fatia
futura, outro agente)**: esse worker deve usar sua PRÓPRIA idempotency key ao chamar o provedor
de notificação (WhatsApp/e-mail), exatamente como todo outro consumidor de outbox deste projeto já
faz (`OutboxRecord.eventId`/`publishAttempts`) — não uma responsabilidade nova, é a mesma
disciplina de idempotência do lado do consumidor que o projeto já aplica em toda fila. Este
design entrega o item de forma exatamente-uma-vez-por-Stream-record ao worker; deduplicar contra o
provedor externo é escopo do worker, nomeado aqui explicitamente para não ser esquecido, não
implementado nesta sessão (fora do escopo de "acionar issuance", que é o que D-222 pede).

`DeleteItem` pelo worker após envio confirmado passa a ser puramente um housekeeping best-effort
(reduz o volume que o TTL teria que varrer) — nunca uma condição de correção, já que o Stream (não
uma leitura da tabela) é o mecanismo de entrega real.

## Correção 2 (contagem de entradas da transação)
Corrigido: **4 entradas**, não 5, na `TransactWriteItems` do consumidor de issuance:
1. `Put` do `IdempotencyRecord` (`GUESTISSUANCE#<documentRequestId>#<issuanceGeneration>`).
2. `Put` da `RequestAccessCredential`.
3. `Update` da `DocumentRequest` (condição completa da Correção 2 do Round 4).
4. `Put` do item de entrega na tabela dedicada (Correção 1 do Round 3/4).

A revogação da credencial ANTERIOR (numa reemissão pós-rejeição) NÃO acontece nesta transação —
já estava corretamente desenhada desde o Round 2/3 como parte da transação de `rejectVersion()`
(Lambda autenticada, sem pepper, revoga por chave conhecida ANTES de publicar o evento de nova
emissão) — são duas transações distintas, em duas Lambdas distintas, no momento certo cada uma.
O "5" do Round 4 foi um erro de contagem meu, não uma entrada faltante — nenhuma mudança de
comportamento, só a correção do texto.

## Pedido final
Estes dois pontos fecham a lista do Round 4. Peço a nota final.
