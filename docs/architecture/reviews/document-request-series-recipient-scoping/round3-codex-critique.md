NOTA: 9.2

Converge para implementação. Os sete pontos essenciais da Rodada 2 foram resolvidos, e não resta
decisão arquitetural bloqueante.

Ajustes triviais (não bloqueiam, resolver na implementação):
- Corrigir a contradição textual: parte do texto ainda menciona "lowercase"/"trim antes do schema",
  enquanto a decisão final é "somente trim, sem lowercase" — resolver a ordem definitivamente
  (trim antes da validação de schema, decisão fechada, não condicionada a teste empírico do Ajv).
- Acrescentar casos explícitos para string vazia/apenas espaços e preservação de caixa.

Isto pode ser fechado diretamente durante a implementação; não exige nova decisão de arquitetura
nem outra rodada de protocolo.
