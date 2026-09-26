# D-328 — Rodada 6 (correção ao residual R5-1, nota Codex 9,0/10 na Rodada 5)

A Rodada 5 fechou R4-1/R4-2/R4-3 (nota Codex 9,0), mas achou um residual de severidade Baixa
(R5-1) e registrou um incidente de processo: a nota cega ficou comprometida porque
`NEXT_SESSION_PROMPT.md`, lido como parte do início de sessão padrão (`AGENTS.md` §2), expunha a
auto-nota do Claude ("Rodada 5 ... auto-nota 9,0") antes de o Codex formar seu próprio parecer.
Ambos os pontos são endereçados nesta rodada.

## Incidente de processo — nota cega comprometida

**O que aconteceu**: o handoff de sessão (`NEXT_SESSION_PROMPT.md`, item 26) registrava
"Rodada 5 (..., auto-nota 9,0)" em texto corrido — informação de estado legítima para retomar a
sessão, mas que também é exatamente o dado que a nota cega do protocolo (`AGENTS.md` §4) existe
para esconder do avaliador que responde depois. O prompt da Rodada 5 instruía o Codex a não abrir
`round-5-claude-selfgrade.md`, mas nunca previu que o número já estaria em outro arquivo que o
início de sessão padrão manda ler.

**Correção de processo, não só de nota**: daqui em diante, ao registrar uma rodada do protocolo
ainda em curso em `NEXT_SESSION_PROMPT.md` (ou em qualquer texto que uma sessão leia por rotina
antes de rodar a rodada seguinte), a entrada nunca inclui o valor numérico da autoavaliação —
"rodada N em andamento, aguardando avaliação cega do Codex" é suficiente; o número entra no
handoff só depois que ambas as notas de uma rodada já estão registradas. Esta rodada (6) segue essa
disciplina: a auto-nota abaixo não foi escrita em nenhum lugar que o prompt da Rodada 6 instrui o
Codex a ler, e `NEXT_SESSION_PROMPT.md` não é citado na lista de leitura do prompt desta rodada.

Isso não invalida a nota técnica 9,0 da Rodada 5 em si — o Codex documentou que a leitura anterior
do handoff não mudou seu julgamento técnico, só o classificou corretamente como não-estritamente-
cego. Mas, combinado com "R4=8,4 e R5=9,0 não são duas rodadas consecutivas ≥9,0" (exigência
textual do próprio protocolo), a Rodada 5 não fecha D-328 nem com nota alta — regride para reabrir
por ambos os motivos: convergência formal pendente E nota cega a refazer.

## R5-1 (Baixa) — `codeHash` como proxy de identidade de geração do desafio

Confirmado. As 3 checagens de "isto ainda é o mesmo desafio ou já houve uma escrita concorrente
genuína?" (`requestConfirmation()`'s retry loop, `incrementAttemptCountWithRetry()`,
`setConfirmedAtWithRetry()`) comparavam `fresh.codeHash !== initial.codeHash`. `codeHash` é
HMAC(pepper, código-de-6-dígitos) — dois reenvios genuinamente diferentes que por acaso sorteiam o
MESMO código (1/1.000.000 por sorteio, ainda assim alcançável sob corrida real e repetida) produzem
o MESMO hash, então o perdedor da corrida via `fresh.codeHash === initial.codeHash` e concluía
(incorretamente) que nada tinha mudado — sobrescrevendo o vencedor genuíno, regredindo `createdAt`
e reabrindo a janela de cooldown.

**Corrigido**: novo campo `challengeId` (UUID, um por geração, nunca reiniciado, gerado por
`this.newId()` em `requestConfirmation()`) substitui `codeHash` nas 3 comparações de identidade de
geração — `codeHash` continua existindo e sendo usado exclusivamente para verificar o código em si
(`whatsAppConfirmationCodeMatches()`), nunca mais para decidir "é a mesma geração?". `version`
sozinho não serve para essa distinção (também sobe em tentativas erradas e confirmação, não só em
reenvios — mesmo raciocínio que já descartava usá-lo isolado antes desta rodada).

Teste novo (`test/unit/notification/whatsapp-phone-confirmation-service.test.ts`, "a resend that
coincidentally draws the SAME 6-digit code...") força esse exato colapso: mocka `crypto.randomInt`
(via `syncBuiltinESMExports()`, mesma técnica que os repros do próprio Codex usaram nas Rodadas 3-4)
para que o desafio inicial e o reenvio C genuinamente mais novo sorteiem o MESMO código de 6
dígitos, enquanto B (pausado, código diferente) perde a corrida. **Verificado por mutação**: revertida
temporariamente a comparação de `challengeId` para `codeHash` na checagem do retry loop de
`requestConfirmation()`, o teste falha exatamente como esperado (B sobrescreve C, `createdAt`
regride) — restaurada em seguida.

## Julgamento sobre o "perdedor" (pergunta em aberto da Rodada 5)

Mantida a resposta da Rodada 5: aceitável preservar apenas o desafio vencedor (quem persiste
primeiro, não necessariamente a mensagem mais recente enviada) dentro da limitação já registrada de
envio duplo (achado 5, rodadas anteriores) — não redesenhar o envio nesta rodada só para tratar essa
semântica de forma diferente. Nenhuma mudança de comportamento nesta rodada além do fix de R5-1.

## Evidência

- `npm run typecheck` / `npm run lint` / `npm run check-boundaries` / `npm run check-docs`: limpos.
- `npx vitest run test/unit/notification test/contract`: 484/484 (era 483, +1 teste novo).
- Teste novo verificado por mutação (ver acima).

DoD: item=D-328 Rodada 6 (fix R5-1 + correção de processo de nota cega); risco=nível 4-5
(concorrência/integridade de estado num fluxo de segurança, sem mudança de contrato de API);
evidência=484/484 vitest + typecheck/lint/boundaries/docs limpos + teste novo verificado por
mutação; lacunas=nenhuma conhecida; D-328 permanece em protocolo até 2 rodadas consecutivas ≥9,0
genuinamente cegas.
