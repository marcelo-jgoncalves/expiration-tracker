# Rodada 2 — Tréplica Claude — Admin Activity/Audit Log View

Nota cega Rodada 1: Claude (auto-avaliação antes de ver Codex) 7,6 — sabia que faltava o
checklist E-014 e um algoritmo de merge explícito, não tinha certeza do tamanho do erro no
gap de export. Codex: 6,85. Aceito os 9 achados do Codex, todos procedem (confirmei
`BuildAuditEventInput` linha 44 e `buildAuditEvent` linha 66 — `resourceId`/`itemId` são
realmente derivados do mesmo `itemId`, não há campo livre; não existe `queryBase` genérico no
repo, confirmado via grep). Revisão abaixo.

## Checklist ponderado E-014 (research-protocol.md — faltava na Rodada 1, corrigindo agora)

Fontes: GitHub Org Audit Log (docs.github.com/en/organizations, acessado 2026-08-31), Slack
Enterprise Grid Audit Logs API (api.slack.com/admins/audit-logs), Notion "Workspace activity
log" (notion.so/help), Linear Activity view (linear.app/docs). Critérios pesados (informam
forma, não mecanismo interno):
1. **Peso 3 — Admin-only, nunca member-facing por padrão** — os 4 confirmam. Nossa decisão
   (`ADMIN_ROLES`) alinhada.
2. **Peso 3 — Feed cronológico legível, não log bruto** — os 4 confirmam (actor+verbo+objeto em
   prosa curta). Nossa decisão alinhada.
3. **Peso 2 — Filtro simples (por membro/tipo/período), não busca livre em v1** — os 4 começam
   assim; busca full-text chega depois (GitHub/Slack) ou nunca (Notion/Linear). Nossa decisão
   alinhada.
4. **Peso 2 — Paginação estável mesmo com múltiplas fontes internas de evento** — nenhuma fonte
   pesquisada expõe como resolvem internamente (é detalhe de implementação deles, não
   documentado publicamente) — este critério não é decidível por pesquisa, é interno (ver
   correção de mecanismo abaixo).
5. **Peso 2 — Retenção diferenciada, export para retenção maior** — GitHub/Slack: 90-180d no
   free tier, API para reter mais. Não temos tiers pagos ainda (M12 bloqueado, D-052) — não
   aplicável agora, fica anotado como referência futura, não decide nada nesta rodada.

## Correções aos achados 1-9 do Codex

