# Roadmap Competitivo — Reconciliação e Macro-Ordem (D-161)

**Status: `APPROVED` via protocolo Claude↔Codex, 3 rodadas (7,6 → 9,2 → 9,6), Codex 9,6/10.**

Origem: `docs/project/roadmap-competitivo-2026-09-01.md`, documento de 26 funcionalidades trazido por Marcelo (2026-09-01) definindo o que falta antes do lançamento comercial, com ordem de prioridade P0/P1/P2/Futuro e estratégia de preço/limites (seções 12-13 — decisão comercial pura, **fora de escopo técnico, não avaliada por este protocolo**).

Marcelo pediu explicitamente: estabelecer a ordem de trabalho técnica e como cada item será feito, via protocolo Claude↔Codex — não implementar tudo de uma vez.

## O que este documento decide (e o que não decide)

**Decidido aqui**: a fotografia factual do que já existe vs. não existe no código para os 10 itens P0 anteriores ao frontend, a macro-ordem técnica de ataque, e o escalonamento de 4 decisões fundacionais que precisam de suas próprias rodadas antes de qualquer design de feature.

**Não decidido aqui** (fica para as próprias rodadas futuras, cada uma no seu tempo): o conteúdo arquitetural das 4 decisões fundacionais; os designs dos 10 itens P0 individualmente; preço/limites comerciais.

## Reconciliação factual (10 itens P0, antes do frontend)

O documento original de Marcelo assume que boa parte do domínio documental ainda não existe. Isso não é mais verdade — o Domínio Documental (D-143, Núcleo 1+2) fechou nesta mesma sessão, 100% implementado e deployado. Mas a reconciliação inicial (Rodada 1) foi otimista demais nos itens 4/9/10; a correção do Codex, verificada ao vivo contra o código, é a versão adotada aqui.

| # | Item (roadmap) | Estado real | Detalhe |
|---|---|---|---|
| 1 | Requirement Templates | **Greenfield** | `Requirement` (`document-archive/domain/requirement.ts`, D-143) é instância por Subject, não bundle reutilizável. Precisa entidade nova + aplicação em lote com snapshot/dedupe/idempotência. Deve referenciar Document Types (item 8) já estável. |
| 2 | Bulk onboarding / import | **Núcleo reutilizável, extensão grande** | `src/modules/import/` (M10) importa **`TrackedSubject`**, não `ExpirationItem` como a Rodada 1 assumiu — mas preview, plano em S3, dedupe, cursor retomável, commit em 2 fases já existem e são reusáveis. Extensão para Documents/Requirements/Templates continua substancial. |
| 3 | WhatsApp operacional | **Greenfield com scaffolding** | `notification/domain/notification-entitlements.ts` já tem `whatsapp.enabled`; `notification-router.ts:84` declara `SUPPORTED_CHANNELS = ["EMAIL"]` com comentário explícito "later submilestone". Nenhum provider real integrado. |
| 4 | IA/OCR no Document Lifecycle | **Motor pronto, integração P0 pendente** | M7 (`src/modules/extraction/`) é `E2E PROVEN` mas **ligado ao `Document` antigo** — usa `itemId`/`ExpirationItem`/`documentKey(tenantId,itemId,documentId)`, não aponta para o novo `DocumentVersion` de D-143. "Motor comprovado e reutilizável" é verdade; "quase pronto para P0" não é. |
| 5 | Busca e filtros | **Majoritariamente greenfield** | Achado real (verificado ao vivo): `document-archive-service.ts` linhas 97-98 têm um comentário afirmando que `createDocument()` grava GSI2 (Documents-by-Subject), mas o objeto `document` construído nas linhas 81-93 só espalha `documentGsi1Keys(...)` — `documentGsi2Keys(...)` nunca é chamado. **Bug real de comentário desalinhado do código**, não só lacuna de escopo. `Document` também não tem nome/responsável/tags ainda. |
| 6 | Dashboard operacional/compliance | **Greenfield** | Índices por status existem; nenhum read model/agregação, nenhuma fórmula de compliance definida. |
| 7 | Relatórios + export + audit | **Parcial, mais fechado que os outros** | `ActivityService` (D-149) já dá audit trail legível (ator+ação+objeto+timestamp) via `GET /activity`. CSV export (D-126) existe para `ExpirationItem`. Falta: `DocumentVersionEvent` não aparece automaticamente no feed de activity; relatórios específicos do domínio documental. |
| 8 | Document Types configuráveis | **Parcial conceitual** | `Document.documentType` já é campo real e já particiona GSI2 — mas é string livre, sem catálogo/CRUD/`documentTypeId` estável. |
| 9 | Guest Upload + Requests + Review + Recurrence | **Núcleo pronto, produto incompleto** | D-143 Núcleo 1+2 entrega credencial, sessão, CSRF, request, recurrence, review state machine — mas o "upload" guest só cria metadados `Document`/`DocumentVersion`, não recebe/presigna arquivo real. Sem `DocumentFile`, sem automated chasing do novo `DocumentRequest`. |
| 10 | Storage + Versioning + Renewal | **Versionamento pronto, storage ausente** | `DocumentArchiveService.acceptVersion()`/`rejectVersion()` (grafo de transição D-143 Decision 1) funcionam. Mas `commitUpload()` declara explicitamente storage/malware-scan fora do incremento atual — sem `DocumentFile`, sem preview, sem download real. |

