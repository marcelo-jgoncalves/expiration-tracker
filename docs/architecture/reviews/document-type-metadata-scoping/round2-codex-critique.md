# Rodada 2 — Crítica do Codex

**Revisor**: Codex (`codex exec --skip-git-repo-check`, desta vez COM leitura real do repositório — leu `docs/engineering/research-protocol.md` e outros arquivos de estado antes de responder). **Data**: 2026-09-06.

## 1. Régua v2

**Aceita como estável. Nota da régua: 9,1/10.** Incorpora todas as contestações da Rodada 1 (fontes corrigidas, OCC/concorrência e identidade de opção viraram critérios próprios, `required` ganhou âncora semântica, taxonomia exige `DECIMAL`/data civil/limites, critério de valor armazenado exige interpretabilidade pós-rename/archive). Única imperfeição apontada (não bloqueante): sobreposição parcial entre Critérios 2 e 8 (ambos tocam `SINGLE_SELECT` pós-rename/archive) — aceitável porque cobrem facetas diferentes (contrato geral vs. mecanismo específico de identidade).

**Gate de régua estável atingido**: Claude 9,2/10, Codex 9,1/10 — ambos ≥9,0. Régua v2 é definitiva a partir desta rodada.

## 2. Decisões Revisadas — o que fechou, o que não fechou

- **Decisão 1**: "ativos vs. total" fechado. **Achado NOVO**: a frase sobre um operador "remover fisicamente definições arquivadas MUITO antigas" para liberar espaço **contradiz o Critério 3 da régua v2** ("nunca delete" — tombstone sempre). Se qualquer `Document.metadataValues[fieldId]` referenciar aquela definição, um purge físico quebraria exibição/auditoria do nome do campo (o valor não guarda snapshot do NOME do campo, só do `optionId`/label de opção). Precisa de uma de duas regras: purge só permitido com zero referência provada, ou o valor passa a guardar snapshot do nome do campo também.
- **Decisão 2**: majoritariamente fechada (`updatedAt`/`updatedBy`, `null` para limpar, união discriminada, `DECIMAL` string, `DATE` date-only). **Lacunas novas**: `DECIMAL` tem regex mas sem limite de dígitos totais (pode inflar item); `NUMBER` ainda sem semântica operacional (inteiro? range? `Number.MAX_SAFE_INTEGER`?).
- **Decisão 4**: fechada — `optionId` imutável + `labelSnapshot` elimina a contradição original. **Lacuna nova**: `labelSnapshot ≤ 500` está na Decisão 2, mas `DocumentTypeFieldOption.label` (Decisão 4) não declara o mesmo cap explicitamente — precisa estar no contrato da opção também, já que fica embutida no `DocumentType`.
- **Decisão 5**: ambiguidade reduzida, **não totalmente fechada**. O texto conflita com a Decisão 2 sobre o que "ausente"/"`null`" significam exatamente (a Decisão 2 diz `null` explícito remove, ausente do corpo = não tocar; a Decisão 5 fala em "valor `null`/ausente" como se fossem a mesma coisa). Lacuna maior: **`createDocument()` nunca é mencionado** — se um Document pode nascer sob um DocumentType com campo `required`, falta dizer se a criação valida isso ou se o Document nasce deliberadamente incompleto.
- **Decisão 7**: fecha o TOCTOU original para `PATCH .../metadata-values` — o `ConditionCheck` no `DocumentType.version` lido fresco é o mecanismo correto. **Incompleto**: régua v2 Critério 7 cobre "criar/renomear/arquivar/reativar campo OU OPÇÃO", mas o texto só cobre mutação de CAMPO explicitamente — mutação de opção (rename/archive/reactivate) não tem o mesmo `expectedDocumentTypeVersion` citado por escrito.
- **Decisão 8**: fechada no essencial (`DECIMAL`, `DATE` date-only). Falta amarrar: limite de dígitos de `DECIMAL`, range de `NUMBER`, limite de `option.label`, se `DATE` valida calendário real ou só regex de formato.

## 3. Achados Novos (resumo)

1. **Contradição purge físico vs. "nunca delete"** (Decisão 1 vs. Critério 3 da régua v2) — acima.
2. **`required` não cobre `createDocument()`** — a feature vira só uma trava parcial de PATCH se a criação não for endereçada.
3. **OCC de opções não completamente especificado** — Decisão 7 não cita `expectedDocumentTypeVersion` para mutação de opção.
4. **Limites de storage incompletos** — falta cap de dígitos de `DECIMAL`, range de `NUMBER`, cap de `option.label`.

## 4. Nota Final da Rodada 2

- **Nota da régua v2**: 9,1/10 (estável, gate atingido — ver seção 1)
- **Nota única do design contra a régua v2**: **8,6/10**

Veredito: **régua estável, design ainda não aprovado**. A Rodada 2 corrigiu os 8 achados originais no núcleo da solução, mas 4 achados novos (menores, todos de fechamento/precisão, nenhum estrutural) impedem o gate ≥9,0 nesta rodada. Rodada 3 deve ser tréplica formal fechando estes 4 pontos.

## Auto-nota do Claude (Rodada 2, antes de ver a nota do Codex desta rodada)

- **Nota do design (auto-avaliação, formada antes de ler a crítica acima)**: 8,8/10 — sabia que a Decisão 5 ainda tinha uma lacuna real sobre `createDocument()` (deliberadamente não abordada, um descuido, não uma omissão informada) e que o cap de `DECIMAL`/`NUMBER` não tinha limite de dígitos explícito; não havia notado a contradição purge-físico-vs-tombstone na Decisão 1 antes de ver a crítica do Codex — achado genuinamente novo para mim, aceito integralmente.
