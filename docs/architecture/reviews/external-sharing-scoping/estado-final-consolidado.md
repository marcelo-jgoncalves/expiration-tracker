# Estado Final Consolidado — Compartilhamento Externo Seguro (`ExternalShareLink`)

**Status: `APPROVED (design)` via protocolo Claude↔Codex (`AGENTS.md` §4), 4 rodadas, régua recalibrada 3 vezes (v1→v2→v3), fechamento na Rodada 4 (Claude 9,4 autoavaliação implícita / Codex nota cega pesquisa 9,3/design 9,2, ambos ≥9,0, sem arredondar).** Registrado como `docs/architecture/decisions-log.md` D-225. Evidência completa das 4 rodadas: `round1-claude-proposal.md`, `round1-codex-critique.md`, `round2-claude-revision.md`, `round2-codex-critique.md`, `round3-claude-final.md`, `round3-codex-critique.md`, `round4-claude-revision.md`, `round4-codex-critique.md`.

Fecha o item 19 do backlog P1 (`docs/project/roadmap-competitivo-2026-09-01.md` linha 111, último item pendente do backlog) como DESIGN — nenhum código/schema/infra tocado ainda.

## Pesquisa externa (E-014): SIM

Fontes (consultadas 2026-09-07):
- OWASP Forgot Password Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html (entropia ≥128 bits, CSPRNG, comparação em tempo constante).
- OWASP Authentication Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html.
- Dropbox Help — "How to set shared link permissions" — https://help.dropbox.com/share/set-link-permissions.
- Ivy/IronVest — "Set Expiry Links & Permission Models on Google Drive, OneDrive, and Dropbox" — https://getivy.ai/blog/secure-file-sharing.
- Global Cybersecurity Network — "How to Stay Safe with Shared Documents: A 2026 Guide" — https://globalcybersecuritynetwork.com/blog/how-to-stay-safe-with-shared-documents/.
- AWS Prescriptive Guidance — "Overview of presigned URLs" / FAQ — https://docs.aws.amazon.com/prescriptive-guidance/latest/presigned-url-best-practices/overview.html, https://docs.aws.amazon.com/prescriptive-guidance/latest/presigned-url-best-practices/faq.html.
- AWS re:Post — "Troubleshoot expiration of presigned URL for S3 bucket" — https://repost.aws/knowledge-center/presigned-url-s3-bucket-expiration.
- Amazon S3 User Guide — "Download and upload objects with presigned URLs" — https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html.

**Limitação registrada explicitamente**: não foi localizada documentação oficial equivalente de Box/Notion/Figma dentro do orçamento das 4 rodadas — a amostra cobre OWASP (norma de segurança) + Dropbox/Google (2 líderes de mercado, divergência real de postura de expiração) + AWS (fonte primária do mecanismo de presign que o próprio projeto usa) — considerada suficiente pelo Codex na nota final (pesquisa 9,3/10), mas a lacuna de Box/Notion/Figma é nomeada, não escondida.

**Escopo**: pesquisa informa a postura de segurança do token (entropia/anti-enumeration, OWASP-grade) e o modelo de expiração/revogação de link (Dropbox/Google divergem de fato) e a limitação estrutural de revogação de URLs presigned (AWS, fonte primária). Decisões internas (layout PK/SK, qual Lambda) seguem só o precedente já convergido (`guest-token.ts`, `guest-document-access-service.ts`/D-143).

## Checklist final (régua v3, estável desde a Rodada 3 — 11 critérios)

1. (12%) Token de alta entropia + comparação dummy-safe, ordem fixa (parse→rate limit→lookup→compare), idêntica ao precedente `guest-document-access-service.ts` (D-143).
2. (8%) Transporte do token não amplia superfície de vazamento (token no PATH, nunca query string; `Cache-Control: no-store`; `Referrer-Policy: no-referrer`).
3. (10%) Expiração obrigatória, finita, semântica de estado literalmente verificável (`ACTIVE|REVOKED` só; expiração sempre derivada, nunca um 3º estado persistido).
4. (10%) Revogação bloqueia toda NOVA emissão de presign imediatamente; janela residual do presign já emitido (≤5min) é propriedade documentada da AWS (fonte primária), não falha exclusiva deste design.
5. (10%) Sem enumeração, ordem de operações idêntica ao precedente D-143.
6. (12%) Vínculo referencial validado transacionalmente com os nomes de atributo reais (`DocumentFile.scanStatus`, `DocumentVersion.state`) na criação e revalidado (`scanStatus`+`cleanObject` só) a cada acesso.
7. (6%) Estado do tenant revalidado a cada acesso anônimo.
8. (10%) Cap de links ativos por Document atomicamente aplicado, com reconciliação lazy de slots expirados (nunca "contar depois criar", nunca travamento permanente por expiração natural).
9. (6%) Rate limiting reusa literalmente o precedente `DocumentArchiveGuestRateLimiter`/D-143.
10. (6%) Escopo mínimo de dado exposto, DTO fechado, snapshots corretos.
11. (10%) Auditoria cobre o ciclo administrativo completo como trilha CloudWatch (nunca confundida com um contador de produto em tempo real).

