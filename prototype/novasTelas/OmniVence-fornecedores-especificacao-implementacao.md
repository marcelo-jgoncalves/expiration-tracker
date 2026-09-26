# OmniVence — Fornecedores: especificação de implementação

**Status:** especificação da tela aprovada. **Referência visual obrigatória:** `OmniVence-fornecedores-prototipo.html`. **Referências de consistência:** shell da Visão geral e formulário Novo vencimento. **Idioma:** português do Brasil. **Escopo:** listagem, busca, alternância entre ativos e arquivados, acesso a detalhe/edição, criação, arquivamento, restauração e exclusão. Os dados e as alterações do HTML são demonstrativos.

## 1. Autoridade e limites

1. Reproduzir a composição e linguagem do protótipo: cabeçalho, painel roxo, controles, lista e sidebar compartilhada. Este documento rege dados, navegação, segurança, confirmações e acessibilidade quando o protótipo apenas simula a interação.
2. Manter o título de navegação **Fornecedores**, inclusive quando linhas exibirem tipo “Cliente”. A lista original mistura Cliente e Fornecedor; **não filtrar automaticamente pelo nome da página**. Obter o conjunto que a listagem atual de organizações/terceiros oferece no domínio real.
3. Os quatro nomes, identificadores, tipos, tags e números do protótipo são exemplos; não incorporá-los como seeds nem mostrar contagens fictícias durante carregamento. Os CNPJs exibidos são ilustrativos.
4. Os botões finais representam, nesta ordem, **Editar**, **Arquivar/Restaurar** e **Excluir**. São ações distintas. Arquivar muda a situação e permite restauração; Excluir é uma operação destrutiva sujeita às regras reais de integridade e autorização.
5. O protótipo não valida o efeito de exclusão sobre documentos, requisitos, vencimentos e histórico. **Não prometer exclusão definitiva se o modelo impedir ou substituir por soft delete.** O comportamento implementado deve seguir o contrato de domínio confirmado e comunicar ao usuário a consequência real. A especificação abaixo fixa os estados da interface e a proteção contra enganos.
6. Não adicionar filtros de tipo, exportação, métricas novas, seleção em massa, edição inline nem automações não representadas no protótipo.
7. O logo é o asset provisório aprovado. Não reconstruí-lo a partir do PNG ou trocar o símbolo.

## 2. Navegação e permissões

| Elemento | Ação |
|---|---|
| Sidebar “Fornecedores” | Selecionado com `aria-current="page"`; demais itens usam rotas reais do produto |
| “Novo fornecedor” | Abre o fluxo existente de criação de cadastro; rota real do roteador |
| Nome da organização | Abre detalhe do cadastro real usando ID canônico |
| Editar | Abre edição do cadastro real; nunca salvar alterações diretamente na linha |
| Arquivar | Confirmação antes de mudar situação de ativo para arquivado |
| Restaurar | Aparece no lugar de Arquivar quando a linha está arquivada; confirmação e retorno à aba Ativos |
| Excluir | Confirmação explícita antes da operação oferecida pelo serviço; tratamento de vínculos/bloqueios do domínio |
| Sidebar “Sair” | Segue fluxo real de logout compartilhado |

A visibilidade de criação, edição, arquivamento, restauração e exclusão deve refletir permissão do usuário atual. Se uma ação não for permitida, ocultar seu controle ou explicar indisponibilidade conforme o padrão do produto; em todos os casos o backend deve verificar autorização e organização. Nunca inferir permissão só porque o ícone aparece. Não deixar `href="#"`, alertas de protótipo nem botões inertes na versão de produção.

## 3. Microcópia e elementos aprovados

