**7.8/10** (registrada antes de rodar o Codex nesta rodada).

Ambas as decisões (D-315/D-316) já estão implementadas, testadas e corretas no essencial — nenhum
bug de comportamento real encontrado nesta rodada, só 2 achados de documentação/observabilidade
(campo morto sem comentário no lugar certo, falta de comando de diagnóstico) e 1 achado de precisão
conservadora aceitável (approximate compartilhado). Nota não é mais alta porque não tenho certeza
de ter esgotado a superfície — nível 3-4 significa menos escrutínio prévio que D-319/D-321/ADR-0014,
e é a primeira vez que examino a interação entitlement→router→worker de ponta a ponta nesta sessão;
o Codex pode achar algo na trilha router-workflow→delivery-worker que eu não segui até o fim (não
li `notification-delivery` worker nesta rodada).
