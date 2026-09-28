# OmniVence — Detalhe do fornecedor: especificação de implementação

**Status:** especificação para implementar a página de detalhe. **Referência visual:** `OmniVence-fornecedor-detalhe-prototipo.html`. **Referências funcionais:** listagem de Fornecedores já especificada e requisitos documentais do produto. **Idioma:** português do Brasil. **Escopo:** identificação do cadastro, conformidade, abas Requisitos e Solicitações, busca e ações Editar fornecedor, Exportar dossiê, Excluir fornecedor e Novo requisito. O fornecedor e as alterações em memória do HTML são ilustrativos.

## 1. Autoridade, escopo e decisões

1. Reproduzir a linguagem visual do protótipo e o shell aprovado. Esta especificação prevalece sempre que uma interação do HTML for demonstrativa, especialmente **cálculo de conformidade, exportação, exclusão, navegação e dados vinculados**.
2. A página mostra **um cadastro identificado pelo ID canônico** na organização ativa. O exemplo `Comércio Vale Verde ME`, tipo `Cliente`, existe apenas para demonstrar a composição. Usar nome, tipo, requisitos, solicitações e permissões reais recebidos do serviço. O título “Fornecedor” nesta especificação e na navegação representa o cadastro da seção Fornecedores, que também pode ter tipo Cliente.
3. **Conformidade sem denominador:** se não houver requisitos aplicáveis, apresentar travessão `—`, `Nenhum requisito aplicável cadastrado` e barra sem preenchimento. Não apresentar 0% nem 100% como se houvesse avaliação. Quando o domínio oferecer resultado de conformidade calculado, usar o resultado oficial, não reproduzir cegamente o algoritmo simplificado do protótipo.
4. As três caixas `Requisitos satisfeitos`, `Vencendo em breve` e `Em falta` mostram contagens reais com regras do domínio; não inferir “vencendo em breve” a partir do nome ou de `status` de requisito. A aplicação não pode mostrar sempre `0` nessa caixa como faz o protótipo.
5. A aba inicial é **Requisitos**; **Solicitações** é outra consulta do mesmo cadastro. O HTML representa ambas vazias; em produção, estados vazios só aparecem após carregamento bem-sucedido. O botão Novo requisito abre criação vinculada ao fornecedor atual sem solicitar ao usuário copiar/digitar ID.
6. Editar fornecedor, Exportar dossiê e Excluir fornecedor são operações com permissões e consequências diferentes. O toast demonstrativo de exportação e a exclusão inerte do HTML **não** constituem comportamento de produção.
7. O protótipo de Requisitos documentais foi criado separadamente; usar o mesmo vocabulário, catálogo de situações, regra de aplicabilidade e fluxo de criação em ambas as entradas. A tela global e o hub devem mostrar o mesmo requisito e refletir suas alterações.

## 2. Rota, acesso e navegação

| Origem/controle | Comportamento de produção |
|---|---|
| Nome na lista Fornecedores | Abre o detalhe pelo ID canônico do cadastro na organização ativa. |
| `← Voltar para Fornecedores` | Retorna à listagem real, preservando aba Ativos/Arquivados, busca e página quando há estado de navegação válido. Se o detalhe foi aberto diretamente, navega à listagem padrão. Não depende do histórico do navegador para funcionar. |
| Sidebar Fornecedores | Item selecionado com `aria-current="page"`; demais rotas usam o shell aprovado. |
| Editar fornecedor | Abre o formulário real de edição do ID exibido; salvar segue o contrato de fornecedor, e o detalhe atualiza após sucesso. |
| Exportar dossiê | Inicia o fluxo de exportação real e autorizado do dossiê **deste cadastro**. Ver §8. |
| Excluir fornecedor | Abre confirmação e segue as regras de exclusão do domínio, sem cascata presumida. Ver §9. |
| Novo requisito | Abre o fluxo de criação com fornecedor predefinido e vinculado por ID. |
| Abas | Alternam Requisitos e Solicitações; não modificam registros. |