| Local | Texto |
|---|---|
| `<title>` | `Fornecedores · OmniVence` |
| Selo superior | `RELACIONAMENTOS E CONFORMIDADE` |
| H1 | `Fornecedores` |
| Subtítulo | `Acompanhe organizações e pessoas que precisam manter a documentação em dia com você.` |
| Ação principal | `Novo fornecedor` |
| Painel, selo | `REDE DE PARCEIROS` |
| Painel, título | `Todos os relacionamentos, em um só lugar.` |
| Painel, apoio | `Encontre rapidamente quem precisa da sua atenção e mantenha cada cadastro organizado.` |
| Número do painel | total de registros ativos + `cadastros ativos` |
| Título da lista | `Seus cadastros` |
| Apoio da lista | `Consulte e gerencie os registros da sua organização.` |
| Abas | `Ativos` e `Arquivados`, com contadores reais |
| Busca | placeholder `Nome ou CNPJ/identificador`; nome acessível `Buscar por nome ou CNPJ/identificador` |
| Colunas | `Organização`, `Tipo`, `Tags`, `Ações` |
| Tag ausente | `Sem tags` |
| Ações | `Editar`, `Arquivar` ou `Restaurar`, `Excluir` |

O rodapé `Exibição demonstrativa` existe só no protótipo e deve ser removido. Mostrar contagem real `X cadastro(s) nesta visualização`, com pluralização correta: `1 cadastro nesta visualização` e `N cadastros nesta visualização`. O usuário pode ter mais registros que uma página; deixar claro `Exibindo X de Y` quando a lista for paginada.

## 4. Layout e estilo

### Acima de 900 px

- Reutilizar sidebar aprovada: 256 px, branca, borda direita `#E8E4F1`, menu agrupado, identidade no rodapé e destaque de Fornecedores. Área principal sobre `#F8F7FC`, padding superior 37 px, lateral `clamp(24px,3.4vw,62px)`, inferior 65 px, máximo 1840 px.
- Cabeçalho em linha: selo 11 px/800, H1 `clamp(27px,2.5vw,37px)` com tracking `-.052em`, subtítulo 13 px; botão roxo à direita com 44 px de altura, ícone de adição e label.
- Painel de apresentação: roxo profundo `#4C1D95`, borda arredondada 16 px, altura mínima 138 px, padding 24 × 29 px; ícone linear em caixa translúcida 48 px, mensagem central e total ativo à direita separado por linha. Decoração circular discreta em CSS, sem gradiente, brilho nem foto.
- Cabeçalho da lista: título 17 px e apoio 11 px à esquerda; abas e busca à direita sempre que houver largura. Margem superior 29 px. Abas em contêiner `#F0EDF7` com botões de 32 px de altura; aba ativa branca com texto `#4C1D95`. Busca branca com borda `#E5E0EF`, altura 39 px e aproximadamente 200 px de entrada.
- Lista: fundo branco, borda `#E8E4F1`, raio 15 px. Cabeçalho `#FBFAFE`, 10 px/800, maiúsculas, padding 15 × 21 px. Quatro colunas CSS: `minmax(200px,1.65fr) minmax(120px,.6fr) minmax(120px,.8fr) 136px`; gap 17 px. Linha mínima 77 px, padding 12 × 21 px, divisor `#F0EDF6`. Nome 12 px/800 roxo, identificador contextual 10 px, tipo 11 px, tags em cápsulas lilases 10 px.
- Ações alinhadas à direita, ícones lineares de 16 px, três alvos separados de pelo menos 38 × 38 px no desktop; hover lilás para editar/arquivar e vermelho claro para excluir. Cada botão tem nome acessível com ação e organização. Para meta de toque, elevar área interativa a pelo menos 44 px sem alterar significativamente a densidade visual.

### Até 1150 px

- Cabeçalho da lista empilha título e controles. Controles ocupam a largura disponível; busca cresce. Não encolher título, abas ou inputs até perder legibilidade.

### Até 900 px

- Sidebar vira drawer sobreposto com fundo escurecido, botão “Abrir menu”, Esc, gestão de foco e bloqueio de interação com o fundo, seguindo exatamente a Visão geral. Conteúdo com padding horizontal 27 px.

### Até 650 px

