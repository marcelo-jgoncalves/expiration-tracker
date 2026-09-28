---
status: final (rodada 3) — nota registrada antes de ler o parecer do Codex desta rodada
---

# Nota da Rodada 3 — Claude (autor da proposta)

Avaliação própria de `claude-proposal-round3.md` antes de consultar a nota do Codex desta rodada
(disciplina de nota cega).

Os 6 achados da Rodada 2 foram corrigidos de forma verificável:

1. Variante "nenhum valor extraído" para `candidateValue` ausente.
2. Resolução de nome tratada como requisito NOVO nas duas telas, sem presumir infraestrutura
   existente em A12.
3. Tabela de proveniência corrigida (parser determinístico não prova ausência de IA a montante) e
   `MISMATCH` reformulado para "Requer revisão" (nem sempre duas fontes concretas discordando).
4. Linguagem de A07 reconciliada: UI nunca decide promover, só reflete decisão já tomada pelo
   servidor.
5. **Requisito bloqueante** — validação obrigatória de `run.versionId === version.versionId` no
   servidor antes de qualquer exposição HTTP, com erro nomeado e teste negativo explícito
   (execução da versão A + `seq` da versão B, todas as versões OCC corretas, deve ser rejeitada).
6. Declaração de pesquisa externa `NÃO` adicionada, justificada (reaproveita tiers de autorização
   já existentes, não define padrão novo).

**Nota geral (minha, como autor): 9,1/10.** Considero o desenho da unidade de nível 5 completo o
suficiente para prosseguir com segurança à implementação — o requisito de vínculo execução↔versão
está especificado com precisão suficiente para virar um teste negativo concreto, não uma intenção
vaga.
