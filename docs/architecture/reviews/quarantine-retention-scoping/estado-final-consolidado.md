# Quarantine/Recovery Window + LGPD Retention — Estado Final Consolidado

Protocolo Claude↔Codex completo, **11 rodadas** (5,5→7,3→8,5→8,7→8,7→8,9→8,9→8,9→8,9→9,3, Claude
9,4/Codex 9,3 na Rodada 11, gate ≥9,0 atingido em ambos sem arredondar). Ver
`docs/architecture/decisions-log.md` D-127 e `round-1` a `round-11` (`*-claude-proposal.md`,
`*-claude-self-grade.md`, `*-codex-critique.txt`) para o histórico completo achado-a-achado.

## Mecanismo de quarentena (D-127)

- **Estado novo**: `HELD_FOR_RECOVERY`, entre `ACTIVE` e `DELETING` no grafo de
  `TenantLifecycleRecord` — única aresta de retorno a `ACTIVE` no grafo (antes estritamente
  forward-only).
- **Duração**: 30 dias — piso defensável mais curto de uma faixa convergente 20-90 dias (GitHub 90,
  AWS 90, Google Workspace 20-25, Slack-arquivo 30), coincide numericamente (não por identidade de
  finalidade) com 2 das 9 classes LGPD já usarem 30 dias internamente.
- **Escopo**: cross-cutting por design — reusa o Step Functions já existente de W3-07 (D-124), sem
  novo serviço AWS; documentado como o padrão a seguir por qualquer feature futura da mesma classe
  (ex. armazenamento de arquivos, ainda não escopado).
- **Ação de cancelar**: existe — `CancelOrganizationClosureService`, caminho de resolução de
  identidade dedicado (`IdentityMapping`, nunca `RequestContextResolver` normal), primitive de
  autorização dedicado (`authorizeCancelClosure()`), `StopExecution` sempre antes de qualquer
  restauração, sweeper de reconciliação com conjunção estrita (nunca restaura sob ambiguidade,
  alarma em vez disso).
- **Legal hold**: `HELD_FOR_RECOVERY→HELD` (não `BLOCKED`), preserva o `recoveryDeadline` original.

## LGPD — 9 classes, estado real vs. necessário

| Classe | Estado hoje | Ação |
|---|---|---|
| `USER_DOCUMENT` | Purga física real (W3-06) | Nenhuma — já resolvido |
| `EXTRACTION_TRANSIENT` | Lifecycle S3 24h | Nenhuma — já resolvido |
| `TRANSIENT` (`InvitationTokenPointer`) | `purgeAfterTtl` físico real | Nenhuma — já resolvido |
| `TRANSIENT` (`WebhookInbox`/`UploadSlot`) | Sem purga por idade dentro de tenant `ACTIVE` | Prioridade 6 (menor exposição) |
| `CORE_USER_DATA` | Só purgada no fechamento de tenant inteiro | **Prioridade 1** — worker(s) por `deletedAt+30d`, `ReminderOccurrence` via TTL nativo independente do pai |
| `DELIVERY_RECORD` | Idem | Prioridade 2 — `createdAt+180d` |
| `SECURITY_AUDIT` | Idem | Prioridade 3 — `createdAt+365d` |
| `QUOTA_TELEMETRY` | Idem | Prioridade 4 |
| `ACCOUNT_ACTIVE` (não-fechamento) | Idem | Prioridade 5 — `Invitation`→`Membership`→`Channel` |
| `LEGAL_EVIDENCE` | Sem purga; bloqueada por trava jurídica/KMS/Object Lock já `APPROVED` | **Lane bloqueada**, fora da ordem linear — não adiantar trabalho técnico antes da aprovação jurídica |

## Escopo desta sessão: design-only, deliberado

Implementação real (novo Lambda de leitura para o ASL, extensão do sweeper, migração dos 5
`CANCELLED`-writers conhecidos de `ReminderOccurrence` para `cancelOccurrenceUpdate()`, regra
ESLint de enforcement, e os 7 workers de purga LGPD um de cada vez na ordem acima) fica para
sessão(ões) futura(s) dedicada(s) — mesmo padrão D-121 (design) → D-124 (implementação em sessão
separada). Tamanho real ficou comparável a uma wave dedicada (múltiplos serviços/módulos/testes de
concorrência), não a uma implementação de um único dia.
