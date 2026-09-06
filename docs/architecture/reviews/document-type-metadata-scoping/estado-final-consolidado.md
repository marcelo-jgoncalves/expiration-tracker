# Estado Final Consolidado — Metadata Configurável por Document Type

**Status: `APPROVED (design)` via protocolo Claude↔Codex (`AGENTS.md` §4), 4 rodadas, régua estável desde a Rodada 2 (Claude 9,2/Codex 9,1), fechamento na Rodada 4 (design Claude 9,4/Codex 9,3, ambos ≥9,0, sem arredondar).** Registrado como `docs/architecture/decisions-log.md` D-218. Evidência completa das 4 rodadas: `round1-claude-proposal.md`, `round1-codex-critique.md`, `round2-claude-revision.md`, `round2-codex-critique.md`, `round3-claude-final.md`, `round3-codex-critique.md`, `round4-claude-revision.md`, `round4-codex-critique.md`.

Fecha o item "metadata configurável [por Document Type]" do backlog P1 (`docs/project/roadmap-competitivo-2026-09-01.md`) como DESIGN — nenhum código/schema/infra tocado ainda. Item confirmado genuinamente não iniciado por D-198 (auditoria por leitura direta).

## Pesquisa externa (E-014): SIM

Fontes (consultadas 2026-09-06, representatividade: do extremo conservador — Salesforce, bloqueia/desencoraja conversão de tipo com dado existente — ao permissivo — Airtable, converte instantaneamente com perda documentada — passando por um CMS moderno com OCC de schema explícito — Contentful — e o padrão de engenharia genérico de schema evolution — Confluent/JSON Schema):

- Weissman & Bobrowski, "The Design of the Force.com Multitenant Internet Application Development Platform", ACM SIGMOD 2009.
- Salesforce Help — "Considerations for Converting the Field Type of a Custom Field".
- HubSpot Knowledge Base — "Understand property field types in HubSpot".
- Airtable Support — "Field Type overview".
- Confluent Docs — "Schema Evolution & Compatibility Types".
- Contentful Docs/Help — "Update a content type" / content modeling basics.

**Escopo**: pesquisa informa o que acontece com Documents existentes quando um admin muda/remove um campo de metadata depois de valores já gravados — a parte de risco real da decisão. Layout de PK/SK, GSI, nome de arquivo permanecem decisão interna, informada só por precedente já convergido deste projeto (`document-type.ts`, `requirement-template.ts`).

## Checklist final (régua v2, estável desde a Rodada 2 — 8 critérios, nenhum descartado)

1. (peso 20%) Definições de campo são imutáveis em `valueType` uma vez criadas.
2. (peso 15%) Um valor armazenado carrega tipo + identidade suficientes para ser interpretado/EXIBIDO sozinho, mesmo após a definição (ou uma opção) ser arquivada/renomeada.
3. (peso 15%) Arquivar/remover uma definição ou opção nunca apaga fisicamente nem corrompe valores já gravados — tombstone, nunca delete.
4. (peso 10%) Nenhuma mutação de tipo é implícita/instantânea na mesma escrita que edita a definição.
5. (peso 10%) Validação (`required`) é só prospectiva, nunca retroativa contra Document não tocado.
6. (peso 10%) Taxonomia de tipo fechada, com representação de storage inequívoca por tipo (dinheiro nunca em float, data civil vs. datetime, limites de texto).
7. (peso 12%) Toda mutação de definição/opção e toda escrita de valor é protegida por OCC/fencing transacional (stale schema, lost update).
8. (peso 8%) Opções de `SINGLE_SELECT` têm identidade estável (`optionId`), nunca a `label` crua.

## Decisão 1 — `DocumentTypeMetadataFieldDefinition` embutida em `DocumentType`

Array `metadataFields: DocumentTypeMetadataFieldDefinition[]` dentro do item `DocumentType` (mesmo padrão de `RequirementTemplate.items`, D-191) — não uma entidade separada.

```ts
export type DocumentTypeFieldValueType = "TEXT" | "NUMBER" | "DECIMAL" | "DATE" | "BOOLEAN" | "SINGLE_SELECT";
export type DocumentTypeFieldStatus = "ACTIVE" | "ARCHIVED";
export type DocumentTypeFieldOptionStatus = "ACTIVE" | "ARCHIVED";

export interface DocumentTypeFieldOption {
  optionId: string;    // ULID, imutável, nunca reusado
  label: string;        // renomeável, ≤ 200 caracteres
  status: DocumentTypeFieldOptionStatus; // nunca removida fisicamente
}

export interface DocumentTypeMetadataFieldDefinition {
  fieldId: string;              // ULID, imutável — identidade real
  name: string;                  // renomeável, ≤ 200 caracteres
  valueType: DocumentTypeFieldValueType; // IMUTÁVEL após criação (Decisão 3)
  required: boolean;             // mutável, só prospectivo (Decisão 5)
  options?: readonly DocumentTypeFieldOption[]; // só SINGLE_SELECT
  status: DocumentTypeFieldStatus; // nunca removida fisicamente do array
  createdAt: string;
  updatedAt: string;
}
```