**Classificação consolidada**: núcleo substancial reutilizável (2, 4, 7, 9, 10) · parcial conceitual (8) · greenfield (1, 3, 5, 6). Nenhum dos itens 4, 9 ou 10 está hoje fechável só com documentação/validação — todos têm gap estrutural real.

## Macro-ordem técnica aprovada

```text
Auditoria curta 4/9/10 (spike delimitado, inventário — sem autoridade para cristalizar contrato)
  ↓
10. Storage + file lifecycle (DocumentFile, S3 keys, malware scan, gates reais de commit/acceptance)
  ↓
8. Document Types configuráveis (documentTypeId estável — antes de Templates/import travarem a string livre)
  ↓
4. Adaptar M7 ao novo DocumentVersion (reusa Textract/Bedrock/confidence/review; redesenha só a fronteira de identidade)
  ↓
1. Requirement Templates (referencia Document Types já estável; snapshot/dedupe na aplicação em lote)
  ↓
9. Completar Guest/Requests/Review/Recurrence (upload/presign real, scan, chasing, histórico)
  ↓
2. Bulk onboarding documental (só depois de 8/1/9 estabilizarem; evolução por alvos: Subjects → Templates/Requirements → Documents/metadados → arquivos em lote → OCR assíncrono)
  ↓
5. Busca e filtros (corrigir o bug do GSI2 primeiro; decidir por item: query indexada / filtro pós-query / read model)
  ↓
6. Dashboard/compliance (reusa as definições de status de Busca/Requirement; fórmula de compliance é decisão de domínio própria)
  ↓
7. Relatórios/export/audit documental (reusa CSV/paginação existente; integra DocumentVersionEvent ao audit trail)
  ↓
3. WhatsApp operacional (protocolo próprio com pesquisa externa E-014, nível 6, ADR formal — consentimento/opt-out/delivery/custo/portabilidade de provider)
  ↓
Frontend completo do P0 (D-121, seção 2 do documento original — productização final após o backend estabilizar)
```

## As 4 decisões fundacionais (cada uma sua própria Rodada 1, quando for a vez)

1. **Modelo `DocumentFile`** — storage/scan/download, chaves S3, invariantes transacionais com `DocumentVersion`.
2. **Identidade e semântica de `DocumentType`** — migração da string livre atual para catálogo com `documentTypeId` estável, archive vs. delete, defaults.
3. **Fronteira M7 ↔ novo `DocumentVersion`** — o run de extração precisa identificar `DocumentVersion`, não `doc.version` do agregado antigo; `SUGGESTED != CONFIRMED` permanece invariante.
4. **Convivência ou supersessão entre `RequirementAssignment` legado e o novo `Requirement`** (D-143).

## Regra de proporcionalidade (correção da Rodada 2)

Nem todo item da lista acima é nível 5-6 por definição. Cada item recebe **scoping + classificação de risco pelo diff real** quando chegar sua vez (`docs/engineering/change-risk-scale.md`) — protocolo completo (3+ rodadas, nota ≥9,0) só quando o scoping classificar nível 5-6, ou Marcelo exigir explicitamente. Nível 3-4 segue implementação direta com julgamento de engenharia, mesmo padrão já usado no resto do projeto (D-151 a D-160).

Estimativa de risco provável por item (a confirmar no scoping real de cada um, não vinculante): Templates (5), Bulk import (5 no design multi-entidade, 3-4 por adapter depois), WhatsApp (6, novo terceiro com PII), OCR/M7 (5, muda fronteira entre módulos), Busca (5 se exigir GSI/read model novo, 4 para endpoints sobre índices já aprovados), Dashboard (4 se leitura bounded, 5 se materializar agregados), Relatórios/audit (4 para CSVs/queries novas, 5 para read model/contrato novo), Document Types (5, nova entidade), Guest completo (3-4 para wiring de decisões D-143 já aprovadas, 5 para contratos de file/chasing ainda não cobertos), Storage (5, nova entidade de arquivo + invariantes transacionais).

## Próximo passo real

Nenhum código foi alterado por este documento — é reconciliação + ordem, não implementação. A próxima sessão que tratar deste roadmap começa pelo spike de auditoria 4/9/10 (inventário, não decisão), depois abre a Rodada 1 da decisão fundacional #1 (`DocumentFile`).
