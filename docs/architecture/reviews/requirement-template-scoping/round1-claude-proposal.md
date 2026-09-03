# RequirementTemplate — Rodada 1 (proposta Claude)

Escopo: item P0.1 do `docs/project/roadmap-competitivo-2026-09-01.md` ("Requirement Templates"):
criação, edição, duplicação, arquivamento, preview e aplicação a Subjects com prevenção de
duplicidade óbvia. Nível 5-6 de `change-risk-scale.md` (modelo de dados novo + entidade nova
+ operação de fan-out transacional) — protocolo `AGENTS.md` §4 obrigatório.

## Pesquisa externa considerada

`SIM PARCIAL` (fontes abaixo; escopo: **semântica de aplicação de template** — snapshot vs.
live-link, propagação de edição posterior, arquivamento vs. deleção, duplicação como operação
de primeira classe — é informada por padrão externo estabelecido. **Layout de chave DynamoDB,
escolha de GSI, forma da transação, nomes de action de RBAC** são decisão puramente interna,
já fechada por precedente convergido deste repo — `document-type.ts`/D-173 e
`AGENTS.md` §7; nenhuma pesquisa de mercado escolheria entre `TENANT#t#REQTEMPLATE#id` e um
layout equivalente.)

Fontes (consultadas 2026-09-03):

