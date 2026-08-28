## Achados bloqueantes

1. **A ordem S3 → DynamoDB contém uma corrida destrutiva TOCTOU.**  
   A leitura via GSI6 não é uma checagem válida no momento da deleção. GSI6 é eventualmente consistente e, após a leitura, o documento pode ser alterado, restaurado ou colocado sob hold. O worker apagaria as versões S3 primeiro; só depois descobriria, pela condição `status = "DELETED"`, que não podia apagar a linha. O resultado seria uma linha válida apontando para conteúdo já destruído. Isso contradiz a regra de que decisões críticas não podem depender exclusivamente de GSI em [data-model.md](/C:/Users/Usuario/Desktop/projects/expiration-tracker/docs/architecture/data-model.md:87).

   É necessário um fence atômico antes do S3, por exemplo uma transição condicionada `DELETED → PURGING`, verificando pelo menos versão, `purgeAfter`, ponteiro GSI e ausência de hold. Depois desse claim irreversível, o S3 pode ser apagado de forma reentrante e a linha removida ao final. Uma simples releitura consistente ainda deixaria uma janela TOCTOU entre a releitura e o S3.

2. **O lifecycle incondicional de 400 dias no bucket `clean` apagaria documentos ativos.**  
   O bucket contém documentos de registro e tem versionamento habilitado, mas atualmente não possui lifecycle em [document-buckets/main.tf](/C:/Users/Usuario/Desktop/projects/expiration-tracker/infra/modules/document-buckets/main.tf:88). Uma regra aplicada ao bucket inteiro não sabe se houve soft-delete: qualquer documento ativo com mais de 400 dias seria eliminado. A afirmação de que a regra “nunca dispara no caminho normal” só considera documentos excluídos antes de 370 dias e ignora documentos legítimos mantidos por mais de 400 dias.

   Além disso, o prazo normativo é “evento de exclusão/encerramento + 30 dias”, não criação + 400 dias. Portanto, essa rede não é apenas imprecisa: ela é insegura para dados ativos.

3. **A proposta ignora completamente `legalHold`.**  
   [privacy-lgpd.md](/C:/Users/Usuario/Desktop/projects/expiration-tracker/docs/architecture/privacy-lgpd.md:33) determina que hold suspende o purge, e `USER_DOCUMENT` admite obrigação específica como hold. O `Document` atual nem sequer materializa `legalHold`, e o desenho condiciona somente `status = "DELETED"`. Tanto o worker quanto o lifecycle de 400 dias poderiam destruir conteúdo sob retenção obrigatória. Antes de aprovar, o desenho precisa definir onde o hold aplicável é armazenado, como é consultado/fenceado e como impede também a rede de segurança S3.

4. **As permissões IAM descritas não autorizam a operação proposta e não correspondem ao port real.**  
   O purge usa `TransactWriteItems`, logo `dynamodb:DeleteItem` isolado não basta; a role precisa de `dynamodb:TransactWriteItems` sobre a tabela. Para o método existente `deleteObjectVersion()` em [s3-document-object-store.ts](/C:/Users/Usuario/Desktop/projects/expiration-tracker/src/modules/document/persistence/s3-document-object-store.ts:48), a ação relevante é `s3:DeleteObjectVersion`, não apenas `s3:DeleteObject`. O repositório já usa essa ação explicitamente nas roles existentes em [main.tf](/C:/Users/Usuario/Desktop/projects/expiration-tracker/infra/main.tf:993).

   `s3:GetObject` também não é necessário para a operação descrita e amplia o blast radius sem justificativa. A policy deve ser uma capability mínima específica, sem herdar a ampla `tenant_facing_read_write` apenas por conveniência.