- A rota usa o ID do cadastro como parâmetro identificador, nunca o nome ou CNPJ como chave. Toda consulta/mutação verifica no servidor que o cadastro pertence à organização ativa e que a pessoa autenticada possui a permissão necessária. Não vazar existência de recurso de outro tenant.
- Se o cadastro for arquivado, usar cabeçalho `Arquivado` com badge neutro, manter visualização do histórico autorizado e esconder/desabilitar ações não permitidas para arquivados. O fluxo de restauração pertence à listagem de Fornecedores, a menos que a aplicação já possua ação equivalente no detalhe; não inventar um botão neste protótipo.
- Após troca de organização, expiração de sessão, perda de permissão ou exclusão concorrente, invalidar dados, totais, exportações em andamento e ações do cadastro anterior. Nunca renderizar em cache dados do tenant antigo sob o cabeçalho do novo.
- Permissões independentes para visualizar o cadastro, listar requisitos, listar solicitações, criar/editar/excluir requisitos, editar cadastro, exportar e excluir cadastro. Servidor revalida cada operação mesmo quando a UI oculta controles.

## 3. Microcópia e conteúdo

| Elemento | Texto/regra |
|---|---|
| `<title>` | `{nome do cadastro} · OmniVence`; durante carregamento `Fornecedor · OmniVence`. |
| Voltar | `← Voltar para Fornecedores` |
| Selo superior | `HUB DO FORNECEDOR` |
| H1 | Nome real do cadastro, por extenso, quebrando linha se necessário. |
| Badge de tipo | Tipo real localizado (`Cliente`, `Fornecedor` ou outro tipo previsto no domínio). |
| Apoio do cabeçalho | `Documentos e solicitações em um só lugar` |
| Ações do cabeçalho | `Editar fornecedor`, `Exportar dossiê`, `Excluir fornecedor` quando permitidas. |
| Card | `Conformidade documental`; contexto `Panorama dos requisitos aplicáveis`. |
| Sem denominador | `—`; `Nenhum requisito aplicável cadastrado`. |
| Com denominador | `{percentual}%`; `{satisfeitos} de {total aplicável} requisitos satisfeitos`. |
| Indicadores | `Requisitos satisfeitos`, `Vencendo em breve`, `Em falta`. |
| Nota da métrica | `A conformidade é calculada a partir dos requisitos aplicáveis deste fornecedor.` |
| Abas | `Requisitos` e `Solicitações`. |
| Cabeçalho Requisitos | `Requisitos (N)`; apoio `Exigências documentais deste fornecedor.` |
| Ação Requisitos | `Novo requisito` |
| Busca | `Buscar por nome do requisito` |
| Colunas | `Requisito`, `Situação`, `Aplicabilidade`, `Ações`. |
| Requisitos sem dados | `Nenhum requisito cadastrado`; apoio `Cadastre a primeira exigência documental para acompanhar este fornecedor.`; `Criar primeiro requisito` se autorizado. |
| Busca sem correspondência | `Nenhum requisito encontrado`; apoio `Experimente outro termo na busca.` |
| Cabeçalho Solicitações | `Solicitações`; apoio `Acompanhe pedidos de documentos enviados a este fornecedor.` |
| Solicitações sem dados | `Nenhuma solicitação por enquanto`; apoio `Quando houver solicitações para este fornecedor, você poderá acompanhá-las aqui.` |

Não exibir mensagens `somente neste protótipo` em produção. Ajustar singular/plural de requisitos e contagens. O título do documento e as identidades do cabeçalho mudam quando a edição real é confirmada.

## 4. Layout, tokens e responsividade

### Desktop, acima de 1160 CSS px

