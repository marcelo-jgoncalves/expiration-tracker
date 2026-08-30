# Multi-User B2B — Wave B2B-7 (RBAC), Rodada 3 — Proposta Claude

Régua v2 confirmada estável dos dois lados nesta rodada (Codex 9,1/10 na Rodada 2; minha própria leitura já convergia). A partir daqui a nota do design conta para o fechamento — resta 1 achado pontual da Rodada 2 do Codex (nota do design 8,8/10, achado 1: `notification:configure` como `WRITE_ROLES` deixa `VIEWER` incoerente, já que a mesma action cobre GET **e** update, e a proposta só justificava o desbloqueio para `MEMBER`).

## Achado resolvido: `notification:configure` pertence a `READ_ONLY_ROLES`, não a `WRITE_ROLES`

**Por que `WRITE_ROLES` era a linha errada, não só incompleta**: revisei se `notification:configure` deveria seguir o mesmo raciocínio de `profile:update` (WRITE_ROLES, D-060) — não deveria. O comentário de D-060 amarra `profile:update` à **capacidade de agir**: "any member can be the one creating a RequirementAssignment/DocumentRequest and should be able to set [requesterDisplayName]" — `VIEWER` nunca cria `RequirementAssignment` (`requirement:assign` é `WRITE_ROLES`), então nunca aparece como "requester" para um guest ver, e a exclusão de `VIEWER` ali é coerente com essa amarração. `notification:configure` não tem essa mesma amarração: é sobre **receber** comunicação (e-mail/quiet hours) sobre itens em que o usuário é `assigneeUserId` — e nada no código restringe quem pode ser `assigneeUserId` pelo papel do assignee (`expiration-service.ts`/`recipient-resolver.ts` não checam role do assignee, só existência do campo). Um `VIEWER` pode legitimamente ser o destinatário de um lembrete e precisa poder configurar `emailEnabled`/`quietHours` para si mesmo, exatamente como qualquer outro papel — auto-serviço puro sobre um dado pessoal, não uma permissão de negócio sobre dado do tenant.

**Decisão corrigida**: `notification:configure` (a mesma action cobre `getOrCreatePreferences()` e `updatePreferences()`, `notification-preferences-service.ts:53/78`) passa a `READ_ONLY_ROLES` — reaproveitando a constante já existente (que, apesar do nome, já significa "qualquer papel com `Membership` real", os 4 valores) em vez de criar uma 5ª constante para um conjunto de papéis idêntico (proporcionalidade — `principles.md` #1, DRY: uma constante nova com os mesmos 4 membros de `READ_ONLY_ROLES` seria duplicação sem ganho). Comentário novo em `authorization.ts` na linha da action, nomeando explicitamente por que ela está em `READ_ONLY_ROLES` apesar de habilitar mutação (auto-serviço sobre dado pessoal, distinto de `profile:update`, que amarra à capacidade de agir sobre dado do tenant).

Isto fecha o achado 1 da Rodada 2 sem introduzir estrutura nova (resposta implícita à pergunta 3 da Rodada 2 sobre proporcionalidade — mesma lógica se aplica aqui: reaproveitar antes de inventar).

## Estrutura final de tiers (fecha B2B-7.1)

```ts
export type Role = "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";

const READ_ONLY_ROLES: ReadonlySet<Role> = new Set(["OWNER", "ADMIN", "MEMBER", "VIEWER"]);
const WRITE_ROLES: ReadonlySet<Role> = new Set(["OWNER", "ADMIN", "MEMBER"]);
const ADMIN_ROLES: ReadonlySet<Role> = new Set(["OWNER", "ADMIN"]);
const OWNER_ROLES: ReadonlySet<Role> = new Set(["OWNER"]);
```

`ACTION_ROLES` — só as linhas que mudam de valor em relação ao código hoje em produção:

```text
"item:delete":                                ADMIN_ROLES   (inalterado, ADMIN agora incluído)
"document:delete":                            ADMIN_ROLES   (inalterado, ADMIN agora incluído)
"subject:delete":                             ADMIN_ROLES   (inalterado, ADMIN agora incluído)
"requirement:delete":                         ADMIN_ROLES   (inalterado, ADMIN agora incluído)
"notification:configure":                     READ_ONLY_ROLES   (era ADMIN_ROLES — bug fix, achado desta rodada de review)
"tenant:configure-document-request-delivery": OWNER_ROLES   (era ADMIN_ROLES — separado por ser config. externa/reputacional do tenant)
```

Nenhuma outra das 29 actions muda de tier.

## Branch de ownership-bypass — sem mudança da Rodada 2

`ADMIN` bypassa mismatch de `ownerUserId`/`assigneeUserId`, igual a `OWNER` (Rodada 2, aceito pelo Codex sem contestação na Rodada 2). Teste dedicado planejado, ver decomposição.

## Decomposição final (per `definition-of-done.md`)

| Subitem | Camada | Risco |
|---|---|---|
| B2B-7.1 | Domain — `Role` ganha `ADMIN`; `READ_ONLY_ROLES`/`WRITE_ROLES`/`ADMIN_ROLES` atualizados + novo `OWNER_ROLES`; `notification:configure`→`READ_ONLY_ROLES`; `tenant:configure-document-request-delivery`→`OWNER_ROLES`; branch de ownership-bypass estendido a `ADMIN`; comentários reconciliados (linha 70-73 do M1 fica obsoleta, D-060 comment reconciliado com a tabela real) | 5 |
| B2B-7.2 | Application — `resolveRoles()` (`resolve-request-context.ts`) aceita os 4 valores reais de `Membership["role"]`, remove o throw para `ADMIN` | 4 |
| B2B-7.3 | Testes — G-V3 desde a escrita: (a) `ADMIN` paritário com `OWNER` em `ADMIN_ROLES` (item/document/subject/requirement:delete); (b) `VIEWER` agora aceito em `notification:configure` (GET e update); (c) `ADMIN` negado em `tenant:configure-document-request-delivery` (só `OWNER`); (d) `ADMIN` bypassa ownership mismatch, espelhando `authorization.test.ts:60`; (e) fail-closed preservado para um valor de role hipotético fora do domínio real; (f) suíte completa `npm test`, zero regressão | 2-3 |

## Fora de escopo (sem mudança das rodadas anteriores)

- Actions novas de gerência de `Membership` (convite/remoção/mudança de role) — Wave B2B-8.
- Decremento de `ownerCount` — TODO já registrado de B2B-7/B2B-8.

## Pergunta final para a Rodada 3 do Codex

A correção de `notification:configure` para `READ_ONLY_ROLES` fecha o achado 1 da Rodada 2 sem reabrir nada novo? Se sim, e não houver achado bloqueante novo, esta proposta está pronta para ≥9,0/9,0 e implementação (per `definition-of-done.md`, gate nível 5 completo com este protocolo).
