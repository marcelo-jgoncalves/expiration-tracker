---
status: draft
owner: Marcelo
authority: proposta Rodada 3 do protocolo Claude↔Codex (AGENTS.md §4) — nível 5, não normativo até convergência
---

# Disclosure de IA em A07/A12 — Rodada 3

Responde aos 6 achados da Rodada 2. Nada mais muda desde `claude-proposal-round2.md`.

## Declaração de pesquisa externa (research-protocol.md, E-014): NÃO

Esta decisão reaproveita tiers de autorização já existentes (`document:read`/`docarchive:read`) e
corrige um gap de integridade de dados interno (vínculo execução↔versão) — não define um padrão
externo que pesquisa de mercado calibraria. Omissão da Rodada 2 corrigida aqui.

## 1. `candidateValue` opcional — variante "nenhum valor extraído"

Quando `ExtractedField` está `PENDING_CONFIRMATION` mas sem `candidateValue` (`sources: []`, caminho
de falha do pipeline), o componente mostra **"Nenhum valor extraído — preenchimento necessário"**,
sem percentual nem proveniência (nenhum dos dois existe nesse caso). Nunca renderizar "Sugerido"
sem um valor sugerido de verdade.

## 2. Resolução de nome em A12 — requisito novo, não reaproveitamento

`DocumentDetail.tsx` mostra `reviewerId` cru hoje — não existe resolução de nome nessa tela.
Correção: a resolução de identidade (userId → nome de exibição) para `confirmedBy` é um requisito
NOVO desta fatia de implementação, igual em A07 e A12, não algo já disponível em A12 a reaproveitar.
Ambas as telas ganham o mesmo mecanismo ao mesmo tempo.

## 3. Proveniência — tabela corrigida (adotada do Codex)

| Fonte registrada | Apresentação |
|---|---|
| `DETERMINISTIC_PARSER` | "Extraído automaticamente do documento" |
| `TEXTRACT` | "Extraído por reconhecimento de texto" |
| Inclui `BEDROCK` entre as fontes | "Sugestão com participação de IA generativa" |
| Nenhuma fonte/candidato | Não atribuir proveniência nenhuma (ver correção 1) |

Quando múltiplas fontes contribuíram, preservar TODAS as fontes registradas na apresentação —
nunca atribuir o valor exclusivamente à fonte "mais impressionante" (Bedrock) quando o parser
determinístico também contribuiu.

**`MISMATCH` reformulado**: mensagem genérica **"Requer revisão"**, nunca "as fontes discordaram"
de forma afirmativa — `agreement === "MISMATCH"` também ocorre quando Bedrock era necessário
(`needsBedrock()`) mas não produziu candidato, não só quando duas fontes concretas discordaram
entre si. A mensagem não pode alegar uma divergência que pode não ter ocorrido.

## 4. Reconciliação de linguagem A07

"Nunca promovido automaticamente" / "nunca aplicados automaticamente sem revisão" (linguagem da
spec de A07) descreve uma garantia da INTERFACE — a UI nunca inventa nem antecipa uma confirmação
que o servidor não decidiu. Isto coexiste com a confirmação automática real do PIPELINE (decisão de
servidor, `SYSTEM_AUTO_CONFIRM`, quando um único candidato de alta confiança sem ambiguidade já
passou pelas regras do próprio domínio) — a UI reflete essa decisão já tomada pelo servidor
("Confirmado automaticamente"), nunca decide ela mesma promover um campo. As duas garantias operam
em camadas diferentes (servidor decide; UI nunca decide) e não se contradizem quando enunciadas
assim.

## 5. Achado principal — vínculo execução↔versão ausente (requisito de design, bloqueante)

`confirmFieldForDocumentArchive` (`confirm-reject-field-document-archive.ts:154`) lê `run` e
`version` separadamente e valida OCC (`expectedRunVersion`/`expectedFieldVersion`/versão do
`DocumentVersion`) mas **nunca verifica `run.versionId === version.versionId`** — OCC prova que
ninguém mudou o estado sob os pés da requisição (concorrência), mas não prova que a execução
pertence à mesma versão do documento que está sendo confirmada (pertencimento).

**Requisito explícito desta proposta, antes de qualquer exposição HTTP**: toda confirmação (A12, e
equivalente a auditar em A07) deve validar `run.versionId === version.versionId` no servidor,
falhando com um erro nomeado (ex. `ExtractionRunVersionMismatchError`) quando não bate — nunca
confiar em o cliente enviar os dois IDs corretos por si só. Teste negativo obrigatório na
implementação futura: execução da versão A combinada com `seq` da versão B do mesmo documento deve
ser rejeitada mesmo com todas as versões OCC corretas.

**Contrato de leitura, itens adicionais fixados** (Codex, achado 4):
- A07: vínculo item↔documento↔execução explícito na resposta de leitura.
- A12: vínculo documento↔versão imutável (`versionId`, localizado por `seq`)↔execução explícito.
- Seleção de execução quando existem múltiplas por documento/versão: a mais recente elegível
  (`ExtractionRun` não descartado/falho) para aquela versão específica — nunca "a mais recente do
  documento" sem checar a versão.
- Tratamento explícito de ausência de execução, execução falha, e execução descartada — cada um um
  estado de apresentação distinto, nunca colapsado em "Sugerido"/vazio silencioso.
- `document:read`/`docarchive:read` confirmados como reaproveitáveis (sem Action nova) — a
  exigência real é a validação de vínculo/pertencimento acima, em toda requisição, conforme a
  disciplina padrão de autorização (OWASP: nunca confiar em ID de objeto do cliente sem revalidar
  posse no servidor).

## 6. Confirmação de campo vs. revisão documental — nota adicional (Codex, aceita)

Confirmado: `extraction:confirm` e `docarchive:review` são operações distintas mas não
independentes em efeito (confirmar `expirationDate` pode atualizar `validUntil` mesmo numa versão
já `ACCEPTED`, via o planner existente `document-version-validity-effect.ts`). A interface deve
deixar isso visível ao usuário (confirmar um campo pode mudar a validade mostrada em uma versão já
aceita) — não funde as duas Actions nem cria uma exigência de revisão nova.

## O que permanece das rodadas anteriores

Classificação em 3 unidades de risco (2/3/5); 4 correções de domínio da R1 (estado real,
confirmação automática, opcionalidade, proveniência — refinada aqui); componente compartilhado
entre A07/A12 usando o mesmo `ExtractedField`; distinção entre confirmar campo e aceitar versão.
