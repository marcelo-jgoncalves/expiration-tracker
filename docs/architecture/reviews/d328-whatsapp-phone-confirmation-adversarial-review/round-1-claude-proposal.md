# D-328 — Revisão adversarial Claude↔Codex (Rodada 1)

## Escopo

Item 26 da fila de protocolo: confirmação de posse do número no opt-in de WhatsApp (D-328,
implementado em 2026-09-23 sem o protocolo, a pedido explícito de Marcelo). Nível 4-5 no
`decisions-log.md`. Novo par `WhatsAppPhoneConfirmation` (domain+service): código de 6 dígitos
enviado via `WhatsAppProviderAdapter.send()`, e só depois de confirmado `WhatsAppOptInService.
recordOptIn()` é chamado.

Arquivos-chave lidos: `src/modules/notification/domain/whatsapp-phone-confirmation.ts`,
`src/modules/notification/application/{whatsapp-phone-confirmation-service.ts,whatsapp-opt-in-service.ts}`,
`src/modules/identity/persistence/global-user-repository.ts`,
`src/modules/notification/persistence/dynamodb-recipient-resolver.ts`,
`src/runtime/aws/composition/{notification.ts,identity.ts}`, `src/runtime/aws/handlers/notifications-handler.ts`,
`test/unit/notification/{whatsapp-phone-confirmation-service.test.ts,preferences-handlers.test.ts}`,
`decisions-log.md` D-328.

## Achado real (Alta) — já corrigido antes desta rodada, ver "Correção aplicada" abaixo

**O fluxo inteiro de confirmação nunca alimentava o campo que a entrega real de WhatsApp lê.**
`DynamoDbNotificationRecipientResolver.resolve()` (usado pelo router de verdade,
`notification-router-workflow.ts`) lê o número de `GlobalUser.phoneE164` — não de
`WhatsAppOptIn.phoneE164`. `GlobalUserRepository.setPhoneNumber()` é o ÚNICO writer válido desse
campo (comentário do próprio tipo: "validated by `setPhoneNumber()` below... never written any
other way in this codebase"), mas `grep` em todo `src/` confirma que **nenhuma rota real jamais
chamava `setPhoneNumber()`** — o próprio comentário do método já documentava isso como um gap
conhecido e deliberado da fatia 1 do programa WhatsApp (D-5/D-6, anterior a D-328): "Not called
from any HTTP route yet... a future fatia adds the route."

D-328 (`confirmPhone()`) chamava só `recordOptIn()`. Resultado real: mesmo depois de um usuário
confirmar a posse do número com sucesso (código certo, dentro do prazo, opt-in gravado),
`resolveRecipientPhone`/`resolve()` continuaria retornando `phoneE164: undefined` PARA SEMPRE —
o pipeline de entrega real de WhatsApp nunca teria um número para onde mandar, mesmo depois de
E-019 liberar o canal e `WHATSAPP_DELIVERY_WORKER_ENABLED` ser ligado. A confirmação de posse
seria funcionalmente inerte quanto à entrega real, apesar de UI/testes existentes mostrarem
"sucesso" (o objeto `WhatsAppOptIn` retornado tem o telefone certo, mas isso nunca é o que o
router lê).

**Correção aplicada antes de rodar o Codex**: `confirmPhone()` agora chama
`this.globalUsers.setPhoneNumber(ctx.principal.userId, phoneE164)` em AMBOS os caminhos de
sucesso (primeira confirmação e o retry idempotente de `existing.confirmedAt`), garantindo que uma
falha parcial anterior (opt-in gravado, telefone não) tenha uma segunda chance de se corrigir num
retry. `GlobalUserRepository` injetado como nova dependência (`WhatsAppPhoneConfirmationServiceDeps.
globalUsers: Pick<GlobalUserRepository, "setPhoneNumber">`), fiado pelo composition root
(`buildIdentityDeps()` agora expõe `globalUsers`, antes só interno). 3 testes novos:
`sets GlobalUser.phoneE164 on successful confirmation`, `also sets GlobalUser.phoneE164 on the
already-confirmed retry path`, mais os 2 testes de `preferences-handlers.test.ts` (já existentes,
end-to-end via `bootstrapWithOrganization`) continuam verdes provando que o `GlobalUser` real
existe e `setPhoneNumber()` não lança `NotFoundError`.

Estou trazendo esta correção JÁ FEITA na proposta da Rodada 1 (mesmo padrão do achado proativo do
Claude na Rodada 1 de D-331/ADR-0014) porque é um bug de "parece funcionar mas está desconectado
da entrega real" que teria sido descoberto de qualquer forma - preferi corrigir antes de gastar uma
rodada só documentando o problema.

## Achados menores, registrados (não corrigidos - avaliar proporcionalidade com o Codex)

### 2. (Média) `attemptCount` incrementado via read-modify-write não atômico

`confirmPhone()`'s branch de código errado faz `await this.store.update({ ...existing,
attemptCount: existing.attemptCount + 1 })` — um `Put` incondicional (`NotificationStore.update()`
não tem OCC, `WhatsAppPhoneConfirmation` não tem campo `version`). Duas tentativas erradas
concorrentes (ex. 2 abas, ou um bot tentando adivinhar) podem ambas ler o mesmo `attemptCount` e
escrever o mesmo valor incrementado uma vez, efetivamente permitindo mais que as 5 tentativas
nominais sob concorrência. Superfície de ataque real mas de baixo impacto (o espaço de busca
continua 1-em-1-milhão por tentativa; o gate de 5 tentativas é defesa em profundidade, não a única
barreira).

### 3. (Baixa) `requestConfirmation()` pode disparar 2 envios reais por double-click/retry de rede

O cooldown de 60s é checado ANTES do envio (`isWhatsAppPhoneConfirmationInCooldown` sobre o
registro OUTRO já existente), mas duas chamadas concorrentes para o MESMO telefone (nunca
solicitado antes, `existing` ainda `undefined` nas duas) passam a checagem de cooldown
simultaneamente e ambas chamam `whatsAppProvider.send()` — 2 mensagens reais WhatsApp para o
mesmo número, custo duplicado (ainda que gated atrás de `isWhatsAppChannelEnabled()`/E-019
hoje). O frontend (`useRequestWhatsAppPhoneConfirmation`, `useMutation`) provavelmente desabilita o
botão durante `isPending`, mas isso é só defesa de UI, não uma garantia do servidor.

### 4. (Baixa) `WhatsAppPhoneConfirmation` nunca purgado se o usuário nunca completa a confirmação

`purgeAfterTtl` é um atributo DynamoDB TTL físico (mesmo padrão de `invitation-token.ts`) — a
limpeza depende do processo assíncrono nativo do DynamoDB (pode levar até 48h após a expiração
lógica), não de um worker/sweeper dedicado. Aceitável (mesmo padrão já usado em outras entidades
efêmeras deste projeto), só registrado para completude.

## Pesquisa externa (E-014)

Declarado NÃO — nenhum padrão externo (AWS/Meta) resolvido/documentado diretamente aplicável aos
achados 2-4; o achado 1 se apoiou em leitura de código interno (`dynamodb-recipient-resolver.ts`),
não documentação externa.

## Nota cega (Claude), Rodada 1

Ver `round-1-claude-selfgrade.md` (arquivo separado).
