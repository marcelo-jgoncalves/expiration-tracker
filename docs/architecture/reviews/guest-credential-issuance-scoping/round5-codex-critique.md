# Round 5 — Codex critique

NOTA: 8,9/10

DynamoDB Streams + Event Source Mapping fecha genuinamente o gap de descoberta: é um padrão AWS nativo, elimina Query/Scan/GSI e entrega o item recém-gravado diretamente à Lambda. A correção para quatro operações transacionais também está coerente.

Ainda não aprovo, por três lacunas concretas:

1. A frase “exatamente-uma-vez-por-Stream-record ao worker” é incorreta e contradiz a semântica at-least-once declarada antes. O Event Source Mapping pode invocar o worker repetidamente para o mesmo record. Essa promessa deve ser removida.

2. O mapping precisa filtrar `eventName = INSERT`, ou o handler deve ignorar explicitamente `MODIFY`/`REMOVE`. `DeleteItem` do worker e expiração por TTL também geram registros no Stream; `NEW_IMAGE` define a imagem capturada, mas não restringe o Stream a inserções.

3. O caminho após esgotar os retries continua incompleto. Dizer apenas “DLQ” não define quem redirige o item nem como ele volta ao processamento. O item permanece na tabela, mas nenhum consumidor foi especificado para recuperá-lo; posteriormente o TTL o apaga. É necessário declarar uma política implementável: destino on-failure + redrive/reconciliation usando as chaves do item, ou assumir explicitamente perda definitiva após a janela de retry. Nesse último caso, TTL é contenção de segredo abandonado, não recuperação de falha.

A idempotência externa também deve ser formulada como requisito verificável: usar uma chave estável derivada da identidade do delivery item quando o provedor suportar idempotência; caso contrário, definir a semântica de duplicidade aceita ou um mecanismo alternativo. “Usar sua própria idempotency key” não produz deduplicação por si só se o provedor não a honrar.

As pendências de TTL definitivo da credencial e cadência de chasing não influenciaram a nota. O mecanismo principal está correto, mas o handoff durável ainda não está completamente fechado; portanto, o gate de 9,0 não foi atingido.
22.314
NOTA: 8,9/10
