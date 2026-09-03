# RequirementTemplate — Estado final consolidado (`APPROVED`)

**Status: `APPROVED` via protocolo Claude↔Codex (`AGENTS.md` §4), 4 rodadas reais (`codex exec`),
nota cega por rodada:**

| Rodada | Claude (régua / design) | Codex (régua / design) |
| --- | --- | --- |
| 1 | — / 8,2 | 6,4 / 6,6 |
| 2 | 9,2 / 9,1 | 8,3 / 8,1 |
| 3 | 9,4 / 9,3 | 8,8 / 8,7 |
| 4 | **9,4 / 9,3** | **9,1 / 9,0** |

Fechamento: ambos ≥9,0 nas duas dimensões, sem arredondar. Régua contestada na Rodada 1 e
reconciliada em 4 versões (`research-protocol.md`, fluxo de reconciliação) — a nota da régua e a
do design ficam só nos artefatos de rodada, o `decisions-log.md` registra só a nota final.

Declaração E-014: **`SIM PARCIAL`** — ver `round1-claude-proposal.md` para as 5 fontes com data de
acesso (Drata, Vanta, Asana, Atlassian, HighLevel) e a justificativa de representatividade.
Padrão convergente encontrado: **materialização por cópia (snapshot) no momento da aplicação,
nunca live-link com propagação**. Divergência registrada: prevenção de duplicidade na aplicação
não tem padrão externo — desenhada internamente.

Checklist final (régua v4, sub-rubrica descartada após esta decisão fechar): C1 decisão de
duplicidade declarada 10% · C2 orçamento em ações e bytes 20% · C3 consistência transacional de
todo objeto participante, em todo caminho de escrita 25% · C4 semântica de aplicação 10% ·
C5 honestidade e completude do plano 15% · C6 reuso interno 5% · C7 classificação de cancelamento
15%.

---

## 1. Escopo

Entidade-alvo: **`Requirement`** (`src/modules/document-archive/domain/requirement.ts`, D-143/D-145),
NÃO a legada `RequirementAssignment` (`src/modules/subject/`), que fica intocada. Justificativa em
`round1-claude-proposal.md` §"Escopo confirmado por leitura direta".

## 2. Entidades novas

```text
RequirementTemplate
  PK   TENANT#<tenantId>#REQTEMPLATE#<templateId>
  SK   METADATA
  entityType "RequirementTemplate"
  templateId, tenantId, displayName, description?
  status "ACTIVE" | "ARCHIVED"
  items: RequirementTemplateItem[]        // embutido, máx. 30
  createdAt, updatedAt, version
  GSI1PK  TENANT#<tenantId>#REQTEMPLATESTATUS#<status>
  GSI1SK  NAME#<normalizedName>#REQTEMPLATE#<templateId>

RequirementTemplateItem (valor puro, sem linha própria)
  templateItemId, name, notes?, applicability, position

RequirementTemplateNamePointer
  PK   TENANT#<tenantId>#REQTEMPLATENAME#<normalizedName>
  SK   POINTER

RequirementNamePointer                     // decisão D-3': nome único por Subject
  PK   TENANT#<tenantId>#SUBJECT#<subjectId>#REQNAME#<normalizedName>
  SK   POINTER
  requirementId, tenantId, subjectId, normalizedName, createdAt, updatedAt, version
```

Zero GSI novo (namespaces por prefixo no GSI1 já existente). Campos de proveniência opcionais em
`Requirement`: `sourceTemplateId?`, `sourceTemplateItemId?`, `sourceTemplateAppliedVersion?` —
**nenhum caminho de leitura, derivação ou worker os consulta**.

`documentTypeId` no item de template foi **removido** (Codex R1 achado 11): campo morto até o
item 6 do arco D-173 (`Requirement → DocumentType`) ter semântica própria.

## 3. Decisão de produto — `Requirement.name` é único por Subject

Decisão deliberada (não consequência lógica da entidade — enquadramento corrigido pelo Codex R2
achado 6). Consequências declaradas: homônimos com `notes`/`applicability` diferentes são
inválidos; NOT_APPLICABLE reserva o nome; não existe estado "arquivado" para `Requirement`
(`deleteRequirement` é `Delete` físico, verificado), logo apagar libera o nome; renomear pode
colidir (409, mesmo comportamento de `renameDocumentType`). **Gatilho de reversão nomeado**: se a
distinção período/jurisdição precisar ser estrutural (campo `period`), ela entra na chave do
ponteiro — evolução da chave, não reversão da regra.

