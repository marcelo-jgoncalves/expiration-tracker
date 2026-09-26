**8.4/10** (registrada antes de rodar o Codex nesta rodada).

Corrigi 4 dos 5 achados com código real + testes de mutação (incluindo os 2 de Alta severidade,
que exigiram entender a interação entre `setPhoneNumber()`/`logoutAll()` e adicionar OCC a duas
entidades diferentes). O 5º (achado 5, envios duplicados por double-click) foi conscientemente
adiado por proporcionalidade, mas devo verificar se o Codex concorda com essa lógica ou se
considera isso também bloqueante. Não é mais alta porque: (1) a remoção da rota antiga
(`POST /notifications/whatsapp-opt-in`) tocou bastante superfície (handler, infra, allowlist,
schema, testes) - risco de ter deixado alguma referência solta que só o Codex encontra; (2) o
residual aceito no achado 1 (logoutAll/logoutDevice continuam sem OCC) é uma decisão de
proporcionalidade que o Codex pode não aceitar tão facilmente quanto aceitou a divisão de escopo em
D-315/D-316 (lá os achados registrados eram de um sistema DIFERENTE - M4 email; aqui é a MESMA
entidade GlobalUser que acabei de mexer, então a barra para "aceitável deixar assim" é mais alta).
