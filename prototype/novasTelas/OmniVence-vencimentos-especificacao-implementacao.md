# OmniVence — Vencimentos: especificação de implementação

**Status:** especificação para implementação da listagem aprovada. **Referência visual obrigatória:** `OmniVence-vencimentos-prototipo.html`. **Referências de consistência:** shell da Visão geral, formulário Novo vencimento e regras de datas documentadas para a Visão geral. **Idioma:** português do Brasil. **Escopo:** consulta de vencimentos ativos, arquivados e renovados; grupos por urgência; busca; atualização; acesso a detalhe, criação e entrada no fluxo de renovação. Dados do HTML são demonstrativos.

## 1. Prioridade e limites

1. Reproduzir a hierarquia, as proporções, a paleta e o comportamento responsivo do protótipo. Este documento prevalece para a integração real, estados e semântica onde o HTML simula uma ação.
2. A listagem é diferente da **Visão geral**, que resume prioridades, e de **Novo vencimento**, que cria um registro. Compartilhar shell, tipografia, tokens, componentes de estado e semântica temporal entre as três telas.
3. Os 21 ativos, 2 arquivados, 2 renovados, datas, nomes e categorias do protótipo são ilustrativos. A captura antiga contém grupos 5/5/11. Não mostrar esses números nem os exemplos em produção antes da resposta do serviço.
4. O protótipo usa o dia civil **25/09/2026** para demonstrar rótulos relativos. Em produção usar o dia civil da organização, no fuso configurado para ela; se não existir configuração, `America/Sao_Paulo`. Nunca deixar a data fixa do protótipo.
5. A ação “Renovar” no HTML abre confirmação demonstrativa e **não realiza renovação**. Em produção, abrir o fluxo real, coletar os dados necessários e concluir somente nele. Não transformar “Continuar” da demonstração em renovação automática.
6. Os links `#...`, avisos de protótipo, busca apenas local e arrays do arquivo HTML não entram na aplicação. O botão Atualizar deve buscar dados novos de verdade.
7. Não acrescentar exclusão, edição inline, seleção múltipla, ações em massa ou novos filtros de negócio nesta entrega. Navegação a detalhe/edição, arquivamento ou outras ações podem continuar no fluxo de detalhe existente.

## 2. Rotas, entrada e navegação

| Elemento | Ação real |
|---|---|
| Sidebar “Vencimentos” | Item atual, `aria-current="page"`; rota real de listagem |
| “Novo vencimento” | Abre o formulário Novo vencimento aprovado, pela rota real do aplicativo |
| Nome em cada linha | Abre detalhe do registro pelo ID canônico; nunca identifica item somente pelo nome, pois nomes repetidos são válidos |
| “Renovar” na aba Ativos | Abre o fluxo de renovação do registro específico |
| Abas Ativos, Arquivados, Renovados | Mudam conjunto consultado, sem alterar registros |
| “Atualizar” | Invalida/refaz a consulta atual e contadores; mantém aba, busca e posição quando possível |
| Logo, demais itens laterais, identidade e Sair | Usam o shell e as rotas reais já aprovados |

Quando a navegação vier da Visão geral com um filtro ou destino específico, abrir a listagem no contexto correspondente se a rota suportar query state. Quando o usuário voltar de detalhe, criação ou renovação, preservar aba e busca por parâmetros internos seguros ou estado de navegação do roteador. Não usar fragmentos `#` como roteamento de produção.

## 3. Microcópia aprovada

| Local | Texto |
|---|---|
| `<title>` | `Vencimentos · OmniVence` |
| Selo superior | `PRAZOS E ACOMPANHAMENTO` |
| H1 | `Vencimentos` |
| Subtítulo | `Tudo o que está sendo acompanhado, do mais para o menos urgente.` |
| Ação principal | `Novo vencimento` |
| Painel roxo, selo | `SEU PANORAMA` |
| Painel roxo, título | `Prazos claros. Próximos passos visíveis.` |
| Painel roxo, apoio | `Comece pelo que venceu, acompanhe o que está chegando e mantenha o histórico organizado.` |
| Painel roxo, total | número + `ativos` |
| Abas | `Ativos`, `Arquivados`, `Renovados`, cada uma com sua contagem real |
| Busca | placeholder `Buscar vencimento`; nome acessível igual |
| Botão de recarga | `Atualizar` |
| Colunas desktop | `Vencimento`, `Categoria`, `Data de vencimento`, `Urgência`, `Situação`, `Ação` |
| Grupos ativos | `Vencidos`, `Vence em breve`, `Demais ativos` + contagem de cada grupo |
| Ação por ativo | `Renovar` |

