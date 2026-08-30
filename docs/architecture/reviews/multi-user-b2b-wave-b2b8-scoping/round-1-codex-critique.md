# Rodada 1 — Crítica Codex (via MCP `mcp__codex__codex`, thread `01a05182-a396-7a31-86dc-975a7b5dd1d9`)

**Régua contestada — nota da régua e nota do design registradas separadas per `research-protocol.md`:**

- Nota da régua: **8.0/10**
- Nota do design (contra a régua v1): **7.8/10**
- Status: não aprovável nesta rodada, Rodada 2 com checklist reconciliado.

## Achados

1. **Checklist falta critério para privacidade de convites pendentes** — `membership:list` unificado (`READ_ONLY_ROLES`) trata "listar membros" e "listar convites pendentes" como a mesma superfície, mas convite pendente carrega e-mail + intenção de adicionar pessoa — Linear/Notion tratam "pending invites" como superfície administrativa, não leitura geral.
2. **`AcceptInvitationService` não consome/marca o `InvitationTokenPointer` na transação** — o design lista `Update Membership`/`Update Invitation`/`Delete InvitationDedupPointer`/audit/incremento de `ownerCount`, mas nunca toca o token pointer (`consumedAt`) — Q14 (anti-replay) fica sem implementação real, só citado como já resolvido pelo physical model.
3. **Colisão de chave de rate-limit** — a proposta reaproveita literalmente `TENANT#<organizationId>#SETTINGS`/`RATE`/`RATE_DAILY`, a MESMA forma já usada por `initial-invite-rate-limiter.ts` para convite de guest document request — pós-cutover `tenantId=organizationId`, misturaria as duas quotas. Além disso, `OrganizationStore` (porta) não expõe `updateConditional`, que o padrão do rate-limiter exige.
4. **Critério 1 mistura escopo atual com `suspend` futuro** — `SUSPENDED` existe no domínio mas a transição administrativa fica fora de escopo desta wave; a âncora do checklist não deveria exigir isso como write path de B2B-8.

## Respostas às perguntas abertas

1. Confirma: 2 camadas de autorização (matriz `ADMIN_ROLES` + checagem de serviço nomeada para transições envolvendo `OWNER`) é a forma certa — `OWNER_ROLES` direto seria restritivo demais.
2. Falta a distinção "listar membros" vs. "listar convites pendentes" — a pesquisa cobre bem gerência/escrita, mas a proposta generalizou isso para leitura ampla sem a mesma evidência.
3. Concorda com `membership:leave` como `READ_ONLY_ROLES` self-service, **desde que o serviço force `targetUserId === context.principal.userId`** (não pode ser usado como "remove" disfarçado de outra pessoa).
