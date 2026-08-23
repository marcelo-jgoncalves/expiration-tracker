---
status: draft
owner: Marcelo
authority: informativo (decisão de domínio reconciliada via protocolo AGENTS.md §4; promovida a ADR formal só na Fase 3, junto do roadmap final)
---

# Fase 2b — Modelagem de domínio: guest upload / magic link (`DocumentRequest` + `DocumentSubmission`)

Segundo cluster de decisão da Fase 2, dependente do primeiro (`03-domain-model-tracked-subject-
requirement.md`, fechado 9,1/9,1). Decisão nível 5-6 (`change-risk-scale.md` — nova superfície de
API pública, novo padrão de autorização, novo dado sensível/PII de terceiro). Protocolo
Claude↔Codex completo via MCP (`codex mcp-server`), sandbox read-only, 3 rodadas reais, eixos
Segurança + Privacidade.

**Nota final: Claude 9,2 / Codex 9,2 — gate ≥9,0 atingido, sem arredondar.**

## Processo

- **Rodada 1 (propostas independentes, nota cega)**: convergência forte e espontânea em: token
  opaco `selector.secret` (nunca valor bruto persistido, só hash com pepper), reutilizável até
  expirar/revogar (não single-use — copiando a semântica do SubCompliant, não a mecânica cega),
  resposta genérica anti-enumeration, rate limit por token E por IP, reaproveitamento do pipeline
  pós-upload de M6 intacto (quarentena→GuardDuty→promoção agnóstico a quem chamou).
- **Rodada 2 (crítica adversarial)**: Claude atacou 4 pontos da proposta do Codex. Achado mais
  valioso: Codex tinha proposto um **GSI novo (GSI8)** só para resolver token→tenant. Claude
  confrontou isso com um padrão **já existente no código real**
  (`src/modules/identity/persistence/identity-mapping-repository.ts`: `IdentityMapping` resolve
  `cognitoSub→userId` via item ponteiro na tabela base, `IDENTITY#cognitoSub#<sub>`/`MAP`, sem GSI
  nenhum). Codex concedeu integralmente, eliminando o GSI8 da proposta — evita edição do módulo
  `dynamo-table` e uma política IAM isolada nova (o mesmo custo que GSI3/GSI6 já exigiram).
  Codex também fechou posição concreta sobre formato único de quarantine key (em vez de deixar
  ambíguo "duas opções") e elevou WAF de "esperar M8" para pré-requisito real antes de expor a
  rota pública.
- **Rodada 3 (reconciliação + nota cega final)**: Claude consolidou as revisões + registrou 1
  ressalva própria (política IAM de namespace tenantless, não resolvida nesta rodada). Codex deu
  nota cega final sem ver a nota do Claude.

## Decisão final

### Token e lookup

Token opaco `selector.secret` — `selector` público (usado só para lookup), `secret` de 256 bits
mostrado uma vez. Persistidos só `HMAC-SHA256(pepper, selector)` e `HMAC-SHA256(pepper, secret)`,
pepper versionado em Secrets Manager/KMS. Validação: parse → hash do selector → lookup → comparação
do secret com `timingSafeEqual` → checar `expiresAt`/`revokedAt`/`status`. TTL padrão 14 dias ou
`deadline`, o que vier primeiro. **Reutilizável até expirar/revogar**, nunca single-use (o
convidado pode errar arquivo, perder conexão, precisar reenviar antes da revisão). Renovação =
reemissão de novo token quando o anterior expira e o `RequirementAssignment` ainda está
`MISSING|REQUESTED|REJECTED` — semântica do SubCompliant (`02-market-research.md`), não extensão
indefinida do mesmo token.

**Lookup sem GSI novo** — item ponteiro na tabela base, mesmo padrão de `IdentityMapping`.
**Terceira exceção tenantless documentada** (depois de `IdentityMapping` e GSI3):
```
PK = GUESTTOKEN#<selectorHash>
SK = POINTER
```
Campos: `selectorHash`, `secretHash`, `tenantId`, `subjectId`, `assignmentId`, `documentRequestId`,
ponteiro para a PK/SK real do `DocumentRequest`, `tokenVersion`, `expiresAt`, `revokedAt?`,
`retentionClass=TRANSIENT`, `purgeAfter`. Criação/rotação/revogação atualiza `DocumentRequest` +
ponteiro na mesma transação.

### Superfície de API

