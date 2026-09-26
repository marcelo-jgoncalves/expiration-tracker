**9.0/10** (registrada antes de rodar o Codex nesta rodada).

Os 3 achados desta rodada (2 Média, 1 Baixa) são de severidade menor que os das rodadas anteriores
(Alta), e o Codex confirmou explicitamente que os 4 achados de segurança/integridade mais graves
(identidade do reenvio com 3 atores, orçamento de tentativas, falso sucesso de logout, watermark
regressivo) já estavam genuinamente fechados, inclusive sob reproduções adicionais próprias (3
logouts concorrentes). Cada correção desta rodada tem um teste que reproduz o cenário exato e foi
verificado por mutação. Não é mais alta porque: (1) esta é a QUINTA rodada consecutiva com pelo
menos um achado real - mesmo que a severidade esteja convergindo para baixo, ainda não tenho uma
rodada de confirmação limpa; (2) a correção de R4-2 (adotar o vencedor em vez de sobrescrever)
introduz uma nova decisão de produto sutil (o "perdedor" de um reenvio nunca mais tem seu próprio
código funcionando, mesmo que tenha sido enviado de verdade) que não foi explicitamente validada
com o Codex antes de implementar - ele pode considerar isso uma troca aceitável ou pode achar que
merece tratamento explícito (ex. um aviso ao usuário).
