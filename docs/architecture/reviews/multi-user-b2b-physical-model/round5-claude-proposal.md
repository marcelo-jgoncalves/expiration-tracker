# Multi-User B2B — Physical Model, Wave B2B-1 (Rodada 5, proposta Claude)

Rodada 4: Codex 9,4/10 (≥9,0), Claude autograde 8,6/10 — achado real, não novo mas nunca fechado: Codex já tinha marcado §121 Q13 como "Parcial" na Rodada 1 ("token pointer bom, falta explicitar e-mail verificado/igualdade no design físico") e as Rodadas 2-4, focadas em corrigir a mecânica de `Membership`, nunca voltaram a esse item. Só o delta é registrado — `round1`-`round4` continuam valendo no resto.

## Achado (autograde Claude, fechando um item que ficou aberto desde a Rodada 1): aceite de convite não amarra e-mail verificado do chamador dentro da própria transação

§21 do roadmap exige explicitamente: `e-mail verificado → e-mail == invitation.email → TransactWrite`. O design das Rodadas 2-4 corrigiu a mecânica de upsert de `Membership` mas deixou a verificação de igualdade de e-mail como checagem de aplicação ANTES da transação, não uma condição estrutural DENTRO dela — um bug de aplicação (esqueceu o pre-check numa rota nova, por exemplo) aceitaria um convite com qualquer usuário autenticado, não só o dono do e-mail convidado. Isso é exatamente a classe de achado que §121 Q13 pede como defesa em profundidade, não só validação de camada superior.

## Correção — condição de igualdade de e-mail dentro da própria `TransactWriteItems`

```text
TransactWriteItems:
  Update Membership { ... (inalterado da Rodada 3/4) ... }
  Update Invitation { SET #status = :ACCEPTED, acceptedAt = :now }
                     ConditionExpression: #status = :PENDING AND emailNormalized = :callerVerifiedEmail
  Delete InvitationDedupPointer
```

`:callerVerifiedEmail` é o `emailNormalized` do `User` global do chamador (já autenticado via Cognito, e-mail verificado é pré-requisito de login — mesma garantia que o resto do sistema já assume para `UserProfile.emailNormalized` hoje). Se o e-mail não bater, a condição falha e a transação inteira cancela — nenhuma `Membership` é criada mesmo que o `Update Membership` isoladamente seria bem-sucedido, porque é a MESMA transação atômica. Isso move a defesa de "checagem de aplicação, esperança de que ninguém esqueça" para "invariante estrutural que o próprio banco garante", fechando Q13 de verdade em vez de deixá-la como validação de camada de aplicação não reforçada no schema.

## Fechamento

Com este achado corrigido, não há achado real pendente de nenhuma rodada anterior (1-4) que não tenha sido fechado — Q13 era o único item de §121 marcado como parcial que nunca tinha sido revisitado.
