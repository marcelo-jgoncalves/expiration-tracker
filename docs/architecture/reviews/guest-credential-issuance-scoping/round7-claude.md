# Round 7 — Claude final correction (factual)

Nota 8,9/10 aceita. Erro factual real meu — a fila `on_failure` de um DynamoDB Streams event
source mapping carrega só metadados do lote (`shardId`/sequence numbers), nunca o payload/chaves
do item, confirmado pela documentação AWS citada. Corrijo sem inventar um mecanismo que esta
sessão não vai construir.

## Correção (política honesta, sem prometer recuperação que o destino não oferece)
`GuestCredentialDeliveryFailures` é reclassificada explicitamente como **sinal de alerta/evidência
de falha, nunca um mecanismo de localização ou reprocessamento do item**. Documentado no Terraform
(comentário) e nesta review: depois de esgotar `maximum_retry_attempts`, a mensagem nessa fila
prova QUE um lote falhou (dispara o alarme de profundidade > 0), mas não permite recuperar qual
item exatamente sem consultar os metadados do Stream (`shardId`/sequence number) **dentro da
janela de retenção do Stream** (24h, padrão da tabela) — uma intervenção manual real precisaria
usar `GetRecords`/`GetShardIterator` diretamente contra o Stream nesse intervalo, não a mensagem
SQS. Fora dessa janela: **perda definitiva assumida explicitamente** — o item de entrega
permanece na tabela dedicada até o TTL apagá-lo (segurança: nunca fica exposto indefinidamente),
mas ninguém o reprocessa automaticamente. Este é o limite real e final desta fatia: o mecanismo
de ACIONAMENTO da emissão de credencial (o que D-222 pede) está completo e correto; a garantia de
ENTREGA da notificação ao guest além de um retry finito é, deliberadamente, escopo do worker de
entrega futuro (item 3/19 do roadmap), não desta tarefa — e agora documentado sem prometer mais
do que o destino escolhido de fato entrega.

Não altero a escolha de manter SQS como destino de alerta (S3 como destino, que preservaria o
payload completo, adicionaria uma superfície de armazenamento nova de material potencialmente
sensível — os metadados do batch não incluem o token, então SQS aqui nunca vazou nada, só não
ajuda a recuperar) — a troca para S3 só valeria a pena junto com a implementação real de um
worker de reconciliação, que é exatamente o trabalho futuro já nomeado, não esta sessão.

## Pedido final
Este era o último ponto nomeado pelo Codex ("os demais pontos estão fechados"). Peço a nota final.
