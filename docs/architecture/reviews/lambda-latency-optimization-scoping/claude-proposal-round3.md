---
status: draft
owner: Marcelo
authority: proposta Rodada 3 do protocolo Claude↔Codex (AGENTS.md §4) — nível 3-4, submissão pedida por Marcelo
---

# Latência percebida de carregamento de dados — Rodada 3

Responde aos 12 achados da Rodada 2 + 1 achado próprio novo (trace do BFF não propaga contexto de
X-Ray para o backend). Dados brutos revisados: janela de 48h, ordenação/tempo explícitos, campos
originais preservados, RequestId/log stream/TraceId citados.

## Achado novo (meu, não do Codex): os 2 saltos não estão ligados no X-Ray hoje

Tentei correlacionar um request do `bff-handler` com o `items-handler`/`memberships-handler` que
ele chama via `batch-get-traces`. O trace do `items-handler` (`1-6aba920c-7c621bd4346834a5180fb43f`,
cold real, 2026-09-28) é um segmento **raiz isolado** — sem `parent_id` apontando pra um segmento do
BFF. Verifiquei `fetchBackend.fetch()` (`bff.ts:37`): usa o `fetch()` nativo do Node sem propagar o
cabeçalho `X-Amzn-Trace-Id` recebido na requisição original. **Consequência**: hoje é
tecnicamente impossível medir "os dois saltos ficaram frios no MESMO request" com a instrumentação
existente — cada salto produz uma árvore de trace desconectada da outra. Registro como achado
separado, não corrigido nesta proposta (mudança de código de observabilidade, fora do escopo de
"por que a tela demora"), com recomendação de propagar o header em uma fatia futura para isto ficar
mensurável de verdade.

## Correção do achado de duplo cold start (achado 2.iv do Codex)

**Retirado**: "pior caso ~8,4s" (somava a duração TOTAL do BFF, que já inclui a espera pelo backend,
com a duração TOTAL do backend — dupla contagem do mesmo tempo de espera).

**Substituído por**: os `Init Duration` de dois processos SEPARADOS (BFF e handler de backend) SÃO
tempo morto genuinamente sequencial quando ambos os saltos precisam inicializar no mesmo request —
BFF inicializa (até ~2,3s observado), SÓ DEPOIS chama o backend, que pode também precisar inicializar
(até ~2,3s observado) antes de processar. Piso combinado plausível de **Init Duration puro**: até
~4,6s (2 × ~2,3s), antes de qualquer lógica de negócio rodar — isto NÃO é medido diretamente hoje
(ver achado novo acima), é um limite superior derivado de duas amostras independentes de
`Init Duration`, declarado explicitamente como não-medido-end-to-end.

## Correção do achado de frequência de cold start (não constante)

Puxei uma janela de 48h do `bff-handler` (362 eventos `REPORT`, 2026-09-28) —
**nenhum evento tem `Init Duration`** nessa janela específica, ao contrário da amostra menor da
Rodada 2. Padrão de invocação nessa janela: intervalos de ~300s bem regulares, sugerindo tráfego
frequente (polling/sessão) mantendo o BFF quente na maior parte do tempo. `items-handler`/
`memberships-handler` (chamados só quando alguém navega de verdade, sem esse padrão de ping)
continuam mostrando cold starts recorrentes na mesma janela de 48h (múltiplos eventos com
`Init Duration` 1,64-2,29s espalhados ao longo do dia).

**Conclusão corrigida**: cold start não é uma propriedade fixa de "este sistema é lento" — é uma
função de quão recentemente cada Lambda específico foi invocado. Handlers chamados com frequência
(por tráfego automático ou uso ativo) ficam quentes; handlers chamados só por navegação humana
esporádica pagam Init Duration com regularidade real, **confirmado**, não mais "consistente" como
propriedade universal.

## Correção B — minify com sourcemap que resolve de verdade

`sourcemap: "external"` → **`sourcemap: "linked"`** (grava o `.map` E referencia
`//# sourceMappingURL=index.js.map` no bundle — `"external"` nunca emite essa referência, achado
real do Codex, confirmado na documentação do esbuild). `keepNames: true` mantido.

