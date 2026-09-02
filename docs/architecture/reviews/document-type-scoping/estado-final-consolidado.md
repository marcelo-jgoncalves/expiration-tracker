# DocumentType — Estado Final Consolidado (D-173)

**Status: `APPROVED` (design) via protocolo Claude↔Codex, 5 rodadas (6,4 → régua 7,8/design 8,4 →
régua 9,2/design 8,5 → design 8,6 → design 9,4), régua E-014 fechada 9,2/10 (Rodada 3, estável),
design Claude 9,3/Codex 9,4, sem arredondar. DESIGN-ONLY — implementação real fica para sessão(ões)
futura(s) dedicada(s), mesmo padrão de D-121/D-127/D-136/D-139/D-143/D-163.**

Origem: item 8 da macro-ordem de D-161 (roadmap competitivo,
`docs/architecture/reviews/competitive-roadmap-reconciliation/estado-final-consolidado.md`), na
vez depois do arco `DocumentFile` fechar por completo (D-163→D-168, 100% implementado).
`Document.documentType` já é campo real e já particiona GSI2 (`documentGsi2Keys`), mas é string
livre: sem catálogo, sem CRUD, sem identidade estável. Bloqueava o item 1 (Requirement Templates),
que precisa referenciar um Document Type por identidade estável.

## Declaração E-014 (pesquisa externa)

`SIM PARCIAL` (corrigido na Rodada 2, a partir de `SIM` da Rodada 1). Fontes: GitHub REST API
Labels (`id`/`node_id` estável vs. `name` renomeável), Notion API Database properties (`id`
interno de opção de `select` separado do texto), Zendesk custom fields/ticket types (categoria
configurável como catálogo à parte do core, nunca editando o enum nativo) — todas consultadas
2026-09-02, cobrindo nichos distintos (dev-first, produtividade genérica, atendimento). As 3 fontes
confirmam **identidade estável separada de nome renomeável** como padrão convergente — não
confirmam **proteção contra exclusão física de categoria em uso** (GitHub permite deletar uma
label referenciada; a decisão de soft-state é interna deste projeto, mesma disciplina já usada em
toda a base). Layout de chave DynamoDB, tenant-scoping e mecanismo de concorrência
(`ConditionCheck`/OCC/`TenantBusinessMutation`) são decisão interna, avaliados pelo eixo padrão de
Arquitetura/Qualidade de Engenharia, não pela sub-rubrica E-014 (reancoragem da Rodada 3, o que
fechou a régua em 9,2/10).

## Decisão: catálogo `DocumentType` tenant-scoped, migração direta (sem shim de compat)

### 1. Entidade

```
PK: TENANT#<tenantId>#DOCTYPE#<documentTypeId>
SK: METADATA
documentTypeId: string       // ULID, opaco, imutável, gerado uma vez, nunca reaproveitado
displayName: string          // renomeável
status: "ACTIVE" | "DEPRECATED"
version: number               // OCC padrão
GSI1PK: TENANT#<tenantId>#DOCTYPESTATUS#<status>
GSI1SK: NAME#<normalizedName>#DOCTYPE#<documentTypeId>   // ordenação por nome normalizado
```
Reusa o índice físico GSI1 já compartilhado por Document/ExpirationItem/Requirement (namespace
próprio por prefixo, nenhum GSI novo). `documentTypeKey()` novo, espelhando `documentKey()`.

### 2. Dedupe — pointer transacional

`PK: TENANT#<tenantId>#DOCTYPENAME#<normalizedName>`, `SK: POINTER`, `documentTypeId`.
`normalizedName` via `normalizeDisplayName()` — promovido de `subject/domain/tracked-subject.ts`
para `src/shared/text/normalize-display-name.ts` (função pura, reexportada de volta para não
quebrar call sites existentes; `document-archive` importa de `shared/text/`, nunca de
`subject/**`, respeitando o boundary `dependency-cruiser` existente).

### 3. CRUD — todos migrados para a lane `TenantBusinessMutation`, fence sempre por último

- **Create**: `[0] Put(DocumentType, attribute_not_exists), [1] Put(pointer,
  attribute_not_exists), [2] fence]` — 3 entradas. O `Put` do pointer é o que fecha a corrida de
  dois criadores simultâneos com o mesmo nome normalizado.
