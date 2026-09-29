# A11 (Requisitos documentais) — reconciliação visual — estado final consolidado

**Convergido em 3 rodadas: Codex 9,2/10, Claude 9,2/10 (sem arredondar).**

## Pedido original

Marcelo, 2026-09-29: item 18 do `NEXT_SESSION_PROMPT.md` (protótipo prometido para "efeito de borda dos cards de filtro" + seção "Visão por situação" em Requisitos, nunca entregue). Decisão explícita: pular a espera pelo protótipo, desenhar a partir do padrão já adotado nas telas recentemente atualizadas (Vencimentos/`ItemsCollection`, Fornecedores/`SubjectsCollection`, Fornecedor-Detalhe/`SubjectLayout`), submeter ao protocolo Claude↔Codex, implementar só após aprovação. Escopo confirmado amplo (reconciliar a tela toda, não só os cards) e "Visão por situação" confirmado como o MESMO conteúdo dos 6 cards de filtro, só renomeado.

## Desenho final (o que muda em `RequirementsCollection.tsx`/`.css`, visão tenant-wide, salvo item 3)

1. **Seção "Visão por situação"**: bloco de 6 cards envolvido em `<Section heading="Visão por situação" headingId="requirements-status-view">`; grupo interno usa `aria-labelledby="requirements-status-view"` em vez de `aria-label="Filtrar por status"`.
2. **Cards com borda semântica sempre visível (2px)**, hex literais corretamente atribuídos: accent `#4c1d95`/`#f1ebff` (Overview.css), critical `#b91c1c`/`#fff2f1` (Overview.css), warning `#a94a05`/`#fff7e8` (Overview.css), success `#047857`/`#ecfdf5` (Members.css), neutro repouso `#e8e4f1`, neutro ativo `#55507a`. Seleção mantém o anel `box-shadow: inset 0 0 0 2px` já existente, com marcador de sobrevivência em `forced-colors` (`border-left-width:4px; border-left-color:SelectedItem`, especificidade (0,2,0) igual às regras `--active` existentes, dentro de `@media (forced-colors: active)`).
3. **Densidade de tabela compacta** (tenant-wide E aninhado, classe raiz `.ov-requirements`), gated a `@media (min-width: 821px)` para nunca colidir com o layout mobile padrão de `DataTable.css` (breakpoint 820px, paddings de célula primária/ações preservados intocados abaixo de 821px). Botão do nome do requisito (`.ov-requirements .ui-table__cell--primary .ui-button`) ganha `color:#4c1d95; font-weight:800; font-size:11px; min-height:44px` — sem sublinhado de hover (decisão deliberada: é um botão que abre diálogo, não um link; confirmado correto pelo Codex, R2).
4. **Row actions com alvo de 44px**: novo wrapper `<span className="ov-requirements-actions">` nas duas `IconButton` (Editar/Excluir) de `RowActions`, com `min-height/min-width:44px` local (mesma técnica de `SubjectsCollection.css:27`).
5. **Busca + "Atualizar" num `Toolbar`** (só tenant-wide): campo de busca sai do `Panel padded` isolado, entra no `Toolbar` ao lado de um botão "Atualizar" que chama `.refetch()` nas 5 queries de status. Modo aninhado mantém o campo exatamente onde está (Hub do Fornecedor tem seu próprio padrão, D-339, sem "Atualizar" equivalente em nenhuma tela irmã aninhada).
6. **Rodapé de contagem** (só tenant-wide): `<p className="ov-requirements-footer" aria-live="polite">{N} requisitos nesta visualização</p>` abaixo da tabela — a anotação `(N)` do `Section heading="Requisitos"` permanece intacta em ambos os modos (o teste do modo aninhado depende dela).

## Fora de escopo (confirmado nas 3 rodadas)

RBAC, contrato de API, diálogos de criar/editar/excluir, paginação por cursor, export CSV, template-apply — nenhum tocado. `e2e/accessibility.spec.ts` não ganha cobertura de A11 nesta entrega (fora do pedido, registrado como pendência honesta, não lacuna oculta).

## Achados reais corrigidos ao longo do protocolo (não apenas polimento cosmético)

- R1→R2: botão da célula primária é `<Button>`, não `<a>` — seletor `.ui-table__cell--primary a` das telas irmãs nunca casaria; `IconButton size="sm"` é 32px, não 44px, sem override local equivalente ao de Fornecedores; seleção dos cards invisível em `forced-colors` (só `box-shadow`); paleta com uma cor inventada (`#8a83ab`, nunca existiu no código) e duas atribuições de fonte erradas.
- R2→R3: marcador `forced-colors` perdia a cascata por especificidade insuficiente e usava a mesma espessura da borda de repouso (sem distinção de forma real); botão do nome ficou fora do próprio critério de 44px que a proposta declarava; reset móvel via especificidade colidia com paddings de célula primária/ações do `DataTable.css` (8px→4px) — trocado por gate `@media (min-width:821px)`, eliminando a classe de bug em vez de remendar; afirmação incorreta de que não existem testes de a11y automatizados no projeto (existem, em `accessibility.spec.ts`, só não cobrem A11 ainda).

## Verificação do Codex (Rodada 3)

Prova isolada em Chromium (não a suíte real do projeto) confirmou: especificidade (0,2,0) das 5 combinações `forced-colors` vence pela ordem; borda de 4px distinta da borda de repouso de 2px; paddings/alturas desktop restritos a `min-width:821px`, mobile (820px/390px) preserva os paddings originais de `DataTable.css`; botão do nome mede 44px sem sobreposição/corte.

## Próxima ação

Implementação real dos 6 pontos acima em `RequirementsCollection.tsx`/`.css`, mais o teste novo de "Atualizar" especificado na Rodada 3 (limpar `getMock` após carga inicial, assertar novas chamadas aos 5 endpoints `status=`). Verificação obrigatória antes de reportar concluído: suíte completa do frontend (`npm test`), typecheck, lint, e teste visual manual (dev server) nos breakpoints 1440/821/820/390px e em modo `forced-colors` (Windows High Contrast ou emulação do DevTools).
