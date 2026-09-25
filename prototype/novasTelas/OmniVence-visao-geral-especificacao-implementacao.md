# OmniVence — Visão geral: especificação de implementação

**Status:** especificação da tela aprovada para implementação. **Referência visual obrigatória:** `OmniVence-visao-geral-prototipo.html`. **Tela de origem:** primeira página autenticada mostrada na captura do produto anterior. **Idioma:** português do Brasil. Esta especificação descreve o comportamento de produção; os números e registros do protótipo são dados ilustrativos.

## 1. Prioridade, escopo e interpretação do protótipo

1. Reproduzir o layout, a hierarquia, o ritmo visual, as cores e os componentes do protótipo aprovado. Usar esta especificação quando a interação demonstrativa ou os dados estáticos do arquivo HTML diferirem do comportamento de produção.
2. A tela mostra um panorama da organização ativa: indicadores, prioridades e vencimentos ordenados. Preservar todos os módulos de navegação da captura original, com os rótulos e a ordem do protótipo.
3. Os 5 vencidos, 5 próximos e 21 em acompanhamento, assim como a conta exibida e as onze linhas demonstrativas, **não são dados de produção**. Buscar os valores no escopo da organização ativa e da identidade autenticada. Não incluir a legenda “Dados ilustrativos do protótipo” em produção.
4. O contador `21` no protótipo representa o total de registros do conjunto, embora somente onze linhas de exemplo estejam visíveis. Em produção, total e paginação devem concordar com a fonte de dados. Não completar a lista ficticiamente nem derivar o total das linhas carregadas.
5. A tela não cria, conclui, renova, exclui ou edita vencimentos diretamente. O botão “Novo vencimento”, os itens e a navegação abrem fluxos existentes da aplicação. Não transformar a tela em um CRUD paralelo.
6. Os links `#...`, o aviso “Protótipo visual...” e os dados embutidos no JavaScript são somente demonstrativos. Removê-los na implementação.
7. O arquivo do logo ainda é uma referência provisória. Usar o asset aprovado, sem redesenhar o símbolo; substituir pelo vetor oficial quando disponível.

## 2. Rotas e destinos

| Controle | Destino ou ação de produção |
|---|---|
| Logo e “Visão geral” | `/dashboard` |
| “Vencimentos” e “Ver todos os vencimentos” | Rota existente de listagem de vencimentos; preservar filtros somente quando o destino suportar o mesmo significado |
| “Novo vencimento” | Fluxo existente de criação de vencimento; não abrir modal inventado nesta tela |
| Título de cada vencimento | Tela existente de detalhe do registro, com o identificador real |
| Demais itens laterais | Suas respectivas rotas existentes: Fornecedores, Requisitos, Revisões, Importar CSV, Tipos de documento, Templates de requisitos, Entrega de solicitação, Atividade, Relatórios, Membros, Notificações e Configurações |
| “Sair” | Encerrar sessão pelo mecanismo atual e navegar a `/login`; limpar estado sensível local |
| “Ver prioridades” | Rolar à lista e ativar o filtro `Vencidos`; manter foco/semântica de navegação acessível |

A especificação **não cria nomes de rotas desconhecidas** para módulos que já existem. O engenheiro deve mapear cada rótulo à rota real do roteador do repositório, preservando a semântica acima. Não deixar links com `href="#"` ou ícones sem ação na versão integrada. Se uma funcionalidade ainda não existir, mostrar o item somente se o produto já o disponibiliza ao usuário atual; não simular sucesso.

## 3. Conteúdo de interface

