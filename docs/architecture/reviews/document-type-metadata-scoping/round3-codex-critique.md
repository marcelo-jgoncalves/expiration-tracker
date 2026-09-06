# Rodada 3 — Crítica do Codex

**Revisor**: Codex. **Data**: 2026-09-06.

## 1. Fechamento dos 4 achados da Rodada 2

1. **Purge físico vs. "nunca delete"**: **FECHOU.** A correção remove a contradição de verdade e assume a consequência (teto permanente de 100).
2. **`required` e `createDocument()`**: **FECHOU.** Texto explícito de que `createDocument()` nunca toca `metadataValues`; Document sempre nasce com a chave ausente; `required` só governa `null` explícito, nunca campo ausente do corpo.
3. **OCC de opções**: **FECHOU para concorrência** — mutações de opção são sub-operação do mesmo PATCH de campo, mesma `TransactWriteItems`/`expectedDocumentTypeVersion`.
4. **Limites numéricos/storage**: **FECHOU parcialmente** — resta uma ambiguidade de redação entre `SELECT.labelSnapshot ≤ 200` (implícito do cap de `option.label`) e `TEXT/labelSnapshot de valor ≤ 500` — precisa separar explicitamente qual cap vale para qual caso.

## 2. Achado novo-novo

Aponta falta de cap de quantidade de opções por campo/DocumentType (`MAX_TOTAL_OPTIONS_PER_FIELD`), citando risco de storage ilimitado — **achado levantado sem visibilidade da Rodada 2 completa** (o prompt desta rodada trazia só o texto da Rodada 3/achados-4, não o texto integral de `round2-claude-revision.md`, que já declara `MAX_ACTIVE_OPTIONS_PER_FIELD = 50`/`MAX_TOTAL_OPTIONS_PER_FIELD = 150` na Decisão 1 revisada — ver nota de reconciliação abaixo).

## 3. Nota Final da Rodada 3

**Nota de design: 8,8/10.** Não pronta para fechar — pendências: desambiguar caps de `labelSnapshot`/`TEXT.value`, e (per o achado novo-novo, a reconciliar) confirmar cap de opções.

## Nota de reconciliação do Claude (achado novo-novo NÃO é um gap real — falha de contexto do prompt, corrigida na Rodada 4)

`round2-claude-revision.md`, Decisão 1 revisada, última frase: *"Mesmo padrão aplicado a opções de `SINGLE_SELECT`: `MAX_ACTIVE_OPTIONS_PER_FIELD = 50`, `MAX_TOTAL_OPTIONS_PER_FIELD = 150`."* — este cap já existe desde a Rodada 2, aceito sem contestação nas Rodadas 2 e 3 anteriores. O "achado novo-novo" da Rodada 3 é resultado de um prompt que trazia só o texto da Rodada 3 (deltas) sem reincluir o texto integral da Rodada 2 — falha de processo do Claude ao montar o prompt, não um gap real de design. Corrigido na Rodada 4 apenas RE-CITANDO o cap já existente para eliminar a ambiguidade (nenhuma decisão nova).
