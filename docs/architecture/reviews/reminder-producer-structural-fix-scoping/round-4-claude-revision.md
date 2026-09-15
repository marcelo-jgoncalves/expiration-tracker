# ReminderProducer structural fix — Round 4 (Claude revision, fechamento)

## Resposta ao achado bloqueante da Round 3 (nota 8.4/10)

Procede integralmente: o fence `attribute_not_exists` de item único (sem estado) tem um buraco
real — uma execução que adquire o fence e morre ANTES de publicar todos os candidatos (ou a
continuação) deixa o fence "adquirido para sempre" (TTL não garante remoção síncrona, achado do
Codex verificado contra a doc oficial de TTL), e uma redelivery legítima da mesma mensagem SQS
encontraria o fence já presente e desistiria — convertendo at-least-once em perda silenciosa.
Isso é exatamente a mesma classe de bug que a tarefa inteira existe para eliminar. Fecho com uma
máquina de estados de lease, exatamente como o Codex especificou.

## Fence revisado — lease com estado, não mais um marcador único

Item de controle por `(scanJobId, pageIndex)` na tabela principal, com um campo `status`:

1. **Aquisição condicional**: `PutItem`/`UpdateItem` condicional aceito quando o item NÃO existe
   OU quando existe com `status=IN_PROGRESS` e `leaseUntil < now()` (lease anterior expirou sem
   completar — outra execução pode ter morrido a meio caminho). Nunca aceito quando
   `status=COMPLETED` (já terminou de verdade) ou quando `status=IN_PROGRESS` com
   `leaseUntil >= now()` (outra execução está ativa agora — não interferir).
2. **`ownerToken`** (um `newEventId()` por tentativa de aquisição) gravado no item no momento da
   aquisição. Toda escrita subsequente relativa a essa página (extensão de lease, ou transição
   final) é condicional em `ownerToken = <o token que esta execução adquiriu>` — se uma execução
   "zumbi" (que achava ter o lease mas na verdade já expirou e foi readquirido por outra) tentar
   escrever, a condição falha e ela aborta sem efeito, nunca finaliza um lease que não é mais
   dela.
3. **Transição para `COMPLETED`**: só depois que TODOS os candidatos da página foram publicados
   com sucesso confirmado (todas as entradas de `Failed[]` esgotaram retry com sucesso) E a
   mensagem de continuação (se houver `LastEvaluatedKey`) foi publicada com sucesso — a mesma
   ordem "publicar tudo, só então confirmar" da Round 2/3, agora com o `COMPLETED` sendo o
   registro durável dessa confirmação, condicional em `ownerToken` (item 2).
4. **Semântica de redelivery/retry sob o lease**:
   - Mensagem de scan reentregue enquanto `IN_PROGRESS` com lease ainda válido (outra invocação
     concorrente do mesmo shard/minuto está processando agora) → esta execução NÃO adquire,
     NÃO reprocessa, e não confirma a mensagem SQS (deixa a visibility timeout expirar
     naturalmente ou faz retorno explícito à fila) — evita duplicar trabalho enquanto uma
     execução legítima está em andamento.
   - Mensagem reentregue e o item está `COMPLETED` → confirma a mensagem SQS imediatamente sem
     reprocessar (idempotência real: trabalho já feito e DURAVELMENTE registrado como tal,
     diferente do fence anterior que só registrava "alguém começou", nunca "terminou de verdade").
   - Mensagem reentregue e lease expirado (`IN_PROGRESS`+`leaseUntil < now`) → esta execução
     ADQUIRE (novo `ownerToken`) e reprocessa a página do zero — exatamente o caso que o fence
     anterior quebrava (achado bloqueante do Codex), agora coberto.
5. **Chamada `SendMessageBatch` inteiramente falha/ambígua**: a mensagem de scan NÃO é
   confirmada (Round 3, mantido) — mas agora isso funciona corretamente com o lease, porque o
   item de controle permanece `IN_PROGRESS` (nunca chegou a `COMPLETED`), então uma redelivery
   corretamente readquire e tenta de novo após o lease expirar, em vez de ser descartada como
   "já processada" (o bug exato apontado pelo Codex).

