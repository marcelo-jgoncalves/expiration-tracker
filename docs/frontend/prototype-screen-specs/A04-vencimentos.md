# A04 — Vencimentos (lista)

**Revisado em 2026-09-09** — pós auditoria de spec visual (`docs/architecture/reviews/screen-spec-audit-2026-09-09/A04-audit-record.md`). Mudanças: rota reconciliada, superfície de capacidades/RBAC restaurada por completo (update/delete/export/watch/priority/tags — a versão anterior só cobria create/import/read), estados assíncronos e de bulk nomeados, transformação mobile concreta, `tertiary`→`ghost`, tese visual de risco temporal, motion explícito.

**Rota:** `/app/:orgId/expirations`
**Acesso:** todos os papéis; ver seção RBAC completa abaixo (a versão anterior só cobria create/import)
**Nav ativo:** "Vencimentos"

## Tese visual (achado V7 da auditoria — antes uma tabela de admin-CRUD genérica)

Esta lista não organiza por identidade do item (nome/categoria) como uma tabela de cadastro comum
— ela organiza pela urgência temporal real, porque essa é a pergunta que o usuário está fazendo
("o que precisa da minha atenção, em que ordem"). Duas decisões concretas expressam isso:
1. **Ordenação default é por urgência, não por nome** — vencidos primeiro, depois "vence em breve"
   ordenado pela data mais próxima, depois válidos, permanentes por último. Alfabético é uma opção
   de ordenação secundária (coluna Vencimento é sortable), nunca o default.
2. **A coluna de Urgência não é apenas um badge de cor** — vencidos e itens vencendo em ≤3 dias
   recebem uma borda esquerda de 3px na cor semântica correspondente na própria linha da tabela
   (não só no ícone da célula), tornando a fileira inteira reconhecível na varredura visual sem
   precisar ler a célula de urgência isoladamente.

## Estrutura

1. `PageHeader`: título "Vencimentos", descrição "Itens com prazo de validade, independente de fornecedor ou documento.", ações no cabeçalho: "Importar CSV" (**ghost**, não `tertiary` — variante inexistente no sistema; link → A15) + "Novo vencimento" (primary, link). VIEWER não vê nenhuma das duas (ver RBAC).
2. **Painel único** com header composto: contagem de registros total (não duplicar o título "Vencimentos" — o painel usa só a contagem + a `FilterGroup`, evitando repetir o H1 do `PageHeader` sem hierarquia explicada); `FilterGroup` (dentro de wrapper `overflow-x:auto`) com opções e contagem por status:
   - Todos
   - Vencidos (`OVERDUE`)
   - Vence em breve (`EXPIRING`)
   - Válidos (`VALID`)
   - Permanentes (`PERMANENT`, sem data de vencimento — ex.: licenças sem prazo)
   - Campo de busca por nome/categoria/responsável (`item:read`, todos os papéis) — filtra client-side sobre o dataset já carregado da página atual; busca server-side de dataset completo fica fora de escopo desta revisão (nota para P0.2).
3. `DataTable` compacta, colunas:
   - Vencimento (primary): nome (link p/ A05) + categoria (`CellSecondary`) — nome trunca em 2
     linhas, `title` completo.
   - Responsável (texto, papel `Body`).
   - Prioridade: `StatusBadge` discreta (Alta/Média/Baixa) — só exibida quando o item tem prioridade
     definida; célula vazia (não "—") quando ausente, para não implicar que toda linha precisa dela.
   - Tags: até 2 tags visíveis + "+N" se houver mais, nunca quebra a altura da linha.
   - Data de vencimento (numeric, tabular-nums; "—" se permanente).
   - Urgência: `UrgencyIndicator` (tons: critical=vencido, warning=vence em breve, neutral=sem
     urgência/não se aplica) + borda esquerda da linha conforme a tese visual acima.
   - Coluna de seleção (checkbox) à esquerda, para o fluxo de bulk actions (ver abaixo) — visível só
     para WRITE_ROLES+.
   - Ordenação: colunas Vencimento e Data de vencimento são sortable; default é por urgência (ver
     tese visual).

## Ações em massa (bulk) e ações por linha (antes ausentes — achado Major da auditoria)

- Selecionar 1+ linhas (via checkbox) ativa uma barra de ferramentas **sticky apenas dentro da área
  de rolagem da tabela** (nunca sobrepõe o cabeçalho global nem o `PageHeader` fora do fluxo de
  seleção ativo): mostra contagem selecionada + ações "Excluir" (danger, ADMIN_ROLES),
  "Exportar selecionados" (ADMIN_ROLES), "Observar" (`item:watch`, WRITE_ROLES).
- Resultado de ação em massa: sempre relatado por linha, nunca um único pass/fail agregado — um
  `Toast` resume ("8 de 10 excluídos") e as linhas que falharam permanecem selecionadas com um
  ícone de erro inline explicando a causa (ex.: "bloqueado por regra de negócio").
- Ação por linha (menu `⋮`, sempre a última coluna): Editar (WRITE_ROLES → A05), Excluir
  (ADMIN_ROLES), Observar/Deixar de observar (WRITE_ROLES) — ações destrutivas nunca na posição
  mais alcançável do menu (design system, responsividade de ações §72).
