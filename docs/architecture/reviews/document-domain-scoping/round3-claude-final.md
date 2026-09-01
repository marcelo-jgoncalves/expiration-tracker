# Document Domain — Rodada 3 (Revisão final Claude)

Resposta aos 12 bloqueadores exatos da Rodada 2 (`round2-codex-critique.md`, nota 5,9/10, REABRIR). Verificação factual feita nesta sessão via `grep`/leitura direta de `infra/modules/dynamo-table/main.tf` e `src/`, não por afirmação.

## Bloqueador 1 — Régua E-014 corrigida

- Data de consulta corrigida para `2026-08-31` (data real da sessão; `2026-09-01` na Rodada 2 foi erro de digitação, não fonte inválida — mas a crítica sobre precisão procede, corrigido).
- NIST: referência trocada para **SP 800-63B-4** (revisão corrente), seção correta **§5.1.2 "Look-up Secrets"** (não §5.1.9, que trata de dispositivos MFA — erro da Rodada 2 aceito). URL: https://pages.nist.gov/800-63-4/sp800-63b/ (consultado 2026-08-31).
- OWASP Forgot Password Cheat Sheet: escopo da citação restrito exatamente ao que ela sustenta — geração/expiração de token de uso único para a TROCA de `GuestSession` (item de curta duração), nunca para a credencial de acesso de longa duração (`RequestAccessCredential`), que não tem paralelo direto nas cheat sheets e é justificada só internamente (requisito de negócio: Request pode ficar aberto por semanas) — declarada como tal na tabela abaixo, não mais como "validada" pela fonte.
- Checklist próprio adicionado para a Decisão 2 (abaixo, junto com a decisão).
- Checklist da Decisão 4 ampliado com os itens que a Rodada 2 apontou como ausentes: entropia mínima (≥128 bits, NIST SP 800-63B-4 §5.1.2), hash resistente a ataque offline (Argon2id, OWASP Password Storage Cheat Sheet), `Referrer-Policy: no-referrer` + zero recurso de terceiro na página guest, CSRF token emitido com a `GuestSession`, HTTPS obrigatório (`Strict-Transport-Security`), resposta uniforme (sem diferenciar "link inválido" de "link expirado" na mensagem pública, contra enumeração).

| Fonte | URL | Consulta | Uso, com escopo explícito |
|---|---|---|---|
| NIST SP 800-63B-4 §5.1.2 | https://pages.nist.gov/800-63-4/sp800-63b/ | 2026-08-31 | Entropia/formato de look-up secret — só a troca curta, não a credencial longa |
| OWASP Forgot Password Cheat Sheet | https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html | 2026-08-31 | Token de uso único/expiração curta — só a troca curta |
| OWASP Password Storage Cheat Sheet | https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html | 2026-08-31 | Argon2id para hash do secret armazenado |
| OWASP Session Management Cheat Sheet | https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html | 2026-08-31 | Vazamento em URL/Referer/logs, `Referrer-Policy` |
| OWASP Cross-Site Request Forgery Prevention Cheat Sheet | https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html | 2026-08-31 | CSRF na `GuestSession` em cookie |
| OWASP Access Control Cheat Sheet | https://cheatsheetseries.owasp.org/cheatsheets/Access_Control_Cheat_Sheet.html | 2026-08-31 | Enforcement server-side |
| AWS DynamoDB — General/Sparse Indexes | https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-indexes-general-sparse-indexes.html | 2026-08-31 | Índice esparso para review queue (agora em GSI2, ver Bloqueador 2) |
| `infra/modules/dynamo-table/main.tf` (fonte interna, verificada nesta sessão) | repo local | 2026-08-31 | Prova de que GSI2/GSI5 existem, são tenant-facing (política geral) e **não têm writer hoje** (`grep GSI2PK\|GSI5PK src` vazio) — corrige a colisão do Bloqueador 2 |

