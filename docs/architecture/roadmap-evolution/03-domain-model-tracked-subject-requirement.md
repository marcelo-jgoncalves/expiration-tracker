---
status: draft
owner: Marcelo
authority: informativo (decisão de domínio reconciliada via protocolo AGENTS.md §4; promovida a ADR formal só na Fase 3, junto do roadmap final)
---

# Fase 2b — Modelagem de domínio: `TrackedSubject` + `RequirementAssignment`

Primeiro cluster de decisão da Fase 2 (base de dependência de todo o resto, per DAG do prompt
estratégico §36: `TrackedSubject → RequirementAssignment → DocumentRequest → Guest Submission →
Automated Chasing`). Decisão nível 5-6 (`change-risk-scale.md` — muda modelo de dados fundamental
e chave de partição), protocolo Claude↔Codex completo aplicado via MCP (`codex mcp-server`),
sandbox read-only, 3 rodadas reais.

**Nota final: Claude 9,1 / Codex 9,1 — gate ≥9,0 atingido, sem arredondar.**

## Processo

- **Rodada 1 (propostas independentes, nota cega)**: Claude e Codex propuseram modelagem
  completa, cada um sem ver a proposta do outro, ambos lendo `01-gap-analysis.md`,
  `02-market-research.md`, `data-model.md` e o código real (`expiration-item.ts`,
  `authorization.ts`). Convergência forte e espontânea em: `TrackedSubject` como agregado próprio
  linkado por ID (nunca embutido); `RequirementAssignment` persistindo estado operacional e
  derivando validade do `ExpirationItem` linkado.
- **Rodada 2 (crítica adversarial)**: Claude atacou 5 pontos da proposta do Codex (GSI7
  sobrecarregado com 3 access patterns/2 entidades; `ownerUserId`/`assigneeUserId` prematuro sem
  Organization/Membership real; `RequirementDefinition` sem access pattern que o exija; migração
  de `subjectId?` não verificada contra schema real; autorização/isolamento do futuro guest
  upload). Codex concedeu nos pontos 1, 2 e 4 com evidência real verificada no código (não só
  concordância retórica), revisou o ponto 3 para um meio-termo (campo opcional
  `requirementDefinitionId?` como escape hatch, sem a entidade completa), e detalhou o ponto 5.
- **Rodada 3 (reconciliação + nota cega final)**: Claude incorporou as revisões do Codex + 2
  ajustes próprios (reuso do padrão de coleção já existente em `identity` — `TENANT#t#USER#u`/
  `SESSION#<deviceId>` — em vez de GSI novo para `RequirementAssignment`; escopo explícito de
  guest-token auth para uma rodada futura dedicada). Codex deu nota cega final sem ver a nota de
  Claude antes.

## Achados que sobreviveram ao ataque (decisão final)

### `TrackedSubject` — agregado raiz próprio

```
PK = TENANT#<tenantId>#SUBJECT#<subjectId>
SK = META
```
Campos: `subjectId`, `tenantId`, `type` (`COMPANY|VENDOR|CLIENT|EMPLOYEE|ASSET|LOCATION|CUSTOM`),
`displayName`, `displayNameNormalized`, `status` (`ACTIVE|ARCHIVED|DELETED`), `tags[]`,
`createdAt`, `updatedAt`, `deletedAt?`, `version`.

