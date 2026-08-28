A próxima rodada deve, no mínimo, fechar o protocolo de hold durante `CLAIMED`, usar a referência real proveniente das evidências, formalizar integralmente a condição de claim com parênteses e invariantes de estado, e substituir a paginação entre invocações por uma estratégia executável e testável.
tokens used
43.244
## Achados bloqueantes

1. **Novo — o claim não protege contra `legalHold` aplicado depois do claim e antes da exclusão S3.**

   A Rodada 2 verifica `legalHold` somente no `Update` inicial. Depois do claim, o worker executa dois efeitos externos não transacionais. Se um processo futuro aplicar o hold nesse intervalo, incrementando `version`, o worker ainda apagará os objetos. A transação final apenas falhará depois que o conteúdo já tiver sido destruído.

   Isso é especialmente importante porque a proposta afirma que qualquer processo futuro poderá simplesmente popular o campo sem reabrir o desenho. Essa afirmação não procede: o setter de hold precisaria conhecer o protocolo de purge e impedir alteração durante `PURGE_CLAIMED`, ou o worker precisaria de outro fence antes de cada efeito S3. O padrão de `ReminderOccurrence` não resolve isso porque sua reconciliação não possui efeito externo destrutivo comparável.

   O claim deve tornar o documento inequivocamente não restaurável/não colocável sob hold, ou deve haver um protocolo de cancelamento/handshake que confirme o hold antes da destruição. Um fence apenas na transação final é tardio demais.

2. **Novo — a referência usada para apagar o objeto de quarantine está errada no modelo real.**

   A proposta manda chamar `deleteObjectVersion` sobre `quarantineObject`, mas esse campo nasce com `versionId: ""` em [document-service.ts](C:/Users/Usuario/Desktop/projects/expiration-tracker/src/modules/document/application/document-service.ts:149) e não é atualizado quando o upload real é observado. O próprio código documenta expressamente que a versão verdadeira deve ser obtida de `uploadEvidence.object` ou `malwareEvidence.object`, porque usar `quarantineObject.versionId` vazio já causou falha real no S3 em [advance-after-evidence.ts](C:/Users/Usuario/Desktop/projects/expiration-tracker/src/modules/document/application/advance-after-evidence.ts:63).

   Portanto, a máquina proposta pode:

   - falhar permanentemente tentando enviar `VersionId=""`; ou
   - não apagar a versão real que contém os dados, dependendo do comportamento final do SDK/S3.

   O purge precisa resolver canonicamente a referência imutável real, reconciliar eventual divergência entre as duas evidências e tratar separadamente “nenhum upload ocorreu”. Esse é exatamente um detalhe específico de `Document` que o padrão de Reminder não possuía.

3. **O achado 1 da Rodada 1 foi apenas parcialmente resolvido: a condição de claim está subespecificada e, como escrita, tem precedência lógica perigosa.**

   A condição apresentada é:

   `version = :expectedVersion AND attribute_not_exists(legalHold) OR legalHold = :false`

   Sem parênteses, `AND` tem precedência sobre `OR`; logo, qualquer linha com `legalHold=false` pode satisfazer a condição independentemente da versão esperada. Isso elimina o fence concorrente que constitui o núcleo da proposta.

   Mesmo corrigindo os parênteses, a condição deve confirmar explicitamente, na linha-base:

   - `status = DELETED`;
   - `GSI6PK = WORKSTATE#PURGE_PENDING`;
   - o `GSI6SK` esperado;
   - `purgeAfter <= now`;
   - versão e tenant esperados;
   - ausência de hold.

   `attribute_exists(PK/SK)` já é fornecido pelo builder OCC real em [occ.ts](C:/Users/Usuario/Desktop/projects/expiration-tracker/src/shared/dynamodb/occ.ts:63), mas a proposta não diz que reutilizará esse builder nem especifica as demais invariantes. Uma versão coincidente não deve ser tratada como prova de que a linha continua sendo um `Document` deletado e elegível.

4. **O achado 6 da Rodada 1 continua parcialmente aberto: paginação, lease e falha permanente ainda não formam uma máquina operacional completa.**

   “Usar `LastEvaluatedKey` para continuar na próxima invocação agendada” não funciona sem persistir o cursor em algum lugar; uma nova invocação EventBridge não recebe o cursor da anterior. Além disso, a própria execução move itens para outra partição do índice, portanto percorrer páginas enquanto modifica o conjunto consultado requer uma semântica explícita para não pular candidatos.

   Também permanecem indefinidos:

   - o que ocorre quando a execução original continua depois dos 15 minutos e outro worker recupera o lease;
   - heartbeat, timeout máximo ou outra garantia de que o lease não expira durante as duas chamadas S3;
   - retry count `N`, embora a tabela diga “se reincide N vezes”;
   - classificação terminal versus retryable;
   - destino DLQ ou registro equivalente para falhas permanentes;
   - comportamento quando apenas uma das duas referências S3 é válida;
   - como o alarme cobre separadamente `PENDING` e `CLAIMED`.

   Consultar novamente os primeiros 25 itens em cada execução, sem cursor entre execuções, pode ser correto e mais simples; o mecanismo atualmente descrito mistura esse modelo com continuação paginada não materializada.

