# Round 2 — Claude self-grade (blind, registrado antes de ver a resposta do Codex)

**Nota: 9.0/10**

## Por que subiu de 8.5 (nota da Rodada 1)
Os 3 achados bloqueantes são reais e verificados por leitura própria antes de aceitar a correção —
em particular, confirmei a sequência exata (`accept-invitation.ts` exige `GlobalUser` já existente
antes de criar `Membership`) que prova a Correção 3 fecha o gap real, não é só uma suposição
razoável. Achado interessante: eu mesmo já tinha detectado o problema do achado bloqueante #1 (a
quebra de `.trim()`) antes de ver a resposta do Codex, mas o Codex foi além ao encontrar o teste
existente que dependia do comportamento quebrado — achado que eu não tinha antecipado.

## Riscos residuais conhecidos
- Não implementei ainda a porta `MemberEligibilityResolver` sugerida (não-bloqueante) — é uma
  decisão de estrutura que só vou concretizar na implementação, não no design.
- Não verifiquei se existe algum OUTRO lugar que também lê e-mail de `UserProfile` para outro
  propósito (ex. algum outro template/notificação) que teria o mesmo gap e que eu não corrigi -
  só corrigi o `resolveRecipientEmail` específico que o Codex citou.
- A atualização do teste existente (`notification-router-workflow.test.ts:149`) ainda não foi feita
  - registrada como necessária, mas é trabalho de implementação, não de design.

## Nota
9.0 reflete confiança de que os 3 bloqueantes reais foram fechados com verificação de sequência real
(não só lógica abstrata), mas mantenho no piso do gate porque ainda não implementei nem rodei nada.