## Decisões finais

**Decisão 1 — `ExternalShareLink`**, co-localizada na partição do `Document`:
```ts
export type ExternalShareLinkStatus = "ACTIVE" | "REVOKED"; // nunca EXPIRED persistido — sempre derivado de expiresAt

export interface ExternalShareLink extends EntityKey {
  SK: `SHARE#${string}`;           // shareId (ULID)
  entityType: "ExternalShareLink";
  tenantId: string;
  documentId: string;
  documentTypeNameSnapshot: string;  // copiado do DocumentType.displayName na criação, nunca relido depois
  documentVersionId: string;         // CONGELADO na criação — nunca CURRENT
  documentFileId: string;            // SEMPRE resolvido e concreto na criação (default: PRINCIPAL da versão)
  selectorHash: string;
  secretHash: string;
  status: ExternalShareLinkStatus;
  createdByUserId: string;
  expiresAt: string;                 // ISO, SEMPRE presente, cap 30 dias, default 7
  purgeAfterTtl: number;             // expiresAt + 30 dias de margem de auditoria
  revokedAt?: string;
  revokedByUserId?: string;          // ausente quando revogação foi reconciliação lazy de expiração
  createdAt: string;
  updatedAt: string;
  version: number;
}
```
Ponteiro tenantless (3ª exceção documentada, mesmo padrão de `GuestTokenPointer`/`IdentityMapping`): `SHARELINK#<selectorHash>` / `POINTER` → `{tenantId, documentId, shareId}` — `shareId` do ponteiro é a ÚNICA autoridade de resolução (o `{shareId}` na rota é só para logging, divergência colapsa no erro genérico).

`Document.activeExternalShareLinkCount?: number` novo (sparse, `if_not_exists(...,0)` em toda escrita, nunca permite underflow) — contador atômico do cap, na MESMA transação de criação/revogação do link.

**Decisão 2 — Token reaproveitado do precedente mais específico**: mecanismo de `guest-document-access-service.ts`/`request-access-credential.ts` (D-143) — não `guest-token.ts` (D-037), que é o precedente genérico mas menos específico. Mesma mecânica: `randomBytes(16)`/`randomBytes(32)` (128/256 bits), HMAC+pepper PRÓPRIO (nunca reusa o pepper de outro domínio de token), `timingSafeEqual`, comparação dummy-safe quando o selector não existe. Ordem de operações fixa e única: **parse estrutural → rate limit (chave derivada do input, ANTES do lookup) → lookup do ponteiro → comparação dummy-safe do secret**.

**Decisão 3 — Rota**: `GET /external-share/{shareId}/{token}` (token no PATH, nunca query string — acesso não passa por `RequestContext`/`authorize()`, mesmo padrão do guest upload). `Cache-Control: no-store` + `Referrer-Policy: no-referrer` obrigatórios na resposta. Handler dedicado nunca loga o path bruto; `schemas/sensitive-fields.json`'s `inlineKeyValueSecret` regex é defesa adicional (não a principal, já que o path não é key=value).

**Decisão 4 — RBAC**: `docarchive:share-link-create`/`docarchive:share-link-revoke`/`docarchive:share-link-list` novas, `ADMIN_ROLES` exclusivamente (mesmo tier de `docarchive:dossier-export`, D-216). Acesso do visitante externo nunca passa por RBAC — só pelo token.

**Decisão 5 — O que o visitante vê**: DTO fechado — `documentTypeNameSnapshot`, `documentIssuedDate` (ou null), `fileName` (sanitizado), `downloadUrl` (presign S3, TTL 5min). Nunca serializa `Document`/`DocumentType`/`DocumentVersion` inteiros. Nunca listagem/busca de outros Documents.

**Decisão 6 — Congelamento sempre (não mais uma pendência de produto)**: `documentVersionId`/`documentFileId` resolvidos e persistidos concretamente na criação — nunca "versão CURRENT". Revalidação a cada acesso é DELIBERADAMENTE restrita a `DocumentFile.scanStatus="CLEAN"` + `cleanObject` presente + `TenantLifecycleRecord=ACTIVE` + `ExternalShareLink.status="ACTIVE"` + `expiresAt` no futuro — NUNCA revalida `DocumentVersion.state`/`Document.status` (semântica de "cópia entregue", coerente e única, não ambígua).

