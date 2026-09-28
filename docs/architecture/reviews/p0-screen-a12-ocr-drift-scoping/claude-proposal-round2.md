---
status: draft
owner: Marcelo
authority: proposta Rodada 2 do protocolo Claude↔Codex (AGENTS.md §4) — nível 5, não normativo até convergência
---

# Disclosure de IA em A07/A12 — Rodada 2

Responde às ressalvas da Rodada 1 do Codex (nota 7,5/10): nível de risco real, 4 correções de
domínio, e a definição do contrato de leitura que falta hoje nas duas telas.

## 1. Correção de linguagem (achado do Codex, aceito)

O achado original ("disclosure nunca implementado") passa a: **"não implementado hoje"** — sem
alegar prova histórica. Nenhuma afirmação sobre o estado atual de `dev` produzir extrações reais de
IA — D-342 já registrou os flags de IA/OCR desligados numa investigação anterior; este documento
não verifica isso de novo.

## 2. Classificação de risco em 3 unidades (adotada do Codex)

| Unidade | Nível | Escopo |
|---|---:|---|
| Reconciliar `p0-screen-inventory-plan.md` §A12 com D-193 | 2 | Só documentação — corrigir o gap descrito no achado original |
| Componente visual de disclosure, dado já disponível | 3 | Aplicar o padrão já aprovado em `A07-arquivos-vencimento.md`, corrigido pelos 4 pontos da seção 3 abaixo |
| **Contrato de leitura + wiring HTTP/BFF de `ExtractedField` para as duas telas** | **5** | Não existe hoje uma rota de LEITURA de execução/campo em nenhuma das duas telas (A07 só tem POST de confirmação; A12 só tem o serviço interno, sem rota HTTP) — isto é a unidade que justifica o nível 5 do achado original |

Esta proposta cobre o DESENHO da unidade de nível 5; a implementação de código (rota nova, schema,
teste) é trabalho futuro, não desta rodada de protocolo.

## 3. Correções de domínio (4 pontos do Codex, aceitas)

**Estado real**: `ExtractedFieldState = "PENDING_CONFIRMATION" | "CONFIRMED" | "REJECTED"`
(`extracted-field.ts`). "Sugerido"/"Sugerido com N% de confiança" continuam como RÓTULO DE
APRESENTAÇÃO (linguagem voltada ao usuário, não ao contrato técnico) — o componente mapeia
`PENDING_CONFIRMATION` → rótulo "Sugerido", nunca inventa um estado `SUGGESTED` que não existe no
domínio.

**Confirmação automática é um caminho real, distinto**: quando `confirmedBy ===
"SYSTEM_AUTO_CONFIRM"` (sentinela fixo, `run-extraction-validation.ts:335`), o componente mostra
**"Confirmado automaticamente"**, nunca "Confirmado por {nome}" — mostrar um nome fabricado ou o
texto de confirmação humana para uma confirmação automática seria uma alegação falsa sobre quem
decidiu. Quando `confirmedBy` é um userId real, resolver o nome do usuário (mesmo padrão de
resolução de identidade já usado em outras telas, ex. `reviewer` em A12); se a resolução falhar,
mostrar "Confirmado" sem nome, nunca "Confirmado por undefined" ou heurística especulativa.

**`confidence`/autoria são opcionais no domínio**: o componente NUNCA fabrica um percentual ou nome
quando o campo está ausente. Sem `confidence`, o rótulo é só "Sugerido" (sem "com N%"). Sem
`confirmedBy` resolvível, "Confirmado" sem atribuição.

**Proveniência reflete `sources` de verdade**: `ExtractionSource = "DETERMINISTIC_PARSER" |
"TEXTRACT" | "BEDROCK"`. O rótulo de proveniência não pode dizer genericamente "gerado por IA" para
qualquer sugestão — um campo cuja única fonte é `DETERMINISTIC_PARSER` foi resolvido por um parser
de regras, não por um modelo de IA; a linguagem correta distingue os três casos (ex. "extraído
automaticamente do documento" para parser determinístico; "sugerido por reconhecimento de texto"
para Textract; "sugerido por IA" apenas quando `BEDROCK` está entre as fontes). Isto é MAIS honesto
que a spec original de `A07-arquivos-vencimento.md`, que não fazia essa distinção — correção real
de design, não só de implementação. Quando `agreement === "MISMATCH"` (2+ fontes discordaram), o
componente mostra explicitamente a divergência, nunca esconde atrás de um único valor "vencedor"
(o domínio já nunca auto-resolve MISMATCH escolhendo uma fonte).

## 4. Componente compartilhado entre A07 e A12

Um único componente de apresentação (`ExtractedFieldDisclosure` ou nome equivalente a definir na
implementação), consumindo o mesmo tipo `ExtractedField` nas duas telas — não duas specs
independentes. Diferenças reais entre as telas (tabela do Codex, adotada):

| Aspecto | A07 (`document` module) | A12 (`document-archive` module) |
|---|---|---|
| Contexto | Anexo de `ExpirationItem` | Versão de `DocumentVersion` |
| Efeito de confirmar `expirationDate` | `ExpirationItem.dueDate` | `DocumentVersion.validUntil` (quando aplicável) |
| Integração de confirmação | Rota HTTP já existe (`extraction:confirm`) | Só o serviço interno existe (`confirm-reject-field-document-archive.ts`) — rota HTTP é trabalho novo |

**Confirmar um campo extraído permanece distinto de aceitar uma versão documental em A12** — são
duas decisões diferentes (`extraction:confirm` vs. a ação de review de A13/A12 já existente,
`docarchive:review`), o componente de disclosure nunca substitui nem pressupõe a outra.

## 5. Contrato de leitura (desenho, não implementação)

Nenhuma rota hoje expõe `ExtractedField`/`ExtractionRun` para leitura autenticada em nenhuma das
duas telas. Desenho mínimo proposto para a fatia de implementação futura:

- Uma rota de leitura por entidade (`GET` dos campos extraídos de um `Document`/`ExpirationItem`
  específico, escopada por tenant como todo o resto do sistema), autorizada por `document:read`
  (A07) / `docarchive:read` (A12) — reaproveitando o tier de leitura já existente para cada módulo,
  sem introduzir uma nova Action só para leitura.
- Para A12: uma rota HTTP nova de confirmação/rejeição espelhando `extraction:confirm` de A07,
  chamando o serviço interno já existente (`confirm-reject-field-document-archive.ts`), incluindo
  no allowlist do proxy BFF (mesmo padrão já usado por outras rotas de `document-archive`).
- Tratamento de concorrência: OCC já é a disciplina do domínio (`ExtractedField.version`) — a rota
  de confirmação exige `expectedFieldVersion` como as demais escritas do sistema, sem mecanismo
  novo.

Este desenho fica registrado aqui como direção técnica; o schema JSON exato, os testes de contrato
e o wiring de Terraform/BFF ficam para a implementação, fora do escopo desta rodada de protocolo.

## O que não muda

Os achados originais (drift de documentação A12↔D-193; disclosure desenhado nunca implementado;
pedido de Marcelo de priorizar implementação, não só documentar) permanecem a motivação central
deste trabalho — esta rodada só corrige a precisão técnica de como resolver isso.
