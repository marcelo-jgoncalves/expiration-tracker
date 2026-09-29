# A11 (Requisitos documentais) — reconciliação visual — Rodada 3 (proposta Claude)

Resposta aos 4 achados remanescentes da Rodada 2 (nota 8,4/10). Achados 1 e 5 da Rodada 1 foram confirmados corrigidos pelo Codex e não são reabertos aqui.

## Achado 1 (R2) — seleção em `forced-colors` perde na cascata (corrigido)

Duas correções, ambas confirmadas contra o código real:

**Especificidade**: listar explicitamente as 5 combinações `--active` (mesma especificidade (0,2,0) das regras que hoje definem `border-color`), em vez de um seletor genérico de especificidade menor:

```css
@media (forced-colors: active) {
  .requirements-metric--accent.requirements-metric--active,
  .requirements-metric--neutral.requirements-metric--active,
  .requirements-metric--critical.requirements-metric--active,
  .requirements-metric--warning.requirements-metric--active,
  .requirements-metric--success.requirements-metric--active {
    box-shadow: none;
    border-left-width: 4px;
    border-left-color: SelectedItem;
  }
}
```

**Distinção de forma**: `border-left-width: 4px` (não `var(--border-width-thick)`, que vale 2px — igual à borda de repouso já sempre visível nos cards semânticos, o que não criaria diferença perceptível de forma). 4px é o dobro da borda de repouso (2px, ver correção abaixo) — distinção de espessura real, não só de cor, coerente com a exigência do achado.

## Achado 2 (R2) — botão do nome do requisito não alcança 44px (corrigido)

Estendida a mesma regra da célula primária:

```css
.ov-requirements .ui-table__cell--primary .ui-button {
  color: #4c1d95;
  font-weight: 800;
  font-size: 11px;
  padding-inline: 0;
  min-height: 44px;
}
```

`min-height` numa regra mais específica que `.ui-button--sm`'s `min-height: var(--control-height-sm)` (32px) simplesmente eleva o mínimo sem remover nenhuma propriedade herdada (padding vertical do próprio Button continua aplicado; o botão fica mais alto, não mais estreito) — nenhum conflito de cascata, `min-height` normal não compete com `min-height` de especificidade menor por nenhuma outra via além da cascata já respeitada aqui.

## Achado 3 (R2) — reset móvel incompleto (corrigido — abordagem trocada por gate de `min-width`, exatamente como sugerido)

Em vez de aplicar a densidade desktop sempre + resetar a 820px (que colidia com o padding de `.ui-table__cell--primary`/`.ui-table__cell--actions` de `DataTable.css:190-207`, ambos (0,2,1)), a densidade desktop agora só existe acima do breakpoint do `DataTable.css`:

```css
@media (min-width: 821px) {
  .ov-requirements .ui-table td {
    padding: 12px 19px;
    height: 76px;
  }
  .ov-requirements .ui-table thead th {
    padding: 15px 19px;
  }
}
```

Nenhuma regra de densidade desktop roda abaixo de 821px — o layout mobile herdado de `DataTable.css` (empilhado, 820px, incluindo os paddings de 8px das células primária/ações) fica inteiramente intocado, eliminando a colisão de especificidade apontada. As regras que NÃO dependem de largura de linha (cor/peso/tamanho de fonte do link, fundo do cabeçalho, cor do texto secundário) continuam sem gate de media query, pois não conflitam com nada do `DataTable.css` mobile.

## Achado 4 (R2) — afirmação incorreta sobre ausência de testes de a11y automatizados (corrigido)

Correção de fato, não de desenho: `e2e/accessibility.spec.ts:118` (Playwright, `npm run test:e2e`, CI) já verifica contraste/alvo de toque — não cobre A11 hoje, mas existe no projeto. Registrado como pendência honesta (fora do escopo desta reconciliação visual acrescentar A11 a essa suíte E2E — decisão de produto/QA separada, não parte do pedido de Marcelo), não como alegação de inexistência do mecanismo.

Teste novo de "Atualizar" (`RequirementsCollection.test.tsx`) especificado com precisão pedida: `getMock` limpo antes do clique (`getMock.mockClear()` após a carga inicial), clicar "Atualizar", assertar que os mesmos 5 endpoints `status=` recebem uma NOVA chamada (não reaproveitando a contagem inicial de 5).

## Estado final consolidado desta rodada

Todos os 4 achados remanescentes corrigidos; nenhuma mudança nova introduzida além do exigido pelas correções. Nenhuma divergência aberta que dependa de decisão de Marcelo (achado 1 da Rodada 2, sobre não sublinhar o botão no hover, foi confirmado como correto pelo próprio Codex na Rodada 2, sem reserva).