**Decisão 7 — Revogação**: `PATCH /document-archive/documents/{documentId}/share-links/{shareId}/revoke`, `status: ACTIVE→REVOKED` via `executeTenantBusinessMutation`, OCC (`version = expectedVersion AND status = "ACTIVE"`). Bloqueia toda NOVA emissão de presign imediatamente; janela residual de até 5min do presign já emitido é aceita e documentada como propriedade estrutural da AWS (fonte primária), não uma falha de design.

**Decisão 8 — Criação transacional completa**: uma `TransactWriteItems`: `ConditionCheck(Document.tenantId=<esperado>)` + `ConditionCheck(DocumentFile.scanStatus="CLEAN" AND documentId=<esperado> AND documentVersionId=<esperado>)` + `ConditionCheck(DocumentVersion.state="ACCEPTED" AND documentId=<esperado>)` + `Update(Document.activeExternalShareLinkCount = if_not_exists(...,0)+1 WHERE < 5)` + `Put(ExternalShareLink)` + `Put(SHARELINK pointer)`.

**Decisão 9 — Cap com reconciliação lazy**: ao atingir `activeExternalShareLinkCount >= 5` numa tentativa de criação, o serviço primeiro faz `Query` (GSI1, no máximo 5 itens) dos links ativos do Document, reconcilia (`status→REVOKED`, motivo `EXPIRED_RECONCILED`, decrementa o contador) qualquer um com `expiresAt` no passado, e só então tenta a criação de novo — nunca trava permanentemente por expiração natural não reconhecida. **Achado de implementação nomeado pelo Codex (Rodada 4)**: os deltas do contador (incremento da criação + decrementos da reconciliação) precisam ser consolidados numa ÚNICA operação `Update` sobre o item `Document` dentro da mesma transação — DynamoDB não permite duas operações sobre o mesmo item numa `TransactWriteItems`.

**Decisão 10 — Rate limiting**: reuso literal de `DocumentArchiveGuestRateLimiter.consumeBoth` (D-143) — mesma característica pré-existente de persistir IP cru na chave de rate-limit, nomeada como dívida técnica pré-existente NÃO corrigida aqui (fora de escopo, mesma disciplina D-177→D-178).

**Decisão 11 — Auditoria**: 4 eventos na taxonomia fechada (`EXTERNAL_SHARE_LINK_CREATED`/`_REVOKED`/`_PRESIGN_ISSUED`/`_TENANT_INACTIVE_BLOCKED`) via `security-audit.ts` — trilha CloudWatch Logs Insights, explicitamente NUNCA confundida com um contador de produto em tempo real (esse papel é do `activeExternalShareLinkCount` transacional). IP hash com pepper PRÓPRIO (nunca o do token), derivado de `sourceIp` do API Gateway (nunca header do cliente).

**Decisão 12 — Listagem**: `GET /document-archive/documents/{documentId}/share-links` (RBAC `docarchive:share-link-list`, `ADMIN_ROLES`), paginada via GSI1.

## Postura de segurança "sem senha" — resolvida, não é mais pendência de produto

v1 é bearer-token puro (mesma postura já convergida internamente em `guest-document-access-service.ts`/D-143 para o fluxo inverso de upload, mesma categoria de dado sensível), reforçado por precedente externo (Dropbox/Google tratam link "quem tem, acessa" como caso base, senha como camada opcional de plano superior). Senha/PIN opcional é fatia FUTURA nomeada, não bloqueante.

## Pendências reais, nomeadas explicitamente para quem implementar

1. Nenhuma implementação de código feita ainda — este documento é só o design `APPROVED`.
2. Achado de implementação do Codex (Decisão 9): consolidar os deltas do contador numa única operação por transação.
3. `DocumentArchiveGuestRateLimiter` persiste IP cru (dívida técnica pré-existente, D-143, herdada por reuso — não uma regressão introduzida aqui).
4. Redaction de path bruto (`pathParameters.token`) no handler dedicado precisa confirmar, na implementação, que o mecanismo de redaction genérico do projeto (`defaultRedactor`) já cobre isso por padrão ou se precisa de tratamento explícito no handler (achado de implementação, não de design).
5. Senha/PIN opcional como segunda camada — fatia futura nomeada, sem urgência dado o precedente interno já convergido.
6. Fatiamento de implementação sugerido (não normativo): fatia 1 = domínio (`ExternalShareLink`, token reuso, criação transacional completa incl. cap+reconciliação); fatia 2 = rota de acesso anônimo (resolução, revalidação, presign, auditoria); fatia 3 = revogação + listagem + RBAC + rotas HTTP completas + schemas.
