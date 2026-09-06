# Rodada 2 — Revisão do Claude (incorpora a crítica de `round1-codex-critique.md`)

Ver `round1-claude-proposal.md` para o contexto/problema/decisões originais (1, 6, 8-decisão-9 mantidas onde não citadas abaixo como alteradas). Esta rodada substitui as citações de fonte imprecisas, reconcilia o checklist (régua v2, agora estável — ver critério de fechamento abaixo), e corrige as Decisões 1, 2, 4, 5, 7, 8 pelos achados reais do Codex.

## Citações de fonte corrigidas (achado real do Codex, aceito integralmente)

- Retirada a afirmação de que Salesforce prescreve "sempre arquivar e criar outro `fieldId`" — reformulada como inferência de design PRÓPRIA do Claude, informada (não ditada) pela cautela de conversão de tipo que a Salesforce Help realmente documenta.
- Retirada a citação de Contentful como fonte de "expand-and-contract explicitamente recomendado" — Contentful sustenta version/OCC em mutações de schema e validação prospectiva (isso sim, com precisão), não essa frase específica.
- Mantida a caracterização de Airtable/HubSpot como fontes do anti-padrão (conversão permissiva com perda) e do "tipos fechados mas não imutabilidade absoluta", respectivamente — o Codex confirmou ambas.

## Checklist Reconciliado (régua v2)

Peso redistribuído para acomodar os 2 critérios novos que o Codex identificou como ausentes (OCC/concorrência, identidade de opção) sem simplesmente diluir os 6 originais — os 2 critérios novos entram como próprios porque cobrem uma classe de risco (concorrência, não reinterpretação de tipo) que os 6 originais não tentavam cobrir, não são uma subdivisão deles:

1. **(peso 20%)** Definições de campo são imutáveis em `valueType` uma vez criadas.
2. **(peso 15%)** Um valor armazenado carrega tipo + identidade suficientes para ser interpretado e EXIBIDO corretamente sozinho, mesmo que a definição (ou uma opção `SINGLE_SELECT`) seja arquivada/renomeada depois — não só o tipo primitivo (correção do Codex ao Critério 2 original).
3. **(peso 15%)** Arquivar/remover uma definição de campo (ou uma opção) nunca apaga fisicamente nem corrompe valores já gravados — vira tombstone (`ARCHIVED`), nunca delete.
4. **(peso 10%)** Nenhuma mutação de tipo é implícita/instantânea na mesma escrita que edita a definição (`valueType` imutável elimina esta classe por construção).
5. **(peso 10%)** Validação (`required`) é só prospectiva: nunca bloqueia um Document que NÃO está sendo escrito agora; a âncora precisa distinguir explicitamente "Document existente intocado permanece válido para sempre" de "Document existente cujo metadata é EDITADO depois da mudança de regra passa a validar contra a regra vigente no momento da edição" (correção do Codex ao Critério 5 original — a proposta precisa dizer qual das duas é o comportamento real, não deixar ambíguo).
6. **(peso 10%)** Taxonomia de tipo fechada, com representação de storage inequívoca POR TIPO (inclui explicitamente: dinheiro/decimal nunca em `number` de ponto flutuante; data civil vs. datetime; limites de tamanho de texto/opções) — correção do Codex ao Critério 6 original, que era correto na direção mas fraco na âncora.
7. **NOVO (peso 12%)** Toda mutação de definição de campo (criar/renomear/arquivar/reativar campo ou opção) E toda escrita de valor em `Document.metadataValues` é protegida por OCC/fencing transacional contra leitura obsoleta (stale schema) e lost update — nenhuma escrita mutável deste mecanismo foge da disciplina já obrigatória do projeto (`AGENTS.md` §7, `occ.ts`).
8. **NOVO (peso 8%)** Opções de `SINGLE_SELECT` têm identidade estável (`optionId`, nunca a `label` crua) — renomear uma opção nunca invalida valores já gravados sob ela, e um valor gravado permanece interpretável mesmo que sua opção seja arquivada depois.

**Gate de régua estável (research-protocol.md item 3)**: esta régua v2 incorpora TODAS as contestações da Rodada 1 do Codex ponto a ponto (nenhuma rejeitada sem justificativa) — nenhuma parte do checklist original sobrevive sem a correção que o Codex pediu. Aguardando a nota do Codex nesta rodada para confirmar ≥9,0 de ambos os lados antes de tratar a régua como estável; a nota do design abaixo é dada contra ESTA régua v2 (não contra impressão geral).

**Auto-nota do Claude para a régua v2**: 9,2/10 — cobre agora as duas classes de risco que a Rodada 1 faltou (concorrência, identidade de opção) com âncoras específicas o bastante para não depender de julgamento livre.

## Decisões corrigidas

