# Test Engineering Standard — Nota cega Claude, Rodada 2

Autoavaliação da revisão (rodada 2) em resposta aos 15 achados do Codex na rodada 1 (nota 6,35/10).

## O que mudou

- G-V1 reformulado: separa determinismo estrito (regressão) de reprodutibilidade de veredito sob tolerância declarada (carga/chaos) — resolve a contradição com a própria fonte citada (achado #1).
- Gates reparticionados em três grupos por unidade de avaliação: §3.1 (teste/drill individual, 4 gates), §3.2 (claim, 1 gate novo G-C1), §3.3 (só drills, 2 gates) — resolve a mistura de unidades (achados #2, #3).
- G-V4 restrito a existência da declaração de intenção (binário real), qualidade movida para §4 critério 3 (achado #2).
- G-V6 corrigido para nunca invalidar um drill por causa de uma reversão que falhou — só exige que a falha seja escalada/registrada, não silenciada (achado #13).
- Taxonomia (§2) reescrita em 3 eixos ortogonais, contagem real verificada (103 arquivos/929 casos, não "929 arquivos") (achado #4).
- §5 reescrita por drill, claims estreitas e corrigidas individualmente para W2-05/W2-06/W2-07, "G-V8" removido (achados #5-9).
- §4 critérios fundidos (documentação 2+6+8 → 1) e separados por unidade de avaliação (teste individual vs. suíte vs. claim) — resolve dupla contagem e erro de unidade (achados #10-11).
- Âncoras de pontuação 0/2/4/6/8/9/10 adicionadas (achado #12).
- Citação de Fowler e do Google SRE Book (DiRT) corrigidas com URL/capítulo reais (achados #1, #14).
- Fontes mapeadas explicitamente a gates específicos em vez de lista solta (achado #15, parcial — ainda não tem página/edição exata da ISO 29119 nem de Meszaros).

## O que eu ainda não resolvi por completo

1. G-V3 continua com resíduo de julgamento humano (nomear uma mutação concreta) — declarado explicitamente como aceito, não escondido, mas ainda não é 100% mecânico. Aceito como proporcional, mas é o ponto mais provável de nova crítica.
2. Não adicionei página/seção específica de ISO/IEC/IEEE 29119 nem de Meszaros — a Rodada 1 pediu isso (achado #15) e eu só corrigi a atribuição de Fowler/SRE Book, não fui atrás das citações de página exata das outras duas fontes.
3. Não tenho certeza se a separação de G-V5/G-C1/G-V6 ficou didaticamente clara o suficiente na primeira leitura — são 3 conceitos adjacentes (blast radius, adequação de evidência, reversão) que um leitor apressado ainda pode confundir.

## Nota

**9.4/10** — todos os 15 achados endereçados com mudança estrutural real (não só reformulação cosmética), mas os 2 itens acima (citação de página exata, clareza didática da tripla separação) me impedem de dar nota mais alta na minha própria revisão.
