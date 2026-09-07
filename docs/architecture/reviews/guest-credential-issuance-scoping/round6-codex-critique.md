# Round 6 — Codex critique

NOTA: 8,9/10

Ainda não aprovo por uma única incorreção operacional no item 3.

O destino SQS de falha para DynamoDB Streams **não contém as chaves do item nem o payload original**. Ele recebe apenas metadados do lote, como `shardId`, `startSequenceNumber` e `endSequenceNumber`. A documentação oficial confirma que o payload completo só é preservado quando o destino é S3. Portanto, esta afirmação da Rodada 6 está errada:

> “o batch falho vai para essa fila (contendo as chaves do item, suficientes para localizá-lo...)”

Com SQS, uma eventual intervenção manual teria de recuperar os records originais do Stream usando esses metadados **antes da retenção de 24 horas expirar**. Depois disso, as chaves não poderão ser obtidas da mensagem. [AWS — DynamoDB event-source failure destinations](https://docs.aws.amazon.com/lambda/latest/dg/services-dynamodb-errors.html)

O limite de escopo é aceitável: não exijo consumidor automático, reconciliação completa ou implementação da entrega nesta tarefa. Para aprovação, basta corrigir o contrato durável de uma destas maneiras:

- declarar a fila apenas como alerta/evidência de falha, sem alegar que permite localizar ou reprocessar o item; assumir explicitamente perda definitiva após retries, salvo intervenção dentro da retenção do Stream; ou
- definir um mecanismo que realmente preserve a identidade/payload necessário, por exemplo um destino S3 adequadamente protegido — avaliando separadamente a exposição do segredo.

Os demais pontos estão fechados:

- semântica at-least-once está correta;
- filtro `INSERT` na infraestrutura mais defesa no handler está correto;
- retries finitos, alarme e ausência explícita de recuperação automática são um padrão de engenharia aceitável para esta fatia;
- idempotência externa foi delegada de forma verificável e com semântica alternativa explicitamente exigida quando o provedor não a suportar.

É uma correção factual pequena e final, mas ainda impede o gate de 9,0 porque a política atualmente promete uma capacidade de recuperação que o destino escolhido não fornece.
28.410
NOTA: 8,9/10