- Shell compartilhado: sidebar branca 256 px com borda `#E8E4F1`, item Fornecedores selecionado; área principal `#F8F7FC`, padding superior 37 px, horizontal `clamp(24px,3.4vw,62px)`, inferior 65 px e largura máxima 1600 px.
- Link Voltar acima do cabeçalho, 11 px/800, roxo `#6D28D9` e margem inferior 24 px. Cabeçalho em duas áreas: nome/tipo à esquerda, três ações à direita. H1 `clamp(29px,2.7vw,40px)` com tracking `-.055em`; nome longo quebra, sem truncamento. Ações têm altura 41 px, borda 1 px, raio 9 px; Excluir usa texto/borda vermelhos discretos e confirmação própria, sem botão vermelho maciço permanente.
- Card de conformidade branco, borda `#E8E4F1`, raio 16 px, padding 23 × 25 px. Título 16 px e explicação curta à direita. Região interna em quatro colunas `minmax(205px,1.35fr) repeat(3,minmax(125px,1fr))`, gap 10 px. Primeiro bloco contém percentual 28 px, fração 10 px e trilho de progresso de 6 px; demais indicadores têm número 21 px e descrição 10 px. Cores semânticas: verde `#047857` satisfeito, âmbar `#A94A05` vencendo, vermelho `#B91C1C` em falta. Sempre mostrar texto, não confiar só na cor.
- Abas após o card, 30 px de margem superior, borda inferior discreta e sublinhado roxo de 2 px na ativa. Painel começa 22 px abaixo. Cabeçalho com título/apoio à esquerda e Novo requisito à direita.
- Busca em card branco com padding 13 px, input de 41 px e largura máxima 420 px. Lista em card branco raio 16 px. Cabeçalho `#FBFAFE`, letras maiúsculas 9 px/800; grade `minmax(200px,1.6fr) minmax(110px,.65fr) minmax(100px,.55fr) 82px`, gap 16 px. Linhas mínimas 67 px, padding 13 × 21 px; ações de Editar/Excluir com nomes acessíveis completos e alvos interativos ≥44 × 44 px, mesmo que os ícones visuais sejam menores.
- Estado vazio centralizado dentro do card, ícone linear discreto sobre `#F1EBFF`, título 14 px, texto 11 px e CTA quando autorizado. Sem bordas duplicadas ou linhas fictícias.

### Até 1160 CSS px

- Cabeçalho vira duas linhas: identificação acima e ações abaixo, com quebra sem colisão. Card de conformidade: bloco da taxa ocupa linha inteira; três indicadores ocupam a linha inferior.

### Até 900 CSS px

- Sidebar vira drawer do shell compartilhado com botão Abrir menu, overlay, Esc, contenção e devolução do foco. Não duplicar a grade principal nem cortar ações.

### Até 650 CSS px

- H1 até 28 px, quebra de palavras longas; ações em grade de duas colunas, terceira ação ocupa a largura inteira. Indicadores em três colunas compactas sem ocultar valor ou rótulo. Cabeçalho da lista some visualmente; cada requisito organiza nome, situação, aplicabilidade e ações sem perder associação. Botão Novo requisito pode ocupar a largura disponível. Em 320 CSS px e zoom 200%, cards refluem sem rolagem horizontal nem texto sobreposto.

**Tokens:** Plus Jakarta Sans hospedada localmente, pesos 400–800; `#4C1D95` marca/CTA, `#7C3AED` realce/foco, `#A78BFA` foco visível, `#14121F` texto, `#55507A` apoio, `#716B86` secundário, `#F8F7FC` fundo, `#FFFFFF` superfície, `#E8E4F1` bordas. Contraste AA, foco visível 3 px e preferência por movimento reduzido.

## 5. Conformidade e consistência de dados