5. **O “TTL opcional” está tecnicamente incorreto e pode tornar o vazamento S3 permanente.**  
   A tabela já tem TTL habilitado em `purgeAfterTtl`, não em `purgeAfter`, conforme [dynamo-table/main.tf](/C:/Users/Usuario/Desktop/projects/expiration-tracker/infra/modules/dynamo-table/main.tf:147). Além disso, `purgeAfter` hoje é ISO string, enquanto DynamoDB TTL exige epoch seconds numérico.

   Mais grave: se o TTL remover a linha antes do worker, desaparecem também o candidato GSI6 e as referências exatas de bucket/key/versionId. O S3 fica órfão e o mecanismo primário perde a capacidade de encontrá-lo. Portanto, TTL da mesma linha não é uma segunda rede segura; ele compete com o workflow. Só seria aceitável após prova de que a exclusão DynamoDB não pode preceder a confirmação de purge S3, possivelmente usando um registro de trabalho separado.

6. **A reentrância coberta pela proposta é insuficiente para falhas parciais e concorrência.**  
   “DeleteObject de objeto ausente não falha” cobre somente replay depois de uma deleção bem-sucedida. Faltam estados/testes para:

   - crash após apagar `quarantineObject`, antes de apagar `cleanObject`;
   - duas invocações concorrentes processando o mesmo candidato;
   - hold ou mudança de versão entre descoberta e claim;
   - erro permanente de S3 e política de retry/DLQ/alarme;
   - linha removida por TTL antes da exclusão S3;
   - `DeleteItem` condicional perdido pelo segundo worker após ambos apagarem S3;
   - paginação, limite por execução e retomada após timeout.

   O desenho precisa declarar explicitamente quais falhas são sucesso idempotente, retryable ou falha terminal observável.

7. **Não está definido um registro auditável da purga concluída.**  
   A remoção física da própria linha elimina `deletedAt`, `purgeAfter` e as referências que provariam o atendimento. A exigência normativa é workflow auditável, não retenção do conteúdo pessoal. É necessário definir um recibo mínimo e não sensível — identidade pseudônima/chave, classe, timestamps, resultado e correlation ID — sem preservar o documento nem seus metadados pessoais desnecessários.

## Achados não-bloqueantes

- Reusar GSI6 é coerente com seu propósito de retenção/reconciliação, e escrever o ponteiro na mesma transação do soft-delete é correto. O teste de isolamento deve provar positivamente que apenas as quatro roles autorizadas alcançam GSI6 e negativamente que handlers tenant-facing continuam sem acesso.

- A documentação de [dynamo-table/main.tf](/C:/Users/Usuario/Desktop/projects/expiration-tracker/infra/modules/dynamo-table/main.tf:223) ainda fala em exatamente dois consumidores, enquanto `infra/main.tf` já tem três. A mudança deve reconciliar todos os comentários e assertions, não somente os dois lugares citados pela proposta.

- Uma única partição global `WORKSTATE#PURGE_PENDING` é aceitável para a escala atual, mas precisa de limite de batch, paginação e métrica de backlog/idade do candidato mais antigo. Caso contrário, um tenant volumoso pode atrasar todos os demais.

- A cadência de seis horas parece proporcional ao prazo de 30 dias, desde que exista alarme por atraso real. A definição deve usar `<= now` ou justificar formalmente por que um candidato exatamente no instante-limite espera mais um ciclo.

- Há inconsistência interna: o §3 descreve `buildDocumentPurgeGsi6Sk(...)` fixo em `DOCUMENT`, enquanto o §5 afirma que o builder é parametrizado por `entityType/id`. Para W3-06, prefiro o builder específico de documento; a generalização para W3-07 deve esperar os requisitos reais da cascata.

- O lifecycle de quarantine já é de um dia e inclui versões não correntes. Acrescentar uma segunda regra de 400 dias ali não oferece a proteção descrita e pode gerar sobreposição confusa.

## Nota: 5,8/10

## Veredito

**REPROVADO na Rodada 1.**

A direção geral — ponteiro GSI6 transacional, worker explícito e deleção por versão — é adequada, mas o desenho atual admite perda irreversível de documentos ativos ou sob hold, possui uma corrida real entre DynamoDB e S3 e especifica IAM/TTL incompatíveis com a implementação real. A próxima rodada deve introduzir um claim/fence atômico antes da deleção S3, resolver `legalHold`, retirar ou redesenhar o lifecycle incondicional do bucket `clean` e definir uma máquina reentrante com evidência auditável de conclusão.
tokens used
69.931
## Achados bloqueantes

