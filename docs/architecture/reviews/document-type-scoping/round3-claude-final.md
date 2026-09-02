# DocumentType — Rodada 3 (revisão final Claude)

Nota da Rodada 2: régua 7,8/Codex, design 8,4/Codex. 4 achados remanescentes (1 régua ainda
misturando interno/externo, 3 de design: schema HTTP do guest flow, integração com
`TenantBusinessMutation`, mapeamento posicional completo de `CancellationReasons`). Todos
endereçados abaixo com mecanismo concreto.

## 1. [bloqueante] Schema HTTP do guest flow migra junto

`schemas/api/docarchive-guest-submit-evidence-request.v1.json` (`POST
/document-archive/guest/document-requests/{token}/uploads`) hoje declara `documentType: {type:
string, minLength:1, maxLength:100}`, opcional. Passa a:

```json
"required": ["fileName", "idempotencyKey", "documentTypeId"],
"properties": {
  "fileName": { "type": "string", "minLength": 1, "maxLength": 255 },
  "documentTypeId": { "type": "string", "minLength": 1, "maxLength": 64 },
  "idempotencyKey": { "type": "string", "minLength": 1, "maxLength": 128 }
}
```

`documentType` removido do schema (campo morto pós-migração, nenhum coexistência —
`additionalProperties: false` já rejeita quem ainda mandar o nome antigo, fail-loud em vez de
ignorar silenciosamente). Teste de contrato existente (`test/contract/`, exemplo válido/inválido)
atualizado para o novo campo — mesma disciplina de todo schema já normativo neste projeto
(`AGENTS.md` §7).

**Produtor real do campo (achado do Codex aceito — nenhuma UI de guest upload existe hoje que
liste tipos `ACTIVE`)**: fora de escopo desta decisão nomear a UI (planejamento de interface é
tarefa separada, `docs/frontend/`), mas o **contrato** precisa de uma leitura pública viável antes
da UI existir — `docarchive:documenttype-read` (READ_ONLY_ROLES) não serve ao guest, que não tem
`Membership`. Nova action `docarchive:documenttype-guest-read`, mesma postura de autorização que
`docarchive:guest-*` já usa (token de guest, não role de tenant) — rota
`GET /document-archive/guest/document-requests/{token}/document-types` retorna só `documentTypeId
`+`displayName` dos tipos `ACTIVE` do tenant do request (não expõe `DEPRECATED`, não expõe outros
campos administrativos). Registrado como parte do escopo desta decisão (é modelo de dados +
contrato, não UI) — implementação real na sessão de código, não neste design.

## 2. [bloqueante] `createDocument()` migra para `TenantBusinessMutation` — nas duas variantes

Achado aceito sem ressalva: `createDocument()` hoje usa `putIfAbsent` solto (verificado por
leitura — não está na lista de call sites de `executeTenantBusinessMutation`), mas ao se tornar
uma `TransactWriteItems` real (achado 2 da Rodada 1: `ConditionCheck` do `DocumentType` + `Put`
do `Document`), fica estruturalmente idêntico a todo outro writer de negócio tenant-scoped do
projeto — não faria sentido introduzir uma transação nova sem a fence de lifecycle que a lane já
formaliza (`tenant-business-mutation.ts`, W3-07/D-067), mesmo padrão que `guest-document-access-
service.ts` (que já cria `Document` hoje) já segue.

Mecanismo, `document-archive-service.createDocument()`:
```ts
await executeTenantBusinessMutation({
  store: this.store, tableName: this.tableName, tenantId,
  entries: [
    buildExistenceConditionCheck({ tableName: this.tableName, key: documentTypeKey(tenantId, input.documentTypeId), extra: { status: "ACTIVE" } }),
    buildVersionedCreate({ tableName: this.tableName, item: document }), // attribute_not_exists(PK), mesmo Put de sempre
  ],
});
```
`guest-document-access-service.submitEvidence()` idem, trocando `input.documentType` por
`input.documentTypeId` (achado 1 da Rodada 2) na mesma entrada de `ConditionCheck`.

## 3. [bloqueante] Mapeamento posicional completo de `CancellationReasons`

Com a lane, a transação de `createDocument()` tem 3 entradas na ordem:
`[0] ConditionCheck(DocumentType.status=ACTIVE)`, `[1] Put(Document)`, `[2] fence de lifecycle`
(sempre por último — `tenant-business-mutation.ts` documenta essa ordem). A lane já trata `[2]`
internamente (`TenantNotActiveError`); qualquer outra causa propaga o `TransactionCanceledException`
cru para o caller, exatamente como `tenant-business-mutation.ts`'s doc já avisa ("callers that
need to tell the two apart should... inspect `CancellationReasons` on the underlying SDK error
themselves"). `document-archive-service.ts` ganha o mesmo padrão que `accept-invitation.ts`/
`change-membership-role.ts` já usam:

