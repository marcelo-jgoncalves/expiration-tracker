# Rodada 1 — Proposta Claude: Busca OCR/Full-text (Roadmap P1, item 14)

Você é o Codex, parceiro de debate adversarial no protocolo Claude↔Codex (`AGENTS.md` §4) do
projeto expiration-tracker. Preciso da sua crítica adversarial e nota cega (0-10) sobre a proposta
abaixo, seguindo exatamente o mesmo padrão já usado nas decisões D-179, D-191, D-194, D-197,
D-200, D-201 deste repositório (protocolo mínimo 3 rodadas, nota cega, ≥9,0 de ambos sem
arredondar para fechar). Este é o registro real do projeto — trate como uma decisão de engenharia
real, não um exercício hipotético.

## Contexto do projeto (fatos verificados por leitura direta de código, não presumidos)

Micro-SaaS serverless AWS/DynamoDB single-table. Sem usuários reais, sem produção — só ambiente
`dev` sintético/resetável (`AGENTS.md` §1). Roadmap de lançamento P0 fechado; estamos no backlog
pós-lançamento P1. Item 14 do backlog: "Busca OCR/full-text" — descrito no roadmap como "valor
crescente conforme o acervo documental aumenta".

**Achado central desta rodada de scoping (motivo pelo qual isto precisa de protocolo, não é
mecânico)**: o texto OCR completo NUNCA é persistido de forma durável hoje — é uma decisão de
privacidade (LGPD) já `APPROVED` desde o design de M7:

- `docs/architecture/privacy-lgpd.md` linha ~45-47: "o texto OCR nunca é o dado final do
  sistema... é um artefato de trabalho intermediário... nada aqui deve sobreviver a uma
  restauração de disaster recovery."
- `src/modules/extraction/ports/ocr-artifact-store.ts` (linhas 1-8): o artefato bruto do Textract
  vive em S3 na classe de retenção `EXTRACTION_TRANSIENT`, sem versionamento/backup/replicação,
  lifecycle de 24h como rede de segurança.
- O artefato bruto é **deletado explicitamente** por `ExtractionValidationTaskHandler` ao fechar o
  run (mesmo arquivo, linhas 28-37).
- O que sobrevive de fato: `ExtractedField` (`src/modules/extraction/domain/extracted-field.ts`,
  linhas 27-51) — `candidateValue`/`confirmedValue`, strings curtas por campo nomeado (ex.: uma
  data, um número de documento), nunca o corpo do documento inteiro.

Ou seja: "busca full-text" hoje não é "adicionar índice sobre texto que já existe" — é primeiro
decidir se algum texto extraído deveria passar a ser retido de forma durável, o que reabre (ou
não) uma postura de privacidade já decidida.

**Precedente direto, já `APPROVED`**: `docs/architecture/reviews/search-and-filters-scoping/
estado-final-consolidado.md` (D-194, protocolo completo, 5 rodadas, Claude 9,2/Codex 9,3) listou
"busca full-text/relevância" EXPLICITAMENTE fora de escopo (linha 111) e deferiu uma "Fatia 4"
(projeção materializada `SearchableDocument` + `GSI10`) com gatilho quantitativo nomeado — mas essa
fatia é sobre campos estruturados já persistidos (facetas), não sobre corpo de documento, então não
cobre o item 14 mesmo se construída. `searchSubjects`/`searchRequirements`/`searchExpirationItems`
(D-194 Fatia 3, já implementada) usam Query em índices tenant-facing já existentes (GSI7/GSI1/GSI1)
+ filtro em memória, contrato de paginação `{items, cursor, scanLimitReached}`.

**Estado físico do modelo de dados**: GSI1-9 todos reivindicados (GSI3/GSI6/GSI8 isolados por IAM
via `dynamodb:LeadingKeys`; GSI1/2/5/7/9 tenant-facing) — `infra/modules/dynamo-table/main.tf`,
contagem exata testada em `infra/modules/dynamo-table/tests/dynamo_table.tftest.hcl:30`
(`length(...) == 9`). Sem teto rígido no DynamoDB (permite até 20/tabela), mas o teste do projeto
afirma um número exato que precisa ser deliberadamente incrementado a cada GSI novo — mesma classe
de dívida que D-193 encontrou e corrigiu (GSI8→9 nunca atualizado). GSI10 seria o próximo slot
livre, se um novo índice for necessário.

