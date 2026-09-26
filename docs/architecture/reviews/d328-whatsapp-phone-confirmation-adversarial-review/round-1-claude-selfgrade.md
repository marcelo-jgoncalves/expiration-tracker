**7.5/10** (registrada antes de rodar o Codex nesta rodada).

O achado 1 é sério (a feature inteira estava desconectada da entrega real) e já corrigido com
testes reais antes desta submissão. Não é mais alta porque: (1) não tenho certeza se há OUTRAS
rotas que também deveriam ler/depender de `GlobalUser.phoneE164` e que eu não verifiquei (ex.
alguma tela de perfil mostrando o número, algum outro fluxo de troca de número); (2) os achados
2/3 (race conditions) são reais mas não corrigidos, e o Codex pode julgar que pelo menos o achado 2
(attemptCount) merece correção nesta rodada, não só registro; (3) esta é a primeira vez que sigo a
cadeia completa confirmação→opt-in→resolver→router para D-328 especificamente - posso ter perdido
algo que só aparece ao seguir o `notification-router-workflow.ts` inteiro com um WhatsApp intent
real (não segui o fluxo synthetic/whatsapp-outbox.ts nesta rodada).