A legenda `Dados ilustrativos do protótipo` deve desaparecer. O rodapé de produção informa `X de Y registros` quando paginado; quando todo o conjunto consultado está carregado, `X registros nesta visualização`, com pluralização correta. Não exibir “Venceu há X dias” para registros arquivados/renovados como se sua urgência ainda estivesse ativa; apresentar suas datas e situação histórica com contexto fiel ao domínio.

## 4. Estrutura visual e responsividade

### Desktop, acima de 900 px

- Shell: sidebar branca fixa de 256 px, borda `#E8E4F1`; fundo principal `#F8F7FC`; padding superior 37 px, lateral `clamp(24px,3.4vw,62px)`, inferior 65 px, largura máxima 1840 px. Item Vencimentos recebe seleção lilás/roxa compartilhada.
- Cabeçalho: selo 11 px/800 em roxo, H1 `clamp(27px,2.5vw,37px)`/700 com tracking `-.052em`, apoio 13 px, botão roxo de 44 px de altura à direita. Distância até painel de aproximadamente 23 px.
- Painel de panorama: fundo chapado `#4C1D95`, raio 16 px, altura mínima 130 px, padding 23 × 27 px. Ícone linear em quadrado translúcido de 46 px; mensagem central; número de ativos à direita com separador. Círculos decorativos discretos em CSS, sem foto, glow ou gradiente.
- Barra de controles: margem superior 25 px, inferior 14 px; abas segmentadas à esquerda, busca e Atualizar à direita. Abas em contêiner `#F0EDF7` com padding 3 px; botão ativo branco, texto `#4C1D95`, sombra discreta. Busca e Atualizar com 41 px de altura.
- Lista: fundo branco, borda `#E8E4F1`, raio 15 px. Cabeçalho de colunas com fundo `#FBFAFE`, rótulos 10 px/800 em maiúsculas, padding 15 × 19 px. Colunas `minmax(230px,1.7fr) minmax(95px,.55fr) minmax(135px,.7fr) minmax(130px,.7fr) minmax(85px,.5fr) 90px`; gap 12 px. Linha com altura mínima 76 px, padding 12 × 19 px, divisor `#F0EDF6`.
- Cada grupo tem faixa `#F8F7FC` com título 11 px/800 e número de registros à direita. Nome em roxo 11 px/800 e contexto secundário abaixo; categoria e data 11 px; data relativa como informação secundária. Badges semânticos em tamanho 10 px. Botão Renovar de borda lilás, separado da navegação de detalhe.

### Até 1220 px

- Abas e ferramentas podem ocupar linhas distintas. Busca cresce para preencher o espaço; manter o botão Atualizar visível. Reduzir ligeiramente padding/colunas antes de trocar a lista para layout de cards.

### Até 900 px

- Sidebar torna-se drawer do shell compartilhado: botão de menu, sobreposição, Esc, foco contido e retorno ao acionador.

### Até 850 px

- Ocultar apenas o cabeçalho visual de colunas. Cada vencimento vira card em duas colunas dentro da lista: nome/contexto no topo; categoria, data e urgência em linhas de leitura; situação e Renovar à direita. Manter todos os dados disponíveis ao leitor de tela.

### Até 650 px

- Conteúdo com padding 20 px superior e 17 px lateral. Painel roxo compacto, omitindo somente a contagem lateral redundante que segue na aba Ativos. Abas ocupam a largura total; busca ocupa linha própria; Atualizar fica alinhado à direita.
- Em 320 CSS px e zoom 200%, permitir empilhar ação/status abaixo do conteúdo da linha e quebrar nomes longos, sem overflow horizontal. CTA Novo vencimento pode mostrar apenas `+` visualmente, preservando nome acessível completo.

