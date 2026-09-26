**8.7/10** (registrada antes de rodar o Codex nesta rodada).

Os 5 achados desta rodada foram genuinamente sérios (2 Alta - identidade da condição OCC e replay
de código expirado - eram bugs de segurança reais, não só estilo) e corrigidos com uma mudança de
design real (version monotônico em vez de reset), não só patches pontuais. Verifiquei por mutação
que o teste do achado 1 realmente falha sem a correção. Não é mais alta porque: (1) esta é a
TERCEIRA rodada consecutiva em que o Codex encontra um problema real na minha correção anterior
para esta mesma área de concorrência - um padrão que sugere que posso não ter esgotado a superfície
de interleaving ainda, mesmo depois de pensar cuidadosamente; (2) os testes de retry (`logoutAll`,
`incrementAttemptCountWithRetry`) usam monkey-patching de `get()` para simular interleaving, uma
técnica que funciona mas é menos direta que um teste de concorrência genuína - o Codex já
criticou testes "não genuinamente concorrentes" uma vez, pode julgar que ainda não é suficiente.
