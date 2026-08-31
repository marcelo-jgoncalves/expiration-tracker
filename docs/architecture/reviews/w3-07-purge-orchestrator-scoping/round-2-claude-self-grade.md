# W3-07 Purge Orchestrator — Round 2 self-grade (blind, written before invoking Codex again)

**Nota: 8,9/10**

## Pontos fortes

- Todos os 5 achados bloqueantes da Rodada 1 endereçados com fix concreto e citação/verificação
  real, não hand-waving: (1) o padrão de "chamar StartExecution incondicionalmente" foi verificado
  linha-a-linha em `start-extraction-run.ts`, não inventado; (2) o modelo Retry/Catch foi
  substituído por um Choice loop explícito, correto para um resultado bem-sucedido carregando
  status, não uma exceção; (3) o handler único reusável para as 4 transições fecha a
  ambiguidade de versão/leitura; (4) o limite de 1 ano do Standard Workflow e o quota de 25.000
  eventos foram confirmados por fetch direto da doc oficial da AWS, não assumidos; (5) o mecanismo
  de descoberta do sweeper (Scan filtrado por `SK=LIFECYCLE`) foi nomeado com o trade-off de custo
  explícito, não escondido.
- O reparo durável de `StartExecution` (achado 4) reaproveita o sweeper já planejado em vez de
  inventar um terceiro mecanismo — mantém o critério 2 do checklist forte.
- Nenhum parâmetro já aprovado (1800s, política SES, existência/90 dias do sweeper) foi reaberto.

## Pontos fracos / onde a crítica ainda pode bater

- **`retryCount < 20` é um número que eu inventei, não derivado de nenhuma fonte** — é razoável
  (20 tentativas de um S3 scan/purge já paginado internamente é generoso), mas é uma escolha
  arbitrária meva, não uma pesquisa; um crítico rigoroso pode pedir uma justificativa mais
  quantitativa (ex.: baseada no tamanho esperado de um tenant típico vs. o maior tenant real hoje).
- **Não verifiquei se o handler único de transição (Fix 3) realmente cabe no limite de 256 KiB de
  input/output do Step Functions** — o `checkpoint` de `purgeTenant()` pode crescer com
  `s3TargetKey`/paginação; não confirmei que ele fica sempre bem abaixo desse limite para um tenant
  grande (isso é verificável por leitura do próprio tipo `TenantPurgeCheckpoint`, que eu não
  reexaminei nesta rodada).
- **Ainda não propus onde IAM real entra** — quem tem permissão de chamar `StartExecution`, se o
  `CloseOrganizationService` (fora de escopo de código) precisa de uma role nova, se o Lambda de
  transição de lifecycle precisa acessar `TenantLifecycleRecord` via uma política já existente ou
  nova — não é escopo desta rodada de MECANISMO, mas um crítico pode achar isso uma lacuna real do
  "contrato mínimo" que a Rodada 1 já tinha sido cobrada por deixar vago.
- **`MarkBlocked`+`Fail` não especifica se o alarme CloudWatch reusado de `extraction-workflow` já
  existe genericamente para qualquer execução falha, ou precisa de um alarme NOVO específico deste
  workflow** — afirmei "mesmo padrão... reusado, não inventado" sem verificar se isso é
  automaticamente verdade ou exige wiring explícito (provavelmente exige, já que alarmes CloudWatch
  são por métrica+dimensão, não algo que "vem de graça" entre state machines diferentes).

Nota reflete: os 5 bloqueantes reais foram fechados com evidência concreta, mas ainda há 2-3 pontos
de rigor (limite de payload, IAM, alarme específico vs. genérico) que uma rodada adversarial mais
funda pode achar — não são da mesma classe estrutural dos 5 originais (nenhum invalida o mecanismo
escolhido), mas podem custar os 0,X pontos que faltam para 9,0+ numa primeira leitura rigorosa.
