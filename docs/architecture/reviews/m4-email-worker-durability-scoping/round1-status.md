# M4 Email Delivery Worker durability (item 27) — Rodada 1 concluída, item continua ABERTO

Nota do Codex (crítica cega, design apenas): **6,8/10**. Não aprovado, corretamente — a proposta
inicial (`claude-round1-proposal.md`) tinha lacunas reais, não estilísticas. Ver
`codex-round1-output.txt` para o texto completo.

## Achados reais da Rodada 1 (Codex), a corrigir antes de qualquer Rodada 2

1. **Alta** — o segundo lease (reconciliador) pode invalidar a persistência de um envio real em
   andamento: se o lease de redelivery expirar enquanto o consumidor original ainda está com
   `SUBMITTING` em voo, o reconciliador reescreve o ponteiro, e o `forceUpdateAttemptStatus()` do
   consumidor original falha condicionalmente e ENGOLE o conflito, retornando sucesso ao chamador
   mesmo com o SES já tendo aceitado o envio (`email-delivery-workflow.ts:235`). Falta transferência
   de responsabilidade atômica entre os dois leases.
2. **Alta** — o backoff proposto não é reforçado no ponto de decisão de envio: `decideSendAction()`
   permite envio imediato para qualquer `FAILED_RETRYABLE` (`email-delivery.ts:28`); uma cópia
   duplicada da mensagem original (comportamento esperado de SQS Standard) tem o `deliverNotBefore`
   ANTIGO já vencido e furaria o backoff por completo.
3. **Alta** — a revalidação proposta esqueceu `ReminderPolicy.enabled=false` (desativação real de
   política, `reminder-policy-service.ts:258`) — o router revalida isso (`notification-router.ts:128`)
   mas o delivery worker nunca revalida. Cenário: roteamento → quiet hours → usuário desativa a
   política → reconciliador reenvia → e-mail sai mesmo assim.
4. **Alta** — `getOrCreatePreferences()` é a ferramenta errada para revalidação (exige
   `RequestContext`, autoriza `notification:configure`, e CRIA `emailEnabled:true` quando ausente —
   inverteria a semântica de "preferência ausente = retry", não "opt-out"). A checagem correta
   precisa ser uma condição na PRÓPRIA transação de admissão `SUBMITTING`, não uma leitura solta
   antes dela (senão a corrida de revogação-concorrente continua existindo mesmo com leitura
   fortemente consistente).
5. **Alta, achado PRÉ-EXISTENTE e independente da proposta, mas que a invalida se não corrigido
   primeiro** — `RECONCILE_UNKNOWN` (`email-delivery-workflow.ts:84`) usa `store.update()`, cujo
   adapter (`dynamodb-notification-store.ts:50`) faz `PutCommand` SEM condição — uma execução que
   leu `SUBMITTING` expirado pode sobrescrever um `ACCEPTED`/`DELIVERED` já persistido depois.
   Nenhum mecanismo novo de fencing sobrevive em cima dessa fundação sem OCC real aqui primeiro.
6. **Média** — contrato de recuperação/encerramento incompleto: (a) o retorno `DEFERRED` hoje
   acontece ANTES de carregar `lookup`/`attempt` (não existe "a mesma leitura" que a proposta
   assumiu); (b) `NotificationAttempt` não carrega `locale`/`deliverNotBefore` — o reconciliador
   precisa de uma fonte real para reconstruir o comando, não pode depender da mensagem original já
   removida; (c) `STUCK` não é um `NotificationAttemptStatus` existente — precisa virar estado
   operacional definido (motivo persistido, alarme, procedimento de recuperação), não só um teto.
7. **Processo** — faltou a declaração obrigatória de pesquisa externa (E-014, `AGENTS.md` §4). O
   próprio Codex já registra `SIM PARCIAL` como avaliação (padrão de reconciliação/backoff interno é
   local; duplicação/at-least-once/fronteira de efeito externo dependem de contrato AWS — já citado
   via `docs.aws.amazon.com` nesta rodada).

**Resposta à pergunta em aberto sobre entitlement**: `NotificationEntitlements` de fato distingue
permissão de canal de quota (não é só cap de criação, como eu assumi) — mas nenhum fluxo real de
revogação pós-roteamento existe hoje. Codex não bloquearia a correção por isso; postergar a
revalidação de entitlement é defensável (gatilho: quando um writer de revogação/downgrade real for
introduzido), mas **política (achado 3 acima) não pode ser postergada — já existe desativação real**.

**Mecanismo alternativo sugerido pelo Codex**: dispensar o segundo lease — uma única transação OCC
consome o ponteiro pendente E cria o outbox atomicamente; `SUBMITTING` continua sendo o único claim
real do efeito externo (SES). Evita 2 leases competindo pela mesma versão. Não aprova o
espelhamento literal de `DocumentPurgeWorker` (deletar um objeto S3 é idempotente por natureza;
enviar um e-mail não é).

## Decisão desta sessão: NÃO forçar uma Rodada 2 apressada

Dado o volume e a profundidade real dos achados (5 de severidade Alta, um deles expondo um bug
PRÉ-EXISTENTE que precisa de correção própria antes de qualquer mecanismo novo), revisar a proposta
com o cuidado que a rodada exige tomaria mais tempo/atenção do que o razoável para fechar nesta
mesma sessão sem risco real de introduzir uma nova falha sutil num sistema de entrega de
notificação. **Item 27 permanece ABERTO, Rodada 1 completa, Rodada 2 (revisão da proposta) fica
para uma sessão futura dedicada** — não é bloqueio por decisão de Marcelo, é julgamento de que este
mecanismo merece atenção plena, não uma correção às pressas no meio de outras 2 frentes de trabalho
desta sessão (item 30 e a auditoria de segurança round3).