**Decisão 1 (revisada) — cap distingue ativos de total**: `MAX_ACTIVE_METADATA_FIELDS = 20` (campos com `status=ACTIVE`, conta contra a UX real — quantos campos um formulário mostra) e `MAX_TOTAL_METADATA_FIELD_DEFINITIONS = 100` (ativos + arquivados juntos, hard ceiling físico no array embutido, nunca ultrapassado mesmo que todos estejam arquivados — impede crescimento ilimitado do item por churn de arquivamento, já que nenhuma definição é fisicamente removida). Um tenant que já tem 100 definições totais (a maioria arquivada) precisa que um operador remova fisicamente definições arquivadas MUITO antigas para liberar espaço — fora de escopo desta fatia (nenhuma UI/rota de "purge físico de definição arquivada" é construída agora; 100 é uma margem generosa o bastante para não ser um problema real na prática comercial deste produto). Mesmo padrão aplicado a opções de `SINGLE_SELECT`: `MAX_ACTIVE_OPTIONS_PER_FIELD = 50`, `MAX_TOTAL_OPTIONS_PER_FIELD = 150`.

**Decisão 2 (revisada) — contrato de valor completo, tipos discriminados por `valueType`**:

```ts
export type DocumentTypeFieldValueType = "TEXT" | "NUMBER" | "DECIMAL" | "DATE" | "BOOLEAN" | "SINGLE_SELECT";

// União discriminada — o compilador impede um `value` de formato errado para o valueType declarado,
// nunca um par (valueType, value) inconsistente construído por engano num call site.
export type DocumentMetadataValue =
  | { valueType: "TEXT"; value: string; documentTypeVersionAtWrite: number; updatedAt: string; updatedBy: string }
  | { valueType: "NUMBER"; value: number; documentTypeVersionAtWrite: number; updatedAt: string; updatedBy: string }
  // DECIMAL: string normalizada (regex ^-?\d+(\.\d{1,4})?$), NUNCA JS number — dinheiro/valor de
  // apólice/contrato precisa de precisão exata, ponto flutuante binário não garante isso (achado
  // real do Codex, Decisão 2/8 originais).
  | { valueType: "DECIMAL"; value: string; documentTypeVersionAtWrite: number; updatedAt: string; updatedBy: string }
  // DATE: YYYY-MM-DD (data civil, sem hora/timezone) — vencimentos/validades contratuais são datas
  // civis, não instantes (achado real do Codex, Decisão 8 original).
  | { valueType: "DATE"; value: string; documentTypeVersionAtWrite: number; updatedAt: string; updatedBy: string }
  | { valueType: "BOOLEAN"; value: boolean; documentTypeVersionAtWrite: number; updatedAt: string; updatedBy: string }
  // SINGLE_SELECT: guarda optionId (identidade estável, nunca a label crua) + labelSnapshot (o
  // rótulo NO MOMENTO da escrita, para exibição/auditoria correta mesmo que a opção seja renomeada
  // ou arquivada depois — fecha o Critério 2/8 do checklist v2).
  | { valueType: "SINGLE_SELECT"; optionId: string; labelSnapshot: string; documentTypeVersionAtWrite: number; updatedAt: string; updatedBy: string };
```

`documentTypeVersionAtWrite` é só rastreabilidade/auditoria (qual `DocumentType.version` estava vigente quando este valor foi escrito) — NUNCA a fonte de correção (a correção vem de `valueType` imutável + `optionId` estável, Decisões 3/8), então nunca precisa ser revalidado depois. `updatedAt`/`updatedBy` (principal.userId) por valor individual — mesmo padrão de proveniência já usado por `ExtractedField.confirmedBy`/`confirmedAt` (D-193). `Document.metadataValues?: Record<string /* fieldId */, DocumentMetadataValue>`. Limite de tamanho: `TEXT`/`labelSnapshot` ≤ 500 caracteres cada (cap explícito, evita um item de Document inflar por um campo de texto livre longo).

Semântica de limpar um valor: `PATCH .../metadata-values` aceita `null` explícito para um `fieldId` (remove a chave do Record inteiramente, nunca grava um valor "vazio" tipado) — nunca confundido com "campo ausente do corpo do PATCH" (que significa "não tocar", update parcial de verdade, mesmo padrão de PATCH já usado por `renameDocumentType`/`updateRequirement`).

**Decisão 3 — inalterada, confirmada como o ponto mais forte pela crítica do Codex.**

**Decisão 4 (revisada) — opções como objetos com identidade estável, elimina a contradição apontada**:

