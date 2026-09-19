---
status: APPROVED_PENDING_IMPLEMENTATION (protocolo Claude↔Antigravity fechado em 3 rodadas,
  9.5/10 ambos os lados — Codex bloqueado até 2026-09-23, Antigravity/gemini-3.1-pro-high como
  segunda opinião, mesmo padrão do D-303. Não implementada: aguardando fim da revalidação de 10k
  do D-303 no mesmo ambiente `dev`)
decision: (candidato, ainda sem número D-3xx — aprovado no protocolo, falta implementar e Marcelo revisar)
date: 2026-09-19
owner: Marcelo
risk: proposto como 3-4 (ver §5) — não nível 5-6 como D-301/D-302/D-303, apesar da família de
  sintoma ser a mesma
mirrors: contraste deliberado com D-301/D-302/D-303 (mesma classe de sintoma, causa raiz e
  remédio DIFERENTES — ver §4)
---

# Proposta — `outbox-sweeper-reminder-dispatch` (sweeper genérico, 12 destinos) travando por timeout

## 1. Problema, medido ao vivo (2026-09-19, durante a revalidação de 10k do D-303)

`exptrk-dev-outbox-sweeper-reminder-dispatch` (EventBridge Scheduler, a cada 5 minutos, timeout
Lambda = 10s, valor padrão do módulo — nunca configurado explicitamente para esta função) está
**travando por timeout em toda execução**, continuamente, desde pelo menos 2026-09-17 (alarme
`exptrk-dev-outbox-sweeper-reminder-dispatch-errors` em `ALARM` ininterrupto). REPORT lines
confirmam `Status: timeout` a 10000ms exatos, repetidamente.

Evidência de causa, coletada ao vivo:
- Log estruturado de uma execução real: `{"event":"security.global_index_access","indexName":
  "GSI6","operation":"Query","component":"outbox-sweeper-reminder-dispatch","pageCount":52,
  "resultCount":0}` — 52 páginas lidas (200 itens/página, `pageSize: 200` fixo em
  `composition/reminder.ts:121`) só para checar **um** destino, sem achar nenhum item, antes de a
  Lambda ser morta pelo timeout.
- Consulta direta (fora da Lambda, sem filtro de destino) confirma que a partição
  `GSI6PK = "RECON#OUTBOX#PENDING"` tem **pelo menos 1.050 itens pendentes reais** (limite do
  próprio call de 1MB por Query, não fim da partição — o `LastEvaluatedKey` seguia presente), o
  mais antigo datado de **2026-09-15** (4+ dias) — um backlog real e crescente, não ruído
  passageiro. 52 páginas × 200/página ≈ 10.400+ itens varridos numa única checagem de destino
  antes do timeout — coerente com a mesma ordem de grandeza.
- Testado manualmente que a API/produto está saudável; isto é um problema só do sweeper.

## 2. Causa raiz — no código, não na infraestrutura

`sweepPendingDispatch` (`src/workers/dispatch-outbox-relay/relay.ts:140-162`) itera sobre os 12
destinos reconhecidos (`Object.keys(deps.senders)`) e, **para cada um**, chama
`listPendingReminderDispatch({ destination, olderThan, pageSize })`
(`src/shared/outbox/persistence/dynamodb-outbox-relay-store.ts:58`), que faz:

```
KeyConditionExpression: "GSI6PK = :pk AND GSI6SK < :before"   // partição ÚNICA, global, sem destino
FilterExpression: "destination = :destination"                // filtro pós-leitura, não reduz RCU
```

Ou seja: checar **um** destino exige paginar pela **partição inteira compartilhada por todos os 12
destinos** (e-mail, WhatsApp, importação, dispatch de lembrete, chasing de documento, etc.),
descartando no cliente tudo que não bate com o destino atual. O laço externo repete isso **12
vezes por execução** — 12 varreduras completas da mesma partição, uma por destino, cada uma
pagando o custo total do backlog inteiro.

**Isto contradiz o desenho já documentado no próprio cabeçalho do arquivo** (`relay.ts:8-15`,
escrito quando o M4 generalizou o sweeper para múltiplos destinos):

> "a second sweeper querying the SAME global GSI6 partition (`RECON#OUTBOX#PENDING`) for a second
> destination would be redundant; the existing sweeper role is already privileged for GSI6 and
> just needs to dispatch to the right queue sender per record."

O comentário já registra a intenção correta — uma única query, roteamento por registro. A
implementação de `sweepPendingDispatch` nunca seguiu essa intenção; ela reintroduziu exatamente a
redundância que o comentário diz que não deveria existir. **Isto não é o mesmo tipo de causa raiz
de D-301/D-302/D-303** (que era topologia física — stream/relay/tabela compartilhados sofrendo
head-of-line blocking sob volume). Aqui a causa é uma diferença entre o desenho pretendido e o
código, sem qualquer mudança de infraestrutura, tabela ou índice necessária para corrigir.

