# Round 3 — Claude self-grade (blind, registrado antes de ver a resposta do Codex)

**Nota: 9.2/10**

Os 2 achados são reais e verificados por leitura direta antes de propor a correção (confirmei
`fetchDashboard`/`items.ts` realmente não aceita `signal` antes de escrever o código de exemplo, em
vez de assumir). O Provider único fecha a preocupação que eu mesmo levantei na Rodada 2 sem esperar
o Codex confirmar — sinal de que a auto-avaliação está calibrada, não só reagindo.

Não é 9.5+ porque ainda é design, não código rodando — a prova real de que `cancelQueries()` +
`signal` propagado realmente abortam um fetch em voo só vem com um teste real (provavelmente
`vi.fn()` capturando o `AbortSignal` recebido, ou um teste de integração com um `fetch` fake que
nunca resolve até ser abortado) na fase de implementação.
