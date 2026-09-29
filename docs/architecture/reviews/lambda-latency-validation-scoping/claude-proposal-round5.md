---
status: draft
owner: Marcelo
authority: proposta Rodada 5 do protocolo Claude↔Codex (AGENTS.md §4) — nível 3-4, submissão pedida por Marcelo
---

# Metodologia de validação pós-deploy do D-350 (A+B) — Rodada 5

Responde aos 6 achados da Rodada 4 (3 rotas de fixture inexistentes; comando/nome do worker errados;
exclusividade temporal não alinhada à granularidade real do CloudWatch; fórmula estatística com casos
indefinidos; critério de "subiu" não protege contra taxa pequena com denominador pequeno; matriz
incompleta). Confirmado pelo Codex nesta rodada, **não reaberto**: tabela de versões/correlação via
REPORT como evidência amostral, pontos de exceção dos 3 handlers HTTP, extração de RequestId, fixture
do BFF, separação Mann-Whitney/mediana, Holm, reconhecimento de versões não verificadas, smoke
incondicional, abandono do rollback seletivo.

## 1. Rotas de fixture corrigidas (verificadas contra o `switch` real de cada handler)

| Handler | Rota real | Evento |
|---|---|---|
| `documents-handler` | `GET /items/{itemId}/documents/{documentId}` | `pathParameters: {itemId: "item_smoke", documentId: "doc_smoke"}` |
| `document-archive-handler` | `GET /document-archive/requirements/{subjectId}` | `pathParameters: {subjectId: "subj_smoke"}` |
| `memberships-handler` | `GET /organizations/members` | sem `pathParameters` |

IDs sintéticos (`item_smoke`/`doc_smoke`/`subj_smoke`) não precisam existir - resposta esperada
continua `FunctionError` ausente E `Payload.statusCode` ∈ {200, 401, 403, 404} (nunca 500).
**Ressalva aceita do Codex**: um `sub` sintético pode disparar bootstrap de `GlobalUser`/
`IdentityMapping` mesmo num GET (fluxo de identidade cria-se-não-existe) - efeito colateral aceitável
em `dev` (sem usuário real, dado sintético e resetável, `AGENTS.md` §1), registrado explicitamente
aqui, não escondido.

## 2. Worker: nome/comando reais, asserção sem falso positivo, descrição corrigida

**Nome real** (`infra/main.tf:714`): `exptrk-dev-outbox-sweeper-reminder-dispatch` (não
"outbox-sweeper-handler" - isso é só o nome do arquivo-fonte/`handler_name` do Terraform, não o
`function_name` real).

```bash
aws lambda invoke --profile claude-dev \
  --function-name exptrk-dev-outbox-sweeper-reminder-dispatch \
  --qualifier live --invocation-type RequestResponse --log-type Tail \
  output.json
```

**Descrição corrigida**: publica em SQS (`DISPATCH_QUEUE_URL`/`EMAIL_DELIVER_QUEUE_URL`, confirmado em
`infra/main.tf`), pode acionar consumidores reais downstream (e-mail/WhatsApp) - não é "só DynamoDB".
Aceitável em `dev` mesmo assim (mesmo raciocínio do item 1 - sem usuário real, e este worker já roda
a cada 5min em produção normal, uma invocação a mais não é um evento incomum).

**Asserção sem falso positivo**: "outbox-sweeper complete" é emitido mesmo com `failed > 0`
(confirmado pelo Codex - não é garantia de sucesso). Corrigido: extrair o `Payload`/log correlacionado
e exigir **`FunctionError` ausente E `failed === 0`** (campo do resultado de
`sweepPendingDispatch`, logado junto de "outbox-sweeper complete"). `attempted === 0` é um resultado
válido (ciclo vazio, nada pendente no momento) mas **não prova publicação efetiva** - registrado como
distinção explícita: `attempted > 0 && failed === 0` = smoke com publicação real comprovada;
`attempted === 0 && failed === 0` = smoke sem erro mas sem cobertura de publicação real (aceito como
resultado válido do dia, mas anotado com essa limitação, nunca apresentado como prova forte).

## 3. Exclusividade temporal alinhada à granularidade real do CloudWatch

**Confirmado**: `GetMetricStatistics`/`GetQueryResults` arredondam `StartTime` pro minuto, período
mínimo de agregação é 60s (documentação oficial da AWS, já citada pelo Codex). Corrigido:

- **Um único corte global**, não por handler: **todas as 5 janelas naturais precisam fechar antes de
  QUALQUER atividade sintética/smoke começar** (mais simples que tentar alinhar 5 relógios
  independentes a fronteiras de minuto individualmente - trade-off aceito: um handler que atinge o
  piso cedo só "libera" formalmente quando o último dos 5 também fechar ou o teto de 45min for
  atingido).
- Todo timestamp usado em `--start-time`/`--end-time` é truncado para o **minuto cheio anterior**
  (nunca um segundo arbitrário).
