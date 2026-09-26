**9.3/10** (registrada antes de rodar o Codex nesta rodada, e antes de escrever qualquer número
desta rodada em `NEXT_SESSION_PROMPT.md` ou em qualquer outro arquivo que o prompt da Rodada 8
instrua o Codex a ler).

R7-1 é a correção mais robusta de todas as rodadas até agora - em vez de mais um remendo pontual
(que a própria Rodada 7 provou ser o padrão que continua gerando achados), portei o avaliador
genérico já testado em batalha de outro módulo (`test/unit/reminder/in-memory-store.ts`, usado em
produção de teste desde D-300), fechando a CLASSE inteira de problema ("o dublê pode aprovar uma
condição que não entende") em vez de só o sintoma que o Codex reportou desta vez. R7-2 tem teste
novo que reproduz o TypeError exato que o Codex prognosticou, verificado por mutação. Não é mais
alta porque: (1) oitava rodada consecutiva com pelo menos um achado real - ainda não tive uma
rodada limpa nem uma vez, então não posso alegar que o padrão "sempre sobra mais um achado" vai
parar agora só porque a correção desta vez é mais estrutural; (2) R7-1 não tem uma regressão
própria isolada (dependo da suíte inteira permanecer verde como evidência indireta, não de uma
mutação pontual que prove que o avaliador genérico rejeitaria uma condição malformada específica -
poderia ter escrito um teste unitário direto para `evalCondition`/`evalClause` e optei por não, para
não introduzir escopo de teste que o módulo `reminder` original também não tem isoladamente); (3)
não posso garantir que não existe um quinto achado - o padrão histórico desta thread (5 rodadas
seguidas com exatamente 1-3 achados novos cada) não me dá base para presumir que esta é a última.
