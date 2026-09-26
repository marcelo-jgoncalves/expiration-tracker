# D-319 — Rodada 2 (endereçando os 6 achados da Rodada 1, nota Codex 6,5/10)

## Achado 1/2 — claim órfã confundida com criação concluída (alta) — CORRIGIDO, com a correção do Codex aplicada

O Codex apontou corretamente que minha correção proposta na Rodada 1 estava incompleta: `subjectId
=== ""` NÃO prova que a criação nunca aconteceu (pode ter sucedido e só o `update()` de
confirmação ter falhado, ou outra execução concorrente ainda estar em andamento) — então recriar
cegamente arrisca duplicar a entidade. Implementado exatamente como o Codex recomendou: novo
`resolveExistingClaim()` (`import-commit-service.ts`) lê o `ImportDedupRecord` quando `putIfAbsent`
retorna `false`; se `subjectId` já tem um ID real → trata como concluído (comportamento antigo,
preservado); se ainda é `""` → **para o job** com o novo outcome `FAILED_INDETERMINATE_ROW_STATE`
(`failureReason: "INDETERMINATE_ROW_STATE"`), nunca recria nem avança o cursor silenciosamente —
visível para o operador via status do job, mesmo mecanismo que `FAILED_ENTITLEMENT_EXCEEDED` já usa.

**Escopo ampliado deliberadamente**: corrigido em AMBOS os ramos (`commitItemRows` E
`commitTrackedSubjectRows`), não só o de Item. O Codex perguntou explicitamente se isso fazia
sentido dado ser um bug pré-existente fora do escopo estrito de D-319 — decisão: sim, porque deixar
o "original" quebrado enquanto se corrige a "cópia" seria um estado inconsistente e confuso, e a
correção é mecânica uma vez que o padrão (`resolveExistingClaim`) já existe.

4 testes novos (`import-commit-service.test.ts`): claim órfã (subjectId vazio) → `FAILED_
INDETERMINATE_ROW_STATE`, cursor não avança, nenhuma entidade criada (Item E Subject); claim com
ID real → ainda trata como concluído, cursor avança, sem recriar (prova que a correção não
transforma todo retry em falso-negativo).

## Achado 3 — colisão determinística na chave composta via `|` sem escape (alta) — CORRIGIDO

`buildItemDedupKey()` agora usa `JSON.stringify([categoria, nome, dueDate])` em vez de
`${a}|${b}|${c}` — cada campo é escapado pela própria serialização JSON, eliminando a ambiguidade
que o Codex identificou (`categoria="a|b"`+`nome="c"` vs. `categoria="a"`+`nome="b|c"` antes
produziam a mesma string). Teste novo prova que os dois pares diferentes nunca mais colidem.

## Achado 4 — idempotência de `reserveImport()` ignora `targetEntityType` (média) — CORRIGIDO

`requestHash` agora inclui o `targetEntityType` EFETIVO (já resolvido para o default
`"TrackedSubject"` ANTES do hash, não o valor bruto opcionalmente `undefined` — assim, omitir o
campo e passar `"TrackedSubject"` explicitamente continuam sendo o MESMO request, nunca um
conflito falso). Reutilizar a mesma `Idempotency-Key`+arquivo trocando o tipo agora produz um
`ConcurrentOperationError` real (mesmo mecanismo que já protege qualquer outra mudança de payload
sob a mesma chave), nunca mais devolve silenciosamente o job da primeira chamada. 2 testes novos.

## Achado 5 — datas equivalentes escapam da deduplicação (média) — CORRIGIDO

`normalizeCsvDateTime()` agora SEMPRE canonicaliza via `new Date(...).toISOString()` em ambos os
ramos (data pura e timestamp completo) — `"2026-12-31"`, `"2026-12-31T00:00:00Z"` e
`"2026-12-30T21:00:00-03:00"` (mesmo instante, três representações) agora produzem exatamente a
mesma string. Único consumidor de `normalizeCsvDateTime()` é o próprio `dueDate`/`issueDate` de
Item (confirmado por grep — nenhum outro tipo usa essa função), então a mudança não risca
comportamento de `TrackedSubject`/`Document`/`Requirement`. Teste novo prova a canonicalização
para as 3 representações citadas pelo Codex.

## Achado 6 — timestamp com data impossível aceito (média) — CORRIGIDO

`DATE_TIME_PATTERN` agora captura os grupos ano/mês/dia e o ramo de timestamp roda a MESMA
`isValidCalendarDate()` que o ramo de data pura já usava — `"2026-02-30T00:00:00Z"` agora é
rejeitado (`Date.parse` sozinho o normalizaria silenciosamente para 2 de março, nunca mais aceito
como está). Teste novo cobre especificamente este caso com timestamp completo (o teste existente já
cobria o caso de data pura).

## Achado 7 (gap de produto aceitável) — dedupe nunca protege contra Item manual — MANTIDO como está

O Codex concordou que isto é aceitável como escopo explícito (mesma postura de Document/Requirement),
mas pediu que a falta de teste seja reconhecida (não com a mesma gravidade do achado 1/2). Não
implementado (exigiria scan tenant-wide, fora de proporção para v1, conforme já registrado em
`decisions-log.md` D-319) — mantido como decisão explícita, não como bug.

## Achado 8 (expansão de escopo) — `reserveImport()` destrava HTTP para Document/Requirement — RECONHECIDO, sem mudança de código

O Codex concordou que isto não é uma vulnerabilidade isolada, mas pede reconhecimento explícito de
escopo. Registrado nesta revisão e em `decisions-log.md`/`NEXT_SESSION_PROMPT.md` como uma
expansão de escopo real (não uma regressão) — já testado (`import-service.test.ts`'s teste de
Document), mas nomeado explicitamente aqui em vez de mencionado de passagem.

## Pesquisa externa (research-protocol.md, E-014)

O Codex apontou corretamente que esta rodada não tinha a declaração obrigatória. **NÃO** (a decisão
central — atomicidade/idempotência de um protocolo de 2 chamadas contra um store proprietário
DynamoDB — não corresponde a um padrão externo já resolvido e amplamente documentado da forma que
E-014 endereça; é uma composição específica deste código, não algo como "OAuth"/"RBAC" com
literatura padronizada). Mantido `NÃO`, declarado explicitamente agora.

## Testes/evidência desta rodada

Backend: 274 arquivos/3258 testes verdes (+8 novos: 1 fixture corrigida + 3 orphaned-claim + 3
dedupe-key/data + 2 idempotency-hash). `npm run typecheck`/`lint`/`check-boundaries` limpos.

## Auto-nota cega (Claude), Rodada 2

Ver `round-2-claude-selfgrade.md` (arquivo separado).
