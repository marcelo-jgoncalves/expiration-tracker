# OmniVence — Membros: especificação de implementação

**Status:** especificação para implementar a tela aprovada. **Referência visual:** `OmniVence-membros-prototipo.html`, com a correção geométrica obrigatória indicada no §4. **Referências de consistência:** shell, tokens e padrões de confirmação das telas OmniVence já aprovadas. **Idioma:** português do Brasil. **Escopo:** membros ativos, convite por e-mail, papéis, convites pendentes, remoção e cancelamento de convite. Dados e ações do HTML são ilustrativos.

## 1. Decisões e limites

1. Reproduzir o visual do protótipo, mantendo a barra lateral compartilhada, a área de convite à esquerda e membros/convites à direita no desktop.
2. **Correção obrigatória em relação ao protótipo:** a borda inferior do card `Convites pendentes` deve terminar exatamente na mesma linha horizontal da borda inferior do card `Convidar novo membro` no desktop. Ajustar a altura/alongamento das duas colunas, sem adicionar espaço vazio externo ou deslocar títulos. Essa correção deve permanecer correta com zero, um ou vários convites enquanto a composição estiver em duas colunas. Em telas empilhadas, as alturas seguem o conteúdo e a exigência de alinhamento horizontal deixa de se aplicar.
3. Substituir qualquer identificador interno mostrado como papel por nome legível: `Proprietário`, `Administrador` ou `Membro`, conforme os papéis reais. IDs de usuário e códigos de papel não são rótulos de interface.
4. O e-mail, contadores e papel do protótipo são exemplos. Buscar os dados da organização ativa; não criar membro fictício ou marcar convite como enviado antes da confirmação do serviço.
5. Convite pendente **não** equivale a membro com acesso. Só a aceitação concluída e confirmada pelo serviço move a pessoa para Membros ativos. Um convite para papel Administrativo não deve conceder esse papel antes da aceitação.
6. Não acrescentar papéis, matriz de permissões, convites em massa, transferência de propriedade, SSO ou notificações configuráveis nesta tela. Se o domínio exigir transferência do papel Proprietário, encaminhar ao fluxo próprio; não permitir pela seleção simples da linha.
7. As opções `Membro` e `Administrador` do protótipo são apresentação proposta, sujeita ao catálogo real de papéis e à permissão de quem convida. Não permitir conceder um papel que o servidor não autoriza.

## 2. Rota, contexto e navegação

- Usar a rota real de **Membros** já presente no aplicativo; marcar o item lateral `aria-current="page"`. Logo, identidade e Sair usam o shell aprovado.
- Consultas e ações aplicam-se somente à organização ativa derivada da sessão. Mudar de organização invalida membros, convites, papéis e permissões armazenados no cliente antes de renderizar novos dados.
- Ao perder sessão, seguir o fluxo seguro de login. Se a pessoa perder sua própria associação à organização em outra sessão, mostrar falta de acesso e redirecionar ao seletor de organizações ou destino existente; não exibir a lista em cache como se ainda tivesse autorização.
- A página não é um diretório global de usuários. Busca de pessoas fora da organização ocorre somente no fluxo de convite com o e-mail informado, sem expor se uma conta existe na plataforma quando o serviço não permitir essa divulgação.

## 3. Conteúdo e microcópia

