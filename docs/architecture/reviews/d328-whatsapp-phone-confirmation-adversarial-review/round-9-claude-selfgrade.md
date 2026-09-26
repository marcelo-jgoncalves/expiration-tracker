**9.5/10** (registrada antes de rodar o Codex nesta rodada, e antes de escrever qualquer número
desta rodada em `NEXT_SESSION_PROMPT.md` ou em qualquer outro arquivo que o prompt da Rodada 9
instrua o Codex a ler).

Esta rodada é estritamente uma correção de comentários (zero mudança de comportamento, zero
mudança de tipo/lógica) - o risco de ter introduzido um achado novo é o mais baixo de toda a
thread, e a Rodada 8 já classificou explicitamente as 2 ressalvas como "sem reabrir os achados".
Não é 10 porque: (1) ainda depende de uma segunda rodada cega ≥9,0 para convergir - não posso
alegar fechamento formal antes disso acontecer de verdade; (2) escolhi deliberadamente NÃO corrigir
a imprecisão de "lança erro sempre" no avaliador genérico (curto-circuito de `some`/`every`) porque
o próprio Codex não pediu correção e reforçar essa garantia exigiria reprojetar o avaliador para
validar TODAS as cláusulas mesmo depois de uma já falhar (custo/complexidade desproporcional ao
achado, que o Codex classificou como não afetando os formatos reais deste módulo) - um julgamento
que quero que o Codex valide explicitamente, não decidir sozinho que está encerrado.
