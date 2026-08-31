# Wave 1b — Button `lg` / motion `slow` — Rodada 1 (proposta Claude)

## Decisão 1 — Button `lg`

**NÃO implementar agora.** `--control-height-lg` (44px) permanece um token de escala geral já
existente em `tokens.css`, sem virar variante do `Button`. Razão: nenhum call site real do
sistema precisa de um botão 44px hoje — `sm`(32px)/`md`(36px) já superam o mínimo WCAG 2.2 Target
Size (24px) com folga, e nada no roadmap atual (M4 em diante) nomeia um CTA mobile full-width ou
touch-primary que justifique o tamanho maior. Adicionar a variante agora seria exatamente o tipo
de token/variante especulativa que `design-system.md` §63 ("nova variante precisa possuir
significado reutilizável") e o princípio geral de "proibição de valores arbitrários" desaconselham
— o significado reutilizável só existe quando há um segundo consumidor real, e hoje há zero.
Residual nomeado permanece em D-130/D-132: revisitar quando um fluxo mobile-first concreto
precisar de CTA 44px.

## Decisão 2 — motion `--duration-slow`

**NÃO adicionar agora.** Nenhuma transição real do CSS do projeto usa algo além de
`--duration-fast`/`--duration-default`. `design-system.md` §21 nomeia `motion.slow` como parte do
catálogo conceitual (arquitetura/roadmap, não implementação obrigatória imediata — D-130 Decisão 1
já classificou esse documento como "roadmap, não afirmação de que já existem"). Introduzir o token
agora sem nenhum consumidor real violaria a mesma regra de token especulativo. Diferença chave
frente ao Button: aqui não há sequer um token de escala já existente (como `--control-height-lg`)
esperando um consumidor — seria criar do zero. Fica como resíduo nomeado, a implementar no mesmo
commit da primeira transição real que precisar de >160ms (ex. entrada de modal/drawer, quando esses
componentes forem implementados).

## Nota própria (cega)

9.0 — ambas as decisões são mecanicamente diretas (não introduzir token/variante sem consumidor
real), consistentes com o princípio já `APPROVED` do sistema, e resolvem o resíduo nomeado sem
gerar nova ambiguidade. Risco de estar sub-analisando: nenhuma pesquisa externa de mercado feita
(não é necessária — não é decisão de padrão de mercado não resolvido, é aplicação de uma regra já
aprovada a dois casos concretos).