1. A conformidade é específica do cadastro e considera somente requisitos ativos **aplicáveis** segundo a regra oficial do domínio; requisitos marcados `Não se aplica` são excluídos do denominador e não devem ser classificados como satisfeitos por isso. Requisitos arquivados/excluídos não entram na taxa atual. Um requisito ligado a outro fornecedor nunca entra na conta.
2. Quando o domínio usa indicador de conformidade calculado no backend, ele é a fonte de verdade para numerador, denominador, percentual e contadores. Se for necessário implementar cálculo novo, o serviço deve expor uma projeção consistente e única para este hub, a listagem global de requisitos e relatórios. **Não derivar em frontend a partir de uma página parcial de requisitos.**
3. A taxa da visualização corresponde aos satisfeitos / total aplicável × 100, arredondado ao inteiro mais próximo, **somente se** essa definição coincidir com a regra de conformidade aprovada pelo domínio. Se existem situações intermediárias (`Pendente`, `Não satisfeito`, `Em falta`), permanecem no denominador quando aplicáveis e não contam como satisfeitas, a menos que regra de negócio oficial determine de outra forma. A implementação deve mapear explicitamente os códigos reais e a fórmula do serviço antes do aceite; percentuais diferentes entre telas são defeito.
4. `Vencendo em breve` é um contador de requisitos aplicáveis cujas evidências/vencimentos atuais estejam na janela oficial de alerta do produto; a origem e o limiar seguem a mesma regra temporal da Visão geral/Vencimentos. **Não** deduzir esse contador do status `Pendente`, nem manter `0` estático. Se a API não oferecer informação suficiente para computá-lo corretamente, apresentar indisponibilidade específica desse indicador enquanto a projeção é implementada; não mostrar zero falso.
5. `Em falta` reflete o conjunto cuja evidência obrigatória inexiste segundo o catálogo de situações do domínio. `Não satisfeito` não é automaticamente sinônimo de Em falta. A mesma regra e rótulos devem ser usados no hub e na tela global de Requisitos documentais.
6. Na ausência de requisitos aplicáveis, `score = null` e texto `—`; o trilho tem 0% de preenchimento apenas como aspecto visual, sem `aria-valuenow=0` que transmita taxa calculada. Os indicadores reais podem mostrar zero. Assim que um requisito aplicável é criado, atualizado ou removido, reconsultar a projeção e os totais, sem computar resultado otimista no navegador.
7. A busca por nome dentro da aba não muda a conformidade, os indicadores nem o total global `Requisitos (N)`. Apenas a lista filtrada e seu total de resultados mudam. Após salvar, excluir, alterar aplicabilidade ou vínculo, invalidar as consultas do hub, da lista global e de outras vistas que dependam desses dados.

## 6. Abas, busca e listagens

### Requisitos

- Consultar somente requisitos vinculados ao ID do cadastro atual. Ordenar por nome exibido `pt-BR` com ID como desempate estável, salvo ordenação oficial do domínio; se houver ordenação oficial, implementá-la igualmente no hub e documentá-la no adaptador. Não mostrar registros de outro tenant nem confundir nomes duplicados: edição/exclusão usam ID.
- Busca por nome do requisito com trim, normalização de caixa e acentos conforme serviço, debounce de 250–350 ms; filtrar no backend sobre todo o conjunto vinculado, não apenas linhas renderizadas. Limpar campo restaura lista do fornecedor. `Requisitos (N)` é o total sem busca; contador ao lado da busca representa resultados após filtro. Não mostrar zero antes do carregamento.
- A coluna Situação usa o catálogo real do domínio: pelo menos `Em falta`, `Pendente`, `Satisfeito`, `Não satisfeito` e `Não se aplica` quando existentes. O protótipo só gera Em falta/Não se aplica para testar a interface; produção não deve limitar o catálogo a esses dois. Aplicabilidade mostra `Aplicável` ou `Não se aplica` coerentemente com a situação. Um requisito inaplicável não exibe simultaneamente badge `Em falta`.
- Campos subordinados (observação/contexto) só aparecem se houver dado real. Busca sem resultado é distinta da ausência total de requisitos. Volume grande usa paginação real do serviço; manter filtro e aba. Não carregar todos os requisitos só para paginar no cliente.

### Solicitações

- Ao selecionar, consultar solicitações associadas ao ID canônico do cadastro na organização ativa. Apresentar lista com identificador/título, situação, data relevante e ação de detalhe somente quando esses dados e a rota existirem no fluxo real. A captura só confirma uma aba e seu estado vazio: **não inventar** criação, aprovação, reenvio, cancelamento ou etapas de solicitação nesta tela.
- Se não houver solicitações após sucesso, mostrar o vazio aprovado. Erro ao buscar solicitações não substitui a aba por `Nenhuma solicitação`; disponibilizar `Tentar novamente`. Ao alternar de aba, preservar o texto da busca de requisitos sem aplicar esse texto às solicitações.
- O detalhe pode carregar o painel ativo sob demanda. Ignorar/cancelar respostas obsoletas se o cadastro, a aba ou a organização mudar. Se houver paginação no domínio, manter estado próprio por aba. Ao retornar de detalhe ou ação externa, revalidar o painel.

## 7. Criação e edição de requisitos