- `Period=60` fixado em toda chamada `GetMetricStatistics`, aplicado também à janela "antes"
  (retroativa) para consistência.
- Sintética/smoke só começa no **próximo minuto cheio** após o fechamento global das 5 janelas
  naturais (nunca no mesmo minuto).

## 4. Fórmula estatística: casos de borda fechados

```
z_abs = max(0, |U₁ - μᵤ| - 0,5) / σᵤ      (correção de continuidade, forma corrigida do Codex)
p = 2 × (1 - Φ(z_abs))                     (bicaudal)
```
- **`σᵤ = 0`** (todos os valores empatados entre os 2 grupos): `p` não calculável - classificado
  diretamente como **SEM DIFERENÇA MENSURÁVEL**, sem tentar computar `z`.
- **Mediana "antes" = 0**: percentual de mudança indefinido (divisão por zero) - reportar só a
  diferença absoluta e o resultado do teste de distribuição, sem aplicar o critério de 15%
  relativo (que exige denominador não-nulo); classificação usa só `p` ajustado, nunca o percentual.
- **`n<8` em qualquer um dos 2 grupos**: mesmo atingindo o piso de 5 frias, a classificação nunca é
  confirmatória - rotulada **INDICATIVO (n baixo)**, categoria própria, distinta de MELHORIA/
  REGRESSÃO/SEM DIFERENÇA/INCONCLUSIVO.
- Regra de decisão final, reafirmada com os casos acima resolvidos: **MELHORIA/REGRESSÃO** exige
  TODOS: `n≥8` nos 2 grupos, `σᵤ>0`, mediana "antes" ≠ 0, `p` ajustado (Holm) `<0,05`, mudança
  relativa da mediana `≥15%`. Qualquer um desses não satisfeito → cai em SEM DIFERENÇA MENSURÁVEL,
  INDICATIVO ou INCONCLUSIVO conforme qual condição falhou (nunca silenciosamente em MELHORIA).

## 5. Critério de "subiu" corrigido: ponto percentual absoluto na taxa, não contagem

**Caso do Codex resolvido** (`1/1000→1/10`: 0,1%→10%, diferença de contagem=0 mas taxa dispara):
substituído o critério de "diferença absoluta de contagem ≥1" por **diferença absoluta de PONTO
PERCENTUAL na taxa ≥1pp, E taxa "depois" > taxa "antes"** - no exemplo do Codex, 9,9pp de diferença
aciona corretamente; um caso real como 5/1000=0,5%→6/1000=0,6% (0,1pp) corretamente NÃO aciona.
Aplica-se aos 2 sinais (A: `Errors`/`Invocations`; B: `count_distinct(@requestId)` erro/total),
sempre com numerador+denominador publicados ao lado da taxa. Denominador zero em qualquer janela →
"sem dado" (não entra no critério de "subiu" nem é tratado como 0%).

## 6. Matriz completa - nenhum estado cai implicitamente em MANTER-aprovado

| Situação | Ação |
|---|---|
| Sinal de erro "subiu" (critério do item 5) em QUALQUER um dos 5 handlers | **ROLLBACK DO DEPLOY INTEIRO** via `.github/workflows/rollback.yml` - reverte **todas as funções do manifesto, inclusive as que não fazem parte dos 5 handlers de A** (é isso que o workflow real faz, nunca um subconjunto) |
| Sinal de erro "sem dado" em algum handler (denominador zero) | Decisão baseada só no resultado de latência daquele handler; registrado explicitamente "sinal de erro sem dado nesta janela", nunca tratado como "não subiu" |
| Latência: MELHORIA (critério completo do item 4) | **MANTER**, registrar número final |
| Latência: REGRESSÃO (critério completo do item 4), sem sinal de erro subindo | **INVESTIGAR** esse handler especificamente, não aciona rollback do deploy inteiro sozinho |
| Latência: SEM DIFERENÇA MENSURÁVEL | **MANTER**, registrado como "sem ganho detectável nesta amostra" |
| Latência: INDICATIVO (n<8) | **MANTER**, registrado como "indicativo, não confirmatório - amostra pequena" |
| Latência: INCONCLUSIVO (piso 5/10 não atingido mesmo após rajada) | **MANTER**, registrado como pendência de mais tráfego natural |
| Dados ainda ausentes após o buffer de 2min | **MANTER PROVISORIAMENTE**, validação registrada como pendente, repetir a consulta depois - nunca presumir sucesso |
| Falha de smoke num dos 5 handlers de A (`FunctionError` presente, ou `statusCode` fora do esperado) | **INVESTIGAR** imediatamente - prioridade sobre achados de latência, é regressão funcional real |
| Falha de smoke no worker (`FunctionError` OU `failed>0`) | **INVESTIGAR** o escopo global de B (minificação), tratado à parte do rollback dos 5 handlers de A |

## Pergunta específica para o Codex

Os 6 pontos foram corrigidos com detalhe suficiente pra reproduzir exatamente por outra pessoa? Falta
algo antes de eu proceder pra execução real?
