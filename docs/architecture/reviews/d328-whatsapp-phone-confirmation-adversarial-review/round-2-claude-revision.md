# D-328 — Rodada 2 (correções aplicadas aos achados reais da Rodada 1, nota Codex 6,5/10)

Verifiquei cada um dos 5 achados do Codex (2 Alta, 1 achado que reclassificou como parte do
achado 1, 2 Média) e corrigi todos - nenhum registrado sem correção nesta rodada, diferente de
D-315/D-316/ADR-0014 (lá havia achados genuinamente fora de proporção; aqui todos os 5 estavam
dentro do escopo direto de "a confirmação de posse é real e segura").

## Achado 1 (Alta) - `setPhoneNumber()` competia com `logoutAll()`/`logoutDevice()` sem OCC

Confirmado: `setPhoneNumber()` fazia um `IdentityStore.update()` (PutItem incondicional do objeto
INTEIRO lido antes). Ao tornar este writer alcançável (minha própria correção da Rodada 1), ele
passou a competir de verdade com `logoutAll()` (mesmo padrão de PutItem incondicional) - um
`PutItem` do objeto inteiro lido antes de um logout concorrente escrever `globalLogoutAfter`
apagaria esse watermark de segurança silenciosamente.

**Corrigido**: `setPhoneNumber()` agora usa `buildUnscopedVersionedUpdate()` (`occ.ts` - o mesmo
builder já usado por `WebhookInbox`/`ReminderScanLease`, entidades sem `tenantId` como
`GlobalUser`): escreve SÓ `phoneE164` via `SET` (+ `version`/`updatedAt` automáticos do builder),
condicionado ao `version` já lido. Nunca reescreve o item inteiro, nunca pisa em nenhum outro
campo, e falha com `TransactionCanceledException` (capturável via `isTransactionCanceled()`) se
outro escritor incrementou `version` no meio, em vez de sobrescrever silenciosamente.
`tableName` passa a ser um parâmetro explícito de `setPhoneNumber()` (não adicionado ao construtor,
que quebraria ~20 call sites existentes). Teste novo: `global-user-repository.test.ts` prova que um
escritor concorrente segurando a versão antiga é rejeitado, nunca aplicado silenciosamente.

**Residual aceito, não fechado**: isto fecha a direção "confirmação de telefone apaga um logout
concorrente". A direção OPOSTA (`logoutAll()`/`logoutDevice()` apagando um telefone recém-confirmado)
continua possível, porque esses dois métodos AINDA fazem PutItem incondicional do objeto inteiro -
convertê-los ao mesmo padrão versionado é maior escopo (2 métodos adicionais, discussão de
compatibilidade com todo chamador de `logoutAll`) e fica fora de proporção para esta revisão focada
em D-328. Pior caso dessa direção residual: um usuário precisa reconfirmar o telefone, sem impacto
de segurança (não é o `globalLogoutAfter` sendo apagado, é o inverso).

## Achado 2 (Alta) - atalho idempotente (`existing.confirmedAt`) pulava toda validação de código

Confirmado por leitura: o branch `if (existing.confirmedAt) { ... }` chamava
`setPhoneNumber()`/`recordOptIn()` incondicionalmente, sem checar o `code` recebido contra
`existing.codeHash`. Como um registro confirmado nunca é apagado (só expira via TTL físico do
DynamoDB, que pode levar dias) e `phoneE164` faz parte da própria chave, um usuário podia: confirmar
o telefone A → confirmar o telefone B (`GlobalUser.phoneE164` → B) → a qualquer momento depois,
repetir `confirmPhone(A, "qualquer código de 6 dígitos")` para forçar `GlobalUser.phoneE164` de
volta para A, sem nenhuma prova de posse nova.

**Corrigido**: o código ainda precisa bater com o hash já persistido mesmo neste atalho. Um replay
legítimo (retry de rede do MESMO request que já teve sucesso) sempre reenvia o mesmo código que
usou, então isso nunca quebra o caso de uso idempotente real - só fecha o replay malicioso/tardio
com um código arbitrário.

## Achado 3 - rota antiga (`POST /notifications/whatsapp-opt-in`) permitia opt-in sem confirmação

Confirmado: `handleRecordWhatsAppOptIn` continuava wireado (handler, rota Terraform, allowlist do
BFF) mesmo depois de D-328 introduzir a confirmação por código - contradizendo diretamente a
invariante que D-328 afirma garantir ("todo WhatsAppOptIn nasce possession-confirmed"). O próprio
Codex reconheceu que essa rota isolada não alterava `GlobalUser.phoneE164` (então não demonstra
envio real para um número nunca confirmado), mas a fronteira de consentimento verificável que D-328
existe para garantir simplesmente não existia de verdade.

