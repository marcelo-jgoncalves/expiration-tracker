# Estado Final Consolidado — Roadmap P1 item 14 ("Busca OCR/full-text")

**Status: SCOPING FECHADO COM BLOQUEIO GENUÍNO DE PRODUTO/PRIVACIDADE — protocolo Claude↔Codex
(`AGENTS.md` §4), 2 rodadas, nota cega final ambos ≥9,0 (Claude 9,4/Codex 9,3), sem arredondar.
Nenhum design foi aprovado. Nenhum código foi alterado.** Evidência completa: `round1-claude-proposal.md`,
`round1-codex-critique.md`, `round2-claude-pivot-and-codex-response.md` (neste diretório).

## Por que 2 rodadas, não o mínimo de 3

O mínimo de 3 rodadas de `AGENTS.md` §4 pressupõe que as duas partes estão convergindo para um
design. Aqui a Rodada 2 não propôs um novo design — encontrou e o Codex confirmou adversarialmente
que a Rodada 1 partia de uma premissa física inválida (existir texto livre extraído para indexar).
O resultado é um scoping fechado com bloqueio nomeado, análogo em espécie ao achado de auditoria de
D-198 (processo, sem mudança de código), não uma decisão Type 1 resolvida. Convergência em 2
rodadas é honesta aqui, não um atalho.

## Achado central (verificado por leitura direta de código, não presumido)

1. **Texto OCR bruto nunca é durável** — decisão de privacidade (LGPD) já `APPROVED` desde M4/M7:
   `docs/architecture/privacy-lgpd.md:45-47` ("o texto OCR nunca é o dado final do sistema... nada
   aqui deve sobreviver a uma restauração de disaster recovery"); artefato do Textract vive em S3
   `EXTRACTION_TRANSIENT` (`src/modules/extraction/ports/ocr-artifact-store.ts:1-8`), deletado
   explicitamente por `ExtractionValidationTaskHandler` ao fechar o run (mesmo arquivo, 28-37).
2. **O único dado extraído que sobrevive de forma durável é uma DATA, não texto livre** —
   `src/modules/extraction/domain/field-schema.ts:29`: `FIELD_SCHEMA_V1` contém exatamente
   `{ fieldName: "expirationDate", required: true, valueType: "DATE" }`, deliberadamente o único
   campo (docblock do arquivo, linhas 6-8). `ExtractedField.confirmedValue`
   (`src/modules/extraction/domain/extracted-field.ts:27-51`) é sempre essa data confirmada — nunca
   corpo de documento, nunca texto livre.
3. **Precedente direto já `APPROVED`**: D-194 (`docs/architecture/reviews/search-and-filters-scoping/
   estado-final-consolidado.md:111`) listou "busca full-text/relevância" explicitamente fora de
   escopo e deferiu uma Fatia 4 (`SearchableDocument`+`GSI10`) que é sobre campos ESTRUTURADOS já
   persistidos (facetas), não sobre corpo de documento — não cobre o item 14 mesmo se construída.
4. **Os únicos textos livres duráveis que já existem** (`TrackedSubject`/`Requirement` nome/notas,
   `DocumentType.displayName`, `RequirementTemplate.description`) são metadata digitada por
   usuário, não derivada de OCR — parcialmente já pesquisável via D-194 Fatia 3 (`searchSubjects`/
   `searchRequirements`, já implementada). Indexá-los sob o nome "item 14" seria renomear/duplicar
   uma feature já entregue, não entregar o que o roadmap promete.

## Conclusão: bloqueio genuíno de produto, não resolvível dentro da autoridade delegada ao protocolo

Diferente de D-194 (onde "Document sem name/tags" foi um achado de forma física resolvido dentro da
autoridade já delegada, redirecionando o design para a entidade certa), aqui **falta o próprio
objeto de busca** — não há nenhum jeito honesto de entregar "busca OCR/full-text" com valor real
sem uma de duas decisões que são genuinamente de produto/privacidade:

- **(a)** Reabrir a postura de LGPD do M4/M7 e reter algum texto OCR de forma durável — reversão de
  um compromisso de privacidade já declarado publicamente no design, não uma escolha de mecanismo.
  Mesmo indexar-e-ainda-deletar-o-blob-bruto não escapa disso: um índice invertido durável de
  tokens do corpo do documento ainda é conteúdo derivado de OCR, pesquisável, restaurável via
  backup — reabre a mesma questão de privacidade só que em outro formato físico (achado do Codex,
  Rodada 1).
- **(b)** Esperar o pipeline de extração (`FIELD_SCHEMA_V1`) crescer além do único campo
  `expirationDate` para incluir campos de texto livre genuinamente extraídos — decisão de produto
  separada sobre o que extrair, fora do escopo desta decisão.

Nenhuma alternativa de engenharia proporcional entrega valor real sem (a) ou (b): indexar
`confirmedValue` hoje só indexaria datas (baixo valor, já coberto estruturalmente); OCR on-demand a
cada busca tem custo/latência ruins e reprocessa documento sensível sem necessidade; indexar
metadata manual (`notes`/`description`) é uma feature de produto distinta, não "OCR/full-text".

## Pendente real, nomeado explicitamente

**Decisão de Marcelo necessária antes de qualquer trabalho de engenharia no item 14** — três
caminhos nomeados, nenhum escolhido aqui:
1. Reabrir a postura de LGPD de M4/M7 (retenção durável de texto OCR, com o próprio tradeoff de
   privacidade revisitado explicitamente).
2. Expandir `FIELD_SCHEMA_V1` para incluir campos de texto livre (decisão de produto sobre o que
   extrair, hoje só `expirationDate`).
3. Reclassificar o item como "busca em metadados" (nome/notas/descrição já digitados por usuário) —
   decisão de produto de renomear/redefinir o item, distinta de OCR/full-text.

Até essa decisão, o item 14 permanece **BLOQUEADO** no backlog P1 — não é o próximo item executável
por quem retomar a sessão. Nenhum código, schema ou infra foi alterado nesta rodada de scoping.
