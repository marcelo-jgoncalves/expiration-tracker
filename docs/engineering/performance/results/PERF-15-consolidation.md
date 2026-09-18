# PERF-15 — Consolidação do Programa de Performance

Status: rascunho vivo, escrito em 2026-09-18 enquanto PERF-12 (revalidação de 10k) ainda está em
andamento — a linha do pipeline de reminders será atualizada quando essa rodada concluir. Todas as
outras fases (PERF-00 a PERF-11, PERF-13, PERF-14) estão fechadas e não mudam retroativamente.

Fonte: `expiration-tracker-plano-acao-performance-world-class-2026-09-14.md` (documento do Marcelo,
não versionado neste repo/máquina). Rastreamento vivo item-a-item: `TODO.md`. Este documento é o
pacote de retorno — síntese executiva, não repete número já registrado em cada `PERF-NN-*.md`.

## 1. O que o programa realmente encontrou

| Área | Achado principal | Ação tomada |
|---|---|---|
| Quota de conta (PERF-01) | Lambda concurrent executions estava em 10 (padrão de conta nova); 1 throttle real já observado no `dispatch-outbox-relay` em produção sintética | Aumentada para 1.000 via caso manual AWS Console, aprovado pela AWS |
| Cold start / Application Signals (PERF-02) | ADOT+X-Ray Active já dá os 4 números de cold start de graça via `REPORT` line; Application Signals decidido **não** habilitar (redundante) | Nenhuma mudança de infra; instrumentação EMF customizada implantada (`bff.*`, `lambda.*`) |
| Frontend sem throttling (PERF-03) | Bundle único sem code-splitting dominava o tempo até conteúdo útil sob Fast 4G+CPU 4x (164ms→1.615ms) | Motivou PERF-09 |
| BFF/Lambda (PERF-04) | Overhead do BFF ~56ms p50 (~21%) sobre o resource Lambda; achado incidental: rotas de leitura do `document-archive` retornavam 500 por gap de IAM | IAM corrigido fora do programa; overhead do BFF aceito como custo estrutural do padrão Full BFF |
| Power Tuning (PERF-05) | Só `reminder-producer` teve recomendação de alta confiança (1769 MB) — payloads sintéticos das outras 7 funções não exercitaram lógica de negócio real | Nenhuma mudança de memória aplicada; diagnóstico registrado para reuso futuro |
| CloudFront/Brasil (PERF-06) | `PriceClass_100` sem POP brasileiro; toda API usa `CachingDisabled` por desenho (Full BFF, nada cacheável) — sem vantagem de latência medida sobre acesso direto ao origin | Recomendação: `PriceClass_All` antes de lançamento real; migração `us-east-1→sa-east-1` fora de escopo |
| Fan-out por tela (PERF-07) | Maior fan-out é Subject Hub (5 hooks), mas todo fan-out é paralelo — nenhum waterfall sequencial real | Nenhum endpoint composto criado; critério de 5 condições definido para quando se justificaria |
| RequestContext (PERF-08) | 7 chamadas DynamoDB no caminho comum (6 sequenciais); só 1 par tem dependência real de dado | Recomendação: não implementar fast path agora; **P1 deliberadamente movido para o final da fila (Marcelo, 2026-09-12)** |
| Code splitting (PERF-09) | Bundle inicial 517,4→~280,8KB raw (-46%), 140,1→~86,7KB gzip (-38%) | Implantado, 158/158 e2e + 407/407 unit passando |
| Cache TanStack Query (PERF-10) | 3 mutations sem invalidação precisa (bug real, não perf) | Corrigido junto com a classificação STATICISH/REFERENCE/OPERATIONAL/NEAR_REALTIME |
| Load testing HTTP (PERF-11/11-b) | Teto real é a quota de aplicação `API_REQUEST` (100 req/60s/tenant), não infra — zero throttle/erro de Lambda/DynamoDB mesmo agregando 10 tenants sintéticos | Nenhuma mudança; achado é "by design", não bug |
| Pipeline de reminders (PERF-12) | Ver §2 — achado mais significativo do programa inteiro, motivou mudança arquitetural real (D-301/D-302) | Em andamento |
| Capacidade DynamoDB (PERF-13) | Zero throttling/erro em 7 dias; consumo de capacidade desprezível (pico 4 RCU/10 WCU) | Confirma que latência p95 do PERF-04 não é causada por DynamoDB |
| Regression gates (PERF-14) | — | Bundle budget CI + Lighthouse CI + k6 smoke autenticado em PR + synthetic canaries + 7 alarmes de latência/throttling + dashboard consolidado, todos implantados e verificados ao vivo |

## 2. PERF-12 — o achado que gerou mudança arquitetural real

Único achado do programa que não terminou em "documentar e seguir" — terminou em decisão Type 1
nível 6 (D-301/D-302, `APPROVED_BY_OWNER`). Resumo (detalhe completo: `TODO.md` + `results/PERF-12-*`
+ `docs/architecture/reviews/reminder-scan-control-plane/`):

