---
status: final (rodada 2)
---

# Nota da Rodada 2 — Claude (autor da proposta)

Codex: 8,4/10. Não aprovou. Todos os 7 achados são reais e mais profundos que os da Rodada 1 — desta
vez sobre a reprodutibilidade exata do plano, não sobre lacunas estruturais.

- **Contradição real entre "separar amostras" e "completar o mínimo" com sintéticas**: eu proibia
  misturar natural/sintética mas ao mesmo tempo deixava a rajada sintética "completar o piso" — não
  dizia qual população entra no teste estatístico. Procede, preciso decidir explicitamente que
  sintética NUNCA entra na comparação estatística, só serve como smoke/descritivo.
- **Mann-Whitney testa distribuição, não diferença de médias**: meu critério de decisão misturava um
  teste de uma coisa (distribuição) com uma conclusão sobre outra (média) — inconsistência real.
  Preciso alinhar o estimando (mediana, mais robusto e mais coerente com Mann-Whitney) ao teste.
- **Indicador de erro por handler mede mensagens, não execuções falhas**: uma invocação pode logar
  `.error()` várias vezes; e `handler-timing.ts`'s `finally` propaga exceção sem chamar `.error()` -
  uma falha de runtime pode não aparecer nesse sinal de jeito nenhum. Confirmei lendo o código
  (`handler-timing.ts:33-38`). Preciso de `AWS/Lambda Errors/Invocations` como sinal complementar.
- **Script de sourcemap ainda não executável**: trocar `.mjs` por `.cjs` não resolve o `require()`
  disparar a validação de env vars do module-load do BFF antes de eu poder configurar nada - preciso
  fornecer os env vars fake ANTES do `require()`, e escolher o ponto exato de exceção dentro do
  handler (não no module-load). Também: presença do `.map` local não prova que o ZIP realmente
  deployado é o mesmo par testado - preciso extrair o ZIP real via `get-function --qualifier live`.
- **Correlação do Invoke incompleta**: o CLI não retorna o `RequestId` de execução diretamente no jeito
  que eu presumi; `FunctionError` é campo de metadado da resposta, separado do payload. E achado
  concreto: `notification-router-handler` recebe DynamoDB Streams, não SQS - meu fixture de smoke
  estava tecnicamente errado, teria sido ignorado silenciosamente.
- **Ausência de `cd.yml` não prova versão única**: existe também `rollback.yml`; preciso checar os
  dois, mais um spot-check real do campo `Version` no log START, não só inferência pela ausência de
  workflow de deploy.
- **Falta matriz explícita resultado→ação**: eu tinha rótulos estatísticos soltos sem dizer o que fazer
  quando handlers divergem entre si, ou quando o sinal de erro sobe.

Nota geral desta rodada (minha, como autor): **6,5/10** — a estrutura de alto nível já estava certa
desde a Rodada 1 (janelas, separação de métrica, correlação de versão, critério antes da coleta), mas
cada mecanismo concreto ainda tinha uma lacuna de execução real - o padrão da Rodada 2 é sempre "a
ideia está certa, o script/query específico ainda quebra na prática". Corrigido por completo na
Rodada 3, incluindo um ponto de exceção real e verificado por leitura direta do código-fonte
(`bff-handler.ts:61`, `toBffRequest`).
