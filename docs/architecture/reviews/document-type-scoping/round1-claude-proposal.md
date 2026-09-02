# DocumentType — Rodada 1 (proposta Claude)

Origem: decisão fundacional #2 do roadmap competitivo (D-161,
`docs/architecture/reviews/competitive-roadmap-reconciliation/estado-final-consolidado.md`),
item 8 da macro-ordem, agora na vez depois do arco `DocumentFile` fechar (D-163→D-168, 100%
completo). `Document.documentType` (`document.ts:20`) já é campo real e já particiona GSI2
(`documentGsi2Keys`, `document.ts:56-61`) — mas é string livre: sem catálogo, sem CRUD, sem
identidade estável. Bloqueia o item 1 (Requirement Templates), que precisa referenciar um Document
Type por identidade estável, não por string solta sujeita a typo/case/rename ambíguo.

## Classificação de risco

Nível 5 (`change-risk-scale.md`): entidade nova + muda a chave de GSI2 (hoje particionada por
`documentType` string, `documentGsi2Keys`) + fronteira de módulo nova (catálogo com seu próprio
CRUD). Não é nível 6 — não é nova stack, nem novo domínio de dado sensível/terceiro com PII; é
mudança de modelo de dados dentro de um domínio já `APPROVED` (Document Archive, D-143). Protocolo
Claude↔Codex completo obrigatório, mínimo 3 rodadas, gate 9,0/9,0 sem arredondar.

## Declaração E-014 (pesquisa externa)

`SIM`. "Catálogo de tipos/categorias configurável, com identidade estável e nome exibido
renomeável, com um mecanismo de aposentar um tipo sem quebrar registros existentes que já o
referenciam" é exatamente o tipo de padrão que produtos estabelecidos já resolveram de forma
convergente — não há decisão aqui que dependa só do nosso próprio modelo de dados interno (a
única parte genuinamente interna é o layout de chave DynamoDB em si, tratado como implementação
do padrão, não como o padrão).

Fontes consultadas (2026-09-02):
- GitHub REST API — Labels (`https://docs.github.com/en/rest/issues/labels`): cada label tem um
  `id`/`node_id` numérico estável, distinto do campo `name` (renomeável via `PATCH`). Confirma
  identidade estável ≠ nome exibido como padrão de referência, não é peculiaridade de um único
  vendor.
- Notion API — Database properties / select options
  (`https://developers.notion.com/reference/update-property-schema-object`,
  `https://developers.notion.com/reference/database-properties`): opções de propriedade `select`
  carregam um `id` interno estável separado do texto da opção; a API não permite renomear uma
  opção existente por update parcial sem preservar essa identidade — reforça o padrão de
  identidade nunca-reaproveitada.
- Zendesk — custom ticket fields / ticket types
  (`https://support.zendesk.com/hc/en-us/articles/4408838961562-About-custom-fields-and-custom-field-types`,
  `https://support.zendesk.com/hc/en-us/articles/4408881729434-How-can-I-add-additional-ticket-type-options`):
  confirma que o campo `type` nativo do Zendesk **não é** editável pelo tenant — produtos reais
  frequentemente resolvem "categoria configurável" com um catálogo de **campo customizado**
  paralelo ao core, não editando o enum nativo. Relevante porque valida a decisão abaixo de tratar
  `DocumentType` como catálogo tenant-scoped à parte, nunca um enum global do código.

Representatividade: as 3 fontes cobrem fluxo de desenvolvedor (GitHub), produtividade/dados
genéricos (Notion) e atendimento/suporte (Zendesk) — nichos distintos, todos convergindo no mesmo
par identidade-estável+nome-renomeável e nenhum permitindo apagar fisicamente uma categoria em uso
(sempre soft-state: label pode ficar não-atribuída mas issues antigas mantêm a referência por id;
Zendesk marca campos como inativos, nunca exclui um campo referenciado por tickets existentes).
Nenhuma das 3 fontes resolve "tenant-scoped vs. catálogo global" de forma útil (todas já são
inerentemente por-workspace/conta) — essa sub-decisão é tratada como interna abaixo (já decidida
por precedente deste projeto: todo dado é tenant-scoped, ver `PK=TENANT#...` em toda entidade
existente, nenhuma ambiguidade real a resolver).

### Checklist de critérios de nota (subordinado a `joint-review-criteria.md`, eixo Arquitetura/Modelo de Dados)

1. (peso 30%) **Identidade nunca muda, nome sempre pode mudar** — `documentTypeId` é opaco e
   imutável desde a criação; renomear (`displayName`) nunca gera um id novo nem invalida
   referências existentes (`Document.documentTypeId`, futuro `RequirementTemplate`).