| Área | Texto/padrão aprovado |
|---|---|
| `<title>` | `Visão geral · OmniVence` |
| Selo sobre o título | `SEU ESPAÇO DE TRABALHO` |
| Título H1 | `Visão geral` |
| Subtítulo | `Seus vencimentos ativos, do mais para o menos urgente.` |
| Ação superior | `Novo vencimento` |
| Painel de destaque, selo | `PRIORIDADES DA EQUIPE` |
| Painel de destaque, chamada | `Você sabe o que precisa de atenção agora.` |
| Painel de destaque, apoio | `Comece pelos itens vencidos e acompanhe o próximo passo de cada obrigação.` |
| Painel de destaque, ação | `Ver prioridades` |
| Seção de métricas | `Panorama de vencimentos` |
| Métrica 1 | número + `Vencidos` |
| Métrica 2 | número + `Vencem em 7 dias` |
| Métrica 3 | número + `Em acompanhamento` |
| Lista, título | `O que precisa de atenção` |
| Lista, apoio | `Vencimentos ordenados pela data mais próxima` |
| Busca | Placeholder `Buscar vencimento`; nome acessível igual |
| Filtro | `Todos`, `Vencidos`, `Próximos 7 dias` |
| Colunas desktop | `Vencimento`, `Data`, `Urgência` |
| Rodapé da lista | `Exibindo X de Y vencimentos` quando sem busca/filtro; `X resultado(s) nesta visualização` quando filtrada; ação `Ver todos os vencimentos` |

Na barra lateral, ordem exata: **Espaço de trabalho**: Visão geral, Vencimentos, Fornecedores, Requisitos, Revisões. **Gestão**: Importar CSV, Tipos de documento, Templates de requisitos, Entrega de solicitação, Atividade, Relatórios. **Organização**: Membros, Notificações, Configurações. A identidade inferior mostra inicial/avatar, nome ou e-mail não truncado na descrição acessível, e função/role traduzida conforme a terminologia já usada pelo produto. O e-mail do protótipo é só exemplo. O botão Sair tem nome acessível “Sair”.

## 4. Estrutura visual

### Desktop, acima de 900 px

- Shell: Grid com sidebar fixa de 256 px e conteúdo flexível `minmax(0,1fr)`. Fundo do conteúdo `#F8F7FC`; sidebar branca com borda direita `#E8E4F1` de 1 px, altura da viewport e rolagem independente do menu se necessário.
- Sidebar: padding 28 px superior, 16 px horizontal e inferior. Logo em área de 183 × 57 px, alinhado à esquerda; navegação com seções de 10 px/800 em maiúsculas; itens com altura mínima 41 px, ícones lineares 17 px e texto 12 px/600. Item atual com fundo `#F1EBFF`, texto `#4C1D95`, peso 800, raio 10 px. Identidade no rodapé separada por linha.
- Conteúdo: padding superior 37 px, lateral `clamp(24px, 3.4vw, 62px)`, inferior 65 px; largura máxima 1840 px. Cabeçalho em uma linha com título à esquerda e CTA à direita; H1 `clamp(27px,2.5vw,37px)`/700, letter-spacing `-0.052em`; margem inferior do cabeçalho 28 px.
- Painel de destaque: roxo profundo sólido `#4C1D95`, raio 18 px, altura mínima 175 px, padding 30 × 36 px; círculos decorativos discretos com CSS. Não usar gradiente, foto, brilho ou iconografia genérica. Título branco `clamp(19px,2vw,27px)` e texto lilás muito claro. CTA secundária branca.
- Cabeçalho das métricas: margem superior 29 px, inferior 14 px. Três cards iguais em Grid com intervalo 14 px, fundo branco, borda `#E8E4F1`, raio 15 px, altura mínima 116 px, padding 20 px. Número 26 px/800; rótulo 11 px/600. Ícones em caixa 48 × 48 px. Card vencido em vermelho semântico, card próximos em âmbar, card acompanhamento em roxo.
- Cabeçalho da lista: margem superior 29 px e inferior 15 px. Busca, seleção e títulos na mesma linha quando houver espaço. Lista branca com borda e raio de 15 px. Cabeçalho de colunas com fundo `#FBFAFE`; cada linha tem altura mínima 72 px, padding 12 × 22 px e divisor sutil.
- Colunas: `minmax(240px,1.6fr) minmax(140px,.65fr) minmax(130px,.6fr) 26px`. Título do vencimento 12 px/800 roxo; contexto abaixo 10 px em texto secundário; data 11 px/700; badge semântico 10 px/800. Seta final é indicativa e não substitui o link de título.

### Até 900 px inclusive

- Sidebar vira painel lateral sobreposto de 256 px, inicialmente fechado. Botão “Abrir menu” aparece no cabeçalho; fundo escurecido fecha por clique e Esc. Ao abrir, foco entra na navegação; ao fechar, retorna ao botão. Impedir que o foco alcance o conteúdo atrás do painel enquanto ele estiver aberto. Ajustar rolagem para que o menu e a identidade permaneçam acessíveis.
- Conteúdo ganha padding horizontal 27 px. Sem rolagem horizontal.

