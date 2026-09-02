# DocumentType — Rodada 4 (revisão Claude, resposta à crítica do Codex sobre a Rodada 3)

Nota da Rodada 3: régua 9,2/10 (**FECHADA, ≥9,0 dos dois lados — estável, não reabre**), design
8,4→8,5/10 (não fecha). 1 achado da Rodada 2 fecha (E-014 reancorado); 2 permanecem parcialmente
abertos (achado 2: mecanismo especificado mas incompleto na cobertura de writers; achado 3:
mapeamento posicional incompleto para `submitEvidence()`/`renameDocumentType()`); 1 achado novo
(CRUD de `DocumentType` fora da lane `TenantBusinessMutation`). Todos endereçados abaixo com
mecanismo concreto — nenhum ficando em prosa vaga.

**Nota de leitura sobre "código real ainda não implementa" (achados 2/3, primeira frase de cada)**:
esta é uma decisão design-only (mesmo padrão de D-163/`DocumentFile`, 4 rodadas, nenhuma delas
mudou código de produção — a implementação real veio depois, em D-164→D-168). O código de produção
não muda durante o protocolo; o que a Rodada 4 corrige é a **precisão da linguagem do documento**
(a Rodada 3 usou "passa a exigir"/"migra para" em tempo presente, que o Codex leu — corretamente,
pelo texto literal — como alegação de mudança já aplicada) e as **lacunas reais de especificação**
que o Codex apontou (posições de transação não cobertas, classes de erro sem `code`/`category`/
`retryable`, CRUD do catálogo fora da lane). Essas lacunas são reais e endereçadas abaixo; a
diferença entre "design aprovado, não implementado" e "código desatualizado" é preservada em toda
a linguagem desta rodada.

## 1. [bloqueante] Schema HTTP do guest flow — linguagem corrigida para design-only

Achado aceito: a Rodada 3 escreveu "Passa a:" seguido do JSON do schema alvo, indistinguível de uma
alegação de mudança já aplicada. Correção de linguagem (o schema real,
`schemas/api/docarchive-guest-submit-evidence-request.v1.json`, continua hoje com `documentType`
opcional — nenhuma mudança de código acontece nesta rodada, mesma disciplina de D-163):

> `schemas/api/docarchive-guest-submit-evidence-request.v1.json` hoje declara `documentType: {type:
> string, minLength:1, maxLength:100}`, opcional. **Na implementação desta decisão** (sessão de
> código dedicada, fora do escopo deste protocolo — mesma sequência de D-163→D-164), o schema muda
> para:
> ```json
> "required": ["fileName", "idempotencyKey", "documentTypeId"],
> "properties": {
>   "fileName": { "type": "string", "minLength": 1, "maxLength": 255 },
>   "documentTypeId": { "type": "string", "minLength": 1, "maxLength": 64 },
>   "idempotencyKey": { "type": "string", "minLength": 1, "maxLength": 128 }
> }
> ```
> `documentType` removido do schema (campo morto pós-migração)...

Resto do mecanismo (rota de leitura pública `GET
/document-archive/guest/document-requests/{token}/document-types`, teste de contrato atualizado)
inalterado — só a moldura temporal da frase-gatilho corrigida. Mesma correção de linguagem aplicada
em todo o resto deste documento e do Round 3 (busca textual por "passa a"/"migra para" em tempo
presente, reformulado para "na implementação" em cada ocorrência que descreve um artefato de código
real, não um artefato deste próprio protocolo como o checklist E-014 ou as classes de erro).

## 2. [bloqueante→fechado nesta rodada] `createDocument()`/`submitEvidence()` na lane — cobertura completa dos 7 writers e mapeamento posicional de `submitEvidence()`

Achado aceito: a Rodada 3 especificou `createDocument()` (3 entradas) mas não `submitEvidence()`
além de "idem, trocando `input.documentType` por `input.documentTypeId`" — insuficiente, porque
`submitEvidence()` (`guest-document-access-service.ts`) já é uma `TransactWriteItems` maior, não
uma `Put` solta como `createDocument()` era. Leitura do código real confirma a forma atual
(`guest-document-access-service.ts:submitEvidence`): `Put(Document)`, `Put(DocumentVersion)`,
`Put(DocumentVersionEvent)`, `Put(DocumentFile)` (o PRINCIPAL, D-163/D-164), `Update(DocumentRequest)`
— 5 entradas hoje, já dentro de `executeTenantBusinessMutation` (achado 2 da Rodada 2 estava
parcialmente errado ao dizer que `submitEvidence()` "hoje usa `putIfAbsent` solto" — isso é verdade
só para `createDocument()`; o Codex corrigiu essa imprecisão na Rodada 3 e a mantemos corrigida
aqui).