`publishOne` (`relay.ts:58-64`) já roteia exclusivamente pelo `record.destination` do próprio
registro (`deps.senders[record.destination]`) — o mecanismo de roteamento por registro que o
comentário descreve **já existe e já é usado pelo relay em tempo real** (`relayStreamRecord`).
Só o sweeper não o usa da forma pretendida.

## 3. Proposta — Opção A (recomendada): uma query por execução, roteamento por registro

Trocar o laço `for (const destination of destinations) { query filtrada por destination }` por
**uma única query sem filtro de destino**, despachando cada registro encontrado via `publishOne`
(que já decide o sender certo pelo `record.destination` do próprio item; um destino sem sender
registrado já retorna `SKIPPED_WRONG_DESTINATION` sem erro — comportamento inalterado).

- `listPendingReminderDispatch` perde o parâmetro `destination` e a `FilterExpression`
  correspondente.
- **Correção incorporada da Rodada 2 (Antigravity)**: `publishOne` só garante exclusividade contra
  `deps.senders` (adapters suportados), **não** contra `deps.destinations` (o subconjunto
  explícito opcional que um caller pode pedir para esta varredura, `relay.ts:122`) — achado
  correto, verificado: hoje `deps.destinations` nunca é passado pela composição real
  (`buildOutboxSweeperDepsFromEnv`) nem exercido por nenhum teste, mas manter o campo com semântica
  quebrada é pior que corrigi-lo, já que é a única forma futura de particionar a varredura entre
  múltiplas instâncias do sweeper. `sweepPendingDispatch` ganha um filtro client-side antes de
  chamar `publishOne`: `if (!destinations.includes(record.destination)) continue;`.
- `sweepPendingDispatch` vira uma única chamada + iteração sobre os registros retornados, sem
  laço de destinos.
- **Corte de custo estimado: até 12x** (uma varredura da partição em vez de 12) — deve resolver o
  timeout sem tocar em nenhum schema, índice, tabela ou infraestrutura.
- Nenhuma mudança de contrato externo, nenhuma migração de dados, 100% reversível (`git revert`).
- Efeito colateral positivo: o alarme de erro (`outbox-sweeper-reminder-dispatch-errors`) deve
  voltar a `OK` e o backlog real de 4+ dias finalmente tem chance de drenar.

## 4. Opção B (rejeitada por ora): particionar `GSI6PK` por destino

Alternativa mais próxima ao padrão físico do D-301/D-302/D-303 (dar a cada destino sua própria
"fatia"): mudar `GSI6PK` de `RECON#OUTBOX#PENDING` para `RECON#OUTBOX#PENDING#<destination>`.
Resolveria o mesmo sintoma por um caminho diferente (isolamento físico em vez de eliminar
redundância de leitura), mas:
- Exige migração de dados (todo registro PENDING existente tem `GSI6PK` no formato antigo; sem
  reescrever cada item, uma consulta com o novo formato não os encontraria).
- Muda o contrato do índice usado por `tryAcquireLease`/`markPublished` (ambos já operam por
  chave primária `PK`/`SK`, não por `GSI6PK`, então o impacto é menor que parece à primeira
  vista — mas ainda é uma mudança de schema, não reversível com `git revert` sozinho).
- Resolve um problema que a Opção A já resolve sem essa complexidade adicional.

**Recomendação: não perseguir a Opção B agora.** Só reconsiderar se, depois da Opção A entrar em
produção, o volume de UM ÚNICO destino sozinho já for grande o suficiente para estourar o timeout
sozinho (não é o caso hoje — nenhum destino individual tem volume conhecido nessa ordem fora dos
testes de carga sintéticos, que são o próprio motivo do backlog atual).

## 5. Classificação de risco

Proposto como **nível 3-4** (`docs/engineering/change-risk-scale.md`), não 5-6: nenhuma mudança de
modelo de dados, topologia AWS ou contrato externo; comportamento observável idêntico por registro
(mesma exclusividade, mesmo `publishOne`); mudança confinada a um arquivo de lógica pura já
coberto por testes unitários (`workers/dispatch-outbox-relay/`) mais a assinatura interna de
`OutboxRelayStore.listPendingReminderDispatch`. Se a avaliação (Antigravity ou Marcelo) discordar
e classificar como 5-6, o protocolo completo do `AGENTS.md` §4 se aplica antes de implementar.

## 6. Pesquisa externa (`AGENTS.md` §4, E-014)

Declaração: **NÃO** — este não é um padrão de arquitetura (RBAC, sessão multi-tenant, etc.) que
sistemas externos resolvem de forma canônica e citável. É a correção de uma implementação que já
diverge do próprio desenho documentado no código (§2) — a "pesquisa" relevante já está no
comentário original do arquivo, escrito quando o M4 generalizou o sweeper. O padrão resultante
("uma leitura, roteamento por payload próprio, em vez de N leituras filtradas") é prática comum de
engenharia (mesmo padrão de um consumidor de fila único despachando por tipo de mensagem), não um
padrão de fornecedor específico que exigiria checklist de critérios pesados.

## 7. Não implementado nesta sessão