2. (peso 25%) **Nenhuma exclusão física de um tipo referenciado** — só soft-state
   (`ACTIVE`↔`DEPRECATED`); um tipo `DEPRECATED` continua resolvendo GET/leitura para todo
   `Document` existente que o referencia, só fica indisponível para **novas** atribuições.
3. (peso 20%) **Dedupe determinístico de nome dentro do tenant, sem corrida** — duas criações
   concorrentes com o mesmo `displayName` (normalizado) nunca resultam em dois `documentTypeId`
   coexistindo para o "mesmo" tipo; mecanismo transacional, não validação de leitura-antes.
4. (peso 15%) **GSI2 migra sem ambiguidade** — a troca de partição de `documentType` (string) para
   `documentTypeId` (estável) é decidida explicitamente, sem formato híbrido/ambíguo no meio do
   caminho.
5. (peso 10%) **Setup limpo para o item 1 (Requirement Templates)** — a forma de referência
   (`documentTypeId`) é diretamente reusável por uma entidade `RequirementTemplate` futura sem
   adaptação.

## Decisão: catálogo `DocumentType` tenant-scoped, nova entidade, migração direta (sem shim de compat)

Lembrete de calibração (D-093, `AGENTS.md` §1): sem usuário real nem produção, dado `dev`
resetável — a migração de `Document.documentType` (string) para `Document.documentTypeId`
(estável) é feita **direto**, sem período de coexistência dos dois campos nem shim de leitura
dupla. `npm run reset-dev-data` (D-110/D-111) já existe como mecanismo de reseed caso o dado
sintético precise ser recriado pós-mudança de schema.

### 1. Entidade `DocumentType`

Mesma partição-família de Document/Version/Event/File (`TENANT#<t>#...`), mas namespace próprio —
não é uma sub-entidade de um `Document` específico, é catálogo do tenant inteiro:

```
PK: TENANT#<tenantId>#DOCTYPE#<documentTypeId>
SK: METADATA
entityType: "DocumentType"
documentTypeId: string       // ULID, gerado na criação, opaco, nunca reaproveitado
tenantId: string
displayName: string          // renomeável
status: "ACTIVE" | "DEPRECATED"
createdAt / updatedAt: string (ISO)
version: number              // OCC padrão (occ.ts)
GSI1PK: TENANT#<tenantId>#DOCTYPESTATUS#<status>
GSI1SK: NAME#<displayName>#DOCTYPE#<documentTypeId>
```

Reusa o **mesmo índice físico GSI1** já compartilhado por Document/ExpirationItem/Requirement
(discriminado por prefixo `DOCTYPESTATUS#`, mesmo padrão que `DOCSTATUS#`/`REQSTATUS#` já usam —
nenhum GSI novo). Ordenação por `displayName` dentro do namespace permite listagem alfabética
direto do índice para a tela de administração do catálogo, sem sort em memória.

`documentTypeKey(tenantId, documentTypeId)` novo em
`src/modules/document-archive/domain/document-type.ts`, espelhando `documentKey()`.

### 2. Dedupe de nome — pointer transacional, mesmo padrão de `InvitationTokenPointer`/membership invite dedupe

```
PK: TENANT#<tenantId>#DOCTYPENAME#<normalizedName>
SK: POINTER
documentTypeId: string
```

`normalizedName` = `displayName.trim().toLowerCase()` (mesma normalização que já existe em
`request-context`/`organization` para nomes de exibição — verificar por leitura antes de
implementar, reusar a função existente em vez de duplicar). Criação de `DocumentType` é uma
`TransactWriteItems` de 2 itens: `Put DocumentType` (`attribute_not_exists(PK)`) + `Put pointer`
(`attribute_not_exists(PK)`) — a condição do pointer é o que fecha a corrida de dois criadores
simultâneos com o mesmo nome (item 3 do checklist); o segundo perde a transação inteira
(`ConflictError` mapeado de `TransactionCanceledException`, mesmo padrão de sempre).

**Rename**: `TransactWriteItems` de 3 itens — `Update DocumentType` (`buildVersionedUpdate`,
`expectedVersion`, seta `displayName`+`updatedAt`, também reescreve `GSI1SK` para o novo
`displayName`) + `Delete` do pointer antigo (condicionado a apontar para este `documentTypeId`,
fecha corrida com uma segunda rename concorrente) + `Put` do pointer novo
(`attribute_not_exists(PK)`, fecha corrida com um nome já em uso por outro tipo, incluindo um
rename concorrente de terceiro tipo para o mesmo nome-alvo).

