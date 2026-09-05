# Rodada 1 — Crítica Codex (resposta à proposta em `round1-claude-proposal.md`)

Nota cega: **7,6/10** (régua/checklist), **7,1/10** (design contra a régua). Não aprovável na
Rodada 1.

---

Os fatos de base conferem por leitura direta: `EXTRACTION_TRANSIENT` é explicitamente efêmero e
não entra em DynamoDB/logs/eventos/backups (`docs/architecture/privacy-lgpd.md:45`);
`ExtractedField.confirmedValue` é o dado durável confirmado
(`src/modules/extraction/domain/extracted-field.ts:27`); D-194 deixou full-text/relevância fora de
escopo e deferiu `SearchableDocument + GSI10`
(`docs/architecture/reviews/search-and-filters-scoping/estado-final-consolidado.md:111`); e o
teste de infra afirma exatamente 9 GSIs (`infra/modules/dynamo-table/tests/dynamo_table.tftest.hcl:30`).

Concordo com a Decisão 1: busca genuinamente full-text sobre corpo OCR sem reabrir privacidade é,
na prática, uma contradição. Mesmo que o blob bruto seja apagado, um índice invertido durável de
tokens do corpo do documento ainda é conteúdo derivado do OCR, pesquisável, restaurável via backup,
sujeito a dicionário e possivelmente dado pessoal/sensível. Isso reabre `privacy-lgpd.md` do mesmo
jeito, só com outro formato físico. Se a proposta só indexa `confirmedValue`, ela deixou de ser
full-text de corpo. Isso é honesto, mas não é só engenharia.

O maior problema é a Decisão 2 como "satisfaz o roadmap". Renomear para "busca sobre campos
extraídos e metadados" é tecnicamente correto, mas decidir que isso cumpre o item "Busca
OCR/full-text" é decisão de produto. O protocolo pode recomendar esse estreitamento, mas Marcelo
deveria aceitar explicitamente a mudança de promessa: campo extraído confirmado não é corpo de
documento. Hoje o schema real parece tornar isso ainda mais fraco: o pipeline v1 só tem
`expirationDate` como campo concreto em vários comentários/call sites, então o valor incremental
pode ser basicamente busca por datas mais nomes/notas já pesquisáveis por D-194.

O checklist está bom no eixo privacidade/custo/complexidade, mas incompleto para aprovar design
físico. Faltam critérios pesados para: manutenção correta do índice em todo lifecycle, bounded read
amplification por token, cardinalidade/limites por tenant, classificação LGPD do índice derivado,
backfill/reparo autoritativo, e critério de produto para "isso ainda merece o nome do item 14?". Eu
reduziria o peso de custo: a premissa antiga contra OpenSearch Classic continua válida, mas a AWS
agora documenta NextGen com scale-to-zero após 10 minutos e sem mínimo de OCU; isso não torna
OpenSearch correto agora, mas enfraquece "custo zero/baixo" como bloqueador principal. Fontes
oficiais: AWS scale-to-zero docs
(`https://docs.aws.amazon.com/opensearch-service/latest/developerguide/serverless-scale-to-zero.html`)
e pricing (`https://aws.amazon.com/opensearch-service/pricing/`).

A Decisão 3 ainda não está aprovável. "Item novo por `(tenantId, token)` com SK apontando para
dono" está ambíguo: se for literalmente um item por token com lista de donos, bate 400 KB e gera
contenção; se for posting por `(tenant, token, entity)`, precisa dizer isso. Além disso, tokens
frequentes como "contrato", "certidao", "validade", anos e nomes comuns viram partições grandes.
Não basta dizer `scanLimitReached`: busca AND entre tokens precisa de algoritmo de interseção,
escolha determinística de token âncora, limite por token, semântica clara quando o token âncora
capou antes de achar interseções, e proteção contra consultas de termos comuns.

Há também um gap real de evento. O outbox existente de `ExtractedField` para document-archive só
dispara quando `validUntil` muda: `effect.kind === "SET"`
(`src/modules/extraction/persistence/dynamodb-extracted-field-store.ts:91,245`); a própria enum diz
que esse destino é para refresh de evidência, não indexação genérica (`src/shared/outbox/outbox.ts:42`).
Então "worker lendo outbox" não existe como fonte confiável para todos os `confirmedValue`. Seria
preciso novo evento/destination ou escrita síncrona de postings dentro das transações de
confirmação/auto-confirmação.

Mais um bloqueio: ciclo de vida. `DocumentVersion` tem estados `ACCEPTED`, `REJECTED`,
`SUPERSEDED`, `WITHDRAWN` (`src/modules/document-archive/domain/document-version.ts:26`);
`Requirement` guarda evidência/cache e campos livres como `name`/`notes`
(`src/modules/document-archive/domain/requirement.ts:44`). A proposta não define se busca retorna
versões superseded/rejected, documentos arquivados, requisitos unlinked, tipos deprecated/renomeados,
nem como remove postings quando essas fontes mudam. Sem isso, o índice vai retornar coisa
semanticamente morta ou stale indefinidamente.

## Respostas diretas

1. Checklist contestado. Falta "correção e lifecycle do índice" e "bounded query/write
   amplification" com peso alto. Também falta "classificação LGPD/retention/export/purge do índice
   derivado".
2. Decisão 1 correta. Busca full-text de corpo sem reabrir privacidade só existe se nada durável
   for deixado, o que torna a busca impossível depois do OCR transient sumir.
3. Decisão 3 tem problemas reais: hot/large partitions, AND sem algoritmo bounded, evento
   inexistente para todos os campos confirmados, remoção/reparo/backfill não definidos.
4. Sim, há bloqueio de produto: aceitar que o item 14 deixa de ser "OCR/full-text de corpo" e vira
   "busca em campos extraídos confirmados/metadados".