- `Novo requisito` e `Criar primeiro requisito` abrem o fluxo real já definido para requisitos. O fornecedor está **pré-selecionado e vinculado pelo ID canônico** do detalhe. Na apresentação, mostrar nome do fornecedor e tipo; em produção, não pedir ao usuário que copie um ID. Se o fluxo permitir mudar fornecedor, a decisão deve ser explícita e a saída deve navegar ao hub do cadastro realmente escolhido; o padrão desta entrada é vínculo fixo ao cadastro atual.
- Nome obrigatório, normalizado com trim e limite definido pelo domínio. Aplicabilidade padrão `Aplicável`; observação é opcional se houver campo no modelo real. Os valores do protótipo (nome, aplicabilidade, observação) são recorte visual, não autorizam criar campos inexistentes no backend. Validar no servidor escopo, fornecedor ativo, duplicidade e permissão. Se houver regras de documento/evidência obrigatória no fluxo real, usar essas etapas, sem declarar criação concluída pela simples confirmação do diálogo visual.
- Requisito aplicável recém-criado sem evidência recebe situação inicial retornada pelo backend; **não fixar Em falta se a regra real definir outra situação**. `Não se aplica` precisa de semântica consistente: estado/justificativa conforme domínio, fora do denominador, sem contar como satisfeito.
- Editar é acionado pelo requisito específico. Carregar os dados atuais, validar permissão e alterações concorrentes; após salvar com sucesso, atualizar linha, situação e conformidade. Cancelar não altera dados. Não renderizar mensagem de sucesso antes da confirmação do serviço. Se aplicabilidade/situação depender de documentos ou revisões, não sobrescrever a avaliação com um simples select de edição.
- Ações de linha têm nome acessível `Editar {nome}` e `Excluir {nome}` com contexto distintivo quando nomes repetidos. O fluxo de exclusão verifica vínculos e segue o comportamento real do domínio; solicitar confirmação que nomeia o requisito e a consequência verificada. Se exclusão for bloqueada, preservar registro e sugerir fluxo apropriado. No protótipo ela remove a linha em memória; isso não define exclusão em cascata em produção.
- O botão fica indisponível enquanto uma mutação idêntica está em andamento. Em erro, manter formulário/valores, mostrar erro local recuperável e não alterar lista/totais otimisticamente. Em sucesso, fechar fluxo, revalidar lista/contadores e levar foco ao item criado ou ao título da seção.

## 8. Exportar dossiê

- O botão exporta dados **deste cadastro** conforme a definição real de dossiê no produto. Antes de implementar, o contrato precisa explicitar conteúdo (cadastro, requisitos, evidências/documentos, solicitações e histórico aplicável), formato, permissões, data de corte e política de proteção dos arquivos. Não incluir categorias cuja inclusão não esteja confirmada pelo domínio; mostrar conteúdo/escopo no fluxo de exportação para que o usuário saiba o que receberá.
- Se o serviço produzir o arquivo de forma síncrona, iniciar download somente após sucesso. Se produzir em job assíncrono, apresentar progresso `Preparando dossiê…`, acompanhar status e oferecer download seguro quando pronto. Nome do arquivo inclui identificador não sensível e data; não expor token em URL persistente, analytics ou logs do navegador. Tratar ausência de documentos e erro de exportação sem afirmar que o dossiê foi baixado.
- Revalidar autorização e pertencimento ao tenant na geração e no download. Se essa funcionalidade ainda não estiver disponível no backend, **não exibir botão acionável** que apenas gere toast de demonstração em produção; integrar antes do aceite ou indicar indisponibilidade real sem prometer resultado. O botão permanece na referência visual para a implementação completa.

## 9. Excluir fornecedor

- Esta ação obedece à especificação da listagem de Fornecedores. Exibir `Excluir fornecedor?` e nome completo, além da **consequência real** informada pelo domínio: exclusão lógica/definitiva, retenção e efeitos sobre requisitos, solicitações, evidências, vencimentos e histórico. Não assumir que todos esses vínculos possam ser removidos, nem prometer irreversibilidade sem confirmação técnica.
- Se houver vínculos que bloqueiem a exclusão, o servidor nega a operação e a UI informa o motivo, oferecendo Arquivar quando permitido. Não remover requisitos, solicitações, evidências ou registros históricos em cascata por decisão apenas da interface. Se a operação for definitiva e permitida, exigir confirmação adicional digitada conforme a regra da listagem; botão vermelho e foco inicial em Cancelar.
- Durante envio, bloquear duplo clique e encerramento que deixe o resultado ambíguo. Sucesso confirmado: invalidar detalhe/lista, redirecionar à listagem de Fornecedores com confirmação adequada. Falha/conflito: permanecer na página com dados atuais e mensagem específica. Não navegar ou esconder cadastro antes da resposta.
- Editar fornecedor segue a rota/formulário existente, carrega campos do cadastro real e protege contra conflito; após salvar, atualizar nome/tipo no título, cabeçalho e referências da tela. Não supor que o pequeno formulário de nome/tipo do protótipo represente todos os campos do cadastro.

