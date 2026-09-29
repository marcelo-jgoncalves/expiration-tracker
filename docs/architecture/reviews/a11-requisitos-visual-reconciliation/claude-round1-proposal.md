# A11 (Requisitos documentais) — reconciliação visual com o padrão recente — Rodada 1 (proposta Claude)

## Contexto e pedido

Marcelo (2026-09-29): item 18 do `NEXT_SESSION_PROMPT.md` registrava um protótipo prometido (`prototype/novasTelas`) para "o efeito de borda dos cards de filtro" e a seção "Visão por situação" na tela de Requisitos — o arquivo nunca chegou ao disco. Pedido explícito desta sessão: pular a etapa de esperar o protótipo, desenhar diretamente a partir do padrão já adotado nas telas recentemente atualizadas, submeter ao protocolo Claude↔Codex, e só então implementar. Confirmado com Marcelo (`AskUserQuestion`) que o escopo é **amplo** (reconciliar a tela inteira contra o padrão mais recente, não só os cards) e que "Visão por situação" é o **mesmo conteúdo já existente** (os 6 cards de filtro por status), só renomeado/reestilizado — não um agregado novo.

**Declaração de pesquisa externa (E-014)**: NÃO. Esta decisão não define um padrão que sistemas fora deste projeto já resolveram de forma estabelecida (RBAC, invite, sessão multi-tenant etc.) — é coerência interna de design system entre telas já aprovadas do próprio produto. Nenhuma decisão AWS-specific envolvida.

## Estado real hoje (verificado por leitura direta do código, não por suposição)

`frontend/src/routes/RequirementsCollection.tsx` (A11) já é uma tela **funcional e completa**: busca, 6 cards de filtro por status (Todos + 5), agrupamento por fornecedor na visão tenant-wide, criar/editar/excluir com diálogos, modo aninhado dentro do Hub do Fornecedor (`SubjectLayout`, D-339) que reaproveita o mesmo componente. RBAC (`docarchive:requirement-*`) intacto, sem mudança de autorização nesta proposta.

O que ficou **visualmente para trás** frente às telas mexidas mais recentemente (Vencimentos/`ItemsCollection.tsx`, Fornecedores/`SubjectsCollection.tsx`, Fornecedor-Detalhe/`SubjectLayout.tsx`, todas com CSS bespoke usando hex literais do protótipo — 2026-09-26/27):

1. **`.requirements-metric`** (`RequirementsCollection.css:9-111`) usa tokens `var(--color-status-*)` — o próprio comentário de `SubjectHub.css:9-11` já registra que esses tokens têm "um tom levemente diferente" dos hex literais usados no card de conformidade do fornecedor (`#047857`/`#a94a05`/`#b91c1c`). Border é fina (`1px`) e uniforme — nenhum "efeito de borda" distintivo, ao contrário do pedido de Marcelo.
2. **Sem heading visível** para o bloco de 6 cards — hoje é só `<div role="group" aria-label="Filtrar por status">`, nenhum texto "Visão por situação" nem equivalente.
3. **Tabela sem densidade compacta**: `RequirementsCollection.css` não tem NENHUMA regra própria para `.ui-table` — a tabela desta tela ainda renderiza no espaçamento/tamanho de fonte antigo (14px+ herdado do design system base), enquanto `ItemsCollection.css`/`SubjectsCollection.css` já convergiram para 11px corpo / 10px cabeçalho, padding 12-15×19-21px, link primário `#4c1d95`/800/sem sublinhado.
4. **Busca isolada**: vive sozinha dentro de um `<Panel padded>` — nas telas irmãs, a busca mora dentro do `Toolbar` ao lado do filtro/paginação/atualização.
5. **Sem ação "Atualizar"**: `ItemsCollection.tsx` tem botão "Atualizar" que reinvoca as queries visíveis; Requisitos não tem equivalente, apesar de usar o mesmo padrão de `useQuery`/`refetch()`.
6. **Sem rodapé de contagem**: `ItemsCollection`/`SubjectsCollection` fecham a tabela com `"N registros/cadastros nesta visualização"` (`aria-live="polite"`); Requisitos usa só a anotação `(N)` no heading da `Section`.

## Desenho proposto

Escopo estritamente **visual/estrutural**, zero mudança de autorização, contrato de API, ou comportamento de dado. Aplica-se à visão **tenant-wide** (`!filterSubjectId`); o modo aninhado (`nested`, dentro do Hub do Fornecedor, D-339) mantém seu cabeçalho/hero omitidos exatamente como hoje — só herda a nova densidade de tabela (item 3), que é puramente visual e não introduz nenhuma diferença de comportamento entre os dois modos.

### 1. Seção "Visão por situação"

Envolver o bloco de 6 cards num `<Section heading="Visão por situação" headingId="requirements-status-view">` (mesmo componente `Section` já usado 2x nesta tela, nunca um heading cru novo). O `role="group"` interno passa a usar `aria-labelledby="requirements-status-view"` em vez de `aria-label="Filtrar por status"` — evita duas descrições acessíveis divergentes para o mesmo conteúdo (heading visível vira também o nome acessível do grupo).

### 2. Cards com efeito de borda (hex literais, consistentes com o card de conformidade do fornecedor)

Substituir a paleta de `RequirementsCollection.css` pelos MESMOS hex literais já em uso em `SubjectHub.css`/`ItemsCollection` (reaproveitar, nunca inventar uma terceira paleta):