### 3. CRUD — RBAC

Novas actions em `authorization.ts`, seguindo o precedente já existente de
`ACTION_ROLES`/`ADMIN_ROLES` (`authorization.ts:164`, mesmo tier de `membership:invite`,
`document:delete`, `requirement:delete` — configuração de recurso do tenant, não comunicação
externa/config crítica que justificaria `OWNER_ROLES` como `organization:close`/
`organization:update-settings`):

```
"docarchive:documenttype-create": ADMIN_ROLES
"docarchive:documenttype-rename": ADMIN_ROLES
"docarchive:documenttype-deprecate": ADMIN_ROLES
"docarchive:documenttype-reactivate": ADMIN_ROLES
"docarchive:documenttype-read": READ_ONLY_ROLES
```

**Deprecação** (não exclusão física — item 2 do checklist): `Update DocumentType`
(`buildVersionedUpdate`, `status: ACTIVE→DEPRECATED`, reescreve `GSI1PK` para o namespace
`DOCTYPESTATUS#DEPRECATED`). Nenhuma condição sobre `Document`s existentes que o referenciam — um
tipo `DEPRECATED` continua um FK válido para leitura, só some da lista de tipos elegíveis para
**nova** atribuição (`createDocument()`/futuro `RequirementTemplate` validam
`status=ACTIVE` no momento da escolha, nunca depois). Reativação é o Update simétrico inverso.

### 4. `Document.documentType` → `Document.documentTypeId`

`document.ts`: campo renomeado (não campo novo coexistindo) — `documentType: string` vira
`documentTypeId: string`, valor é o `documentTypeId` do catálogo, nunca mais uma string livre.
`CreateDocumentInput.documentType` idem. `createDocument()` valida a referência antes de montar a
transação (`GetItem` no `DocumentType`, `status=ACTIVE`) — se ausente ou `DEPRECATED`, erro de
validação (`AppError` subclass existente de not-found/invalid-reference, reusar a taxonomia já
existente, nunca criar uma nova). Isto é validação de leitura-antes (não uma
`TransactWriteItems` cross-entity com o catálogo) porque `DocumentType` nunca é escrito pela
mesma operação que cria um `Document` — janela de corrida (tipo deprecado entre o `GetItem` e o
`Put` do Document) é aceitável: pior caso é um `Document` novo apontando para um tipo que acabou
de ser deprecado por um admin no mesmo instante, leitura permanece válida (item 2 do checklist já
garante isso), só a UX de "não deveria ter sido oferecido" fica levemente estale — não é uma
invariante transacional que o projeto já trate dessa forma em nenhum outro lugar (ex. `Requirement`
referenciando `Subject` também é validação de leitura-antes, não uma transação cross-entity).

### 5. GSI2 — migra de string para `documentTypeId`

`documentGsi2Keys()` (`document.ts:56-61`) muda a assinatura: `documentType: string` vira
`documentTypeId: string`. `GSI2SK` passa de `DOCTYPE#<documentType>#DOCUMENT#<documentId>` para
`DOCTYPE#<documentTypeId>#DOCUMENT#<documentId>` — mesmo formato físico, componente semântico
trocado (item 4 do checklist: nenhum formato híbrido, a troca é atômica dentro desta decisão,
nunca duas gerações de chave coexistindo). Todo call site de `documentGsi2Keys()` (busca no
código antes de implementar — grep confirma hoje só `document-archive-service.ts`) atualizado na
mesma mudança.

### 6. Setup para item 1 (Requirement Templates)

`RequirementTemplate` (greenfield, ainda não desenhado) referencia `documentTypeId: string`
diretamente — mesma identidade que `Document` já usa, nenhuma tradução/adaptação necessária
quando aquela rodada abrir (item 5 do checklist).

## Fora de escopo (nomeado, não escondido)

- Migração/backfill de dado `dev` pré-existente com `documentType` string livre — D-093 dispensa
  essa categoria de risco; se necessário, `reset-dev-data.ts` (D-110/111) já resolve.
- Ícone/cor/ordem de exibição do tipo no catálogo (decisão de UI, fora do modelo de dados desta
  rodada — pode ser campo aditivo futuro sem quebrar nada aqui).
- Tipo de documento "default" pré-seedado por tenant novo (decisão de produto/onboarding, não
  modelo de dados).
- Limite de quantos `DocumentType`s um tenant pode criar (quota — fora do escopo de identidade).

## Próximo passo

Rodada 2: crítica do Codex via `codex exec`.