## 10. Estados e erros

| Estado | Comportamento obrigatório |
|---|---|
| Carregamento inicial | Shell, Voltar e estrutura de cards com skeleton; sem nome fictício, zeros fixos ou `—` confundido com resposta real. |
| Fornecedor sem requisitos | Conformidade `—`; vazio de requisitos com CTA quando autorizado; indicadores da consulta real. |
| Fornecedor com requisitos não aplicáveis apenas | Conformidade `—`; lista mostra requisitos `Não se aplica`; denominador zero. |
| Busca sem correspondência | Vazio `Nenhum requisito encontrado`; total geral continua correto; busca permanece. |
| Solicitações vazias | Mensagem própria da aba após consulta bem-sucedida. |
| Erro de conformidade | Mostrar indisponibilidade no card com `Tentar novamente`, preservando identidade e demais seções carregadas. Não mostrar `0%` nem números antigos como atuais. |
| Erro em uma aba | Erro local à aba, sem apagar cabeçalho/card/aba oposta; `Tentar novamente`. |
| Cadastro inexistente/excluído | `Fornecedor não encontrado` e Voltar; não renderizar dados em cache como se ainda existisse. |
| Falta de permissão | Estado próprio sem nome/contagens/dados do cadastro quando visualização não é permitida. |
| Arquivado | Badge Arquivado e ações compatíveis com o domínio; histórico visível conforme permissão. |
| Sessão expirada | Fluxo de login aprovado com destino interno seguro. |
| Falha de mutação/exportação | Preservar estado e entrada; mensagem específica e tentativa recuperável; não apresentar sucesso falso. |

Carregamento das três projeções (identidade, conformidade e aba ativa) pode ser independente depois da autorização inicial. Sempre distinguir **zero confirmado**, **sem denominador**, **carregando** e **falha**.

## 11. Acessibilidade e segurança

- Um `<main>`, H1 com nome do cadastro, H2 Conformidade documental, Requisitos e Solicitações. Abas com `role=tablist`, `role=tab`, `aria-selected`, `aria-controls`, `role=tabpanel`, navegação por setas e foco previsível; painel inativo não participa da ordem de Tab. Ao trocar aba, foco permanece na aba ativa.
- Indicador percentual, quando existir, expõe valor e contexto acessível (`X de Y requisitos aplicáveis satisfeitos`). Sem denominador, anunciar `Conformidade não calculada: nenhum requisito aplicável cadastrado`, não `0%`. Contadores das caixas têm rótulos completos. Barra visual não substitui texto.
- Busca tem label programático; contagem de resultados anunciada discretamente em `aria-live=polite` sem roubar foco. Lista de requisitos usa tabela semântica ou estrutura com cabeçalhos associados às células; em mobile mantém rótulos de situação/aplicabilidade. Nomes e IDs longos quebram; não truncar dados necessários ao uso.
- Todos os botões têm alvo mínimo 44 × 44 px e foco visível. Diálogos associam título e descrição, contêm foco, iniciam no controle seguro em ações destrutivas, Esc/click fora cancelam somente antes de envio e restauram foco ao acionador; se o item desapareceu após sucesso, foco vai ao título ou linha vizinha. Drawer móvel usa padrão compartilhado.
- Renderizar nomes e observações vindos do serviço como texto escapado; não usar `innerHTML` com dados remotos. Exportação, edição e exclusão são auditáveis e verificadas no servidor por organização e permissão. Não incluir tokens de download, payload de documentos ou identificadores confidenciais em logs/analytics de cliente.

## 12. Contrato semântico de integração

