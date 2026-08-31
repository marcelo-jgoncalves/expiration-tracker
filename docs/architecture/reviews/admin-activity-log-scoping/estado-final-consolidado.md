# Estado final consolidado — Admin Activity/Audit Log View

**Status: `APPROVED` (design), protocolo Claude↔Codex completo, 5 rodadas (mínimo 3 excedido
porque as 2 primeiras não convergiram — nota real, não arredondada). Nota cega final: Claude
9,3 / Codex 9,40 — ambos ≥9,00. Registrado como `docs/architecture/decisions-log.md` D-131.**

Pedido de origem (Marcelo, 2026-08-31): ADMIN/OWNER ver o que outros membros da organização
fizeram — renovação/criação de item, exportação de dados, e qualquer outra ação relevante —
visibilidade real, não logs internos crus.

## Trajetória das notas (protocolo de nota cega, sem arredondar)

| Rodada | Claude (auto, antes de ver Codex) | Codex | Convergiu? |
|---|---|---|---|
| 1 | (proposta inicial, sem auto-nota prévia) | 6,85 | Não — checklist E-014 ausente, cursor não especificado, gap de export mal desenhado |
| 2 | 8,4 | 8,25 | Não — cursor só cobria 3 de 4 partições, idempotência do export inexistente, `organization:close` não classificado |
| 3 | 8,9 | 8,10 | Não — cursor com semântica inventada, idempotência colapsava exports legítimos, fail-open descrito como fail-closed, URLs do checklist abreviadas |
| 4 | 9,1 | 8,70 | Não — único achado restante: cursor podia perder itens buscados-mas-não-consumidos por partição |
| 5 | 9,3 | 9,40 | **Sim — ambos ≥9,00** |

## Decisão consolidada

**1. Shape dos 3 `AuditEvent` existentes**: estrutural e semanticamente compatíveis (mesma
convenção `PK=TENANT#<id>#<KIND>#<yyyyMM>`/`SK=EVT#<timestamp>#<id>`, mesmos campos
`actor`/`action`/`resourceType`/`resourceId`/`changes`/`occurredAt`/`correlationId`,
mesma garantia de escrita append-only na mesma `TransactWriteItems` do agregado). NÃO exige
reconciliação de schema antes de um feed unificado — as divergências (nome do campo de
tenant, infixo do PK, union de ações própria por módulo) não impedem 3 (agora 4, ver item 5)
`Query`s por PK-prefix mergeadas em memória.

**2. Escopo v1**: feed cronológico leve de atividade (actor + ação em texto legível + recurso +
timestamp), não audit log completo/pesquisável. Filtro simples por mês (reaproveita o
sharding mensal existente) e por tipo de recurso. Sem full-text search — mesmo padrão de v1
que GitHub Org Audit Log/Slack Enterprise Grid/Notion Workspace Activity Log adotam
(pesquisa externa `SIM PARCIAL`, checklist E-014 abaixo).

**3. RBAC**: novo action `activity:read`, gate `ADMIN_ROLES` (`OWNER`/`ADMIN`, `src/modules/identity/domain/authorization.ts`)
— mesmo tier de `item:export`, justificativa: visibilidade sobre ações de terceiros é
informação sensível equivalente em disclosure a bulk export, não segue o precedente mais
permissivo de leitura do próprio recurso.

**4. Query pattern**: `GET /activity` → 4 `Query`s por mês-alvo (default mês corrente, sem
paginação cross-month transparente em v1) sobre as partições `expiration`/`organization`/
`subject`/`tenant` (nova, ver item 5), merge k-way por `(occurredAt, auditEventId)`. Cursor
composto opaco: um campo por partição, cada um contendo a chave `{PK, SK}` REAL do último item
DAQUELA partição que efetivamente entrou na página devolvida ao cliente (nunca o
`LastEvaluatedKey` bruto do fetch, que pode incluir itens buscados-mas-descartados no corte do
merge — perderia eventos permanentemente). Partição que não contribuiu itens numa página não
avança seu cursor. Custo aceito: releitura ocasional de itens já buscados mas não consumidos —
nunca perda determinística. Nenhum GSI novo — Query direto por PK, mesmo padrão já usado
isoladamente por `expiration/audit-event.ts`. Paginação é eventualmente consistente entre
páginas (mesmo trade-off que toda outra list view do produto já aceita) — sem snapshot
isolation em v1.