5. **O achado 7 foi parcialmente resolvido, mas o recibo introduz retenção indefinida de identificadores.**

   A transação `Delete Document + Put Receipt` resolve corretamente a atomicidade da evidência. Porém, `tenantId`, `documentId`, `itemId`, `deletedAtOriginal` e `correlationId` permanecem dados vinculáveis, mesmo sem o conteúdo do arquivo. Declarar a retenção do recibo “fora de escopo” deixa esses dados armazenados indefinidamente e cria uma nova pendência de privacidade dentro do próprio mecanismo de purge.

   O design precisa definir agora uma classe e um prazo concreto para o recibo, ainda que a implementação reutilize `DELIVERY_RECORD`/180 dias. Não é necessário preservar o documento para produzir evidência auditável, mas também não é aceitável criar evidência pseudônima sem ciclo de vida definido.

## Achados não-bloqueantes

- **Achado 2 da Rodada 1: resolvido.** O lifecycle incondicional do bucket `clean` foi removido. Isso está coerente com o bucket real versionado e sem lifecycle em [document-buckets/main.tf](C:/Users/Usuario/Desktop/projects/expiration-tracker/infra/modules/document-buckets/main.tf:145). O alarme é uma substituição segura, embora sua métrica ainda precise de definição operacional conforme o achado bloqueante 4.

- **Achado 3 da Rodada 1: parcialmente resolvido.** O campo `legalHold` e a checagem no claim corrigem o caso “hold já existente antes do claim”. Não corrigem o hold concorrente posterior ao claim, conforme o achado bloqueante 1.

- **Achado 4 da Rodada 1: resolvido no desenho.** `dynamodb:TransactWriteItems` e `s3:DeleteObjectVersion`, sem `GetObject`, correspondem às operações reais. A capability dedicada e a quarta role GSI6 também respeitam o isolamento existente. A implementação deverá atualizar todas as ocorrências atualmente inconsistentes de “EXACTLY TWO/THREE” em [main.tf](C:/Users/Usuario/Desktop/projects/expiration-tracker/infra/main.tf:36) e no módulo da tabela.

- **Achado 5 da Rodada 1: resolvido.** A proposta não popula `purgeAfterTtl`; portanto, o TTL da tabela não compete mais com o workflow nem pode remover o ponteiro antes do S3.

- O claim por mudança de `GSI6PK` é uma boa base, e a consulta de leases expirados é compatível com o adapter de Reminder em [dynamodb-reconciliation-candidate-source.ts](C:/Users/Usuario/Desktop/projects/expiration-tracker/src/modules/reminder/persistence/dynamodb-reconciliation-candidate-source.ts:31). O erro foi considerar o padrão “literalmente o mesmo”: somente o mecanismo de descoberta/lease é reutilizável; as garantias sobre efeitos S3 e hold são novas.

- O limite de 25 candidatos é razoável, mas não deriva do limite de 25 itens do `TransactWriteItems`: cada claim/finalização descrito usa transações independentes. O valor deve ser justificado pelo orçamento de duração e chamadas S3 da Lambda.

- O alarme em três dias é proporcional ao prazo de 30 dias como sinal inicial, desde que exista também alarme de invocação/erro e que a idade publicada represente o candidato realmente mais antigo nas duas partições.

## Nota: 7,4/10

## Veredito

**REPROVADO na Rodada 2.**

Dos sete achados originais, os achados 2, 4 e 5 foram resolvidos; os achados 1, 3, 6 e 7 foram resolvidos apenas parcialmente. A Rodada 2 melhorou substancialmente o desenho, mas introduziu duas lacunas específicas e destrutivas: o hold pode chegar depois do claim, e `quarantineObject.versionId` não é a versão real do objeto enviado.

A próxima rodada deve, no mínimo, fechar o protocolo de hold durante `CLAIMED`, usar a referência real proveniente das evidências, formalizar integralmente a condição de claim com parênteses e invariantes de estado, e substituir a paginação entre invocações por uma estratégia executável e testável.
