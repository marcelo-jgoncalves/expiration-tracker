codex

## Proposta independente — quota de armazenamento por tenant

**Pesquisa externa considerada: SIM PARCIAL** — consultada em 9 de setembro de 2026. O comportamento de produto — quota compartilhada, bloqueio de novos uploads e avisos — foi informado por documentação oficial de Dropbox, Google Workspace, Box e GitHub. O modelo DynamoDB, os estados contabilizados e os hook points são decisões internas, fundamentadas no código deste repositório. A amostra cobre armazenamento pessoal/equipe, produtividade empresarial e plataforma para desenvolvedores; não encontrei documentação pública confiável explicando os contadores internos desses fornecedores, portanto não afirmo que usem a implementação incremental proposta aqui.

Sub-rubrica para avaliar a decisão:

1. **30% — enforcement sem oversubscription:** uploads concorrentes não podem reservar mais que o limite.
2. **25% — contabilidade ligada ao lifecycle real:** reservar, promover, rejeitar e excluir alteram a quota exatamente uma vez.
3. **20% — reconciliação operacional:** drift entre DynamoDB e S3 é detectável e reparável.
4. **15% — desacoplamento de billing:** funciona com limite local/default mesmo sem M12/D-052.
5. **10% — UX/RBAC coerentes:** todos que podem consumir armazenamento veem a disponibilidade; apenas a política administrativa é privilegiada.

### 1. Medição e hook points

Recomendo um **contador incremental atômico no DynamoDB**, complementado — nunca substituído — por reconciliação periódica via S3 Inventory.

A unidade cobrada deve ser `DocumentFile.contentLength` para arquivos duravelmente disponíveis em `scanStatus = CLEAN`. Contudo, o enforcement precisa considerar:

```text
usedBytes + reservedBytes + requestedBytes <= limitBytes
```

Os hook points reais seriam:

- **Reserva:** em `DocumentArchiveService.reserveFiles()`, antes de emitir qualquer presigned URL. Esse método já conhece todos os `contentLength`, sela `fileSetSealed` e grava os `DocumentFile` na mesma `TransactWriteItems`. A mesma transação deve incrementar `reservedBytes` pela soma do lote, com condição atômica contra o limite. Sob disputa, reler e repetir como `SubjectService.createSubject()`.
- **Confirmação durável:** em `confirmFileScanClean()`, exatamente na transação que muda o arquivo para `CLEAN`. Ela deve mover `file.contentLength` de `reservedBytes` para `usedBytes`; o total comprometido não muda. O código anterior já verificou por `headObject()` que o objeto promovido tem o tamanho esperado.
- **Falha terminal:** as transições para `REJECTED`, `UNSUPPORTED` e `TIMEOUT` devem liberar `reservedBytes` na mesma transação que terminaliza o arquivo. Não se deve esperar por `commitUpload()`: ele altera a versão para `RECEIVED`, mas não prova armazenamento CLEAN.
- **Exclusão:** decrementar `usedBytes` exatamente quando uma futura operação durável marca o `DocumentFile` CLEAN como não mais retido e agenda a remoção física. **Fato verificado:** não encontrei hoje um lifecycle de exclusão/purga de `DocumentFile` do archive; portanto esse hook ainda precisa ser criado. A remoção S3 deve ser assíncrona/idempotente via outbox, pois DynamoDB e S3 não formam uma transação única.

Eu excluiria da quota comercial objetos de quarentena e cópias órfãs transitórias; eles são custo operacional interno e têm lifecycle/compensação próprios. `reservedBytes` evita abuso do intervalo de upload sem apresentar quarentena como armazenamento utilizável.