| Área | Texto/regra |
|---|---|
| `<title>` | `Membros · OmniVence` |
| Selo superior | `EQUIPE E ACESSOS` |
| H1 | `Membros` |
| Apoio | `Pessoas com acesso à sua organização e convites aguardando resposta.` |
| Painel roxo, selo | `SEU ESPAÇO DE TRABALHO` |
| Painel roxo, título | `Acesso claro para cada pessoa da equipe.` |
| Painel roxo, apoio | `Convide membros, acompanhe pendências e revise permissões em um só lugar.` |
| Número do painel | quantidade real de membros ativos + singular/plural adequado |
| Card esquerdo | `Convidar novo membro`; apoio `Envie um convite para alguém colaborar nesta organização.` |
| Campo 1 | `E-mail (obrigatório)`; placeholder `nome@empresa.com.br` |
| Campo 2 | `Papel (obrigatório)`; ajuda `O papel define o que a pessoa poderá fazer na organização.` |
| Envio | `Enviar convite`; durante requisição `Enviando…` |
| Lista 1 | `Membros ativos` + total; apoio `Gerencie o acesso de quem já faz parte da organização.` |
| Lista 2 | `Convites pendentes` + total; apoio `Acompanhe os convites que ainda não foram aceitos.` |
| Sem convites | `Nenhum convite pendente`; apoio `Os próximos convites aparecerão aqui até serem aceitos.` |
| Estado de proprietário | `Proprietário`; abaixo do próprio e-mail `Você · acesso atual` quando aplicável |
| Convite pendente | Situação `Pendente`, ação `Cancelar convite` |
| Membro ativo | Situação `Ativo`, ação `Remover` quando autorizada |

Não mostrar “Papel de user_...” nem “(opcional)” no cabeçalho do papel da linha. Não mostrar mensagens “Protótipo visual” em produção. O nome acessível de cada ação inclui e-mail ou nome distintivo do alvo.

## 4. Layout e alinhamento obrigatório

### Desktop, acima de 1150 px

- Reutilizar sidebar de 256 px e conteúdo sobre `#F8F7FC`, padding superior 37 px, lateral `clamp(24px,3.4vw,62px)`, largura máxima 1600 px.
- Cabeçalho com selo 11 px/800, H1 `clamp(27px,2.5vw,37px)`/700 e apoio 13 px. Painel roxo abaixo com altura mínima 133 px, raio 16 px, padding 23 × 27 px; ícone em caixa translúcida 46 px, mensagem central e total à direita. Decoração circular discreta em CSS.
- Região inferior em grid de duas colunas `minmax(265px,.78fr) minmax(0,1.5fr)` com 20 px de intervalo. Coluna esquerda contém o card de convite. Coluna direita contém seções Membros ativos e Convites pendentes, com 28 px entre elas.
- **Alinhamento de base, critério visual obrigatório:** o grid deve alongar o card esquerdo até a base do card inferior direito, ou estruturar ambas as colunas de modo equivalente. A linha inferior externa dos dois cards deve ter diferença visual máxima de 1 px no desktop. O cabeçalho de “Convites pendentes” continua acima do seu card; a área vazia, quando houver, fica **dentro** dos cards, sem separadores artificiais fora deles. Se a lista direita ficar mais alta por conter muitos registros, o card esquerdo acompanha a altura da coluna enquanto mantida essa grade; a página pode rolar normalmente. Não fixar altura em pixels que quebre com texto longo ou zoom.
- Card de convite branco, borda `#E8E4F1`, raio 15 px, padding 25 px; ícone lilás 35 px, título 16 px e descrição 11 px. Campos de 47 px, borda `#D7D2E3`, raio 9 px; labels 11 px/800; botão de 43 px.
- Listas brancas, mesma borda e raio. Linha de membro em grade `44px minmax(0,1fr) minmax(130px,.55fr) auto`, padding 19 px, separador sutil; avatar 39 px, e-mail 12 px, contexto 10 px, papel e situação legíveis. Convite pendente usa avatar lilás e situação âmbar.
- Contadores das seções em cápsulas lilases pequenas. Botões secundários de 36 px de altura visual com alvos de pelo menos 44 × 44 px. Remover tem cor semântica vermelha, sem tornar todo o card alarmista.

### Até 1150 px

- Grade vira coluna única na ordem: Convidar → Membros ativos → Convites pendentes. Cada card usa altura natural; não forçar alinhamento de base entre cards empilhados. A correção do desktop não pode criar vazio excessivo no tablet.