Escritores de `Requirement` verificados por grep: `createRequirement`, `updateRequirement`,
`linkEvidence`, `unlinkEvidence`, `deleteRequirement` (todos em `document-archive-service.ts`) e o
worker `requirement-reindex` (só flip de `status`). `src/modules/import/` **não** escreve esta
entidade. `linkEvidence`/`unlinkEvidence` não tocam `name` e ficam intocados.

## 4. Transação do `applyTemplate` (contrato exato)

```text
N   × Put(Requirement,             attribute_not_exists)
N   × Put(RequirementNamePointer,  attribute_not_exists)
1   × ConditionCheck(RequirementTemplate: #status = :active AND #version = :expectedVersion)
1   × ConditionCheck(TrackedSubject:      attribute_exists(PK) AND #status = :active)
1   × fence de tenant ACTIVE (acrescentado por executeTenantBusinessMutation, sempre por último)
= 2N + 3
```

Cap **30 itens**: o pior caso previsto `3N + 3` (um evento de auditoria por `Requirement` criado —
lacuna conhecida deste módulo, não compromisso desta fatia) impõe teto `N ≤ 32`; 30 é a escolha
operacional abaixo do teto, com 7 ações de margem. **Não é um valor derivado matematicamente.**

`TrackedSubjectStatus` é `ACTIVE | ARCHIVED | DELETED` (verificado) — a condição enumera
`= ACTIVE`, nunca `<> DELETED`, que deixaria `ARCHIVED` passar.

`expectedTemplateVersion` é opcional no request: se informado (vindo do preview), é ele que entra
no `ConditionCheck`; se ausente, usa a versão lida no próprio apply.

## 5. Orçamento em bytes

Limites em **bytes UTF-8** (não caracteres), validados no serviço via `Buffer.byteLength`:
`name` ≤ 200 · `notes` ≤ 2000 · `displayName` ≤ 200 · `description` ≤ 2000. O `maxLength` do JSON
Schema (code points) é a primeira barreira barata; a barreira que decide é a de bytes.

`estimateDynamoItemBytesUpperBound()` é um **limite superior comprovado**, nunca uma medição
exata: `byteLength(nome) + valueBytes(valor) + 4` por atributo; string = bytes UTF-8; number = 21
(pior caso); lista = `3 + Σ(1 + elemento)`; mapa = `3 + Σ(byteLength(chave) + 1 + valor)`;
boolean/null = 1; **tipo não coberto lança** (condição do Codex R4 — sem isso o "comprovadamente
superior" não vale genericamente). Teste-sentinela falha acima de 200 KB (contra 400 KB de limite
duro). Limite superior calculado do pior caso: template ≈ 73 KB, transação inteira ≈ 79 KB
(contra 4 MB).

## 6. Operações e rotas

| Operação | Semântica fechada |
| --- | --- |
| create | Put template + Put pointer + fence |
| get / list | `queryIndexPage` GSI1 `REQTEMPLATESTATUS`, `?status=` default ACTIVE |
| update | OCC; rename com 2 ramos de ponteiro; substitui `items` inteiro; **409 se ARCHIVED** |
| duplicate | novo `templateId` e **novos `templateItemId`**; permitido a partir de um ARCHIVED |
| archive / unarchive | flip com fence FROM-status; nunca delete físico |
| preview | leitura pura; devolve `templateVersion` para o apply |
| apply | uma `TransactWriteItems`; **zero criáveis = 200**, não conflito (reaplicar é idempotente); 409 se ARCHIVED; devolve `created: [{templateItemId, requirementId, name}]` |

Nomes duplicados **dentro** do template: **400** na escrita do template
(`assertTemplateItemNamesUnique`, chamado por create/update/duplicate **e** pelo planejador) —
nunca no apply. Sem isso, dois `Put` sobre a mesma chave de ponteiro numa transação produziriam
`ValidationException` (500 opaco) em vez do 409 de domínio (Codex R1 achado 5).

```text
POST   /document-archive/requirement-templates
GET    /document-archive/requirement-templates
GET    /document-archive/requirement-templates/{templateId}
PATCH  /document-archive/requirement-templates/{templateId}
POST   /document-archive/requirement-templates/{templateId}/duplicate
POST   /document-archive/requirement-templates/{templateId}/archive
POST   /document-archive/requirement-templates/{templateId}/unarchive
POST   /document-archive/requirement-templates/{templateId}/preview
POST   /document-archive/requirement-templates/{templateId}/apply
```