- **Rename, nome normalizado idêntico** (só `displayName` muda): `[0] Update(DocumentType,
  expectedVersion), [1] fence]` — 2 entradas (ramo sem operação de pointer — DynamoDB rejeita
  `Delete`+`Put` no mesmo item numa `TransactWriteItems`).
- **Rename, nome normalizado muda**: `[0] Update(DocumentType, expectedVersion), [1]
  Delete(pointer antigo, condicionado a `documentTypeId=:self`), [2] Put(pointer novo,
  attribute_not_exists), [3] fence]` — 4 entradas. `CancellationReasons`: posição 0 =
  `ConflictError` (OCC), posição 1 = `ConflictError` (pointer antigo já não aponta mais para este
  tipo), posição 2 = `DocumentTypeNameConflictError` (nome destino em uso).
- **Deprecate/Reactivate**: `[0] Update(DocumentType, expectedVersion, status flip), [1] fence]`
  — 2 entradas.
- `oldNormalizedName` sempre derivado da leitura do `DocumentType` dentro da própria operação,
  nunca confiado a um valor de input externo.

RBAC: `docarchive:documenttype-{create,rename,deprecate,reactivate}` em `ADMIN_ROLES`,
`docarchive:documenttype-read` em `READ_ONLY_ROLES` — mesmo tier de `document:delete`/
`requirement:delete`.

### 4. TOCTOU de `DEPRECATED` — `ConditionCheck` transacional, não leitura-antes

`createDocument()` (`document-archive-service.ts`, hoje `putIfAbsent` solto) migra para
`executeTenantBusinessMutation`: `[0] ConditionCheck(DocumentType.status=ACTIVE), [1]
Put(Document), [2] fence]`. `CancellationReasons[0]` → `DocumentTypeNotActiveError` (nova subclasse
de `AppError`, `code: DOCUMENT_TYPE_NOT_ACTIVE`, `category: CONFLICT`, `retryable: false`).
`CancellationReasons[1]` → `ConflictError` (OCC do `Document`).

`submitEvidence()` (`guest-document-access-service.ts`, guest flow) **já usa a lane hoje** (achado
real, corrigindo uma imprecisão da Rodada 2) — 5 entradas reais confirmadas por leitura
(`Put(Document)`, `Put(DocumentVersion)`, `Put(DocumentVersionEvent)`, `Put(IdempotencyRecord)`,
`Update(DocumentRequest)`). O `ConditionCheck` novo entra na posição `[0]`, deslocando as demais:
7 posições totais incluindo a fence. **Decisão deliberada, verificada contra o `catch` real já
existente (linhas 377-390)**: nenhum mapeamento posicional granular novo é introduzido nesta
superfície — o guest flow já colapsa **qualquer** `TransactionCanceledException` numa releitura de
replay idempotente seguida de `GuestAccessInvalidError` genérico, postura anti-enumeração
deliberada e documentada no próprio serviço ("the guest never sees which [failure mode caused
this]"). `DocumentTypeNotActiveError` fica exclusiva do caminho interno autenticado
(`createDocument()`) — nunca alcança a superfície guest, por design, não por lacuna.

### 5. `Document.documentType` → `Document.documentTypeId`; GSI2 migra

Campo renomeado (não coexistência). `documentGsi2Keys()` muda a assinatura: `GSI2SK` passa de
`DOCTYPE#<documentType>#DOCUMENT#<documentId>` para `DOCTYPE#<documentTypeId>#DOCUMENT#<documentId>`
— mesmo formato físico, componente semântico trocado atomicamente, nenhum formato híbrido no
caminho.

### 6. Schema HTTP do guest flow

`schemas/api/docarchive-guest-submit-evidence-request.v1.json` — hoje `documentType` opcional,
string livre. **Na implementação desta decisão** (fora do escopo deste protocolo, mesma sequência
de D-163→D-164): `documentTypeId` passa a obrigatório, `documentType` removido
(`additionalProperties: false` já rejeita o campo antigo, fail-loud). Rota de leitura pública nova,
`GET /document-archive/guest/document-requests/{token}/document-types`, autorizada pela mesma
validação de token opaco/`GuestSession` que toda rota `document-archive-guest-handlers.ts` já usa
— **nunca** uma `Action`/RBAC nova (o guest flow inteiro nunca chama `authorize()`/
`RequestContextResolver`, confirmado por leitura do cabeçalho do arquivo).

