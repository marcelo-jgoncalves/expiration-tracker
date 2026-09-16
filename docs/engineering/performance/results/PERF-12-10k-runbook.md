# PERF-12 / D-300 — execução reproduzível de 10.000 ocorrências

Status: execução concluída em 2026-09-16, run `d300-10k-preparation-20260916`.
10.000/10.000 TRIGGERED; SLO de 300s reprovado (máximo 383,729s).
Ver [análise final](PERF-12-10k-revalidation-2026-09-16.md).

Monitor somente leitura: `node scripts/perf-reminder-burst-monitor.mjs <run-id>`.
Registra `checkpoint-25.json`, `checkpoint-50.json`, `checkpoint-75.json` e
`checkpoint-100.json` durante a injeção: progresso por tenant, amostra de três
itens por tenant na tabela base, métricas Lambda da janela de cinco minutos e
filas/DLQs. Amostra não substitui conferência integral da população; métricas
sem datapoints ficam null. Não dispara carga, não retenta POST nem altera AWS.

Checkpoint 25% (17:07:52 BRT): 2.597 políticas; 30/30 ocorrências amostradas
materializadas em SCHEDULED; zero Errors/Throttles nas seis Lambdas com atividade
na janela (claim consumer sem datapoints antes do burst). Oito filas/DLQs sem
backlog visível; apenas duas mensagens em processamento na materialização.
Evidência: `.local/d300-10k-preparation-20260916/checkpoint-25.json`.

Checkpoint 50% (17:18:13 BRT): 5.073 políticas; novamente 30/30 ocorrências
amostradas materializadas; zero Errors/Throttles nas seis Lambdas com atividade,
DLQs vazias, nenhuma mensagem aguardando e uma mensagem em processamento na
materialização. Evidência: `.local/d300-10k-preparation-20260916/checkpoint-50.json`.
Durante a execução, injeção e monitor rodaram como processos locais independentes; acompanhar
`execution.log`, `monitor.log`, `ready.json` e depois `final.json`. Não lançar
outro runner para o mesmo teste enquanto `runner.lock` apontar para processo vivo.

Preflight real em 2026-09-16, 16:50 BRT: 10/10 logins, organizações ativas e
leituras autenticadas conferidos; nenhuma carga criada. Evidência local em
`.local/d300-10k-preparation-20260916/preflight.json` e `preflight-infra.json`.
O plano local de preparação aponta para 18:49 BRT do mesmo dia; se estiver
expirado ou próximo demais, gerar outro ID com `plan`, conforme abaixo.

## Escopo e critério de sucesso

10 tenants sintéticos existentes do PERF-11b × 1.000 pares Item/ReminderPolicy,
criados pelas APIs reais, todos com o mesmo minuto de disparo. É um burst global
de 10k distribuído pelo hash existente, não um teste de 10k concentrados num único
shard. Não altera concorrência, infraestrutura, rate limiter ou código do produto.

Critérios pré-registrados: exatamente 10.000 ocorrências materializadas antes do
disparo, 10.000 identidades distintas chegando a TRIGGERED, nenhuma ausente ou
cancelada e atraso máximo de 300 segundos. Registrar p50/p75/p90/p95/p99/máximo,
filas/DLQs, versões implantadas e métricas Lambda. Não confundir TRIGGERED com
entrega no destinatário: o primeiro comprova a etapa de dispatch e criação
transacional de NotificationIntent; esta execução não certifica SES/WhatsApp.

## Executor

[scripts/perf-reminder-burst.mjs](../../../../scripts/perf-reminder-burst.mjs).
Requisitos já existentes: Node 24, dependências do backend/frontend, Chromium do
Playwright, AWS CLI e perfil claude-dev. Conta e origem dev são fixadas no script.
Usa o manifesto e as credenciais sintéticas do PERF-11b na pasta `.local/`;
cookies/senhas não são impressos nem gravados nos relatórios novos.

Na raiz do repositório, escolher um ID novo por experimento:

```powershell
node scripts/perf-reminder-burst.mjs plan d300-10k-001
node scripts/perf-reminder-burst.mjs preflight d300-10k-001
node scripts/perf-reminder-burst.mjs run d300-10k-001
```

`plan` não acessa AWS nem cria carga. Calcula por padrão um disparo duas horas à
frente, no próximo minuto inteiro; aceita um timestamp ISO explícito como terceiro
argumento (mínimo 90 minutos à frente). A data do vencimento deriva do calendário
de America/Sao_Paulo, inclusive ao atravessar meia-noite UTC. Um plano antigo nunca
é deslocado silenciosamente: criar outro ID/horário quando necessário.

`preflight` verifica conta, aliases live, modo PAGED, epochs dos writers de scan,
consumidores habilitados, DLQs e login real dos dez usuários. Confere tanto
activeOrganizationId quanto um GET autenticado de item já existente em cada
tenant. Faz login e leituras; não cria itens, políticas ou usuários.

`run` repete o preflight, exige pelo menos uma hora restante, semeia dez tenants
concorrentemente (um fluxo sequencial por tenant, pausa de 850ms antes de cada
POST, abaixo de 100 requisições/minuto), espera a materialização, aguarda o
Scheduler real e verifica automaticamente até completar ou atingir 20 minutos.
A criação cessa dez minutos antes do alvo; a materialização tem prazo de cinco
minutos antes dele. Falhar um prazo invalida o experimento, nunca reduz o
denominador para chamar a carga parcial de 10k.

