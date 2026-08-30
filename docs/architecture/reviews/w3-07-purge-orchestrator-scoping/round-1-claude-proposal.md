# W3-07 Purge Orchestrator — Round 1 (Claude proposal)

## Escopo da decisão

Fechar a única pergunta de D-083 explicitamente deixada em aberto ("pipeline pronto pelo Codex para
avançar à próxima etapa real (decidir orquestrador)"): **quem/o que aciona, de ponta a ponta, a
transição real `TenantLifecycleRecord.status` (`ACTIVE→DELETING→QUIESCING→PURGING→VERIFIED→DELETED`)
e a chamada real a `purgeTenant()`** — hoje só o primitivo (`transitionTenantLifecycle`,
`system-mutation.ts`) e o worker de purga (`purgeTenant()`, `src/workers/tenant-purge/`) existem;
nenhum orquestrador/trigger real chama nenhum dos dois (confirmado por leitura: `grep` por
`transitionTenantLifecycle\(` fora de teste só encontra a própria definição; nenhum
`DeleteOrganization`/`CloseOrganization` service existe em `src/modules/organization/application/`).

**Fora de escopo desta rodada** (já decidido, não reaberto): (a) a existência e o tamanho da janela
de quiescência — D-066 Rodada H já fechou "cutoff conservador de 1800s" para extinção de
capabilities admitidas; (b) a política de envio SES pós-`DELETING` — D-067; (c) o sweeper
permanente pós-`DELETED` reusando o padrão `DocumentPurgeWorker` com elegibilidade de 90 dias
(`privacy-lgpd.md`) — D-066 Rodada H já nomeou a existência e a forma dele, só falta decidir o
mecanismo real de disparo recorrente (parte desta rodada). Esta rodada decide MECANISMO de disparo,
não os parâmetros de tempo já aprovados.

## Pesquisa externa considerada: SIM PARCIAL

Decisão composta, mesma classe já formalizada em `research-protocol.md` Exemplo 2:

- **Escolha de mecanismo AWS (Step Functions vs. EventBridge Scheduler vs. Lambda+poller)**:
  informada por padrão externo — é uma pergunta de arquitetura AWS amplamente resolvida, não algo
  específico deste projeto. Fontes: AWS Compute Blog, "Introducing Amazon EventBridge Scheduler"
  (aws.amazon.com/blogs/compute, acessado 2026-08-30) confirma que EventBridge Scheduler suporta
  "one-time invocations" e integra com AWS SAM's `ScheduleV2` para agendar Step Functions; AWS docs
  oficial, "What is Amazon EventBridge Scheduler?" (docs.aws.amazon.com/scheduler, acessado
  2026-08-30) confirma "Universal targets" cobrindo 270+ serviços/6000+ operações via API, incluindo
  `states:StartExecution` — targets de Step Functions são suportados diretamente. Síntese de
  múltiplas fontes técnicas independentes (CloudThat, Medium — não citadas como autoridade sozinha,
  só como confirmação convergente da orientação oficial): o padrão recomendado é complementar — "
  EventBridge owns the boundary: ingestion, fan-out, event routing... Step Functions owns
  coordination: sequencing, retries, error isolation within a workflow" — nunca escolher um dos
  dois sozinho para um problema que tem as duas naturezas (disparo pontual/recorrente E workflow
  multi-etapa com retry/checkpoint).
- **Precedente interno, mais forte que a pesquisa externa para a escolha final**: este mesmo
  repositório já tem os dois mecanismos em produção real, resolvendo formas comparáveis do mesmo
  problema — `infra/modules/extraction-workflow/` (Step Functions, múltiplas etapas com task token,
  retry/catch, para o pipeline de extração OCR) e `infra/modules/reminder-schedule/` (EventBridge
  Scheduler recorrente, por shard/minuto, para o dispatch de reminders). A forma do problema aqui
  (disparo pontual → espera limitada → tarefa multi-tentativa com checkpoint → estado terminal →
  sweeper recorrente pós-terminal) já tem as duas metades resolvidas internamente, sem precisar
  inventar um terceiro padrão.
- **Escopo puramente interno, sem pesquisa aplicável**: nome/formato do novo Lambda handler, nome
  da máquina de estados, layout do `TenantS3Target[]` real que o composition root vai construir —
  decisões que dependem só do resto do código já existente deste projeto, sem padrão de mercado
  relevante.

## Checklist de critérios de nota (derivado da pesquisa + precedente interno)

```text
1. (peso 30%) Mecanismo escolhido cobre TODA a forma real do problema (disparo pontual único +
   espera limitada + tarefa multi-tentativa/retomável + transição de estado terminal + disparo
   recorrente pós-terminal) sem forçar um único serviço AWS a fazer um papel que a documentação
   oficial não recomenda para ele (ex.: EventBridge Scheduler sozinho orquestrando retry/checkpoint
   multi-etapa; um Lambda com timeout de 15min rodando um polling loop indefinido).
2. (peso 25%) Reaproveita precedente já existente no próprio repositório (Step Functions via
   extraction-workflow, EventBridge Scheduler via reminder-schedule) em vez de introduzir um
   terceiro mecanismo novo (ex. um poller cron caseiro) sem justificativa forte.
3. (peso 20%) Não reabre nenhuma decisão já `APPROVED`/`DECIDIDO` de D-066/D-067/D-081-083 (janela
   de quiescência, política SES, forma do sweeper) — só decide o mecanismo de disparo.
4. (peso 15%) Idempotência real de disparo (StartExecution por nome determinístico, mesmo padrão
   já verificado em `start-extraction-run.ts` por D-066 Rodada F) — nenhum disparo duplo deveria
   iniciar uma segunda purga concorrente do mesmo tenant.
5. (peso 10%) Superfície de gatilho real (`CloseOrganizationService`/equivalente) é nomeada
   explicitamente como fora do escopo de implementação desta rodada (é maior que "decidir o
   orquestrador" — mexe em RBAC/UX de confirmação) ou como parte mínima estritamente necessária,
   nunca ambígua sobre o que fica para depois.
```

## Proposta

### Mecanismo escolhido

**Um pipeline de 2 mecanismos complementares, nunca um sozinho:**

1. **Disparo da purga de UM tenant específico (pontual, após `ACTIVE→DELETING`)**: uma nova máquina
   de estados **Step Functions** (`infra/modules/tenant-purge-workflow/`, mesmo padrão estrutural
   de `infra/modules/extraction-workflow/`) com 3 estados reais:
   - `Wait` (nativo do Step Functions, `SecondsPath`/`Seconds: 1800` — o cutoff já aprovado em
     D-066 Rodada H, nunca redecidido aqui) — cobre `DELETING→QUIESCING`.
   - `Task` invocando um novo Lambda (`tenant-purge-worker-handler`) que chama `purgeTenant()` já
     existente, com `Retry`/`Catch` do próprio ASL usando o `checkpoint` retornado como parte do
     input da próxima tentativa (mesmo padrão de retry-com-estado que Step Functions já suporta
     nativamente via `ResultPath`/`InputPath`, sem precisar reimplementar retry manual) — cobre
     `QUIESCING→PURGING`, incluindo o caso `PARTIAL` (mais tentativas) e `FAILED` (vai para um
     estado `BLOCKED`/alarme, nunca reporta sucesso).
   - `Task` final chamando `transitionTenantLifecycle` para `PURGING→VERIFIED→DELETED` só quando o
     resultado de `purgeTenant()` foi `SUCCESS` real (nunca avança o estado a partir de `PARTIAL`).
   - **Disparo do `StartExecution`**: por um novo `CloseOrganizationService` (fora do escopo de
     implementação desta rodada — ver critério 5) que, na MESMA transação que grava
     `ACTIVE→DELETING` via `transitionTenantLifecycle`, chama `StartExecution` com
     `name: tenantId` (idempotente por nome, mesmo padrão já verificado em `start-extraction-run.ts`
     — uma segunda tentativa de fechar a mesma organização vira `ExecutionAlreadyExists`, não uma
     segunda purga concorrente).

2. **Sweeper permanente pós-`DELETED` (recorrente, residual-repair, já nomeado por D-066 Rodada H)**:
   **EventBridge Scheduler** com expressão `rate` (mesmo padrão de `reminder-schedule/`, não
   `cron` — não há necessidade de um horário fixo, só cadência regular, ex. diária) invocando um
   Lambda que re-varre tenants `DELETED` dentro da janela de 90 dias (`privacy-lgpd.md`) chamando
   `verifyTenant*Empty()` (já existentes, usados hoje só dentro de `purgeTenant()`) de forma
   isolada — nenhuma lógica nova de verificação, só reuso do que já existe.

### Por que não Lambda+poller solto (a terceira opção óbvia, descartada)

Um único Lambda com um loop de polling (sem Step Functions nem Scheduler) reimplementaria, de forma
pior, o que os dois serviços já gerenciados fazem: retry com backoff, persistência de estado entre
tentativas, timeout de execução (Lambda tem limite de 15 minutos; um Scan completo de tenant grande
mais retries de S3 pode legitimamente exceder isso, exatamente o motivo pelo qual `purgeTenant()` já
retorna um `checkpoint` resumível em vez de assumir uma única invocação — o design já pressupõe
múltiplas invocações, que é exatamente o que o `Task`+`Retry` do Step Functions provê nativamente).

### Escopo explícito desta rodada (critério 5)

Esta rodada aprova o MECANISMO (Step Functions + EventBridge Scheduler, papéis exatos acima) como
design. Implementação real fica para uma sessão dedicada futura (mesmo padrão de D-081, "sessão
dedicada ao purge/sweeper") — inclui: o novo módulo Terraform, o novo Lambda handler do worker de
purga, o `CloseOrganizationService`+rota HTTP+UI de confirmação (RBAC/UX própria, decisão
adicional fora desta rodada), o Lambda do sweeper, IAM roles reais, e toda a suíte de testes
(unit+`terraform test`) — nenhum código é escrito nesta rodada, só o design é fechado.