### Até 650 px inclusive

- Conteúdo: padding 20 px superior, 17 px lateral, 45 px inferior. H1 28 px. O CTA “Novo vencimento” mostra ícone de adição e nome acessível completo; a largura visual pode reduzir ao ícone.
- Painel de destaque: padding 24 px; ocultar somente o link “Ver prioridades” nesse espaço, mantendo as métricas interativas. O texto não pode ser truncado.
- Métricas continuam em três colunas com intervalo de 8 px, cards compactos com padding 12 px e altura mínima 117 px. Se o viewport em 320 CSS px ou zoom tornar o conteúdo ilegível, trocar para empilhamento ou rolagem vertical de cards, **sem cortar rótulos nem criar rolagem horizontal da página**.
- Cabeçalho da lista empilha título e controles; busca cresce até preencher o espaço, seleção mantém tamanho necessário. Ocultar rótulos de cabeçalho da tabela; cada registro vira bloco em duas colunas: título/contexto acima, data e badge abaixo, seta visual à direita.
- Conteúdo se adapta a 200% de zoom e a teclado virtual. Badges, nomes longos e datas devem quebrar ou reorganizar sem sobreposição.

### Tokens de estilo

- Família Plus Jakarta Sans nos pesos 400, 500, 600, 700 e 800; hospedar localmente no produto; fallback `system-ui,sans-serif`.
- Marca: `#4C1D95` roxo profundo, `#7C3AED` roxo de interação, `#A78BFA` foco/lilás, `#14121F` texto principal, `#55507A` texto secundário, `#FFFFFF` superfícies.
- Apoio: `#F8F7FC` fundo, `#E8E4F1` bordas, `#F1EBFF` seleção. Semântica: vermelho `#B91C1C` e fundo `#FFF2F1` para vencido; âmbar escuro `#A94A05`/fundo `#FFF7E8` para hoje e próximos dias. Roxo para acompanhamento não urgente.
- Botões e links devem ter foco visível de pelo menos 3 px em `#A78BFA` com offset 2 px; contraste de texto WCAG AA. Hover não é a única indicação de ação. Respeitar `prefers-reduced-motion`.

## 5. Dados, cálculo e ordenação

- **Escopo obrigatório:** organização/tenant ativo da sessão. Toda leitura e destino de item devem respeitar autorização do servidor; a UI não define permissão por ocultação de links apenas.
- **Fonte de verdade:** API/serviço de vencimentos já existente no projeto. Não calcular totais globais a partir da primeira página carregada. Obter totais e itens de uma consulta consistente sob o mesmo escopo e a mesma data de referência.
- **Data de referência:** dia civil da organização, no fuso configurado para ela; na ausência de fuso organizacional, usar `America/Sao_Paulo` até que exista configuração. Não comparar datas usando UTC bruto ou diferença de milissegundos dividida por 24 h. Avaliar prazo por diferença entre datas civis.
- **Categorias mutuamente exclusivas:** vencido se `dueDate < today`; vence hoje se `dueDate = today`; próximos sete dias se `today <= dueDate <= today+7` (inclui hoje e o sétimo dia); posterior se `dueDate > today+7`. Registro concluído/inativo não integra essas contagens, salvo se o modelo de domínio atual define “em acompanhamento” de outro modo; mapear o status canônico antes da consulta.
- **Métrica “Vencidos”:** quantidade de registros ativos atrasados. **“Vencem em 7 dias”:** registros ativos com data de hoje até sete dias adiante, inclusive. **“Em acompanhamento”:** total de registros ativos no escopo, incluindo vencidos e próximos; portanto, não somar os três cards como categorias independentes.
- **Ordem padrão:** vencidos primeiro, do vencimento mais antigo ao mais recente; depois hoje, datas futuras crescentes. Em empate por data, ordenar por título em português (`pt-BR`) e ID para estabilidade. Essa regra corresponde à ordem visual da captura.
- **Badges:** `Vencido`; `Vence hoje`; `Vence em 1 dia`; `Vence em N dias` (2–7); registros acima de 7 dias podem mostrar `Em breve` como no protótipo, desde que a data esteja clara. Nunca reutilizar texto calculado estaticamente do exemplo.
- **Datas:** `dd/MM/yyyy` com zero à esquerda. Título e contexto vêm dos campos reais do registro. Não inventar unidade, tipo ou responsável ausente; omitir a segunda linha quando não houver informação contextual relevante.
- **Paginação:** exibir inicialmente no máximo 11 itens, reproduzindo a densidade do protótipo, e mostrar `Exibindo X de Y vencimentos`. `Y` é total real da consulta; “Ver todos os vencimentos” abre a listagem completa. Busca e filtro operam sobre **todo o conjunto autorizado via serviço**, não só sobre os 11 itens recebidos inicialmente; mostrar total correspondente. Nunca carregar milhares de registros no browser para filtrá-los silenciosamente.
- **Busca:** procurar título e contexto (unidade, categoria ou outra informação exibida), sem sensibilidade a maiúsculas e acentos se o backend suportar normalização; valor aparado de espaços externos; debounce entre 250 e 350 ms para consulta remota; limpar busca restaura conjunto do filtro atual. Paginação volta ao começo ao alterar busca/filtro.
- **Filtros:** `Todos` = todos os ativos; `Vencidos` = atrasados; `Próximos 7 dias` = hoje até sétimo dia inclusive. Clicar um card aplica o filtro correspondente à lista e atualiza o select. Card “Em acompanhamento” equivale a `Todos`. A seleção ativa recebe borda roxa, com atributo de estado acessível. Métricas permanecem globais sob o escopo da organização e **não mudam com a busca da lista**.

