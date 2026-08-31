# Rodada 3 — Tréplica final Claude — Admin Activity/Audit Log View

Nota cega Rodada 2: Claude (auto, antes de ver Codex) 8,4. Codex: 8,25. Aceito os 5 achados
integralmente — nenhum é estilístico, todos apontam buraco real de especificação.

## 1. Cursor — corrigido para 4 streams

Correto: introduzir `TenantAuditEvent` torna o feed uma composição de 4 partições
(`expiration`, `organization`, `subject`, `tenant`/export), não 3. Cursor composto revisado:
`{ expirationLek?, organizationLek?, subjectLek?, tenantLek? }`, mesmo algoritmo k-way merge,
agora sobre 4 buffers. Escolha explícita entre as duas opções que o Codex levantou: **cursor
por último-item-consumido por partição** (não buffers protegidos) — cada partição avança seu
próprio LEK real da API DynamoDB (`ExclusiveStartKey` = o item real após o último devolvido ao
cliente naquela partição), nunca um buffer em memória entre chamadas HTTP (que exigiria estado
de sessão no servidor, inaceitável para uma API stateless). Ordem: `(occurredAt ISO string,
auditEventId)` ascendente ou descendente conforme parâmetro `order` (default descendente —
mais recente primeiro, precedente de todo feed de atividade pesquisado). Snapshot: cada página
lê o estado atual de cada partição no momento da chamada (sem lock de leitura entre páginas) —
mesma consistência eventual que qualquer outra list view já existente no produto (nenhuma
lista paginada do sistema hoje usa snapshot isolation; não introduzir uma exigência nova aqui).
Trade-off documentado: um evento inserido entre duas chamadas de página pode aparecer
duplicado ou ser pulado no limite exato da página — aceitável para um feed de atividade
(mesma classe de trade-off que paginação de qualquer feed cronológico em produção), não
aceitável seria perder um evento permanentemente, o que não acontece (ele aparece na próxima
consulta daquele mês, só pode mudar de posição relativa por 1 página).

## 2. Idempotência do export — invariante persistente

Correto: `correlationId` sozinho não impede duplicata se ele não for estável entre retries. Design
revisado: o `export-handler.ts` gera, ANTES de autorizar/processar, um `exportRequestId`
determinístico = hash estável de `(tenantId, actorUserId, dia-calendário-UTC)` — não do
`correlationId` de infraestrutura (que pode mudar por retry de gateway). O `Put` condicional do
`TenantAuditEvent` usa esse `exportRequestId` como parte da `SK` (`SK=EVT#<occurredAt>#<
exportRequestId>`) E adiciona uma segunda entrada de unicidade na MESMA transação: um item
ponteiro `PK=TENANT#<id>#EXPORTLOCK#<exportRequestId>`, `SK=LOCK`, `ConditionExpression:
attribute_not_exists(PK)` — se um segundo export do MESMO ator no MESMO dia UTC tentar
registrar auditoria, a condição falha e o handler trata como "já registrado hoje", loga um
warning (não um erro fatal — o CSV já foi entregue, a auditoria é best-effort registrada uma
vez por ator/dia, não por requisição). Falha-fechado explícito: se a escrita do
`TenantAuditEvent` falhar por qualquer razão QUE NÃO seja a condição de duplicata (ex.
throttling), a resposta HTTP ainda devolve o CSV (não bloquear a entrega por causa da
auditoria) mas loga erro via `SecureLogger` com `correlationId` real para investigação — mesmo
princípio de "auditoria nunca bloqueia a operação principal" que university/mercado adota para
audit logs (achado de pesquisa: nenhum dos 4 produtos pesquisados bloqueia a ação do usuário se
o log de auditoria falhar - GitHub/Slack tratam audit log como best-effort assíncrono).

## 3. Checklist E-014 — reconciliado

Aceito o achado processual: registrar como falha de Rodada 1, checklist real nasce aqui. Versão
final, âncoras objetivas, só os critérios genuinamente informados por padrão externo (2 de 5,
não 5 de 5 — os outros são internos, removidos da sub-rubrica em vez de "declarados mas
mantidos"):

| # | Critério (peso) | Âncora atende/não-atende | Evidência |
|---|---|---|---|
| 1 | Admin-only, nunca member-facing (peso 3) | Atende se RBAC gate ≥ tier administrativo | GitHub: acesso restrito a "organization owners"/"users with the audit log role" (docs.github.com/.../reviewing-the-audit-log-for-your-organization, 2026-08-31). Notion: "workspace owners and compliance admins" (notion.com/help/audit-log, 2026-08-31). |
| 2 | Feed cronológico com actor+ação+objeto+timestamp em prosa curta, não log bruto (peso 3) | Atende se cada linha renderiza essas 4 partes sem exigir o usuário decodificar JSON | Confirmado GitHub e Notion nas mesmas fontes acima. Linear removido do checklist — a fonte encontrada (linear.app/docs/user-views) descreve "activity feed" de produto, não uma trilha administrativa equivalente; não usar como evidência de padrão admin (correção do achado do Codex). |

Critérios removidos da sub-rubrica pesada (não são padrão externo, são decisão interna deste
projeto, mantidos só como nota informativa sem peso): filtro simples vs. busca livre (decisão
de orçamento de engenharia do próprio projeto, não um padrão que mercado "resolveu" de forma
única — Slack oferece busca, Notion não, sem convergência real); retenção diferenciada por
tier (não aplicável, projeto não tem tiers pagos, D-052).

## 4. `organization:close` — classificado, não mais "não verificado"

Verificado agora: `grep` dos 7 call sites de `appendMembershipAuditToTransaction`/
`buildMembershipAuditEvent` em `src/modules/organization/application/` — `remove-membership.ts`,
`leave-organization.ts`, `revoke-invitation.ts`, `create-invitation.ts`,
`change-membership-role.ts`, `accept-invitation.ts` aparecem; `close-organization.ts` (D-124)
NÃO aparece. Confirma: fechar organização não grava nenhum `AuditEvent` hoje.

Classificação (achado #4 do Codex): **`missing to implement` — gap real, mesma classe do gap de
export, mas fora do escopo desta rodada de decisão** (Marcelo citou renovação/criação/
exportação como o pedido central; fechar organização é uma ação rara, já auditável de outra
forma — `TenantLifecycleRecord`/state machine do W3-07 registra `DELETING`/timestamps, ainda
que não no formato deste feed). Registrado explicitamente como **trabalho futuro nomeado**,
não como "resolvido indiretamente" (correção da linguagem inválida da Rodada 2) — mesmo
tratamento que a lista "Gates / bloqueios abertos" do `NEXT_SESSION_PROMPT.md` já usa para
outros itens.

## Fechamento

Com os 5 achados da Rodada 2 endereçados com correção real (não cosmética) em cada um, a
Rodada 3 encerra o protocolo. Escopo final: DESIGN-ONLY, ver `estado-final-consolidado.md`
para a decisão consolidada.
