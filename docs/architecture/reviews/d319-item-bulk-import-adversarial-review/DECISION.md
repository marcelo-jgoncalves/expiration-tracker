# D-319 — Bulk CSV import para `Item` — Revisão Adversarial (D-330)

## Status

**APROVADO** via protocolo Claude↔Codex (`AGENTS.md` §4), 3 rodadas (mínimo do protocolo).
Notas cegas finais: **Claude 9,1/10, Codex 9,0/10** — ambos ≥9,0 sem arredondar.

## Trajetória de convergência (notas cegas, sem arredondar)

| Rodada | Claude | Codex | Achado principal fechado nessa rodada |
|---|---|---|---|
| R1 | 7,5/10 | 6,5/10 | 6 achados: claim de dedupe órfã confundida com sucesso (alta — a correção proposta pelo Claude estava incompleta); colisão de chave composta via delimitador sem escape (alta); idempotência de `reserveImport()` ignorando `targetEntityType` (média); datas equivalentes escapando dedupe (média); timestamp calendário-inválido aceito (média); dedupe nunca protege contra Item manual (gap de produto aceitável) |
| R2 | 9,0/10 | 7,8/10 | 4 dos 6 achados corrigidos com a abordagem correta (a do Codex, não a proposta inicial incompleta do Claude); correção da claim órfã estendida também ao branch TrackedSubject pré-existente; MAS a fase de PARSE ainda mascarava a mesma claim órfã, tornando a correção de commit inalcançável para um job novo |
| R3 | 9,1/10 | 9,0/10 | Fase de parse corrigida (mesma checagem `subjectId` real); validação de horário (hora=24) fechada; achado estrutural de OCC/concorrência reconhecido e registrado explicitamente (não corrigido — fora de proporção, pré-existente) — **CONVERGIDO** |

## O que foi corrigido (com código real, testado)

1. **Claim de dedupe órfã** (`import-commit-service.ts`): nova `resolveExistingClaim()` — quando
   `putIfAbsent()` retorna `false`, lê o `ImportDedupRecord` e só trata como "já concluído" quando
   `subjectId` tem um valor real; caso contrário para o job com o novo outcome
   `FAILED_INDETERMINATE_ROW_STATE`, nunca recria cegamente (risco de duplicata) nem avança o
   cursor silenciosamente (risco de perda permanente da linha). Corrigido em AMBOS
   `commitItemRows()` (escopo de D-319) e `commitTrackedSubjectRows()` (pré-existente, corrigido
   incidentalmente para evitar um estado inconsistente entre os dois branches).
2. **Mascaramento na fase de PARSE** (`import-parse-service.ts`, achado da Rodada 2): a mesma
   checagem de `subjectId` real aplicada aos dois pontos de lookup de dedupe na fase de parse
   (branches SUBJECT e ITEM) — uma claim órfã agora passa como `CREATE_SUBJECT`/`CREATE_ITEM`
   normal, deixando a proteção de commit capturá-la, em vez de ser silenciosamente pulada para
   sempre por um job novo reimportando o mesmo CSV.
3. **Colisão de chave composta** (`import-row.ts`): `buildItemDedupKey()` usa `JSON.stringify([...])`
   em vez de `${a}|${b}|${c}` — elimina a ambiguidade quando um campo contém o próprio delimitador.
4. **Idempotência de `reserveImport()`** (`import-service.ts`): `requestHash` agora inclui o
   `targetEntityType` EFETIVO (já resolvido para o default antes do hash) — reusar a mesma
   `Idempotency-Key`+arquivo com um tipo diferente agora é um conflito real, nunca um retorno
   silencioso do job errado.
5. **Canonicalização e validação de data/hora** (`import-row.ts`): `normalizeCsvDateTime()` sempre
   retorna `toISOString()` (três representações do mesmo instante agora produzem a mesma chave de
   dedupe); validação de calendário estendida ao ramo timestamp (rejeita `"2026-02-30T..."`);
   nova `isValidClockTime()` rejeita hora=24 (`Date.parse` a rolava silenciosamente pro dia seguinte).

## Achado estrutural registrado, NÃO corrigido (fora de proporção para esta revisão)

Toda escrita de status/cursor nos branches `TrackedSubject`/`Item` (`import-commit-service.ts`) usa
`update()` sem condição de versão — duas execuções concorrentes do worker (SQS at-least-once) podem
se sobrescrever. Pré-existente a D-319 (confirmado no commit-pai), mas D-319 replicou a lacuna no
branch Item novo em vez de trazê-lo ao padrão de fencing que `Document`/`Requirement`
(`buildVersionedUpdate()`/`executeTenantBusinessMutation`) já tinham. Registrado em
`NEXT_SESSION_PROMPT.md` item 22 para uma rodada de escopo dedicada (fencing OCC nos dois branches
inteiros) — não é um bloqueador desta convergência, mas não deve ser esquecido.

## Decisões explícitas mantidas (não "corrigidas", por julgamento consciente)

- **Dedupe nunca protege contra um Item/TrackedSubject criado manualmente fora de import**: aceito
  como escopo explícito (mesma postura que Document/Requirement já tinham) — exigiria scan
  tenant-wide, fora de proporção para v1.
- **`reserveImport()` destrava incidentalmente uma via HTTP nova para Document/Requirement**:
  reconhecido explicitamente como expansão de escopo real (não uma regressão), já testado.
- **Pesquisa externa (research-protocol.md, E-014)**: `NÃO` — a decisão central (atomicidade de um
  protocolo de 2 chamadas contra um store proprietário) não corresponde a um padrão externo já
  resolvido e documentado da forma que E-014 endereça.

## Escopo desta decisão

Cobre a superfície de import de Item como ela existe hoje, incluindo a correção retroativa
aplicada ao branch TrackedSubject pré-existente. Não cobre o fencing OCC completo dos branches
TrackedSubject/Item (achado estrutural acima, item separado).