### Tipografia e cores

Plus Jakarta Sans, pesos 400–800 hospedados localmente; `#4C1D95` marca, `#7C3AED` interação, `#A78BFA` foco, `#14121F` texto, `#55507A` apoio, `#F8F7FC` fundo, `#FFFFFF` superfície, `#E8E4F1` bordas. Vencidos usam vermelho semântico `#B91C1C` sobre `#FFF2F1`; vencem hoje e próximos 7 dias usam âmbar `#A94A05` sobre `#FFF7E8`; futuros sem urgência podem usar lilás claro. Situação usa badge neutro distinto da urgência. Garantir contraste AA e foco visível de 3 px. Respeitar `prefers-reduced-motion`.

## 5. Definições de dados, grupos e rótulos

- Escopo obrigatório: organização ativa e permissões da sessão, validadas no servidor. Arquivados e renovados só aparecem a usuários autorizados. Não buscar dados de outro tenant por manipulação de ID, URL ou cache.
- Ativo é o status canônico do domínio que participa do acompanhamento atual. Arquivado representa registro retirado do acompanhamento; renovado representa ocorrência anterior concluída por renovação, **se** esse for o significado real no modelo. Confirmar mapeamento exato dos status antes da integração; não inferir só pelo nome da aba.
- **Dia de referência:** data civil da organização no fuso configurado, fallback `America/Sao_Paulo`. Comparar datas civis `YYYY-MM-DD`, não timestamps de meia-noite UTC. Atualizar rótulos na virada do dia local e ao voltar à aba depois de longa inatividade.
- Grupos de Ativos são mutuamente exclusivos: `Vencidos` se data < hoje; `Vence em breve` se hoje ≤ data ≤ hoje + 7 dias, ambos limites inclusivos; `Demais ativos` se data > hoje + 7 dias. Se o domínio usa outra janela oficial de “em breve”, alinhar a mesma regra entre Visão geral e listagem antes de publicar; **não** permitir contagens discordantes entre telas.
- Ordenação padrão em Ativos: Vencidos do mais antigo ao mais recente, depois hoje e futuros em ordem crescente. Empates por título em `pt-BR`, então ID. Para Arquivados/Renovados, seguir data do evento do status (arquivamento/renovação) mais recente primeiro se disponível; se não existir, data de vencimento decrescente com ID estável. Não reaproveitar grupos de urgência para histórico.
- Contadores das abas são totais reais por situação no tenant, independentes da busca e da página atual. Contagem do painel = aba Ativos. Contagem de cada grupo ativo = total real do grupo, **não** apenas registros da página carregada. Após renovação, criação ou alteração de status, revalidar contadores e lista.
- Data formatada `dd/MM/yyyy`. Abaixo, `Venceu há 1 dia` / `Venceu há N dias`, `Vence hoje`, `Vence em 1 dia` / `Vence em N dias`, calculados no dia de referência. Badges: `Vencido`, `Vence hoje`, `Vence em N dias` para 1–7; `Sem urgência` após 7 dias, sem ocultar a data real. Para Arquivados/Renovados, exibir rótulo de situação e data histórica adequada sem classificar pendência antiga como ativa.
- Título, categoria e contexto vêm do registro real. Nomes duplicados permanecem linhas separadas com IDs distintos. Não inventar categoria ou detalhe ausente; omitir linha secundária vazia. Nunca usar nome como chave React ou ID de ação.

## 6. Busca, atualização e paginação

