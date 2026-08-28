# W3-07 — Round 2 (Claude tréplica, respondendo à Rodada 1 do Codex, nota 3,4/10, 8 achados bloqueantes)

Rodada 1 achou problemas reais e mudou o desenho de fundo, não só detalhes. Resposta reorganiza
o mecanismo: **cascata de exclusão deixa de reusar a fila GSI6** (achado 5) e vira um
discover-then-delete direto e conditioned, com convergência explícita (achado 1/8) e uma
taxonomia fechada por `entityType` (achados 2/3/4).

## Resolução achado 5 (colisão de GSI6) — mudança estrutural: sem fila GSI6 para cascata

Aceito por completo: reusar `WORKSTATE#PURGE_PENDING/CLAIMED` roubaria linhas de workflows já
donos legítimos daquele ponteiro (`UploadSlot` reconciliação, ocorrências CLAIMED). **Cascata
de tenant não usa GSI6 de forma nenhuma.** Novo mecanismo: `TenantCascadeDeletionService`
executa, por página de `Scan`, um `TransactWriteItems` de **`Delete` direto, condicionado**
(sem intermediário de fila/claim) — nenhum ponteiro GSI6 é lido, escrito ou removido por este
mecanismo. GSI6 continua exclusivo dos seus 4 donos existentes.

Isso também simplifica o branch "genérico" que a achado 4 criticava: não existe mais um
worker genérico reusando `DocumentPurgeWorker` — a exclusão acontece diretamente no
`TenantCascadeDeletionService`, síncrona ao Scan (dentro do orçamento de uma invocação, ver
achado 1 abaixo para paginação entre invocações).

## Resolução achado 4 (fail-open) + achado 3 (formas incompatíveis) — allowlist fechada por entityType

Nenhum `entityType` desconhecido é tocado — **fail-closed**: um `entityType` fora da tabela
abaixo interrompe o processamento daquela linha, loga um alarme dedicado
(`tenant_cascade_unknown_entity_type`) e marca o `TenantDeletionRequest` como
`BLOCKED_UNKNOWN_ENTITY_TYPE` (não avança, não apaga nada além do já processado) — exige
revisão humana antes de estender a tabela. Três categorias, mapeadas explicitamente por
`entityType` real (levantamento contra `data-model.md` §2 + os `entityType` literais no
código):

| Categoria | `entityType`s | Estratégia de exclusão |
|---|---|---|
| **OCC versionado padrão** | `ExpirationItem`, `ReminderPolicy`, `ReminderOccurrence`, `Document` (+ S3 real via `pickObjectToDelete`, mesma função do W3-06), `DocumentPurgeReceipt`, `ExtractedField`, `ExtractionRun`, `NotificationIntent`, `NotificationAttempt`, `Channel`, `Provider`, `TrackedSubject`, `RequirementAssignment`, `TenantEntitlement`, `ItemWatch`, `DocumentRequest`, `DocumentSubmission`, `DocumentChasingOccurrence`, `DocumentChasingIntent`, `ImportJob`, `ImportDedupRecord`, `User`, `IdentityMapping`, `GuestTokenPointer` | `Delete` condicionado (`attribute_exists(PK) AND attribute_exists(SK) AND version = :v AND tenantId = :t`) — mesmo shape de `buildVersionedDelete`, sem `extraConditions` de GSI6 |
| **Append-only, sem `version`** | `AuditEvent`, `WebhookInbox` (evento já processado, nunca mutado após criação) | `Delete` condicionado só em existência (`attribute_exists(PK) AND attribute_exists(SK) AND tenantId = :t`) — sem checagem de versão, correto porque nada mais escreve nessas linhas depois de criadas |
| **Auto-purgável, excluído do Scan** | `GuestTokenRateLimit`, `InitialInviteRateLimitRecord` | **Não tocado por este mecanismo.** Achado real confirmado no código (`guest-rate-limiter.ts`/`initial-invite-rate-limiter.ts`): ambos já carregam `purgeAfterTtl` (TTL real da tabela) e nunca guardam PII além de um hash — já se autoextinguem independente de qualquer exclusão de tenant, e (`GuestTokenRateLimit` especificamente) nem tem `tenantId` disponível no momento da escrita por design (convidado ainda não resolvido). Documentado como exclusão deliberada, não uma lacuna. |

**Correção mecânica que a achado 2/3 força, feita agora**: `PolicyRef`
(`reminder-policy.ts:69-72`) ganha `tenantId` (valor já disponível em todo call site,
`reminder-policy-service.ts:239` já tem `input.tenantId` em mão) — sem isso, `PolicyRef` nem
seria descoberto pelo Scan (achado 2) nem teria o que uma condição `tenantId = :t` checaria.
Adição puramente aditiva, nenhum call site existente quebra (o campo era simplesmente omitido,
nunca lido por ninguém hoje). Correção real de um gap pré-existente descoberto por esta rodada,
não uma mudança de comportamento do módulo reminder.