### Até 900 px

- Sidebar vira drawer do shell compartilhado, com botão de menu, overlay, Esc, contenção e devolução de foco.

### Até 650 px

- Painel roxo compacto e sem total lateral redundante; total ainda visível no título Membros ativos. Card de convite com padding 21 × 18 px.
- Linhas de membro passam a duas colunas: avatar à esquerda, e-mail/contexto à direita; papel e ações abaixo. E-mails longos quebram sem ultrapassar o card. Ações mantêm rótulos legíveis e se reorganizam com zoom até 200% e viewport de 320 CSS px. Sem rolagem horizontal.

### Tokens

Plus Jakarta Sans hospedada localmente, pesos 400–800; `#4C1D95` roxo profundo, `#7C3AED` ação, `#A78BFA` foco, `#14121F` texto, `#55507A` apoio, `#F8F7FC` fundo, `#FFFFFF` superfícies, `#E8E4F1` bordas. Situação ativa em verde `#047857`; pendente em âmbar escuro; remoção em vermelho `#B91C1C`. Contraste AA, foco perceptível e `prefers-reduced-motion`.

## 5. Dados, papéis e permissões

- Fonte de verdade: serviço de membros/convites da organização ativa. Buscar membros ativos e convites pendentes como conjuntos separados, com seus próprios totais; não derivar contagem de uma página parcial.
- Identidade de membro por ID interno canônico; e-mail é apresentação, não chave de mutação. Identidade de convite por ID de convite. E-mail normalizado no serviço para evitar convites duplicados, mantendo o formato digitado de modo apropriado na UI.
- Papéis exibidos por rótulo localizado a partir de códigos do domínio. `Proprietário` é papel especial; não oferecê-lo na lista comum de convite/alteração se há transferência de titularidade própria. Não permitir que Administrador atribua papel acima de suas permissões.
- O usuário atual no protótipo aparece como Proprietário e não pode clicar Remover. Em produção, desabilitar/ocultar ações de auto remoção segundo regra do domínio, com explicação acessível. O último proprietário/administrador não pode ser removido/rebaixado de modo que deixe a organização sem responsável, salvo fluxo de transferência explicitamente implementado.
- Permissões separadas para listar, convidar, escolher papéis, alterar papel, remover e cancelar convite. O servidor valida a organização e a hierarquia em cada operação, inclusive quando a UI esconde controle.
- Se houver muitos membros/convites, paginar pelo serviço, respeitando ordem estável: membros por nome/e-mail exibido `pt-BR` com ID como desempate; convites por data de criação mais recente quando o serviço expõe data. Não carregar todos no browser silenciosamente.

## 6. Enviar convite

1. Validar e-mail obrigatório com `type=email` e validação adequada, removendo espaços externos. Papel obrigatório e limitado às opções autorizadas retornadas pelo domínio. Não usar códigos/rótulos inventados como fonte de verdade.
2. Ao enviar, desabilitar botão contra envio duplo e mostrar `Enviando…`. O serviço cria convite para a organização atual, com validade, identidade do emissor e papel; o e-mail de convite é enviado pelo mecanismo real. Se o envio for assíncrono, distinguir `convite criado/entrega pendente` de e-mail efetivamente entregue; não afirmar “e-mail enviado” sem confirmação.
3. Sucesso confirmado: limpar e-mail, manter papel padrão válido, atualizar lista/total de pendentes e anunciar `Convite criado para {e-mail}.` ou estado de entrega real. Não acrescentar membro ativo até aceite.
4. Se pessoa já for membro: `Esta pessoa já tem acesso à organização.` Se houver convite pendente: `Já existe um convite pendente para este e-mail.` Não expor associação a outras organizações. Erros de limite, permissão, rede e serviço são distintos; preservar campos em falha.
5. O papel selecionado é exibido no convite pendente. Aceite futuro deve usar a regra do domínio para confirmar esse papel e registrar auditoria; a tela revalida ao retornar/atualizar.