- Busca na aba selecionada por título, categoria e contexto/identificador relevante disponível no serviço; trim das extremidades, normalização de caixa e acentos quando suportada no backend; debounce de 250–350 ms. Filtrar no servidor sobre todo o conjunto autorizado, não apenas linhas exibidas.
- Trocar aba preserva termo pesquisado e reinicia cursor/página. Limpar busca restaura conjunto da aba atual. Manter aba e busca em query state/roteador quando possível para retorno do detalhe e refresh; nunca incluir dados sensíveis em URL.
- Exibir paginação real ou carregamento adicional segundo componente já usado no produto, sem trazer milhares de itens de uma vez. Cada página mantém a ordem estável; grupos que atravessam páginas devem indicar totais globais corretamente e não repetir cabeçalho de modo confuso. O tamanho da página é o padrão do produto, pois o protótipo de 21 itens não define limite de produção.
- “Atualizar” invalida e recarrega dados da aba atual, contadores e data de referência. Durante requisição, indicar `Atualizando…` e bloquear somente o acionamento repetido do botão. Busca e navegação continuam utilizáveis. Ao sucesso, manter foco; ao erro, mostrar `Não foi possível atualizar os vencimentos. Tente novamente.` e não apagar dados anteriores sem necessidade.
- Cancelar requisições obsoletas ou ignorar respostas fora de ordem para impedir que busca anterior substitua resultado recente. Invalidar cache por tenant, aba, busca, cursor e autorização.

## 7. Renovação

- Botão `Renovar` aparece somente quando o domínio permite iniciar renovação daquele registro ativo e o usuário tem permissão. Nome acessível `Renovar {título}`, acrescentando contexto distintivo quando títulos iguais.
- Clicar abre o fluxo real de renovação para o ID selecionado. Uma etapa introdutória pode usar o diálogo do protótipo com título `Iniciar renovação?`, nome do vencimento, `Cancelar` e `Continuar`, **desde que** `Continuar` só navegue ao fluxo de coleta/validação; não cria nova ocorrência e não muda status.
- O fluxo de renovação deve coletar os dados exigidos pelo domínio (por exemplo nova data/documento) e confirmar explicitamente as consequências para ocorrência anterior, histórico, alertas e obrigações vinculadas. Essa regra não é definida pelas capturas e pertence ao fluxo de renovação; não implementá-la por suposição nesta listagem.
- Após conclusão confirmada no serviço, revalidar aba, grupos e contadores; ocorrência antiga e nova aparecem nas situações que o domínio determinar. Falha mantém estado anterior, com erro recuperável. Nenhuma mutação é concluída no diálogo demonstrativo.
- Se renovação indisponível por status, permissão ou conflito, ocultar/desabilitar com explicação acessível, e validar novamente no servidor. Não permitir múltiplas solicitações simultâneas.

## 8. Estados e erros

| Estado | Resultado |
|---|---|
| Carregamento inicial | Shell e estrutura visíveis, placeholders sem números ou registros fictícios. |
| Trocando aba ou buscando | Controles mantidos; progresso discreto; resultado antigo não é apresentado como pertencente à aba nova sem indicação. |
| Ativos vazios | `Nenhum vencimento ativo.` e ação para criar, se autorizada. |
| Arquivados vazios | `Nenhum vencimento arquivado.` |
| Renovados vazios | `Nenhum vencimento renovado.` |
| Busca sem resultado | `Nenhum vencimento encontrado para esta busca.` e opção de limpar busca. |
| Erro inicial | `Não foi possível carregar os vencimentos. Tente novamente.` com ação `Tentar novamente`; não mostrar zero. |
| Erro ao atualizar | Preservar dados anteriores com aviso e nova tentativa. |
| Sem permissão | Estado próprio sem vazamento de dados, distinto de lista vazia. |
| Sessão expirada | Voltar a `/login` com destino interno seguro conforme especificação de autenticação. |
| Registro removido/alterado por outro usuário | Revalidar linha/lista e informar que os dados mudaram antes de continuar a ação. |

Formatação numérica `pt-BR`. A UI deve distinguir urgência por prazo da situação do ciclo de vida; por exemplo, `Vencido` e `Ativo` podem coexistir na mesma linha sem contradição.

## 9. Semântica e acessibilidade