- Drata Help Center — "Essential Policy FAQs" / "Create a policy"
  (https://help.drata.com/en/articles/10414305-essential-policy-faqs-your-quick-guide,
  https://help.drata.com/en/articles/13550137-create-a-policy): a Drata atualiza seus
  *policy templates* periodicamente, mas **"will never modify your policies without your
  involvement and will always notify you in advance"** — ou seja, o template aplicado é uma
  cópia; a evolução do template não propaga para a instância derivada, notificação substitui
  propagação.
- Vanta Help Center — "Creating a custom policy"
  (https://help.vanta.com/en/articles/11345492-creating-a-custom-policy): política derivada de
  template vira um objeto próprio, com testes/mapeamentos próprios — não um ponteiro para o
  template.
- Asana — "Issue Log Template" (https://asana.com/templates/issue-log) e fórum de produto
  ("Allowing for duplicating of Project Templates",
  https://forum.asana.com/t/allowing-for-duplicating-of-project-templates/161288): o fluxo
  canônico é **duplicar o template no início de cada projeto**; duplicação de template é pedido
  recorrente de produto, ou seja, é operação de primeira classe esperada, não acessório.
- Atlassian Community — "Issue Templates in Jira: Guide 2026"
  (https://community.atlassian.com/forums/App-Central-articles/Issue-Templates-in-Jira-Guide-2026/ba-p/3034243):
  o mecanismo nativo é `Clone` (cópia independente); hierarquias reutilizáveis salvas como
  template são materializadas por cópia.
- HighLevel — "Snapshots Overview"
  (https://help.gohighlevel.com/support/solutions/articles/48000982511-snapshots-overview):
  snapshots são "designed for configuration reuse, **not for moving live customer records**" —
  a fronteira entre catálogo de configuração e dado operacional é explícita no produto.

**Representatividade**: a amostra cobre dois nichos distintos e complementares — compliance/GRC
(Drata, Vanta), que é o nicho funcional *exato* deste produto (conjuntos reutilizáveis de
requisitos documentais/evidência), e produtividade/PM genérico (Asana, Jira, HighLevel), que é
onde o padrão "template → instância" tem o maior volume de uso real. Isso reduz viés de nicho
único e evita concluir a partir de um vendor só. **Padrão convergente encontrado**: todos os
cinco materializam por CÓPIA no momento da aplicação; nenhum mantém live-link com propagação
automática. **Divergência encontrada**: prevenção de duplicidade na aplicação é fraca ou
inexistente em todos (o Asana explicitamente *não* permite dedupe/duplicação dentro de
template) — aqui não há padrão externo para copiar, e o roadmap P0.1 pede explicitamente
"prevenção de duplicidade óbvia", então essa sub-decisão é desenhada internamente e julgada
pelos critérios 2 e 6 abaixo, não por conformidade com mercado.

## Checklist de critérios pesados (sub-rubrica desta decisão, subordinada a `joint-review-criteria.md`)

1. **(25%) Snapshot no apply, nunca live-link.** Atende: aplicar um template COPIA o conteúdo
   para `Requirement` novos; nenhuma edição posterior do template altera um `Requirement` já
   criado; a proveniência gravada é rastro, nunca dependência de leitura. Não atende: qualquer
   caminho em que ler/derivar um `Requirement` precise ler o template.
2. **(20%) Prevenção de duplicidade transacional, não read-then-write.** Atende: duas
   aplicações concorrentes do mesmo template ao mesmo Subject não podem ambas criar o mesmo
   requisito — a colisão é resolvida por `ConditionalCheckFailed` numa condição real, não por
   uma leitura prévia. Não atende: dedupe só por `if (existing.find(...))` antes do write.
3. **(15%) Mutação in-place + arquivamento, sem histórico de versões do template.** Atende:
   template é editável com OCC e arquivável/desarquivável, nunca deletado fisicamente;
   nenhuma máquina de versionamento de template é introduzida. Não atende: introduzir
   versionamento/branching de template sem um access pattern real que o exija
   (`principles.md` #1, proporcionalidade) — nenhuma das 5 fontes versiona template de checklist.
4. **(15%) Preview e apply compartilham UMA função pura de planejamento.** Atende: existe uma
   função pura `planTemplateApplication(items, existingRequirements)` sem I/O, e tanto o
   preview quanto o apply a chamam — preview não pode divergir do apply por construção.
   Não atende: duas implementações paralelas da mesma regra de dedupe.
5. **(15%) Reuso de padrão interno já convergido, sem mecanismo novo.** Atende: ponteiro de
   dedupe por nome normalizado (D-173/D-174), namespace por prefixo no GSI1 já existente
   (`documentTypeGsi1Keys`/`requirementGsi1Keys`), `executeTenantBusinessMutation` para o fence
   de tenant, builders de `occ.ts` em toda escrita, `normalizeDisplayName()` compartilhado.
   Não atende: GSI novo, ou uma segunda convenção de catálogo divergente de `DocumentType`.
6. **(10%) Apply é atômico e limitado por construção.** Atende: o número máximo de itens de um
   template é escolhido de modo que a transação do apply (N requisitos + N ponteiros + fence)
   caiba com folga no limite de 100 ações de `TransactWriteItems`, e esse limite é uma
   invariante documentada, não um acidente. Não atende: apply particionado em várias
   transações (parcialmente aplicado observável) ou cap não justificado.

## Escopo confirmado por leitura direta do código (não presumido)

- Existem HOJE **duas** entidades de requisito: a legada `subject/domain/requirement-assignment.ts`
  (`RequirementAssignment`, M9, ciclo MISSING↔SATISFIED por link manual de `ExpirationItem`) e a
  moderna `document-archive/domain/requirement.ts` (`Requirement`, D-143/D-145 — `applicability`
  persistida, `status` derivado por `deriveRequirementStatus`, evidência via `DocumentVersion`,
  GSI1 `REQSTATUS`, GSI8 `REQUIREMENT_REINDEX`).
- **Decisão de escopo (D-0)**: o template materializa `Requirement` (document-archive), NÃO
  `RequirementAssignment`. Motivos reais: (a) é a entidade que o resto do arco P0 usa
  (guest upload, requests, recorrência, `DocumentType`); (b) é a única com `applicability` e
  derivação de status, que é o que um item de template precisa carregar; (c) o próprio
  `requirement-assignment.ts` declara que `RequirementTemplate` fica "deferido por completo" e
  seu `requirementDefinitionId?` é só escape hatch — não um contrato a honrar.
  `RequirementAssignment` fica intocado por esta decisão.
- `DocumentType` (D-173/D-174/D-177) já entrega o padrão exato a espelhar: entidade de catálogo
  tenant-scoped, ponteiro de dedupe por nome normalizado, flip de status com fence FROM-status,
  6 rotas HTTP, RBAC, schemas + testes de contrato.

## Decisões propostas

### D-1. Forma da entidade — itens EMBUTIDOS, não linhas próprias

`RequirementTemplate` (PK `TENANT#<t>#REQTEMPLATE#<templateId>`, SK `METADATA`):

```text
entityType: "RequirementTemplate"
templateId, tenantId
displayName (renomeável), description?
status: "ACTIVE" | "ARCHIVED"
items: RequirementTemplateItem[]     // EMBUTIDO
createdAt, updatedAt, version
GSI1PK = TENANT#<t>#REQTEMPLATESTATUS#<status>
GSI1SK = NAME#<normalizedName>#REQTEMPLATE#<templateId>
```

`RequirementTemplateItem` (valor puro, sem chave própria na tabela):

```text
templateItemId: string   // ULID, estável através de edições e de duplicação NÃO reusado
name: string
notes?: string
applicability: RequirementApplicability   // default APPLICABLE
documentTypeId?: string   // link opcional ao catálogo D-173, NÃO validado no apply (ver D-6)
position: number
```

Por que embutido e não uma coleção `TENANT#t#REQTEMPLATE#id`/`ITEM#<itemId>`: um template é
lido e editado como uma unidade em 100% dos access patterns desta decisão (preview, apply,
edição, duplicação) — coleção só pagaria fan-out de leitura e um problema de consistência
entre linhas sem nenhum ganho. O `version` do próprio template já é o OCC da lista inteira.
Cap de **40 itens** por template (D-5, critério 6): 40 requisitos + 40 ponteiros + 1 fence = 81
ações, dentro do limite duro de 100 de `TransactWriteItems` com folga real para a evolução da
transação. Um checklist de regularidade documental do exemplo do roadmap tem 5 itens; 40 é
generoso, não restritivo.

`RequirementTemplateNamePointer` (PK `TENANT#<t>#REQTEMPLATENAME#<normalizedName>`, SK
`POINTER`) — cópia exata do mecanismo de `DocumentTypeNamePointer` (D-173 §2): garante nome de
template único por tenant contra dois criadores concorrentes e contra um rename que aterrissa
num nome em uso.

### D-2. Semântica de aplicação — snapshot, com proveniência não-autoritativa

`applyTemplate(ctx, templateId, subjectId)` COPIA cada item elegível para um `Requirement` novo,
com exatamente a mesma forma que `createRequirement()` já produz (mesmo `deriveRequirementStatus`,
mesmo `requirementGsi1Keys`, mesmo `requirementGsi8Fields`) — o `Requirement` resultante é
indistinguível de um criado à mão, exceto por três campos novos, opcionais, puramente de rastro:

```text
sourceTemplateId?: string
sourceTemplateItemId?: string
sourceTemplateAppliedVersion?: number   // a `version` do template NO MOMENTO do apply
```

Invariante (critério 1): **nenhum caminho de leitura, derivação ou worker consulta esses
campos**. Editar/arquivar/duplicar/deletar o template depois nunca toca um `Requirement` já
criado. `sourceTemplateAppliedVersion` existe para uma futura tela de "este requisito veio do
template X, que mudou desde então" (o padrão *notify*, não *propagate*, de Drata) — não é lido
por nada nesta fatia.

### D-3. Prevenção de duplicidade — ponteiro de nome por Subject, transacional

Introduzir `RequirementNamePointer` (PK `TENANT#<t>#SUBJECT#<s>#REQNAME#<normalizedName>`,
SK `POINTER`, campos `requirementId`/`tenantId`/`subjectId`/`normalizedName`), escrito
transacionalmente junto com o `Requirement` que o nomeia:

- `createRequirement()` (existente, passa a ser transacional): `[0] Put(Requirement,
  attribute_not_exists), [1] Put(pointer, attribute_not_exists), [2] fence]`. Substitui o
  `putIfAbsent` atual. `CancellationReasons[1]` → `RequirementNameConflictError` novo (409).
- `updateRequirement()` com mudança de `name`: dois ramos, idênticos em forma a
  `renameDocumentType()` — nome normalizado igual (só `Update` + fence) vs. mudado
  (`Update` + `Delete(ponteiro antigo, requirementId=:self)` + `Put(novo, attribute_not_exists)`
  + fence).
- `deleteRequirement()`: `[0] Delete(Requirement, expectedVersion), [1] Delete(pointer,
  requirementId=:self), [2] fence]`.
- `applyTemplate()`: uma única `TransactWriteItems` com, para cada item NÃO pulado, um
  `Put(Requirement, attribute_not_exists)` + `Put(pointer, attribute_not_exists)`, mais o fence.

Isso é o que faz o critério 2 passar: a leitura prévia dos requisitos do Subject serve para
produzir uma resposta de preview/`skipped` **útil**, mas não é o que garante a exclusão mútua —
o `attribute_not_exists` do ponteiro é. Duas aplicações concorrentes: uma vence inteira, a outra
recebe `ConflictError` identificando o item colidente (a transação é all-or-nothing por
desenho, critério 6 — nunca meio aplicada).

Dedupe é por **nome normalizado** (`normalizeDisplayName()`, já compartilhado desde D-174), não
por `templateItemId`: a "duplicidade óbvia" que o roadmap pede é a que o usuário enxerga —
"CND Federal" já existe neste Subject, tanto faz se foi criado à mão ou por outro template.
`sourceTemplateItemId` é reportado no resultado do plano quando a colisão é com um requisito
que veio do mesmo item, para uma mensagem melhor, mas nunca é a chave da exclusão.

### D-4. Planejador puro compartilhado por preview e apply

Em `document-archive/domain/requirement-template.ts`:

```text
planTemplateApplication(
  items: RequirementTemplateItem[],
  existing: Pick<Requirement, "requirementId"|"name"|"sourceTemplateItemId">[],
): { create: RequirementTemplateItem[];
      skip: { templateItemId, name, reason: "DUPLICATE_NAME" }[] }
```

Sem I/O, sem relógio, sem tenant. `previewTemplateApplication()` = ler template + ler
requisitos do Subject + chamar o planejador + devolver. `applyTemplate()` = as mesmas três
etapas + montar a transação a partir de `plan.create`. Critério 4 é literalmente "existe
exatamente um call site da regra". Alvo de teste G-V3 adversarial: um teste que prova que
preview e apply concordam sobre um caso de colisão só-por-normalização (ex. "CND  Federal" vs
"cnd federal") — falha se qualquer um dos dois reimplementar a comparação.

### D-5. Operações

| Operação | Forma | Nota |
| --- | --- | --- |
| `createRequirementTemplate` | Put template + Put pointer + fence | espelha `createDocumentType` |
| `getRequirementTemplate` / `listRequirementTemplates` | get / `queryIndexPage` GSI1 `REQTEMPLATESTATUS`, `?status=` default ACTIVE | espelha `listDocumentTypes` |
| `updateRequirementTemplate` | OCC; renomeia (2 ramos de ponteiro) e/ou substitui `items` inteiro | cap de 40 itens validado no schema E no serviço |
| `duplicateRequirementTemplate` | lê + cria template novo, `templateId` e TODOS os `templateItemId` novos, `displayName` vindo do caller (ponteiro fecha a colisão) | itens NÃO reusam id: uma cópia é um template independente (critério 1 aplicado à própria duplicação) |
| `archiveRequirementTemplate` / `unarchiveRequirementTemplate` | flip de status com fence FROM-status | cópia de `flipDocumentTypeStatus`; ARQUIVADO nunca é deletado |
| `previewTemplateApplication` | leitura pura | sem quota de escrita, RBAC de leitura |
| `applyTemplate` | uma `TransactWriteItems` | exige template `ACTIVE` (fence via `ConditionCheck(status=ACTIVE)` na própria transação, não só leitura prévia — mesma classe de TOCTOU que D-175 fechou em `createDocument`) |

Rotas (wiring `infra/modules/api-gateway/main.tf` + `proxy-allowlist.ts`, disciplina D-117/D-120/D-178):

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

`preview` é POST (não GET) porque leva `subjectId` no corpo e é um cálculo, não um recurso
endereçável — e assim compartilha schema/validação com `apply`.

RBAC (`authorization.ts`): `docarchive:requirementtemplate-create|update|duplicate|archive|
unarchive` = `ADMIN_ROLES` (é catálogo, mesma postura de `DocumentType`);
`docarchive:requirementtemplate-read` = `READ_ONLY_ROLES`; `docarchive:requirementtemplate-apply`
= as mesmas roles de `docarchive:requirement-create` (aplicar é criar requisitos operacionais,
não administrar o catálogo — separar as duas actions é o ponto).

### D-6. `documentTypeId` no item de template NÃO é validado no apply — deliberado

O item pode carregar `documentTypeId` como sugestão de qual `DocumentType` satisfaz aquele
requisito, mas `Requirement` **não tem hoje** campo de `documentTypeId` (confirmado por leitura
de `requirement.ts`) — e criar esse vínculo é exatamente o item 6 em aberto do arco D-173
(schema guest obrigatório + mecanismo `Requirement`→`DocumentType`), que D-184 deixou
explicitamente não decidido. Esta fatia **persiste o campo no item de template e não o propaga
para o `Requirement`**, para não pré-decidir aquele item em aberto por efeito colateral. Um
`ConditionCheck(DocumentType.status=ACTIVE)` no apply também não entra: seria N condições a mais
na transação por um vínculo que nada lê ainda. Registrado como próximo passo explícito, não
como lacuna esquecida.

## Riscos reconhecidos

1. **D-3 alarga o escopo** para `createRequirement`/`updateRequirement`/`deleteRequirement`
   existentes (passam a escrever/manter ponteiro). É a parte mais cara da proposta. A
   alternativa (dedupe só dentro do apply, read-then-write) falharia o critério 2 e deixaria
   dois requisitos de mesmo nome criáveis à mão — aceito o custo, mas é o ponto que mais espero
   ver contestado.
2. **Nenhum backfill de ponteiro** para `Requirement` já existentes em `dev`. Consequência real:
   um requisito pré-existente sem ponteiro não bloqueia a criação de um homônimo até ser
   renomeado/recriado. `AGENTS.md` §1 dispensa migração de dado `dev`, mas isso é uma janela de
   invariante fraca, não só um dado velho — proponho um script de backfill idempotente
   (`scripts/backfill-requirement-name-pointers.ts`, com o guard `fileURLToPath` já corrigido
   em D-186) como parte da fatia, não depois.
3. **Cap de 40 itens** é uma restrição de produto derivada de um limite técnico. Documentada
   como tal; se algum dia um cliente precisar de 200, a resposta é aplicar mais de um template,
   não particionar a transação (o que quebraria o critério 6).

## Autoavaliação Rodada 1 (contra o checklist acima)

Critério 1: atendido (D-2). 2: atendido (D-3), com o custo do risco 1. 3: atendido (D-5, sem
versionamento). 4: atendido (D-4). 5: atendido (D-1/D-3/D-5 são cópias de mecanismo existente;
zero GSI novo). 6: atendido (D-1, cap justificado aritmeticamente). O que ainda não está
fechado: a extensão real do risco 1 (vale a pena o ponteiro por Subject, ou existe forma mais
barata de fechar o critério 2?), e a janela do risco 2.

**Nota Claude (cega), Rodada 1: 8,2/10.**
