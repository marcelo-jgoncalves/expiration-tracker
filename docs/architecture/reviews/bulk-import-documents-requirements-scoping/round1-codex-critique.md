# Rodada 1 - Crítica Codex

## Parecer executivo

A proposta não está pronta para aprovação. A direção geral — mapping explícito, um target por job, rejeição de referências inválidas e reuso dos serviços de domínio — é boa, mas há quatro problemas estruturais:

1. A pesquisa externa é apresentada como convergente, porém duas das próprias famílias de fontes contradizem a conclusão “nunca múltiplas entidades relacionadas na mesma linha”.
2. O fluxo `/schema` → `/mapping` é incompatível com o trigger S3 atual e contém uma corrida determinística.
3. O mecanismo de referência por `externalId` não resolve Subjects existentes em geral; resolve somente Subjects que possuem sidecar `ImportDedupRecord`.
4. Dedupe, criação da entidade e avanço do cursor continuam sem uma unidade atômica. A proposta aceita como idempotência um registro de claim que pode representar uma criação que nunca aconteceu.

## 1. Avaliação da pesquisa externa

A declaração `SIM` é apropriada: importação configurável, associação entre registros e dedupe são padrões externos estabelecidos.

As fontes sustentam parcialmente:

- Mapping explícito de coluna para campo.
- Uso de identificadores fortes para associação e dedupe.
- Preview antes da aplicação.
- Importação do registro pai antes do filho em certos produtos e fluxos.
- Rejeição ou sinalização de linhas que não conseguem ser associadas.

Entretanto, a conclusão convergente principal foi superestimada.