- Um `<main>`, um `<h1>`, seção da listagem com nome acessível e sidebar `<nav>`. Usar tabela semântica ou estrutura equivalente que preserve cabeçalhos associados às células. Faixas de grupo com contagem anunciável; em mobile as associações permanecem acessíveis.
- Abas com `role=tablist`, `role=tab`, `aria-selected`, `aria-controls` e painel correspondente; implementar navegação por setas se o padrão tab for adotado. Não depender somente da cor para aba ativa. Busca com label real/programático. Botão Atualizar anuncia estado de progresso.
- Nome é link de detalhe; Renovar é botão de ação. Ícones decorativos `aria-hidden=true`. Duas ocorrências com título igual têm links e botões distinguíveis por contexto no nome acessível.
- Região `aria-live=polite` anuncia número de resultados e conclusão de atualização sem roubar foco. Erros usam `role=alert`. Diálogo introdutório, se usado, contém foco, inicia em Cancelar, fecha com Esc e devolve foco ao acionador; `Continuar` abre o fluxo real.
- Controles principais com alvo ≥44 × 44 px; badges nunca transmitem informação só pela cor. Zoom 200% e largura 320 CSS px não perdem conteúdo, ordem nem ação. Drawer móvel segue o shell da Visão geral.

## 10. Contrato semântico de integração

Adaptar API, modelos e rotas reais a este formato de fronteira, sem inventar endpoints físicos:

```ts
type DueListQuery = {
  status: 'active' | 'archived' | 'renewed';
  search?: string;
  cursor?: string;
  limit: number;
};
type DueListItem = {
  id: string;
  title: string;
  categoryLabel?: string;
  context?: string;
  dueDate: string; // YYYY-MM-DD, data civil
  status: 'active' | 'archived' | 'renewed'; // adaptação dos status reais
  canRenew: boolean;
};
type DueListPage = {
  items: DueListItem[];
  matchingCount: number;
  statusCounts: { active: number; archived: number; renewed: number };
  urgencyCounts?: { overdue: number; next7Days: number; later: number };
  asOfDate: string; // YYYY-MM-DD no fuso da organização
  nextCursor?: string;
};
```

O tenant/organização é derivado da sessão e aplicado no servidor. O serviço fornece contadores globais e paginação coerentes; se lista e contadores vierem de chamadas distintas, usar mesmo escopo/data de referência. `canRenew` é indicativo de UI, não substitui autorização na mutação. Centralizar classificação temporal e formatação para concordar com a Visão geral. Após retorno de Novo vencimento ou renovação, invalidar consultas afetadas. Não enviar identificadores ou dados de documentos a analytics indiscriminadamente.

## 11. Critérios de aceite

1. Comparação visual com o protótipo em 1440×900, 1280×800, 900×900, 390×844 e 320×700: hierarquia, grupos, cards, cores, sidebar e ações equivalentes; sem rolagem horizontal.
2. Ativos, Arquivados e Renovados mostram dados reais distintos e contagens globais coerentes; a busca atinge todo o conjunto autorizado, preserva aba e não sofre corrida de respostas.
3. Em datas de ontem, hoje, amanhã, sétimo e oitavo dia, incluindo transição de mês/ano, a classificação e o texto relativos concordam com a Visão geral no fuso da organização. Vencido e Ativo podem coexistir.
4. Grupos exibem totais reais mesmo com paginação; ordenação é estável; registros com nomes iguais têm destinos e ações por ID correto.
5. Atualizar consulta o serviço e mantém contexto; falhas não viram números zero. Criar abre formulário real; nome abre detalhe real; Renovar entra no fluxo sem alterar dados antes da confirmação final.
6. Estados vazio, erro, falta de permissão e sessão expirada são distintos. Teclado/leitor de tela percorrem abas, busca, tabela, Atualizar, detalhes e renovação com nomes e foco corretos.
7. Nenhum dos 21 exemplos, data fixa, links `#`, mensagens de protótipo ou mutações locais entra na versão integrada. Testes cobrem agrupamento, limites de sete dias, contadores, paginação/busca, tenant e permissão de renovação.

## 12. Definição de pronto

A tela está pronta quando reproduz o protótipo com dados reais, usa os mesmos critérios temporais da Visão geral, preserva navegação/estado e entrega todos os estados, permissões e critérios acima. A semântica de “Renovados” e a mutação de renovação devem ser confirmadas no domínio antes de conectar a ação; nenhuma renovação é disparada só pela confirmação visual desta listagem.