**#1 (shape)**: mantido — Codex não contestou a conclusão de compatibilidade de shape, só o
mecanismo de merge (achado #4), tratado abaixo.

**#3/#4 (RBAC, query)**: RBAC confirmado sem mudança. Query pattern corrigido: abandono "merge
em memória com queryBase genérico" (não existe) por um desenho explícito:
- Endpoint aceita `month` obrigatório (formato `yyyyMM`, default mês corrente) — nunca cross-month
  transparente nesta versão (Codex concorda que isso evita N+1 entre meses).
- Dentro de um mês: 3 streams ordenadas (uma por PK de `expiration`/`organization`/`subject`),
  cada uma com seu próprio `queryGsi1`-equivalente (`store.query` direto por PK, cada módulo já
  tem esse método de baixo nível), cada uma paginada com seu PRÓPRIO `LastEvaluatedKey`.
- Cursor de resposta é um objeto composto opaco (`{ expirationLek?, organizationLek?,
  subjectLek? }`, serializado/base64) — nunca um cursor único simples. K-way merge: em cada
  chamada, busca até `limit` itens de CADA partição ainda ativa (não descarta excedentes —
  avança o LEK real da partição só pelos itens efetivamente devolvidos ao cliente), ordena os
  3 buffers por `(occurredAt, auditEventId)` como desempate, corta em `limit`, devolve o
  restante não consumido de volta no cursor da próxima página. Nenhuma partição perde itens
  entre páginas.

**#5 (retenção)**: aceito — registrar explicitamente que `occurredAt` É o campo canônico
equivalente a `createdAt` para as 3 entidades AuditEvent (elas não têm um `createdAt`
separado, são eventos imutáveis onde `occurredAt` já é o único timestamp) — anotação a
incluir em D-127 quando a implementação real do worker `SECURITY_AUDIT` acontecer (item 6 do
NEXT_SESSION_PROMPT). Removida a frase "automaticamente reflete a purga" — corrigido para "vai
refletir, quando o worker existir" (não existe ainda).

**#6 (export)**: aceito integralmente, desenho trocado. Em vez de forçar o export dentro do
`AuditEvent` de `ExpirationItem` (que exige `itemId`/`newVersion`, semanticamente errado para
uma operação tenant-wide sem agregado único mutando), a Rodada 2 propõe um `AuditAction`
diferente: não estender `AuditEvent` de expiration, e sim reconhecer que exportação é
estruturalmente parecida com `MembershipAuditEvent`/`SubjectAuditEvent` — um evento
tenant-wide, não item-wide. Proposta: novo tipo-irmão mínimo `TenantAuditEvent`
(`resourceType: "ExpirationExport"`, sem `itemId`/`newVersion` obrigatórios — mesmo padrão
estrutural dos outros 3, chave própria `TENANT#<id>#TENANTAUDIT#<yyyyMM>`) ou, alternativa mais
barata: adicionar `"EXPORT"` à union de `organization`'s `MembershipAuditAction` é errado
(namespace errado); o caminho correto é um 4º agregado-irmão, seguindo o MESMO princípio já
documentado nos comentários dos 3 arquivos existentes ("agregado-irmão... resourceType
próprio... em vez de generalizar o tipo já em produção"). Escrita acontece DEPOIS da
serialização do CSV bem-sucedida (não antes), correlationId da requisição usado como
dedupe-key lógica (retry idempotente documentado, não garantido atomicamente com a entrega ao
cliente — HTTP não permite essa garantia de qualquer forma, mesma limitação que qualquer log
de acesso). `changes: { exportedCount }` apenas, nunca itens.

**#7 (cobertura)**: aceito. Antes de fechar o design, produzir matriz de mutações reais vs.
eventos emitidos — feita abaixo (não é grande, o produto tem poucas mutações).

**#8 (frontend)**: mantido sem mudança — Codex concordou.

**#9 (checklist)**: fechado acima.

## Matriz de cobertura (achado #7 do Codex)

| Mutação real | Módulo | Emite AuditEvent hoje? |
|---|---|---|
| Criar/editar/arquivar/renovar/excluir item | expiration | Sim (`CREATE/UPDATE/ARCHIVE/RENEW/DELETE`) |
| Exportar CSV | expiration | **Não — gap, fecha nesta rodada (novo TenantAuditEvent)** |
| Convite criado/aceito/revogado, troca de role, remoção/saída de membro | organization | Sim (`MembershipAuditAction`, 6 valores) |
| CRUD de subject, link/unlink item, atribuir/excluir requirement, convite inicial (5 desfechos), config de entrega de document request | subject | Sim (`SubjectAuditAction`, 12 valores) |
| Fechar organização (`organization:close`, D-124) | organization | **Não verificado nesta rodada — anotar como achado aberto, não travar o design por isso** (fora do escopo imediato de Marcelo, que citou renovação/criação/exportação como exemplos centrais) |

Cobertura resultante: 3 de 4 categorias relevantes já cobertas; export fecha nesta rodada;
`organization:close` fica anotado como possível gap futuro (não bloqueia v1, feed já mostra
"organização fechada" indiretamente pois nenhum evento novo mais chega depois).

## Decisão de escopo desta rodada (revisão)

Dado o volume real de mecanismo pendente de especificar corretamente (cursor composto, novo
tipo-irmão de evento, matriz de cobertura) — **design-only nesta sessão**, mesmo padrão do
D-127: protocolo completo decide o design até 9,0/9,0, implementação real fica para sessão(ões)
futura(s) dedicada(s). Isso não é um recuo de escopo do pedido de Marcelo — é reconhecer que o
mecanismo de paginação cross-partition corrigido pelo Codex é trabalho de implementação real
(DTO, testes de contrato, testes de paginação com 3 partições), não algo a espremer no mesmo
round que ainda está fechando o desenho.