**Sem `ownerUserId`/`assigneeUserId` no v1** — modelar responsável interno antes de
Organization/Membership existir (ainda FUT-001) violaria "evidência antes de mecanismo"
(`docs/engineering/principles.md` #1): hoje só há role `OWNER` efetivamente atribuída por tenant,
não há um segundo usuário real para ser "responsável por um subject".

GSI7 novo, escopo único (listagem de subjects, não access pattern misto):
```
GSI7PK = TENANT#<tenantId>#SUBJECTSTATUS#<status>
GSI7SK = TYPE#<type>#NAME#<displayNameNormalized>#SUBJECT#<subjectId>
```

### `RequirementAssignment` — agregado próprio, coleção sob a partição do subject (sem GSI novo)

```
PK = TENANT#<tenantId>#SUBJECT#<subjectId>
SK = REQASSIGN#<assignmentId>
```
Reaproveita um padrão **já existente no código real** (`src/modules/identity`: um `User` tem
`TENANT#t#USER#u`/`PROFILE` e `.../SESSION#<deviceId>` sob o mesmo PK) — não é convenção nova,
apenas aplicação do mesmo padrão de coleção a uma relação 1-para-N já natural (um subject tem N
requisitos). Query por `PK` + `SK begins_with REQASSIGN#` lista todos os requisitos de um subject
sem GSI.

Campos: `assignmentId`, `subjectId`, `tenantId`, `requirementName` (texto livre no v1),
`requirementDefinitionId?` (escape hatch — `RequirementDefinition`/`RequirementTemplate` como
entidades ficam **deferidas por completo**, sem stub, até duplicação real observada entre
tenants), `status` (`MISSING|REQUESTED|SUBMITTED|UNDER_REVIEW|REJECTED|SATISFIED`, persistido),
`linkedItemId?`, `linkedDocumentId?`, `lastSubmissionId?`, `requestedAt?`/`submittedAt?`/
`reviewedAt?`/`satisfiedAt?`, `createdAt`, `updatedAt`, `deletedAt?`, `version`.

**Condição de aprovação do Codex, incorporada**: `VALID`/`EXPIRING`/`EXPIRED` são **estados de
apresentação derivados** do `ExpirationItem` linkado no momento da leitura (ou projeção
recomputada transacionalmente), **nunca** um enum persistido concorrente em
`RequirementAssignment` — essa é a garantia central contra fonte-dupla-de-verdade.

**Ressalva registrada, não bloqueante**: colocar `RequirementAssignment` sob a PK do subject
acopla a query principal ao subject; uma futura fila "todos MISSING/REQUESTED do tenant" (ex.
dashboard agregado) exigiria novo GSI/projeção quando esse consumidor existir de fato — aceito
como adiamento deliberado (nenhum consumidor real exige isso ainda), não lacuna escondida.

### `ExpirationItem` — mudança mínima, compatível

Ganha só `subjectId?: string` opcional. **Verificado no código real (não assumido)**: zero
migração de dado (DynamoDB sem enforcement de schema, item antigo simplesmente não tem o
atributo). Mas exige mudança explícita de contrato antes de aceitar o campo por API:
`schemas/api/create-item-request.v1.json` e `update-item-request.v1.json` têm
`additionalProperties: false` hoje e precisam de nova versão; `renewItem` copia campos
manualmente e precisaria copiar `subjectId` explicitamente. Isso é trabalho real de
implementação, registrado aqui para a sessão que implementar este milestone, não decidido agora.

### Transação de aprovação

Ao aprovar um documento submetido: **1 `transactWrite` só** — cria/renova `ExpirationItem` + seta
`RequirementAssignment.linkedItemId` + `status=SATISFIED` + evento outbox — mesmo padrão já usado
em `src/modules/expiration/persistence/expiration-store.ts` (nunca duas escritas separadas).

### Autorização

Novas actions na matriz (`src/modules/identity/domain/authorization.ts`): `subject:{create,read,
update,delete}`, `requirement:{assign,read,update,delete,review}` — mesmo padrão
resolver-deriva-`tenantId`, nunca aceitar `tenantId` do cliente.

**Explicitamente fora do escopo desta decisão**: autorização de guest token (necessária quando o
futuro guest upload escrever evidência contra um `RequirementAssignment` sem o remetente ser
usuário do tenant). Esboço já capturado como ponto de partida para a rodada de debate dedicada de
guest upload (Segurança + Privacidade, per `docs/engineering/joint-review-criteria.md`): token
hasheado → `tenantId`+`assignmentId`+`allowedAction`+`expiresAt`+`revokedAt?`, com rate limit por
token/IP além da quota por tenant já existente.

## Próxima ação

Próximo cluster de debate: guest upload/magic link (generalização de M6 + `DocumentRequest` +
autorização de convidado) — depende desta decisão estar fechada (estava, agora fechada com nota
9,1/9,1). Eixos relevantes: Segurança + Privacidade (per mapeamento já feito nesta sessão).
