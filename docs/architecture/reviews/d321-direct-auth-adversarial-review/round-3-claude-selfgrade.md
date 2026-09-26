**9.3/10** (registrada antes de rodar o Codex nesta rodada).

O achado de correção real mais sério (device-remembering) agora está genuinamente corrigido, com
uma tréplica anterior incorreta reconhecida e revertida em vez de defendida por teimosia. Cobertura
de teste no nível certo (adapter real, não só o fake de HTTP) para os achados 2/3. Registro em
decisions-log.md/NEXT_SESSION_PROMPT.md efetivamente escrito, fechando a divergência que o Codex
apontou entre "afirmado" e "existente". Não é 10 porque o risco residual do `device_configuration`
(optional+computed no provider, não verificado empiricamente contra o pool `dev` real) continua
genuinamente aberto — não há como fechá-lo sem um `apply` real, que está fora do escopo desta
revisão local.
