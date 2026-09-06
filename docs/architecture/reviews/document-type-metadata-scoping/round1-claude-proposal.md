# Rodada 1 — `DocumentType` Configurable Metadata Fields (Roadmap P1 item "metadata configurável por Document Type")

**Autor**: Claude (Rodada 1). **Data**: 2026-09-06. **Nível de risco**: 5 (`change-risk-scale.md`) — introduz um novo formato de contrato de dados (definição de campo custom + valor tipado) em duas entidades já existentes (`DocumentType`, `Document`); não é nova stack, novo domínio de dado sensível, ou mudança de modelo de dados fundamental, então não exige ADR formal (mesmo precedente de D-191/D-192/D-193, que passaram pelo protocolo completo sem ADR).

## Contexto

`docs/project/roadmap-competitivo-2026-09-01.md` lista "metadata configurável [por Document Type]" no backlog P1 (pós-lançamento). D-198 confirmou por leitura direta que **nada existe hoje**: `document-type.ts` não tem nenhum campo de metadata configurável, `Document`/`DocumentVersion` não têm nenhum mecanismo de valor tipado além do OCR (`FIELD_SCHEMA_V1`, que é um schema FIXO por `pipelineVersion`, não configurável por tenant/admin — ver `src/modules/extraction/domain/field-schema.ts`, hoje só extrai `expirationDate`). Este design é о greenfield completo do item.

**Problema de produto**: hoje um `DocumentType` (ex. "Apólice de Seguro", "Contrato de Locação") é só um nome+status. Admins do tenant querem anexar campos estruturados adicionais específicos daquele tipo (ex. para "Apólice de Seguro": "seguradora", "valor da apólice", "número da apólice"; para "Contrato": "valor mensal", "parte contratante") sem que isso exija uma mudança de schema/deploy — análogo a "custom fields" em CRMs (Salesforce/HubSpot) ou "propriedades" em Airtable/Notion.

## Pesquisa externa considerada: SIM

Fontes (consultadas 2026-09-06):
- Weissman & Bobrowski, "The Design of the Force.com Multitenant Internet Application Development Platform", ACM SIGMOD 2009 — modelo EAV multitenant do Salesforce.
- Salesforce Help — "Considerations for Converting the Field Type of a Custom Field" / "Change the Data Type of a Custom Field".
- HubSpot Knowledge Base — "Understand property field types in HubSpot"; Hypha Dev — "HubSpot Custom Objects and Properties: A Complete Guide to CRM Data Architecture".
- Airtable Support — "Field Type overview"; Airtable Community — "Change populated field type" (thread documentando conversão com perda de dado).
- Confluent Docs — "Schema Evolution & Compatibility Types" (modelo BACKWARD/FORWARD/FULL do Schema Registry).
- Contentful Docs/Help — "Update a content type"; "Create and deploy content type changes".

**Representatividade**: a amostra cobre desde o extremo mais conservador/enterprise (Salesforce — bloqueia ou enfileira assincronamente conversão de tipo com dado existente) até o extremo mais permissivo/self-serve (Airtable — converte instantaneamente, com perda de dado documentada como risco que o usuário deve mitigar manualmente), passando por uma API/CMS moderna (Contentful — schema com controle de versão explícito, `Sys.Version` obrigatório em toda mutação) e o padrão de engenharia genérico de schema evolution (Confluent/JSON Schema — só mudança aditiva é retrocompatível, o resto exige migração explícita). Nenhuma fonte é só blog de vendor sem embasamento: Salesforce tem paper acadêmico peer-reviewed por trás do modelo físico, Confluent formaliza um padrão usado amplamente fora do próprio produto.

**Escopo da pesquisa**: informa a parte de risco real desta decisão — o que acontece com Documents já existentes quando um admin muda/remove um campo de metadata depois que Documents já têm valores gravados sob ele. Decisões puramente internas (layout de PK/SK, qual GSI, convenção de nome de arquivo) permanecem fora do escopo da pesquisa, informadas só pelo precedente já convergido deste projeto (`document-type.ts`, `requirement-template.ts`).

## Checklist de critérios de nota (derivado da pesquisa, pesado, subordinado aos eixos de `joint-review-criteria.md` Arquitetura + Qualidade de Engenharia)

