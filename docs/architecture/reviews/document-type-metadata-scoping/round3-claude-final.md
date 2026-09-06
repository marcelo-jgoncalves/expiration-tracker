# Rodada 3 — Tréplica final do Claude (fecha os 4 achados novos da Rodada 2)

Régua v2 já ESTÁVEL desde a Rodada 2 (Claude 9,2/Codex 9,1, ambos ≥9,0 — `round2-codex-critique.md` §1). Esta rodada só corrige o design contra ela, sem tocar a régua.

## Achado novo 1 — Contradição purge físico vs. "nunca delete" (Decisão 1)

**Corrigido removendo a possibilidade por completo, não reconciliando-a.** A frase sobre "operador remover fisicamente definições arquivadas muito antigas" é **retirada** — nenhuma rota, mecanismo ou intenção futura de purge físico de `DocumentTypeMetadataFieldDefinition`/`DocumentTypeFieldOption` existe neste design, ponto final, consistente com o Critério 3 da régua v2 sem exceção. `MAX_TOTAL_METADATA_FIELD_DEFINITIONS = 100` é portanto um **teto permanente e absoluto** por `DocumentType` (nunca reduzido por purge) — aceito conscientemente como limitação: um tenant que arquiva 100 definições ao longo do tempo perde a capacidade de criar novas naquele `DocumentType` especificamente (precisaria criar um `DocumentType` NOVO e migrar, fora de escopo desta fatia). Nomeado explicitamente como trade-off aceito, não escondido: 100 é uma margem generosa dado o volume real esperado (poucas dezenas de campos por tipo de documento é o caso de uso descrito no roadmap), e o produto não tem usuário real hoje para validar se isso jamais seria atingido na prática — se um tenant real algum dia bater nesse teto, é um problema de UX a resolver numa fatia futura (ex. permitir criar um segundo `DocumentType` com nome distinto), nunca resolvido enfraquecendo o invariante "nunca delete" agora.

## Achado novo 2 — `required` não cobre `createDocument()` (Decisão 5)

**Fechado explicitamente**: `createDocument()` **nunca** aceita nem grava `metadataValues` no corpo da requisição de criação — a única forma de escrever `Document.metadataValues` é o endpoint dedicado `PATCH .../metadata-values` (Decisão 7), nunca a rota de criação. Portanto **todo Document nasce com `metadataValues` ausente** (chave inteira ausente do item, não um objeto vazio — sparse de verdade, mesmo idioma de `evidenceVersionId` ausente), independentemente de quantos campos `required=true` o `DocumentType` tiver — `createDocument()` nunca verifica `required` porque nunca é o caminho de escrita de metadata. Isso é uma decisão de produto explícita, não uma lacuna: um Document é criado pelo fluxo de upload (uma ação sobre um ARQUIVO), preencher metadata estruturada é uma ação SEPARADA e posterior (preencher um formulário), exatamente como Salesforce/HubSpot/Airtable tratam "criar o registro" e "preencher os campos custom" como dois momentos distintos do fluxo de UI, nunca uma única transação atômica obrigatória.

Reescrita da Decisão 5 para eliminar também o conflito de redação que o Codex apontou (confundir "`null` explícito" com "ausente do corpo"):

> `required=true` bloqueia (400, nunca a escrita) uma tentativa de gravar `null` EXPLÍCITO para aquele `fieldId` no corpo de `PATCH .../metadata-values`, quando a definição ATIVA correspondente àquele `fieldId` tem `required=true`. Um `fieldId` simplesmente AUSENTE do corpo do PATCH (não mencionado) nunca é validado contra `required` — "ausente do corpo" (não tocar, Decisão 2) e "`null` explícito" (remover) são operações distintas, e `required` só governa a segunda. Consequência direta: um Document pode permanecer indefinidamente sem valor para um campo `required` (desde a criação, Achado 2 acima, ou porque ninguém nunca tentou limpá-lo) — `required` nunca é uma trava retroativa de leitura/listagem, só uma trava de ESCRITA no exato instante em que alguém tenta explicitamentemente remover o valor de um campo obrigatório.

