---
status: CONVERGIDO — desenho aprovado via protocolo Claude↔Codex, implementação ainda NÃO iniciada
owner: Marcelo
---

# Disclosure de IA em A07/A12 — convergência final

**Origem**: pergunta direta de Marcelo (2026-09-28) — "quanto ao IA, em que tela ela pode ser
usada?" — levou ao achado de que `p0-screen-inventory-plan.md` não refletia a extração de IA/OCR já
ligada ao `document-archive` (D-193) em A12, e de que o disclosure de IA já desenhado
(`A07-arquivos-vencimento.md`) nunca foi implementado em nenhuma das duas telas reais. Marcelo
decidiu priorizar a implementação ("precisamos de uma maneira simples de o usuário saber que as
sugestões são geradas por IA") e pediu submissão ao protocolo.

**Resultado**: 3 rodadas do protocolo Claude↔Codex, nível 5 (a unidade de "contrato de leitura +
wiring HTTP/BFF", per `change-risk-scale.md` — telas que exigem plumbing de dado novo do backend).
Convergência em **Claude 9,1/10, Codex 9,1/10** — ambos ≥9,0.

## Progressão de nota

| Rodada | Claude (autor) | Codex (crítico) | Achados principais fechados |
|---|---:|---:|---|
| 1 | 7,3 | 7,5 | Nível de risco subestimado; `PENDING_CONFIRMATION` não `SUGGESTED`; confirmação automática real (`SYSTEM_AUTO_CONFIRM`); `confidence`/autoria opcionais; proveniência deve refletir `sources` |
| 2 | 8,0 | 8,3 | `candidateValue` também opcional; A12 sem resolvedor de nome; proveniência ainda imprecisa (parser não prova ausência de IA a montante); `MISMATCH` nem sempre é discordância de 2 fontes; **achado principal**: `confirmFieldForDocumentArchive` nunca valida `run.versionId === version.versionId` |
| 3 | **9,1** | **9,1** | Requisito de vínculo execução↔versão formalizado com erro nomeado + teste negativo; tabela de proveniência final; `MISMATCH`→"Requer revisão"; pesquisa externa `NÃO` declarada |

## Desenho final aprovado

- **Classificação em 3 unidades de risco independentes**: (2) reconciliar
  `p0-screen-inventory-plan.md` §A12 com D-193 — só documentação; (3) componente visual de
  disclosure sobre dado já disponível; (5) contrato de leitura + wiring HTTP/BFF — nenhuma rota de
  leitura de `ExtractedField`/execução existe hoje em A07 ou A12.
- **Componente compartilhado** (`ExtractedFieldDisclosure` ou equivalente) consumindo o mesmo tipo
  `ExtractedField` nas duas telas, com adaptação por tela: efeito de confirmar (`ExpirationItem.dueDate`
  vs. `DocumentVersion.validUntil`), integração de confirmação (HTTP já existe em A07; precisa ser
  criada em A12).
- **Apresentação por estado real do domínio**:
  - `PENDING_CONFIRMATION` sem `candidateValue` → "Nenhum valor extraído — preenchimento necessário".
  - `PENDING_CONFIRMATION` com valor → "Sugerido" (+ "com N% de confiança" só quando `confidence`
    existe).
  - `confirmedBy === "SYSTEM_AUTO_CONFIRM"` → "Confirmado automaticamente" (nunca um nome fabricado).
  - `confirmedBy` com userId real → nome resolvido (mecanismo NOVO em ambas as telas) ou
    "Confirmado" sem atribuição se a resolução falhar.
  - Proveniência por `sources`: `DETERMINISTIC_PARSER` → "Extraído automaticamente do documento";
    `TEXTRACT` → "Extraído por reconhecimento de texto"; inclui `BEDROCK` → "Sugestão com
    participação de IA generativa"; todas as fontes preservadas quando múltiplas contribuíram.
  - `agreement === "MISMATCH"` → "Requer revisão" (mensagem neutra — pode ser 2 fontes discordando
    OU Bedrock necessário sem candidato, nunca afirmar divergência que pode não ter ocorrido).
- **Requisito bloqueante para a implementação**: validar `run.versionId === version.versionId` no
  servidor antes de qualquer confirmação (bug real encontrado em
  `confirm-reject-field-document-archive.ts:154`, que hoje valida OCC/concorrência mas não
  pertencimento) — erro nomeado (`ExtractionRunVersionMismatchError` ou equivalente), teste negativo
  obrigatório (execução da versão A + `seq` da versão B, todas as versões OCC corretas, deve
  rejeitar).
- **Contrato de leitura** (novo, a implementar): rota de leitura de `ExtractedField`/execução por
  entidade, reaproveitando `document:read` (A07) / `docarchive:read` (A12) — sem Action nova; A12
  ganha também uma rota HTTP de confirmação nova (o serviço interno já existe, sem wiring HTTP).
  Deve expor e validar: vínculo item↔documento↔execução (A07); vínculo documento↔versão
  imutável↔execução (A12); seleção da execução mais recente elegível POR VERSÃO (nunca "mais recente
  do documento" sem checar versão); estados distintos para ausência/falha/descarte de execução.
- **Reconciliação de linguagem**: "nunca promovido automaticamente" (garantia da UI, que nunca
  decide por conta própria) coexiste com a confirmação automática real do pipeline (decisão do
  servidor) — a UI reflete a decisão já tomada, nunca a antecipa.
- **Confirmar campo ≠ aceitar versão documental** — `extraction:confirm` e `docarchive:review`
  continuam Actions distintas; confirmar `expirationDate` pode atualizar `validUntil` mesmo numa
  versão já `ACCEPTED` (efeito real via `document-version-validity-effect.ts`), o que deve ficar
  visível na UI sem fundir as duas ações.

## Pesquisa externa (research-protocol.md, E-014)

**NÃO** — decisão reaproveita tiers de autorização já existentes, corrige um gap interno de
integridade de dados; não define padrão externo que pesquisa de mercado calibraria.

## Não certificado por esta convergência

O protocolo aprovou o **desenho**, não código — o bug de vínculo execução↔versão continua presente
no código até a implementação real acontecer. Antes de considerar esta pendência fechada: implementar
a rota de leitura + wiring de confirmação de A12, o componente compartilhado, o requisito de
validação de pertencimento (com o teste negativo nomeado), atualizar
`p0-screen-inventory-plan.md` §A12 para citar a extração já ligada por D-193, rodar a suíte completa
e `npm run check-docs`.