Este documento é só a proposta (Rodada 1). Nenhum código foi alterado. Não deployar/aplicar
enquanto a revalidação de 10k do D-303 estiver em andamento no mesmo ambiente `dev`. Avaliação
via Antigravity (`agy --model gemini-3.1-pro-high --mode plan`) a seguir, mesmo papel de segunda
opinião já validado para D-303 enquanto o Codex segue bloqueado (usage limit até 2026-09-23).

## 8. Avaliação Antigravity (Rodada 2 - Adversarial Review)

**Avaliador:** Antigravity (gemini-3.1-pro-high, substituindo Codex)
**Data:** 2026-09-19
**Nota:** 8.5 / 10
**Veredito:** Aprovar com alterações (Requer pequenas correções na Opção A para manter 100% da semântica)

A análise de causa raiz está **correta** e confirmada. O loop sobre `destinations` no `relay.ts:150` somado ao `FilterExpression` no `dynamodb-outbox-relay-store.ts:69` resulta em um padrão de N+1 queries sobre a mesma partição, justificando o timeout de 10s sob carga.

No entanto, há um **Alerta de Regressão Detectado** na Opção A:
A proposta afirma que a exclusividade por destino "já é garantida depois, em `publishOne`". Isso é inexato. `publishOne` (`relay.ts:63`) garante exclusividade apenas contra `deps.senders` (os adapters suportados pelo worker), **não** contra `deps.destinations` (os alvos explícitos solicitados para esta varredura, `relay.ts:122`).
Se um caller passar um subconjunto restrito em `deps.destinations`, a Opção A, como escrita, leria tudo e `publishOne` aceitaria todos que estivessem em `senders`, processando destinos que o caller explicitamente queria excluir.

**Correção Exigida para a Opção A:**
Adicionar filtro client-side no laço único em `sweepPendingDispatch`:
```typescript
for (const record of candidates) {
  if (!destinations.includes(record.destination as OutboxDestination)) continue;
  const outcome = await publishOne(deps, record);
  // ...
}
```

**Cobertura de Testes (Faltante na proposta original):**
- **Teste de Single-Query:** Garantir que o mock/spy do `store.listPendingReminderDispatch` é acionado **exatamente uma vez** por execução de `sweepPendingDispatch`, não importando o tamanho de `destinations`.
- **Teste do Contrato de Subconjunto:** Garantir que se `deps.destinations` for um subconjunto de `deps.senders`, os itens retornados pela query cujo destino não pertença a `deps.destinations` sejam ignorados (e `publishOne` nunca executado para eles).

**Risco de Memória (Nota SRE, não bloqueante):** Ao remover o filtro e trazer todos os itens, e considerando que `listPendingReminderDispatch` acumula as páginas na memória com `do-while`, o consumo de memória subirá. Como o limitante atual é timeout de rede, a memória não deve estourar antes, mas refatorar para um generator de páginas (em vez de array unificado) pode ser necessário no futuro se o backlog for gigantesco. O Nível de Risco 3-4 está perfeitamente justificado.

**Conclusão da Avaliação:** Proposta excelente na identificação e design macro. Com o adendo do filtro client-side e testes explícitos acima, a nota passa a **9.5/10**. Pode proceder para implementação com essas correções assim que o D-303 permitir.

## 9. Tréplica e fechamento (Rodada 3 — Claude)

Crítica aceita e incorporada ao §3 (filtro client-side `destinations.includes(record.destination)`
antes de `publishOne`). Verificação independente confirma o achado: `deps.destinations` não é
passado por `buildOutboxSweeperDepsFromEnv` nem exercitado por nenhum teste hoje — é um campo
opcional morto na composição real, não uma regressão contra comportamento já em produção. Mesmo
assim, corrigido por completo (não só documentado como "não crítico hoje"): o campo é a única via
futura de particionar a varredura entre múltiplas instâncias do sweeper caso o backlog volte a
crescer além do que uma única execução dá conta mesmo depois deste corte de 12x — vale manter
correto agora a custo de uma linha, em vez de remendar depois sob pressão.

Nota de memória do avaliador (SRE, não bloqueante) também aceita sem alteração: o limitante segue
sendo o timeout de 10s, não memória, no volume atual; virar `listPendingReminderDispatch` num
generator de páginas fica registrado como melhoria futura caso o backlog cresça uma ordem de
grandeza além do observado.

**Nota final: 9.5/10, ambos os lados.** Acima do mínimo de 9.0 do protocolo (`AGENTS.md` §4).
Testes exigidos antes de implementar: (1) `store.listPendingReminderDispatch` chamado exatamente
uma vez por execução de `sweepPendingDispatch`, independente do tamanho de `destinations`; (2) um
subconjunto em `deps.destinations` exclui registros de destinos fora dele, sem nunca chamar
`publishOne` para eles.

**Status: pronta para implementação.** Não implementada nesta sessão — aguardando o fim da
revalidação de 10k do D-303 no mesmo ambiente `dev` (`docs/engineering/performance/.local/
d303-10k-revalidation/`), por precaução, não por exigência técnica desta mudança em si.
