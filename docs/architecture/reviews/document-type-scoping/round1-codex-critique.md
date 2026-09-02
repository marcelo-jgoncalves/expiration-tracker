# DocumentType — Rodada 1 (crítica Codex, via `codex exec`)

Nota: **6,4/10**

A direção central é boa — identidade estável, soft-state e pointer transacional — mas a proposta ainda tem falhas bloqueantes.

1. **[blocking] A migração ignora um segundo writer real.** A afirmação de que somente `document-archive-service.ts` chama `documentGsi2Keys()` é falsa. `guest-document-access-service.ts:313` também cria `Document`, escolhendo `input.documentType ?? requirementId`. Esse fluxo continuaria gravando string livre/ID de Requirement e violaria imediatamente a nova FK. **Correção:** incluir explicitamente o guest submission na migração; definir de onde vem seu `documentTypeId`, validar o tipo ativo e remover o fallback semanticamente inválido para `requirementId`.

2. **[blocking] A garantia "DEPRECATED indisponível para novas atribuições" tem TOCTOU reconhecido e aceito indevidamente.** `GetItem(status=ACTIVE)` seguido de `Put Document` permite `deprecate` vencer entre as operações. Isso contradiz diretamente o critério 2 e também afetará `RequirementTemplate`. **Correção:** criar Document via `TransactWriteItems` contendo `ConditionCheck` do `DocumentType` com `status=ACTIVE`, mais o Put do Document.

3. **[blocking] Rename para nome semanticamente idêntico produz uma transação DynamoDB inválida.** Se o nome mudar apenas em caixa/espaçamento — ou o cliente reenviar o mesmo nome — pointer antigo e novo têm a mesma PK/SK. A transação tentará `Delete` e `Put` no mesmo item; DynamoDB proíbe múltiplas operações sobre o mesmo item numa `TransactWriteItems`. **Correção:** se `oldNormalizedName === newNormalizedName`, executar somente o Update versionado da entidade/GSI1SK.

4. **[blocking] A normalização alegadamente reutilizada não é a descrita.** Não encontrei normalizador em `request-context`/`organization` para display names. O precedente real é `normalizeDisplayName()` em `subject/domain/tracked-subject.ts`, que faz NFD, remove diacríticos, trim, lowercase e colapsa whitespace.

5. **[blocking] Integridade do pointer em rename está subespecificada.** Condicionar o Delete apenas a `documentTypeId` não prova que o pointer antigo corresponde ao nome normalizado atualmente armazenado na entidade. **Correção:** derivar exclusivamente `oldNormalizedName` do `DocumentType` lido; condicionar Delete a `entityType`/`tenantId`/`documentTypeId`; mapear `CancellationReasons` por índice.

6. **[non-blocking] GSI1 físico é compatível, mas a ordenação prometida é imprecisa** — usar `NAME#<normalizedName>` no `GSI1SK`, não o `displayName` bruto.

7. **[non-blocking] A pesquisa E-014 extrapola algumas fontes** — GitHub permite deletar labels em uso; a alegação de proteção universal contra exclusão física não decorre das fontes. Classificar `SIM PARCIAL`.

8. **[non-blocking] Os pesos subavaliam integridade operacional** — incorporar fencing/concorrência como critério próprio, 20-25%.

Não há problema de limite transacional (create=2 itens, rename=3, muito abaixo de 25/100). Compartilhamento físico do GSI1 é válido.
