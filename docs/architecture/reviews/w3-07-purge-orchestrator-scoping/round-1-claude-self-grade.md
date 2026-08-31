# W3-07 Purge Orchestrator — Round 1 self-grade (blind, written before invoking Codex)

**Nota: 8,3/10**

## Pontos fortes

- Reaproveita 2 precedentes já reais e testados neste repositório (Step Functions/
  `extraction-workflow`, EventBridge Scheduler/`reminder-schedule`) em vez de inventar um terceiro
  mecanismo — critério 2 do checklist atendido com força.
- Não reabre nenhum parâmetro já `APPROVED`/`DECIDIDO` (janela de 1800s, política SES, forma do
  sweeper) — releitura cuidadosa de D-066/D-067/D-081-083 antes de propor, não memória.
- Pesquisa com fonte+data checável (AWS Compute Blog + docs.aws.amazon.com oficial, ambos fetch
  direto, não só resumo de busca) confirmando o suporte técnico real (EventBridge Scheduler
  suporta one-time + universal targets incluindo Step Functions).
- Idempotência de disparo (`StartExecution` por nome=tenantId) citando o precedente já verificado
  em código real (`start-extraction-run.ts`), não uma alegação nova sem lastro.

## Pontos fracos / onde a crítica do Codex provavelmente vai bater

- **Não verifiquei o limite real de `Wait` do Step Functions Standard workflow contra o 1800s
  necessário** — sei que é generoso (até 1 ano), mas não citei a fonte AWS que confirma isso
  explicitamente na proposta; um crítico rigoroso vai pedir a mesma disciplina de verificação que
  apliquei ao EventBridge Scheduler.
- **`CloseOrganizationService` fica genuinamente vago** — "fora do escopo desta rodada" é
  defensável (é maior que decidir o orquestrador), mas não decidi nem esbocei a interface mínima
  que o mecanismo escolhido PRECISA dele fornecer (que argumentos `StartExecution` recebe, que
  transação exatamente grava `ACTIVE→DELETING`+dispara a execução) — isso pode deixar a próxima
  sessão sem um contrato claro de onde a Step Functions machine realmente começa.
- **Não abordei falha do `StartExecution` em si** (rede, IAM, cota) — se a transação de
  `ACTIVE→DELETING` sucede mas `StartExecution` falha depois (não é atômico com a transação
  DynamoDB, são 2 chamadas de API distintas), o tenant fica `DELETING` para sempre sem nenhuma
  execução rodando. Não propus nem uma mitigação nem reconheci isso como gap explícito.
- **Sweeper**: não detalhei como ele descobre QUAIS tenants estão `DELETED` dentro da janela de 90
  dias sem um índice/Scan completo da tabela principal (mesma pergunta que o próprio `purgeTenant`
  original já enfrentou e resolveu via Scan, não Query — não expliquei se o sweeper reusa Scan ou
  precisa de um mecanismo de descoberta diferente).
- Não citei um segundo exemplo de pesquisa externa para robustecer a parte "SIM" da declaração além
  da AWS (ex. um guia de terceiros sobre "delayed destructive workflows" fora do ecossistema AWS) —
  aceitável dado que a pergunta é essencialmente AWS-specific (a escolha é entre 2 serviços AWS),
  mas um crítico pode considerar a amostra estreita.

Nota reflete: direção correta e bem fundamentada, mas a proposta tem pelo menos 2 gaps reais
(falha de `StartExecution` não-atômica; contrato mínimo do trigger service) que provavelmente
custam pontos numa primeira rodada real, consistente com o padrão histórico deste projeto (nenhuma
Rodada 1 até agora fechou sem achado bloqueante genuíno).