1. 1k: `reminder-producer` estourava timeout de Lambda sob burst, ~440/1.000 occurrences perdidas
   permanentemente (sem reconciliação para esse caso) — corrigido.
2. 10k (2 rodadas limpas, 2026-09-17): 10.000/10.000 entregues, mas SLO de 300s estourado
   (359,983s / 331,173s) — causa raiz: contenção entre continuações de scan e outboxes de dispatch
   no DynamoDB Stream global compartilhado (head-of-line blocking).
3. Decisão: plano de controle dedicado — `DueWorkTable` autoritativa sem stream, stream/relay/fila
   exclusivos para o scan, sharding horizontal versionado.
4. Implantado, canário de 1.000 aprovado (máximo 195,58s). Revalidação de 10k reprovou uma vez por
   bug real de checkpoint (alias não usado em `ExpressionAttributeNames` cancelando a transação
   silenciosamente) — corrigido e confirmado por um canário dedicado de 1.000 multi-shard
   (1.000/1.000 `TRIGGERED`, `pagesProcessed=2`/shard provando avanço de cursor, máximo 147,5s).
5. **Em andamento nesta sessão**: revalidação de 10k, agora roteando e-mail por um cohort de
   simuladores SES (não pela caixa Gmail real que as rodadas anteriores usaram sem perceber, antes
   do SES ter production access) — resultado ainda não disponível, será registrado aqui quando
   concluir.

## 3. O que o programa decidiu deliberadamente NÃO fazer (e por quê)

Da seção "Não fazer sem evidência"/"Não fazer neste ciclo" do `TODO.md`, consolidado:

- **RequestContext fast path**: sem instrumentação EMF implantada em `dev` ainda dando número real
  isolado; ganho não quantificável. Não é esquecimento — é P1 deliberadamente no fim da fila.
- **Memória de Lambda / tuning de concorrência SQS**: só 1 função com dado de alta confiança; mudar
  as outras 7 seria ajuste por adivinhação, não por evidência.
- **Endpoints compostos / GraphQL improvisado**: nenhuma tela bateu o critério de 5 condições que
  justificaria o custo.
- **Redis/ElastiCache, DAX, remover o BFF, trocar o DynamoDB, cache de API autenticada no
  CloudFront, Provisioned Concurrency em todas as Lambdas, consistência eventual em authorization**:
  fora de escopo por princípio (`principles.md` #1 — sofisticação segue complexidade observada, não
  medo hipotético) — nenhuma evidência deste programa justifica qualquer um.
- **`PriceClass_All`**: recomendado, não aplicado — decisão de custo/timing do Marcelo, não bloqueio
  técnico.

## 4. Estado dos "10 números" exigidos para fechar a primeira rodada (`TODO.md` "Critério de conclusão")

| Número exigido | Status |
|---|---|
| Throttling Lambda | ✅ zero na janela observada (PERF-01/13) |
| Overhead de cold start | ✅ 3,9%-10,0% por função, ~1,8-2,2s InitDuration (PERF-04) |
| Overhead do BFF | ✅ ~56ms p50 / ~21% (PERF-04) |
| Overhead do RequestContext | ⚠️ limite superior via `Duration`, não isolado (EMF não implantado à época — hoje já está, ver PERF-14) |
| Tempo em DynamoDB | ✅ desprezível, zero throttling (PERF-13) |
| Tempo no browser | ✅ PERF-03/PERF-09 (antes/depois do code splitting) |
| Requests por tela | ✅ inventariado, nenhum waterfall sequencial (PERF-07) |
| Memória correta BFF/HTTP Lambdas | ⚠️ só `reminder-producer` com confiança alta (PERF-05) |
| p95 warm das telas principais | ✅ PERF-04 (Items/Subjects) |
| Primeiro gargalo com 25/50 usuários simultâneos | ✅ é a quota de aplicação, não infra (PERF-11/11-b) |

**8/10 fechados com número real; 2/10 parciais (RequestContext e memória das 7 funções restantes) —
ambos por decisão deliberada de não instrumentar/adivinhar sem evidência, não por lacuna esquecida.**

## 5. Recomendação de fechamento

A primeira rodada do programa pode ser considerada **substancialmente concluída** assim que PERF-12
(10k) fechar com o cohort de e-mail sintético. Os 2 números parciais (§4) não bloqueiam esse
fechamento — já estão registrados como decisão consciente, não pendência esquecida. Próximo passo
natural após o fechamento: 100k (`results/PERF-12-100k-preparation.md`, já desenhado, aguardando a
aprovação de 10k) e, à parte do programa formal, a limpeza dos ~13 tenants sintéticos + ~24k
registros acumulados em `dev` quando o Marcelo decidir.
