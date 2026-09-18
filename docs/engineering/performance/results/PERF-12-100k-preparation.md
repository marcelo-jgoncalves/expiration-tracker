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

## Gate de SES confirmado em 2026-09-18

A AWS concedeu production access à conta `dev` em `us-east-1` no caso `178965815200733`. A
consulta após a aprovação confirmou `ProductionAccessEnabled=true`, estado `HEALTHY`, quota de
50.000 mensagens por 24 horas, taxa máxima de 14 mensagens/s e zero envios nas 24 horas
observadas.

A quota permite validar o caminho completo de e-mail com uma coorte representativa, mas não
permite entregar 100.000 mensagens em uma única janela de 24 horas. A rodada de 100k medirá
integralmente o pipeline de reminders. Para e-mail, usará uma coorte limitada e manterá margem na
quota para tráfego operacional e repetições. A capacidade de entregar 100k e-mails continuará
fora do escopo até existir quota diária suficiente ou um ensaio deliberadamente dividido em
mais de uma janela de 24 horas.

Antes da execução:

- confirmar a identidade remetente e registrar se ainda é um endereço pessoal;
- dimensionar a coorte abaixo da quota disponível no preflight;
- criar um controle explícito de admissão antes da coorte: o mapping atual do
  `email-delivery` está habilitado com batch 10 e sem `MaximumConcurrency`, portanto não há hoje
  garantia de permanecer abaixo de 14 envios/s durante um burst. A rodada não deve inferir esse
  limite a partir de latência média nem depender de throttling do SES como regulador;
- usar o simulador do SES para sucesso, bounce, complaint, out-of-office e suppression list;
- reservar uma coorte real pequena, controlada e consentida para conferir recebimento, headers,
  links e latência ponta a ponta;
- definir orçamento, margem operacional e stop conditions para bounce, complaint, DLQ e alarmes.

## Gates antes da execução

- rodada de 10k aprovada, incluindo SLO, duplicidade, recuperação e filas/DLQs;
- harness de 100k com `plan`, `preflight`, journal, lock e verificação integral;
- nenhuma escrita direta de entidade de negócio no DynamoDB;
- destinatários sintéticos provisionados e atribuídos;
- quota SES e identidade remetente registradas no preflight;
- taxa efetiva do canal de e-mail limitada de forma mensurável a no máximo 14 envios/s;
- contagem exata de 100.000 occurrences `SCHEDULED` antes do alvo;
- critérios separados para reminder, notification/router e provider;
- avaliação pontual agendada durante preparação e após o burst, sem polling contínuo.
