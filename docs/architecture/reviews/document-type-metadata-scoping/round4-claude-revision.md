# Rodada 4 — Fechamento (desambiguação de caps, reconciliação do achado novo-novo)

Régua v2 estável desde a Rodada 2 (9,2/9,1). Design em 8,8/10 na Rodada 3 por 1 ambiguidade de redação real + 1 achado que era, na verdade, já resolvido desde a Rodada 2 mas não visível ao Codex nesta rodada por um prompt incompleto (ver `round3-codex-critique.md`, nota de reconciliação). Esta rodada fecha os dois sem introduzir nenhuma decisão nova.

## Fechamento 1 — desambiguação `labelSnapshot` (SELECT) vs. `value` (TEXT)

São dois campos DIFERENTES, cada um com seu próprio cap, nunca confundidos:

- `DocumentMetadataValue` variante `SINGLE_SELECT`: `labelSnapshot: string` — cópia do `label` da opção NO MOMENTO da escrita (Decisão 2/Rodada 2). Cap: **≤ 200 caracteres**, o MESMO cap de `DocumentTypeFieldOption.label` (Decisão 4/Rodada 3) — faz sentido serem iguais porque `labelSnapshot` é literalmente uma cópia de `option.label`, nunca pode ser maior que a fonte que copia.
- `DocumentMetadataValue` variante `TEXT`: `value: string` — texto livre digitado pelo usuário para um campo `TEXT`, conceito TOTALMENTE diferente de `labelSnapshot` (não deriva de nenhum catálogo de opções). Cap: **≤ 500 caracteres**, mantido como já declarado na Rodada 2.

Não há sobreposição real — cada cap se aplica a um campo de um tipo de `DocumentMetadataValue` que nunca coexiste com o outro (a união discriminada por `valueType`, Decisão 2, já impede um valor `SINGLE_SELECT` de ter `value: string` livre e um valor `TEXT` de ter `labelSnapshot`). A ambiguidade que o Codex apontou era só de EXPOSIÇÃO na Rodada 3 (os dois caps apareciam em frases próximas sem dizer explicitamente "são campos diferentes") — nenhuma mudança de contrato, só a clarificação acima.

## Fechamento 2 — cap de opções (reconfirmação, não decisão nova)

Já declarado desde `round2-claude-revision.md`, Decisão 1 revisada, e nunca contestado nas Rodadas 2/3 anteriores (a Rodada 3 só não recebeu o texto completo da Rodada 2 no prompt — falha de montagem de prompt do Claude, documentada em `round3-codex-critique.md`):

- `MAX_ACTIVE_OPTIONS_PER_FIELD = 50` (opções com `status=ACTIVE` de um único campo `SINGLE_SELECT`).
- `MAX_TOTAL_OPTIONS_PER_FIELD = 150` (ativas + arquivadas juntas, hard ceiling físico, mesmo racional de `MAX_TOTAL_METADATA_FIELD_DEFINITIONS=100` — nunca reduzido por purge, já que `DocumentTypeFieldOption` nunca é removida fisicamente, mesma regra de "nunca delete" que vale para a definição de campo em si).
- Comportamento ao exceder: `POST`/`PATCH` que tentaria criar a 51ª opção ATIVA ou a 151ª opção TOTAL retorna 400 (erro de validação, mesmo padrão de todo outro cap explícito já existente no projeto — `MAX_FILES_PER_VERSION`, `MAX_DOSSIER_REQUIREMENTS`, `RequirementTemplate` cap 30 — nunca uma resposta 500 opaca).
- Confirmado: nenhuma rota/mecanismo de purge físico de opção existe, mesma regra do Fechamento 1/Decisão 1 da Rodada 3 para definições de campo — consistente por construção, não por coincidência, já que ambas são regidas pelo mesmo princípio "nunca delete" (Critério 3 da régua v2).

## Estado final: nenhum achado aberto restante

Relendo os 3 achados originais da Rodada 1 (8 itens), os 4 da Rodada 2, e os 2 da Rodada 3 (1 real + 1 reconciliado) — todos fechados com mecanismo concreto, sem contradição remanescente encontrável contra os 8 critérios da régua v2.

## Nota do design (Rodada 4) contra a régua v2 (estável)

**Auto-nota do Claude**: 9,4/10.