**Checklist ponderado — Decisão 2 (armazenamento), ausente na Rodada 2:**
1. (30%) Nenhum índice novo colide com contrato/IAM já normativo (GSI3/GSI4/GSI6 nunca tocados pelo domínio documental).
2. (25%) Todo access pattern do spec funcional (§25–31) tem uma chave física nomeada, sem "análogo" vago.
3. (25%) Transação de escrita crítica declara todos os itens reais (incluindo eventos), fences de integridade referencial explícitos.
4. (20%) Cada GSI usado é tenant-scoped (nunca global sem isolamento dedicado, salvo justificativa equivalente à de GSI3/GSI6).

## Bloqueador 2 — Índices sem colisão + access patterns completos

**Correção**: usar **GSI2** e **GSI5** — confirmados nesta sessão como provisionados (`infra/modules/dynamo-table/main.tf`, `tenant_facing_index_names`), tenant-facing (política geral de leitura/escrita, não isolados como GSI3/GSI4/GSI6), e **sem nenhum writer real hoje** (verificado por grep, contradizendo a suposição da própria Rodada 2 de que GSI2 já estaria ocupado). GSI1 continua reaproveitado só por discriminação de prefixo (mesmo padrão que `ExpirationItem` já usa para outros módulos).

| AP | Padrão | Chave |
|---|---|---|
| AP1 | Document por ID | `PK=TENANT#<t>#DOCUMENT#<id>, SK=METADATA` |
| AP2 | Versions de um Document, ordenadas | `SK=VERSION#<seq 6 dígitos>` no mesmo `PK` |
| AP3 | Documents por Subject | GSI2: `GSI2PK=TENANT#<t>#SUBJECT#<subjectId>#DOC, GSI2SK=DOCTYPE#<type>#DOCUMENT#<id>` |
| AP4 | Documents por Organization+status, ordenado por atualização | GSI1 (discriminado): `GSI1PK=TENANT#<t>#DOCSTATUS#<status>, GSI1SK=UPDATED#<updatedAt>#DOCUMENT#<id>` — ordena por atividade recente, não por Subject (corrige achado "sem ordenação operacional útil") |
| AP5 | Review Queue tenant-wide, por estado real | GSI5 (esparso): `GSI5PK=TENANT#<t>#REVIEWQUEUE#<state>` (`state ∈ {RECEIVED,UNDER_REVIEW}`, cada um seu próprio bucket — corrige "RECEIVED fixo na SK"), `GSI5SK=<receivedAt ou claimedAt>#VERSION#<id>`; atributo ausente fora desses 2 estados (índice esparso real, AWS docs) |
| AP6 | Requirements por Subject | item do próprio Subject: `PK=TENANT#<t>#SUBJECT#<subjectId>, SK=REQUIREMENT#<id>` |
| AP7 | Requirements por Organization+status | GSI1 (discriminado): `GSI1PK=TENANT#<t>#REQSTATUS#<status>, GSI1SK=SUBJECT#<subjectId>#REQUIREMENT#<id>` |
| AP7b (novo, resolve achado da Rodada 2) | Request aberto de um Requirement específico | `PK=TENANT#<t>#REQUIREMENT#<requirementId>, SK=REQUEST#<requestId>` — item espelhado do Request sob a partição do Requirement, escrito na mesma transação que cria o Request (permite `Query` direto sem GSI) |
| AP8 | Requests por status **e** por responsável | GSI2 (discriminado, reaproveitando o mesmo índice de AP3 por prefixo distinto): `GSI2PK=TENANT#<t>#REQUESTSTATUS#<status>#RESP#<responsibleUserId>, GSI2SK=DUE#<dueDate ou "~">#REQUEST#<id>` — corrige "sem responsável na chave"; consulta "por status apenas" usa `begins_with(GSI2PK, "...#REQUESTSTATUS#<status>#")` com `RESP#` omitido do filtro (a chave inclui o responsável mas a query pode varrer todos via `begins_with` no prefixo comum) |
| AP9 | Files de uma Version | `SK=VERSION#<seq>#FILE#<fileId>` |
| AP10 | Eventos de uma Version | `SK=VERSION#<seq>#EVENT#<ULID>` |
| AP11 (novo) | Version isolada por `versionId` (sem saber o Document) | GSI5 (discriminado): `GSI5PK=TENANT#<t>#VERSIONLOOKUP, GSI5SK=VERSION#<versionId>`, projeção `documentId` — necessário para validar `satisfiedByVersionId` e "mesmo Document" no relink (Decisão 5), resolve achado da Rodada 2 |

