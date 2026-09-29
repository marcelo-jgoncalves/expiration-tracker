---
status: concluído
owner: Marcelo
---

# Auditoria de arquitetura de dados — eixo (b): OCC/idempotência fora do outbox

Pedido direto de Marcelo (2026-09-29), item 14 de `NEXT_SESSION_PROMPT.md` — nunca investigado desde
D-335 registrar o item. Metodologia: `grep` de todo `\.update(` (o método NÃO-condicionado de cada
`Store`, distinto de `updateConditional`/`transactWrite`) em `src/modules/**`/`src/workers/**`/
`src/runtime/**`, cada ocorrência real avaliada por leitura direta contra a pergunta "existe um
escritor concorrente plausível que este `update()` cego poderia atropelar?" — mesma pergunta que já
achou bugs reais em D-337 (M4) e D-351 (BFF) nesta mesma sessão.

## Achado real: `IdempotencyStore.complete()` (`shared/idempotency/idempotency.ts`)

`begin()`'s caminho de reaquisição ABORTED e `abort()` já usavam `transitionIfStatus()` (escrita
condicionada por status) — cada um com um comentário extenso explicando por que um `update()` cego
seria uma corrida real (documentado desde a revisão adversarial de D-332). **`complete()` era a única
das 3 operações que ainda chamava o `update()` sem condição** — inconsistente com seus próprios
irmãos no mesmo arquivo.

**Por que isso era seguro hoje, mas frágil**: a invariante de exclusividade de `begin()` (só quem
recebe `ACQUIRED` chega a chamar `complete()`; nenhum outro chamador pode observar/reivindicar um
registro `IN_PROGRESS`) tornava o `update()` cego de `complete()` não-exploitável na prática — mas
essa segurança dependia inteiramente de uma invariante externa nunca mudar, exatamente o tipo de
fragilidade que D-337/D-351 provaram real quando uma suposição parecida foi violada por um caso de
borda (lease expirada, TTL assíncrono). **Corrigido por consistência/robustez**: `complete()` agora
usa `transitionIfStatus()` condicionado a `IN_PROGRESS`, mesmo padrão dos irmãos — uma falha de
condição agora lança erro explícito em vez de arriscar uma sobrescrita silenciosa se a invariante
externa algum dia deixar de valer.

**Efeito colateral da correção**: o método `update()` do `DynamoLike` (a porta que `IdempotencyStore`
usa) ficou sem nenhum chamador dentro do módulo — removido da interface e dos 5 pontos de wiring que
o implementavam só para isso (`document-service.ts`, `expiration-service.ts`, `import-service.ts`,
`runtime/aws/composition/extraction.ts` ×2), evitando deixar um método morto na porta.

**Achado colateral, corrigido junto**: ao rodar a suíte completa após a correção, 2 fakes de teste
(`test/unit/document/in-memory-store.ts`) não sabiam aplicar de verdade o formato de `UpdateExpression`
com placeholders nomeados (`#status`/`#requestHash`/...) que `transitionIdempotencyStatus()` gera —
só reconheciam a convenção `#setN`/`#remN` que os builders de OCC (`occ.ts`) usam. Isso deixava
`complete()` "suceder" silenciosamente no teste sem realmente persistir `status: "COMPLETED"`,
quebrando 2 testes de retry idempotente. Corrigido portando o avaliador genérico de
`UpdateExpression`/`ConditionExpression` que `test/unit/import/in-memory-store.ts` já tinha (mesmo
padrão já estabelecido no projeto pra esse exato problema, D-076 item 3) — `expiration`'s fake já
tinha essa correção aplicada anteriormente, só `document`'s precisava. 2 testes de
`expiration-service.test.ts` que espionavam `store.update()` diretamente pra simular falha de
`complete()` foram atualizados pra espionar `store.transactWrite()` (o novo caminho real).

## Outros pontos de `.update()` verificados, sem achado

- **`GlobalUserRepository.logoutDevice()`** (`identity/persistence/global-user-repository.ts:114`):
  escreve `SESSION#<deviceId>`, uma chave ÚNICA por dispositivo, criada uma vez no login
  (`upsertDeviceSession`) e nunca re-escrita por mais ninguém além de `logoutDevice()` em si. Um
  duplo-clique concorrente em "Sair" faria dois `update()` cegos escreverem o MESMO estado terminal
  (`REVOKED`) — sem dado mais novo real pra atropelar. **Verificado seguro, não é o mesmo padrão dos
  bugs de D-337/D-351** (que tinham um escritor CONCORRENTE genuíno com estado mais novo).
- **`NotificationAttemptLookup.digestSiblingAttempts`** (`notification/domain/notification-attempt.ts`):
  já documentado no próprio código como "sem campo `version` por design, escrito uma única vez antes
  da única chamada externa que este ponteiro correlaciona, nunca tocado depois" — verificado, sem
  achado.
- **`document-service.ts`/`expiration-service.ts`/`import-service.ts`/`extraction.ts`'s `update:
  (item) => this.store.update(item)`**: eram só passthroughs pro `DynamoLike` de `IdempotencyStore` —
  removidos junto com a correção acima, nunca tinham lógica própria.

## Veredito

**1 achado real corrigido** (inconsistência de robustez em `complete()`, mesma classe dos bugs reais
de D-337/D-351 desta sessão, mas não exploitável hoje graças à invariante de exclusividade de
`begin()`) + **2 fakes de teste corrigidos** (gap de simulação que o próprio achado expôs) + **3
pontos verificados sem achado**. Eixo (b) da auditoria de arquitetura de dados (D-335) está completo.