## 6. Estados de interface

| Estado | Resultado exigido |
|---|---|
| Carregamento inicial | Shell e hierarquia visíveis; placeholders de métricas e lista sem números fictícios; anunciar carregamento discretamente. Evitar deslocamento grande do layout. |
| Atualização de busca/filtro | Manter cards e lista anterior visíveis com indicação de atualização; descartar resultados de requisições antigas que retornem fora de ordem. |
| Organização sem registros | Indicadores `0`; lista com título `Nenhum vencimento em acompanhamento` e texto curto orientando a criar o primeiro registro; ação “Novo vencimento” disponível se autorizada. |
| Busca/filtro sem resultado | `Nenhum vencimento encontrado para esta busca.`; preservar busca e filtro; oferecer ação para limpar filtros quando houver valor aplicado. |
| Erro de carregamento | Mensagem `Não foi possível carregar a visão geral. Tente novamente.` e botão `Tentar novamente`; não substituir falha por zeros. |
| Sessão expirada | Seguir regra de autenticação, levando a `/login` com destino interno seguro preservado. |
| Sem permissão de leitura | Mensagem específica de acesso insuficiente, sem exibir dados de outro tenant; não confundir com lista vazia. |
| Logout pendente/erro | Seguir comportamento de sessão do projeto; não exibir confirmação de saída antes de encerrar sessão. |

As métricas devem usar formatação local `pt-BR` para milhares. Evitar transições animadas de números; nunca mostrar números ilustrativos durante a busca real.

## 7. Navegação e acessibilidade

- Usar `<main>`, `<nav aria-label="Navegação principal">`, único `<h1>`, seções com títulos H2 e listas/elementos tabulares semanticamente adequados. O cabeçalho da lista é de dados; usar tabela responsiva ou semântica equivalente que preserve a associação entre título, data e urgência no leitor de tela.
- Marcar a rota atual com `aria-current="page"`; usar `<a>` para navegação e `<button>` para filtros e ações. Ícones decorativos `aria-hidden="true"`. Título de vencimento é link de detalhe com nome discernível.
- Métricas clicáveis: anunciar número, categoria e efeito do filtro, por exemplo `5 vencidos; filtrar lista por vencidos`. Estado ativo por `aria-pressed` ou padrão equivalente; nunca depender só de cor.
- Busca tem rótulo programático “Buscar vencimento”; select tem “Filtrar vencimentos”; resultados atualizados são anunciados por região `aria-live=polite` sem roubar foco. Aviso de erro usa `role=alert`.
- Menu móvel: botão com `aria-expanded` e `aria-controls`, gerenciamento de foco descrito no §4; fechar com Esc. Quando fechado, sidebar não está na ordem de tabulação. Quando aberto, fundo é inerte e a rolagem do corpo fica contida.
- Garantir alvos de toque de pelo menos 44 × 44 px para controles principais, inclusive ícone de menu e CTA de criação. Não truncar dado importante sem `title`/nome acessível completo.