- Padding principal 20 px superior, 17 px laterais e 45 px inferior. Painel roxo compacto com padding 20 px; ocultar só o bloco numérico lateral, pois o número segue disponível na aba Ativos.
- Controles quebram em duas linhas: abas em toda a largura e busca em toda a largura. O CTA superior pode exibir só ícone visualmente, mantendo `aria-label="Novo fornecedor"`.
- Cabeçalho de colunas oculto visualmente; cada item vira card horizontal dentro da lista: nome e identificador na primeira linha, tipo na segunda, tags na terceira; ações empilhadas à direita. Em telas de 320 CSS px e zoom de 200%, permitir que ações passem para uma faixa inferior se necessário; nunca cortar nome, badge ou botão, nem produzir rolagem horizontal da página.

### Tokens

Usar Plus Jakarta Sans com pesos 400–800 hospedada localmente, `#4C1D95` para superfícies de marca/CTA, `#7C3AED` para ação, `#A78BFA` para foco, `#14121F` texto, `#55507A` apoio, `#F8F7FC` fundo, `#FFFFFF` cards, `#E8E4F1` bordas, `#F1EBFF` seleção. Excluir usa vermelho semântico `#B91C1C` apenas no controle/diálogo de risco; não tornar todas as linhas alarmistas. Foco visível 3 px com offset; contraste AA. Respeitar `prefers-reduced-motion`.

## 5. Dados, busca e paginação

- Escopo obrigatório: organização ativa da sessão; filtros e ações executados no servidor com autorização. A tela não pode listar registros de outra organização por alteração de URL ou ID.
- Cada linha recebe ID canônico, nome, tipo apresentado pelo domínio, identificador exibível (CNPJ ou equivalente), tags autorizadas e situação ativa/arquivada. Não mostrar CNPJ inexistente nem gerar identificador fictício. Se não houver identificador, omitir a segunda linha sem espaço vazio artificial.
- Métrica no painel e número da aba Ativos: total real de cadastros ativos; aba Arquivados: total real arquivado. As contagens não são calculadas a partir das linhas da página atual e **não mudam por causa do termo de busca**, salvo decisão explícita de produto posterior; a lista e seu total de resultados respondem à busca.
- Aba inicial Ativos. Trocar de aba preserva o termo pesquisado, redefine paginação ao começo e consulta o novo conjunto. A aba selecionada deve permanecer coerente em retorno da edição e refresh se o roteador já gerencia query state; evitar manter filtro apenas em memória se isso quebrar navegação de retorno.
- Busca por nome e CNPJ/identificador no conjunto da aba selecionada, com trim das pontas e debounce de 250–350 ms. Normalização de caixa, acentos e pontuação do CNPJ deve ocorrer no serviço quando suportada; enviar valor seguro e não filtrar apenas linhas já carregadas. Limpar o campo restaura a lista da aba atual.
- Ordenação padrão: nome exibido em ordem alfabética `pt-BR`, com ID como desempate estável, a menos que a listagem atual tenha ordem de negócio explicitamente definida; nessa situação preservar a regra do domínio e documentá-la na integração. Sem ordenação mutável na UI desta entrega.
- Paginação real para volumes maiores, de acordo com o padrão existente do produto; manter aba e busca ao avançar. O protótipo com quatro linhas não define tamanho de página. Evitar carregar todos os registros para paginar no navegador. Não mostrar `4` ou `0` antes da resposta da API.
- Tags são dados reais; `Sem tags` é apresentação visual, não tag persistida.

## 6. Comportamento das ações

### Editar

Abrir formulário de edição do ID selecionado por rota existente. Sem confirmação na listagem, pois abrir edição não altera dados. Se o registro deixar de existir, apresentar erro de item não encontrado e atualizar a lista.

### Arquivar

- Abrir diálogo com título `Arquivar cadastro?`, texto `O cadastro de {nome} sairá da lista de ativos. Você poderá restaurá-lo depois.`, botões `Cancelar` e `Arquivar`.
- Foco inicial em Cancelar. Confirmar dispara uma única operação; durante envio bloquear confirmação repetida e anunciar progresso. Só mover a linha à aba Arquivados e atualizar contadores após sucesso confirmado pelo serviço. Preservar busca, aba e paginação coerentes.
- Em falha, manter diálogo com mensagem `Não foi possível arquivar o cadastro. Tente novamente.` e permitir nova tentativa/cancelamento. Se o backend impedir o arquivamento por vínculo ou regra de negócio, mostrar motivo seguro fornecido pelo domínio e não fingir sucesso.

