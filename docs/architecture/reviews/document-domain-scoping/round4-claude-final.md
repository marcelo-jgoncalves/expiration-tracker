# Document Domain — Rodada 4 (Fechamento Claude)

Resposta aos 9 bloqueios concretos da Rodada 3 (nota 7,6/10, REABRIR). Escopo já convergido nas rodadas 1–3 não é reaberto.

## 1. AP8 corrigido — duas chaves físicas distintas, sem `begins_with` em PK

DynamoDB `Query` exige igualdade exata de partition key — corrigido. Duas escritas por `DocumentRequest` (mesma transação de criação):

- **Por status apenas** (dashboard/fila geral): GSI2 `GSI2PK=TENANT#<t>#REQUESTSTATUS#<status>, GSI2SK=DUE#<dueDate ou "~">#REQUEST#<id>`.
- **Por responsável** (minha fila): item espelhado próprio, sem GSI: `PK=TENANT#<t>#RESPONSIBLE#<userId>, SK=REQUESTSTATUS#<status>#REQUEST#<id>` — `Query` direto em `PK`, atualizado (`Put`/`Delete` do mirror antigo + `Put` do novo) a cada mudança de status ou de responsável, na mesma transação que muda o `DocumentRequest`.

## 2–3. Fences reais via `ConditionCheck` + leitura antes da transação

Corrigido o uso indevido de "a transação lê a GSI": toda leitura de contexto (Version anterior via `VERSIONLOOKUP`, Requirement vinculado, Request de origem) acontece **antes** de montar o `TransactWriteItems`, por `Query`/`Get` comuns. O commit então usa `ConditionCheck` (ação real de `TransactWriteItems`, não inventada) para reverificar atomicamente, no momento do commit, que os vínculos lidos ainda são verdadeiros:

Lista literal e completa da transação `acceptVersion` (substitui as referências cruzadas da Rodada 3):

1. `Update Document`: condição `version=:docVer` → `currentVersionId=:newVersionId, version+=1`
2. `Update` Version anterior (se existir): condição `versionId=:oldVersionId AND state=ACCEPTED AND version=:oldVer` → `state=SUPERSEDED, version+=1`, remove chaves GSI5
3. `Put DocumentVersionEvent` para a versão anterior: `SK=VERSION#<oldSeq>#EVENT#<ULID>`, `type=SUPERSEDED`
4. `Update` Version nova: condição `versionId=:newVersionId AND documentId=:expectedDocumentId AND state IN (RECEIVED,UNDER_REVIEW) AND version=:newVer AND pendingFileScans=0 AND infectedFileScans=0` → `state=ACCEPTED, decidedAt, reviewerId, version+=1`, remove chaves GSI5
5. `Put` evento idempotente: `SK=EVENT#<clientRequestToken>`, condição `attribute_not_exists(PK_SK)`, carrega `payloadHash` + `resultSnapshot={versionId, documentId, newState:"ACCEPTED", decidedAt}` (ver item 4 abaixo)
6. `Put DocumentVersionEvent(ACCEPTED)` para a nova version: `SK=VERSION#<newSeq>#EVENT#<ULID>` (evento de auditoria de AP10, **distinto** da chave de idempotência do item 5 — corrige a divergência AP10-vs-idempotência apontada)
7. `ConditionCheck` no Requirement (só se `requirementId` foi resolvido pela leitura prévia): condição `requirementId=:expectedRequirementId AND evidenceVersionId=:previouslyObservedValue AND version=:reqVer` — prova, no commit, que o vínculo lido antes da transação ainda vale
8. `Update` do mesmo Requirement (mesmo item do passo 7, ações diferentes não são permitidas duas vezes no mesmo `TransactWriteItems` sobre o mesmo item — por isso o passo 7 e este são **fundidos em um único `Update`** com a condição do passo 7 e o efeito abaixo): `status=SATISFIED, evidenceVersionId=newVersionId, version+=1`
9. `Update` do `DocumentRequest` de origem (se houver): condição `requestId=:expectedRequestId AND state IN (SUBMITTED,UNDER_REVIEW) AND version=:reqVer` → `state=COMPLETED, version+=1`
10. `Put`/`Delete` dos mirrors AP8 do Request (novo item `REQUESTSTATUS#COMPLETED#...`, remoção do antigo `REQUESTSTATUS#SUBMITTED#...`)

(Correção ao ponto 8/passo-duplo acima: um único item nunca aparece duas vezes em `TransactWriteItems` — o passo 7 descrito como "`ConditionCheck` separado" só se aplica quando o Requirement NÃO é escrito nesta transação por outro motivo; quando é (como aqui), a condição do `ConditionCheck` vira a condição do próprio `Update`, sem item duplicado.) Transação final: 8–9 itens reais, ainda bem abaixo do limite de 100.

## 4. Idempotência com `resultSnapshot` persistido

Corrigido: o item de evento idempotente (passo 5 acima) carrega, além de `payloadHash`, um `resultSnapshot` — os campos mínimos do resultado LÓGICO da operação no momento em que ela ocorreu (`{versionId, documentId, newState, decidedAt}` para `acceptVersion`; forma análoga para `rejectVersion`/`commitUpload`/`submitVersion`). Um replay com `payloadHash` batendo responde **sempre** com o `resultSnapshot` gravado, nunca com uma releitura do estado atual do agregado (que pode já ter avançado, ex. `ACCEPTED→SUPERSEDED` por uma renovação posterior) — resolve o achado #4 exatamente como apontado.

