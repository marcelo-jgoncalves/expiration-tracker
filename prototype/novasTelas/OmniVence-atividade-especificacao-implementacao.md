# OmniVence — Atividade: especificação de implementação

**Status:** especificação para implementar a tela de Atividade. **Referência visual:** `OmniVence-atividade-prototipo.html`, com as correções explícitas deste documento. **Idioma:** português do Brasil. **Escopo:** consulta paginada dos eventos da organização ativa, identificação de quem executou cada ação, filtros e atualização. Os 25 eventos e pessoas do HTML são dados ilustrativos.

## 1. Prioridade e decisões obrigatórias

1. Usar o visual, a hierarquia e o shell compartilhado do protótipo. Para o filtro temporal, **esta especificação prevalece sobre o HTML**: o seletor `Período` em formato de lista introduzido no protótipo deve ser substituído por um **campo Mês com seletor de calendário/mês e ano**, como na tela original. Não apresentar uma lista estática de meses.
2. O texto inicial visível no campo, antes de escolher qualquer mês, será **`Todos os meses`**. A seleção vazia significa ausência de filtro temporal e consulta todo o histórico acessível, nunca “mês atual”. Depois da escolha, mostrar **`setembro de 2026`** no padrão mês por extenso + ano em português do Brasil; o valor enviado ao serviço é `YYYY-MM`. Ao limpar, restaurar `Todos os meses`.
3. Não usar a sequência visual nativa de preenchimento `---------- de ----`, `mm/aaaa` ou uma data de dia específico como instrução inicial. Se o navegador não permitir personalizar o texto vazio de `input[type="month"]`, usar uma camada visual acessível sobre o campo vazio, que desaparece no foco/na escolha sem cobrir o controle, ou um acionador acessível integrado a um seletor real de mês/ano. **Preservar abertura do calendário, teclado e seleção de ano**. Não simular a seleção apenas com uma lista fixa.
4. Os **quatro controles** de filtro têm as caixas de entrada na mesma linha horizontal no desktop: mesma altura de 41 px, bordas superiores alinhadas dentro de tolerância de 1 px, espaçamento de 14 px. Reservar a mesma altura para os rótulos, inclusive quando `Pessoa, e-mail ou ID do usuário` quebrar em duas linhas. O alinhamento não depende do conteúdo dos campos ou de fonte carregada tardiamente.
5. Mostrar em cada evento **nome, e-mail e ID canônico do usuário ator**. Não trocar nome/e-mail pelo ID nem esconder o ID em tooltip ou detalhe. Tratar separadamente atores de sistema, integração e usuários sem dados de perfil; ver §5. Eventos históricos não são apagados quando um usuário deixa a organização.
6. O HTML demonstra interações com dados em memória. Em produção, consultas, filtros, total, paginação e atualização usam o serviço real com autorização do servidor. Não inserir pessoas, ações ou contagens de demonstração.

## 2. Rota, acesso e contexto

- Usar a rota real de **Atividade** da aplicação, dentro do shell autenticado. Item lateral Atividade ativo com `aria-current="page"`; demais links, logo, identidade e Sair usam os fluxos já aprovados. Não usar fragmentos `#` do protótipo como rotas.
- Esta tela é consultável somente por Proprietário/Administrador ou outros papéis que tenham permissão explícita de auditoria segundo o modelo real. Ocultar o item lateral para quem não pode consultar e validar a autorização **em toda requisição no servidor**. Responder sem dados para acesso indevido, sem tratar 403 como lista vazia.
- Consultar somente eventos da **organização ativa derivada da sessão/autorização**, inclusive ao aplicar ID de recurso arbitrário. Troca de organização ou perda de associação invalida cache, consultas em voo e paginação da organização anterior. Nunca confiar apenas em `organizationId` fornecido pelo navegador.
- Dados de identidade pessoal ficam visíveis apenas a administradores autorizados. Não enviar e-mails/IDs da lista a analytics de front-end, URLs compartilháveis ou telemetria de terceiros. Se estado de filtros for persistido na URL, excluir o filtro de pessoa e IDs ou usar estado de navegação protegido.

## 3. Conteúdo e microcópia