### Restaurar

- Somente na aba Arquivados. Mesmo botão funcional, com ícone e nome `Restaurar {nome}`; diálogo `Restaurar cadastro?` e texto `O cadastro de {nome} voltará para a lista de ativos.`. Botões `Cancelar` e `Restaurar`.
- Atualizar contagens/lista apenas depois de sucesso. Tratar erro e conflito de forma análoga ao arquivamento.

### Excluir

- Apresentar título `Excluir cadastro?` e texto que descreva a consequência real implementada no domínio. O texto genérico do protótipo (`Esta ação excluiria o cadastro de {nome}. Confirme apenas se tiver certeza.`) **não basta** para uma exclusão real se existirem relações, retenção ou restauração possível.
- Botão final `Excluir` em vermelho `#B91C1C`, Cancelar como ação inicial/focada. Se a exclusão for irreversível e permitida, solicitar confirmação explícita adicional (por exemplo, digitar o nome do cadastro) antes de habilitar Excluir; impedir acionamento acidental. Se o backend oferece exclusão lógica recuperável, explicar isso com precisão e não usar linguagem de irreversibilidade.
- Verificar no serviço vínculos com documentos, requisitos, vencimentos e histórico. Se a exclusão for proibida, informar `Este cadastro não pode ser excluído porque possui registros vinculados.` quando essa for a causa confirmada; sugerir Arquivar quando autorizado. Jamais executar cascata destrutiva a partir desta tela sem requisito e confirmação específicos.
- Confirmar uma única vez; só retirar linha/atualizar contadores após resposta de sucesso. Falha preserva diálogo e registro. A ação precisa obedecer às políticas de auditoria/retensão do produto.

### Diálogos

Usar `role="dialog"`, `aria-modal=true`, título/descrição associados, foco contido, Esc e clique fora equivalem a Cancelar quando nenhuma operação está em envio, e foco retorna ao botão de origem se ainda existir; caso tenha sumido após sucesso, foco vai ao título da lista ou controle da aba. Nome longo deve quebrar, sem truncar a confirmação. Não deixar confirmação acionável durante requisição pendente.

## 7. Estados de tela

| Estado | Conteúdo/ação |
|---|---|
| Carregamento inicial | Shell e cabeçalho visíveis; placeholders de total e linhas; sem dados de exemplo. |
| Atualizando busca/aba | Manter controles e indicação discreta de progresso; descartar resposta antiga que chegue após consulta mais recente. |
| Sem ativos | `Nenhum cadastro ativo.` / `Crie um fornecedor para começar.`; CTA visível se usuário pode criar. |
| Sem arquivados | `Nenhum cadastro arquivado.` / `Os cadastros arquivados aparecerão aqui.` |
| Busca sem correspondência | `Nenhum resultado encontrado.` / `Tente buscar por outro nome ou identificador.`; oferecer limpar busca. |
| Falha ao carregar | `Não foi possível carregar os cadastros. Tente novamente.` e botão `Tentar novamente`; não interpretar falha como lista vazia. |
| Falta de permissão | Estado próprio sem dados sensíveis e caminho seguro de retorno. |
| Item removido por outro usuário | Informar atualização necessária, recarregar lista e contadores; não continuar operação sobre ID inexistente. |
| Sessão expirada | Seguir regra de login do aplicativo com destino interno seguro. |

## 8. Acessibilidade e semântica