1. **A ordem S3 → DynamoDB contém uma corrida destrutiva TOCTOU.**  
   A leitura via GSI6 não é uma checagem válida no momento da deleção. GSI6 é eventualmente consistente e, após a leitura, o documento pode ser alterado, restaurado ou colocado sob hold. O worker apagaria as versões S3 primeiro; só depois descobriria, pela condição `status = "DELETED"`, que não podia apagar a linha. O resultado seria uma linha válida apontando para conteúdo já destruído. Isso contradiz a regra de que decisões críticas não podem depender exclusivamente de GSI em [data-model.md](/C:/Users/Usuario/Desktop/projects/expiration-tracker/docs/architecture/data-model.md:87).

   É necessário um fence atômico antes do S3, por exemplo uma transição condicionada `DELETED → PURGING`, verificando pelo menos versão, `purgeAfter`, ponteiro GSI e ausência de hold. Depois desse claim irreversível, o S3 pode ser apagado de forma reentrante e a linha removida ao final. Uma simples releitura consistente ainda deixaria uma janela TOCTOU entre a releitura e o S3.

2. **O lifecycle incondicional de 400 dias no bucket `clean` apagaria documentos ativos.**  
   O bucket contém documentos de registro e tem versionamento habilitado, mas atualmente não possui lifecycle em [document-buckets/main.tf](/C:/Users/Usuario/Desktop/projects/expiration-tracker/infra/modules/document-buckets/main.tf:88). Uma regra aplicada ao bucket inteiro não sabe se houve soft-delete: qualquer documento ativo com mais de 400 dias seria eliminado. A afirmação de que a regra “nunca dispara no caminho normal” só considera documentos excluídos antes de 370 dias e ignora documentos legítimos mantidos por mais de 400 dias.

   Além disso, o prazo normativo é “evento de exclusão/encerramento + 30 dias”, não criação + 400 dias. Portanto, essa rede não é apenas imprecisa: ela é insegura para dados ativos.

3. **A proposta ignora completamente `legalHold`.**  
   [privacy-lgpd.md](/C:/Users/Usuario/Desktop/projects/expiration-tracker/docs/architecture/privacy-lgpd.md:33) determina que hold suspende o purge, e `USER_DOCUMENT` admite obrigação específica como hold. O `Document` atual nem sequer materializa `legalHold`, e o desenho condiciona somente `status = "DELETED"`. Tanto o worker quanto o lifecycle de 400 dias poderiam destruir conteúdo sob retenção obrigatória. Antes de aprovar, o desenho precisa definir onde o hold aplicável é armazenado, como é consultado/fenceado e como impede também a rede de segurança S3.

4. **As permissões IAM descritas não autorizam a operação proposta e não correspondem ao port real.**  
   O purge usa `TransactWriteItems`, logo `dynamodb:DeleteItem` isolado não basta; a role precisa de `dynamodb:TransactWriteItems` sobre a tabela. Para o método existente `deleteObjectVersion()` em [s3-document-object-store.ts](/C:/Users/Usuario/Desktop/projects/expiration-tracker/src/modules/document/persistence/s3-document-object-store.ts:48), a ação relevante é `s3:DeleteObjectVersion`, não apenas `s3:DeleteObject`. O repositório já usa essa ação explicitamente nas roles existentes em [main.tf](/C:/Users/Usuario/Desktop/projects/expiration-tracker/infra/main.tf:993).

   `s3:GetObject` também não é necessário para a operação descrita e amplia o blast radius sem justificativa. A policy deve ser uma capability mínima específica, sem herdar a ampla `tenant_facing_read_write` apenas por conveniência.

