# Rodada 1 — Proposta Claude — Admin Activity/Audit Log View

Pedido (Marcelo, 2026-08-31, verbatim resumido): ADMIN/OWNER deve conseguir ver o que outros
membros da organização fizeram — renovação, criação, exportação de dados, e qualquer outra ação
relevante. Ele quer uma superfície de visibilidade real, não logs internos crus.

Pesquisa externa considerada: SIM PARCIAL (fontes: GitHub Org Audit Log docs, Slack Enterprise
Grid "Org-Level Audit Logs" API docs, Notion "Workspace activity log" help center, Linear
"Activity" view docs — todas acessadas 2026-08-31). Escopo: o padrão de mercado (feed
cronológico legível, actor+ação+recurso+timestamp, filtro por membro/tipo de ação, retenção
diferenciada por tier) informa a FORMA da superfície (item 1/2/6 abaixo); o mecanismo de query
(3 partições DynamoDB já existentes) e a reconciliação com D-127 são puramente internos.
Achado de mercado: todos os 4 produtos pesquisados tratam "member activity/audit log" como
recurso admin-only, todos mostram actor+ação+objeto+timestamp em prosa curta, GitHub/Slack
retêm 90-180 dias no tier grátis com export/API para retenção maior — não achamos padrão de
"log completo pesquisável" em v1 de nenhum concorrente; todos começam como feed cronológico
com filtro simples.

## 1. Achado de shape (verificação direta dos 3 arquivos)

`src/modules/expiration/domain/audit-event.ts`, `organization/domain/audit-event.ts`,
`subject/domain/audit-event.ts` — os 3 seguem a MESMA convenção estrutural: `PK=TENANT#<id>#<KIND>#<yyyyMM>`
(KIND = `AUDIT`/`MEMBERSHIPAUDIT`/`SUBJECTAUDIT`), `SK=EVT#<timestamp>#<id>`, mesmo padrão de
campos (`actor`, `action`, `resourceType`, `resourceId`, `changes` redigido, `occurredAt`,
`correlationId`), mesma garantia de escrita (append-only, dentro do MESMO `TransactWriteItems`
do agregado, nunca uma chamada separada). As divergências são: (a) nome do campo de tenant
(`tenantId` vs `organizationId` — mesmo valor semântico, nomes diferentes por módulo), (b) o
infixo do PK (`AUDIT`/`MEMBERSHIPAUDIT`/`SUBJECTAUDIT`), (c) `AuditAction` é uma union fechada
por módulo (não compartilhada).

**Conclusão**: NÃO são genuinamente divergentes a ponto de exigir reconciliação de schema antes
de um v1. São 3 partições irmãs com o mesmo formato físico e semântico, só chaveadas por prefixo
diferente. Um feed unificado é 3 `Query` (uma por PK por mês, já é o padrão de acesso existente
sem GSI novo) + merge em memória por `occurredAt` — não uma única `Query`, mas também não "algo
mais difícil" que precise de índice novo ou de um schema compartilhado primeiro. É tratável em
v1 direto, sem passo de reconciliação de schema.

## 2. Escopo v1

Feed leve de atividade (não audit log completo/pesquisável): lista cronológica paginada,
actor + ação (traduzida para texto legível, ex. "Maria renovou Contrato XPTO") + recurso +
timestamp, com filtro simples por mês (reaproveita o sharding mensal existente — não paginar
"tudo" por padrão) e por tipo de recurso (Item/Subject/Membership). Sem full-text search, sem
filtro arbitrário por campo livre — isso fica para uma v2 se houver demanda real, mesmo padrão
que os 4 concorrentes pesquisados adotam para v1.

## 3. RBAC

Novo action `activity:read`, gate `ADMIN_ROLES` (mesmo tier de `item:export`) — ver a mesma
`authorization.ts` reason já usada lá: "member ações de outros" é informação sensível sobre
outras pessoas, não follow o precedente mais permissivo de leitura do próprio recurso.

## 4. Query pattern

Handler novo `GET /activity` (nome provisório) → `ActivityService.listActivity(ctx, { month?,
resourceType?, cursor? })` → 3 `queryBase` (uma por PK-prefix por mês-alvo, default = mês
corrente) já com o mesmo shape de paginação (`limit`+`cursor`) usado em outros handlers list.
Sem GSI novo — nenhuma das 3 partições precisa de índice global, é Query direto por PK,
igual ao padrão já estabelecido para `expiration/audit-event.ts` sozinho.

## 5. Retenção

Reconcilia com D-127: os 3 tipos de AuditEvent (expiration/organization/subject) mapeiam para a
classe `SECURITY_AUDIT` já priorizada (prioridade 3, `createdAt+365d`) no purge LGPD. Este feed
LÊ exatamente os dados que D-127 já escopou reter/purgar — não introduz retenção nova nem
contradiz a prioridade decidida; quando a implementação real de D-127 (item 6 do
NEXT_SESSION_PROMPT) rodar, o feed automaticamente reflete a purga (itens >365d somem porque o
worker os apaga, não porque o feed filtra).

## 6. Gap de export

Confirmado por leitura direta: `ExpirationService.exportItems()` (linha 618) NÃO grava
`AuditEvent` — `item:export` autoriza e devolve os itens, mas nenhuma escrita ocorre (é uma
leitura pura, não há `TransactWriteItems` no fluxo). Isso é uma lacuna real: Marcelo pediu
explicitamente que exportação apareça no feed. Proposta: fechar no mesmo round — adicionar
`"EXPORT"` a `AuditAction`, e `exportItems()` grava um `AuditEvent` (`resourceType:
"ExpirationItem"`, `resourceId: "*"` ou um sentinel de escopo, `changes: { exportedCount }`)
via um `TransactWriteItems` de item único (não há agregado mutando, mas a garantia de
append-only continua valendo — vira uma transação de 1 item em vez de N). Pequeno e mecânico:
1 novo valor de union + ~10 linhas no handler existente + teste de contrato/unit.

## 7. Superfície HTTP/frontend

V1 inclui frontend mínimo: uma tela `ActivityLog.tsx` (lista simples, sem edição) atrás do
mesmo gate de rota admin-only já usado em Settings/Members. Justificativa: o pedido de Marcelo é
literalmente "ver o que os demais usuários fizeram" — um endpoint sem UI não entrega isso a ele
nem a um ADMIN real; o precedente "backend primeiro, UI depois" dos waves anteriores era para
mecanismos internos (purge orchestration) sem interação humana direta, este é o oposto: a
interação humana É o produto pedido.

## Nota de risco/escopo

Nível 5 de `change-risk-scale.md` (novo endpoint HTTP com RBAC novo, nova superfície
user-facing expondo dados de outros usuários — decisão difícil de reverter uma vez que ADMINs
passam a confiar nela). Protocolo completo aplicável.
