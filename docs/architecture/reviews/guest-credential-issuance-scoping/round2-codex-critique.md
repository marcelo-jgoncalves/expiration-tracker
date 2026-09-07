# Round 2 — Codex critique

NOTA: 7,2/10

A Rodada 2 melhora substancialmente o desenho e fecha integralmente os pontos 3, 5, 6 quanto à centralização do builder, 11 e 12. Porém, não chega a 9,0 porque a reemissão após rejeição está logicamente quebrada e o token bruto foi colocado numa superfície de leitura incompatível com a alegação de isolamento.

1. **A deduplicação por `documentRequestId` impede a reemissão prometida.** A chave `GUESTISSUANCE#<documentRequestId>` significa “esta request só pode receber uma credencial durante toda a vida”. Depois da primeira emissão, `rejectVersion()` publica nova solicitação para o mesmo `documentRequestId`, mas o consumidor encontra o `IdempotencyRecord` e faz no-op. Portanto, a credencial anterior é revogada e nenhuma nova credencial nasce. Isso invalida o fechamento dos pontos 1, 8 e 9.

   O mesmo defeito aparece no `eventId = stableHash(documentRequestId)`: a reemissão legítima reutiliza o mesmo evento/outbox. Dependendo da chave física e da retenção do outbox, o novo `Put` colide com o evento anterior ou representa indistinguivelmente a primeira emissão. É necessário um `issuanceGeneration` monotônico, `credentialGeneration` ou `issuanceId` persistido e fenced na `DocumentRequest`. Tanto a chave idempotente quanto o `eventId` devem incluir essa geração.

2. **`PendingGuestNotificationCommand` com token bruto na tabela principal é um vazamento novo e grave.** Isolar a consulta ao GSI6 não isola o item base. A política real `tenant_facing_read_write` concede `GetItem`, `BatchGetItem` e `Scan` sobre a tabela principal a várias Lambdas. Assim, qualquer role tenant-facing comprometida pode varrer e exfiltrar tokens completos. Isso repete exatamente a classe de erro que D-054 corrigiu ao mover sessões para tabela dedicada: proteger apenas um índice não protege dados sensíveis armazenados na tabela base.

   O token deve ficar em uma tabela dedicada com IAM exclusivo ao emissor e ao worker de entrega, preferencialmente cifrado com CMK e `kms:Decrypt` somente no worker. Alternativamente, deve ser entregue diretamente a uma fila criptografada cujo consumo seja exclusivo. `activeCredentialSelectorHash` isoladamente não concede acesso e é aceitável; o problema é o token completo persistido na tabela compartilhada.

3. **TTL de DynamoDB não garante remoção em 15 minutos.** `purgeAfterTtl` é coleta assíncrona e pode apagar o item horas ou dias depois. O worker precisa rejeitar comandos quando `deliverBefore <= now`, e a exposição residual após consumo/expiração precisa ser eliminada por atualização condicional explícita. “Apaga o campo depois do envio confirmado” também está subespecificado: envio externo e remoção no DynamoDB não podem ser atômicos. É necessária uma máquina de estados com claim/lease, tentativa, resultado e reconciliação para os casos “enviou, mas falhou antes de marcar” e “marcou antes de enviar”.

4. **A transação de quatro entradas é atomicamente válida, mas o tratamento de falha não é.** DynamoDB comporta essas quatro operações numa única `TransactWriteItems`, portanto não existe commit parcial entre idempotência, credencial, comando e pointer. Contudo, “se falhar o `Put` idempotente, tratar como replay” não pode ser inferido de qualquer `TransactionCanceledException`: a transação também pode cancelar por OCC da request, colisão de chave, tamanho, throttling ou condição da credencial. O consumidor deve distinguir os motivos ou reler consistentemente o `IdempotencyRecord` e validar tipo, geração e resultado antes de dar ACK.

5. **A condição do consumidor precisa cercar o estado de negócio no próprio commit.** Reler `REQUESTED|OPENED` antes da transação não basta. O `Update` da `DocumentRequest` deve condicionar simultaneamente `version`, estado live, geração de emissão esperada e pointer esperado. Caso contrário, a leitura autoritativa vira TOCTOU. Conflito OCC deve provocar releitura e nova decisão; não pode virar ACK genérico nem retry cego com os valores aleatórios já descartados.

6. **O fencing de `rejectVersion()` cobre bem a rejeição tardia, mas não fecha toda a corrida de reemissão.** `lastSubmissionId === version.versionId`, `status === SUBMITTED` e `expectedVersion` impedem reabrir uma submissão superada. Essa parte está correta. Ainda faltam condições na revogação:

   - a credencial apontada deve pertencer ao mesmo `documentRequestId`;
   - o selector esperado deve continuar sendo o ativo;
   - a atualização deve definir semântica idempotente para `revokedAt`;
   - a request deve avançar atomicamente a geração de emissão e limpar/substituir o pointer segundo uma transição explícita.

   Sem geração, uma entrega atrasada da primeira emissão pode competir conceitualmente com a emissão pós-rejeição.

7. **A regra de 30 dias não é meramente engenharia.** A validade de uma capability enviada a terceiro é política de produto e segurança. Além disso, `createdAt + 30 dias` pode já estar no passado quando um evento atrasado for consumido. O consumidor deve recusar `expiresAt <= now`. A escolha “30 dias” precisa de aprovação explícita ou ser registrada como política de segurança provisória deliberada, não reclassificada para contornar a pendência de produto.

8. **`createDocumentRequest()` continua parcialmente especificado.** A descrição da transação enumera `ConditionCheck + Request + outbox`, mas a idempotência alegada exige também o `IdempotencyRecord` na mesma transação, com fingerprint dos parâmetros e snapshot/identificador do resultado. Reutilizar a mesma chave com outro `subjectId`, `requirementId` ou `deadline` deve falhar, não retornar silenciosamente a request anterior. Também falta decidir se basta a existência do Requirement ou se estados inativos/inaplicáveis devem impedir a criação.

9. **O comando durável ainda não equivale a entrega enfileirada.** Um item consultável por GSI6 é candidato de reconciliação, não uma mensagem já entregue a um consumidor. A Rodada 2 não especifica schedule, claim, paginação, retry, DLQ ou wiring IAM do worker e admite que o consumidor real virá depois. Logo, continua possível implementar agora credenciais inutilizáveis, embora ao menos o token não desapareça imediatamente. O ponto 2 anterior foi mitigado, não fechado.

10. **O chasing está corretamente neutralizado**, com flag desligada, índice próprio e destino próprio. Entretanto, uma constante compilada como `false` torna a ativação dependente de novo deploy; isso é aceitável como estágio preparatório, desde que o código morto não seja descrito como funcionalidade operacional concluída.

Para alcançar 9,0, a próxima rodada precisa substituir a identidade “uma emissão por request” por “uma emissão por request e geração”, isolar criptograficamente e por IAM o token bruto, definir a máquina de entrega/reconciliação e escrever as condições DynamoDB exatas para emissão, revogação e idempotência. A arquitetura assíncrona continua sendo a direção correta; suas duas garantias centrais — reemissão e confidencialidade do token — ainda não estão satisfeitas.
tokens used
55.032
NOTA: 7,2/10