**Redrive de DLQ agora funciona como descrito nas rounds anteriores**: uma página em DLQ tem
identidade reprocessável de verdade — o item de controle está `IN_PROGRESS` com lease expirado
(nunca chegou a `COMPLETED`), então um redrive manual da DLQ para a fila de scan aciona uma
aquisição legítima e reprocessamento real, não um descarte silencioso.

## Métrica de lag — nome e semântica corrigidos (achado do Codex incorporado)

Renomeio de "candidato mais antigo ainda não CLAIMED" (afirmação que o Codex corretamente notou
ser impossível de sustentar só a partir do que o claim consumer observa) para **`claim_lag_seconds`
por candidato** — `now() - scheduledAt` medido no momento em que UM candidato específico É
reivindicado, emitido como métrica CloudWatch/EMF por invocação do claim consumer, agregada via
`Maximum` no período (não uma alegação de "o mais antigo da fila inteira", só "o pior lag
observado entre os candidatos efetivamente processados nesse período", com tratamento explícito
de ausência de amostras — período sem claims não deveria ser lido como "lag zero"). Mantido junto
de `ApproximateAgeOfOldestMessage` em AMBAS as filas (scan e claim, Round 3) para detectar
paralisação/backlog — os dois sinais são complementares, não um substituindo o outro.

## Backpressure — invariante explícita (achado do Codex incorporado)

`reserved_concurrent_executions` de cada função (scanner, claim consumer) deve ser ≥ a soma dos
`maximumConcurrency` de todos os event-source-mappings que a invocam — nomeado explicitamente
como invariante de implementação (a violação faria o próprio limite de reserved concurrency virar
fonte de throttling, o oposto do objetivo). Valores exatos ficam para a fase de implementação
(dimensionamento contra a folga de capacidade DynamoDB já medida empiricamente pelo PERF-12 10k —
22.502 WCU de pico absorvido sem throttle), mas a invariante em si é parte da decisão
arquitetural, registrada aqui para não ser esquecida na implementação.

## `CancellationReasons` — confirmado (Codex concordou, nenhuma mudança necessária)

Round 3 já estava correta neste ponto segundo o Codex ("fechado conceitualmente, com uma condição
de implementação" — a ordem de `CancellationReasons` corresponde à ordem dos itens da transação,
confirmado pela doc oficial que o próprio Codex citou). Mantido como estava.

## Checklist — nota de aplicação (achado do Codex incorporado, sem mudar pesos)

Aceito a observação de não duplicar a penalização do mesmo defeito nos critérios 1 e 4: doravante
o critério 1 (correção estrutural/progresso durável) é o único que avalia se o mecanismo de
retomada é correto; o critério 4 (alinhamento/simplicidade) avalia só se a COMPOSIÇÃO de padrões
AWS é idiomática, não se o fence funciona — evita dupla contagem do mesmo achado.

## Decisão final proposta (inalterada em substância desde a Round 3, corrigida no mecanismo de fence)

**Opção B, forma final**: descoberta paginada via fila de scan, fence de página como lease com
estado (`IN_PROGRESS`/`ownerToken`/`leaseUntil`/`COMPLETED`, condicional, mesma tabela principal,
nenhum serviço novo) em vez de marcador único — fecha o bloqueante da Round 3 sem introduzir
nenhuma classe de mecanismo nova (é o mesmo padrão de claim condicional/OCC já usado por todo o
resto deste código, só com um campo de estado a mais). Candidatos discriminados por `GSI3SK`
bruto na fila de claim, claim consumer com `CancellationReasons` corretamente distinguidos,
`ReportBatchItemFailures` nas duas pontas, DLQ+alarme+idade em ambas as filas,
`claim_lag_seconds` (não mais "candidato mais antigo global") como métrica de negócio,
`maximumConcurrency`/`reserved_concurrent_executions` com invariante de soma explícita. Único
serviço AWS novo: uma segunda fila SQS (módulo Terraform já existente).