| Elemento | Texto e regra |
|---|---|
| `<title>` | `Atividade · OmniVence` |
| Selo superior | `RASTREABILIDADE DA ORGANIZAÇÃO` |
| H1 | `Atividade` |
| Apoio | `Saiba quem realizou cada ação, em qual recurso e quando aconteceu.` |
| Painel roxo, selo | `HISTÓRICO DE AÇÕES` |
| Painel roxo, título | `Clareza em cada mudança.` |
| Painel roxo, apoio | `Consulte os registros da organização com identificação completa de quem executou cada ação.` |
| Número do painel | total de eventos que correspondem aos filtros aplicados + `evento encontrado` / `eventos encontrados` |
| Filtros, título | `Encontre um evento` |
| Filtros, apoio | `Combine os filtros para localizar uma alteração específica.` |
| Campo 1 | Rótulo `Mês`; texto inicial **`Todos os meses`**; após seleção, mês por extenso e ano em `pt-BR`; seletor real de mês/ano |
| Campo 2 | `Pessoa, e-mail ou ID do usuário`; exemplo `Ex.: nome, e-mail ou user_01…` |
| Campo 3 | `Tipo de recurso`; primeira opção `Todos os recursos`; demais opções derivadas dos tipos reais auditáveis, com nomes localizados |
| Campo 4 | `ID do recurso`; exemplo `Ex.: item_01…` |
| Ações de filtro | `Aplicar filtros`; `Limpar filtros` |
| Lista | `Eventos (N)` e apoio `Do mais recente para o mais antigo.`; colunas `Quem executou`, `Ação`, `Recurso`, `Quando` |
| Atualização | `Atualizar`; enquanto carrega `Atualizando…` |
| Paginação | `Exibindo X–Y de N eventos`, `Anterior`, `Página P de Q`, `Próxima` |
| Sem resultado por filtro | `Nenhum evento encontrado`; apoio `Revise os filtros e tente novamente.` |

Não apresentar `CREATE`, `ExpirationItem` ou códigos de implementação como texto primário. Mapear os códigos reais a verbos e tipos compreensíveis, preservando os códigos no modelo para consulta e suporte quando necessários. Nomes de pessoas e recursos dos exemplos não são conteúdo padrão de produção.

## 4. Composição visual e responsividade

### Desktop

- Shell: sidebar branca fixa de 256 px, divisor `#E8E4F1`; fundo `#F8F7FC`; conteúdo com padding superior 37 px, lateral `clamp(24px,3.4vw,62px)`, inferior 65 px e largura máxima 1600 px. Tipografia Plus Jakarta Sans 400–800 hospedada localmente.
- Cabeçalho com selo 11 px/800 e espaçamento entre letras, H1 `clamp(27px,2.5vw,37px)` e apoio 13 px. Painel roxo `#4C1D95`, raio 17 px, padding 26 × 31 px, decoração circular discreta; título 21 px e total à direita com separador.
- `Encontre um evento`: título 16 px, apoio 11 px; card branco com borda `#E8E4F1`, raio 15 px e padding 21 × 23 px. Grade de filtros em quatro colunas `minmax(150px,.75fr) minmax(210px,1.25fr) minmax(165px,.85fr) minmax(180px,1fr)`, gap 14 px. Cada campo usa um bloco vertical com **faixa uniforme de 30 px para rótulo**, intervalo 8 px e controle de 41 px. O controle de Mês deve ocupar a mesma área e ter ícone de calendário alinhado à direita com texto legível à esquerda; não deslocar o controle para acomodar instruções debaixo do rótulo. As quatro bordas superiores e inferiores dos controles devem coincidir com diferença ≤1 px.
- Botões abaixo dos filtros, a 17 px, com altura mínima de 39 px, ação principal roxo profundo e secundária branca com borda. Alvos interativos efetivos ≥44 × 44 px sem descaracterizar a aparência. Não elevar só o campo de nome quando o rótulo quebra.
- Lista em card branco com borda e raio 15 px; cabeçalho `#FBFAFE` com colunas `minmax(205px,1.45fr) minmax(170px,1.2fr) minmax(170px,1.1fr) minmax(130px,.8fr)` e gap 16 px. Linha min-height 105 px, padding 17 × 21 px e divisor `#EEEAF4`. Grupo do ator com avatar 37 px, nome 11 px/800, e-mail 10 px, ID 9 px em terceira linha. Nome da ação 11 px/800, explicação 10 px; recurso com título 11 px e tipo/ID subordinados. Data 11 px e hora 10 px. IDs longos quebram dentro da célula; nenhuma coluna estoura o card.
- Paleta: marca `#4C1D95`, ação `#7C3AED` se usada como destaque, foco `#A78BFA`, texto `#14121F`, apoio `#55507A`, superfície `#FFFFFF`. Contraste AA e `prefers-reduced-motion`.