S3 Inventory é diário/semanal e o primeiro relatório pode levar até 48 horas; CloudWatch `BucketSizeBytes` é uma métrica diária de bucket, inclui versões não correntes e multipart incompleto e não oferece contabilidade tenant-precisa. Portanto nenhum dos dois serve para admission control síncrono. Inventory por prefixo `document-archive/clean/<tenantId>/...` é adequado para um job diário de auditoria e reparo de drift. [S3 Inventory](https://docs.aws.amazon.com/AmazonS3/latest/userguide/storage-inventory.html), [métricas S3/CloudWatch](https://docs.aws.amazon.com/AmazonS3/latest/userguide/metrics-dimensions.html).

### 2. Local da quota e desacoplamento de billing

Recomendo uma entidade nova, pertencente ao módulo `document-archive`, por exemplo:

```text
TenantStorageQuota
tenantId
limitBytes
usedBytes
reservedBytes
planSource/defaultPolicyId
createdAt, updatedAt, version
```

Ela deve ter uma chave tenant-scoped própria, não compartilhar o item `TenantEntitlement`.

Embora `TenantEntitlement` forneça o precedente correto — limite e contador juntos, atualização transacional e provisionamento default — ele está fisicamente no módulo `subject` e modela `activeTrackedSubjects`. Fazer o archive importar esse domínio criaria ownership invertido e acoplaria a contenção de uploads ao contador de fornecedores. Um item separado também impede que uploads intensos provoquem conflitos OCC em alterações independentes de subject.

O desacoplamento de M12 deve ser estrutural: um `defaultStorageQuota()` cria um limite local explícito, assim como D-038 já faz para subjects. Posteriormente billing poderá **alterar `limitBytes` por uma porta interna**, mas nunca será necessário para ler ou aplicar a quota. `planSource` pode indicar `DEFAULT`, `MANUAL` ou futuramente `BILLING`; não colocaria IDs ou estados do vendor D-052 nessa entidade.

Há uma incerteza de produto que a arquitetura não deve esconder: o valor concreto do limite default ainda precisa ser decidido. O mecanismo não depende desse número.

### 3. Enforcement

Recomendo **hard block para novos bytes**, com soft warning antecipado. Dropbox para uploads quando a conta está cheia; Box rejeita uma ação quando o upload excederia o espaço disponível; Google aplica limites de armazenamento compartilhado. Isso sustenta a semântica de impedir crescimento, não de apagar ou bloquear leitura de conteúdo existente. [Dropbox](https://help.dropbox.com/storage-space/over-storage-limit), [Box](https://support.box.com/hc/en-us/articles/360044193593--Uploading-This-Will-Put-You-Over-Your-Allocated-Space-Error-on-Upload), [Google Workspace](https://support.google.com/a/users/answer/7338880?hl=en).

O gate exato é `reserveFiles()`, na mesma transação que sela a versão e cria os arquivos. Bloquear em `commitUpload()` seria tarde: os objetos já poderiam existir em quarentena. Bloquear apenas em `confirmFileScanClean()` também seria incorreto, pois vários uploads concorrentes poderiam consumir largura de banda e criar cópias antes que algum contador fosse atualizado.

A falha deve ser um `QuotaExceededError` estruturado contendo `limitBytes`, `usedBytes`, `reservedBytes`, `requestedBytes` e `availableBytes`, sem detalhes de billing. Leituras, downloads, revisão, rejeição e exclusão continuam permitidos quando acima do limite. Um limite reduzido abaixo do uso atual coloca o tenant em estado "over quota", mas não invalida arquivos existentes; apenas impede novas reservas até liberar espaço ou elevar o limite.

### 4. Exibição

Usaria **duas superfícies, sem criar um novo destino de navegação**:

- **A19 / Settings:** subseção própria `/settings/storage`, exibindo usado, reservado/processando, limite e espaço disponível. Ela é a fonte canônica e deve ficar visível a todos os membros, separada da subaba de configuração de organização que hoje é OWNER-only.
- **A03 / Dashboard:** mostrar um card/banner somente quando a quota exigir atenção. O dashboard responde "o que precisa da minha atenção agora"; uma barra permanente de storage diluiria os quatro contadores operacionais já definidos.
- **Fluxos de upload:** mostrar disponibilidade antes da confirmação e apresentar a falha de quota com ação de recuperação, nunca apenas um erro genérico.

Recomendo warning em **80% do limite comprometido**, calculado por `(usedBytes + reservedBytes) / limitBytes`, e estado crítico em 95%. O hard block continua sendo a projeção por bytes do próximo lote, não apenas `>=100%`. O limiar de 80% tem precedente direto no aviso do Google quando resta menos de 20% de um limite; GitHub usa alertas em 90% e 100%, mostrando que não há um único padrão convergente. Para este produto, 80% oferece mais tempo operacional para coletar documentos ou limpar espaço. [Google Shared Drives](https://support.google.com/a/users/answer/7338880?hl=en), [GitHub LFS](https://docs.github.com/en/billing/concepts/product-billing/git-lfs).

### 5. RBAC do endpoint de leitura

O endpoint, por exemplo `GET /document-archive/storage-usage`, deve reutilizar **`docarchive:read`**, portanto `READ_ONLY_ROLES`.

Não criaria `storage:read`: uso, limite e disponibilidade são uma summary numérica do mesmo acervo que todos os papéis já podem ler e ao qual OWNER/ADMIN/MEMBER podem adicionar arquivos. Negar essa visibilidade a MEMBER produziria uploads que falham sem permitir ao operador entender a causa.

O precedente mais próximo é D-248: a leitura tenant-wide da review queue reutilizou `docarchive:read`, separando leitura de summary/membership da ação mutável `docarchive:review`. O dashboard atual também compõe summaries tenant-wide usando Actions READ_ONLY existentes, em vez de criar uma permissão "dashboard". A alteração futura de `limitBytes`, por outro lado, deve ser uma Action administrativa separada — provavelmente ADMIN ou OWNER — e não faz parte do endpoint de leitura proposto.

(Note: full raw `codex exec` transcript, including tool-call/grep trace, was trimmed from this
file for repo size — this is the clean final answer text only, verbatim.)