**Caps, permanentes e absolutos (nenhum purge físico existe, por construção, nunca por promessa futura)**:
- `MAX_ACTIVE_METADATA_FIELDS = 20`, `MAX_TOTAL_METADATA_FIELD_DEFINITIONS = 100` por `DocumentType`.
- `MAX_ACTIVE_OPTIONS_PER_FIELD = 50`, `MAX_TOTAL_OPTIONS_PER_FIELD = 150` por campo `SINGLE_SELECT`.
- Exceder qualquer cap retorna 400 (mesmo padrão de `MAX_FILES_PER_VERSION`/`MAX_DOSSIER_REQUIREMENTS`/cap 30 de `RequirementTemplate` — nunca 500 opaco).
- Trade-off aceito conscientemente: um tenant que esgota o teto TOTAL (ativos+arquivados) de um `DocumentType` precisa criar um `DocumentType` novo para continuar evoluindo — sem urgência dado o volume esperado do produto e a ausência de usuário real hoje.

## Decisão 2 — Valores em `Document` (não em `DocumentVersion`), união discriminada por `valueType`

`Document.metadataValues?: Record<string /* fieldId */, DocumentMetadataValue>` — chave sempre `fieldId`, nunca `name`.

```ts
export type DocumentMetadataValue =
  | { valueType: "TEXT"; value: string /* ≤500 chars */; documentTypeVersionAtWrite: number; updatedAt: string; updatedBy: string }
  | { valueType: "NUMBER"; value: number /* inteiro, |v|<=1_000_000_000_000, NUNCA dinheiro */; documentTypeVersionAtWrite: number; updatedAt: string; updatedBy: string }
  | { valueType: "DECIMAL"; value: string /* regex ^-?\d{1,15}(\.\d{1,4})?$, dinheiro/precisão exata */; documentTypeVersionAtWrite: number; updatedAt: string; updatedBy: string }
  | { valueType: "DATE"; value: string /* YYYY-MM-DD, data civil, validação de calendário real */; documentTypeVersionAtWrite: number; updatedAt: string; updatedBy: string }
  | { valueType: "BOOLEAN"; value: boolean; documentTypeVersionAtWrite: number; updatedAt: string; updatedBy: string }
  | { valueType: "SINGLE_SELECT"; optionId: string; labelSnapshot: string /* ≤200, cópia de option.label na escrita */; documentTypeVersionAtWrite: number; updatedAt: string; updatedBy: string };
```

`documentTypeVersionAtWrite` é só rastreabilidade/auditoria — NUNCA a fonte de correção (isso vem de `valueType` imutável + `optionId` estável). `updatedAt`/`updatedBy` por valor individual, mesmo padrão de proveniência de `ExtractedField.confirmedBy`/`confirmedAt` (D-193). Semântica de update: `null` explícito remove a chave inteira (limpa o valor); campo ausente do corpo do PATCH = não tocar (update parcial de verdade).

## Decisão 3 — `valueType` imutável (ponto mais forte do design, único critério fechado por construção desde a Rodada 1)

Uma vez criado um `DocumentTypeMetadataFieldDefinition`, `valueType` nunca muda — só `name`/`required`/`options`/`status` são mutáveis. Mudar de tipo exige arquivar o campo antigo e criar um novo `fieldId` (expand-and-contract). Elimina por construção toda a classe de bug "conversão de tipo reinterpreta valor antigo" — não há operação no contrato que permita essa mutação, então não há necessidade de runtime guard para preveni-la.

## Decisão 4 — Arquivamento é tombstone, nunca delete; opções com identidade estável

Arquivar um campo/opção (`status=ARCHIVED`) nunca remove `Document.metadataValues[fieldId]` de nenhum Document existente nem o item do array `metadataFields`/`options` — só impede que NOVOS/EDITADOS valores sejam gravados sob aquele `fieldId`/`optionId` (fenced na escrita, Decisão 7). Opção referenciada por um valor existente permanece órfã-mas-inerte, nunca invalidada — o `labelSnapshot` (Decisão 2) garante exibição correta mesmo com a opção arquivada/renomeada depois.

## Decisão 5 — `required` é só prospectivo, nunca cobre `createDocument()`

`createDocument()` nunca aceita nem grava `metadataValues` — todo Document nasce com a chave ausente (sparse de verdade), independente de quantos campos `required` o `DocumentType` tiver. A única escrita de `metadataValues` é `PATCH .../metadata-values` (Decisão 7). `required=true` bloqueia (400) só uma tentativa de gravar `null` EXPLÍCITO para aquele `fieldId` quando a definição ativa correspondente é `required` — um `fieldId` ausente do corpo do PATCH nunca é validado contra `required`. Consequência aceita: um Document pode ficar indefinidamente sem valor para um campo `required` — nunca há backfill nem invalidação assíncrona/retroativa.