Mapear os endpoints, tipos e códigos físicos reais a esta fronteira, sem inventar rotas de API:

```ts
type SupplierDetail = {
  id: string;                // ID canônico do cadastro na organização ativa
  displayName: string;
  typeCode: string;
  typeLabel: string;
  archived: boolean;
  permissions: {
    edit: boolean;
    exportDossier: boolean;
    delete: boolean;
    listRequirements: boolean;
    createRequirement: boolean;
    listRequests: boolean;
  };
};

type ComplianceSummary = {
  applicableCount: number;
  satisfiedCount: number;
  missingCount: number;
  expiringSoonCount: number | null; // null: indisponível, não zero
  percentage: number | null;        // null quando denominador = 0
  asOf: string;                     // instante/data de referência conforme domínio
};

type SupplierRequirement = {
  id: string;
  supplierId: string;
  name: string;
  note?: string;
  applicabilityCode: string;
  applicabilityLabel: string;
  statusCode: string;
  statusLabel: string;
  canEdit: boolean;
  canDelete: boolean;
};

type SupplierRequirementPage = {
  items: SupplierRequirement[];
  totalCount: number;       // sem busca, para Requisitos (N)
  matchingCount: number;    // com busca, para total da visualização
  nextCursor?: string;
};

type SupplierRequestPage = {
  items: Array<{
    id: string;
    title: string;
    statusLabel: string;
    relevantDate?: string;
    detailAvailable: boolean;
  }>;
  matchingCount: number;
  nextCursor?: string;
};
```

O servidor deriva a organização da sessão e confirma o vínculo `supplierId` em cada operação. `ComplianceSummary` deve ser projetada sobre o **conjunto completo**, não sobre `SupplierRequirementPage.items`. A expiração em breve segue a janela temporal oficial. Caches usam chaves que incluem organização, cadastro, permissão, aba, busca e cursor. Mutação invalida as projeções dependentes. Campo/permissão ausente na API exige adaptação explícita antes do aceite; não fabricar `0`, `true`, status ou nome.

## 13. Critérios de aceite

1. Abrir um fornecedor/cliente pelo ID correto mostra nome e tipo reais; Voltar funciona inclusive no acesso direto. Outro tenant, ID inexistente e 403 não expõem dados. A sidebar destaca Fornecedores.
2. Sem requisito aplicável, conformidade é `—` e não 0%/100%; apenas requisitos não aplicáveis também produzem `—`. Com requisitos aplicáveis, valores, barra e três contadores correspondem à projeção autorizada do serviço e às regras oficiais. Busca não altera a taxa.
3. Requisitos e Solicitações são abas operáveis por teclado, consultam conjuntos separados e têm estados vazio, carregando e erro próprios. Busca encontra nome em todo o conjunto deste fornecedor, não só na página atual. Nomes duplicados mantêm IDs distintos.
4. Novo requisito predefine este fornecedor por ID sem solicitar cópia manual. Criar/editar/excluir respeita permissões, regras do domínio, confirmações e backend; após sucesso revalida lista e conformidade. Não há alterações permanentes no clique de uma demonstração HTML.
5. Editar fornecedor atualiza cabeçalho após confirmação real. Exportar dossiê gera e disponibiliza arquivo real com escopo e permissão conferidos, ou mostra indisponibilidade verdadeira se o serviço não estiver pronto; nunca toast falso de exportação concluída. Excluir explica efeitos reais, valida vínculos e redireciona apenas após sucesso.
6. Conferir layout em 1440×900, 1280×800, 900×900, 390×844 e 320×700, além de zoom 200%; nome longo, várias ações, 0 e muitas linhas sem overflow horizontal. Foco, rótulos, estados e anúncios seguem §11.

## 14. Entrega de engenharia

- Reusar shell/tokens e fluxos aprovados; implementar leitura autorizada, projeção de conformidade, abas independentes, busca/paginação, criação vinculada, edição, exportação e exclusão com estados reais.
- Verificar integração com cadastro arquivado, usuário sem permissão, requisito inaplicável, indicador de vencimento próximo, recurso excluído em outra sessão, conflito de edição e troca de organização. Rodar checks pertinentes do repositório e revisão visual nas larguras indicadas; manter exemplos do HTML fora de produção.
