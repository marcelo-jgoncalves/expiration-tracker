# D-328 — Rodada 5 (correções aos 3 achados reais da Rodada 4, nota Codex 8,4/10)

O Codex confirmou o fechamento dos 4 achados das Rodadas 2-3 (identidade do reenvio com 3 atores,
excesso de incrementos, falso sucesso de logout, watermark regressivo - inclusive com 3 logouts
concorrentes) e reproduziu 3 novos (2 Média, 1 Baixa). Todos corrigidos.

## R4-1 (Média) - atalho de confirmação no retry ainda ignorava expiração

Confirmado: em `setConfirmedAtWithRetry()`, `if (fresh.confirmedAt) return` rodava ANTES da
checagem de expiração contra o relógio fresco. Uma chamada duplicada de `confirmPhone()` (ex.
retry de rede) que perdesse a corrida contra outra confirmação legítima concorrente, e só
retomasse depois do TTL já ter vencido de verdade, ainda retornava sucesso sem checar isso -
deixando `confirmPhone()` prosseguir para chamar `setPhoneNumber()`/`recordOptIn()` de novo por uma
confirmação que já deveria ser tratada como expirada no momento em que ESSA chamada específica
finalmente "sucede".

**Corrigido**: a checagem de expiração movida para ANTES do atalho `if (fresh.confirmedAt) return`.
Teste novo reproduz com pausa real de I/O: uma chamada `confirmPhone()` pausa antes de escrever; uma
chamada duplicada com o mesmo código confirma de verdade; o relógio avança além do TTL; a chamada
pausada retoma e deve rejeitar, nunca re-disparar `setPhoneNumber()`. Verificado por mutação
(movida de volta para depois do atalho - o teste falha, confirmando que ele realmente depende da
ordem correta).

## R4-2 (Média) - reenvios concorrentes contornavam cooldown e regrediam `createdAt`

Confirmado: mesmo com a escrita condicionada (Rodada 3), o perdedor de uma corrida entre dois
reenvios genuinamente concorrentes ainda retentava sobrescrevendo o vencedor com seu PRÓPRIO
`now`/`code` obsoletos (já enviados, mas superados) - fazendo `createdAt` retroceder e reabrindo a
janela de cooldown para outro reenvio imediato. O Codex corretamente distingue isso do "achado 5"
já registrado (ambos os reenvios enviam mensagens reais, um efeito colateral externo que não dá para
desfazer) - o problema NOVO e corrigível é especificamente a integridade do ESTADO gravado.

**Corrigido**: se o estado fresco, após perder a corrida, mostra um `codeHash` DIFERENTE do que
existia quando este reenvio começou, um reenvio concorrente genuinamente diferente já venceu -
adota o vencedor (retorna o `expiresAt` dele) em vez de tentar sobrescrevê-lo. Uma divergência de
`codeHash` sem isso (ex. só uma tentativa errada incrementou `attemptCount` no desafio original)
continua segura para sobrescrever - é o mesmo desafio. O mesmo princípio foi aplicado ao caminho de
criação (`putIfAbsent` perdido também adota o vencedor, nunca tenta recriar). Teste novo reproduz
com pausa real de I/O: reenvio B pausa logo após sua leitura; reenvio C, genuinamente mais novo,
vence de verdade; B retoma e deve adotar o `expiresAt`/`createdAt` de C, nunca regredir. Verificado
por mutação.

## R4-3 (Baixa) - validação E.164 migrou para depois do envio real

Confirmado: a validação do formato E.164 vivia dentro de `buildWhatsAppPhoneConfirmation()`,
chamada só DEPOIS do `send()` - um telefone malformado ainda disparava uma mensagem real pelo
provider antes de falhar. O Codex nota corretamente que isto nunca foi um bypass alcançável por
HTTP (a rota real já valida via schema antes de chamar o serviço), mas é uma garantia que o próprio
serviço afirmava e não cumpria quando chamado diretamente.

**Corrigido**: validação movida para o topo de `requestConfirmation()`, antes de qualquer I/O
(mesma disciplina "falha antes de qualquer efeito colateral" que o resto do serviço já
documentava). Teste novo prova que um telefone malformado nunca chega a `provider.send()`.
Verificado por mutação.

## Nota cega (Claude), Rodada 5

Ver `round-5-claude-selfgrade.md` (arquivo separado).