## 5. Coberto acima (lista literal completa, sem referência cruzada)

## 6. Claim: contrato próprio, sem forçar `authorize()`

Correção: **não** se estende o branch `ownerUserId`/`assigneeUserId` de `authorize()`. Em vez disso, uma checagem de serviço nomeada e específica ao domínio documental:

```
function assertReviewerOrAdmin(ctx: RequestContext, version: DocumentVersion): void {
  const roles = ctx.tenant.roles;
  if (roles.includes("OWNER") || roles.includes("ADMIN")) return; // paridade já estabelecida (B2B-7)
  if (version.reviewerId && version.reviewerId !== ctx.principal.userId) {
    throw new AuthorizationDeniedError("RESOURCE_OWNERSHIP_MISMATCH", "document-version:decide");
  }
  // reviewerId ausente (nunca reivindicada) — qualquer WRITE_ROLES decide
}
```

Chamada explicitamente por `acceptVersion`/`rejectVersion` DEPOIS do `authorize()` genérico (que só confirma `WRITE_ROLES` tenant-wide) — duas camadas, cada uma com sua responsabilidade, sem alterar a assinatura genérica de `AuthorizedResource`/`authorize()`.

## 7. Scan: `infectedFileScans` como contador separado, gate explícito

`DocumentFile.scanStatus: PENDING | CLEAN | INFECTED`. Dois contadores desnormalizados na Version: `pendingFileScans` (incrementado em `PENDING`, decrementado ao sair de `PENDING` para qualquer estado terminal) e `infectedFileScans` (incrementado quando um arquivo entra em `INFECTED`, nunca decrementado automaticamente — um arquivo infectado exige remoção humana explícita do arquivo, que decrementa e loga um `DocumentVersionEvent(FILE_REMOVED_INFECTED)`). Condição real do `acceptVersion` (passo 4 acima): `pendingFileScans=0 AND infectedFileScans=0` — agora distingue corretamente "tudo limpo" de "zero pendente, um infectado".

## 8. Retenção — classes reais de D-127, sem "equivalente"

Reaproveitando literalmente as 9 classes já existentes em `docs/architecture/reviews/quarantine-retention-scoping/estado-final-consolidado.md` §26 (nenhuma classe nova inventada):

| Entidade | Classe D-127 (exata) | Gatilho | Prazo (já definido em D-127) |
|---|---|---|---|
| `Document` + `DocumentVersion` `ACCEPTED`/`SUPERSEDED` + `DocumentFile` `CLEAN` | `CORE_USER_DATA` | fechamento de tenant (`deletedAt`) | `deletedAt+30d`, Prioridade 1 (já `APPROVED`, mesmo worker) |
| `DocumentVersion` `REJECTED`/`WITHDRAWN` + `DocumentFile` órfão | `DELIVERY_RECORD` | `rejectedAt`/`withdrawnAt` | `createdAt+180d`, Prioridade 2 (já `APPROVED`) |
| `DocumentVersionEvent`/`DocumentRequestEvent` | `SECURITY_AUDIT` | `createdAt` | `createdAt+365d`, Prioridade 3 (já `APPROVED`) |
| `RequestAccessCredential`/`GuestSession` | `TRANSIENT` (classe `WebhookInbox`/`UploadSlot`) | expiração/revogação | sem purga por idade dentro de tenant `ACTIVE`, Prioridade 6 (mesmo padrão já `APPROVED`) |

Legal hold/cascata: nenhuma entidade do domínio documental é `LEGAL_EVIDENCE` por padrão (fora do escopo desta rodada — se um documento específico precisar dessa trava, é uma extensão nomeada futura, não um caso geral). Ordem de purga: segue a MESMA ordem de prioridade já `APPROVED` em D-127 (1→6), sem uma ordem nova — `CORE_USER_DATA` (Document) só é elegível quando o tenant inteiro fecha, exatamente como já vale para o resto do sistema.

## 9. Recorrência: fences de unicidade e concorrência

- **Unicidade `(seriesId, occurrenceId)`**: `occurrenceId` não é gerado por UUID aleatório — é **determinístico**, derivado de `seriesId + cadência + índice do ciclo` (ex. `occurrenceId = hash(seriesId, "2026-10")` para uma série mensal) — torna o `Put` condicional (`attribute_not_exists`) do scheduler idempotente mesmo sob reexecução (retry produz o MESMO `occurrenceId`, não um novo).
- **Unicidade `(occurrenceId, attemptIndex)`**: cada nova tentativa (correção) faz um `Update` condicional no item do **ciclo** (`PK=TENANT#<t>#OCCURRENCE#<occurrenceId>`, item próprio, não um `DocumentRequest`): condição `latestAttemptIndex=:expectedPrev` → `latestAttemptIndex+=1`; o novo `requestId` só é criado DEPOIS desse `Update` ter sucesso, usando o `attemptIndex` retornado. Duas correções concorrentes: uma vence o `Update` condicional, a outra falha com 409 e deve reler o `latestAttemptIndex` real antes de tentar de novo (mesmo padrão OCC do resto do projeto) — impossível duas "tentativa 2" coexistirem.

---

**Itens ainda fora desta rodada** (inalterado): limites de plano/GB, portal de cliente completo, autoaceitação por IA sem revisão, assinatura eletrônica, pastas, prazos numéricos exatos além dos já herdados de D-127, pausa/timezone/catch-up de recorrência, extração do rate-limiter genérico para `src/shared/rate-limit/` (nomeada, não feita).
