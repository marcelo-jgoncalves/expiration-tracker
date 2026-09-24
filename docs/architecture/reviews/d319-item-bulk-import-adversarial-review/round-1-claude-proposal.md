# D-319 — Bulk CSV import para `Item` — Rodada 1 (proposta Claude)

## Contexto

D-319 (2026-09-21) adicionou `Item` como 4º tipo de import CSV (`src/modules/import/`), mesmo
padrão de `TrackedSubject`/`Document`/`Requirement` (D-042/D-192). Implementado sem o protocolo
Claude↔Codex formal (suspenso na época), autorizado diretamente por Marcelo dado o nível 5-6.
Revisão adversarial completa agora que o protocolo voltou.

## Arquitetura implementada

- **4 decisões de produto** (já registradas em `decisions-log.md` D-319): mapeamento de coluna
  fixo v1 (sem `assigneeUserId`); `ReminderPolicy` nunca na mesma linha do CSV; dedupe via chave
  sintética `categoryNormalized|nameNormalized|dueDate`; validação linha-a-linha reaproveitando
  100% a infra existente (`csv-parser.ts`, `FIELD_CATALOG`, endpoints HTTP).
- **Dedupe** (`import-dedup.ts`, `import-row.ts:471-483`): `ImportDedupRecord{kind:"ITEM"}`,
  chave `TENANT#<t>#IMPORTDEDUP#ITEM` / `EXT#<categoryNormalized|nameNormalized|dueDate>`.
  `dueDate` incluído deliberadamente na chave para nunca tratar um item recorrente legítimo (mesmo
  nome/categoria, data diferente) como duplicata. Permanente — sem TTL, sem expiração.
- **Commit** (`import-commit-service.ts:223-279`, `commitItemRows`): reaproveita o protocolo de
  2 chamadas do ramo `TrackedSubject` (claim de dedupe via `putIfAbsent` + `ExpirationService.
  createItem()` como caixa-preta + segunda escrita atualizando o placeholder `subjectId: ""` com o
  itemId real) — nunca o protocolo TENTATIVA/FALLBACK de `Document`/`Requirement`, que existe para
  fencing de uma referência resolvida (`subjectId`/`documentTypeId`) ficando obsoleta entre preview
  e commit; `Item` não tem referência nenhuma a resolver.
- **`reserveImport()` generalizado** (`import-service.ts:43-57,229`): `targetEntityType` agora
  opcional, default `"TrackedSubject"` (preserva 100% o comportamento de todo chamador existente,
  testado em `import-service.test.ts:95-99`). União fechada (`ImportTargetEntityType`), validada
  por schema (`reserve-import-request.v1.json`, `enum` + `additionalProperties:false`) — nenhum
  valor arbitrário passa despercebido.
- **Tenant isolation**: correta em toda a extensão — `importDedupKey(ctx.tenant.tenantId, "ITEM",
  ...)`, `createItem(ctx, ...)` (que já roda `authorize()`/`authorizedTenantId()` internamente).
  Nenhum ponto de escopo perdido especificamente para o ramo Item.

## Achados reais da investigação (não escondidos, trazidos para esta rodada)

1. **Dedupe é permanente e nunca protege contra um Item criado manualmente fora de import** —
   já documentado no próprio código (`import-dedup.ts:19-31`, `import-row.ts:471-476`) e no
   decisions-log. Mesma postura que `Document`/`Requirement` já tinham (não é uma classe de risco
   nova introduzida por Item) — se um tenant já tem um Item manual com a mesma
   categoria+nome+dueDate e depois importa uma linha colidente, um `ExpirationItem` DUPLICADO é
   criado (nenhum scan/verificação contra `ExpirationItem` real existe). **Zero teste cobre esse
   cenário** — só a limitação em prosa.

2. **Claim de dedupe pode ficar órfã entre a Rodada 1 (claim) e a Rodada 2 (`createItem()`), e o
   código atual trata isso INCORRETAMENTE como "já committado com sucesso" numa nova tentativa.**
   Este é o achado mais sério desta investigação. Em `commitItemRows()` (linha 269-270, e o mesmo
   padrão pré-existente em `commitTrackedSubjectRows()` linha 197-198): `claimed === false` (a
   claim já existe) é tratado incondicionalmente como "linha já committada por uma tentativa
   anterior (retry seguro)". Isso está ERRADO quando a claim existe mas `subjectId` ainda é `""`
   (string vazia, o placeholder) — significa que a claim foi feita mas `createItem()` NUNCA chegou
   a rodar (crash do processo, ou `createItem()` lançou uma exceção não relacionada a
   `QuotaExceededError`, que propaga e derruba a invocação inteira do worker sem marcar
   `FAILED_ENTITLEMENT_EXCEEDED` nem nada equivalente). Na próxima tentativa, `putIfAbsent` retorna
   `false` (claim já existe) e o cursor avança como se o Item tivesse sido criado — **a linha
   nunca é criada, silenciosamente, para sempre, sem nenhum outcome distinguível registrado para o
   operador.**
   
   **Importante**: este NÃO é um bug introduzido por D-319 — é um padrão PRÉ-EXISTENTE, idêntico no
   ramo `TrackedSubject` (já em produção-como-`dev` há semanas). D-319 apenas reaproveitou o mesmo
   protocolo (deliberadamente, por design — "byte-for-byte a mesma dança"). Mas `TrackedSubject`
   tem uma mitigação PARCIAL que Item não tem: seu único branch de erro conhecido
   (`QuotaExceededError`) É tratado explicitamente (marca `FAILED_ENTITLEMENT_EXCEEDED`, comentário
   próprio admite "a claim desta UMA linha fica órfã, limitação documentada"). `createItem()` não
   tem NENHUM cap de entitlement hoje, então não há branch de erro conhecido nenhum para Item — o
   universo de causas que podem deixar uma claim órfã é estruturalmente maior (qualquer exceção
   não antecipada de `createItem()`), sem o mesmo comentário reconhecendo o problema no código do
   ramo Item.

3. **`reserveImport()` generalizado destrava incidentalmente um caminho HTTP real para criar jobs
   de import de `Document`/`Requirement`** que não existia antes (eles tinham parse/commit prontos
   desde D-192, mas nenhuma via de criação de job real). Testado (`import-service.test.ts`), mas é
   uma expansão de escopo real além de "só suportar Item" que vale nomear explicitamente, não só
   mencionar de passagem.

## Testes/evidência (D-319, decisions-log.md)

Backend 271/3179 verdes (+31 novos), cobertura 86,63%/84,85%/86,95%/86,63% (acima do threshold).
`npm run typecheck`/`lint`/`check-boundaries`/`validate-schemas`/`build:lambdas` limpos.

## Auto-nota cega (Claude, antes de ver a crítica do Codex)

Ver `round-1-claude-selfgrade.md` (arquivo separado, nunca incluído no que o Codex lê — lição
aplicada desde a Rodada 1 do D-321/D-329).