1. **(peso 25%) Definições de campo são imutáveis em `valueType` uma vez criadas** — mudar tipo nunca reinterpreta valores já gravados sob a definição antiga. Atende: o design proíbe editar `valueType` de um campo existente (só nome/status mudam); não atende: qualquer caminho que permita `PATCH` mudar `valueType` de um campo com valores existentes.
2. **(peso 20%) Um valor armazenado nunca depende de reler a definição atual para saber como foi tipado** — o valor carrega tipo suficiente para ser interpretado sozinho, mesmo que a definição seja arquivada depois.
3. **(peso 20%) Arquivar/remover uma definição de campo nunca apaga fisicamente nem corrompe valores já gravados** — os valores ficam órfãos/inertes, nunca purgados nem reinterpretados.
4. **(peso 15%) Nenhuma mutação de tipo é implícita/instantânea na mesma escrita que edita a definição** — se um tipo precisa mudar, o caminho correto é arquivar o campo antigo e criar um novo `fieldId` (expand-and-contract), nunca uma conversão in-place (anti-padrão do Airtable).
5. **(peso 10%) Validação de campo obrigatório é só prospectiva** — Documents já existentes sem um campo que se tornou `required` depois nunca são retroativamente marcados inválidos/bloqueados (padrão Contentful).
6. **(peso 10%) Taxonomia de tipo de valor é fechada e enumerada** (não um type system aberto), cada tipo com uma representação de storage inequívoca.

## Decisões propostas

**Decisão 1 — Onde vivem as definições de campo**: array embutido `metadataFields: DocumentTypeMetadataFieldDefinition[]` dentro do próprio item `DocumentType` (mesmo padrão de `RequirementTemplate.items`, D-191) — não uma entidade separada. Racional: o ciclo de vida de "quais campos este tipo de documento tem" pertence ao catálogo, é lido inteiro toda vez que alguém cria/edita um Document daquele tipo (nunca paginado independentemente), e já há precedente direto (`RequirementTemplate`) para "lista pequena e cap-limitada embutida no agregado pai" neste projeto. Cap novo `MAX_DOCUMENT_TYPE_METADATA_FIELDS = 20` (mesma disciplina de cap explícito de `RequirementTemplate` cap 30/`DossierExport` cap 200).

```ts
export type DocumentTypeFieldValueType = "TEXT" | "NUMBER" | "DATE" | "BOOLEAN" | "SINGLE_SELECT";
export type DocumentTypeFieldStatus = "ACTIVE" | "ARCHIVED";

export interface DocumentTypeMetadataFieldDefinition {
  fieldId: string;          // ULID, imutável — identidade real, nunca reusado (mesmo racional de documentTypeId)
  name: string;              // renomeável — rótulo de exibição, nunca a identidade
  valueType: DocumentTypeFieldValueType;  // IMUTÁVEL após criação — Decisão 3
  required: boolean;         // mutável, só prospectivo — Decisão 5
  options?: readonly string[]; // só quando valueType === "SINGLE_SELECT"; pode CRESCER (adicionar opção),
                                // nunca remover uma opção referenciada por um valor já gravado (Decisão 4)
  status: DocumentTypeFieldStatus; // ACTIVE | ARCHIVED — nunca removido do array fisicamente (Decisão 4)
  createdAt: string;
  updatedAt: string;
}
```

**Decisão 2 — Onde vivem os valores**: novo campo opcional em `Document` (não em `DocumentVersion`) — `metadataValues?: Record<string /* fieldId */, DocumentMetadataValue>`, chaveado por `fieldId` (nunca por `name`, mesmo racional de `documentTypeId` vs. `displayName`). Racional: metadata como "seguradora"/"valor da apólice" descreve o REGISTRO documental como um todo (a mesma entidade que já carrega `documentTypeId`), não uma versão específica de arquivo — `DocumentVersion` é conteúdo binário imutável (upload), `Document` é a identidade estável que já muda de versão sem perder identidade (`currentVersionId`). Um valor de metadata mudar não é "uma nova versão do arquivo", é só uma edição de propriedade — mesmo tipo de mutação que `DocumentType.rename()` já faz no catálogo pai.

```ts
export interface DocumentMetadataValue {
  valueType: DocumentTypeFieldValueType; // denormalizado do momento da escrita — Critério 2:
                                          // nunca depende de reler a definição atual para saber o tipo
  value: string | number | boolean;      // TEXT/SINGLE_SELECT -> string; NUMBER -> number;
                                          // DATE -> string ISO-8601; BOOLEAN -> boolean
}
```

**Decisão 3 — Imutabilidade de `valueType`**: uma vez criado um `DocumentTypeMetadataFieldDefinition`, seu `valueType` NUNCA muda — só `name`/`required`/`options` (só crescendo)/`status` são editáveis via update transacional (OCC no `DocumentType.version`, mesmo padrão de `renameDocumentType`). Se um tenant precisa mudar o tipo de um campo, o caminho é: arquivar o campo antigo (`status=ARCHIVED`, nunca deletado do array) + criar um novo campo com novo `fieldId`/`valueType` desejado — mesmo padrão "expand-and-contract" que a pesquisa (Contentful) recomenda explicitamente e que o precedente mais conservador (Salesforce, que bloqueia/enfileira conversão) reforça como a postura correta para dado em produção. Fecha os Critérios 1 e 4 do checklist por CONSTRUÇÃO (não existe operação de "mudar tipo com dado existente" no contrato, então não há classe de bug para prevenir em runtime).

