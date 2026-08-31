# Wave 1b — Button `lg` / motion `slow` — Rodada 2 (revisão Claude)

Achado real do Codex Rodada 1 (8,7/10): inconsistência entre "significado reutilizável exige
segundo consumidor real" (Decisão 1) e "implementar `--duration-slow` junto do primeiro consumidor"
(Decisão 2); gatilho de `slow` definido por número (">160ms") em vez de categoria semântica de
movimento. Ambos corrigidos abaixo — mesma conclusão (não implementar agora), critério agora
consistente e não-numérico.

## Decisão 1 — Button `lg` (inalterada)

**NÃO implementar agora.** Critério único, aplicado às duas decisões: implementar quando existir
um caso de uso real e concreto (não hipotético) com semântica clara — nunca por antecipação
especulativa, e nunca automaticamente no primeiro caso que apareça se esse caso não tiver
semântica própria clara. Hoje não existe nenhum caso de uso real (nem primeiro, nem segundo) para
`Button lg` — nenhuma tela nomeia um CTA mobile full-width/touch-primary. WCAG 2.5.8 (Target Size)
é mencionado apenas como confirmação de que a ausência da variante não cria um problema de
acessibilidade agora, nunca como razão suficiente por si só — a razão suficiente é a ausência de
caso de uso real.

## Decisão 2 — motion `--duration-slow` (critério corrigido)

**NÃO adicionar agora**, com o critério corrigido: o gatilho não é "uma transição que precise de
>160ms" (número sozinho não estabelece semântica — qualquer 161ms arbitrário satisfaria isso
formalmente, achado correto do Codex). O gatilho real é a **primeira vez que o sistema implementar
uma categoria de movimento genuinamente distinta das existentes** — entrada/saída de uma superfície
sobreposta (modal, drawer, popover) que a própria arquitetura do catálogo (`design-system.md` §21,
§76-77) já nomeia como merecedora de tratamento de duração mais deliberado que uma transição de
hover/foco inline (`fast`/`default`). Como nenhum desses componentes existe ainda no código real
(Modal/Dialog/Drawer/Popover não implementados — ver escopo desta mesma sessão), a categoria
semântica não existe hoje, não apenas o número. O token nasce no mesmo commit que o primeiro desses
componentes, com o valor validado contra `prefers-reduced-motion` (que já existe como requisito
em `design-system.md` §21), não antes.

## Nota própria (cega, Rodada 2)

9.2 — as duas decisões usam agora o mesmo critério ("caso de uso real + categoria semântica
concreta", nunca contagem de consumidores nem limiar numérico isolado), o que fecha a inconsistência
apontada. Risco residual: a categoria "movimento de superfície sobreposta" ainda é minha inferência
de onde `slow` seria semanticamente necessário — o catálogo não a nomeia explicitamente por esse
termo, mas §76-77 (z-index de dropdown/modal/toast) e §21 (motion) juntos sustentam a inferência.
