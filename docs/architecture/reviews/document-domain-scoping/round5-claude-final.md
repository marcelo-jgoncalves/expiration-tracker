# Document Domain — Rodada 5 (Fechamento Claude)

Resposta aos 4 bloqueios mínimos da Rodada 4 (nota 8,4/10, REABRIR). Escopo já convergido (pontos 1, 2–3, 6, 7 da Rodada 4) não é reaberto.

## 1. Condição idempotente corrigida

`PK_SK` não é convenção real do projeto — corrigido. A condição do `Put` do evento idempotente (passo "Put idempotency record") é `attribute_not_exists(PK) AND attribute_not_exists(SK)` sobre as duas chaves reais do item (`PK=TENANT#<t>#DOCUMENT#<id>`, `SK=VERSION#<seq>#EVENT#<clientRequestToken>`) — a combinação das duas é única por natureza de chave composta do DynamoDB (um `Put` só precisa que o item com essa `PK`+`SK` exata não exista; `attribute_not_exists(PK)` sozinho já é suficiente porque a condição é avaliada sobre o item endereçado por `PK`+`SK` juntas, mas declarar as duas explicitamente remove qualquer ambiguidade que `PK_SK` sugeria).

## 2. Lista literal final de `acceptVersion` — 10 ações, sem fusão ambígua

Adotada a contagem exata da Rodada 4 do Codex:

1. `Update Document` — condição `version=:docVer` → `currentVersionId, version+=1`
2. `Update` Version anterior — condição `versionId=:oldVersionId AND state=ACCEPTED AND version=:oldVer` → `state=SUPERSEDED, version+=1`
3. `Put DocumentVersionEvent(SUPERSEDED)` — versão anterior
4. `Update` Version nova — condição `versionId=:newVersionId AND documentId=:expectedDocumentId AND state IN (RECEIVED,UNDER_REVIEW) AND version=:newVer AND pendingFileScans=0 AND infectedFileScans=0` → `state=ACCEPTED, decidedAt, reviewerId, version+=1`
5. `Put` evento idempotente — `attribute_not_exists(PK) AND attribute_not_exists(SK)`, carrega `payloadHash`+`resultSnapshot`
6. `Put DocumentVersionEvent(ACCEPTED)` — versão nova (item de auditoria AP10, chave `EVENT#<ULID>`, distinta do item 5)
7. `Update Requirement` — condição de vínculo FUNDIDA na própria condição do Update: `requirementId=:expectedRequirementId AND evidenceVersionId=:previouslyObservedValue AND version=:reqVer` → `status=SATISFIED, evidenceVersionId=newVersionId, version+=1` (um único item, uma única ação — nunca um `ConditionCheck` separado sobre a mesma chave)
8. `Update DocumentRequest` de origem (se houver) — condição `requestId=:expectedRequestId AND state IN (SUBMITTED,UNDER_REVIEW) AND version=:reqVer` → `state=COMPLETED, version+=1`
9. `Delete` mirror AP8 antigo do Request — `PK=TENANT#<t>#RESPONSIBLE#<userId>, SK=REQUESTSTATUS#SUBMITTED#REQUEST#<id>`
10. `Put` mirror AP8 novo do Request — mesma `PK`, `SK=REQUESTSTATUS#COMPLETED#REQUEST#<id>`

10 ações reais, chaves todas distintas exceto o Requirement (uma vez só) — dentro do limite de 100 itens/4MB do `TransactWriteItems`. Itens 7–10 são condicionais à existência de Requirement/Request de origem; o caso mínimo (upload sem Requirement/Request associado) tem 6 ações (1–6).

## 3. Retenção — remapeada às classes normativas reais de `privacy-lgpd.md` §4 (não mais aproximação)

Fonte conferida nesta rodada (`docs/architecture/privacy-lgpd.md`, tabela de classes):

| Entidade | Classe normativa exata | Gatilho/prazo (literal da tabela) |
|---|---|---|
| `Document`, `DocumentVersion` (**qualquer estado**: `ACCEPTED`/`SUPERSEDED`/`REJECTED`/`WITHDRAWN`), `DocumentFile` | `USER_DOCUMENT` (`"Document/S3, campos e runs"`) | `ACCEPTED`/`SUPERSEDED`: exclusão/encerramento de tenant + 30 dias (mesmo prazo geral da classe); `REJECTED`/`WITHDRAWN` mapeiam ao sub-prazo já existente na própria classe para **"runs falhos/descartados: 7 dias"** — a classe já distingue isso, sem precisar de uma classe nova. Removida a citação errada a `DELIVERY_RECORD` (que é para *intents/attempts* de entrega, não para artefato documental rejeitado). |
| `DocumentVersionEvent`, `DocumentRequestEvent` | `SECURITY_AUDIT` (`"AuditEvent/logs redigidos, MembershipAuditEvent"`) | criação + 365 dias, backup regional — mapeamento já estava correto, mantido |
| `RequestAccessCredential`, `GuestSession` | `TRANSIENT` (`"WebhookInbox, UploadSlot, InvitationTokenPointer"`) | **corrigido**: a classe TEM prazo normativo (7 dias padrão, com sub-prazos próprios por tipo — slot incompleto 24h, token de convite 14 dias) — não "sem purga por idade" como a Rodada 4 alegou incorretamente. `RequestAccessCredential`/`GuestSession` ganham seu próprio sub-prazo dentro da mesma classe: purga em 14 dias após expiração/revogação (mesmo sub-prazo já usado para `InvitationTokenPointer`, por serem semanticamente equivalentes — ambos são credenciais de acesso temporário, não slots de upload incompletos de 24h). |

Nenhuma classe nova inventada; toda purga usa exclusivamente as 5 classes já normativas em `privacy-lgpd.md` §4.

## 4. Recorrência: avanço do ponteiro e criação do Request na MESMA transação

Corrige a lacuna real apontada (retry após falha parcial deixa `latestAttemptIndex` avançado sem o Request correspondente existir). Nova transação única `materializeAttempt` (`TransactWriteItems`):

1. `Update` item de ciclo (`PK=TENANT#<t>#OCCURRENCE#<occurrenceId>`) — condição `latestAttemptIndex=:expectedPrev` → `latestAttemptIndex=:next`
2. `Put DocumentRequest` — chave determinística `requestId=<occurrenceId>#ATTEMPT#<next>` (não aleatória — torna o `Put` condicional `attribute_not_exists(PK)` idempotente contra retry: uma reexecução com o mesmo `:expectedPrev`/`:next` tenta recriar o MESMO item, falha inofensivamente se já existe, nunca cria um Request órfão)
3. `Put` mirror AP8 do novo Request (`RESPONSIBLE#<userId>#REQUESTSTATUS#SENT#...`)
4. `Put DocumentRequestEvent(CREATED)` — auditoria

Ponteiro e Request agora só avançam/existem juntos — uma falha entre os dois nunca ocorre porque são a mesma chamada atômica. Retry com o mesmo `:expectedPrev` observado é seguro (passo 2 falha condicionalmente se o Request já foi criado por uma tentativa anterior bem-sucedida, mas isso só acontece se o passo 1 TAMBÉM já tivesse avançado — e como estão na mesma transação, ambos commitam ou nenhum comita, eliminando a lacuna).

---

**Itens ainda fora desta rodada** (inalterado): limites de plano/GB, portal de cliente completo, autoaceitação por IA sem revisão, assinatura eletrônica, pastas, prazos exatos de purga além dos já herdados de `privacy-lgpd.md`, pausa/timezone/catch-up de recorrência, extração do rate-limiter genérico.
