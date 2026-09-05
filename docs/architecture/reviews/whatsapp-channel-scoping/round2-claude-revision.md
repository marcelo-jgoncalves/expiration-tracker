# WhatsApp Operacional (Roadmap P0.3) — Rodada 2 (revisão Claude)

A Rodada 1 do Codex contestou o próprio checklist de critérios pesados (não só a nota) — 6
bloqueantes reais, todos verificados por leitura direta do código/docs deste repo antes de
aceitar. Nenhum é polimento; todos mudam a forma da proposta. Seguindo `research-protocol.md`:
esta rodada primeiro reconcilia o checklist, depois revisa o design contra ele — nota da régua
e nota do design continuam separadas até a régua estabilizar (ainda não estável nesta rodada,
`AGENTS.md` §4/`research-protocol.md` — Codex avalia a reconciliação abaixo antes de qualquer
nota final).

## Checklist reconciliado (v2 — substitui integralmente o da Rodada 1)

Mudanças vs. v1, cada uma amarrada a um achado do Codex: critérios 1 e 2 novos (bloqueantes
que a v1 tratava como detalhe de implementação); critério de opt-in fundido com "vínculo ao
telefone" (achado #4); critério de quota reescrito para "destinatário único em janela móvel"
(achado #3), não "consumo agregado" genérico; peso de "reuso do state machine" reduzido de 15%
para 10% (Codex: "desejável, mas não pode encobrir diferenças reais do provedor") e
redistribuído aos 2 critérios novos.

1. **(15%) Todo webhook grava `WebhookInbox` ANTES de processar, com replay/idempotência
   real.** Atende: mesma forma já `APPROVED` em `architecture-fase3-consolidada.md` (cenário
   15) e já implementada por `ses-callback-workflow.ts` — chave composta
   `provider+tenant/account+providerEventId`, `putIfAbsent` (create-once), verificação de
   assinatura em tempo constante ANTES de qualquer gravação de estado de negócio. Não atende:
   atualizar `NotificationAttempt` direto a partir do payload do webhook sem essa gravação
   prévia.
2. **(15%) Contrato SQS por canal, conforme ADR-0008 (não um detalhe genérico de "adapter").**
   Atende: fila dedicada nova (`SQS_NOTIFICATION_WHATSAPP_V1`) + schema JSON próprio
   (`schemas/queues/notification-whatsapp-deliver.v1.json`, contract test), mesma forma de
   `notification-email-deliver.v1.json`/`buildEmailOutboxRecord` — nunca uma fila
   compartilhada entre canais (ADR-0008 rejeitou essa opção explicitamente, cenários 3-5 do Red
   Team: isolamento de falha entre provedores). Não atende: reaproveitar a fila de e-mail ou
   inventar um envelope sem schema/contract test.
3. **(15%) Quota mede DESTINATÁRIO ÚNICO em janela móvel de 24h, nunca chamadas/tentativas em
   janela fixa.** Atende: mecanismo cuja forma física corresponde ao que a Meta realmente
   limita (números de telefone únicos alcançados por mensagem business-initiated numa janela
   móvel, não fixa) — `TenantQuotaService` atual (fixed-window, incrementa por chamada) é
   insuficiente e não é reaproveitado sem uma camada nova. Não atende: tratar o limite da Meta
   como só mais um `TenantQuotaRecord` de janela fixa.
4. **(15%) Opt-in é um registro vinculado ao TELEFONE exato, não um timestamp solto por
   tenant.** Atende: o registro de opt-in referencia o valor de telefone E.164 que foi
   consentido; se `GlobalUser.phoneE164` muda, o opt-in antigo NUNCA autoriza o número novo
   (join sempre contra o telefone atual, nunca contra "existe algum opt-in para este usuário").
   Não atende: um booleano/timestamp que sobrevive a uma troca de número.
5. **(10%) Reuso do state machine de `NotificationAttempt`/`EmailProviderAdapter` ONDE a forma
   realmente é igual — nunca onde o provedor diverge de verdade.** Atende: `channel`/`provider`
   alargam para união sem reescrever `decideSendAction`/lease; contrato de erro 3-vias é
   honrado com o mapeamento real de erro da Cloud API; MAS a correlação de webhook, o payload
   de fila e a quota (critérios 1-3 acima) são desenhados para a forma REAL do provedor, não
   herdados de SES por analogia. Não atende: qualquer alegação de reuso que não cite o
   mecanismo real equivalente do lado WhatsApp.
6. **(10%) Toda mensagem business-initiated usa template pré-aprovado, nunca free-form.**
   (Inalterado da v1 — Codex não contestou este critério.)
7. **(10%) Credencial de terceiro nunca vira env var em texto puro, com inventário completo.**
   Atende: access token, app secret, phone number ID, WABA ID, E `verify_token` do handshake —
   todos via Secrets Manager, nunca só os 4 que a v1 listou. Rotação/incidente registrados como
   pendência explícita (mesmo nível de maturidade que `GUEST_TOKEN_PEPPER` hoje tem no repo —
   proporcional, não uma barra mais alta inventada só para este secret).
   (Peso ajustado de 10% para 10%, sem mudança — só o escopo do "atende" mudou.)

Total: 100% (15+15+15+15+10+10+10). Critério de "guardrail de custo agregado" da v1 foi
absorvido pelo critério 3 (a métrica de custo E a métrica de limite de tier são a MESMA
contagem de destinatário único — medir uma é medir a outra, não dois mecanismos).

## Resposta aos 6 bloqueantes da Rodada 1

### 1. WebhookInbox — corrigido, mesma forma de `ses-callback-workflow.ts`

`webhookInboxKey`: `PK = TENANT#<t>#WEBHOOK#WHATSAPP#<wabaId>`, `SK = EVENT#<wamid>#<statusType>`
— **achado real que refina a v1**: um único envio gera VÁRIOS eventos de status ao longo do
tempo (`sent`→`delivered`→`read`, confirmado pela pesquisa da Rodada 1/2), então a chave de
dedupe não pode ser só `wamid` (colidiria entre `sent` e `delivered` do mesmo `wamid`,
descartando o segundo como falso duplicado) — `statusType` entra na SK, mesma disciplina do
`snsMessageId` da SES (um evento de transporte por linha de inbox). `putIfAbsent`
(`ConditionExpression attribute_not_exists`), GSI8 `transient-purge` pointer igual ao já usado
para `WebhookInbox` de SES (`deriveWebhookInboxMaintenanceDue`/`transientPurgeGsi8Keys`, sem
mecanismo novo). Verificação `X-Hub-Signature-256` (HMAC-SHA256, tempo constante) acontece
ANTES da gravação no inbox, não depois.

### 2. Contrato SQS por canal (ADR-0008) — corrigido

Fila+DLQ nova `whatsapp-deliver-queue` (mesmo padrão `maxReceiveCount=5` de toda fila deste
repo), `SQS_NOTIFICATION_WHATSAPP_V1` como `destination` do `OutboxEvent`,
`buildWhatsAppOutboxRecord` (mesma forma de `buildEmailOutboxRecord`,
`notification-router-workflow.ts:361`) serializando `{to, templateName, templateLanguage,
templateComponents, tags}` (D-2 da Rodada 1). Schema novo
`schemas/queues/notification-whatsapp-deliver.v1.json` (mesma disciplina de
`notification-email-deliver.v1.json`) + teste de exemplo válido/inválido em `test/contract/`.
`WhatsAppDeliveryWorker` (Lambda novo) consome essa fila, espelhando
`email-delivery-workflow.ts` na FORMA (lease/`SUBMITTING`/`decideSendAction`), nunca
reaproveitando a fila de e-mail.

### 3. Quota por destinatário único, janela móvel — mecanismo físico novo, GSI novo

`TenantQuotaService` (fixed-window, por tenant, conta CHAMADAS) fica exatamente como está —
não é estendido, não é reaproveitado para este propósito, exatamente como o critério 3 exige.
Mecanismo novo, cross-tenant por natureza (o limite é do PORTFÓLIO Meta inteiro, não de um
tenant): uma linha por `(destinatário, timestamp de envio)` — `PK = WHATSAPP#PORTFOLIO`,
`SK = RECIPIENT#<telefoneE164>#<timestampIso>` —, TTL de 25h (janela de 24h + margem), e uma
Query pelo `PK` fixo com `SK BETWEEN <now-24h> AND <now>` retorna todos os envios da janela;
contar `Set` de telefones distintos nesse resultado é a contagem real que a Meta usa. **Falha
fechada**: se a Query falhar (não só "sem resultado", erro real de leitura), o envio é
bloqueado (RETRY), nunca assumido como "abaixo do limite" por padrão — mesma postura de
`RouterEntitlementState`/`RouterPreferenceState` (`notification-router.ts`) para falha técnica
distinta de negação real. **GSI novo — nível 5, achado de alocação de nome**: a tabela física
está em GSI9 hoje (D-193 slice 5); D-194 (`search-and-filters-scoping`, Fatia 4, DEFERIDA)
já reservou informalmente o nome "GSI10" para uma projeção materializada futura própria. Regra
de resolução proposta (evita bloquear uma decisão pela outra): **o slot GSI10 vai para quem
primeiro chegar a código real** — se esta decisão implementar primeiro, o índice de quota
WhatsApp é GSI10 e a Fatia 4 de D-194 (quando/se construída) vira GSI11; se a ordem for
invertida, o oposto. Nenhuma das duas decisões trava a outra por isso.

### 4. Opt-in vinculado ao telefone exato — corrigido

Entidade nova `WhatsAppOptIn` (não mais um campo solto em `NotificationPreferences`):
`PK = TENANT#<t>#USER#<userId>`, `SK = WHATSAPP_OPTIN#<phoneE164>` — chave inclui o telefone,
não só o usuário. `hasValidOptIn(userId, currentPhoneE164)` sempre lê pela chave com o telefone
ATUAL de `GlobalUser`; se o telefone mudou, a chave antiga simplesmente não bate (nenhuma
invalidação explícita necessária — o join contra o valor atual já é a invalidação, por
construção). Registro captura `optedInAt`, `source` (ex.: `"PREFERENCES_TOGGLE"`), `tenantId`
(qual negócio o titular consentiu comunicação), nunca só um booleano.

### 5. Correlação de webhook — provada, não assumida (achado real da pesquisa desta rodada)

Confirmado via pesquisa dedicada 2026-09-04 (fonte: prática de mercado consistente sobre o
mecanismo `biz_opaque_callback_data` da Cloud API — string opaca de até 256 caracteres,
definida no envio, ecoada em TODO evento de status subsequente do mesmo `wamid`) — o MESMO
mecanismo de "tag opaca de correlação" que SES já usa (`tags: {attemptId, intentId, tenantId}`
em `email-provider.ts`). `WhatsAppSendInput.tags` serializa para `biz_opaque_callback_data`
(mesmo formato de string das tags de SES, sem mecanismo novo de serialização); `wamid`
(`messages[0].id` na resposta de envio, `statuses[].id` no callback) é o
`providerMessageId` equivalente. `NotificationAttemptLookup` é reaproveitado sem mudança de
forma — só um `provider: "META_CLOUD_API"` a mais na união de tipo (D-1 da Rodada 1).
**Nota de verificabilidade**: esta fonte é prática de mercado consolidada (múltiplas
integrações documentam o mesmo comportamento), não a página oficial de referência de campos da
Meta diretamente citável por URL estável — registrado como limitação explícita
(`research-protocol.md`: "se só documentação de vendor/prática estiver disponível, a
declaração registra isso"); a próxima fatia de implementação real deve confirmar contra um
payload de sandbox real antes do primeiro envio de produção, mesma disciplina que
`ses-callback-workflow.ts`'s próprio comentário já registrou para SES ("round3-fixes.md item 2
- pendente do spike de sandbox").

### 6. Secrets — inventário completo

Adicionado `verify_token` (handshake GET) à lista de D-9 da Rodada 1 — agora 5 valores via
Secrets Manager: access token, app secret, phone number ID, WABA ID, verify_token. Rotação
manual e procedimento de incidente (vazamento de token) ficam como pendência nomeada, não
desenhados nesta rodada — mesmo nível de maturidade operacional que `GUEST_TOKEN_PEPPER`/
`SESSION_TOKEN_PEPPER` já têm hoje no repo (nenhum dos dois tem procedimento de rotação
documentado); levantar a barra só para este secret sem um pedido explícito de Marcelo seria
gold-plating (`principles.md` #1).

## Pendência sobre a fonte de pricing (achado #6 da Rodada 1, ainda aberta)

Não encontrada uma página oficial da Meta (developers.facebook.com) enumerando o novo regime
de cobrança de outubro/2026 com granularidade de preço por categoria/país — a pesquisa
recorrente aponta para a mesma conclusão qualitativa (utility/service passam a ser cobrados)
em múltiplas fontes de prática de mercado, mas nenhuma é a página de pricing oficial citável
por URL estável. Registrado como limitação explícita, não escondida. **Isto não bloqueia o
design técnico desta rodada** (nenhuma decisão de D-1 a D-10 depende do valor exato do preço) —
bloqueia apenas a emenda de `cost-model.md` (já registrada como pendência de documentação, fora
do escopo desta rodada de design).
