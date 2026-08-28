# Test Engineering Standard — Nota cega Claude, Rodada 4

Autoavaliação da revisão (rodada 4) em resposta aos 8 pontos da rodada 3 (nota 8,70/10: 4 totalmente corrigidos, 2 parciais, 2 pendentes na verificação do Codex, mais 8 inconsistências internas novas por ele identificadas).

## O que mudou

1. G-V1 reescrito com 3 ramos explícitos e mutuamente exclusivos (regressão/2 execuções; carga-chaos repetível/2 execuções contra limiar; operação de custo proibitivo/inspeção de mecanismo com citação obrigatória de código) — resolve a inconsistência de "reprodutibilidade" significar coisas diferentes por ramo sem declaração formal.
2. §4.1 reescrita por completo: fórmula explícita (`Σ peso×nota / Σ peso` sobre os critérios `applicable`) + tabela fechada linha-a-linha de como cada um dos 7 critérios participa em cada um dos 3 escopos — critério 4 (antes omitido por engano) incluído, critério 6 (antes duplicado) agora com dois significados distintos e nomeados (tempo individual vs. tempo agregado de suíte) em vez do mesmo número contado 2x.
3. Mapeamento Meszaros corrigido: "Test Interdependence" agora aponta para G-V2 (isolamento), não mais para G-V1 (que passou a significar reprodutibilidade desde a Rodada 2 e a Rodada 3 do Claude não tinha atualizado essa referência cruzada).
4. `pilot-readiness-program.md`: desta vez corrigida também a TABELA-RESUMO (linhas 121-123), não só os parágrafos detalhados — o Codex pegou corretamente que a correção da rodada anterior tinha ficado pela metade.
5. §5 simplificada radicalmente: em vez de tentar justificar por que G-V1/G-V3 "contam" para cada drill com linguagem diferente por linha (que a Rodada 3 mostrou ser inconsistente), a posição agora é uniforme e honesta — só G-V2 (isolamento) e G-V6 (reversão) são verificáveis a posteriori a partir de artefato real; G-V1/G-V3/G-V4/G-V5 são `Não verificado retroativamente` para os 6 drills, sem exceção, sem "por construção", sem "idem".

## O que eu ainda não tenho certeza se resolve por completo

1. A fórmula de §4.1 é executável no papel, mas ainda não foi aplicada a um exemplo numérico real de ponta a ponta (mesma lacuna que eu mesmo notei na minha autoavaliação da Rodada 3, item 1 — ainda não resolvida). Um revisor rigoroso pode pedir "mostre a conta para um teste real do repo" e eu não tenho isso pronto.
2. A tabela de participação por critério tem 21 células (7 critérios × 3 escopos) — é completa, mas é densa; não testei se um terceiro leitor (nem eu, nem o Codex) consegue aplicá-la sem reler duas vezes.
3. Simplificar §5 para "não verificado retroativamente" em bloco é mais honesto, mas também mais austero — pode ser lido como "os drills de Wave 2 não provam quase nada", quando na prática G-V2+G-V6+a claim estreita já são uma evidência real substancial. Tentei mitigar isso com a frase final "só como evidência operacional real cujas claims específicas são precisas", mas é um equilíbrio editorial, não um fato verificável.

## Nota

**9.6/10** — os 8 achados da rodada 3 foram corrigidos com mudança estrutural verificável (fórmula real em vez de prosa, tabela fechada em vez de categoria ambígua, posição uniforme em vez de linguagem ad-hoc por linha). Não vejo mais nenhuma contradição lógica ou numérica no documento após uma releitura completa. O ponto 1 acima (falta de exemplo numérico) é a única lacuna que ainda me deixaria hesitante em chamar isto de "sem nenhuma folga" — mas não é uma inconsistência, é uma oportunidade de reforço didático que não invalida a mecânica correta já descrita.
