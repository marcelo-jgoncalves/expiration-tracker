# Document Domain — Rodada 4 (Crítica Codex)

**Nota: 8,4/10 — REABRIR.** Íntegra em `round4-codex-critique-full.txt`. Resolvidos de forma substantiva: pontos 1 (AP8), 2–3 (fences/leitura antes da transação), 6 (claim/reviewer), 7 (scan CLEAN/INFECTED).

## 4 bloqueios mínimos restantes
1. **Idempotência**: `attribute_not_exists(PK_SK)` usa uma convenção de atributo que não existe no projeto — precisa ser `attribute_not_exists(PK)`/`attribute_not_exists(SK)` sobre as chaves reais compostas.
2. **Lista transacional**: contagem real é 10 ações (não 8-9) — Update Requirement fundido conta como 1, mas mirrors do Request são 2 ações (Delete antigo + Put novo), listadas explicitamente sem ambiguidade.
3. **Retenção incoerente com `privacy-lgpd.md` real**: `USER_DOCUMENT` já cobre "Document/S3, campos e runs" (Document/Version/File pertencem lá, não a `CORE_USER_DATA`); `DELIVERY_RECORD` é para intents/attempts de entrega, não para Version rejeitada; `TRANSIENT` tem prazo normativo de 7 dias (não "sem purga por idade") com sub-prazos próprios por tipo.
4. **Recorrência**: avançar `latestAttemptIndex` antes de criar o Request deixa uma lacuna real sob falha parcial (ponteiro avança, Request nunca é criado) — os dois precisam estar na MESMA transação.
