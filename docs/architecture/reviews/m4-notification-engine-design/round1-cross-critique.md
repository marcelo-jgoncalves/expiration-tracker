# M4 — Rodada 1 de crítica cruzada (Claude vs. Codex, propostas independentes)

Protocolo `AGENTS.md` §4. Propostas: `docs/architecture/m4-notification-engine-design.md` (Claude) e `docs/architecture/reviews/m4-notification-engine-design/codex-proposal-round1.md` (Codex, produzida às cegas, sem ler a de Claude).

## Veredito geral

A proposta do Codex é estruturalmente mais rigorosa e deve ser a base convergida. Pontos concretos onde ela corrige um erro real ou lacuna da proposta de Claude:

1. **Destinatário lógico não existia na proposta de Claude** — Claude presumiu implicitamente que o intent já sabe "para quem" enviar. Codex introduz `NotificationRecipientResolver` (porta) com fallback explícito `assigneeUserId ?? tenantId`, documentado como muito específico do MVP (`tenantId=userId`) e isolado atrás de porta para não travar a futura organização multiusuário. **Claude aceita esta correção.**
2. **Mecanismo de quiet hours de Claude está tecnicamente errado**: Claude propôs `changeMessageVisibility` para adiar entrega — mas SQS tem teto de 12h de visibility timeout, e o worker precisaria ficar "esperando" ativamente, o que não é como `changeMessageVisibility` funciona (é uma extensão de invisibilidade, não um agendamento). Codex propõe EventBridge Scheduler one-shot com nome determinístico (`notification-email-<hash(tenantId|intentId|channel)>`, idempotente por nome) — correto e mais alinhado ao padrão já usado no producer do M3. **Claude aceita esta correção**, com a ressalva que o próprio Codex já registrou como item aberto (#3): custo/escala de criar um schedule efêmero por mensagem adiada precisa validação a volume real.
3. **Modelagem de ambiguidade no envio SES é mais completa no Codex**: Claude apenas mencionou "risco residual" sem estado dedicado. Codex introduz `SUBMITTING`/`UNKNOWN`/`NOT_SENT_STALE` como estados de primeira classe da `NotificationAttempt`, com regra explícita "duplicata que encontra `SUBMITTING` com lease expirado não chama SES de novo — marca `UNKNOWN`". Isso é estritamente melhor: torna o risco auditável e operável (alarme de idade/contagem de `UNKNOWN`) em vez de só documentado em prosa. **Claude aceita.**
4. **Matriz fail-closed/fail-open explícita por condição** (seção 5.2 do Codex) é mais auditável que a lista corrida de 4 checagens de Claude — cobre casos que Claude não tratou: falha técnica de storage de entitlement (deve ser fail-closed **com retry**, não virar cancelamento silencioso), timezone/quiet-hours inválido (fail-closed com alarme, nunca assumir "pode enviar"). **Claude aceita.**
5. **Correlação de callback via tags SES como fonte primária**, com `providerMessageId`/GSI5 como fallback tenant-scoped, é mais robusta que a proposta de Claude (que deixava a correlação como "a decidir na revisão"). Codex também resolve corretamente o callback chegando **antes** do `MessageId` ser persistido localmente (tentativa ainda `SUBMITTING`/`UNKNOWN`) — cenário que a proposta de Claude não cobria. **Claude aceita.**
6. **Transições monotônicas do status do attempt** (`COMPLAINED > BOUNCED > DELIVERED > ACCEPTED > SUBMITTING`, nunca regride) e a decisão de que complaint gera supressão local durável — ausente na proposta de Claude. **Claude aceita.**
7. **Separação entitlement (permissão de canal) vs. quota (consumo)** com quota resolvida no delivery worker (não no router) — mais preciso que a proposta de Claude, que tratava os dois como uma única checagem no router. **Claude aceita.**

## Onde Claude discorda ou pede ajuste

- **Item aberto #1 do Codex (preferências ausentes = fail-closed com "cancelar ou DLQ conforme causa")** é vago demais para ir a implementação: se todo usuário novo não tem `NotificationPreferences` até tocar em configurações, e a ausência é fail-closed, **nenhum reminder por e-mail seria enviado a usuário nenhum** até ele configurar preferências manualmente — isso provavelmente quebra o próprio exit criterion do milestone ("notificação de teste rastreável do occurrence ao callback"). Isso não é uma lacuna de engenharia — é uma decisão de produto/consentimento (default opt-in vs. opt-out, tratamento de e-mail de reminder como transacional ou não) que precisa ser resolvida por Marcelo antes da rodada 2, não deixada como "item aberto" indefinidamente.
- **Item aberto #2 (destinatário do MVP)** — mesma categoria: `assigneeUserId ?? tenantId` é uma regra de produto, não só técnica.
- **Item aberto #10 (complaint/bounce sempre desabilita e-mail automaticamente?)** — decisão de política, com implicação de compliance (CAN-SPAM/LGPD) que também deveria ser fechada antes de codar, não durante.

Claude concorda com os demais itens abertos do Codex (#3, #4, #5, #6, #7, #8, #9, #11, #12) como follow-up técnico legítimo de rodada 2, não bloqueantes de decisão de produto.

## Próximo passo

Convergir os dois documentos num único `docs/architecture/m4-notification-engine-design.md` (rodada 2) adotando a proposta do Codex como base, com as 3 decisões de produto acima resolvidas por Marcelo antes da nota cega formal de rodada 2.