### Faixas menores

- Até 1250 px, filtros viram grade de duas colunas mantendo rótulos com altura uniforme **por linha**; controles alinhados dentro de cada linha. Lista pode reduzir gaps sem ocultar nome, e-mail, ID ou data.
- Até 900 px, sidebar vira drawer do shell compartilhado; lista vira entradas em duas colunas, com cada informação identificada por rótulo sem depender do cabeçalho desktop.
- Até 650 px, filtros em uma coluna e rótulos/controles seguem fluxo natural. Cada evento vira card de uma coluna na ordem ator → ação → recurso → data/hora. Total redundante lateral do painel pode ser omitido visualmente, mas permanece no título Eventos e acessível. Em 320 CSS px e zoom 200%, sem rolagem horizontal nem truncamento de identidade ou ID.

## 5. Modelo de evento e identidade do ator

- Cada evento tem ID estável, instante de ocorrência, código de ação, tipo e ID de recurso, escopo de organização e **ator**. A API deve disponibilizar `actorUserId` canônico e, para ações humanas, nome e e-mail de apresentação autorizados. Resolver ator por ID no servidor ou por uma projeção segura de auditoria; evitar N+1 na paginação.
- **Nome + e-mail + ID aparecem simultaneamente na linha**. Avatar de iniciais é decorativo e derivado do nome; nunca substitui os três campos. O ID é copiado integralmente na árvore acessível e pode quebrar visualmente. E-mails e IDs iguais em nomes distintos continuam identificando pessoas pelo ID canônico, não por comparação de strings exibidas.
- Para conta excluída ou perfil inacessível, manter `ID: {actorUserId}` e mostrar `Usuário não disponível` no lugar do nome e `E-mail indisponível` no lugar do e-mail. Não preencher com dados inventados. Para automação autenticada sem usuário humano, mostrar `Sistema` ou o nome real da integração, `Sem e-mail de usuário` e o identificador canônico do principal da automação; distinguir pelo `actorKind` retornado pelo serviço. Se um evento legado realmente não tiver identificador, indicar `ID indisponível` sem fabricar `user_...`.
- Identidade atual do usuário pode ter mudado desde o evento. A estratégia de auditoria precisa ser consistente: preferir snapshot de nome/e-mail associado ao evento quando disponível e autorizado; se a API retornar perfil atual, rotular a apresentação conforme essa semântica e preservar sempre o ID. **Não alegar que o nome atual era o nome na data histórica**. Casos de exclusão/anonimização seguem as regras reais de retenção e privacidade do serviço.
- Ação é lida como verbo no passado e objeto coerente: `Criou vencimento`, `Atualizou fornecedor`, `Renovou vencimento`, `Arquivou fornecedor`, `Alterou acesso de membro`. A frase de apoio explica o ocorrido com dados disponíveis, sem inferir motivo, autor ou conteúdo que o evento não registra. Os códigos brutos continuam disponíveis para mapeamento, sem exposição primária.
- Recurso: título da entidade se disponível, tipo localizado e ID canônico. Se excluído, mostrar `Recurso não disponível`, tipo e ID. Não transformar `ID do recurso` em link de detalhe sem rota/permissão reais. Se houver link, validar permissão e tratar recurso excluído com estado apropriado.
- Data e hora: converter `occurredAt` com offset para o fuso configurado da organização; fallback `America/Sao_Paulo` se esse for o padrão global vigente. Exibir `dd/MM/yyyy` e `às HH:mm:ss`; ordenar pelo instante real, não pelo texto formatado. Empate por ID do evento em ordem estável. Não usar data de criação do recurso como momento do evento.

