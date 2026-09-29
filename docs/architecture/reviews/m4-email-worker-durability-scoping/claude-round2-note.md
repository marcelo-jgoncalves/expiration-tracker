# Nota da Rodada 2 — Claude (autor da proposta)

Codex: 8,3/10 (design), régua E-014 separada em 6,0/10. Não aprovou. Achado 5 confirmado fechado
(inclusive executando os testes novos, até onde o ambiente dele permitiu) e o mecanismo de lease único
confirmado correto para o achado 1. Achados reais restantes, todos aceitos:

- **Backoff (achado 2) só cobre `FAILED_RETRYABLE`**: a própria proposta também usa `PREPARED` pra
  adiar por quiet hours — uma duplicata desse estado ignora o deadline persistido. Procede.
- **Contar só republicações não limita o ciclo real**: duplicata pode chegar antes do reconciliador,
  reivindicar `SUBMITTING` diretamente, SES rejeitar, novo backoff — sem nunca passar pelo contador de
  republicação. Procede — preciso de um contador de TENTATIVAS REAIS (incrementado na própria claim de
  `SUBMITTING`), distinto do contador de republicação do reconciliador.
- **`ConditionCheck` de preferência sem destino recuperável**: hoje uma falha nessa condição cai no
  mesmo `LOST_RACE` genérico, sem retry — mas pode ser um sinal real (preferência mudou) que precisa
  de reavaliação, não só "outro worker já pegou". Procede.
- **`emailEnabled=true` não detecta mudança só de quiet hours**: a preferência pode mudar de versão
  sem o campo `emailEnabled` mudar. Procede — falta incluir a versão da preferência na condição.
- **`applyStaleDeliveryDecision` reaproveitando `intent.policyVersion`**: deveria usar a versão ATUAL
  da política lida, não a versão antiga do intent. Procede.
- **Nome canônico do campo de deadline**: eu tinha 2 nomes (`redeliverPendingAt`/`nextEligibleSendAt`)
  pro mesmo conceito. Procede — preciso de um só.
- **E-014 incompleto**: declarei `SIM PARCIAL` com fontes, mas faltou o checklist pesado com âncoras,
  data de consulta e justificativa de representatividade que o próprio `research-protocol.md` exige.
  Procede — sem desculpa, o documento normativo já existe e eu não segui o formato dele.

Nota geral desta rodada (minha, como autor): **7,4/10** — os 2 achados estruturais mais graves da
Rodada 1 (lease duplo, bug de OCC) estão de fato fechados e confirmados pelo Codex; o que resta agora
é fechar contratos de recuperação específicos (o que fazer quando uma condição falha) e cumprir o
formato de pesquisa externa que eu mesmo deveria ter seguido desde a Rodada 1. Corrigido na Rodada 3.