## 7. Alterar papel

- Seleção de papel de linha só aparece quando a pessoa autenticada pode editar aquele alvo e para papéis permitidos. O papel atual é selecionado; mudar a seleção abre diálogo `Alterar papel?` com alvo, papel atual, novo papel e consequência resumida. Cancelar restaura a seleção original; confirmar envia o ID do membro e código do papel.
- Durante envio, bloquear duplicidade. Só mostrar papel novo após confirmação real. Em falha, manter papel anterior e explicar erro. Se estado foi alterado por outro administrador, recarregar e pedir revisão; não sobrescrever cegamente.
- Mudança para/de Proprietário exige fluxo especializado de transferência, autenticação adicional ou confirmação específica se o domínio assim exigir. A seleção simples do protótipo não implementa transferência de propriedade.
- Revalidar a própria sessão/permissões se o papel do usuário atual mudar em outro contexto.

## 8. Remover membro e cancelar convite

### Remover membro

- Disponível só para alvos que o papel atual pode remover; proprietário atual/último responsável não aparece como removível nesta tela. Diálogo `Remover membro?`, texto `“{e-mail}” perderá acesso a esta organização. Os dados da organização permanecerão nela.`, botões `Cancelar` (foco inicial) e `Remover membro` em vermelho.
- Após confirmação, chamar serviço uma vez. Só remover linha/atualizar contador após resposta de sucesso. Verificar no backend efeitos sobre atribuições, responsável por pendências e histórico; não apagar automaticamente dados criados pelo membro. Se houver bloqueio por regra, mostrar motivo e caminho apropriado.

### Cancelar convite

- Diálogo `Cancelar convite?`, texto `O convite para “{e-mail}” deixará de poder ser aceito.`, botões Cancelar e Cancelar convite. Chamar serviço usando ID do convite; após sucesso remover pendente/atualizar contador. Se convite já foi aceito ou expirou, revalidar lista e informar que seu estado mudou.
- A eventual ação Reenviar convite não faz parte deste protótipo nem desta entrega.

### Confirmações

- Diálogos acessíveis com título e descrição associados, foco contido, Esc/click fora equivalentes a Cancelar antes de enviar, foco inicial em Cancelar e retorno ao acionador após cancelamento. Se a linha sair da lista após sucesso, mover foco ao título da seção ou linha vizinha; não focar elemento removido.
- Durante operação pendente, bloquear ação repetida e não apresentar sucesso otimista. Registrar ações sensíveis no servidor sem expor tokens de convite em URL pública/analytics.

## 9. Estados e erros

| Estado | Resultado |
|---|---|
| Carregamento | Shell/cabeçalhos visíveis e placeholders; sem e-mails fictícios ou totais fixos. |
| Sem membros além do proprietário | Mostrar o proprietário e formulário de convite quando autorizado; total coerente. |
| Sem convites | Estado `Nenhum convite pendente` e apoio aprovado. |
| Convites carregando/falhando independentemente | Não apagar membros já carregados; mostrar erro local e Tentar novamente. |
| Convite enviado/aceito/expirado em outra sessão | Revalidar estado e contadores sem duplicar pessoa ou convite. |
| E-mail inválido | `Informe um e-mail válido.` no campo, foco no e-mail. |
| Erro de permissão | Estado próprio; não converter para lista vazia. |
| Erro de rede | `Não foi possível conectar. Verifique sua conexão e tente novamente.`; preservar entrada e estado anterior. |
| Serviço indisponível | Mensagem específica e nova tentativa, sem alteração otimista. |
| Sessão expirada | Retorno ao login conforme fluxo autenticado. |

## 10. Acessibilidade e semântica