**Decisão 4 — Arquivamento nunca apaga valor histórico**: arquivar um campo (`status=ARCHIVED`) NUNCA remove `Document.metadataValues[fieldId]` de nenhum Document existente — só impede que NOVOS/EDITADOS Documents recebam um valor sob aquele `fieldId` (fenced no `updateDocumentMetadata()`/`createDocument()`, verificando `status === "ACTIVE"` na definição, mesmo padrão do `DocumentTypeNotActiveError` que `createDocument()` já verifica para o TIPO inteiro — D-175). Um Document antigo com um valor sob um campo arquivado continua exibindo esse valor (órfão, nunca purgado) — fecha o Critério 3. Pela mesma razão, `options` de um `SINGLE_SELECT` só pode CRESCER (adicionar item) via update — nunca remover um item já referenciado por `Document.metadataValues` existente (não validado ativamente contra todos os Documents — análogo ao Critério 5, é aceitável um `SINGLE_SELECT` "órfão" apontar para uma opção removida do catálogo, mesma tolerância que o Critério 3 já aceita para o campo inteiro).

**Decisão 5 — Validação é só prospectiva**: `required=true` (seja na criação do campo, seja numa edição que muda `required=false→true`) nunca é validado retroativamente contra Documents já existentes — só se aplica no momento em que um Document daquele tipo é CRIADO ou tem seu `metadataValues` EDITADO depois da mudança. Fecha o Critério 5 (mesmo achado que Contentful documenta: mudança de validação nunca reabre entradas antigas).

**Decisão 6 — RBAC**: duas actions NOVAS em `authorization.ts` (achado ao verificar por leitura direta: `docarchive:update` **não existe** — `Document` hoje não tem NENHUMA operação de edição pós-criação, só `create`/`upload`/`review`; a Rodada 1 original presumiu incorretamente que essa action já existia, corrigido aqui antes de submeter). Mesmo prefixo `docarchive:` já usado por `docarchive:documenttype-*` (D-173/D-174): `docarchive:documenttype-metadata-manage` (criar/renomear/arquivar/reativar CAMPO — `ADMIN_ROLES`, mesmo tier de `docarchive:documenttype-create`, é mutação de catálogo) e `docarchive:document-metadata-update` NOVA (editar VALORES num Document específico — `WRITE_ROLES`, mesmo tier de `docarchive:create`/`docarchive:upload`, já que preencher/corrigir um valor de metadata é operação de dia-a-dia sobre um Document já existente, não administração de catálogo).

**Decisão 7 — Rotas HTTP** (mesmo Lambda `document-archive-handler`, mesma disciplina de proxy-allowlist D-117/D-120/D-178):
- `POST /document-archive/document-types/{documentTypeId}/metadata-fields` (criar campo)
- `PATCH /document-archive/document-types/{documentTypeId}/metadata-fields/{fieldId}` (renomear/mudar required/adicionar option/arquivar/reativar)
- `PATCH /document-archive/documents/{documentId}/metadata-values` (definir/editar valores, RBAC `docarchive:document-metadata-update`; corpo valida contra as definições ATIVAS do `documentTypeId` daquele Document no momento da escrita)

**Decisão 8 — Taxonomia de tipo (Critério 6)**: fechada em 5 valores (`TEXT`/`NUMBER`/`DATE`/`BOOLEAN`/`SINGLE_SELECT`) — cobre os exemplos de produto citados no roadmap ("seguradora" → SINGLE_SELECT ou TEXT; "valor da apólice" → NUMBER; datas adicionais → DATE) sem replicar a taxonomia já usada por `ExtractedFieldValueType` (`DATE`/`STRING`/`NUMBER`, conceito de OCR, deliberadamente não reusado aqui — são dois contratos diferentes, um é candidato de extração, outro é valor confirmado de metadata configurável).

**Decisão 9 (explicitamente FORA de escopo, nomeada)**: filtro/busca por valor de metadata (ex. "listar todos os Documents com `seguradora=X`") — exigiria um GSI novo (GSI10, já reservado conceitualmente para D-194 fatia 4/5) ou scan, e não há indicação no roadmap de que isso é exigido no v1. `searchRequirements`/`searchExpirationItems` (D-194) já existem para os campos fixos; metadata configurável não ganha um índice de busca dedicado nesta fatia — mero CRUD de definição + valor, sem query por valor.

## Perguntas abertas para o Codex

1. `Decisão 2` (valor no `Document`, não no `DocumentVersion`) é a leitura certa, ou o roadmap pretende metadata por VERSÃO (ex. "valor da apólice" muda a cada renovação, deveria ficar preso à versão de evidência específica, não ao Document como um todo)? Se a leitura certa for por versão, isso muda o cap de tamanho de item (uma versão nova precisaria copiar/herdar os valores da versão anterior?).
2. O cap `MAX_DOCUMENT_TYPE_METADATA_FIELDS = 20` é arbitrário — existe um teto mais criterioso a considerar (ex. dimensionado contra o limite de 400KB por item do DynamoDB, ou contra algum precedente de cap já usado no projeto)?