**Corrigido - rota REMOVIDA por completo**:
- Handler `handleRecordWhatsAppOptIn` removido de `preferences-handlers.ts` (e o campo
  `whatsAppOptIn` do `NotificationHttpDeps`, que só existia para ele).
- Rota removida de `infra/modules/api-gateway/main.tf`, `notifications-handler.ts`'s switch, e do
  allowlist do BFF (`proxy-allowlist.ts`).
- Schema `whatsapp-opt-in-request.v1.json` removido (arquivo deletado + import/registro em
  `schema-validator.ts`).
- Teste Terraform (`api_gateway.tftest.hcl`) trocado de asserção POSITIVA (rota existe) para
  NEGATIVA (rota nunca deve voltar a existir sem essa checagem sendo notada) - `length(...) == 4`
  (era 5).
- `WhatsAppOptInService.recordOptIn()` continua existindo como capability interna, chamada só por
  `WhatsAppPhoneConfirmationService.confirmPhone()` - sem rota HTTP direta.
- 3 testes de handler que exercitavam a rota removida (`preferences-handlers.test.ts`) removidos -
  a capability interna continua coberta por `whatsapp-opt-in-service.test.ts`.

## Achado 4 (achado 2 da minha proposta original, Média) - `attemptCount` incrementado sem OCC

Mesma classe de problema do achado 1, aplicada ao registro `WhatsAppPhoneConfirmation`: o
incremento de `attemptCount` era um `store.update()` incondicional do objeto inteiro. Duas
tentativas erradas concorrentes podiam ler o mesmo `attemptCount` e persistir o mesmo incremento
uma única vez, permitindo mais que as 5 tentativas nominais sob concorrência.

**Corrigido**: adicionado `version: number` ao domínio `WhatsAppPhoneConfirmation`
(`buildWhatsAppPhoneConfirmation()` inicia em 1); tanto o incremento de `attemptCount` quanto o
`SET confirmedAt` do caminho de sucesso agora usam `buildUnscopedVersionedUpdate()`, condicionados
ao `version` lido. Em caso de conflito no incremento de tentativa, o resultado é o mesmo (código
errado → rejeitar) independente de quem venceu a corrida - não precisa retry. Em caso de conflito
no `SET confirmedAt`, relê o registro: se outro `confirmPhone()` concorrente já confirmou, prossegue
normalmente (idempotente); senão, propaga o erro genérico. Teste novo prova que um escritor
concorrente com a versão antiga é rejeitado.

## Achado 5 (achado 3 da minha proposta original, Média) - `requestConfirmation()` pode disparar 2 envios reais

Confirmado, não corrigido nesta rodada por decisão consciente registrada abaixo (não Codex
concordando previamente - decisão minha, a validar com ele nesta rodada): o cooldown é checado
ANTES do envio, então duas chamadas concorrentes para o MESMO telefone nunca antes solicitado
passam a checagem simultaneamente e ambas enviam. Diferente dos achados 1/2/4 (que protegem contra
consequências de segurança/integridade reais - phone incorreto, replay, contorno de limite de
tentativas), este é puramente um problema de custo/UX duplicado (2 mensagens reais WhatsApp, hoje
inatingível de qualquer forma atrás do flag `WHATSAPP`/E-019). Registrado como pendência de baixa
prioridade - reservar o desafio condicionalmente ANTES do envio (mesmo padrão de OCC dos achados
1/4) resolveria, mas cada envio real custa dinheiro/tem rate limit da Meta, então uma correção aqui
merece medir o volume real de double-click antes de adicionar complexidade, não antes de qualquer
usuário real existir.

## Pesquisa externa (E-014) - correção da Rodada 1

Codex contestou minha declaração `NÃO` na proposta - correto, revertendo: posse por OTP, limitação
de tentativas, expiração e reuso são padrões externos estabelecidos (OWASP MFA Cheat Sheet, seção
OTP handling/storage). Declarando `SIM PARCIAL` nesta rodada: os 5 elementos que a proposta original
já implementava (código de 6 dígitos, hash nunca-a-senha-crua, TTL de 10min, limite de 5 tentativas,
cooldown de reenvio de 60s) alinham com essa orientação; os achados 1/2/4 desta rodada eram
precisamente os pontos onde a implementação real não cumpria as garantias que esses padrões
pressupõem (posse verificada de verdade, sem replay, sem contorno de limite).

## Nota cega (Claude), Rodada 2

Ver `round-2-claude-selfgrade.md` (arquivo separado).