## 6. Filtros, calendário e consulta

1. Ao entrar, mostrar o histórico autorizado de todos os meses, do mais recente para o mais antigo. Valores digitados são **rascunho** até `Aplicar filtros`. Recarregar preserva os filtros já aplicados; editar um campo sem aplicar não altera lista nem contagem. `Limpar filtros` esvazia todos os campos, remove filtros aplicados, redefine página e consulta novamente todo o histórico.
2. **Mês:** rótulo `Mês`, texto inicial visível `Todos os meses` e ícone de calendário. Clique no campo ou no ícone abre um seletor verdadeiro de **mês e ano**, sem exigir dia. Entrada por teclado e tecnologia assistiva deve conseguir escolher mês/ano; se `input[type="month"]` não disponibilizar uma experiência adequada no ambiente suportado, usar componente acessível de mês/ano com navegação por teclado e anos navegáveis, mantendo o mesmo visual. Aplicar envia `YYYY-MM`, com início inclusivo no primeiro instante do mês e fim exclusivo no primeiro instante do mês seguinte no fuso da organização; converter o intervalo para instantes de consulta no servidor. O campo vazio continua significando todos os meses.
3. **Pessoa, e-mail ou ID do usuário:** busca literal por nome, e-mail e ID nos eventos autorizados, com trim. Normalização de caixa e acentos para nome/e-mail segundo suporte do serviço; ID não deve ser confundido com o ID do recurso. Respeitar privacidade e evitar consulta global de usuários. Não limitar o filtro à página carregada.
4. **Tipo de recurso:** valores vêm do catálogo efetivamente auditado, com códigos estáveis e rótulos localizados. A opção inicial consulta todos. Se houver tipo ainda sem rótulo aprovado, exibir nome genérico legível e preservar o código internamente; não remover eventos desse tipo da consulta.
5. **ID do recurso:** comparação exata para ID completo canônico, ou busca por prefixo apenas se a API permitir explicitamente; escolher e documentar o comportamento real no adaptador, mantendo previsibilidade. O protótipo aceita parcial, portanto a implementação deve preferir prefixo quando o serviço suportar sem expor eventos de outros tenants. Trim; validar tamanho e caracteres aceitos pelo domínio; erro de filtro é anunciado no campo, não retorna lista vazia enganosa.
6. Filtros se combinam por **E**: evento corresponde a todas as condições preenchidas. Aplicar filtro ou limpar reinicia para a primeira página. Requisições antigas são canceladas/ignoradas; nunca mostrar resultado de um conjunto de filtros com os rótulos de outro. Estado aplicado permanece durante Atualizar e paginação. Não usar filtragem somente sobre os sete registros visíveis.
7. Se todos os filtros estiverem vazios, os contadores exibem total autorizado da organização. Com filtros, painel e `Eventos (N)` mostram o mesmo **total de correspondências**, não o tamanho da página. `Atualizar` refaz a consulta com filtros/página ativos; caso a página deixe de existir, navegar para a última página válida ou primeira se vazia, anunciando a mudança.

## 7. Paginação e atualização

- Ordenação: `occurredAt` decrescente e ID do evento como desempate, estável sob paginação. Tamanho inicial de 7 por página conforme protótipo; o servidor pode devolver `pageSize` efetivo quando houver padrão global, mas front-end e rodapé devem concordar. Preferir cursor para histórico crescente; caso a API use página/offset, garantir ordem estável e lidar com inserções novas sem duplicar/omitir silenciosamente os eventos percorridos.
- `Exibindo X–Y de N eventos` só aparece quando o total é conhecido. Se o serviço não fornece total exato, ajustar a interface de contagem para não inventar `N`/`Q`; esta capacidade é requisito para reproduzir o protótipo integralmente. Desabilitar Anterior na primeira e Próxima na última página; paginar mantendo os filtros. Ao mudar de página, levar o foco de volta ao título Eventos ou ao primeiro evento, de forma previsível.
- `Atualizar` indica progresso, bloqueia repetição e preserva filtro e dados anteriores enquanto a nova consulta carrega. Ao sucesso, atualizar lista e contadores; ao erro, manter resultado anterior identificado como possivelmente desatualizado, apresentar `Não foi possível atualizar os eventos. Tente novamente.` e permitir nova tentativa. Não mostrar toast de “lista atualizada” antes da resposta.