## 8. Integração técnica

A página consome a camada de dados e o roteador existentes. O contrato semântico esperado é:

```ts
type DashboardQuery = {
  tenantId: string; // obtido da sessão, nunca confiado a parâmetro livre do cliente
  search?: string;
  filter: 'all' | 'overdue' | 'next7days';
  limit: 11;
  cursor?: string;
};
type DashboardSummary = {
  asOfDate: string; // YYYY-MM-DD na zona da organização
  overdueCount: number;
  next7DaysCount: number;
  activeCount: number;
};
type DueItem = {
  id: string;
  title: string;
  context?: string;
  dueDate: string; // YYYY-MM-DD; não um timestamp de meia-noite UTC
};
type DashboardPage = {
  summary: DashboardSummary;
  items: DueItem[];
  totalMatching: number;
  nextCursor?: string;
};
```

A implementação pode mapear os tipos e endpoints reais para esse formato em um adaptador. Não presumir nomes físicos de tabelas, caminhos de API nem status internos. O serviço deve aplicar autenticação, autorização, escopo do tenant, contagens e filtros no servidor. Se resumo e lista vêm de chamadas distintas, assegurar data de referência e escopo iguais; aceitar consistência eventual documentada, sem apresentar contagem e itens de tenants diferentes. Revalidar no retorno à aba e após criação/edição de vencimento. Cache deve separar organização, identidade e filtros. Respeitar cancelamento de busca e evitar corrida de respostas. Tratar data e timezone em utilitário central.

A navegação lateral deve reutilizar o roteamento e as permissões já existentes. Não alterar fluxos dos módulos vizinhos nesta entrega. Componentizar shell (sidebar, cabeçalho), métricas, controles e lista para reutilização, mantendo os tokens definidos a partir das telas aprovadas. Não embutir o PNG em base64 na produção nem carregar ícones por CDN. Usar ícones SVG locais consistentes com o protótipo.

## 9. Critérios de aceite

1. Comparação visual com `OmniVence-visao-geral-prototipo.html` em 1440×900, 1280×800, 900×900, 390×844 e 320×700: hierarquia, medidas, cores e comportamento responsivo equivalentes; sem overflow horizontal nem corte de textos essenciais.
2. Títulos, textos, menu, ordem, cards e CTA corretos; nome do produto OmniVence em vez de Expiration Tracker; nenhum dado de exemplo, aviso de protótipo ou link `#...` em produção.
3. Indicadores calculados sobre o tenant ativo; casos de ontem/hoje/amanhã/sétimo/oitavo dia corretos no fuso de referência, inclusive atravessando mudança de mês e ano; categorias e ordem coerentes.
4. Busca remota, filtros, clique dos cards e “Ver prioridades” produzem o mesmo conjunto e totais, inclusive quando o resultado não pertence à primeira página inicial. Requisições fora de ordem não sobrescrevem resultado atual.
5. Itens levam ao detalhe correto; criação abre o fluxo real; menu e logout funcionam; permissões e tenant são respeitados no servidor.
6. Carregamento, lista vazia, ausência de resultados, erro de rede, falta de permissão e sessão expirada têm tratamento distinto e acessível.
7. Teclado e leitor de tela navegam em ordem lógica; menu móvel gerencia foco e Esc; métricas anunciam função e estado; zoom de 200% não oculta conteúdo ou controles.
8. Testes relevantes cobrem classificação temporal, ordenação estável, contagens, filtros/busca paginados e escopo de organização. Verificação manual visual e de acessibilidade antes de concluir.

## 10. Definição de pronto

A tela fica pronta quando reproduz o protótipo, consome dados reais coerentes, navega para os fluxos existentes, opera nos estados descritos e passa pelos critérios de aceite. Qualquer divergência descoberta no modelo de domínio atual, sobretudo no significado de “ativo” e “em acompanhamento”, deve ser documentada e resolvida com os status reais antes da implementação das contagens; não preencher a lacuna com dados demonstrativos.
