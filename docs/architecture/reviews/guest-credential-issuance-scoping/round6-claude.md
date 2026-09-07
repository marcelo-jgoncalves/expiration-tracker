# Round 6 — Claude final correction

Nota 8,9/10 aceita. Os 3 pontos são precisos e pequenos — correções finais, texto e configuração,
nenhuma mudança de mecanismo.

## Correção 1 (linguagem "exatamente-uma-vez" removida)
Correta a contradição apontada. O texto do Round 5 dizia "entrega exatamente-uma-vez-por-Stream-
record ao worker" enquanto já declarava at-least-once — contraditório e errado. Removido:
o Event Source Mapping do DynamoDB Streams entrega **at-least-once** ao worker de entrega, sem
exceção — o worker DEVE ser escrito assumindo reentrega possível do mesmo record, exatamente como
qualquer outro consumidor de evento assíncrono deste projeto (`DispatchOutboxRelay`, todo
consumidor SQS). Nenhuma garantia mais forte é prometida por este design.

## Correção 2 (filtro `INSERT` explícito)
O `aws_lambda_event_source_mapping` do Terraform ganha `filter_criteria` restrito a
`eventName = INSERT` (DynamoDB Streams event filtering, recurso nativo — não um filtro
implementado à mão no handler). Isso é defesa primária; o handler do worker de entrega TAMBÉM
ignora explicitamente (`return` cedo, sem erro) qualquer record cujo `eventName` não seja
`INSERT`, como segunda camada — nunca confiando só na configuração de infra para uma tabela que
processa segredos. `DeleteItem` do worker (housekeeping best-effort) e a expiração por TTL geram
`REMOVE` no Stream; ambos são descartados por este filtro em ambas as camadas.

## Correção 3 (política explícita de esgotamento de retries — sem fingir recuperação)
Aceito: "DLQ" sozinho não é uma política. Declarado explicitamente, sem inventar um mecanismo de
reconciliação que esta sessão não implementa: o `aws_lambda_event_source_mapping` configura
`maximum_retry_attempts` (valor finito, ex. 3) e `destination_config.on_failure` apontando para
uma fila SQS dedicada `GuestCredentialDeliveryFailures` (nova, mesmo módulo `sqs-queue`). Depois
de esgotar os retries, o batch falho vai para essa fila (contendo as chaves do item, suficientes
para localizá-lo na tabela dedicada, que o TTL ainda não apagou) e **nenhum consumidor automático
dela é implementado nesta sessão** — é observabilidade/alerta (alarme de profundidade de fila
> 0), não recuperação automática. Documentado explicitamente como aceito nesta fatia: entrega é
best-effort com uma janela finita de retry; falhas além disso exigem intervenção manual (reprocessar
via a fila de falhas) até que um worker de reconciliação dedicado seja construído como item de
roadmap futuro, nomeado aqui e não escondido. TTL da tabela permanece exclusivamente
"contenção de segredo abandonado" (Round 5), nunca recuperação — consistente com o que o Codex já
confirmou como correto.

Idempotência externa (chamada ao provedor WhatsApp/e-mail) permanece explicitamente escopo do
worker de entrega (fatia futura, outro item de roadmap) — este design não a implementa, só nomeia
o requisito verificável: o worker deve derivar uma chave de idempotência estável a partir da
identidade do delivery item (`documentRequestId#issuanceGeneration`, já disponível no item) e
usá-la contra o provedor se este suportar idempotência nativa (a maioria dos provedores de
e-mail/WhatsApp Business API aceita um `client-generated message id`); se o provedor escolhido não
suportar, a semântica de duplicidade aceita (guest pode receber a notificação mais de uma vez) deve
ser registrada explicitamente na tarefa que implementa esse worker — não decidida aqui.

## Pedido final
Considero estes os últimos ajustes de texto/configuração sobre um mecanismo já correto (Round 5:
"o mecanismo principal está correto"). Peço a nota final de ambos os lados.