## Achados reais do próprio protocolo (não escondidos)

- Rodada 1 ignorou um segundo writer real (`guest-document-access-service.ts`, fallback semântico
  inválido `documentType ?? requirementId`) — Rodada 2 migrou o guest flow junto.
- Rodada 1 aceitou TOCTOU de leitura-antes por analogia falsa com `Requirement`↔`Subject` — Rodada
  2 corrigiu para `ConditionCheck` transacional.
- Rodada 1 alegou um normalizador reusável que não existia — Rodada 2 promoveu o precedente real
  (`normalizeDisplayName`) para `shared/text/` sem violar boundary de módulo.
- Rodada 2 deixou `renameDocumentType()`/`CancellationReasons` de `createDocument()` subespecificados
  — Rodada 3 fechou ambos e reancorou a régua E-014 (fechando-a em 9,2/10, estável desde então).
- Rodada 3 usou linguagem de tempo presente para o schema HTTP, lida como alegação de mudança já
  aplicada ao código real — Rodada 4 corrigiu para linguagem design-only.
- Rodada 3/4 não amarraram o CRUD do catálogo (`create`/`rename`/`deprecate`/`reactivate`) à lane
  `TenantBusinessMutation` — Rodada 4 fechou com os 4 writers migrados, fence sempre por último.
- Rodada 4 errou a identidade da 4ª entrada real de `submitEvidence()` (alegou `Put(DocumentFile)`,
  é `Put(IdempotencyRecord)`) e propôs um mapeamento posicional granular que quebraria a postura
  anti-enumeração já deliberada do guest flow — Rodada 5 corrigiu ambos por leitura direta do
  `catch` real existente.
- `docarchive:documenttype-guest-read` (Rodada 3) foi identificada como mal concebida — o guest
  flow nunca chama `authorize()` — Rodada 4 removeu a `Action` RBAC em favor da mesma validação de
  token que toda rota guest já usa.

## Fora de escopo (nomeado, não escondido)

Migração/backfill de dado `dev` pré-existente com `documentType` string livre (D-093 dispensa essa
categoria de risco; `reset-dev-data.ts` resolve se necessário); ícone/cor/ordem de exibição do
tipo no catálogo (UI, não modelo de dados); tipo "default" pré-seedado por tenant novo (produto/
onboarding); limite de quantos `DocumentType`s um tenant pode criar (quota).

## Próximo passo real

Implementação em sessão futura dedicada, **primeira fatia** (mesma disciplina incremental de
D-163→D-164 — Nucleus de domínio+persistência antes de qualquer wiring HTTP novo):

1. `domain/document-type.ts` novo (`DocumentType`, `documentTypeKey()`, `normalizeDisplayName()`
   promovido para `src/shared/text/`).
2. `createDocumentType()`/`renameDocumentType()`/`deprecateDocumentType()`/
   `reactivateDocumentType()` em `document-archive-service.ts`, todos via
   `executeTenantBusinessMutation`.
3. `createDocument()` migrado para a lane com o `ConditionCheck` novo; `submitEvidence()` ganha só
   a entrada `[0]` nova, sem tocar no `catch` existente.
4. `Document.documentType`→`documentTypeId`, `documentGsi2Keys()` atualizado, todo call site
   migrado (grep antes de codar).
5. RBAC (`ACTION_ROLES`) + rotas HTTP internas do catálogo.
6. Schema HTTP do guest flow migrado + rota pública `GET .../document-types` (capability de token,
   não RBAC).

Depois de `DocumentType`, a macro-ordem de D-161 segue para o item 4 (IA/OCR no novo lifecycle de
`DocumentVersion`) ou item 1 (Requirement Templates, agora desbloqueado por ter `documentTypeId`
estável para referenciar) — ordem exata a confirmar na sessão que retomar a macro-ordem.