**Escopo explícito**: `scripts/build-lambdas.ts` compartilha as opções entre TODOS os ~50 handlers
(não existe mecanismo de override por handler hoje). Esta proposta aceita minificar TODOS os
handlers, não só os 5 candidatos de A — introduzir um mecanismo de override seria mudança de
tooling nova, desproporcional ao achado. Declarado explicitamente, não escondido.

**Teste de validação corrigido** (achado real do Codex: `redactor.ts:90` só preserva a PRIMEIRA
LINHA de qualquer erro capturado pela aplicação — `stackSummary`, decisão deliberada de privacidade,
não um bug). Isso significa que testar com um erro de negócio comum (`AppError`) NUNCA provaria
nada sobre sourcemap, minificado ou não — o log da própria aplicação já corta o stack antes disso
importar. **Teste correto**: provocar uma exceção que ESCAPA do `try/catch` da aplicação por
completo (nunca passa por `SecureLogger`/`redactError`) — o runtime do Lambda grava o stack nativo
completo no CloudWatch para qualquer invocação que termina com exceção não capturada, independente
do código da aplicação. Executar isso contra uma função de teste dedicada (não um handler real
servindo tráfego de `dev`), comparar o stack ANTES (bundle atual) e DEPOIS (minificado+`linked`) do
mesmo erro sintético.

## Correção do plano de validação (achados de amostragem/versão/reversão)

1. **Versão/alias**: este projeto publica versões e usa alias `live` (`AGENTS.md`/`cd.yml`) —
   qualquer mudança de configuração ou de bundle precisa passar pelo pipeline de CD normal
   (`develop` → CI verde → CD publica nova versão → atualiza alias), nunca
   `update-function-configuration` direto contra `$LATEST` (que o alias `live` não serve).
2. **Amostragem**: mínimo 5 observações frias INDEPENDENTES por handler (forçadas por deploy real de
   nova versão, que cria ambiente de execução novo na invocação seguinte) + 10 mornas, identificando
   a versão publicada em cada leitura (`Resource` do X-Ray ou o próprio nome do alias/versão nos
   logs).
3. **Critério de sucesso**: sem alvo numérico fixo nesta primeira rodada (Codex já recomendou isso
   na Rodada 1) — comparar a distribuição de `Init Duration`/`Duration` antes/depois para os mesmos
   handlers, mesma carga.
4. **Regra de reversão explícita**: se a taxa de erro subir (comparar contagem de `Status: error`
   nos `REPORT` antes/depois) OU nenhuma melhoria mensurável de `Init Duration` aparecer depois de
   A+B, reverter o `terraform apply`/rebuild — mudança é só configuração, sem migração de dado,
   reversão é sempre segura e imediata.
5. `terraform plan` mostra os overrides de `memory_size` nos 5 handlers (não 6 — `pdf-parser-task-handler`
   removido, ver abaixo) + a env var `NODE_OPTIONS` se usada para outro propósito futuro (nenhuma
   nova env var é necessária pra esta rodada, já que a correção real é `sourcemap:"linked"`, não uma
   env var). `lambda_function.tftest.hcl:91` continua correto (testa o default do MÓDULO, não os
   overrides de caller) — confirmado pelo próprio Codex na Rodada 2, sem mudança aqui.

## Correção de escopo (pdf-parser-task-handler removido)

`pdf-parser-task-handler` é invocado como task de Step Functions (pipeline de extração
assíncrona), não uma rota HTTP que uma tela aguarda diretamente — fora do escopo de "tela demora a
carregar". Removido da lista de A. **Candidatos finais de A**: `bff-handler`, `items-handler`,
`memberships-handler`, `documents-handler`, `document-archive-handler` — os 3 primeiros com
baseline real medido, os últimos 2 por serem handlers HTTP tenant-facing do mesmo perfil (nunca
medidos diretamente, candidatos razoáveis pela mesma lógica, não uma alegação de dado que não
tenho).

## O que permanece sem mudança desde a Rodada 1

C (não externalizar o SDK da AWS) e D (não propor SnapStart/provisioned concurrency) — aceitos pelo
Codex nas 2 rodadas anteriores, sem achado novo contra eles.
