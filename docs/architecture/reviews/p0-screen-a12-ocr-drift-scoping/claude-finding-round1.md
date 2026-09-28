---
status: draft
owner: Marcelo
authority: achado registrado para o protocolo Claude↔Codex (AGENTS.md §4) — submissão pedida por Marcelo, 2026-09-28
---

# Achado: `p0-screen-inventory-plan.md` (A12) não reflete a extração de IA/OCR que D-193 já ligou ao document-archive — e o disclosure de IA desenhado nunca foi implementado

## Achado 1 — drift de documentação (A12 vs. D-193)

`docs/frontend/p0-screen-inventory-plan.md` (D-247, escrito em 2026-09-09) especifica dois lugares
onde a extração de IA/OCR aparece na interface:

- **A07 — Generic Document/OCR attachment** (módulo `expiration`, `document` antigo): a especificação
  lista explicitamente "OCR extraction fields with suggested values + confidence" e a ação
  `extraction:confirm`.
- **A12 — Document Detail/Version History** (módulo `document-archive`): a especificação de dados
  (`Document`/`DocumentVersion`, linhas 330-334 do plano) **não menciona** nenhum campo de
  extração/confiança — só metadados, status de versão, scan.

**Problema**: `D-193` ("Reconciliação OCR/Extração ↔ Document Lifecycle") — decisions-log, linhas
261-270, implementado em slices ANTES da data do `p0-screen-inventory-plan.md` (2026-09-09) —
estendeu o mesmo pipeline de extração (Textract/Bedrock) para o módulo `document-archive`:
`start-extraction-run-for-document-archive.ts` dispara automaticamente quando um arquivo de
`DocumentVersion` termina o scan antimalware, e `confirm-reject-field-document-archive.ts` é o
equivalente de `extraction:confirm` para essa entidade. Ou seja: o backend real, na data em que o
plano de telas foi escrito, já suportava extração de IA/OCR para `Document`/`DocumentVersion` (A12)
— e o plano não registrou isso.

**Verificado diretamente** (não por inferência): `grep` em `src/modules/extraction/` confirma os
dois arquivos citados acima existem e implementam exatamente esse fluxo; `decisions-log.md` linhas
262-264 confirmam a ordem cronológica (D-193 slices 2-3, re-key + Starter `document-archive`, antes
de D-247).

## Achado 2 — o disclosure de IA desenhado nunca foi implementado em nenhuma das duas telas

A especificação de protótipo `docs/frontend/prototype-screen-specs/A07-arquivos-vencimento.md`
(auditada, D-250) já desenha um disclosure real e específico, não genérico:

- Label **"Sugerido com N% de confiança"** abaixo do campo, enquanto não confirmado.
- **`StatusBadge` "Confirmado por {nome}"** depois de confirmado — nunca promovido automaticamente.
- "um campo sugerido sempre mostra **de onde veio**" (proveniência explícita).

**Verificado no código real do frontend** (`grep -rn` em `frontend/src`, 2026-09-28): **nenhuma das
duas telas implementadas hoje mostra qualquer um desses elementos.**

- `frontend/src/routes/items/ItemDocuments.tsx` (A07 real) tem, no próprio comentário de cabeçalho:
  *"OCR extraction fields (`extraction:confirm`, SUGGESTED vs CONFIRMED) are out of scope for this
  landing — recorded as pending follow-up (decisions-log D-2xx), not fabricated here."*
- `frontend/src/routes/DocumentDetail.tsx` (A12 real) não tem nenhuma menção a `confidence`,
  `suggested`, ou `extraction` em nenhum lugar do arquivo.
- Busca em todo `frontend/src` por `confidence|sugerid|suggested|SUGGESTED|extraction`: **um único
  resultado**, o comentário de A07 citado acima admitindo o escopo excluído.

**Consequência real de produto, não só de documentação**: hoje, na aplicação em produção (`dev`),
**não existe nenhum indicador visível ao usuário de que uma sugestão veio de IA** — porque a UI de
confirmação de campo extraído (o único lugar onde esse disclosure apareceria) simplesmente não foi
construída em nenhuma das duas telas, apesar do backend já processar e persistir esses campos
(`ExtractedField`, status SUGGESTED) para ambos os módulos.

## Por que isto é nível 5 (ou por que pode não ser — deixado para o Codex avaliar)

Argumento a favor de nível 5: a ausência de disclosure de IA ao usuário é potencialmente uma
questão de transparência/governança de produto (mesma família de preocupação do eixo "Governança
de IA" já formalizado em `joint-review-criteria.md`), não só um bug de UI cosmético — um usuário
que confirma um campo sem saber que a sugestão veio de um modelo de IA está tomando uma decisão sem
a informação que o próprio design já havia determinado ser necessária.

Argumento contra: é reconciliação de documentação (A12) + implementação de uma spec já aprovada
(A07/A12 disclosure) — não é uma decisão de arquitetura nova, o desenho já existe e já foi
aprovado (`screen-spec-audit-rubric.md`, D-250). Poderia ser nível 2-3 (correção mecânica +
completar escopo já decidido).

**Pedido de Marcelo (2026-09-28): submeter ao protocolo Claude↔Codex de qualquer forma** —
registrado aqui como decisão dele de pedir a segunda opinião, independentemente da classificação de
risco que eu teria usado para decidir sozinho se o protocolo era obrigatório.

## Decisão de produto de Marcelo (2026-09-28) sobre o Achado 2 — resolve a pergunta 3 abaixo

**"Precisamos de uma maneira simples de o usuário saber que as sugestões são geradas por IA, isso
valoriza o produto e acrescenta transparência."** Isto fecha a pergunta 3 na direção (b): o
disclosure de IA não é só uma pendência de escopo a documentar, é um gap de produto real a
priorizar — o valor de transparência é o motivo do pedido, não só completude de spec. O desenho já
aprovado em `A07-arquivos-vencimento.md` ("Sugerido com N% de confiança" + proveniência +
`StatusBadge` "Confirmado por {nome}") já é a "maneira simples" pedida — não precisa de desenho
novo, precisa de implementação nas duas telas (A07 real, que já tem o comentário reconhecendo o
gap; e A12 real, que nem o backend documentava até este achado). O Codex deve avaliar a
recomendação de implementação (não só a de documentação) com essa direção de produto já dada.

## Pergunta para o Codex

1. Confirma os dois achados (drift de doc A12↔D-193; disclosure de IA desenhado nunca implementado)
   por leitura direta do código/docs citados?
2. Concorda que isto é nível 5 (exige protocolo completo, 3 rodadas, ≥9,0) ou é nível 2-3 (correção
   mecânica, não exigiria o protocolo formal se Marcelo não tivesse pedido explicitamente)?
3. **Dado que Marcelo já decidiu priorizar a implementação do disclosure (não só documentá-lo)**:
   qual a superfície mínima e correta para isso — reaproveitar o `StatusBadge`/label já desenhado
   em `A07-arquivos-vencimento.md` tal como está, em ambas as telas (A07 real e A12 real), ou há
   alguma diferença de modelo de dados entre `ExtractedField` do módulo `document` (A07) e o
   equivalente do `document-archive` (A12) que exigiria um desenho de UI distinto entre as duas?