```ts
try {
  await executeTenantBusinessMutation({ ... });
} catch (err) {
  if (isTransactionCanceled(err)) {
    const reasons = getCancellationReasonCodes(err);
    if (reasons?.[0] === "ConditionalCheckFailed") {
      throw new DocumentTypeNotActiveError("Document type not found or not ACTIVE.", { documentTypeId: input.documentTypeId });
    }
    if (reasons?.[1] === "ConditionalCheckFailed") {
      throw new ConflictError("Document already exists.", { documentId });
    }
  }
  throw err; // inclui TenantNotActiveError já lançado pela própria lane antes de chegar aqui
}
```
`DocumentTypeNotActiveError` (nova subclasse de `AppError`, taxonomia existente
`src/shared/errors/app-error.ts`, mesmo padrão de `TenantNotActiveError`/
`InvitationTokenUnavailableError`) — nunca um `TransactionCanceledException` cru escapa para o
handler HTTP. Mesma técnica aplicada em `renameDocumentType()` (achado 5 da Rodada 1/2): posição 0
= `ConflictError` (OCC da própria entidade), posição 1 = `ConflictError` (pointer antigo não
aponta mais para este tipo), posição 2 = `DocumentTypeNameConflictError` (nome destino em uso).

## 4. [bloqueante — régua] Checklist reancorado, escopo `SIM PARCIAL` restrito à parte externa

Achado aceito sem ressalva: `research-protocol.md` (linha "o checklist da próxima seção cobre só
a parte `SIM`/`SIM PARCIAL`") exige que a sub-rubrica derivada de pesquisa cubra só a parte
informada por padrão externo — mecanismo de concorrência DynamoDB, layout de GSI2, cobertura de
todos os writers e integração com `TenantBusinessMutation` são decisão **interna** deste projeto
(nenhuma das 3 fontes pesquisadas informa "como o DynamoDB serializa uma corrida" ou "qual lane
interna fenceia tenant lifecycle"), avaliadas pelo eixo já existente de `joint-review-criteria.md`
(Arquitetura/Qualidade de Engenharia), não pela sub-rubrica E-014.

**Sub-rubrica E-014 (só a parte `SIM PARCIAL`), com âncora atende/não atende:**
```
1. (peso 40%) Identidade nunca muda, nome sempre pode mudar.
   Atende: documentTypeId opaco, imutável, gerado uma vez; rename só toca displayName/pointer.
   Não atende: qualquer operação que gera um documentTypeId novo para o "mesmo" tipo, ou que
   perde a identidade em qualquer mutação de nome.
2. (peso 35%) Nenhuma exclusão física de um tipo referenciado — só soft-state.
   Atende: DEPRECATED é o único mecanismo de "remover" um tipo; toda leitura por documentTypeId
   de um Document existente continua resolvendo, independente do status do DocumentType.
   Não atende: qualquer caminho de código que execute Delete físico de um DocumentType, ou que
   quebre a leitura de um Document cujo tipo foi deprecado.
3. (peso 25%) Dedupe de nome exibido, insensível a diacrítico/caixa/whitespace (precedente:
   normalizeDisplayName já convergido no projeto).
   Atende: dois nomes que normalizam igual nunca coexistem como dois DocumentType ACTIVE
   distintos.
   Não atende: dedupe case-sensitive, ou reimplementação de normalização divergente do
   precedente já existente sem justificativa nova.
```

**Critérios de integridade/concorrência (internos, avaliados pelo eixo padrão de
`joint-review-criteria.md`, não pela sub-rubrica E-014)**: mecanismo `ConditionCheck`/
`TenantBusinessMutation`, cobertura de todos os writers reais, mapeamento de
`CancellationReasons`, formato de GSI1/GSI2 — critérios de qualidade de engenharia já cobertos
pelo eixo geral, não precisam de uma segunda régua paralela.

Gate de régua estável (`research-protocol.md` §3): esta reancoragem é a correção que a Rodada 2
pediu — pede nota ≥9,0 de régua nesta rodada antes da nota de design contar para o fechamento
final.

## Síntese

4 achados da Rodada 2 fecham com: schema HTTP migrado (campo renomeado, contrato de leitura
pública nomeado para o guest, implementação de UI fora de escopo mas contrato pronto),
`createDocument()`/`submitEvidence()` migrados para `TenantBusinessMutation` nas duas variantes
(interna+guest), mapeamento posicional completo de `CancellationReasons` com 2 erros de domínio
novos (`DocumentTypeNotActiveError`/`DocumentTypeNameConflictError`) substituindo qualquer
exceção crua, e a sub-rubrica E-014 restrita às 3 partes genuinamente externas (identidade,
soft-state, normalização) com âncoras atende/não atende — concorrência/GSI/lane tratados pelo
eixo padrão de qualidade de engenharia, não duplicados numa segunda régua.