```ts
export type DocumentTypeFieldOptionStatus = "ACTIVE" | "ARCHIVED";
export interface DocumentTypeFieldOption {
  optionId: string;   // ULID, imutável — nunca reusado, mesma disciplina de fieldId/documentTypeId
  label: string;       // renomeável
  status: DocumentTypeFieldOptionStatus; // nunca removida fisicamente do array
}
```
Arquivar uma opção (`status=ARCHIVED`) impede que NOVOS valores a referenciem (fenced no momento da escrita de `metadata-values`, Decisão 7), mas nunca invalida um `DocumentMetadataValue` existente que já a referencia — o valor guarda `labelSnapshot` (Decisão 2), então continua exibível/auditável mesmo com a opção arquivada. Elimina a contradição que o Codex apontou: agora existe uma identidade estável (`optionId`) que torna "nunca remover fisicamente" e "opção pode ficar órfã sem quebrar nada" simultaneamente verdadeiras — antes, sem `optionId`, a proposta dependia de comparar strings de label, que rename quebraria.

**Decisão 5 (revisada) — semântica exata de `required`**: `required=true` é verificado **só no momento em que o `PATCH .../metadata-values` está prestes a persistir um valor `null`/ausente para aquele `fieldId` especificamente** — nunca verificado contra Documents que não estão sendo tocados por aquele PATCH, e nunca contra campos do MESMO Document que o PATCH não menciona (update é por-campo, não "revalida o conjunto inteiro a cada PATCH"). Em português direto: um Document criado antes de um campo virar `required` continua para sempre sem valor nesse campo até que ALGUÉM explicitamente tente gravar/limpar aquele campo específico via PATCH — nunca há backfill nem invalidação assíncrona, e um PATCH que edita só o campo A nunca é bloqueado por o campo B (required, sem valor) estar vazio. Fecha a ambiguidade que o Codex apontou no Critério 5 do checklist v2.

**Decisão 6 — inalterada** (RBAC já correto per o Codex); nota adicional aceita: `updateDocumentMetadataValues()` (novo método de serviço) reusa o MESMO fence de tenant/DocumentType-ACTIVE que `createDocument()` já usa (D-175's `ConditionCheck`), nunca um caminho de escrita paralelo que pule esses fences.

**Decisão 7 (revisada) — OCC/fencing explícito, fecha a corrida TOCTOU real**:
- `PATCH /document-archive/document-types/{documentTypeId}/metadata-fields/{fieldId}` (e a rota de criação de campo/opção): corpo carrega `expectedDocumentTypeVersion` (padrão OCC já universal do projeto, `buildVersionedUpdate`), mesmo mecanismo de `renameDocumentType`.
- `PATCH /document-archive/documents/{documentId}/metadata-values`: corpo carrega `expectedDocumentVersion` (OCC do próprio Document, não do DocumentType — o cliente nunca precisa saber/passar a versão do DocumentType). O SERVIÇO relê fresco o `DocumentType` do Document (mesmo padrão de `createDocument()`'s check `DocumentType.status=ACTIVE`, D-175), valida cada valor do corpo contra a definição de campo/opção ATIVA correspondente NAQUELE MOMENTO, e grava numa ÚNICA `TransactWriteItems`: `Update` em `Document` (`ConditionExpression: version = expectedDocumentVersion`) + `ConditionCheck` em `DocumentType` (`version = <versão que o serviço acabou de ler>`). Isso fecha a corrida real que o Codex apontou (cliente lê campo ATIVO, outro request arquiva o campo, primeiro request grava valor sob campo já arquivado) sem exigir que o cliente conheça a versão do DocumentType — o `ConditionCheck` falha a transação inteira (`TransactionCanceledException`, tratado com o `isTransactionCanceled()` já existente) se o `DocumentType` mudou entre a leitura e a escrita, e o handler HTTP responde 409 (mesmo padrão de conflito otimista já usado em toda escrita mutável do projeto).

**Decisão 8 — já revisada na Decisão 2 acima (taxonomia com `DECIMAL` novo, `DATE` explicitamente date-only).**

**Decisão 9 — inalterada**, reforçada: como os valores agora são sempre normalizados (nunca label cru, `DECIMAL`/`DATE` em formato canônico), um índice de busca futuro (fora de escopo desta fatia) permanece viável sem re-trabalho de formato.

## Nota do design (Rodada 2) contra a régua v2

**Auto-nota do Claude**: 9,1/10 — todos os 8 achados reais do Codex (fontes imprecisas, cap sem distinção ativo/total, contrato de valor incompleto, contradição de opções, ambiguidade de `required`, corrida TOCTOU, tipo de dinheiro/data) foram corrigidos com um mecanismo concreto, não uma promessa vaga. Ponto que mantenho como aberto para a Rodada 3 julgar: o cap `MAX_TOTAL_METADATA_FIELD_DEFINITIONS=100` sem rota de purge físico é uma limitação aceita conscientemente (não um design completo de lifecycle de definição), nomeada explicitamente acima em vez de escondida.
