# Rodada 2 — Achado que fecha o scoping (Claude) + resposta adversarial (Codex)

## Achado novo (Claude)

Aceitos integralmente os 4 pontos da crítica da Rodada 1 (todos verificados, todos procedem).
Antes de escrever um design de Rodada 2, um achado adicional muda a conclusão por completo:

`src/modules/extraction/domain/field-schema.ts` linha 29 — `FIELD_SCHEMA_V1` contém **exatamente
um campo**: `{ fieldName: "expirationDate", required: true, valueType: "DATE" }`. O próprio
docblock do arquivo (linhas 6-8) confirma que é deliberado: "v1 only extracts `expirationDate`...
deliberately narrow rather than inventing additional product fields no design document specified."

Isso significa que `ExtractedField.confirmedValue` — a única coisa que sobrevive de forma durável
do pipeline de OCR/extração hoje — nunca é texto livre. É sempre uma DATA. A Decisão 2 da Rodada 1
("indexar `confirmedValue` como busca sobre campos extraídos") não tem NENHUM corpus de texto real
para indexar hoje — uma data não precisa nem se beneficia de busca por token/full-text, já é
consultável estruturalmente (é isso que `Requirement.evidenceValidUntil`/os 3 modos de busca de
D-194 já fazem).

Juntando os dois achados (Codex Rodada 1 + este): não existe hoje NENHUM texto livre durável
derivado de OCR em lugar nenhum do sistema — nem no S3 (efêmero por LGPD), nem no DynamoDB (só a
data). Os únicos textos livres duráveis que já existem (`TrackedSubject`/`Requirement` nome/notas)
são texto digitado por usuário, não derivado de OCR, e já estão cobertos pela busca por nome de
D-194 (Fatia 3, já implementada) — indexá-los de novo sob o nome "item 14 (busca OCR/full-text)"
seria renomear uma feature já entregue, não entregar algo novo.

**Leitura provisória submetida à crítica**: isto não é mais uma decisão de engenharia a resolver via
protocolo — é um bloqueio genuíno de produto. O item 14, como está redigido no roadmap ("Busca
OCR/full-text"), não tem como ser entregue com valor real hoje sem uma de duas coisas, ambas
decisões de produto/privacidade que não cabem à autoridade delegada ao protocolo Claude↔Codex: (a)
reabrir a postura de LGPD de M7 e reter algum texto OCR de forma durável — reversão de um
compromisso de privacidade já declarado publicamente no design ("nada aqui deve sobreviver a uma
restauração de disaster recovery"), não uma escolha de mecanismo; ou (b) esperar o pipeline de
extração crescer além de um único campo DATE (decisão de produto separada sobre quais campos
extrair).

Pergunta direta submetida ao Codex: concorda que isto é um bloqueio genuíno de produto (diferente
do achado "Document sem name/tags" de D-194, que FOI resolvido dentro da autoridade delegada), ou
existe um caminho de engenharia proporcional que entregaria valor real do item 14 sem depender de
(a) ou (b)?

## Resposta adversarial (Codex)

Concordo com a conclusão central: isto virou bloqueio genuíno de produto/privacidade, não uma
decisão de engenharia que o protocolo deva "resolver" com mecanismo.

O achado confere. `field-schema.ts` linha 7 declara que v1 só extrai `expirationDate`, e linha 28
confirma o array único `{ fieldName: "expirationDate", required: true, valueType: "DATE" }`.
Portanto não há corpus textual OCR durável para busca. O único valor durável derivado de OCR hoje é
uma data, e isso já pertence ao eixo estrutural de validade, não a full-text/token search.

**Crítica adversarial (precisão adicional, não derruba a conclusão)**: a frase "os únicos textos
livres duráveis já estão cobertos por D-194" precisa de precisão. D-194 cobre `namePrefix`/substring
em `Subject`, `Requirement.name` e `ExpirationItem.name`, mas não cobre todo texto livre durável:
há `notes`/`description`/`DocumentType.displayName`/`RequirementTemplate.description` em alguns
domínios. Isso não derruba a conclusão, porque esses campos são metadata digitada pelo usuário, não
OCR. Indexá-los agora seria uma feature nova de busca em metadados, não "Busca OCR/full-text".

Nenhum caminho proporcional de engenharia entrega valor real do item 14 sem uma das duas decisões
externas nomeadas. As alternativas aparentes falham:
- Indexar `confirmedValue`: indexa datas, baixo valor e semanticamente duplicado.
- Indexar texto OCR e apagar o blob: ainda retém conteúdo derivado pesquisável, reabre LGPD.
- OCR on-demand a cada busca: custo/latência/privacidade ruins, sem índice real, reprocessa
  documento sensível sem necessidade.
- Indexar metadata manual: pode ser útil, mas é outro item de produto.

A diferença contra D-194 é exatamente essa: em D-194 havia entidades duráveis reais com campos
pesquisáveis e a decisão era "qual forma de acesso proporcional?". Aqui falta o objeto de busca.
Criar esse objeto é decisão de produto/privacidade ou expansão do pipeline de extração.

**Nota cega sobre a conclusão "scoping fechado com bloqueio nomeado, sem design de
implementação": 9,3/10.**

Fechamento sugerido: item 14 bloqueado até Marcelo escolher entre reter texto OCR durável, expandir
o schema de extração para campos textuais específicos, ou reclassificar o item como busca genérica
de metadata manual (item de produto distinto).

## Nota cega — Claude

**9,4/10** sobre a mesma conclusão. A precisão adicional do Codex (campos `notes`/`description`
existentes fora da cobertura de D-194) fortalece o achado em vez de enfraquecê-lo — confirma ainda
mais que qualquer "full-text" alcançável hoje seria busca em metadado manual, não em conteúdo
derivado de OCR, então não entregaria o que o item 14 promete.

**Ambos ≥9,0, convergência em 2 rodadas (mais rápido que o mínimo de 3 porque a Rodada 2 não propõe
um novo design a debater — encontra e confirma adversarialmente que a Rodada 1 partia de uma
premissa física inválida, fechando o scoping com um bloqueio nomeado em vez de uma decisão de
design). Nenhum código alterado.**