**5. Gap de export fechado**: `ExpirationService.exportItems()` (linha 618) não gravava
`AuditEvent` — confirmado. Fecha com um 4º agregado-irmão, `TenantAuditEvent`
(`resourceType: "ExpirationExport"`, chave própria `PK=TENANT#<id>#TENANTAUDIT#<yyyyMM>`, sem
`itemId`/`newVersion` obrigatórios — não força a operação tenant-wide dentro do shape de
`AuditEvent` de `ExpirationItem`, que exige ambos). Escrita condicional acontece após o CSV
ser serializado, antes da resposta HTTP ser enviada — **fail-open**: se a gravação falhar, a
resposta com o CSV é enviada de qualquer forma (auditoria nunca bloqueia a entrega), erro
logado via `SecureLogger`. Idempotência: `exportRequestId` gerado por requisição
(`crypto.randomUUID()`) ou herdado de um header opcional `Idempotency-Key` do cliente (padrão
REST estabelecido, ex. Stripe) para o caso estreito de retry de infraestrutura; item de lock
dedicado `PK=TENANT#<id>#EXPORTLOCK#<exportRequestId>`/`SK=LOCK` com `ConditionExpression:
attribute_not_exists(PK)` na mesma transação — chave do lock usa somente `exportRequestId`,
nunca timestamp, para não permitir duplicata de retry real nem colapsar exports legítimos
repetidos no mesmo dia. `changes: { exportedCount }` apenas, nunca itens exportados.

**6. `organization:close` (D-124)**: verificado via grep — não grava `MembershipAuditEvent`
hoje. Classificado explicitamente `missing to implement`, gap real mas fora do escopo desta
rodada (Marcelo citou renovação/criação/exportação como pedido central; fechamento de
organização já é rastreável via `TenantLifecycleRecord`/state machine do W3-07, ainda que fora
do formato deste feed). Registrado como trabalho futuro nomeado, não como resolvido.

**7. Retenção**: os 3 (agora 4) tipos de `AuditEvent` mapeiam para a classe `SECURITY_AUDIT` já
priorizada em D-127 (prioridade 3 de purga LGPD, `createdAt+365d`) — reconciliação: para estas
entidades imutáveis, `occurredAt` É o relógio canônico equivalente a `createdAt` (não existe
campo separado). Quando o worker de purga real de `SECURITY_AUDIT` for implementado (item 6 do
`NEXT_SESSION_PROMPT.md`), o feed refletirá a purga automaticamente — não antes, porque o
worker ainda não existe.

**8. Superfície HTTP/frontend**: v1 inclui frontend mínimo, uma tela somente-leitura atrás do
mesmo gate de rota admin-only já usado em Settings/Members. Justificativa: o pedido de Marcelo
é literalmente "ver o que os demais usuários fizeram" — um endpoint sem UI não entrega isso a
um ADMIN real. Diferente do padrão "backend primeiro" de mecanismos internos sem interação
humana direta (ex. purge orchestration); aqui a interação humana é o produto pedido.

## Pesquisa externa (E-014)

Declaração: **SIM PARCIAL**. Checklist final, 2 critérios pesados com âncora objetiva e fonte
verificável (3 critérios inicialmente listados na Rodada 1 foram rebaixados a nota informativa
sem peso na Rodada 3 — não são padrão externo convergente, são decisão interna de orçamento de
engenharia deste projeto):

| # | Critério (peso) | Atende se | Fonte |
|---|---|---|---|
| 1 | Admin-only, nunca member-facing (peso 3) | RBAC gate ≥ tier administrativo | https://docs.github.com/en/organizations/keeping-your-organization-secure/managing-security-settings-for-your-organization/reviewing-the-audit-log-for-your-organization ; https://www.notion.com/help/audit-log |
| 2 | Feed cronológico legível (actor+ação+objeto+timestamp em prosa curta) (peso 2) | Cada linha renderiza as 4 partes sem exigir decodificar JSON | Mesmas 2 fontes acima |

## Estado do design vs. implementação

**DESIGN-ONLY nesta sessão** — mesmo padrão de D-127 (quarentena/retenção). Implementação real
(handler `GET /activity`, `ActivityService`, `TenantAuditEvent`, mudança em `exportItems()`,
tela frontend, testes de contrato/paginação/mutação) fica para sessão(ões) futura(s) dedicada(s)
— justificativa: o volume de mecanismo especificado corretamente nesta rodada (cursor composto
de 4 streams com semântica de posição exata, idempotência via lock condicional, novo tipo de
evento) é trabalho de implementação real com sua própria suíte de testes, não algo a espremer
no mesmo round que ainda fechava o desenho até a Rodada 5.

## Trabalho futuro nomeado (não esquecido)

1. Implementação real do design acima (handler, service, tela `ActivityLog.tsx`, testes).
2. `organization:close` emitir `MembershipAuditEvent` (gap #6 acima).
3. Anotar `occurredAt` como campo canônico equivalente a `createdAt` na implementação real do
   worker de purga `SECURITY_AUDIT` (item 6 do `NEXT_SESSION_PROMPT.md`, D-127).
4. `snapshotUpperBound` (timestamp de corte fixo por sessão de paginação) — candidato de v2 se
   o comportamento observado em produção mostrar necessidade real; não implementado agora por
   proporcionalidade (`docs/engineering/principles.md` #1).
