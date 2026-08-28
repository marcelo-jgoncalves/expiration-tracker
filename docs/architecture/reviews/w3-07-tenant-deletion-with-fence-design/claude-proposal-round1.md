# W3-07 (retomado) — Cascata de exclusão física por tenant COM fence real — Round 1

> Type 1 (`change-risk-scale.md` nível 5-6), protocolo `AGENTS.md` §4, gate padrão 9.0/10.
> D-063, substitui a tentativa reprovada D-062
> (`docs/architecture/reviews/w3-07-tenant-cascade-deletion-design/`). Decisão do Marcelo
> (2026-08-28): não adiar por falta de usuário real hoje — construir a garantia completa agora,
> reusando toda a pesquisa já validada da tentativa anterior (inventário de 40 `entityType`,
> mecanismo de descoberta+exclusão sem GSI6 exceto para `Document`, tabela `bff-session-table`).
> **Diferença estrutural desta tentativa**: o fence de bloqueio entra no escopo desde a Rodada 1,
> não é descoberto reativamente rodada a rodada como na tentativa anterior.

## 1. Achado que muda o mecanismo de fence: `User.status` já existe e já é enforced

`user-repository.ts:22`: `status: "ACTIVE" | "SUSPENDED"` — campo já declarado. `resolve-request-context.ts:67-69`:
`if (profile.status !== "ACTIVE") throw new AuthenticationError(...)` — **já é chamado em toda
requisição HTTP autenticada real** (M1, comentário de `test-route-handler.ts`: "exercises the
full chain for every request"). `"SUSPENDED"` nunca é escrito por nenhum código hoje (grep
exaustivo: só a declaração de tipo, zero setter) — é a única razão de nunca ter sido notado como
um fence já pronto.

**Consequência**: a etapa 1 da cascata de exclusão passa a ser `UPDATE User SET status =
"SUSPENDED"` (condicionado por versão, mesmo padrão OCC de sempre) — **nenhum código novo é
necessário para bloquear toda a superfície HTTP autenticada** (os 17 call sites reais de
`authorize()` mapeados: 4 handlers HTTP + 13 application services, todos atrás de
`resolveRequestContext`). Isso elimina inteiramente a classe de achado da tentativa anterior
sobre "AdminDisableUser mira o identificador errado" — não tocamos o Cognito, usamos um campo
interno que já é a fonte de verdade consultada em toda resolução de contexto.

## 2. Superfícies que `User.status` NÃO cobre — tratadas explicitamente, não descobertas depois

### 2.1 Fluxo de convidado (guest upload)

`GuestSubmissionService`/`guest-handlers.ts` nunca chama `resolveRequestContext`/`authorize()`
— autentica só por token opaco (`GuestTokenPointer`), resolve `tenantId` a partir do token, sem
nunca ler `User`. **Correção proposta**: `GuestSubmissionService` passa a ler o `User` do tenant
resolvido (mesmo `tenantId` que já obtém do token) e rejeitar com o mesmo erro categórico
(`AuthenticationError`/403 mapeado) se `status !== "ACTIVE"` — 1 leitura adicional, mesmo shape
de checagem, antes de qualquer efeito (criação de `DocumentSubmission`, URL S3 presignada).

### 2.2 Workers assíncronos — auditoria real dos 13, não afirmação genérica

Levantamento direto de `src/workers/*`:

| Worker | Já refaz leitura da entidade de origem antes de agir? | Precisa de checagem explícita de `User.status`? |
|---|---|---|
| `reminder-dispatch` | Sim — relê `ExpirationItem`+`ReminderPolicy` (`dispatch.ts:71-72`), cancela (`CANCELLED_STALE`) se `item.status !== "ACTIVE"` | **Não** — se a cascata já apagou/vai apagar o item, este worker já se comporta com segurança. Mas o item só é apagado DEPOIS que o Scan o alcança, não instantaneamente — checagem explícita de `User.status` aqui é barata (1 `GetItem`) e fecha a janela entre suspender o login e o Scan realmente varrer aquele item. **Adicionar.** |
| `reminder-materialization-trigger` | Relê item/policy via stream record | Mesma lógica acima — **adicionar** |
| `reminder-reconciliation` | Relê policy/occorrências | **Adicionar** |
| `reminder-producer` | Lê via GSI3 (scheduler global), não por tenant | Não aplicável diretamente — mas o command que produz já carrega `tenantId`; a checagem real de negócio acontece no `dispatch` a jusante, que já ganha a checagem acima. **Sem mudança aqui.** |
| `document-chasing-dispatch` | Relê `DocumentRequest`/assignment | **Adicionar** |
| `dispatch-outbox-relay`, `upload-slot-reconciliation` | Operam sobre ponteiros GSI6 já existentes, não criam efeito novo do zero | **Sem mudança** — não originam escrita nova de dado do tenant, só reconciliam o que já existe (e o que já existe será apagado pela própria cascata) |
| `malware-result`, `submission-malware-result`, `upload-finalizer`, `submission-finalizer` | Processam eventos de um upload já em andamento (curto, segundos) | **Sem mudança** — mesma classe do resíduo (b) já aceito na tentativa anterior (fila já em voo, finita, resolvida pela convergência) |
| `parser-sandbox` | Isolado, sem acesso a tabela/tenant | Não aplicável |
| `document-purge` | O PRÓPRIO worker de purga (W3-06) | Não aplicável — é o mecanismo de exclusão em si |

Resultado real: **3 workers** (`reminder-dispatch`, `reminder-materialization-trigger`,
`reminder-reconciliation`) ganham 1 leitura extra de `User.status` cada — não é uma reescrita
grande, é uma condição a mais num código que já lê o tenant. Os demais já são seguros por
construção (reconciliam ponteiros existentes) ou têm janela residual finita já aceita.

## 3. Mecanismo de descoberta+exclusão — reusa a tentativa anterior quase sem mudança

Mantido de D-062 (Rodadas 2-4, já não-bloqueante segundo o Codex): sem GSI6 exceto `Document`
(reusa `DocumentPurgeWorker`/D-061), taxonomia fechada por `entityType` (40 tipos, 3 categorias:
OCC-versionado / sem versão-existência apenas / autopurgável-excluído), convergência via re-Scan
até zero ou `maxPasses`, fallback sequencial por item quando um lote de 25 falha,
`TenantDeletionRequest` excluído do próprio filtro do Scan, segunda tabela (`bff-session-table`)
varrida separadamente.

**Diferença real desta vez**: a convergência não depende mais só de "a fila drena eventualmente"
— depende de `User.status = SUSPENDED` já bloquear toda escrita nova desde o primeiro instante
(exceto o resíduo finito já mapeado acima), então `maxPasses` deixa de ser uma aposta e vira um
número mensurável (tempo máximo de retry das filas envolvidas).

## 4. Pergunta para Rodada B (Codex)

(a) A checagem de `User.status` em `resolveRequestContext` é realmente chamada por TODO caminho
HTTP real, sem exceção (confirme contra os 17 call sites de `authorize()`)? (b) A auditoria dos
13 workers está correta — algum deles cria efeito colateral novo sem antes reler uma entidade de
origem que a cascata já teria apagado? (c) Existe algum caminho de escrita que nem `User.status`
nem a auditoria de workers cobre (ex.: BFF proxy cacheia alguma decisão de autorização por mais
tempo que o TTL do access token)?