- Uma região `<main>`, H1 Membros, H2 para Convidar novo membro, Membros ativos e Convites pendentes; `<form>` apenas no convite. Lists ou tabela com relação clara entre pessoa, papel, status e ações.
- Labels para E-mail e Papel; `required`, `aria-invalid` e erros associados por `aria-describedby`. `autocomplete=email`. Alvos de toque ≥44 × 44 px.
- Seleção de papel tem nome acessível `Papel de {pessoa}` sem IDs internos. Remover tem nome `Remover {pessoa}`; Cancelar convite tem nome `Cancelar convite para {pessoa}`. Proprietário não apresenta botão ativo que falha ao clicar.
- Totais e confirmações em `aria-live=polite`; erros em `role=alert`. Distinção entre Ativo/Pendente por texto e não apenas cor. E-mails completos na árvore acessível, mesmo quando quebrados visualmente.
- Drawer móvel e diálogos seguem gerenciamento de foco aprovado. Zoom de 200% e largura de 320 CSS px sem perda de controles, informação ou alinhamento indevido.

## 11. Contrato semântico de integração

Mapear à API e aos status reais, sem presumir nomes físicos de endpoints:

```ts
type Member = {
  id: string;
  email: string;
  displayName?: string;
  roleCode: string;
  isCurrentUser: boolean;
  status: 'active';
  availableActions: Array<'changeRole' | 'remove'>;
};
type PendingInvitation = {
  id: string;
  email: string;
  roleCode: string;
  status: 'pending';
  createdAt?: string;
  availableActions: Array<'cancel'>;
};
type MembershipPage = {
  members: Member[];
  invitations: PendingInvitation[];
  activeCount: number;
  pendingCount: number;
  allowedInviteRoles: Array<{ code: string; label: string }>;
  canInvite: boolean;
};
```

A organização vem do contexto autenticado, não de parâmetro de confiança. O serviço verifica permissão no envio, troca de papel, remoção e cancelamento. Revalidar listas/contadores após operações e ao retornar à aba. Separar cache por organização/identidade. Se a infraestrutura envia convites de modo assíncrono, expor status de entrega adequado; não confundir registro de convite com e-mail efetivamente entregue.

## 12. Critérios de aceite

1. Revisão visual em 1440×900 e 1280×800 mostra a **borda inferior do card Convites pendentes alinhada à borda inferior do card Convidar novo membro**, diferença máxima 1 px. Conferir também com zero e múltiplos convites, nomes longos e zoom. Em 900×900, 390×844 e 320×700, cards empilhados naturalmente e sem overflow horizontal.
2. Papel de Proprietário aparece legível; IDs internos jamais aparecem como rótulo. Contadores reais refletem membros ativos e convites pendentes separadamente.
3. Convite válido é criado pelo serviço real e aparece pendente, sem virar membro ativo antes de aceite. Duplicatas, falhas, limites e permissões são tratados sem falsa confirmação de envio.
4. Alterar papel, remover e cancelar convite requerem permissão/confirmam consequências; nenhuma linha muda como sucesso antes da confirmação do servidor. Proteção do proprietário/último responsável é aplicada no servidor.
5. Listas e ações estão no escopo da organização ativa. Mudança de organização não vaza dados anteriores. Estados vazio, carregando, erro e sessão expirada são distintos.
6. Teclado/leitor de tela alcançam formulário, papéis, ações e diálogos com nomes completos; foco é gerido corretamente e o layout permanece utilizável em mobile/zoom.
7. Testes relevantes cobrem envio único, duplicatas, aceite/expiração concorrente, hierarquia de papéis, auto remoção/último responsável, escopo de organização e alinhamento visual obrigatório.

## 13. Definição de pronto

A tela está pronta quando reproduz o protótipo **com a correção de alinhamento solicitada**, carrega pessoas e convites reais, respeita permissões/papéis do domínio e conclui as operações apenas após confirmação do serviço. O protótipo original permanece como referência visual; esta especificação define sua correção de layout para a implementação.
