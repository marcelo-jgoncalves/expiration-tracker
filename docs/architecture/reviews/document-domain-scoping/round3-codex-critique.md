# Document Domain — Rodada 3 (Crítica Codex)

**Nota final: 7,6/10 — REABRIR.** Íntegra em `round3-codex-critique-full.txt`. Convergindo: Codex confirma que não é preciso reabrir os pontos já resolvidos (GSI2/GSI5 livres — Codex reconhece que sua própria alegação da Rodada 2 estava errada —, separação Event/Outbox, fontes E-014, citação `parser-sandbox.ts`, A1 aberta).

## Verificações factuais
- **GSI2/GSI5**: confirmado livre, Codex reconhece erro próprio da Rodada 2.
- **`parser-sandbox.ts`**: confirmado — vive em `src/workers/parser-sandbox/parser.ts`.
- **`authorize()` ownership bypass**: existe, mas só ativa quando `ownerUserId` E `assigneeUserId` estão AMBOS presentes; `AuthorizedResource` não tem `reviewerId` — reaproveitar exige extensão explícita, não "conectar" o existente como a Rodada 3 sugeriu.

## 9 bloqueios concretos restantes
1. **AP8 inválido em DynamoDB real**: `Query` exige igualdade de partition key — `begins_with` não funciona em PK, só em SK. Precisa de chave própria para "por status apenas" vs. "por status+responsável".
2. **Fences não provam vínculo entre itens**: `documentId=:sameDoc`/`requirementId=:sameReq` só provam a identidade do próprio item, não que ele está de fato ligado a outro item da transação. Falta usar `ConditionCheck` (ação real do `TransactWriteItems`) comparando o valor esperado de vínculo (`evidenceVersionId`, etc.) em cada item relacionado.
3. **Transação não pode ler GSI dentro de si**: "a transação lê a Version anterior via GSI5" não é executável — leitura deve ocorrer ANTES, fora da transação, com o resultado então verificado via `ConditionCheck` no commit (padrão read-then-verify).
4. **Idempotência incompleta**: registrar token+payloadHash não basta — precisa persistir um `resultSnapshot` mínimo, porque o estado "atual" pode já ter mudado (ex. version aceita depois virou SUPERSEDED) entre o replay e a checagem.
5. **C3 não está formalizada como lista única**: referências cruzadas ("itens 1–2/6–8") não substituem uma lista itemizada completa e literal.
6. **Claim precisa de contrato próprio**: não dá para just "reaproveitar" o bypass owner/assignee — `AuthorizedResource` precisa de campo novo ou checagem de serviço nomeada dedicada.
7. **Scan CLEAN≠sem-pendência**: `pendingFileScans=0` não distingue "tudo limpo" de "um infectado, zero pendente" — falta contador/condição separada para infectado.
8. **Retenção ainda não fechou**: "equivalente"/"a definir" não são mapeamentos reais — precisa classe exata (das 9 já existentes em D-127), prazo, gatilho, legal hold, cascata.
9. **Recorrência sem fence de concorrência**: falta unicidade de `(seriesId,occurrenceId)` e de `(occurrenceId,attemptIndex)`, e avanço condicional de um ponteiro `latestAttemptIndex` para 2 correções concorrentes não criarem 2 "tentativa 2".