## 8. Estados, erros e segurança

| Estado | Interface e comportamento |
|---|---|
| Carregamento inicial | Shell e títulos visíveis; placeholders estruturados, sem `25` ou eventos falsos. |
| Organização sem eventos | `Nenhuma atividade registrada ainda.`; total `0`, sem paginação. |
| Filtros sem correspondência | `Nenhum evento encontrado`; apoio aprovado, filtros preservados, opção `Limpar filtros`. |
| Aplicando filtros | Manter valores visíveis; indicador de progresso, impedir resposta obsoleta de sobrescrever a nova. |
| Erro de consulta inicial | `Não foi possível carregar a atividade. Tente novamente.` + `Tentar novamente`; não representar erro como zero eventos. |
| Erro ao paginar | Preservar a página atual; informar falha e permitir nova tentativa. |
| Erro ao atualizar | Preservar dados anteriores e filtros, mostrar aviso recuperável. |
| Sem permissão | Mensagem de acesso negado, sem metadados, totais ou identidades. |
| Sessão expirada | Seguir o fluxo de login autenticado aprovado, com destino interno seguro. |
| Ator/recurso indisponível | Usar fallbacks explícitos do §5 mantendo IDs históricos disponíveis conforme autorização. |

- Os registros de auditoria são gerados no backend por ações efetivamente concluídas. Não gerar eventos de interface para cliques que falharam como se a alteração tivesse ocorrido. Não permitir criação, edição ou exclusão de evento por esta tela. Se operações com falha forem auditadas pelo domínio, distingui-las explicitamente de sucesso por tipo/status, sem inferir sucesso no texto.
- Validar escopo, permissão e filtros no servidor, inclusive quando um usuário pede IDs arbitrários. Evitar XSS: renderizar todos os nomes, e-mails, títulos e descrições como texto, sem `innerHTML` de dados remotos. Nunca incluir token, segredo, payload de documento, número pessoal sensível ou cabeçalho de autorização na descrição do evento. Política de retenção e minimização é responsabilidade do backend e deve ser respeitada na projeção.

## 9. Semântica, acessibilidade e interação

- Um `<main>`, um H1 Atividade, H2 para `Encontre um evento` e `Eventos`; painel inicial com nome acessível. Formulário com quatro labels associados; rascunho enviado também por Enter. `Limpar filtros` é botão comum que não dispara submit. Campo de Mês anuncia pelo leitor de tela seu nome, valor `Todos os meses` enquanto vazio e instrução `Escolha mês e ano; deixe sem seleção para buscar todos os meses.` Essa instrução pode ser visualmente discreta/oculta, sem deslocar campos.
- O seletor de calendário abre por clique ou teclado, recebe foco, permite escolher ano e mês, fecha com Esc sem aplicar valor, devolve foco ao acionador e indica escolha visualmente e na árvore acessível. Se usar o seletor nativo, respeitar sua semântica sem duplicar popover ou esconder o campo atrás de camada que impeça a interação. Texto visual inicial não deve estar pintado por cima de um mês já selecionado.
- Lista implementada como `<table>` com cabeçalhos de colunas e linhas semânticas, ou uma estrutura equivalente com associações acessíveis entre ator, ação, recurso e quando. No mobile, cada dado preserva rótulo/contexto. Nome, e-mail e ID do ator permanecem na árvore acessível, sem depender de hover. IDs longos quebram sem perder caracteres; selecionar/copiar texto deve funcionar.
- Contraste AA, foco de 3 px `#A78BFA`, tamanhos de clique ≥44 × 44 px, estados desabilitados identificáveis além de cor, anúncios concisos de contagem/erros em `aria-live`/`role=alert`. Zoom 200% e 320 CSS px sem rolagem horizontal. Drawer móvel com Esc, foco contido e retorno ao menu seguindo shell aprovado.

## 10. Contrato semântico de integração