## Resolução achado 1 + achado 8 (convergência/"COMPLETED" sem garantia real)

`TenantDeletionRequest.status` ganha uma máquina de passos explícita, não um único Scan:

```
DISCOVERING (passo N) → CONVERGENCE_CHECK → [zero linhas encontradas? COMPLETED : DISCOVERING (passo N+1), até maxPasses]
                                            → excedeu maxPasses com linhas restantes? → INCOMPLETE_NEEDS_REVIEW
```

Cada passo `DISCOVERING`: `Scan` completo paginado (cursor persistido em
`TenantDeletionRequest.lastScanCursor` para retomar entre invocações/timeout de Lambda — achado
não-bloqueante 2 da Rodada 1), deletando cada linha encontrada pela tabela de categorias acima.
Ao fim do Scan completo (cursor esgotado), um **novo** `Scan` (`CONVERGENCE_CHECK`) confirma se
`tenantId = :t` ainda retorna alguma linha:
- **Zero linhas**: `COMPLETED` — esta é a única condição que justifica esse status (resolve
  achado 8: "completo" agora significa "uma varredura real não encontrou mais nada", não "o
  primeiro Scan terminou").
- **Linhas restantes** (escritas concorrentes legítimas durante o passo anterior, ou itens que
  falharam sua condição de exclusão numa passagem anterior): mais um passo `DISCOVERING` sobre
  as linhas remanescentes, até `maxPasses` (proposto: 5 — generoso, já que cada passo só
  processa o que sobrou, converge rápido na prática já que não há um fluxo real criando dado
  novo indefinidamente para um tenant sendo excluído).
- **`INCOMPLETE_NEEDS_REVIEW`** após `maxPasses`: estado terminal honesto, não um falso
  `COMPLETED` — **limitação explícita e documentada** (não escondida): sem bloqueio imediato de
  uso (fora de escopo, decisão do Marcelo), um tenant que continua sendo usado ativamente
  durante a exclusão pode, em tese, criar dado mais rápido do que os passos conseguem drenar;
  isso é o preço concreto de não ter bloqueio imediato, registrado aqui para quem decidir sobre
  a feature de produto completa (W3-07 além deste mecanismo) saber exatamente o que está
  aceitando ao adiar aquele trabalho.

## Resolução achado 6 (falha de lote inteiro por um item conflitante)

`TransactWriteItems` em lote de 25 (mantido como valor escolhido, não limite da API — correção
do achado não-bloqueante 3 da Rodada 1, que apontou 100 como o limite real) que falhar cai para
**exclusão sequencial item a item** dentro do mesmo lote (condicionada individualmente, sem
transação) — isola qual item específico perdeu a condição (já apagado por outro processo
legítimo, ou mutado concorrentemente) sem bloquear os outros 24. Um item que falhe sua condição
sequencialmente é simplesmente pulado (nunca reportado como erro) — se ainda pertencer ao
tenant na próxima passagem de convergência, será descoberto e reprocessado lá.

## Resolução achado 7 (`purgeAfter` imediato contradiz a matriz de 30 dias)

Aceito — remoção completa do conceito de `purgeAfter` deste mecanismo. `TenantCascadeDeletionService.execute(tenantId)`
**não decide quando apagar** — apaga imediatamente quando chamado, e a responsabilidade de só
chamá-lo depois que a janela normativa (30 dias, revisão de `legalHold`, confirmação de
identidade) já se encerrou pertence inteiramente ao chamador (a feature DSR completa, fora de
escopo aqui). Este documento não reabre nem reinterpreta `privacy-lgpd.md` §4 — só entrega a
capacidade de "apagar agora, dado que apagar agora já foi autorizado por outro processo".
`legalHold` (achado já resolvido no W3-06) continua respeitado: a condição de exclusão de
qualquer `Document` inclui `attribute_not_exists(legalHold) OR legalHold = :false`, mesma
condição já normativa desde D-061.

## Estado do design após Rodada 2

Mudança estrutural (sem GSI6), taxonomia fechada de 3 categorias cobrindo todo `entityType`
real do sistema (com um gap real fechado, `PolicyRef.tenantId`), convergência via Scan repetido
até zero ou `maxPasses`, isolamento de conflito por item, e remoção do conceito de `purgeAfter`
deste mecanismo. Peço reavaliação completa.