## Decisão 6 — RBAC

Duas actions novas em `authorization.ts` (`docarchive:update` **não existe** hoje — achado real, corrigido durante o protocolo): `docarchive:documenttype-metadata-manage` (criar/renomear/arquivar/reativar campo OU opção — `ADMIN_ROLES`, mesmo tier de `docarchive:documenttype-create`) e `docarchive:document-metadata-update` (editar valores de um Document — `WRITE_ROLES`, mesmo tier de `docarchive:create`/`docarchive:upload`). `updateDocumentMetadataValues()` reusa o MESMO fence de tenant/DocumentType-ACTIVE que `createDocument()` já usa (D-175).

## Decisão 7 — Rotas HTTP com OCC/fencing explícito (fecha a corrida TOCTOU real, achado da Rodada 1)

- `POST /document-archive/document-types/{documentTypeId}/metadata-fields` (criar campo, RBAC `docarchive:documenttype-metadata-manage`, `expectedDocumentTypeVersion` no corpo).
- `PATCH /document-archive/document-types/{documentTypeId}/metadata-fields/{fieldId}` (renomear/mudar `required`/arquivar/reativar CAMPO **e** as mutações de OPÇÃO via `optionsPatch?: Array<{op: "ADD"|"ARCHIVE"|"REACTIVATE"|"RENAME"; optionId?: string; label?: string}>` — mutação de opção é sub-operação do MESMO PATCH, MESMA `TransactWriteItems`, MESMO `expectedDocumentTypeVersion`; não é uma rota nem mecanismo de concorrência separado, já que `options` é um array aninhado dentro do mesmo item físico `DocumentType`).
- `PATCH /document-archive/documents/{documentId}/metadata-values` (RBAC `docarchive:document-metadata-update`, corpo carrega `expectedDocumentVersion`). O serviço relê fresco o `DocumentType` do Document, valida cada valor contra a definição/opção ATIVA correspondente, e grava numa ÚNICA `TransactWriteItems`: `Update` em `Document` (`ConditionExpression: version = expectedDocumentVersion`) + `ConditionCheck` em `DocumentType` (`version = <versão recém-lida>`) — fecha a corrida (cliente lê campo ativo, outro request arquiva, primeiro grava sob campo já arquivado) sem exigir que o cliente conheça a versão do `DocumentType`. `TransactionCanceledException` tratada via `isTransactionCanceled()` já existente, handler responde 409.

Todas as 3 rotas no mesmo Lambda `document-archive-handler`, mesma disciplina de `proxy-allowlist.ts` (D-117/D-120/D-178).

## Decisão 8 — Taxonomia fechada (6 tipos, cada um com representação inequívoca)

`TEXT` (string ≤500), `NUMBER` (inteiro, |v|≤1e12, nunca dinheiro), `DECIMAL` (string normalizada, regex de até 15+4 dígitos, dinheiro/precisão exata), `DATE` (YYYY-MM-DD, data civil, valida calendário real — reusa a mesma função de parsing de data já usada para `validUntil`/evidência), `BOOLEAN`, `SINGLE_SELECT` (opções com `optionId` estável). Deliberadamente distinta de `ExtractedFieldValueType` (`DATE`/`STRING`/`NUMBER`, conceito de OCR/extração) — dois contratos diferentes, nunca reusados um pelo outro.

## Decisão 9 — Busca/filtro por metadata: fora de escopo desta fatia, nomeado

Filtrar Documents por valor de metadata configurável exigiria um GSI novo (GSI10, já reservado conceitualmente para D-194 fatia 4/5) ou scan — sem indicação de que é exigido no v1. Modelagem já é compatível com indexação futura (valores sempre normalizados, nunca label cru).

## Pendências reais, nomeadas explicitamente para quem implementar

1. Nenhuma implementação de código feita ainda — este documento é só o design `APPROVED`.
2. Um tenant que esgota `MAX_TOTAL_METADATA_FIELD_DEFINITIONS=100`/`MAX_TOTAL_OPTIONS_PER_FIELD=150` não tem caminho de recuperação além de criar um `DocumentType` novo — aceito conscientemente (Decisão 1), revisitar só se um caso real de produto o exigir.
3. `documentTypeVersionAtWrite` é só auditoria — nenhum mecanismo de leitura/relatório o consome ainda; útil para debug futuro, não bloqueante.
4. Fatiamento de implementação sugerido (não normativo, a critério de quem implementar): fatia 1 = domínio + CRUD de definições (Decisões 1/3/4/6 parcial); fatia 2 = rota de valores + fencing transacional (Decisões 2/5/7); fatia 3 = rotas HTTP completas + RBAC + testes de contrato (fecha o restante da Decisão 6/7) — mesmo padrão fatiado de D-204/D-205.