Rota pública `authorization_type=NONE` no API Gateway (hoje 100% JWT, confirmado em
`01-gap-analysis.md`) — `GET /guest/document-requests/{token}`, `POST
/guest/document-requests/{token}/uploads` — com validação completa na aplicação, não Lambda
authorizer no v1 (evita duplicar lógica de token/contexto e risco de cache stale). **WAF é
pré-requisito antes de expor a rota, não item de M8**: rate-based rule por IP, AWS Managed Core
Rule Set, limite dedicado a `/guest/*`, throttling por rota/stage, alarmes de 4xx/429/5xx.

### Generalização do pipeline M6

Novo `UploadActor` (`AUTHENTICATED` com `RequestContext` real vs. `GUEST` com
`tenantId`+`documentRequestId`+`assignmentId` resolvidos do token validado, nunca do request).
Guest nunca envia `tenantId`/`itemId`/`assignmentId` confiável — vêm sempre do `DocumentRequest`
validado.

**Quarantine key canônica única** (não dois formatos permanentes):
```
tenant/<tenantId>/anchor/<ITEM|SUBMISSION>/<anchorId>/document/<documentId>/slot/<uploadSlotId>/<uuid>
```
Parser retorna `{tenantId, anchor: {type, id}, documentId, uploadSlotId}`. Formato antigo
(`item/<itemId>/...`) aceito só durante janela de compatibilidade (slots/eventos em voo do fluxo
autenticado já em produção), removido depois. Quarentena, GuardDuty, promoção e fail-closed
continuam idênticos — só muda o resolvedor de contexto do objeto.

### Novos agregados

`DocumentSubmission` (fluxo guest, evita `ExpirationItem` artificial — aviso explícito do prompt
estratégico):
```
PK = TENANT#<tenantId>#SUBJECT#<subjectId>
SK = REQASSIGN#<assignmentId>#SUBMISSION#<submissionId>
```

`DocumentRequest` (mesma partição do `RequirementAssignment`, mesmo padrão de coleção do cluster
1):
```
PK = TENANT#<tenantId>#SUBJECT#<subjectId>
SK = REQASSIGN#<assignmentId>#DOCREQ#<documentRequestId>
```
Destinatário como **snapshot inline** (`recipientEmail`, `recipientEmailHash`,
`recipientDisplayName?`) + `recipientContactId?` opcional — **não bloqueia por `ExternalContact`**
(ainda não modelado em nenhuma rodada); normalização vem depois, quando houver múltiplos contatos
por subject/vendor. `RequirementAssignment.status` transiciona: `REQUESTED` (request enviado) →
`SUBMITTED` (upload aceito no pipeline) → `UNDER_REVIEW` (malware clean/extração iniciada) →
`SATISFIED` (aprovação humana final, mesma transação do cluster 1).

### Privacidade/retenção

Sem 9ª classe nova em `privacy-lgpd.md`: `DocumentRequest` → `DELIVERY_RECORD`; token/rate-limit →
`TRANSIENT`; `DocumentSubmission` com documento → `USER_DOCUMENT`. `privacy-lgpd.md` precisa de
atualização de mapa de dados (não de classe nova) para incluir `ExternalContact`/`DocumentRequest`/
`DocumentSubmission` quando implementado — trabalho de sessão futura, não decidido aqui.

### Rate limiting

Por token (`GUESTTOKEN#<selectorHash>#RATE`) **e** por IP (hash com pepper, retenção curta) — ambos
antes de consumir a quota normal do tenant (`TenantQuotaService`, inalterada). Enumeration/timing:
toda falha de token retorna resposta genérica idêntica, caminho dummy calibrado para tokens
malformados, nunca vaza `tenantId`/`assignmentId`/status real.

## Ressalva registrada, não resolvida nesta rodada (gate explícito antes da implementação)

Política IAM de acesso à tabela base precisa excluir explicitamente handlers tenant-facing comuns
do namespace tenantless (`GUESTTOKEN#*`, `IDENTITY#*`) via `dynamodb:LeadingKeys` ou equivalente —
mesma lógica de isolamento já aplicada a GSI3/GSI6, mas **nunca verificada** para os ponteiros
tenantless já existentes (`IdentityMapping`). Ambos os lados concordam: não bloqueia a aprovação
do modelo de domínio/API/token, mas deve virar gate explícito de segurança antes da implementação
real — candidato a rodada de debate dedicada ou a verificação factual direta do IAM atual.

## Próxima ação

Terceiro cluster de debate (Fase 2b continua): `Organization`/`Membership`/RBAC + billing —
eixos Produto-Multi-tenant + Jurídico + Privacidade. Diferente dos dois primeiros clusters, este
já tem readiness formal real no código (`ADR-0002`, `evolution.md` com gatilho e migração de 3
fases já desenhada) — a rodada aqui é mais sobre DESTRAVAR uma decisão já preparada do que criar
uma do zero.