## Achado novo 3 — OCC de opções incompleto (Decisão 7)

**Fechado por unificação, não por um mecanismo novo**: mutações de opção (adicionar opção nova, arquivar/reativar uma opção existente, renomear `label`) **não são uma rota separada** — são sub-operações do MESMO `PATCH /document-archive/document-types/{documentTypeId}/metadata-fields/{fieldId}` já coberto pela Decisão 7 original, porque `options` é um array embutido DENTRO da mesma `DocumentTypeMetadataFieldDefinition` que já vive dentro do mesmo `DocumentType`. O corpo do PATCH aceita um `optionsPatch?: Array<{op: "ADD" | "ARCHIVE" | "REACTIVATE" | "RENAME"; optionId?: string; label?: string}>` opcional ao lado dos campos de mutação do campo em si (`name`/`required`/`status`) — tudo isso é escrito na MESMA `TransactWriteItems` condicionada ao MESMO `expectedDocumentTypeVersion` já declarado (é uma única atualização do item `DocumentType`, `options` é só um campo aninhado a mais dentro dele, nunca uma segunda escrita/transação). Não há, portanto, um mecanismo de concorrência DISTINTO a especificar para opções — a OCC do `DocumentType.version` já cobre 100% das mutações possíveis dentro dele, campo ou opção, porque tudo é o mesmo item físico.

## Achado novo 4 — Limites de storage incompletos (Decisões 2/4/8)

Todos os limites amarrados explicitamente agora:

- `DECIMAL`: regex `^-?\d{1,15}(\.\d{1,4})?$` (até 15 dígitos inteiros + 4 decimais — cobre qualquer valor monetário/contratual realista deste produto com margem folgada, sem permitir uma string arbitrariamente longa).
- `NUMBER`: inteiro (`Number.isInteger(value)`, rejeitado se não for), `|value| <= 1_000_000_000_000` (1 trilhão — teto arbitrário generoso, documentado como "contagens/quantidades", nunca dinheiro — dinheiro é sempre `DECIMAL`, `NUMBER` nunca serve esse propósito, reforçado explicitamente no comentário do tipo).
- `DATE`: regex `^\d{4}-\d{2}-\d{2}$` E validação de calendário real (mês 01-12, dia válido para o mês/ano — reusa a MESMA função de parsing de data que o resto do projeto já usa para `validUntil`/datas de evidência, nunca uma segunda implementação de validação de calendário).
- `DocumentTypeFieldOption.label` (Decisão 4): mesmo cap de `labelSnapshot` (Decisão 2) — **≤ 200 caracteres** (não 500 — uma opção de select é um rótulo curto de catálogo, não texto livre; `TEXT`/`labelSnapshot` de valor mantêm 500 já que representam texto potencialmente mais descritivo). `DocumentTypeMetadataFieldDefinition.name` também ganha o mesmo cap de 200 (mesmo racional — nome de campo é rótulo curto, não texto livre).

## Resumo do que muda desde a Rodada 2 (nenhuma decisão estrutural nova, só fechamento de precisão)

Nenhuma das 4 correções acima introduz um conceito novo — a Decisão 1 fica MAIS restrita (remove uma possibilidade, não adiciona mecanismo), a Decisão 5 fica mais precisa sem mudar a semântica pretendida original, a Decisão 7 se torna explicitamente unificada (era implícito, agora é escrito), e os limites da Decisão 8 preenchem números concretos onde antes havia só a forma do tipo. Nenhum dos 8 achados originais da Rodada 1 é reaberto por estas correções.

## Nota do design (Rodada 3) contra a régua v2 (estável)

**Auto-nota do Claude**: 9,3/10 — todos os 4 achados novos da Rodada 2 fechados com mecanismo concreto (não promessa), nenhuma contradição interna remanescente que eu consiga encontrar relendo o documento inteiro contra os 8 critérios da régua v2 um a um.
