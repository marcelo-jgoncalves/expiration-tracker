# Full-audit round3 — eixo Segurança — Blocos 4-5 (retomados 2026-09-29)

Bloco 4 (WhatsApp phone confirmation, D-328) estava bloqueado na Rodada 3 original por trabalho não
commitado de outra sessão tocando os mesmos arquivos — desbloqueado desde então (D-328 fechou
formalmente, 9 rodadas próprias de revisão adversarial, convergência 9,3/9,5). Bloco 5 (Notification
Entitlements/endpoint de urgência, D-332) tinha revisão funcional própria, mas nunca sob lente de
segurança-adversarial dedicada (IDOR/rate-limit/vazamento entre tenants).

## Bloco 4 — WhatsApp phone confirmation (`whatsapp-phone-confirmation-service.ts`)

D-328 já cobriu exaustivamente (9 rodadas) a classe de bugs de concorrência/OCC (fencing de
`challengeId`, orçamento de tentativas sob corrida, TTL assíncrono). Esta passagem focou em ângulos
de segurança-adversarial que aquela revisão não tinha como objetivo central:

- **IDOR**: `whatsAppPhoneConfirmationKey(tenantId, userId, phoneE164)` é sempre construída a partir
  de `ctx.tenant.tenantId`/`ctx.principal.userId` (RequestContext confiável, nunca de parâmetro do
  chamador) — um usuário só pode operar sobre a PRÓPRIA linha de confirmação, nunca a de outro
  usuário/tenant. **Sem achado.**
- **Timing attack**: comparação de código usa `timingSafeEqual` (confirmado no domínio,
  `whatsAppConfirmationCodeMatches`), nunca `===` raso. **Sem achado.**
- **Validação de entrada**: `phoneE164` validado via `isValidE164()` antes de qualquer I/O
  (achado da própria D-332, já corrigido). **Sem achado novo.**
- **Rate limiting — achado real, novo**: o cooldown de 60s (`WHATSAPP_PHONE_CONFIRMATION_RESEND_
  COOLDOWN_SECONDS`) é escopado por `(tenantId, userId, phoneE164)` — o próprio comentário do domínio
  já nomeia o motivo exato ("sem isso, um usuário autenticado poderia disparar envios reais de
  WhatsApp repetidamente pra um número de terceiro arbitrário"). **Mas esse cooldown só limita UMA
  conta específica contra UM número específico** — nada impede que N contas DIFERENTES (inclusive
  N tenants diferentes, de auto-cadastro gratuito) disparem, cada uma, 1 envio/minuto para o MESMO
  número-alvo de terceiro, sem nenhum teto agregado por número de destino. Isso é um vetor real de
  "OTP bombing"/spam usando esta aplicação como retransmissor gratuito contra um número arbitrário,
  uma vez que o canal seja habilitado. **Risco real hoje: zero** — `isWhatsAppChannelEnabled()`
  retorna `false` em todos os ambientes (E-019 ainda não liberou o canal), então nenhum envio real
  acontece por este caminho em nenhuma circunstância atual. Registrado como requisito de pré-lançamento
  (mesma categoria de SEC-R2-05/rate-limit de login, D-329) — mitigação futura proporcional: um limite
  agregado por `phoneE164` (independente de tenant/usuário), no mesmo estilo de
  `whatsapp-portfolio-quota.ts` (já existe um mecanismo de janela rolante por número no projeto,
  reaproveitável em vez de inventado).

## Bloco 5 — `GET /dashboard/summary` (`DashboardService.getSummary`, D-316)

- **IDOR/vazamento entre tenants**: `tenantId = ctx.tenant.tenantId` (nunca de parâmetro do
  chamador) — todas as 5 leituras agregadas (`fetchRequirementsByStatus`×4, `fetchActiveItems`) são
  escopadas a esse único `tenantId`. O endpoint não aceita NENHUM identificador vindo do chamador
  (sem `itemId`/`subjectId`/paginação por chave) — não há superfície para um IDOR clássico aqui.
  **Sem achado.**
- **Rate limiting**: endpoint de leitura agregada, sem efeito colateral, mesmo padrão de qualquer
  outro `GET` autenticado do app — não exigido pelos critérios já calibrados (`joint-review-
  criteria.md`) para esta classe de rota. **Sem achado.**
- **Autorização**: 2 ações checadas explicitamente (`docarchive:requirement-read` +
  `item:read`) cobrindo os 2 tipos de entidade agregados, em vez de confiar numa ação só para as
  duas superfícies — desenho correto, já intencional. **Sem achado.**

## Veredito

Bloco 4: **1 achado real, novo, registrado como requisito de pré-lançamento** (rate limit agregado
por número de destino, gatilho: quando E-019 liberar o canal). Bloco 5: **sem achado**. Nenhuma
correção de código nesta rodada — o achado do Bloco 4 não é exploitável hoje (canal desligado em
todos os ambientes) e a mitigação (quota por número, reaproveitando o mecanismo já existente de
`whatsapp-portfolio-quota.ts`) é trabalho de implementação, não uma correção mecânica imediata.

**Round3 do eixo Segurança agora está completo** (Blocos 1-5, ver `claude-scope-and-findings.md`/
`reconciliation-summary.md` para 1-3). SEC-R2-01 (IAM residual) e SEC-R2-05 (confirmação de
assinatura SNS) continuam pendentes de decisão/ação de Marcelo, não são engenharia pendente.
