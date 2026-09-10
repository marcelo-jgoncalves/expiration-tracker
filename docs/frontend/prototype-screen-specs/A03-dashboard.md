# A03 — Visão geral (Dashboard)

**Revisado em 2026-09-09** — pós auditoria de spec visual (`docs/architecture/reviews/screen-spec-audit-2026-09-09/A03-audit-record.md`). Mudanças: rota reconciliada com `docs/frontend/p0-screen-inventory-plan.md`, card condicional de armazenamento (addendum D-2xx) adicionado, estados assíncronos por card nomeados, mitigação local dentro da restrição de sistema do grid de métricas (ver `system-level-findings.md` SLF-01 para o achado de nível de sistema — não redesenhado aqui), motion explícito.

**Rota:** `/app/:orgId/dashboard`
**Acesso:** todos os papéis (OWNER/ADMIN/MEMBER/VIEWER)
**Nav ativo:** "Visão geral"

## Estrutura

1. `PageHeader`: título "Visão geral", descrição "O que precisa da sua atenção agora em {nome da organização}.", sem ações de cabeçalho.
2. **Grid de métricas** (cards-link `<a>`, grid `repeat(4,1fr)` → 2 col ≤900px → 1 col ≤520px; 5 colunas → 3 col ≤1100px → 2 col ≤900px → 1 col ≤520px quando o card condicional de armazenamento está presente):
   - **Mitigação local dentro da restrição de sistema (achado SYSTEM CONSTRAINT SLF-01 — o grid plano de cards continua sendo um padrão compartilhado, não redesenhado a partir desta tela; o que segue é o ajuste local legítimo enquanto a correção de nível de sistema não chega)**: os 4 (ou 5) cards não são visualmente idênticos entre si — **Vencidos** (quando `overdue > 0`) usa `surface.brand.subtle`→ não, usa `status.danger.surface` como fundo do card (não apenas do número) e ocupa a mesma célula de grid mas com peso tipográfico do contador maior (`Display`, 36/44, ao invés de `Page Title`, 32/40, usado pelos demais) — o único card com tratamento de fundo colorido, reservado para o caso realmente crítico. Os demais 3 cards mantêm fundo `surface.default` padrão. Isso comunica hierarquia de risco pela composição, não apenas pelo tom do texto.
   - Vencidos — contagem grande (tabular-nums, papel `Display` quando `overdue>0`, `Page Title` quando zero) + label. Link para Vencimentos filtrado por vencidos.
   - Vencem em 7 dias — contagem (`Page Title`, tabular-nums) + label.
   - Aguardando revisão — link para Fila de revisão.
   - Requisitos em falta — link para Requisitos filtrado.
   - Cada card tem texto oculto (`sr-only`, position absolute 1x1px) descrevendo o destino para leitores de tela, via `aria-describedby`.
   - **Card condicional de armazenamento** (addendum D-2xx, `p0-screen-inventory-plan.md` A03): renderizado apenas quando `warningLevel` é `WARNING`/`CRITICAL`/`OVER` (≥80% de `limitBytes` comprometido). Mostra barra de porcentagem (used/reserved/limit) + uma linha explicando o que acontece com novos uploads no estado `OVER` ("Novos uploads bloqueados até liberar espaço — arquivos existentes não são afetados."). Link para A19 (seção de armazenamento). Abaixo do limiar, o card não é renderizado — nunca aparece vazio ou desabilitado.

## Estados assíncronos (achado Major da auditoria — antes ausentes)

- Cada um dos 4 (ou 5) cards carrega **independentemente**: um card em `loading` mostra um
  `Skeleton` do mesmo tamanho/posição final (sem layout shift), enquanto os outros já carregados
  mostram seus valores reais — nunca a página inteira em branco esperando todos os contadores.
- Falha de um contador específico: o card mostra "Não foi possível carregar" + ação "Tentar
  novamente" **só naquele card** — os demais permanecem funcionais e visíveis; nunca zera os outros
  contadores por causa de uma falha parcial.
- **`EMPTY_TRUE` genuíno** (tenant novo, todos os contadores em zero): os cards mostram "0" com o
  mesmo tratamento visual neutro de sucesso — nunca um ícone/cor de erro ou de alerta. O painel
  "Precisa de atenção primeiro" mostra o `EmptyState` "Nenhum vencimento pendente de atenção." ao
  invés da tabela, com tom positivo, não um vazio genérico.
- O painel "Precisa de atenção primeiro" tem seu próprio ciclo de loading/erro/retry, independente
  dos cards de métrica acima dele.

## Painel "Precisa de atenção primeiro"

Header com título + contagem (`{n} vencimentos`), rodapé com link "Ver todos os vencimentos" → A04.
Corpo: `DataTable` compacta com colunas:
   - Vencimento (primary): nome (link) + categoria como `CellSecondary` abaixo — nome trunca em 2
     linhas com `title` completo, categoria em 1 linha.
   - Data de vencimento (numeric, tabular-nums).
   - Urgência: `UrgencyIndicator` com tons `critical` (vencido) / `warning` (vence em N dias) /
     `neutral`.
   - Linhas: ordenadas com vencidos primeiro, depois a vencer em breve (não inclui itens sem
     urgência).
   - Em viewport <640px, a tabela vira uma lista de cards empilhados (nome+categoria no topo, data e
     urgência abaixo) — nunca scroll horizontal como solução padrão (design system §27).

## Motion (decisão explícita — achado V6 da auditoria)

- Troca de `Skeleton` para valor real de cada card: sem fade — troca instantânea, pois o objetivo é
  a leitura mais rápida possível do número real, não uma transição suave.
- Card de armazenamento aparecendo/desaparecendo ao cruzar o limiar de 80% (só relevante em uma
  sessão longa com upload concorrente): fade-in `motion.normal` (180ms) quando aparece; nunca
  desaparece instantaneamente para não confundir com um erro de carregamento — usa o mesmo fade,
  invertido, `motion.fast` (120ms, mais rápido para sair).
- `prefers-reduced-motion`: o fade do card de armazenamento é substituído por uma troca instantânea.

## Dados de exemplo

```
métricas: overdue=1, soon=2, review=3, missing=4
storage (condicional, omitido neste exemplo por estar abaixo de 80%)
linhas da tabela: 
  Alvará de Funcionamento — Unidade Centro | Licenças | 25/08/2026 | Vencido (critical)
  Certificado Digital e-CNPJ A3 | Certificados | 12/09/2026 | Vence em 3 dias (warning)
  CND Federal — Atlas Schindler | Fornecedores | 15/09/2026 | Vence em 6 dias (warning)
```

## Regras

- Painel mostra apenas itens vencidos + a vencer em breve, priorizados nessa ordem — não é a lista
  completa.
- Cada métrica do topo é clicável e deep-links para a view filtrada correspondente (não apenas
  decorativa).
- Trocar de organização (organization switcher) sempre limpa o estado desta tela e recarrega os
  contadores do zero — nunca mostra um flash dos dados da organização anterior (regra do AppShell,
  `p0-screen-inventory-plan.md` §3, referenciada aqui por ser SHARED-SYSTEM-LEVEL).
