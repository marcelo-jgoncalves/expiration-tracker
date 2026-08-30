Nota Codex: 8,6/10. Não aprovado.

(conteúdo completo devolvido pelo MCP `codex/codex`, thread `01a05222-6fb0-7512-867f-89361a8fbf07`,
transcrito integralmente abaixo para registro)

Não li `round-1-claude-self-grade.md`. Revisão feita contra código real e docs indicados; usei web
só para conferir as fontes externas de C1/C2.

**Nota Codex: 8,6/10. Não aprovado ainda.**

**Achados bloqueantes**

1. **C2 está estreito demais para User-level DSR.** A distinção "DSR individual não apaga dado de
   negócio da Organization" está correta e bem suportada por Slack/Atlassian, mas a regra proposta
   diz que "só GlobalUser e Memberships do próprio usuário são afetadas". Isso é falso/incompleto
   contra o código atual: há `DeviceSession` user-global em `global-user-repository.ts:51`,
   `Session`/refresh token/cognito subject na tabela BFF em `session.ts:13`, `IdentityMapping` em
   `identity-mapping-repository.ts:19`, e `UserProfile` por organização em `user-repository.ts:16`.
   Correção: manter C2, mas formular como "não cascateia para dados de negócio organization-owned";
   user DSR deve inventariar identidade, perfis, sessões e memberships do titular, mesmo que
   endpoint real continue fora de escopo.
2. **C7 omite uma entidade B2B-8 real de convite: `MembershipInviteRateLimitRecord`.** O writer
   existe, grava chaves `TENANT#<organizationId>#SETTINGS#MEMBERSHIP-INVITE...` com hash de
   destinatário em `membership-invite-rate-limiter.ts:16`. A purga por prefixo cobre, mas a tabela
   de retenção proposta não classifica esse dado. Como a wave explicitamente inclui "invitation
   retention", isso precisa entrar, provavelmente como `QUOTA_TELEMETRY` ou `TRANSIENT` com
   `purgeAfterTtl`, sem inventar classe nova se uma existente bastar.
3. **O plano de teste C3, como escrito, pode não provar o bug no adapter real.** O bug está no
   `FilterExpression` de `tenant-purge-scan.ts:44` e na condição de delete de
   `system-mutation.ts:260`. Um teste só em `dynamo-tenant-purge.test.ts` usando fonte fake pode
   passar sem nunca exercitar a construção real do `ScanCommand`. Precisa de teste que
   capture/asserte o `FilterExpression` do `DynamoDbTenantPurgeCandidateSource`, além de teste da
   condição `PURGE_DELETE`.

**Não-bloqueantes**

- O achado central é real: `InvitationTokenPointer` usa `PK=INVITATION_TOKEN#...` e declara
  `organizationId`, não `tenantId`, em `invitation-token.ts:20`. O scan atual não alcança isso.
- Não encontrei outro writer B2B com o mesmo problema de alcançabilidade. `Membership`,
  `Invitation`, `InvitationDedupPointer`, `MembershipAuditEvent`, `MembershipInviteRateLimit` e
  `Organization` são `TENANT#<organizationId>#...`.
- A cláusula `OR organizationId = :tenantId` é correta para o estado atual. Não encontrei entidade
  real com `organizationId` que não deva ser organization-owned para purga. O risco de colisão é
  futuro; aceitável se documentado como allowlist de atributo conhecido.
- A fonte Atlassian confirma a fronteira B2B, mas eu não verifiquei a afirmação específica sobre
  "billing/technical contacts". Eu não dependeria desse detalhe na proposta.
- Há comentário stale em `tenant-purge-scan.ts`: ele diz que `IdentityMapping` declara `tenantId`,
  mas o código atual não declara. Corrigir oportunisticamente ao tocar o arquivo.

**Respostas às 3 perguntas abertas**

1. Não encontrei `orgId` nem outro atributo B2B equivalente. O caso perdido é
   `InvitationTokenPointer`; `MembershipInviteRateLimit` é outro writer B2B, mas prefix-covered.
2. `MembershipAuditEvent` deve reutilizar `SECURITY_AUDIT`, não ganhar classe própria.
3. Sim, a regra deve impedir suspender o último `OWNER ACTIVE`, porque §125.2 define `ownerCount`
   como `Membership ACTIVE` com `role=OWNER`. Mas sem call site real de suspensão hoje: documentar
   a invariante agora, implementar guard só quando existir writer.

Fontes externas conferidas: GitHub account management, Slack profile deletion, Atlassian managed
account deletion / privacy.
