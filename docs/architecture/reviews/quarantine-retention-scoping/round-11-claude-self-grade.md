# Round 11 — Claude self-grade (written before seeing Codex's Round 11 grade)

**Nota: 9.4/10**

A objeção da Rodada 10 era exatamente correta (helper != garantia mecânica) e é fechada aqui com o
tipo certo de mecanismo — uma regra ESLint real, escopada, gatilhada por `npm run lint` já
obrigatório no CI, mesma classe de enforcement que `no-console` já usa hoje neste repositório. Não é
10 porque a regra em si (o padrão AST exato, o glob de arquivos) ainda não foi escrita/testada
contra o parser real do ESLint deste projeto — fica para a sessão de implementação, mas a decisão de
design (que mecanismo impõe a garantia) está fechada.