Nenhum uso de GSI3/GSI4/GSI6. GSI1/GSI2/GSI5 discriminados por prefixo, mesmo padrão que o projeto já usa para isolar `ITEMSTATUS` de outros módulos no GSI1 existente.

### Transação `acceptVersion` — recontada, com fences de integridade

TransactWriteItems (6–8 itens, ainda muito abaixo do limite real de 100 itens/4MB — `AWS TransactWriteItems` API reference):

1. Update `Document`: condição `version=:docVer` → `currentVersionId, version+=1`
2. Update Version anterior (se existir): condição `state=ACCEPTED AND version=:oldVer AND documentId=:sameDoc` → `state=SUPERSEDED, version+=1`, remove chaves GSI5
3. Put `DocumentVersionEvent(SUPERSEDED)` para a versão anterior (item que a Rodada 2 apontou como faltante)
4. Update Version nova: condição `state IN (RECEIVED,UNDER_REVIEW) AND version=:newVer AND documentId=:sameDoc AND ALL_FILES_CLEAN` (ver Bloqueador 9) → `state=ACCEPTED, decidedAt, reviewerId, version+=1`, remove chaves GSI5
5. Put `DocumentVersionEvent(ACCEPTED)` — chave de idempotência `PK=..., SK=EVENT#<clientRequestToken>`, condição `attribute_not_exists` + o item carrega `payloadHash` (ver Bloqueador 5)
6. Update `Requirement` (se `Requirement.evidenceVersionId` alvo = esta version — ver Decisão 5 corrigida): condição `version=:reqVer AND requirementId=:sameReq` → `status=SATISFIED, evidenceVersionId=newVersionId, version+=1`
7. Update `DocumentRequest` (se origem de solicitação): condição `state IN (SUBMITTED, UNDER_REVIEW) AND version=:reqVer` → `state=COMPLETED, version+=1` (corrige achado "só SUBMITTED")
8. Delete/Put no item espelhado AP7b, se aplicável

`documentId=:sameDoc`/`requirementId=:sameReq` nas condições acima são os **fences de integridade referencial explícitos** que a Rodada 2 apontou como ausentes — cada Update condicional verifica não só a versão OCC do item mas também que ele ainda pertence à entidade-pai esperada, fechando o gap.

## Bloqueador 3 — Coberto acima (AP7b, AP8 com responsável, AP4 com ordenação por atividade)

## Bloqueador 4 — `DocumentVersionEvent` formalmente distinto de `OutboxEvent`

Aceito o achado: `src/shared/outbox/outbox.ts` cria `OutboxEvent` para publicação assíncrona (fila/consumidor), não um log de auditoria consultável por `SK=VERSION#<seq>#EVENT#<id>`. **Correção**: `DocumentVersionEvent`/`DocumentRequestEvent` são um item type próprio, gravado como item comum na mesma `TransactWriteItems` (não usam `outbox.ts`). Se uma transição precisar também de efeito assíncrono (ex.: notificar responsável), um `OutboxEvent` **adicional** é gravado na mesma transação — mecanismo separado, contabilizado à parte na contagem de itens (a transação de `acceptVersion` acima já reflete isso: 6–8 itens são só o domínio, um `OutboxEvent` de notificação seria item adicional se aplicável, nomeado como tal quando a rota de notificação for desenhada, fora do escopo desta rodada de arquitetura de dados).

## Bloqueador 5 — Idempotência real (token + hash de payload + resultado reconciliável)

Toda mutação (`commitUpload`, `acceptVersion`, `rejectVersion`, `submitVersion` do guest) recebe um `clientRequestToken` do chamador. Contrato:

