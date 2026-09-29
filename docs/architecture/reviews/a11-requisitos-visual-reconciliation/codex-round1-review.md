(Saved verbatim from `codex exec` output, Rodada 1 — nota 8,0/10, exige ajustes.)

**Nota: 8,0/10. Exijo ajustes antes da implementação.** A direção e o escopo são adequados, mas há divergências concretas entre a proposta e o código, além de garantias de acessibilidade ainda não sustentadas.

1. **Média — Copiar os seletores das tabelas irmãs não estiliza o nome do requisito.** Em `RequirementsCollection.tsx:347`, o nome é um `<Button variant="tertiary" size="sm">`. As referências estilizam `.ui-table__cell--primary a`: `ItemsCollection.css:12` e `SubjectsCollection.css:22`. Copiar essas regras deixa cor, peso e tamanho do botão sem a reconciliação prometida. Copiar também a regra genérica de botões de Items pode fazê-lo ficar com **10px**, não 11px. **Correção:** especificar um seletor para o botão da célula principal, preservando sua semântica e abertura do detalhe. Transformá-lo em link quebraria as asserções existentes de `getByRole("button")`.

2. **Média — O aceite de alvos ≥44px não decorre dos componentes existentes.** Editar/excluir usam `IconButton size="sm"` (32px, `tokens.css:222`). Fornecedores chega a 44px por uma regra LOCAL que Requisitos não possui (`SubjectsCollection.css:27`). Uma linha de 76px não aumenta automaticamente a área clicável. **Correção:** explicitar os ajustes locais necessários para cumprir os 44px prometidos.

3. **Média — A seleção visual continua desaparecendo em cores forçadas.** Os cards semânticos distinguem seleção apenas pelo `box-shadow` (`RequirementsCollection.css:90`). Em `forced-colors`, essa sombra é removida. Lacuna preexistente, mantida pelo desenho proposto. **Correção:** acrescentar um marcador de seleção que sobreviva nesse modo, distinguível do foco.

4. **Média — A densidade proposta não define como preservar a disposição móvel.** Items usa `height:76px`/grid 2 colunas a partir de 850px; Fornecedores usa `min-height:77px` com seu próprio ajuste. `DataTable.css:164` já define um layout-padrão mobile (empilhado, 820px) que uma regra genérica `.ov-requirements .ui-table td {...}` sobrepõe por especificidade sem querer. **Correção:** escolher valores concretos e explicitar os respectivos overrides móveis.

5. **Baixa — A proveniência da paleta está parcialmente errada.** `#047857`/`#a94a05`/`#b91c1c` corretos, mas os indicadores do compliance card (`SubjectHub.css:148`) usam fundo padrão/borda sutil, não fundos tintados. `#ecfdf5` existe de fato, mas em `Members.css:53`, não no compliance card. `#8a83ab` não existe em lugar nenhum de `frontend/src`. **Correção:** atribuir cada referência corretamente e substituir o hex inventado.

6. **Baixa — A descrição e a cobertura dos testes estão superestimadas.** São 7 testes, não 8. Nenhum consulta o grupo por "Filtrar por status" — renomear não quebra essas asserções. Mas não há verificação do novo botão Atualizar. **Correção:** incluir teste do novo comportamento.

**Pontos confirmados:** `Section`/`headingId`/`Toolbar`/5×`refetch()` têm suporte real; `aria-labelledby` proposto aponta corretamente para o `<h2>` do `Section`. Contrastes de todos os hex principais ≥4,5:1 contra branco e contra os fundos propostos. Escopo considerado adequadamente amplo (cards/hierarquia/busca/tabela/contagem) sem exagero para backend/paginação/diálogos.

Suíte de testes não executada no ambiente do Codex (erro de acesso do Vite/esbuild, não relacionado à proposta). Nenhum arquivo alterado. Protocolo não convergido nesta rodada.
