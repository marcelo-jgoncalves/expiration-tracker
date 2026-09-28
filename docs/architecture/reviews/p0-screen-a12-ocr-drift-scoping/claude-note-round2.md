---
status: final (rodada 2)
---

# Nota da Rodada 2 — Claude (autor da proposta)

Codex: 8,3/10. Concordo com todos os achados.

- **`candidateValue` opcional** — procede, eu não tinha verificado que o pipeline persiste campos
  pendentes sem candidato algum (`sources: []`) no caminho de falha. "Sugerido" nesse caso afirmaria
  uma sugestão que não existe.
- **Resolução de nome em A12** — procede, `DocumentDetail.tsx` hoje mostra `reviewerId` cru; eu
  presumi uma infraestrutura de resolução de nome que não existe nessa tela, é requisito novo, não
  reaproveitamento.
- **Proveniência por `sources`** — procede, minha tabela original ainda simplificava demais:
  `DETERMINISTIC_PARSER` não prova ausência de IA a montante (Textract já usa machine learning por
  trás, mesmo quando não aparece como fonte separada no caminho atual) — preciso adotar a tabela
  mais precisa do Codex. Também procede que `MISMATCH` nem sempre significa "duas fontes
  discordaram" (pode ser Bedrock necessário sem candidato).
- **Reconciliação de linguagem em A07** — procede: "nunca promovido automaticamente" (garantia da
  UI) e a confirmação automática real do pipeline (decisão de servidor) não são contraditórias, só
  minha redação não deixava isso claro.
- **Achado principal — vínculo execução↔versão ausente** — procede e é o mais sério: verifiquei
  `confirmFieldForDocumentArchive` e confirmo que ele checa OCC (concorrência) mas nunca
  `run.versionId === version.versionId` (pertencimento). Isto precisa ser um requisito explícito do
  desenho antes de qualquer exposição HTTP, não um detalhe de implementação a resolver depois.
- **Declaração de pesquisa externa ausente** — procede, deveria ter declarado explicitamente NÃO
  (research-protocol.md) já que esta decisão reaproveita tiers de autorização já existentes
  (`document:read`/`docarchive:read`), não define um padrão novo que pesquisa externa ajudaria a
  calibrar.

Nota geral desta rodada (minha, como autor): **8,0/10**. Endereçado na Rodada 3.