**Ordem completa de `submitEvidence()` com o `ConditionCheck` novo, 7 entradas**:
```
[0] ConditionCheck(DocumentType.status = ACTIVE)   // novo desta decisão
[1] Put(Document)
[2] Put(DocumentVersion)
[3] Put(DocumentVersionEvent)
[4] Put(DocumentFile)                               // PRINCIPAL, D-163/D-164
[5] Update(DocumentRequest)
[6] fence de lifecycle (TenantBusinessMutation, sempre por último)
```
Posição do `ConditionCheck` do tipo é `[0]`, não anexada ao final antes da fence — mesma convenção
de `createDocument()` (achado 3 da Rodada 3): a checagem de referência estável entra o mais cedo
possível na lista, antes de qualquer `Put` que dependa dela ser válida, puramente por legibilidade
(a ordem das entradas de uma `TransactWriteItems` não afeta atomicidade/resultado — DynamoDB avalia
todas as condições antes de commitar qualquer uma — mas afeta em qual índice o
`CancellationReasons` aponta, que é o que importa para o mapeamento abaixo).

**Mapeamento de `CancellationReasons` para `submitEvidence()`** (mesma técnica de
`document-archive-service.ts`'s `catch` já mostrado na Rodada 3 para `createDocument()`, estendida):
- posição `[0]` `ConditionalCheckFailed` → `DocumentTypeNotActiveError` (mesma classe de
  `createDocument()`).
- posições `[1]`-`[4]` `ConditionalCheckFailed` → `ConflictError` genérico (mesma semântica que os
  4 `Put`s já tinham antes desta decisão — nenhuma mudança de comportamento, só a posição desloca
  de `[0]`-`[3]` para `[1]`-`[4]`).
- posição `[5]` `ConditionalCheckFailed` → `ConflictError` (o `Update(DocumentRequest)` já
  condicionava a um estado esperado antes desta decisão — comportamento preexistente, posição
  desloca de `[4]` para `[5]`).
- posição `[6]` é a fence de lifecycle, tratada internamente pela lane (`TenantNotActiveError`),
  nunca chega ao `catch` do serviço.

**Achado real confirmado por leitura, corrigindo a Rodada 3**: a Rodada 3 não mencionou que
`submitEvidence()` já tinha 5 entradas antes desta decisão (só descreveu `createDocument()`'s 2→3)
— a tabela acima é a especificação completa que faltava, não uma mudança de mecanismo.

## 3. [bloqueante→fechado nesta rodada] `renameDocumentType()`/deprecate/reactivate — todos migram para a lane, com fence na última posição

Achado novo do Codex aceito sem ressalva: `TenantBusinessMutation`
(`src/shared/tenant-lifecycle/tenant-business-mutation.ts`, doc do próprio arquivo, linha 6) é "a
única forma suportada" de uma mutação de negócio tenant-scoped commitar — o CRUD de `DocumentType`
(create, rename, deprecate, reactivate) é exatamente esse tipo de mutação (mesma partição-família
`TENANT#<t>#...`, mesmo tenant que pode entrar em `DELETING`) e não há razão para ficar fora da
lane só porque o catálogo em si não referencia outro agregado. Todos os 4 writers migram:

**Create** (já descrito nas Rodadas 1-3, sem mudança): `[0] Put(DocumentType), [1] Put(pointer),
[2] fence]` — 3 entradas.

**Rename, ramo "só displayName muda"** (nome normalizado idêntico, Rodada 2 achado 3): `[0]
Update(DocumentType), [1] fence]` — 2 entradas.

**Rename, ramo "nome normalizado muda"**: `[0] Update(DocumentType), [1] Delete(pointer antigo),
[2] Put(pointer novo), [3] fence]` — 4 entradas (era 3 na Rodada 2/3, sem a fence — corrigido
aqui). Mapeamento de `CancellationReasons` da Rodada 2 (posição 0 = `ConflictError` OCC, posição 1
= `ConflictError` pointer antigo, posição 2 = `DocumentTypeNameConflictError`) preserva os mesmos
índices relativos — a fence só desloca o índice seguinte, que a lane já trata internamente.

**Deprecate/Reactivate** (`Update(DocumentType)` único, `status` ACTIVE↔DEPRECATED, nunca descrito
com detalhe nas Rodadas 1-3 além de "Update simétrico"): `[0] Update(DocumentType,
expectedVersion), [1] fence]` — 2 entradas. `CancellationReasons[0]` `ConditionalCheckFailed` →
`ConflictError` (OCC — outra mutação concorrente no mesmo `DocumentType` venceu).

**Consequência estrutural**: `document-archive-service.ts` ganha os 4 métodos
(`createDocumentType`/`renameDocumentType`/`deprecateDocumentType`/`reactivateDocumentType`) todos
chamando `executeTenantBusinessMutation`, nunca `store.transactWrite()` direto — mesmo padrão que
`createDocument()`/`submitEvidence()` já adotam nesta decisão. Nenhum destes 4 métodos existe ainda
no código real (catálogo `DocumentType` é inteiramente novo) — a lane entra desde o primeiro commit
da implementação, nunca como uma migração posterior (diferente de `createDocument()`, que já
existia sem a lane e precisa migrar).

## 4. [bloqueante→fechado nesta rodada] Taxonomia de erro completa — `code`/`category`/`retryable`

Achado aceito: `DocumentTypeNotActiveError`/`DocumentTypeNameConflictError` nomeadas na Rodada 3
sem os 3 campos que `AppError` exige (`src/shared/errors/app-error.ts:28-36`,
`AppErrorOptions.code`/`.category`/`.retryable` são obrigatórios em toda subclasse real do arquivo
— confirmado por leitura de todas as ~20 subclasses existentes, nenhuma omite os 3). Definição
completa, seguindo o precedente mais próximo (`TenantNotActiveError`/`ConflictError`, mesmo
arquivo):

```ts
/** Nova decisão DocumentType: ConditionCheck(DocumentType.status=ACTIVE) falhou na posição [0]
 * de createDocument()/submitEvidence() — o tipo referenciado não existe ou foi deprecado entre
 * a escolha do caller e o commit da transação (fecha a corrida TOCTOU, Rodada 2 achado 2).
 * `retryable: false`: retentar a mesma requisição falha identicamente até o caller escolher
 * outro documentTypeId ainda ACTIVE. */
export class DocumentTypeNotActiveError extends AppError {
  constructor(message = "Document type not found or not ACTIVE.", details?: Record<string, unknown>) {
    super({ code: "DOCUMENT_TYPE_NOT_ACTIVE", category: "CONFLICT", message, retryable: false, details });
    this.name = "DocumentTypeNotActiveError";
  }
}

/** Nova decisão DocumentType: Put do pointer novo falhou em renameDocumentType() (posição [2] do
 * ramo de 4 entradas) — o nome normalizado destino já está em uso por outro DocumentType ACTIVE
 * (dedupe transacional, Rodada 1 critério 3). `retryable: false`: mesmo motivo de LastOwnerError
 * — o caller precisa escolher outro nome, não repetir a mesma requisição. */
export class DocumentTypeNameConflictError extends AppError {
  constructor(message = "A document type with this name already exists.", details?: Record<string, unknown>) {
    super({ code: "DOCUMENT_TYPE_NAME_CONFLICT", category: "CONFLICT", message, retryable: false, details });
    this.name = "DocumentTypeNameConflictError";
  }
}
```

`category: "CONFLICT"` para as duas (não `NOT_FOUND`/`VALIDATION`) — mesma classificação que
`ConflictError`/`TenantNotActiveError`/`InvitationTokenUnavailableError` já usam para "a checagem
transacional em si falhou" (409, não 404/400), consistente com o restante da taxonomia.

## 5. [não-bloqueante→fechado nesta rodada] `docarchive:documenttype-guest-read` renomeada — capability de token, não action de RBAC

Achado aceito, verificado por leitura: `document-archive-guest-handlers.ts` (comentário de
cabeçalho, linha 4) confirma que o guest flow inteiro "never touches
`RequestContextResolver`/`authorize()`" — autentica por `GuestSession`/token opaco, nunca por
`Membership`/role. Uma entrada em `ACTION_ROLES` (`authorization.ts`) implica um `Action` verificado
por `authorize(context, action)` contra o role de uma `Membership` real — categoricamente incompatível
com o guest flow, que não tem `RequestContext`. Nenhuma nova entrada em `ACTION_ROLES`.

Renomeado para refletir o mecanismo real: a rota
`GET /document-archive/guest/document-requests/{token}/document-types` é autorizada pela mesma
validação de token opaco que toda rota `document-archive-guest-handlers.ts` já usa (`GuestSession`
válida + `DocumentRequest` associado ao token, mesmo padrão de `handleStartGuestSession`/
`handleSubmitEvidence`) — nenhuma checagem de `Action`/role nova, nenhum nome de `Action` no
namespace `docarchive:*`. O handler novo (`handleListGuestDocumentTypes`, mesmo arquivo) segue
literalmente o mesmo guard de token que os handlers guest existentes, sem introduzir um conceito de
autorização paralelo.

## Síntese

4 achados da Rodada 3 (1 realmente bloqueante por linguagem imprecisa, 2 por cobertura
incompleta de especificação, 1 novo por lane ausente no CRUD do catálogo, 1 não-bloqueante por
nomenclatura) fecham com: linguagem do schema HTTP corrigida para design-only em todo o documento;
`submitEvidence()` especificado com as 7 posições completas e mapeamento de `CancellationReasons`
integral; os 4 writers de CRUD do catálogo (`create`/`rename`/`deprecate`/`reactivate`) migrados
para `executeTenantBusinessMutation` com fence sempre na última posição; `DocumentTypeNotActiveError`/
`DocumentTypeNameConflictError` com `code`/`category`/`retryable` completos seguindo o precedente
real de `app-error.ts`; rota de leitura pública do guest reclassificada como capability de token,
nunca `Action`/RBAC. Régua E-014 já estável (9,2/10, Rodada 3, não reabre — só a nota de design
está em jogo nesta rodada).