- Exportar (cabeçalho, sem seleção = exporta o resultado filtrado atual): `item:export`,
  ADMIN_ROLES. Estados: gerando (botão desabilitado, "Gerando…"), pronto (download inicia
  automaticamente), truncado (aviso "Exportação limitada às primeiras N linhas — refine os filtros
  para um arquivo completo"), indisponível (erro com ação "Tentar novamente").

## Estado / lógica

- Estado local: `status` (filtro selecionado, default `ALL`), `search` (texto), `selectedIds`
  (Set, para bulk), `sortBy`/`sortDirection` (default: urgência).
- Filtragem/busca client-side sobre o dataset carregado; contagem de cada opção do `FilterGroup` é
  sobre o dataset completo, não afetada pelo filtro atual.
- Filtro/busca ativos ficam refletidos na URL (query params) — deep-linking e navegação "voltar"
  preservam o estado do filtro.
- **Estados assíncronos** (ausentes na versão anterior):
  - `loading` inicial: `Skeleton` de tabela com o número de linhas do último carregamento conhecido
    (ou 5, se for a primeira visita) — nunca página em branco.
  - `EMPTY_TRUE` (nenhum vencimento cadastrado no tenant): `EmptyState` "Nenhum vencimento
    cadastrado. Cadastre o primeiro vencimento para começar a acompanhar prazos." com ação "Novo
    vencimento" embutida (WRITE_ROLES) — oculta a `FilterGroup` inteira, já que filtrar um conjunto
    vazio não faz sentido.
  - `EMPTY_FILTERED` (filtro/busca sem resultado): `EmptyState` "Nenhum vencimento encontrado com
    esses filtros." + ação "Limpar filtros" — mantém a `FilterGroup` visível.
  - Falha ao carregar: banner de erro acionável no lugar da tabela, "Não foi possível carregar os
    vencimentos." + "Tentar novamente".

## Motion (decisão explícita — achado V6 da auditoria)

- Troca de filtro (`FilterGroup`): a tabela não faz fade — linhas são substituídas instantaneamente,
  pois filtrar é uma ação de alta frequência que não deve parecer lenta.
- Barra de bulk actions aparecendo/desaparecendo: desliza para cima/baixo `motion.fast` (120ms,
  `ease-out` na entrada, `ease-in` na saída) a partir da borda inferior da área de rolagem — nunca
  aparece instantaneamente "saltando", pois é uma mudança de modo (seleção ativa) que merece
  continuidade visual.
- Foco após ação em massa: permanece na barra de ferramentas (não salta para o topo da página).
- `prefers-reduced-motion`: a barra de bulk actions aparece/desaparece instantaneamente.

## Dados de exemplo (5 registros)

| Nome | Categoria | Responsável | Prioridade | Vencimento | Status | Urgência |
|---|---|---|---|---|---|---|
| Alvará de Funcionamento — Unidade Centro | Licenças | Marina Costa | Alta | 25/08/2026 | OVERDUE | Vencido (critical) |
| Certificado Digital e-CNPJ A3 | Certificados | Diego Alves | Alta | 12/09/2026 | EXPIRING | Vence em 3 dias (warning) |
| CND Federal — Atlas Schindler | Fornecedores | Marina Costa | Média | 15/09/2026 | EXPIRING | Vence em 6 dias (warning) |
| Apólice de Seguro Patrimonial | Seguros | Diego Alves | Baixa | 09/12/2026 | VALID | Sem urgência (neutral) |
| Licença Ambiental de Operação | Licenças | Marina Costa | — | — | PERMANENT | Não se aplica (neutral) |

## RBAC (superfície completa — a versão anterior só cobria create/import)

- **VIEWER** (READ_ONLY_ROLES): apenas leitura (`item:read`); oculta "Importar CSV", "Novo
  vencimento", coluna de seleção, barra de bulk actions e o menu `⋮` por completo (nunca mostra
  ações desabilitadas sem função — regra RBAC-aware-nav do plano, §2.1: se não pode fazer nenhuma
  ação, não vê o controle).
- **MEMBER/ADMIN/OWNER** (WRITE_ROLES): `item:create`, `item:update` (via A05), `item:watch`.
- **ADMIN/OWNER** (ADMIN_ROLES) apenas: `item:delete`, `item:export` — o menu `⋮` de um MEMBER não
  mostra "Excluir"; a barra de bulk actions de um MEMBER não mostra "Excluir" nem "Exportar
  selecionados", apenas "Observar".

## Responsivo (transformação concreta — a versão anterior só dizia "vira cards")

- <768px: a tabela vira uma lista de cards empilhados, um por item. Cada card mostra, em ordem:
  nome+categoria (topo, mesmo tratamento de link), urgência (badge + borda esquerda colorida do
  card inteiro — reforça a tese visual em mobile também), data de vencimento, responsável. Prioridade
  e tags ficam atrás de um disclosure "Mais detalhes" (raramente decisivos para a varredura rápida
  em mobile).
  Nunca scroll horizontal como solução padrão (design system §27).
- Seleção em massa em mobile: cada card ganha um checkbox no canto superior esquerdo quando o modo
  de seleção é ativado por um botão "Selecionar" explícito no lugar da `FilterGroup` (não por
  long-press, que não é descobrível).
