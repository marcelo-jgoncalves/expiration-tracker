---
status: final (rodada 3)
---

# Nota da Rodada 3 — Claude (autor da proposta)

Codex: 8,3/10. Não aprovou. Achados reais e mais profundos - incluindo um bloqueio que o Codex
reproduziu ao vivo (`COGNITO_USER_POOL_ID="local-test"` falha na validação de formato do verificador
JWT do Cognito, antes mesmo de chegar na linha 61 que eu tinha como alvo).

- **Sintética/natural**: falta operacionalizar - preciso registrar início/fim da janela natural e só
  rodar a rajada sintética DEPOIS desse fechamento (exclusão temporal, não filtro por ID); o buffer de
  ingestão não pode ampliar a janela amostrada (a consulta espera mais, a janela consultada continua a
  mesma); corrigir "tráfego real de produção" para "tráfego real em `dev`, sem usuário real".
- **Mann-Whitney não prova igualdade de medianas** sem hipóteses adicionais sobre o formato das
  distribuições - trocar média por mediana não resolve essa interpretação sozinha. Preciso reportar
  Mann-Whitney como teste de distribuição geral, medianas como descritivo separado, e definir a
  fórmula exata (correção de continuidade + correção por empates) em vez de "mid-rank" vago. Falta
  também aplicar correção de comparações múltiplas (Holm) aos testes válidos, não só declarar
  "reportado isoladamente".
- **Métrica `AWS/Lambda Errors` com dimensão `FunctionName` agrega TODAS as versões/origens** - não dá
  pra separar natural de sintética por essa métrica; a única forma de isolar é por exclusividade
  temporal (mesmo fix do primeiro achado). Faltava também definir numericamente "subiu" e o
  tratamento de denominador zero.
- **Script de sourcemap ainda falha antes do ponto pretendido**: confirmado ao vivo pelo Codex -
  `COGNITO_USER_POOL_ID="local-test"` quebra o formato exigido pelo verificador JWT do Cognito no
  carregamento do módulo, antes de eu conseguir chamar `handler()`. Preciso de um ID sintaticamente
  válido (`us-east-1_LocalTest123`, testado pelo próprio Codex). Os outros 2 handlers + 1 worker
  continuavam "a definir na execução" - inaceitável, preciso committar agora, concretamente.
- **`--log-type Tail` traz só os ÚLTIMOS 4KB** - não posso presumir que `START` sobreviva nesse
  recorte; preciso extrair o `RequestId` diretamente da própria linha `REPORT` (que já carrega
  `RequestId:`), nunca depender de `START` estar presente.
- **Fixtures ainda incompletas**: faltam JSONs concretos pros 4 handlers autenticados + worker;
  claims sintéticas não garantem membership real no banco (preciso assumir resposta de autorização
  vazia/negada como resultado esperado válido, não um erro); afirmação errada sobre o BFF - `GET
  /bff/session` sem cookie responde 200 com `authenticated:false`, nunca 401 (corrigido pelo Codex
  lendo o código real); fixture do worker precisa verificar processamento observado de verdade
  (`batchItemFailures`), não só ausência de erro (kill switch pode retornar sucesso sem processar
  nada).
- **5 registros de `START` não provam exclusividade de versão pra janela inteira** - correção aceita
  como evidência AMOSTRAL, não certificação total; preciso fazer isso por handler, com tabela
  handler→versão→intervalo→consulta.
- **`rollback.yml` reverte TODAS as funções do manifesto, não um handler seletivo** - minha matriz
  prometia uma reversão que o mecanismo real não oferece. Preciso de uma ação compatível: rollback
  do deploy INTEIRO (todos os 5 handlers de A), nunca "desse handler específico".

Nota geral desta rodada (minha, como autor): **6,2/10** - o achado mais sério é o bloqueio real que o
Codex reproduziu ao vivo (Cognito Pool ID), prova concreta de que "a definir na execução" escondia
detalhes que na prática quebram. Corrigido na Rodada 4 com tudo concreto, verificado por leitura direta
do código de cada handler envolvido (`items-handler.ts`, `document-archive-handler.ts`,
`http-adapter.ts:10`, `outbox-sweeper-handler.ts` escolhido como worker seguro/idempotente em vez do
WhatsApp digest, que dependeria de Secrets Manager real e um kill switch de vendor externo).
