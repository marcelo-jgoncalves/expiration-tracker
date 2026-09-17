# PERF-12 — preparação da rodada de 100k

Status: desenho preparatório; não executar antes de fechar a revalidação de 10k e seus gates.

## Estratégia de população

Reutilizar a coorte validada de 10.000 Items/ReminderPolicies da última rodada de 10k. Atualizar
cada política pela API real para conter dez triggers de IDs distintos, todos resolvendo para o
mesmo minuto UTC. O schema permite até 20 triggers. A materialização idempotente cria uma
occurrence por trigger, portanto 10.000 políticas × 10 triggers = 100.000 occurrences.

Isso preserva os serviços, OCC, outbox e materializador reais e reduz a preparação de 200.000
POSTs (novo Item + nova Policy) para 10.000 PUTs de Policy. Com dez tenants em paralelo e
renovação de sessão a cada bloco, a estimativa inicial é de 15–25 minutos, a confirmar em um
preflight sem escrita e numa amostra pequena. O offset em dias deve ser calculado entre a dueDate
existente e a data local do alvo; nunca alterar silenciosamente a semântica do calendário.

Antes das atualizações, conferir integralmente: 10.000 pares distintos, entidades ativas,
versões atuais, uma política ITEM por Item e ausência de operações `pending` no journal. Cada PUT
leva `If-Match`; conflito interrompe a preparação. Após materializar, construir `cohort.json` com
exatamente 100.000 chaves e confirmar por leitura consistente antes do burst.

## Destinatários e e-mail

O fluxo exige um `GlobalUser` ativo, `Membership` ativa no tenant e `assigneeUserId` no Item.
Preparar destinatários sintéticos separados dos usuários humanos e atribuir Items pelo endpoint
`POST /items/bulk-reassign`, em lotes de até 100. Isso exige cerca de 100 chamadas para 10.000
Items, mantendo OCC por item.

Separar os resultados em três coortes:

1. sucesso sintético do SES (`success@simulator.amazonses.com`);
2. falhas controladas (`bounce`, `complaint`, `ooto` e `suppressionlist`);
3. entrega real pequena para um subdomínio/catch-all controlado.

Medir `NotificationIntent` → router → outbox/relay → fila → email worker → SES e callbacks.
`CANCELLED/RECIPIENT_NOT_FOUND` não conta como entrega. Para caixas reais, registrar recebimento,
latência, headers e links sem usar endereços pessoais.

## Gate de SES confirmado em 2026-09-17

A conta `dev` em `us-east-1` está no sandbox (`ProductionAccessEnabled=false`), saudável, com
`Max24HourSend=200`, `MaxSendRate=1/s` e zero envios nas 24 horas observadas. Há somente duas
identidades de e-mail pessoais verificadas; não há domínio verificado. Nessas condições, 100k
entregas não são um teste válido nem operacionalmente viável.

Antes de declarar capacidade de e-mail em 100k:

- verificar um domínio/subdomínio remetente dedicado;
- obter production access e quota diária/taxa compatíveis com a janela do experimento;
- confirmar que simulador e tráfego real respeitam a taxa efetiva concedida;
- definir orçamento, tamanho das coortes e stop conditions;
- não solicitar nem alterar quotas automaticamente: a mudança externa precisa de decisão
  explícita após apresentar o plano concreto.

Se a quota não estiver disponível, executar 100k apenas para o pipeline de reminders e uma
coorte de e-mail compatível com o limite atual. O relatório deve dizer explicitamente que a
capacidade de entrega de 100k ficou não medida.

## Gates antes da execução

- rodada de 10k aprovada, incluindo SLO, duplicidade, recuperação e filas/DLQs;
- harness de 100k com `plan`, `preflight`, journal, lock e verificação integral;
- nenhuma escrita direta de entidade de negócio no DynamoDB;
- destinatários sintéticos provisionados e atribuídos;
- quota SES e identidade remetente registradas no preflight;
- contagem exata de 100.000 occurrences `SCHEDULED` antes do alvo;
- critérios separados para reminder, notification/router e provider;
- avaliação pontual agendada durante preparação e após o burst, sem polling contínuo.