RBAC: `docarchive:requirementtemplate-{create,update,duplicate,archive,unarchive}` = `ADMIN_ROLES`;
`-read` = `READ_ONLY_ROLES`; `-apply` = as mesmas roles de `docarchive:requirement-create`.

## 7. Plano — honestidade declarada

`planTemplateApplication(items, existing)` é puro (sem I/O, sem relógio), com **uma implementação
e dois call sites** (preview e apply). Contrato declarado:

- Preview e apply **não podem divergir algoritmicamente; podem divergir temporalmente.**
- `skip` significa *"observado como duplicado durante o planejamento"* — **não é protegido
  transacionalmente**; `create` é. Um skip obsoleto custa um requisito a menos criado, nunca
  duplicata nem dado corrompido.
- A leitura do plano é **completa**: `queryByPk` esgota `LastEvaluatedKey` num `do/while`
  (verificado em `dynamodb-document-archive-store.ts` linhas 80-100).
- A leitura é **eventually consistent** (`queryByPk` não usa `ConsistentRead`): um `Requirement`
  criado concorrentemente pode não aparecer no plano e causar cancelamento total em vez de skip.
  Aceito e declarado — *reaplicar é seguro e, quando a leitura convergir, o item será pulado.*

## 8. Classificação de cancelamento

O montador devolve `{ entries, labels }`; `labels[i]` descreve a ação `i`
(`REQUIREMENT | POINTER | TEMPLATE_FENCE | SUBJECT_FENCE`, com `templateItemId`/`name`). Toda
posição `ConditionalCheckFailed` é coletada (pode haver várias). Precedência, da pré-condição mais
ampla para a mais específica: `TEMPLATE_FENCE` → `SUBJECT_FENCE` → `POINTER` (409 nomeando **todos**
os nomes colidentes) → `ConflictError` genérico. Índice `>= labels.length` cai no genérico.

**Nenhum erro afirma causa que o DynamoDB não revelou.** A falha do `ConditionCheck` composto do
template produz um único `TemplatePreconditionFailedError`; a do Subject, um único
`SubjectPreconditionFailedError` — nunca um 404/409 escolhido por releitura posterior. O 404 de
"Subject inexistente" só existe no caminho de leitura, onde é observação direta.

Acoplamento declarado com a lane compartilhada: `executeTenantBusinessMutation` acrescenta o fence
**sempre por último** e converte a falha dele em `TenantNotActiveError` antes do caller (verificado,
`tenant-business-mutation.ts` linhas 183-226), então `labels` cobre todo o espaço que resta
classificar.

## 9. Achado pré-existente registrado, deliberadamente fora do escopo

**Fallback causal da `TenantBusinessMutation` lane.** `tenant-business-mutation.ts` linhas 213-223:
`CancellationReasons` ausente ou malformado é classificado como `TenantNotActiveError`
(`fenceFailed = !Array.isArray(rawReasons) || fenceReasonCode === undefined || ...`), afirmando uma
causa que o DynamoDB não revelou. Sob o critério C7 desta decisão, o fallback correto seria um
`ConflictError` genérico/indeterminado. **Não corrigido aqui** por ser mudança de comportamento de
uma lane compartilhada por todos os escritores tenant-scoped (nível 3-4, fatia própria) —
introduzida deliberadamente pelo hardening D-072 item 4.

- **Identificador**: achado `RT-LANE-FALLBACK-01`.
- **Dono/próximo passo concreto**: uma fatia própria de nível 3-4 em
  `src/shared/tenant-lifecycle/tenant-business-mutation.ts`, a ser aberta pela próxima sessão que
  tocar essa lane, com teste adversarial que injeta `CancellationReasons` ausente e exige
  `ConflictError` em vez de `TenantNotActiveError`. Mesma disciplina de D-177→D-178 e D-183.

Nenhum erro desta fatia afirma "o fence comprovadamente não foi a causa".

## 10. Implantação

`scripts/backfill-requirement-name-pointers.ts`, idempotente, com o guard
`fileURLToPath(import.meta.url) === process.argv[1]` (bug real de D-186 — o guard antigo nunca casa
no Windows/Git Bash deste ambiente). Estabelece a baseline de ponteiros em `dev`; não é "migração
de risco" (não há produção nem usuário real, `AGENTS.md` §1).