A documentação atual do HubSpot afirma expressamente que uma importação multiobjeto pode usar **um único arquivo**, no qual cada linha representa registros relacionados. Também permite criar, atualizar e associar múltiplos objetos nessa importação. Logo, as afirmações “um tipo por arquivo, nunca múltiplas entidades relacionadas numa única linha” e “nunca por criar os dois lados na mesma linha” são falsas como descrição do padrão HubSpot. [HubSpot — Understand the import tool](https://knowledge.hubspot.com/import-and-export/understand-the-import-tool), [HubSpot — Import records for multiple objects](https://knowledge.hubspot.com/import-and-export/import-objects).

Salesforce também não sustenta a regra absoluta. O Data Import Wizard pode processar contas e contatos conjuntamente, criando contas únicas, criando contatos e associando-os no mesmo fluxo. [Salesforce — What Is Imported for Business Accounts and Contacts?](https://help.salesforce.com/s/articleView?id=sf.for_accounts_and_contacts.htm&language=en_US&type=5).

Zendesk sustenta a ordem organizações → usuários para seu importador de organizações, mas isso é uma limitação ou escolha daquele produto, não prova de uma regra universal. [Zendesk — Bulk importing organizations](https://support.zendesk.com/hc/en-us/articles/4408885980186-Bulk-importing-organizations).

Airtable sustenta mapping configurável, preview e escolha de campo de merge. Também mostra aspectos não incorporados no checklist: sensibilidade a maiúsculas, tratamento de brancos, duplicatas dentro do próprio arquivo e persistência/reuso do mapping. Não sustenta a frase atribuída a ele de que campos não mapeados necessariamente “viram colunas novas”; o importador para tabela existente permite simplesmente não importar campos. [Airtable — CSV import extension](https://support.airtable.com/articles/3067164948-csv-import-extension).

Portanto, “um tipo por job” pode ser uma escolha correta para este sistema, mas deve ser defendida por simplicidade operacional, atomicidade, modelo atual e escopo — não como padrão externo convergente.

Faltam padrões externos relevantes:

- Semântica de `CREATE_ONLY`, `UPDATE_ONLY` e `UPSERT`.
- Política de duplicatas dentro do próprio arquivo.
- Normalização e case sensitivity de identificadores.
- Ambiguidade quando uma referência encontra mais de um registro.
- Persistência e reutilização de mappings.
- Evolução/versionamento do schema de mapping.
- Snapshot semântico do catálogo entre preview e commit.
- Cancelamento, retry e reconciliação após commit parcial.
- Destino/auditoria dos campos não mapeados.
- Estratégia de “dry run” e download de relatório de erros.

## 2. Contestação do checklist pesado

O checklist precisa ser reconciliado antes da Rodada 2.

### Critério 1 — 20%

A âncora mistura duas decisões distintas:

- Um target por `ImportJob`.
- Referências somente a entidades previamente persistidas.

A primeira é uma boa simplificação local. A segunda é uma política de associação. Elas devem ser avaliadas separadamente. A proibição de “grafo de linhas” não é derivada da pesquisa como alegado.

Sugestão: reduzir para 10–12% e formular como “limite explícito e consistente de atomicidade/ordenação do job”.

### Critério 2 — 20%

O peso é razoável, mas a proposta não atende à própria âncora. `ColumnMapping` não possui versão; remover `mappingVersion` torna o contrato menos versionado, não mais. `targetEntityType` duplicado dentro do mapping também permite divergência em relação ao job.

A âncora precisa exigir:

- `schemaVersion`;
- catálogo de campos identificado por versão;
- unicidade do header de origem;
- política para headers duplicados;
- snapshot imutável após início do parse;
- normalização explicitamente definida.

### Critério 3 — 20%

É um critério correto e de peso adequado. Deve, porém, cobrir tanto preview quanto commit: a referência pode ser válida no parse e deixar de ser válida antes da escrita.

### Critério 4 — 15%

A honestidade sobre ausência de chave natural é necessária, mas insuficiente. O critério deve avaliar a semântica operacional completa:

- chave e escopo;
- normalização;
- duplicata dentro do arquivo;
- concorrência entre jobs;
- claim órfã;
- retry depois de falha;
- vínculo entre dedup record e entidade realmente criada.

### Critério 5 — 15%

“Reusar a máquina existente” não deve receber aprovação se preservar invariantes defeituosas. O pipeline atual não fornece atomicidade entre claim, criação e cursor. O critério precisa dizer “reuso sem herdar ou ampliar falhas conhecidas”.

### Critério 6 — 10%

O recorte de arquivos/versões é claro, mas 10% é excessivo para uma exclusão de escopo. Eu reduziria para 5%.

### Critério ausente e bloqueante

Deve existir um critério próprio, com pelo menos 20–25%, para:

**Idempotência, atomicidade e reconciliação do commit por linha.**

Sem ele, uma proposta pode obter nota alta mesmo gravando claim, entidade e cursor em três writes independentes e interpretando uma claim órfã como sucesso.

Também falta um critério de 10–15% para segurança/invariantes de referência no momento do commit: tenant, status do Subject, status do DocumentType, autorização sistêmica e TOCTOU entre preview e commit.

## 3. Achados numerados

### 1. Bloqueante — D-2 possui uma corrida incompatível com o fluxo S3 real

Hoje o upload em `raw.csv` dispara `parseImportJob()`. O worker aceita apenas `status === "UPLOADED"` e imediatamente muda o job para `PARSING`.

Na proposta, o upload continua disparando esse evento, mas o mapping só é fornecido depois, por outro endpoint. Assim, existem dois resultados:

- O parse roda primeiro, encontra mapping ausente e falha com `MAPPING_NOT_CONFIGURED`.
- O mapping é gravado primeiro por sorte, e o parse funciona.

Isso não é um protocolo válido; é uma corrida entre usuário/UI e evento S3. “O parser espera mapping presente” não resolve, porque `FAILED` é terminal no fluxo apresentado e não existe mecanismo de redisparo confiável.

É necessário decidir uma orquestração explícita, por exemplo:

- Upload apenas disponibiliza o arquivo; `POST /mapping` grava mapping e publica `ParseRequested` via outbox.
- Ou introduzir estado `AWAITING_MAPPING` e um comando explícito de parse.
- Ou fornecer target e mapping antes do presign, se os headers já forem conhecidos — o que não atende ao wizard de inspeção posterior.

A exigência do critério 5 de “nenhum novo status” não deve impedir a máquina de representar um estado real.

### 2. Bloqueante — D-6 preserva uma idempotência incorreta baseada em claim órfã

O código atual faz:

1. `putIfAbsent(ImportDedupRecord)` com `subjectId: ""`;
2. chama `createSubject()`;
3. atualiza o dedup record;
4. avança o cursor.

Se o processo cai entre 1 e 3, o retry encontra `claimed === false`, presume que a linha foi commitada e avança o cursor, embora a entidade possa nunca ter sido criada.

A proposta pretende repetir esse padrão para Document e Requirement e chama a janela de “aceita”. Isso não é apenas uma imperfeição de dedupe; é perda silenciosa de uma linha aceita no preview.

Para filhos, o problema fica pior: o mesmo sidecar também é usado como índice de referência e pode conter um identificador vazio ou apontar para entidade inexistente.

A Rodada 2 precisa escolher um protocolo verificável:

- criação da entidade + dedup sidecar na mesma `TransactWriteItems`;
- ou claim com estados `CLAIMED/COMMITTED`, owner/job/row, lease e reconciliação;
- ou, ao encontrar claim existente, verificar a entidade final antes de avançar o cursor.

### 3. Bloqueante — `externalId` não existe em `TrackedSubject`; D-3 não resolve “Subjects existentes” em geral

O domínio real `TrackedSubject` não possui `externalId`. Esse valor existe apenas em `ImportDedupRecord`.

Logo, lookup por `importDedupKey(tenantId, externalId)` resolve somente Subjects criados por um import que tenha produzido e finalizado corretamente esse sidecar. Não resolve:

- Subject criado pela API/UI;
- Subject importado sem `externalId`;
- Subject cujo sidecar ficou órfão ou incompleto;
- Subject já existente antes da introdução desse mecanismo.

A frase “Subject existente ou criado por job anterior” é ampla demais. A semântica real seria “Subject que possui binding de external ID criado pelo módulo de import”.

É preciso decidir se `externalId` é:

- identidade de integração durável do Subject;
- alias/binding próprio, administrável independentemente do job;
- ou apenas idempotency key de import.

Hoje o mesmo registro tenta exercer as três funções, com semântica insuficiente.

### 4. Bloqueante — `createDocument()` não protege o Subject no commit

A proposta afirma que os serviços existentes podem ser reutilizados sem alteração de contrato. O código real contradiz isso.

`createRequirement()` inclui um `ConditionCheck` transacional exigindo Subject existente e `ACTIVE`.

`createDocument()` inclui apenas:

- `ConditionCheck` de `DocumentType.status === ACTIVE`;
- `Put` do Document;
- fence do tenant adicionada por `executeTenantBusinessMutation`.

Não há fence de existência/status do Subject. Portanto, um Subject pode ser resolvido como `ACTIVE` durante o preview, ser arquivado ou removido antes do commit e ainda receber um novo Document.

D-6 precisa exigir mudança em `createDocument()` ou outra primitiva transacional equivalente. Uma leitura durante o parse não fecha TOCTOU.

### 5. Alto — `ColumnMapping` não é versionado, apesar do critério dizer que é

A estrutura proposta contém somente:

```text
targetEntityType
columns
```

Não contém `mappingVersion` nem `schemaVersion`. Remover o campo existente elimina a única indicação de versão.

Além disso, o target já existe no `ImportJob`; duplicá-lo no mapping cria dois campos autoritativos que podem divergir. O mapping deveria ser validado contra `job.targetEntityType`, não carregar uma segunda autoridade sem necessidade.

### 6. Alto — D-4 não define dedupe concorrente e idempotência para Documents sem `externalId`

A proposta diz que um Document sem `externalId` “sempre cria”. Isso pode ser válido entre jobs diferentes, mas não em retries do mesmo job.

O pipeline atual usa uma chave sintética `job:<jobId>:row:<rowNumber>` para idempotência das linhas sem external ID. D-4 não diz se esse mecanismo será mantido no novo namespace nem como distinguir:

- dedupe de negócio entre jobs;
- idempotência técnica da mesma linha;
- claim incompleta;
- entidade já criada com cursor ainda não avançado.

Sem uma chave sintética estável ou protocolo equivalente, crash depois de `createDocument()` e antes do cursor duplica o Document.

### 7. Alto — o formato de chave D-4 é ambíguo e propenso a colisões

A forma:

```text
SK=EXT#<subjectId?>#<externalId>
```

não define encoding, escaping, normalização ou distinção estrutural entre variantes com e sem Subject. Valores contendo `#`, diferenças de case ou whitespace podem gerar comportamento inesperado.

Também há inconsistência conceitual: o PK já inclui entity type, mas o formato de SK varia implicitamente. A chave deve ter builders distintos e inequívocos, com normalização contratual:

```text
Subject:     PK=...#SUBJECT,     SK=EXT#<encodedExternalId>
Document:    PK=...#DOCUMENT,    SK=SUBJECT#<subjectId>#EXT#<encodedExternalId>
Requirement: PK=...#REQUIREMENT, SK=SUBJECT#<subjectId>#EXT#<encodedExternalId>
```

### 8. Alto — a proposta não define colisões dentro do próprio CSV para Requirement e Document

O parser atual mantém `seenExternalIdsInFile` para Subjects. A nova proposta fala somente em dedupe contra registros persistidos.

É necessário especificar:

- Duas linhas de Requirement com mesmo `(subjectId, externalId)`.
- Duas linhas de Requirement cujos nomes normalizam para o mesmo ponteiro.
- Duas linhas de Document com mesmo `(subjectId, externalId)`.
- Se a segunda é `REJECT`, `SKIP_DUPLICATE` ou atualização.
- Como o preview evita prometer duas criações que colidirão apenas no commit.

Esse ponto é especialmente importante porque duas ações sobre a mesma chave numa transação seriam inválidas, e commits separados podem produzir preview/commit divergentes.

### 9. Alto — resolução de `DocumentType` por display name não está suficientemente desenhada

`DocumentType` possui identidade estável por `documentTypeId` e um `DocumentTypeNamePointer` transacional. A proposta chama o campo de CSV de `documentTypeId`, mas diz que seu valor é `displayName` normalizado. Isso confunde identidade e label.

O contrato deveria usar algo como:

- `documentTypeRef`;
- `documentTypeRefKind: "DOCUMENT_TYPE_ID" | "DISPLAY_NAME"`.

Também não foi definido:

- se somente tipos `ACTIVE` são elegíveis;
- como todas as páginas do catálogo serão carregadas;
- se o pointer será consultado diretamente;
- como rename entre preview e commit é tratado;
- se o ID resolvido fica congelado no plano.

`listDocumentTypes()` é paginado via `queryIndexPage`; não existe o “mesmo pré-carregamento” simples já pronto que a proposta sugere.

### 10. Alto — ausência de snapshot/freeze do mapping durante o parse

O endpoint de mapping grava no mesmo job, mas não foi definida condição de OCC ou imutabilidade.

Uma alteração concorrente pode ocorrer:

- enquanto o parser lê o job;
- depois de o plano ser produzido;
- antes do commit;
- depois de o preview ser exibido.

`planSha256` protege os bytes do plano, não prova qual mapping/catálogo semântico o originou. O mapping deve tornar-se imutável ao iniciar o parse, e sua versão/hash deve fazer parte da proveniência do plano.

### 11. Médio — `Record<string,string>` é permissivo demais

A estrutura permite:

- campos internos desconhecidos;
- dois campos internos apontando para o mesmo header;
- header vazio;
- divergência de case;
- referência a headers duplicados;
- mapping de campo proibido;
- colisão depois da normalização;
- campos sem semântica de transformação.

É necessário um tipo discriminado por target e validação runtime completa. Para referências, `subjectRefKind` também precisa estar dentro do contrato formal, não apenas citado narrativamente.

### 12. Médio — `/schema` é descrito como “worker síncrono”, mas a fronteira operacional está incompleta

Um endpoint síncrono que lê S3 não é um worker no sentido usado pelo projeto. Além da nomenclatura, faltam:

- comportamento quando o objeto ainda não está visível/existe;
- validação do checksum real contra o reservado;
- limite para uma primeira linha maliciosamente grande;
- CSV vazio, BOM, encoding e headers duplicados;
- autorização e quota;
- OCC do job;
- estados nos quais o endpoint é permitido;
- possibilidade de substituir o objeto depois da inspeção, caso o presign ainda esteja válido.

### 13. Médio — custo por linha não é o risco principal da resolução de Subject

Até 5.000 `GetItem` pode ser aceitável, mas pré-carregar todos os dedup records do tenant exigiria um access pattern e paginação apropriados; o `ImportStore.queryByPk()` atual não consulta todos os namespaces de external ID sob um PK único se o desenho for particionado por tipo.

A otimização preferível é coletar referências distintas do arquivo e fazer lookup uma vez por valor único, com cache local por parse. Isso reduz leituras sem exigir carregar todo o histórico de bindings do tenant.

### 14. Médio — a política de commit parcial não foi generalizada por tipo de erro

Hoje apenas `QuotaExceededError` recebe tratamento fail-fast específico. Os novos serviços podem lançar:

- `DocumentTypeNotActiveError`;
- conflito de nome de Requirement;
- Subject fence failure;
- autorização;
- conflito de transação;
- dependência indisponível.

A proposta não decide quais são:

- erros permanentes de linha;
- conflito temporal que converte a linha em rejeição;
- erro transitório para retry da mensagem;
- falha terminal do job;
- motivo para reconciliação.

Preview pode ficar obsoleto, então essa taxonomia é obrigatória.

### 15. Médio — o modelo de preview não expressa adequadamente o resultado final

`REJECT` e `SKIP_DUPLICATE` possuem shapes genéricos diferentes, mas não há identificador da entidade existente, resolução de referências ou resultado do commit.

Para auditoria e UX, o plano deveria registrar, quando aplicável:

- `resolvedSubjectId`;
- `resolvedDocumentTypeId`;
- dedupe key normalizada;
- entidade existente que causou skip;
- mapping version/hash;
- código de rejeição fechado por target.

### 16. Baixo — a afirmação sobre `DocumentVersion.origin = "IMPORT"` é correta, mas não “fecha definitivamente” o tema

O código confirma que uma versão não pode atravessar `commitUpload()` sem `fileSetSealed=true`, e que `"IMPORT"` já existe como origem. Isso sustenta excluir `DocumentVersion` desta fatia CSV.

“Definitivamente” é forte demais: é uma decisão de escopo desta fatia, não uma impossibilidade arquitetural permanente. Um import futuro com arquivo pode usar o fluxo de reserva, scan e sealing.

## 4. Avaliação de D-1 a D-6

- **D-1:** direção aceitável como escolha local, mas justificativa externa incorreta. Deve explicitar dependências entre jobs e como a UI sabe que o job anterior terminou com bindings utilizáveis.
- **D-2:** não aceitável na forma atual devido à corrida upload/mapping/trigger S3 e ausência real de versionamento.
- **D-3:** não aceitável até separar binding externo durável de claim de idempotência e declarar que Subjects manuais não são resolvíveis, ou introduzir um mecanismo que os torne resolvíveis.
- **D-4:** incompleto. A honestidade sobre Document é boa, mas faltam idempotência sem external ID, concorrência, encoding, normalização e estado da claim.
- **D-5:** a união discriminada é adequada, mas o pipeline não é verdadeiramente genérico enquanto as políticas de erro, quota, dedupe e transação variam por entidade.
- **D-6:** não aceitável. Reuso dos serviços é desejável, porém `createDocument()` não protege o Subject, e dedup record fora da transação permite perda silenciosa e duplicação sob crash.

## Condições mínimas para a Rodada 2

1. Corrigir a leitura das fontes e reenquadrar “um target por job” como escolha local.
2. Redesenhar a orquestração para o parse só ser solicitado depois de mapping persistido.
3. Versionar e congelar o mapping; remover a autoridade duplicada de target.
4. Separar external binding de idempotency claim, ou formalizar estados e reconciliação.
5. Fechar atomicidade/retry de cada linha, incluindo linhas sem external ID.
6. Adicionar fence transacional de Subject em `createDocument()`.
7. Definir lookup de DocumentType por ID versus nome, incluindo rename e paginação.
8. Especificar duplicatas intra-arquivo e concorrência entre jobs.
9. Definir taxonomia de erros de commit e comportamento quando o preview fica obsoleto.
10. Rebalancear o checklist para dar peso dominante a atomicidade, idempotência e invariantes no commit.

**Nota Codex (cega), Rodada 1: 4.7/10.**
