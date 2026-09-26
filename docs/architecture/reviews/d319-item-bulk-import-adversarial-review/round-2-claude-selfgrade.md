**9.0/10** (registrada antes de rodar o Codex nesta rodada).

Todos os 4 bugs de correção reais (claim órfã, colisão de delimitador, idempotência ignorando
tipo, timestamp calendário-inválido) corrigidos com a abordagem correta (não a minha proposta
inicial incompleta da Rodada 1, mas a que o próprio Codex especificou). Escopo da correção da
claim órfã ampliado deliberadamente para cobrir TrackedSubject também, evitando um estado
inconsistente. Pesquisa externa declarada explicitamente (NÃO, com justificativa). Não é mais alto
porque a correção do achado 1/2 introduz uma nova forma de falha do job (FAILED_INDETERMINATE_
ROW_STATE) que ainda não tem nenhuma via de RECUPERAÇÃO automática ou documentada para o operador
além de "investigar manualmente" - isso é estritamente melhor que perder a linha silenciosamente,
mas não é uma solução completa de reprocessamento.
