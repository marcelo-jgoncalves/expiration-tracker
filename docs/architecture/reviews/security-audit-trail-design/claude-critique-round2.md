---
status: draft
owner: engineering
authority: evidence
---

# Crítica Claude (rodada 2) da proposta Codex — trilha de auditoria de segurança

## Avaliação geral

A proposta do Codex é superior à minha em vários pontos concretos:

1. **Taxonomia fechada de 3 eventos** (`security.authorization_denied`,
   `security.global_index_access`, `security.global_index_access_denied`) em vez do meu
   `securityEvent()` genérico com `Record<string, unknown>` — evita virar canal acidental de
   PII/segredo, e dá contrato testável.
2. **Call sites corretos e verificados**: os 4 handlers HTTP que já fazem
   `instanceof AuthorizationDeniedError` (confirmei via grep: `item-handlers.ts`,
   `policy-handlers.ts`, `preferences-handlers.ts`, `test-route-handler.ts`) — minha ideia de
   "um catch central em `http-adapter.ts`" estava errada, esse catch central não existe, é
   por-handler.
2. **Evento de sucesso de GSI, não só negação** — eu só cobri o caso de negação; Codex cobre
   também o uso normal (privilegiado) como trilha positiva, com `pageCount`/`resultCount`,
   proporcional (um evento por chamada lógica, não por página).
3. **Achado real que eu não vi**: `outbox-sweeper-handler.ts` não chama `runWithContext` hoje —
   sem isso, os eventos de GSI6 do sweeper não têm `correlationId` real. Confirmar e corrigir
   isso faz parte da entrega, não é oportunista.
4. **Alarmes calibrados com anti-alert-fatigue explícito** (`SecurityAuthorizationTenantBoundaryDenied`
   limiar 1, `SecurityAuthorizationDeniedBurst` limiar 5, `SecurityGlobalIndexAccessDenied`
   limiar 1, e volume-anomaly deliberadamente sem limiar fixo na primeira entrega — observar
   baseline antes de alarmar) — mais maduro que a minha proposta genérica de "um alarme".
5. **Checklist de evidência de fechamento** (testes unitários de formato/redação, teste de
   1-evento-por-negação, teste de 1-evento-por-chamada-paginada, teste de `AccessDeniedException`
   sintético, `terraform test`, exercício real em `dev` com `OK→ALARM→OK`) — mesmo padrão de
   rigor já usado em M5/rollback entrega 1 nesta sessão.

## Aceito a proposta do Codex como base, sem ajustes bloqueantes

Diferente da rodada de rollback (onde tive 3 ajustes reais), não encontro um gap real na
proposta do Codex que precise de reconciliação — ela já cobre corretamente os pontos que eu
tinha deixado vagos (call sites exatos, taxonomia fechada, tratamento do sweeper). Duas
observações menores, não bloqueantes, que ofereço como input para o desenho final:

1. **Escopo desta sessão**: dado o tamanho da entrega (4 handlers HTTP + 3 adapters de
   persistência + módulo Terraform novo + fix do sweeper + suíte de testes), sugiro que o
   desenho final seja explícito sobre o que é "MVP mínimo fechável nesta sessão" vs. o que pode
   ficar para uma entrega 2 (ex.: o alarme de volume-anomaly, que o próprio Codex já disse
   depender de observar baseline real em `dev` antes de calibrar limiar — isso não pode ser
   fechado nesta sessão mesmo que o código exista, porque não há baseline real ainda).
2. **Nome do módulo compartilhado**: `src/shared/observability/security-audit.ts` é um bom
   nome, sem objeção — só confirmar que fica ao lado de `logger.ts`/`context.ts`/`redactor.ts`,
   não dentro de um módulo de domínio específico (é transversal a identity/reminder/outbox).

## Nota

Minha nota para a proposta original do Codex: **9.3/10** — bate o gate sem necessidade de mais
uma rodada de desenho. Peço que o desenho final reconciliado apenas explicite a divisão MVP
desta sessão vs. entrega futura (ponto 1 acima), e então está pronto para eu implementar.