5. **O “TTL opcional” está tecnicamente incorreto e pode tornar o vazamento S3 permanente.**  
   A tabela já tem TTL habilitado em `purgeAfterTtl`, não em `purgeAfter`, conforme [dynamo-table/main.tf](/C:/Users/Usuario/Desktop/projects/expiration-tracker/infra/modules/dynamo-table/main.tf:147). Além disso, `purgeAfter` hoje é ISO string, enquanto DynamoDB TTL exige epoch seconds numérico.

   Mais grave: se o TTL remover a linha antes do worker, desaparecem também o candidato GSI6 e as referências exatas de bucket/key/versionId. O S3 fica órfão e o mecanismo primário perde a capacidade de encontrá-lo. Portanto, TTL da mesma linha não é uma segunda rede segura; ele compete com o workflow. Só seria aceitável após prova de que a exclusão DynamoDB não pode preceder a confirmação de purge S3, possivelmente usando um registro de trabalho separado.

6. **A reentrância coberta pela proposta é insuficiente para falhas parciais e concorrência.**  
   “DeleteObject de objeto ausente não falha” cobre somente replay depois de uma deleção bem-sucedida. Faltam estados/testes para:

   - crash após apagar `quarantineObject`, antes de apagar `cleanObject`;
   - duas invocações concorrentes processando o mesmo candidato;
   - hold ou mudança de versão entre descoberta e claim;
   - erro permanente de S3 e política de retry/DLQ/alarme;
   - linha removida por TTL antes da exclusão S3;
   - `DeleteItem` condicional perdido pelo segundo worker após ambos apagarem S3;
   - paginação, limite por execução e retomada após timeout.

   O desenho precisa declarar explicitamente quais falhas são sucesso idempotente, retryable ou falha terminal observável.

7. **Não está definido um registro auditável da purga concluída.**  
   A remoção física da própria linha elimina `deletedAt`, `purgeAfter` e as referências que provariam o atendimento. A exigência normativa é workflow auditável, não retenção do conteúdo pessoal. É necessário definir um recibo mínimo e não sensível — identidade pseudônima/chave, classe, timestamps, resultado e correlation ID — sem preservar o documento nem seus metadados pessoais desnecessários.

## Achados não-bloqueantes

- Reusar GSI6 é coerente com seu propósito de retenção/reconciliação, e escrever o ponteiro na mesma transação do soft-delete é correto. O teste de isolamento deve provar positivamente que apenas as quatro roles autorizadas alcançam GSI6 e negativamente que handlers tenant-facing continuam sem acesso.

- A documentação de [dynamo-table/main.tf](/C:/Users/Usuario/Desktop/projects/expiration-tracker/infra/modules/dynamo-table/main.tf:223) ainda fala em exatamente dois consumidores, enquanto `infra/main.tf` já tem três. A mudança deve reconciliar todos os comentários e assertions, não somente os dois lugares citados pela proposta.

- Uma única partição global `WORKSTATE#PURGE_PENDING` é aceitável para a escala atual, mas precisa de limite de batch, paginação e métrica de backlog/idade do candidato mais antigo. Caso contrário, um tenant volumoso pode atrasar todos os demais.

- A cadência de seis horas parece proporcional ao prazo de 30 dias, desde que exista alarme por atraso real. A definição deve usar `<= now` ou justificar formalmente por que um candidato exatamente no instante-limite espera mais um ciclo.

- Há inconsistência interna: o §3 descreve `buildDocumentPurgeGsi6Sk(...)` fixo em `DOCUMENT`, enquanto o §5 afirma que o builder é parametrizado por `entityType/id`. Para W3-06, prefiro o builder específico de documento; a generalização para W3-07 deve esperar os requisitos reais da cascata.

- O lifecycle de quarantine já é de um dia e inclui versões não correntes. Acrescentar uma segunda regra de 400 dias ali não oferece a proteção descrita e pode gerar sobreposição confusa.

## Nota: 5,8/10

## Veredito

**REPROVADO na Rodada 1.**

A direção geral — ponteiro GSI6 transacional, worker explícito e deleção por versão — é adequada, mas o desenho atual admite perda irreversível de documentos ativos ou sob hold, possui uma corrida real entre DynamoDB e S3 e especifica IAM/TTL incompatíveis com a implementação real. A próxima rodada deve introduzir um claim/fence atômico antes da deleção S3, resolver `legalHold`, retirar ou redesenhar o lifecycle incondicional do bucket `clean` e definir uma máquina reentrante com evidência auditável de conclusão.
