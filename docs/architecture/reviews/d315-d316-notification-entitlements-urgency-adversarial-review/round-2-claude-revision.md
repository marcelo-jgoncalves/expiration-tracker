# D-315/D-316 — Rodada 2 (correções aplicadas aos achados reais da Rodada 1, nota Codex 7,0/10)

Verifiquei cada um dos 6 achados do Codex diretamente no código antes de decidir o que corrigir
agora vs. registrar para depois. Todos os 6 são reais (nenhum contestado) - a diferença está em
qual é proporcional a este escopo (D-315/D-316: seed de entitlement/preference + agregação do
dashboard) vs. estrutural ao worker de entrega (M4, sistema já existente e não tocado por
D-315/D-316).

## Corrigidos nesta rodada

### Achado 1 (Alta) - `NotificationPreferences` nunca provisionado em nenhum caminho real de onboarding

Confirmado por leitura direta: `notification-router-workflow.ts` lê `NotificationPreferences` via
`store.get()` puro (sem fallback de criação); a única criação real do registro era
`NotificationPreferencesService.getOrCreatePreferences()`, chamada só pelo endpoint HTTP de
configurações (GET/PUT) - o próprio comentário do serviço já dizia isso: "was previously never
called anywhere in src/... onboarding wiring for it is still a documented gap, not real code."
Confirmado também que nem `CreateOrganizationService` nem `AcceptInvitationService` seedavam esse
registro. Resultado real: um usuário novo (owner OU convidado) que nunca abriu a tela de
configurações de notificação tinha `preference.emailEnabled === undefined`, e o router
(`notification-router.ts` linha 161) falha fechado com `RETRY` infinito
(`PREFERENCE_UNAVAILABLE`) - o MESMO sintoma "lembrete nunca sai" que D-315 resolveu para o
entitlement, mas reaberto pelo preference. Isto está diretamente dentro do escopo desta revisão
(é a mesma classe de bug que D-315 existe para fechar), então foi corrigido agora, não só
registrado:

- `CreateOrganizationService.buildCreateEntries()`: 6º entry, `defaultNotificationPreferences()`
  seedado via `Put`/`attribute_not_exists(PK)` (item genuinamente novo, mesmo padrão dos outros 5
  entries) para o OWNER criador.
- `AcceptInvitationService.accept()`: novo entry via `Update` com `if_not_exists()` por atributo
  (nunca `Put`/`attribute_not_exists(PK)`) - diferente do caso acima, um convite pode REATIVAR um
  Membership REMOVED (mesmo cenário que "clears removedAt" já testava), e esse usuário pode ter
  uma `NotificationPreferences` real e já customizada por ele mesmo antes da remoção. Um `Put`
  condicionado falharia a transação inteira (bloqueando a própria reativação); um `Put`
  incondicional apagaria a escolha real do usuário. `if_not_exists()` resolve ambos: cria o
  default se ausente, nunca sobrescreve se já existir. `ConditionExpression` do próprio `Update` é
  uma tautologia (`attribute_exists(PK) OR attribute_not_exists(PK)`) porque o tipo
  `DynamoUpdateCommandInput` deste código exige o campo, mas o gating real está inteiramente nos
  `if_not_exists()` por atributo.
- Comentários corrigidos em 3 lugares que ainda descreviam isso como gap aberto:
  `notification-preferences.ts` (doc do módulo + doc de `defaultNotificationPreferences()`),
  `notification-preferences-service.ts` (doc da classe), `bff-auth-service.ts` (contagem de
  entries de 5 para 6).
- Testes novos: `create-organization.test.ts` (seed do owner), `accept-invitation.test.ts` (seed
  de convidado novo + preservação de preferência real numa reativação).

### Achado 4 (Média) - `approximate` computado mas nunca lido por `Overview.tsx`

Confirmado por leitura de `Overview.tsx`: o `attention` array usava as 3 contagens cruas, sem
nenhuma referência a `summaryQuery.data.approximate`. Corrigido: cada label ganha o sufixo
"(parcial)" quando `approximate === true`, cobrindo as 3 métricas uniformemente (uma quebra por
métrica exigiria rastrear `scanLimitReached` por sub-busca no `DashboardService` - fora de
proporção para esta correção, registrado na Rodada 1 achado 3 como aceitável). Teste novo:
`marks the attention counts as partial when the aggregate hit its page cap`.

### Achado 5 (Média) - agregação bloqueando a tabela principal

Confirmado por leitura: `if (query.isPending || summaryQuery.isPending)` incluía a query
secundária no MESMO gate da tabela principal, contradizendo o próprio comentário do arquivo
("nunca bloqueando a tabela principal"). Corrigido: o gate de loading agora depende só de
`query.isPending`; `summaryQuery` pendente ou com erro convergem para o mesmo fallback
(`attention` undefined → `InlineNotice`), que já existia e já era testado para o caso de erro.
Teste novo: `renders the items table before the summary aggregate resolves, never blocking on it`
(usa uma Promise controlada manualmente para provar que a tabela aparece ANTES do summary
resolver).

## Registrados, não corrigidos nesta rodada (fora de proporção - sistema M4 pré-existente, não tocado por D-315/D-316)

### Achado 2 (Alta) - `DEFERRED`/quiet hours nunca é realmente reagendado

Verifiquei e confirmei: o comentário em `email-delivery-handler.ts` afirma "o router já agendou um
reenvio via EventBridge Scheduler one-shot (design §5.3)", mas `grep` por
`SchedulerClient`/`CreateScheduleCommand`/`@aws-sdk/client-scheduler` em todo `src/` não encontra
NADA - esse mecanismo nunca foi implementado, só desenhado. Uma notificação diferida por quiet
hours é removida da fila (SQS batch success) e nunca mais processada - perda silenciosa e
permanente, não um atraso. **Achado real, comentário do código está FALSO** (não só desatualizado
- afirma algo que nunca existiu). Não corrigido agora: implementar o reagendamento real exige
decisão de design (EventBridge Scheduler one-shot vs. requeue com delay vs. outro mecanismo) fora
do escopo de D-315/D-316 (que são sobre entitlement/preference/dashboard, não sobre a máquina de
estados do worker de entrega). Registrado como pendência CRÍTICA para uma rodada de protocolo
dedicada ao worker de e-mail (M4).

### Achado 3 (Alta) - `FAILED_RETRYABLE` confirmado como sucesso pelo handler SQS

Confirmado: `decideSendAction()`/`nextStatusAfterSendAttempt()` classificam corretamente, mas
`email-delivery-handler.ts` não adiciona a mensagem a `batchItemFailures` quando o outcome é
`FAILED_RETRYABLE` - só quando uma exceção é lançada. Uma falha classificada como retryable (ex.
throttling do SES) fica persistida como `FAILED_RETRYABLE` no `NotificationAttempt`, mas a mensagem
SQS é removida da fila como se tivesse sucedido, e nenhum reconciliador identificado retoma esse
estado. Mesma categoria de "perda silenciosa" do Achado 2. Registrado, não corrigido - mesmo
raciocínio de proporcionalidade (bug estrutural do worker M4, não do escopo D-315/D-316).

### Achado 6 (Média) - entrega não revalida preference/entitlement/policy antes do envio real

Confirmado: entre o roteamento (que lê preference/entitlement) e o envio real pelo worker, um PUT
de preferências revogando consentimento não é revisto - o worker só relê item e elegibilidade do
destinatário. Registrado, não corrigido - mesma razão de proporcionalidade.

## Nota cega (Claude), Rodada 2

Ver `round-2-claude-selfgrade.md` (arquivo separado).
