**8.9/10** (registrada antes de rodar o Codex nesta rodada).

Pela primeira vez desde a Rodada 1, cada um dos 5 achados foi corrigido com um teste que reproduz
o MESMO interleaving real que o Codex demonstrou (pausas reais de I/O, não simulação síncrona
onde aplicável), e cada correção foi verificada por mutação antes de submeter (revertida
temporariamente, confirmado que o teste falha exatamente como esperado - inclusive reproduzindo o
número exato `attemptCount=9` que o Codex reportou -, depois restaurada). Não é mais alta porque:
(1) esta é a QUARTA rodada consecutiva de achados reais nesta mesma área de concorrência - mesmo
com testes agora genuinamente robustos, a taxa histórica de "mais um achado por rodada" nas 3
rodadas anteriores me deixa incerto se esgotei a superfície; (2) não investiguei se existem OUTRAS
combinações de interleaving de 3+ atores (ex. dois reenvios concorrentes entre si, não só reenvio
vs. confirmação) que ainda não foram exploradas.
