# Document Domain — Rodada 6 (Crítica Codex, fechamento)

**APPROVED — nota final: 9,3/10, sem arredondamento.**

O único bloqueio da Rodada 5 foi genuinamente fechado: a Rodada 6 reconhece os 7 dias de `REJECTED`/`WITHDRAWN` como extensão nova de `USER_DOCUMENT` (com atualização futura explícita nomeada em `privacy-lgpd.md`), aplica a `RequestAccessCredential`/`GuestSession` o prazo genérico normativo de 7 dias de `TRANSIENT` (sem analogia indevida a `InvitationTokenPointer`), e corrige a contagem para 3 classes utilizadas dentre as 9 existentes. Nenhum problema novo bloqueante identificado.

## 9 decisões técnicas fechadas (resumo do Codex)
1. State machines explícitas para `Document` e `DocumentVersion`, com transições condicionais, OCC e estados terminais definidos.
2. Modelo current-vs-superseded e access patterns DynamoDB (GSI1 discriminado, GSI2 novo, GSI5 novo — nunca GSI3/GSI4/GSI6), com `acceptVersion` atômico e idempotente em até 10 ações.
3. `DocumentVersion.state` como fonte de verdade e `DocumentVersionEvent` append-only como auditoria (distinto de `OutboxEvent`).
4. Acesso guest em duas camadas: `RequestAccessCredential` revogável (longa) + `GuestSession` curta, selector+secret, escopo server-side, CSRF, interstitial obrigatório, rate limiting multidimensional.
5. `Requirement` com `applicability` persistida, evidência singular (`evidenceVersionId`), status derivado deterministicamente + job diário de reindexação para `SATISFIED→NOT_SATISFIED`.
6. Arquivos pertencem a uma Version; principal obrigatório, scan individual (`pendingFileScans`/`infectedFileScans`), imutabilidade após aceite.
7. Archive não altera evidência (Requirement deriva de Version, nunca de Document.status); somente `DRAFT` pode ser removido diretamente; demais dados seguem retenção D-127/`privacy-lgpd.md` (`USER_DOCUMENT`/`SECURITY_AUDIT`/`TRANSIENT`).
8. Recorrência preserva série/ocorrência/causalidade (`seriesId`/`occurrenceId`/`requestId`/`attemptIndex`/`parentRequestId`); materialização do ponteiro e do Request numa única transação atômica (`materializeAttempt`).
9. Permissões reutilizam o RBAC existente (`WRITE_ROLES` tenant-wide, `assertReviewerOrAdmin()` como camada de serviço separada); confirmação de IA usa `extraction:confirm` já existente; download por Viewer (A1) permanece decisão de produto aberta, nenhuma action nova adicionada.