O processo produz JSON resumido a cada 100 pares/tenant e por verificação. Pode
rodar com stdout/stderr redirecionados para arquivo; não precisa de polling por
um agente de IA. Não há escrita direta de dados de negócio no DynamoDB, invocação
manual de Lambda, redrive, exclusão ou alteração de Terraform.

## Identidade, retomada e verificação

Artefatos em `docs/engineering/performance/.local/<run-id>/` (gitignored):

- `manifest.json`: horário, tenants e SHA local; `preflight-infra.json`: versões
  e hashes das funções realmente implantadas (a referência de runtime).
- `tenant-N.json`: journal de cada Item/Policy. Grava intenção antes do POST e
  ID confirmado imediatamente depois; mantém itens sem policy rastreáveis.
- `cohort.json`: chaves exatas das 10k ocorrências, tenantId/itemId/policyId e
  scheduledAt, confirmados na tabela base antes do disparo.
- `result.json`/`occurrences.json`: última conferência consistente por chave.
- `final.json`: resultado de drenagem/SLO, estabilidade do deploy e filas vazias.
- `metrics.json`/`cold-warm.json`: métricas AWS Lambda e percentis de duração
  separados por cold/warm nas REPORT lines; são métricas globais da janela,
  não atribuídas exclusivamente à população sintética.

POSTs só repetem automaticamente respostas 429 explícitas (backoff de 60s,
máximo seis tentativas). Timeout/5xx pode ter ocorrido depois de commit: o
journal permanece `pending` e a retomada recusa repetir aquela escrita. Nesse
caso, reconciliar o registro com a API/tabela e o ID único do experimento antes
de qualquer nova criação. A falha de um worker interrompe novas chamadas dos
outros; chamadas já em voo terminam e são registradas. Não apagar journals.

Há lock por run ID. Se o processo morrer abruptamente, conferir o PID registrado
antes de remover `runner.lock`. Não iniciar outro run concorrente contra os
mesmos tenants: os limites de API são compartilhados.

Se apenas o acompanhamento foi interrompido após `cohort.json` existir:

```powershell
node scripts/perf-reminder-burst.mjs verify d300-10k-001
```

Esse comando somente lê os registros e recalcula drenagem/SLO; não repete seed
nem afirma que todos os gates operacionais de `final.json` foram executados.
Leituras usam BatchGet da tabela base, ConsistentRead, lotes de até 100 e retries
limitados de UnprocessedKeys, conforme a
[referência oficial AWS](https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_BatchGetItem.html).

Saída 0: comando concluído (em `run`, gates de `final.json` satisfeitos); 1:
erro de preparação/execução/evidência; 2: drenagem/SLO ou gate final não satisfeito.
Uma saída 1 ou 2 não desfaz dados já criados: a limpeza fica separada e explícita.

## Evidência antecedente e limitações

Em 2026-09-16, 16:39 BRT, leitura consistente confirmou 1.000/1.000 ocorrências
da carga de 10:24 BRT em TRIGGERED, último updatedAt 10:27:05.571, p95 181,904s,
máximo 185,571s. As quatro leases publicaram 239+257+243+261 candidatos e
completaram duas páginas cada. Isso corrige a contagem parcial de logs do Claude;
o teste de 10k precisa da própria evidência e não herda aprovação de 1k.

O claim consumer implantado não possui SCAN_MODE_EPOCH nem descarte por epoch;
o script verifica a concordância de producer/reconciliation e registra essa
limitação existente. Este teste em estado estável não prova segurança de rollback.
Não fazer rollback durante a carga nem declarar conformidade integral com D-300
apenas com o resultado deste teste.

Métricas podem sofrer atraso de ingestão; preservar snapshots e não interpretar
lista vazia como zero erros. Custo não foi medido antecipadamente: contabilizar
a execução real posteriormente; o executor usa recursos e contas existentes,
sem provisionar infraestrutura adicional. RUM, volume 100k/1M, pior caso de shard
único e entrega no provedor não estão incluídos neste degrau.

## Verificação do executor

```powershell
node --test scripts/perf-reminder-burst.test.mjs
npx eslint scripts/perf-reminder-burst.mjs scripts/perf-reminder-burst.test.mjs --max-warnings=0
npm run typecheck
```

Testes de regressão com mutações nomeadas G-V3: calendário local; tenant
duplicado; ocorrência estrangeira/ausente/duplicada; drenagem tardia; retry
ambíguo; UnprocessedKeys; consistência e limite de lote; concorrência limitada.
Não substituem a execução AWS do burst.

DoD: item=executor de revalidação 10k; risco=3-4 (instrumento de teste de decisão
já aprovada, sem alterar contrato/infra/produto); evidência=8/8 testes Node PASS,
G-V3 aplicado por teste, ESLint escopado PASS, typecheck PASS, check-docs PASS,
preflight AWS/API real 10/10 PASS; query cold/warm validada contra logs reais de
1k (59 warm/3 cold, query 87437ca3-2cf5-4573-995e-76a824347b8b);
lacunas=no fechamento do executor, a execução de 10k ainda estava pendente;
executada posteriormente, com SLO reprovado conforme análise final acima.