- Um `<main>`, um `<h1>`, seção de lista com H2, sidebar `<nav>` e controles tabulados. Abas usam `role=tablist`, `role=tab`, `aria-selected`, `aria-controls` e painel correspondente, ou navegação segmentada semanticamente equivalente. Teclas de seta movem seleção se o padrão tabs for adotado; Tab entra no painel.
- Lista em tabela semântica com cabeçalhos ou estrutura equivalente que preserve associação de Organização/Tipo/Tags/Ações para leitor de tela. Em mobile, a associação continua compreensível mesmo com cabeçalho visualmente oculto.
- Botões de ação têm nomes completos: `Editar {nome}`, `Arquivar {nome}` ou `Restaurar {nome}`, `Excluir {nome}`; não depender de cor, tooltip ou formato do ícone. Links e botões recebem foco visível.
- Busca tem label acessível e região `aria-live=polite` anuncia número de resultados sem roubar foco. Mudança de aba e conclusão de ação também são anunciadas.
- Controles principais com alvo mínimo 44 × 44 px; em nome muito longo, quebra visual, texto integral para leitor de tela. Zoom até 200% e largura de 320 CSS px sem perda de informação ou ação.
- Drawer móvel segue regras do shell compartilhado. Diálogos seguem §6. Respeitar teclado, Esc e `prefers-reduced-motion`.

## 9. Contrato semântico de integração

Adaptar a API e nomes reais do repositório a este contrato; não inventar endpoints físicos:

```ts
type OrganizationRecord = {
  id: string;
  displayName: string;
  typeLabel: string;
  identifierDisplay?: string;
  tags: string[];
  archived: boolean;
};
type SupplierListQuery = {
  status: 'active' | 'archived';
  search?: string;
  cursor?: string;
  limit: number;
};
type SupplierListPage = {
  items: OrganizationRecord[];
  matchingCount: number;
  nextCursor?: string;
  activeCount: number;
  archivedCount: number;
};
```

A organização/tenant é derivada da sessão e aplicada no servidor; não confiar em ID arbitrário vindo do cliente. Os nomes “supplier” deste contrato são apenas interface de adaptação: a entidade real pode ser terceiro, empresa, cliente/fornecedor ou outra. O servidor retorna permissões por ação ou a UI recebe políticas autorizadas da sessão; validar novamente na mutação. Separar cache por organização, status, busca e cursor; invalidar/resincronizar ao criar, editar, arquivar, restaurar e excluir. Evitar requisições duplicadas e mutações otimistas destrutivas. Não enviar identificadores pessoais a analytics nem incluir detalhes sensíveis em logs.

## 10. Critérios de aceite

1. Revisão visual contra o protótipo em 1440×900, 1280×800, 900×900, 390×844 e 320×700: layout, componentes, ações e quebra responsiva equivalentes; sidebar igual às telas aprovadas; nenhuma rolagem horizontal.
2. Aba Ativos inicial; alternância preserva busca; pesquisa alcança todo o conjunto autorizado no servidor; contagens reais independem da página; listagem paginada apresenta total coerente.
3. Nome abre detalhe, Editar abre edição, Arquivar move para arquivados após sucesso, Restaurar retorna aos ativos após sucesso. Falha não altera estado exibido como se fosse sucesso.
4. Excluir exige confirmação proporcional à consequência real, respeita vínculos, autorização e política de retenção; jamais apaga registros associados por efeito surpresa.
5. Estados vazio, sem resultado, carregamento, erro, falta de permissão e sessão expirada não se confundem. Requisição de busca antiga não substitui resultado da última busca.
6. Em mobile, ações continuam distinguíveis e operáveis por toque, teclado e leitor de tela; diálogos prendem/devolvem foco; nomes acessíveis completos e contrastes adequados.
7. Nenhum nome, CNPJ, tag, contagem, aviso ou mutação demonstrativa do HTML permanece como dado fixo de produção. Testes relevantes cobrem filtragem/paginação, escopo de organização, autorização, alterações de status e bloqueio da exclusão por vínculos.

## 11. Definição de pronto

A tela está pronta quando reproduz o protótipo, usa registros reais no escopo correto, oferece os três controles de linha com o significado e a confirmação apropriados, trata estados/erros e cumpre os critérios acima. Antes de integrar a exclusão, confirmar o comportamento real do domínio e das entidades vinculadas; a UI deve descrevê-lo com exatidão.