Adaptar aos endpoints e nomes reais do repositório; os tipos abaixo descrevem a **fronteira necessária à tela**, não inventam rotas físicas:

```ts
type ActivityFilter = {
  month?: string;             // YYYY-MM; ausência = todos os meses
  actorQuery?: string;        // nome, e-mail ou user ID
  resourceType?: string;      // código canônico do catálogo
  resourceId?: string;
  cursor?: string;            // ou page, conforme API real
  limit: number;              // padrão visual inicial: 7
};

type ActivityEvent = {
  id: string;
  occurredAt: string;         // timestamp com offset/UTC
  actionCode: string;
  actionLabel: string;        // verbo + objeto localizado
  actionDescription?: string; // somente dados verificáveis
  actor: {
    kind: 'user' | 'system' | 'integration' | 'unknown';
    id?: string;
    displayName?: string;
    email?: string;
    identityIsHistoricalSnapshot?: boolean;
  };
  resource: {
    typeCode: string;
    typeLabel: string;
    id?: string;
    displayName?: string;
  };
};

type ActivityPage = {
  events: ActivityEvent[];
  matchingCount: number;      // necessário para total e paginação do protótipo
  nextCursor?: string;
  previousCursor?: string;
  pageSize: number;
};
```

O cliente envia apenas filtros autorizados. O servidor aplica `organizationId` da autorização, filtro temporal no fuso correto, filtro de ator sobre as identidades indexadas permitidas, ordenação estável e total de correspondências. Nenhum campo do exemplo tem autoridade para burlar regras de retenção. Se a API não possuir nome/e-mail por ator, **é pré-requisito complementar a projeção autorizada** antes de considerar a tela pronta; não mascarar a ausência como “nome = ID”.

## 11. Critérios de aceite

1. Ao abrir, o controle rotulado **Mês** mostra `Todos os meses` dentro do campo e um ícone de calendário. Clicar/usar teclado abre seletor real de mês e ano; escolher setembro de 2026 apresenta `setembro de 2026` e consulta `2026-09`; limpar recupera todos os meses. Nenhuma máscara feia ou lista estática substitui o calendário. O protótipo atual não precisa ser atualizado para atender esta especificação.
2. Em 1440×900 e 1280×800, os quatro campos de `Encontre um evento` têm bordas superiores e inferiores alinhadas com diferença ≤1 px, inclusive quando o rótulo da pessoa quebra. Em layout de duas colunas, o alinhamento é mantido por linha; em mobile, campos empilhados sem sobreposição. Verificar fonte carregada, 200% de zoom e 320 CSS px.
3. Cada evento humano exibe **nome, e-mail e ID do usuário ao mesmo tempo**. Casos de usuário removido, integração, sistema e recurso removido seguem fallbacks explícitos. Dados dos exemplos não chegam à produção.
4. Somente usuário autorizado vê dados da organização ativa; 403 e falhas não aparecem como lista vazia. Filtro por ID arbitrário não retorna dados de outra organização. Texto externo é escapado; segredos e payloads não aparecem nos registros.
5. Mês, ator, tipo e ID do recurso combinam-se corretamente, filtrando o conjunto inteiro no servidor. Aplicar/Limpar/Atualizar/paginar respeitam rascunho versus filtro aplicado e não deixam resposta antiga substituir a atual.
6. Total do painel = total em `Eventos (N)` = total de correspondências do serviço. Rodapé e botões da paginação refletem a página real; ordenar por instante decrescente com desempate estável. Estados inicial, vazio, sem correspondência, erro, atualização e sessão expirada são distintos.
7. Navegação por teclado, leitor de tela, seleção do calendário e foco do drawer funcionam sem perda de informação. Testar datas nas bordas de mês/fuso e nomes/e-mails/IDs longos.

## 12. Entrega de engenharia

- Reutilizar shell e tokens aprovados; implementar filtro de mês com texto inicial resolvido, grade alinhada, consulta autorizada, renderização semântica, estados e paginação.
- Verificar visualmente desktop, tablet e mobile; verificar consulta no backend com usuários de organizações distintas, evento humano, conta removida, ator de sistema, filtros combinados e transição de mês. Executar os checks relevantes já existentes no repositório, sem introduzir mocks demonstrativos em produção.