- `DocumentVersionEvent`/`DocumentRequestEvent` de cada operação carrega `SK=...#EVENT#<clientRequestToken>` (chave, não campo) + `payloadHash=SHA-256(comando canônico)`.
- Write condicional: `attribute_not_exists(PK_SK)`. Se falhar por já existir:
  - se `payloadHash` bate → **replay legítimo**, handler responde 200 com o estado persistido lido de volta (idempotência real, não um "estado atual" genérico desacoplado do comando original — corrige o achado da Rodada 2).
  - se `payloadHash` diverge → **token reaproveitado com payload diferente**, 409 `IdempotencyKeyConflictError` (mesmo padrão de erro nomeado já usado no projeto para conflitos de idempotência, ex. `CreateItem`).
- Isso substitui a regra genérica "estado terminal responde com o estado atual" da Rodada 2 (que não amarrava token a payload) por uma regra verificável.

## Bloqueador 6 — Fluxo C3 comprimido: uma única transação, não três sequenciais

**Correção estrutural** (elimina a janela de falha parcial apontada pela Rodada 2, em vez de "tratá-la"): quando o ator tem permissão de auto-aceitar, `commitUpload+claimReview+acceptVersion` deixam de ser 3 transações sequenciais e passam a ser **uma única `TransactWriteItems`**:

1. Put/Update Version: `state: DRAFT → ACCEPTED` diretamente (uma única escrita no item, condição `state=DRAFT AND version=:v`)
2. Put `DocumentVersionEvent(RECEIVED)`, Put `DocumentVersionEvent(CLAIMED)`, Put `DocumentVersionEvent(ACCEPTED)` — três eventos, mesmo `actor`/timestamp, provando que a sequência lógica ocorreu, sem exigir 3 estados físicos intermediários na Version em si
3. + itens 1–2/6–8 da transação de `acceptVersion` acima, no mesmo `TransactWriteItems`

Não há mais "3 chamadas sequenciais" nem janela onde `commitUpload` teria sucesso e `claimReview` falhasse — é tudo-ou-nada. Para o fluxo NÃO comprimido (upload externo/guest, revisão real depois), a state machine da Rodada 2 permanece válida tal como descrita (RECEIVED e UNDER_REVIEW são, aí sim, estados fisicamente persistidos e observáveis por tempo real, porque não há compressão).

**Claim como trava real** (corrige achado "decorativa"): `acceptVersion`/`rejectVersion` fora do fluxo comprimido agora exigem `resource.reviewerId === ctx.principal.userId OR roles inclui ADMIN/OWNER` (reaproveitando exatamente o mesmo mecanismo de bypass ownership que `authorize()` já implementa para `ownerUserId`/`assigneeUserId` — não é mecanismo novo, é o branch já existente na função real, antes não conectado a este fluxo). `MEMBER` sem ser o `reviewerId` não pode decidir uma version que outro `MEMBER` reivindicou; `ADMIN`/`OWNER` sempre podem (paridade de conteúdo já estabelecida em B2B-7/D-097).

**Evento do sweeper de claim expirada**: adicionado `DocumentVersionEvent(CLAIM_EXPIRED)` na mesma escrita condicional do sweeper.

## Bloqueador 7 — Segurança do Guest: interstitial obrigatório, CSRF, hash/entropia, rate limit multidimensional

