# D-315/D-316 — Revisão Adversarial (D-332)

## Status

**APROVADO** (escopo restrito: seed de `NotificationEntitlements`/`NotificationPreferences` na
criação de Organization/aceite de convite + os 3 campos aditivos de `DashboardSummary`) via
protocolo Claude↔Codex (`AGENTS.md` §4), 3 rodadas. Notas cegas: **Claude 7,8/8,6/9,2, Codex
7,0/9,0/9,1** — convergência a partir da Rodada 2 (ambos ≥9,0), confirmada na Rodada 3.

**Importante — o que esta aprovação cobre e o que não cobre**: aprova D-315 (seed de
`NotificationEntitlements`) e D-316 (3 campos aditivos de `DashboardSummary`) como originalmente
decididos, MAIS a correção de um achado real que os atravessa (`NotificationPreferences` também
nunca era seedado em nenhum onboarding real). **NÃO cobre nem fecha 3 achados estruturais reais do
worker de entrega de e-mail (M4)**, encontrados durante esta revisão mas fora do escopo de
D-315/D-316 — registrados abaixo como pendência para uma rodada de protocolo dedicada.

## Trajetória de convergência (notas cegas, sem arredondar)

| Rodada | Claude | Codex | Achado principal fechado nessa rodada |
|---|---|---|---|
| R1 | 7,8/10 | 7,0/10 | Codex não aprovou o fechamento: 6 achados reais (3 Alta, 3 Média). O mais grave, dentro do escopo desta revisão: `NotificationPreferences` nunca era seedado em NENHUM caminho real de onboarding (só via GET/PUT lazy de configurações) — um usuário novo que nunca abrisse a tela de notificações ficava com `preference.emailEnabled === undefined`, e o router falha fechado em `RETRY` infinito, o MESMO sintoma que D-315 resolveu para o entitlement, mas reaberto pelo preference. Os outros 5 (approximate nunca lido pelo `Overview.tsx`, agregação bloqueando a tabela, e 3 achados estruturais do worker M4: `DEFERRED`/quiet-hours nunca realmente reagendado — inclusive um comentário de código FALSO afirmando um mecanismo inexistente —, `FAILED_RETRYABLE` confirmado como sucesso pelo handler SQS, falta de revalidação de preferência antes do envio real) |
| R2 | 8,6/10 | 9,0/10 | Os 3 achados diretamente no escopo de D-315/D-316 corrigidos com código real + testes de mutação: `NotificationPreferences` seedado em `CreateOrganizationService` (Put, item novo) e `AcceptInvitationService` (Update com `if_not_exists()` por atributo — nunca sobrescreve uma preferência real numa reativação de Membership); `approximate` agora lido por `Overview.tsx` (sufixo "(parcial)"); agregação não bloqueia mais a tabela principal. Os 3 achados do worker M4 registrados como pendência formal (não corrigidos — decisão de proporcionalidade, sistema pré-existente não tocado por D-315/D-316), incluindo a correção do comentário FALSO sobre o EventBridge Scheduler inexistente. Codex aceitou explicitamente essa divisão de escopo — **CONVERGIDO** |
| R3 | 9,2/10 | 9,1/10 | Consolidação: os 2 achados "Baixa" da R2 corrigidos (aviso de erro do `Overview.tsx` disparando com o summary só pendente, não errado; teste de reativação reforçado para `toEqual` completo, cobrindo `locale`/`quietHours`/`version`/timestamps, não só `emailEnabled`/`consentSource`) — confirmação final, nenhuma mudança arquitetural |

## Achado real fechado nesta revisão (além do escopo original de D-315/D-316)

`NotificationPreferences` — mesma classe de bug que D-315 fechou para `NotificationEntitlements` —
nunca era seedado em nenhum onboarding real (só `getOrCreatePreferences()`, lazy, só acionado pelo
GET/PUT de configurações). Fechado em 2 pontos: `CreateOrganizationService.buildCreateEntries()`
(6º entry, owner) e `AcceptInvitationService.accept()` (novo entry, convidado — via `if_not_exists()`
para nunca sobrescrever uma preferência real numa reativação de Membership REMOVED).

## Achados estruturais registrados, NÃO corrigidos nesta revisão (pendência formal para rodada dedicada ao worker M4)

1. **`DEFERRED`/quiet hours nunca é realmente reagendado** — uma notificação diferida por quiet
   hours é removida da fila SQS permanentemente, sem nenhum reenvio real (`grep` por
   `SchedulerClient`/`CreateScheduleCommand` em todo `src/` confirma zero implementação; o
   comentário do código que afirmava o contrário foi corrigido para não mentir, mas o mecanismo
   real não foi implementado). Critério de resolução: reagendamento durável real (EventBridge
   Scheduler one-shot ou equivalente).
2. **`FAILED_RETRYABLE` confirmado como sucesso pelo handler SQS** — uma falha classificada como
   retryable (ex. throttling do SES) é persistida corretamente no `NotificationAttempt`, mas a
   mensagem SQS é removida da fila como se tivesse sucedido, sem nenhum reconciliador identificado.
   Critério de resolução: propagação real do resultado ao mecanismo de retry.
3. **Falta de revalidação de preference/entitlement/policy antes do envio real** — entre o
   roteamento e o envio efetivo pelo worker, uma revogação de consentimento não é revista. Critério
   de resolução: revalidação antes da admissão `SUBMITTING`.

Nenhum dos 3 é implementado agora — são bugs estruturais pré-existentes do worker M4 de entrega de
e-mail, não introduzidos nem agravados por D-315/D-316. Registrados como exigência EXPLÍCITA de uma
rodada de protocolo dedicada, nunca "resolver quando chegar lá" vago.

## Escopo desta decisão

Cobre D-315 (seed de `NotificationEntitlements`), D-316 (3 campos aditivos de `DashboardSummary`) e
o achado adicional de `NotificationPreferences` fechado durante esta revisão. Não cobre os 3
achados estruturais do worker M4 de entrega de e-mail listados acima — ficam registrados como
trabalho futuro, próxima rodada de protocolo dedicada a essa área.