| Status | Border (sempre visível, 2px) | Fundo | Cor do valor |
|---|---|---|---|
| Todos (accent) | `#4c1d95` só quando ativo; `#e8e4f1` em repouso | `#f1ebff` só quando ativo; branco em repouso | `#4c1d95` |
| Em falta / Não satisfeito (critical) | `#b91c1c` sempre | `#fff2f1` sempre | `#b91c1c` |
| Pendente (warning) | `#a94a05` sempre | `#fff7e8` sempre | `#a94a05` |
| Satisfeito (success) | `#047857` sempre | `#ecfdf5` sempre | `#047857` |
| Não se aplica (neutral) | `#e8e4f1` em repouso; `#8a83ab` quando ativo | branco em repouso; `#f8f7fc` quando ativo | `#14121f` |

"Efeito de borda" concreto: os 4 tons semânticos (critical/warning/success ativos-ou-não, mesma regra que já existe hoje) ganham border **2px sólida** (era 1px) na cor do próprio status, sempre visível — não só quando selecionado. Seleção continua marcada por um anel interno adicional (`box-shadow: inset 0 0 0 2px <cor>`), exatamente como já funciona hoje, só que agora por cima de uma borda mais grossa em vez de uma borda neutra fina. "Todos" e "Não se aplica" continuam neutros em repouso, coloridos só quando ativos (mesma exceção documentada já existente, nenhuma mudança de regra aí).

### 3. Densidade de tabela compacta (herdada por tenant-wide E aninhado)

Adicionar a `RequirementsCollection.css` as mesmas regras de `ItemsCollection.css`/`SubjectsCollection.css` (fonte 11px corpo/10px cabeçalho maiúsculo, padding 12-15×19-21px, `min-height` de linha ~76px, célula primária `#4c1d95`/800/sem sublinhado com sublinhado no hover), escopadas a uma nova classe raiz `.ov-requirements` no `<div>` externo do componente (hoje sem classe nenhuma). Isso é puro CSS — nenhuma estrutura DOM muda, nenhum teste que hoje passa por `getByRole`/`getByText` é afetado.

### 4. Busca + Atualizar dentro de um Toolbar (só tenant-wide)

Mover o `<TextField id="requirements-search" .../>` (hoje dentro de `<Panel padded>` sozinho) para dentro de um `<Toolbar>` ao lado de um novo botão "Atualizar" (mesmo rótulo/estado `Atualizando…` de `ItemsCollection.tsx`), que chama `.refetch()` em todas as 5 queries de status. Preserva EXATAMENTE o mesmo `id`/`label`/`hint` do campo (nenhum teste quebra). O modo aninhado mantém o campo de busca exatamente onde está hoje (dentro do seu próprio `<Panel padded>`, sem Toolbar) — o Hub do Fornecedor já tem seu próprio cabeçalho/ações (D-339), não tem um "Atualizar" equivalente em nenhuma tela irmã aninhada, e o teste existente (`getByLabelText(/Buscar por nome do requisito/)`) não pode ser motivo de mudança estrutural desnecessária.

### 5. Rodapé de contagem (só tenant-wide)

Adicionar `<p className="ov-requirements-footer" aria-live="polite">{requirements.length} {requirements.length === 1 ? "requisito" : "requisitos"} nesta visualização</p>` logo abaixo da tabela, mesma convenção de `ov-items-footer`/`ov-subjects-footer`. A anotação `(N)` do `Section heading="Requisitos"` **permanece intacta em ambos os modos** (não removida) — o teste do modo aninhado (`getByRole("heading", { name: "Requisitos (2)" })`) depende dela.

## Fora de escopo (deliberado)

- Nenhuma mudança em RBAC, contrato de API, `Requirement`/`RequirementSearchHit`, ou nas 3 lacunas já nomeadas no comentário de topo do arquivo (export CSV, template-apply, paginação tenant-wide por cursor).
- Nenhuma mudança nos diálogos de criar/editar/excluir (já usam `Button`/`IconButton`/`Dialog` compartilhados, já herdam o padrão retangular/discreto de `Button.css` automaticamente).
- Nenhuma mudança no modo aninhado além da densidade de tabela (item 3).

## Critérios de aceite

1. Toda a suíte de testes existente (`test/routes/RequirementsCollection.test.tsx`, 8 testes) continua passando sem nenhuma asserção alterada.
2. `Visão por situação` é o heading visível e o nome acessível (`aria-labelledby`) do bloco de 6 cards.
3. As 4 cores semânticas usam os hex literais desta tabela, idênticos aos já usados por `SubjectHub.css`.
4. Tabela (tenant-wide e aninhada) usa a mesma densidade/paleta de `ItemsCollection`/`SubjectsCollection`.
5. Busca + Atualizar tenant-wide vivem no mesmo `Toolbar`; aninhado inalterado.
6. Rodapé de contagem tenant-wide segue a mesma convenção `aria-live="polite"` das telas irmãs.
7. Zero regressão de a11y (contraste AA, alvo de toque ≥44px, foco visível) — mesmas garantias já exigidas em `ItemsCollection`/`SubjectsCollection`.

## Nível de risco

Nível 2-3 por `docs/engineering/change-risk-scale.md` (reconciliação visual/estrutural sobre feature já aprovada e funcional, sem mudança de modelo de autorização/dados — mesma classificação que D-340 usou para um caso comparável). Submetido ao protocolo por pedido direto de Marcelo, não por exigência automática do `AGENTS.md` §4.
