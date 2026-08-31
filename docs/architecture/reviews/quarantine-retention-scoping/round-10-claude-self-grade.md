# Round 10 — Claude self-grade (written before seeing Codex's Round 10 grade)

**Nota: 9.4/10**

Em vez de tentar enumerar manualmente uma 4ª vez (padrão que já falhou 3 vezes seguidas), esta
rodada muda a arquitetura para eliminar a classe de erro: um único helper compartilhado no domain
layer, mesma disciplina já usada neste repositório para builders de escrita (`occ.ts`). Isso é
estruturalmente mais forte que qualquer lista, por mais completa que pareça — não depende de nenhum
revisor (humano ou IA) encontrar todos os sites por leitura, porque só existe um lugar onde a
garantia é escrita. Não é 10 porque a migração dos 5 sites conhecidos para o helper ainda é
trabalho da sessão de implementação futura, não algo que este design prova por si só ainda estar
livre de um 6º site esquecido até a migração realmente acontecer — mas essa é precisamente a
natureza de uma correção estrutural: ela precisa ser aplicada uma vez, não guardada na cabeça de
alguém para sempre.
