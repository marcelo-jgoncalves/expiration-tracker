# A11 (Requisitos documentais) — reconciliação visual — Rodada 2 (proposta Claude)

Resposta aos 6 achados da Rodada 1 (nota 8,0/10, Codex). Todos verificados por leitura direta do código antes desta resposta, não por suposição. Mudanças cirúrgicas sobre a Rodada 1 — desenho geral (seção "Visão por situação", hex literais, busca+Atualizar num Toolbar, rodapé de contagem) mantido, corrigido nos pontos específicos abaixo.

## Achado 1 — botão da célula primária (confirmado, corrigido)

`RequirementsCollection.tsx:347` é de fato `<Button variant="tertiary" size="sm">`, não um link — `.ui-table__cell--primary a` nunca vai casar com ele. Correção: seletor específico para o botão dentro da célula primária, SEM alterar sua semântica (continua `<button>`, continua abrindo `RequirementDetail` via `onClick`, nenhuma asserção `getByRole("button", ...)` muda):

```css
.ov-requirements .ui-table__cell--primary .ui-button {
  color: #4c1d95;
  font-weight: 800;
  font-size: 11px;
  padding-inline: 0;
}
```

Deliberadamente SEM sublinhado-no-hover (diferente de `ItemsCollection`/`SubjectsCollection`, que estilizam `<a>` reais): este controle abre um diálogo sobreposto, não navega — a superfície de hover que `.ui-button--tertiary:hover` já aplica (`Button.css:94-98`) é a affordance correta para "abre algo aqui", não a convenção de link. Preservar esse comportamento herdado é mais correto que forçar uma imitação de link sobre um botão real.

## Achado 2 — alvo de toque das IconButton de linha (confirmado, corrigido)

`IconButton size="sm"` é 32px (`tokens.css:222`), não 44px — a linha de 76px não aumenta a área clicável do controle em si. Correção: adicionar o wrapper que `RequirementsCollection.tsx`'s `RowActions` hoje NÃO tem (diferente de `SubjectsCollection.tsx:187`'s `<span className="ov-subject-actions">`):

```tsx
// RequirementsCollection.tsx, função RowActions — trocar o Fragment por um wrapper:
return (
  <span className="ov-requirements-actions">
    <IconButton size="sm" variant="tertiary" label={`Editar ${requirement.name}`} onClick={() => setAction("edit")}>
      <Pencil size={16} aria-hidden="true" />
    </IconButton>{" "}
    <IconButton size="sm" variant="danger" label={`Excluir ${requirement.name}`} onClick={() => { setDeleteError(undefined); setAction("delete"); }}>
      <Trash2 size={16} aria-hidden="true" />
    </IconButton>
    {/* diálogos inalterados */}
  </span>
);
```

```css
.ov-requirements-actions { display: flex; justify-content: flex-end; gap: 2px; }
.ov-requirements-actions > .ui-icon-button { min-height: 44px; min-width: 44px; }
```

Mesma técnica local de `SubjectsCollection.css:27`, nenhum componente compartilhado (`IconButton`) muda de tamanho global. Nenhum teste consulta a estrutura do wrapper (só `getByRole`/`label`), então isto não quebra `RequirementsCollection.test.tsx`.

## Achado 3 — seleção invisível em `forced-colors` (confirmado, corrigido)

Achado correto e a correção usa um precedente REAL já existente no próprio código (`base.css:172-191`, `.app-shell__link[aria-current="page"]`), que resolve exatamente este problema para o item de navegação atual — reaproveitado aqui, não inventado:

```css
@media (forced-colors: active) {
  .requirements-metric--active {
    box-shadow: none;
    border-left: var(--border-width-thick) solid SelectedItem;
  }
}
```

`SelectedItem` é a cor de sistema que `forced-colors` sempre renderiza (mesma usada por `base.css`); `aria-pressed` já comunica o estado a tecnologia assistiva independentemente disso — a correção é puramente visual.

## Achado 4 — densidade móvel (confirmado, corrigido — abordagem revista)

Achado correto: `Items`/`Fornecedores` cada um tem seu PRÓPRIO override móvel divergente (grid de 2 colunas vs. min-height simples), e `DataTable.css:138-199` já define um layout mobile padrão (empilhado por `data-label`, breakpoint 820px) que uma regra desktop-only genérica sobrepõe por especificidade sem querer.