- **Interstitial obrigatório** (não mais mitigação condicional): a troca de `RequestAccessCredential` por `GuestSession` exige uma ação humana explícita (`POST` de um botão "Continuar", nunca disparado automaticamente por navegação/prefetch) antes de `DocumentRequest.state→OPENED` ser setado — elimina o falso positivo de scanner por construção, não por aposta em comportamento de scanner.
- **CSRF**: `GuestSession` emite um token CSRF (double-submit cookie, mesmo padrão OWASP CSRF Cheat Sheet) obrigatório em todo `POST` subsequente (upload, submit) — ausente na Rodada 2, adicionado agora.
- **Hash/KDF**: secret da credencial armazenado como Argon2id (OWASP Password Storage Cheat Sheet), nunca SHA puro; secret gerado com ≥128 bits de entropia (NIST SP 800-63B-4 §5.1.2), comparação em tempo constante.
- **`Referrer-Policy: no-referrer`** em toda rota `/guest/*`; página guest não carrega nenhum recurso de terceiro (analytics, fontes externas, etc.) — fecha o vazamento por Referer/logs de terceiros que a Rodada 2 apontou (path continua podendo aparecer em logs de acesso do próprio backend — aceito como exposição residual mínima, mitigada por rotação/expiração da credencial, não eliminável sem quebrar o modelo de link).
- **Rate limit multidimensional**: duas chaves combinadas — `requestId` (evita abuso de uma solicitação específica) **e** IP de origem (evita abuso distribuído por scanner/bot) — nunca isoladas, corrigindo o vetor de DoS direcionado apontado.
- **Rate limiter real**: aceito que `initial-invite-rate-limiter.ts` está acoplado a `SubjectStore`/convites — nesta rodada isso vira um **item de refatoração nomeado** (extrair a lógica genérica de janela deslizante para `src/shared/rate-limit/` reutilizável por Invitation e por Guest Request), não mais "reaproveitar como está". Trabalho de implementação, não decisão de arquitetura nova.
- **Consumo de submit**: escopo esclarecido — idempotência é por `(requestId, clientRequestToken)`, nunca por "a credencial" (que é reutilizável). Uma correção pós-rejeição gera novo `DocumentRequest`/nova credencial (Decisão 8 corrigida abaixo), então não há ambiguidade entre tentativas.

## Bloqueador 8 — Requirement: reindexação real via job, coerente com o status indexado

Aceito o achado: sem job, a leitura derivada (`agora >= validUntil`) diverge do status persistido na GSI1 (AP7). **Correção**: um job diário (EventBridge Scheduler, mesmo padrão de `tenant-purge-sweeper`/D-124 e do materializador de reminders já existentes) varre Requirements com `status=SATISFIED` e `evidenceVersionId` cujo `validUntil < now`, e escreve `status=NOT_SATISFIED` via update condicional (`status=SATISFIED AND version=:v`). Isso torna a frase "muda só em evento discreto" literalmente verdadeira: a passagem para `NOT_SATISFIED` por vencimento é, na prática, o evento discreto "o job de hoje rodou e encontrou isso vencido" — mesmo modelo que `ExpirationItem` já usa via seu worker de expiração (não um mecanismo novo, aplicado ao Requirement).

`EXPIRING` continua sendo só apresentação (subdivisão de `SATISFIED` calculada em leitura, sem reindexação) — não muda de bucket na GSI, só o `SATISFIED→NOT_SATISFIED` real precisa do job.

**Lookup de "request aberto de um Requirement"**: resolvido pelo item espelhado AP7b (Bloqueador 2).

**Relink "mesmo Document"**: resolvido pela nova GSI5 `VERSIONLOOKUP` (AP11) — a transação de `acceptVersion` lê a Version anterior do Requirement via esse índice e compara `documentId` antes de decidir o relink automático, com fence explícito na condição do item 6 da transação (`requirementId=:sameReq`).

## Bloqueador 9 — Arquivo por-arquivo: estado próprio e bloqueio do aceite

`DocumentFile.scanStatus: PENDING | CLEAN | INFECTED` (reaproveita literalmente `quarantine-key.ts`/`clean-key.ts`, que existem — corrigida a citação errada de `parser-sandbox.ts`, que na verdade vive em `src/workers/parser-sandbox/parser.ts`; o worker publica o resultado do scan, que atualiza `DocumentFile.scanStatus`). A condição do item 4 da transação de `acceptVersion` (Bloqueador 2) agora inclui `ALL_FILES_CLEAN` — implementado como um contador desnormalizado `DocumentVersion.pendingFileScans` (incrementado a cada `DocumentFile` criado com `scanStatus=PENDING`, decrementado quando o worker marca `CLEAN`; `acceptVersion` condiciona `pendingFileScans=0`) — evita a corrida "revisor aceita enquanto um complementar ainda está em scan". Adicionar/trocar arquivo durante `RECEIVED`/`UNDER_REVIEW` incrementa esse contador e, se `UNDER_REVIEW`, reverte o estado para `RECEIVED` (condicional) — invalida uma decisão de aceite que estava "prestes a acontecer" sobre um conjunto de arquivos que acabou de mudar, fechando a corrida com o revisor apontada pela Rodada 2.

