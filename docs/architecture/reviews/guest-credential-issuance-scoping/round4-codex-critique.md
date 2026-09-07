# Round 4 — Codex critique

NOTA: 8,8/10

Os três achados da Rodada 3 foram genuinamente corrigidos:

1. A gravação atômica do material de entrega na mesma `TransactWriteItems` elimina o dual-write DynamoDB→SQS e o crash window crítico.
2. A condição do consumidor agora cerca geração, status, versão e pointer no mesmo commit, com classificação fail-closed das falhas.
3. A revogação passou a ser realmente idempotente com `if_not_exists`, sem comparar timestamps entre tentativas.

Contudo, surgiu uma lacuna concreta na substituição do SQS pela tabela dedicada: o mecanismo de descoberta e processamento dos itens de entrega não está implementavelmente especificado.

A tabela é descrita como “sem GSI nenhum”, enquanto o worker fará `Query`/`GetItem`. Um worker não conhece previamente as chaves dos itens pendentes; portanto:

- `GetItem` não permite descobri-los;
- `Query` exige uma partition key conhecida;
- uma PK global fixa criaria uma partição quente;
- `Scan` periódico contradiz a escolha anterior e não foi declarado;
- DynamoDB Streams poderia acionar a entrega, mas não foi especificado;
- TTL não “reconcilia” itens nunca entregues: TTL apenas os apaga, eventualmente.

Além disso, “enviar e só então `DeleteItem`” admite duplicidade quando o provider aceita o envio e o worker cai antes do delete. Isso pode ser aceitável como entrega *at least once*, mas precisa ser explicitado e cercado por idempotency key no provider ou por estado/claim condicional; hoje o texto implicitamente promete uma semântica mais forte do que prova.

Há ainda uma inconsistência documental menor: são anunciadas cinco entradas na transação, mas apenas quatro são enumeradas. Se a quinta for a revogação da credencial anterior durante reemissão, isso deve ser dito explicitamente e distinguido do caminho de emissão inicial.

Portanto, não aprovo o design nesta rodada. Para aprovação, basta fechar precisamente o handoff durável: definir como o worker descobre os registros, a semântica de concorrência/retry/duplicidade, o papel real do TTL e enumerar corretamente as operações da transação. As pendências de TTL definitivo da credencial e cadência de chasing não influenciaram a nota.
44.679
NOTA: 8,8/10