**Isolamento de tenant no padrão já usado**: para itens da tabela BASE (não GSI restrito), o
isolamento é feito no nível de aplicação (`RequestContext`/RBAC/`executeTenantBusinessMutation`),
não por política IAM de `LeadingKeys` — esse mecanismo IAM só existe para os 3 GSIs deliberadamente
restritos (GSI3/GSI6/GSI8). Um item novo de tabela base seguiria o mesmo padrão de isolamento que
`Requirement`/`Document`/etc. já usam hoje.

## Pesquisa externa (E-014): declaração **SIM PARCIAL**

Busca full-text sobre texto extraído de documento é um padrão com solução de mercado conhecida
(motor de busca dedicado vs. índice embutido/nativo) — mas o fork real deste projeto ("reter ou
não texto bruto, dado que hoje é deliberadamente efêmero por LGPD") é uma decisão interna que
fontes externas não resolvem.

Fontes datadas (todas consultadas 2026-09-05):
- AWS, "Amazon DynamoDB zero-ETL integration with Amazon OpenSearch Service" (What's New,
  2023-11) e "Implementing search on Amazon DynamoDB data using zero-ETL integration with Amazon
  OpenSearch Service" (AWS Database Blog): busca full-text/fuzzy/agregação quase em tempo real
  sobre dado do DynamoDB.
- AWS OpenSearch Serverless, pricing (2026): coleções Classic exigem mínimo de 2 OCUs em produção
  (~US$350/mês) ou 1 OCU sem redundância (~US$175/mês) mesmo em `dev`; coleções **NextGen** (GA
  2026-05-28) removem o piso mínimo de OCU e escalam a zero após 10 minutos ociosas, a
  US$0,24/OCU-hora.
- Nota de adoção de mercado (2026-08): OpenSearch Service em ascensão (12,3%, alta ante 5,4% ano
  anterior); Kendra em queda (6,0%, ante 11,3%) — Kendra serve bem busca "turnkey" baseada em
  conectores; OpenSearch serve melhor quando full-text + busca vetorial futura compartilham o
  mesmo armazenamento.
- Nenhuma fonte AWS recomenda um cluster de busca dedicado para volume de documento
  próximo-de-zero e zero usuário real; toda orientação consciente de custo nesse regime favorece
  adiar até o volume justificar — consistente com `docs/engineering/principles.md` #1 e com o
  próprio raciocínio de proporcionalidade de D-194.

### Checklist ponderado proposto (base de nota desta rodada — sujeito a contestação sua)

| # | Critério | Peso | O que testa |
|---|---|---|---|
| 1 | Decisão de retenção de texto enfrenta o tradeoff LGPD explicitamente (nunca reaberta em silêncio) | 20% | A proposta nomeia que `EXTRACTION_TRANSIENT` é deliberadamente não-durável e justifica o que muda (retenção completa vs. só índice derivado vs. indexar-e-ainda-deletar-o-bruto)? |
| 2 | Custo em volume zero/baixo | 20% | Nenhum custo de infra obrigatório novo enquanto só `dev`, sem usuário real (descarta o piso de custo do OpenSearch Serverless Classic; NextGen ou nativo DynamoDB passam) |
| 3 | Complexidade operacional adicionada | 15% | Novo serviço/cluster para operar+monitorar vs. reuso de padrões DynamoDB/Terraform/Lambda já existentes |
| 4 | Mecanismo de isolamento de tenant | 15% | Mesmo rigor do precedente de índice restrito por IAM (GSI3/GSI6/GSI8) onde aplicável, ou isolamento de aplicação consistente com o resto da tabela base |
| 5 | Tolerância a staleness do índice | 10% | Consistente com o padrão já `APPROVED` de D-193 (outbox → worker → releitura fresca, nunca stale-write) |
| 6 | Qualidade de relevância/ranking | 10% | Match por token/substring é aceitável no volume atual vs. necessidade genuína de ranking de relevância |
| 7 | Consistência do contrato de paginação | 10% | Deve se encaixar ou estender de forma aditiva o contrato `{items, cursor, scanLimitReached}` de D-194, nunca inventar uma quarta forma incompatível |

## Proposta (Rodada 1)

**Decisão 1 — Retenção de texto**: NÃO reverter a postura de LGPD do M7. O artefato bruto do
Textract em `EXTRACTION_TRANSIENT` continua efêmero, deletado como hoje. Nenhuma retenção nova de
blob de texto de documento inteiro.

**Decisão 2 — Escopo honesto de "full-text"**: renomear o entregável real para "busca sobre
campos extraídos e metadados" (não "corpo completo do documento") — indexar o que já sobrevive de
forma durável: `ExtractedField.confirmedValue` (nunca `candidateValue`, que pode ainda mudar antes
da confirmação humana — só o valor confirmado é fonte estável o suficiente para indexar) por
`Requirement`/`DocumentVersion`, mais os poucos campos de texto livre que já existem no domínio
(`DocumentType.displayName`, o que mais o Codex encontrar por leitura). Nomear esse
estreitamento explicitamente no design final, no mesmo espírito de D-194 (nunca redefinir "busca"
silenciosamente para significar menos do que o item do roadmap sugere).

**Decisão 3 — Mecanismo**: índice invertido nativo do DynamoDB na tabela BASE (não GSI) — tokeniza
`confirmedValue` (lowercase, split simples por espaço/pontuação, sem stemming nesta fase), um item
novo por `(tenantId, token)` com `PK=TENANT#<tenantId>#SEARCHTOKEN#<token>`, `SK` apontando para o
`Requirement`/entidade dona, populado por um worker assíncrono lendo o outbox (mesmo padrão de
`requirement-evidence-refresh`, D-193 slice 6: relê fresco no momento do processamento, nunca
confia em snapshot do evento; idempotente; sem GSI novo, então sem impacto no teto de 9 GSIs nem
no `tftest.hcl`). Sem motor de busca dedicado, sem custo de infra novo em `dev`.

**Decisão 4 — Consulta**: novo modo `searchExtractedFieldValues` (nome sujeito a crítica),
espelhando o contrato de paginação de D-194 (`{items, cursor, scanLimitReached}`), Query por
token(s) exigido(s) (AND simples entre tokens, sem OR/ranking de relevância nesta fase — mesmo
argumento de proporcionalidade de D-194), status obrigatório/singular na mesma convenção das 3
buscas existentes.

**Alternativas consideradas e rejeitadas**: (a) OpenSearch Serverless (Classic ou NextGen) —
rejeitado nesta fase por complexidade operacional desproporcional a zero usuário real, mesmo com
NextGen removendo o piso de custo (ainda é um serviço novo, um IAM novo, uma dependência
operacional nova que D-194 já recusou pagar para uma necessidade mais simples); revisitar se/quando
o mesmo gatilho quantitativo de D-194's Fatia 4 (`TenantEntitlement` subir, uso real mostrar custo)
disparar. (b) reverter a postura de LGPD e persistir texto bruto completo — rejeitado como decisão
de privacidade separada, maior, que deveria ser nomeada e escalada distintamente se algum dia for
genuinamente necessária (não é o que o roadmap pede: "busca crescente conforme o acervo aumenta"
é satisfeito por busca sobre campos extraídos, não exige corpo bruto).

## Pergunta para sua crítica adversarial

1. O checklist ponderado está completo e defensável, ou falta algo que você julgaria como critério
   pesado?
2. A Decisão 1 (não reabrir LGPD) e a Decisão 2 (nomear o estreitamento de escopo explicitamente)
   são a leitura certa do achado, ou você vê um jeito de entregar busca genuinamente full-text
   (corpo do documento) sem reabrir a postura de privacidade?
3. A Decisão 3 (índice invertido em item de tabela base, sem GSI novo) tem algum problema real de
   forma física, hot-partition, ou consistência que eu não vi? (ex.: tokens muito frequentes como
   "documento"/"contrato" viram partição quente?)
4. Existe algum bloqueio genuíno de decisão de produto (não de engenharia) que isto deveria
   escalar a Marcelo em vez de resolver via protocolo?

Dê sua crítica adversarial completa e sua nota cega (0-10, sem ver a minha) ao final.
