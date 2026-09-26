**9.0/10** (registrada antes de rodar o Codex nesta rodada).

6 dos 8 achados corrigidos com código real, testado (167/167 testes BFF verdes, 3238/3238 suíte
completa, typecheck/lint limpos). 1 achado (rate-limiting) registrado como pendência explícita
obrigatória antes de usuário real, com a saída que o próprio Codex propôs. 1 achado (signup como
oráculo de existência) mantido por decisão consciente e documentada, também uma saída que o
próprio Codex ofereceu como aceitável. 1 achado (device-remembering) contestado com evidência
concreta (grep de zero ocorrências de ConfirmDevice, histórico de commit, um mês de uso real sem
incidente) — não 100% dirimido, registrado honestamente como tal. Não é 10 porque a tréplica do
achado 5 e a decisão do achado 6 dependem de julgamento que o Codex ainda não validou de forma
cega, e porque o fechamento total do achado 5 exigiria uma verificação empírica não feita nesta
rodada.