**Decisão revista** (mais segura que tentar replicar qualquer um dos dois padrões divergentes): Requisitos MANTÉM o layout mobile padrão já embutido em `DataTable.css` (empilhado, já acessível, já é o comportamento herdado por toda tabela que não o sobrescreve) — nenhuma tentativa de imitar o grid de 2 colunas do Items, que não foi pedido e adicionaria uma superfície de teste nova. As novas regras de densidade DESKTOP (`.ov-requirements .ui-table td { padding:12px 19px; height:76px }`, especificidade (0,2,1)) precisam de um reset explícito no mesmo breakpoint do `DataTable.css`, devolvendo o controle ao layout padrão:

```css
@media (max-width: 820px) {
  .ov-requirements .ui-table td {
    padding: var(--space-2) var(--space-5);
    height: auto;
  }
}
```

Isso elimina o risco apontado (override acidental do layout mobile já existente) sem introduzir um segundo comportamento móvel divergente.

## Achado 5 — proveniência da paleta (confirmado, corrigido)

Verificação refeita hex por hex, com atribuição correta desta vez:

| Cor | Uso | Fonte real (verificada agora) |
|---|---|---|
| `#4c1d95` / `#f1ebff` (accent) | Todos, ativo | `Overview.css:9` (`.ov-overview-metric-icon`) |
| `#b91c1c` / `#fff2f1` (critical) | Em falta / Não satisfeito | `Overview.css:13` |
| `#a94a05` / `#fff7e8` (warning) | Pendente | `Overview.css:14` |
| `#047857` / `#ecfdf5` (success) | Satisfeito | `Members.css:53` |
| `#e8e4f1` (borda neutra, repouso) | Todos/Não se aplica em repouso | uso já onipresente em `ItemsCollection.css`/`SubjectsCollection.css` |
| `#55507a` (texto secundário / borda neutra ativa) | Não se aplica, ativo | uso já onipresente como cor de texto secundário em todas as telas citadas |

`#8a83ab` removido — não existe em `frontend/src`, era invenção da Rodada 1. Card "Não se aplica" ativo passa a usar `border-color:#55507a` (não um hex novo) — mesma família cromática (roxo/neutro) já usada em todo o app, sem introduzir uma terceira cor neutra.

## Achado 6 — cobertura de teste (confirmado, corrigido)

Contagem corrigida: são 7 testes em `RequirementsCollection.test.tsx`, não 8 (erro de contagem da Rodada 1, sem impacto no desenho). Nenhum teste existente consulta `aria-label="Filtrar por status"`, confirmado por leitura direta — renomear para `aria-labelledby` não quebra nada hoje.

Novo teste a adicionar (`RequirementsCollection.test.tsx`): botão "Atualizar" chama `refetch` das 5 queries de status (mock `vi.fn()` nas 5 chamadas GET de `/search`, clicar "Atualizar", assertar nova chamada GET para cada `status=`). Não há verificação automatizada de contraste/alvo de toque no CI deste repositório (`npm test` é Vitest, não axe/pa11y) — critério de aceite 7 da Rodada 1 ("zero regressão de a11y") permanece validado por leitura/cálculo manual de contraste (já feito pelo Codex na Rodada 1, todos ≥4,5:1) e pelos alvos de 44px agora explicitados no Achado 2, não por um gate automatizado que não existe neste projeto.

## Sem mudanças fora do que foi pedido

Confirmando explicitamente (resposta ao "escopo suficientemente amplo" do Codex): nenhuma mudança em backend, paginação, diálogos de criar/editar/excluir, ou no modo aninhado além da densidade de tabela (que agora tem o reset móvel do Achado 4, aplicável igualmente a ambos os modos).

## Nota desta rodada (Claude, antes de ver a nota do Codex — protocolo de nota cega)

9,0/10. Todos os 6 achados da Rodada 1 endereçados com correção verificada linha por linha no código real; nenhuma mudança nova introduzida além das exigidas pelas correções. Resta como possível ressalva: a decisão do Achado 1 de NÃO imitar sublinhado-de-link no botão da célula primária é uma divergência deliberada do padrão literal das telas irmãs (que estilizam `<a>`, não `<button>`) — corretamente justificada pela diferença semântica real (abre diálogo vs. navega), mas ainda é uma decisão de design que o Codex pode preferir ver confirmada explicitamente por Marcelo antes de convergir.