## Bloqueador 10 — Mapeamento real por entidade a D-127

Correção: nenhuma entidade nova "reaproveita `HELD_FOR_RECOVERY`" diretamente (esse é estado de `TenantLifecycleRecord`, confirmado). Em vez disso, cada entidade ganha uma **classe de retenção nomeada**, seguindo o vocabulário de classes já definido em D-127 (`docs/architecture/reviews/quarantine-retention-scoping/estado-final-consolidado.md`), com prazo/gatilho próprios:

| Entidade | Classe (D-127) | Gatilho | Prazo proposto |
|---|---|---|---|
| `Document`/`DocumentVersion` ACCEPTED/SUPERSEDED | `USER_DOCUMENT` | `document:delete` explícito (nunca automático) | conforme classe já definida em D-127 para `USER_DOCUMENT` |
| `DocumentVersion` REJECTED/`DocumentFile` órfão de DRAFT abandonado | `DELIVERY_RECORD`-equivalente (evidência de tentativa, não documento aceito) | idade desde `rejectedAt`/`WITHDRAWN` | prazo curto, a definir na implementação real (fora desta rodada) |
| `DocumentVersionEvent`/`DocumentRequestEvent` | `SECURITY_AUDIT`-equivalente ou nova classe "operational audit log" (nomeado explicitamente como gap se nenhuma classe existente couber — decisão de produto/compliance para sessão de implementação, não inventada aqui) | nunca purgado antes do Document pai | — |

Implementação real (prazos exatos, cascata, legal hold) fica para a sessão de implementação dedicada, mesmo padrão já usado por D-127 em si (`DESIGN-ONLY`) — mapeamento por classe, não prazo numérico, é o que esta rodada de arquitetura fecha.

## Bloqueador 11 — Recorrência: ciclo vs. tentativa

Correção adotando a separação que a Rodada 2 pediu:

- `occurrenceId` — identidade estável do CICLO (ex. "a cobrança de outubro/2026"), gerado uma vez pelo scheduler, nunca reaproveitado.
- `requestId` — identidade de cada TENTATIVA dentro daquele ciclo (a solicitação original E cada correção são `requestId`s distintos).
- `attemptIndex` — 1 para a solicitação original, incrementado a cada correção.
- `parentRequestId` — sempre aponta para a tentativa IMEDIATAMENTE anterior do mesmo `occurrenceId` (esclarece a ambiguidade apontada).

Materialização idempotente do scheduler: put condicional chaveado por `seriesId#occurrenceId` (uma vez por ciclo, nunca por tentativa) — resolve a colisão real que a Rodada 2 encontrou (`seriesId#occurrenceIndex` colidindo entre original e correção): agora a correção usa o MESMO `occurrenceId` mas um `requestId` novo, então nunca tenta re-materializar o ciclo, só cria uma nova tentativa dentro dele. Pausa/encerramento/timezone/catch-up seguem fora do escopo desta rodada (nomeados como trabalho de implementação do 4º núcleo, já sinalizado como não-urgente na Rodada 1) — só a FORMA de identidade precisava fechar agora, porque `Requirement.status=PENDING` (Bloqueador 8/AP7b) já depende de "existe tentativa aberta", não de "existe ciclo".

## Bloqueador 12 — A1 (download Viewer) genuinamente aberta, nenhuma action nova

Correção: **nenhuma action `document:download` é adicionada à matriz nesta rodada.** O endpoint de download não é construído até a decisão de produto existir — arquitetura só garante que, quando a decisão vier, adicionar a action é mudança aditiva (não uma migração), porque `document:read`/preview já cobre o caso hoje aprovado, e download é estritamente um caso novo, não uma reinterpretação de `document:read`.

---

**Itens ainda fora desta rodada**: limites de plano/GB, portal de cliente completo, autoaceitação por IA sem revisão, assinatura eletrônica, pastas, prazos numéricos de retenção por classe, timezone/pausa/catch-up de recorrência, extração do rate-limiter genérico (nomeada, não feita).
