---
status: final (rodada 1)
---

# Nota da Rodada 1 — Claude (autor da proposta)

Codex: 8,2/10. Não aprovou a metodologia. Todos os 7 achados são reais.

- **Baseline incompleta**: faltam `documents-handler`/`document-archive-handler` (receberam A também);
  `items-handler` tem só 4 frias no "antes", abaixo do piso — a regra de mínimo precisa valer dos DOIS
  lados, não só no "depois". Procede.
- **Atribuição causal indevida**: memória mais alta também acelera import/inicialização (CPU
  proporcional à memória, documentado pela AWS), então `Init Duration` menor não isola o efeito de B
  (minificação) — o experimento só pode concluir sobre o efeito combinado A+B, nunca decompor qual
  mudança causou qual parte. Procede, e eu tinha misturado as duas atribuições.
- **"Duration nunca inclui Init" é falso em suppressed init**: correção aceita — ausência de
  `@initDuration` deve ser descrita como "sem inicialização explícita no REPORT", não "garantidamente
  quente".
- **Teste de sourcemap local não é equivalente ao runtime Lambda real**: não prova que o ZIP
  implantado contém o mapa, que a versão servida tem `NODE_OPTIONS` correto, nem o comportamento do
  runtime gerenciado. Aceito a alternativa do Codex: teste local + inspeção direta do artefato/config
  realmente deployados, registrando explicitamente que o caminho de erro do runtime Lambda em si não
  foi exercitado.
- **Script com erro técnico real**: `.mjs` não aceita `require()` direto (preciso de `createRequire`
  ou `.cjs`); preciso de uma exceção determinística em código próprio (BFF valida env vars no
  carregamento, o script podia falhar antes de chamar `handler`); preciso separar resolução de
  arquivo/linha (sourcemap) de preservação de nome (`keepNames`) — são coisas diferentes que eu
  colapsei em um critério só.
- **Invocação sintética sem garantias reais**: concorrência não garante cold start; preciso usar
  `RequestResponse`, qualificador explícito `live`, registrar `ExecutedVersion`/erros/resposta real
  (200 da API Invoke não prova sucesso do handler); separar amostras naturais de sintéticas; nunca
  misturar a taxa fria sintética com a taxa fria do tráfego natural.
- **Correlação de versão errada**: `get-alias` não retorna `MemorySize`/`LastModified` (isso vem de
  `get-function-configuration`); `LastModified` não prova o instante da atualização do alias; preciso
  correlacionar por log stream/START event, não só "consultei agora, deve estar certo".
- **Falta critério de veredito definido ANTES da coleta**: mínimo por estrato, regra explícita de
  melhoria/regressão/inconclusivo considerando magnitude E incerteza (não só "média menor"), prazo e
  orçamento fixo de coleta (nunca continuar até aparecer resultado favorável), preservação de outliers.
- **Taxa de erro é por gateway, não por handler** (dimensão `ApiId`): preciso separar BFF de recursos;
  publicar numerador/denominador sempre; invocação direta via `aws lambda invoke` não alimenta métrica
  do API Gateway (preciso contabilizar isso à parte); restaurar smoke funcional (B é global).

Nota geral desta rodada (minha, como autor): **6,8/10** — a estrutura geral (janelas antes/depois,
separação de métricas, correlação de versão, teste de sourcemap, critério handler-a-handler) estava no
caminho certo, mas cada detalhe de execução tinha uma lacuna real de rigor que só ficou visível quando
alguém tentou de fato aplicar a metodologia ponta a ponta. Corrigido por completo na Rodada 2.
