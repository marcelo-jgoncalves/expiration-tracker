# OmniVence — Configurações: especificação de implementação

**Status:** especificação da tela aprovada. **Referência visual obrigatória:** `OmniVence-configuracoes-prototipo.html`. **Referências de consistência:** shell e tokens das demais telas OmniVence. **Idioma:** português do Brasil. **Escopo:** dados da organização, horário padrão de novos lembretes, medição de armazenamento, saída de um membro e encerramento da organização.

## 1. Regras de autoridade e limites

1. Reproduzir a hierarquia e a composição do protótipo; este documento rege dados, permissões, validação e consequências reais. Os avisos “Protótipo visual”, números ilustrativos e ações locais não entram em produção.
2. “Sair da organização” e “Sair” na barra lateral têm significados distintos: o primeiro encerra **a associação da pessoa à organização**, e o segundo encerra **a sessão autenticada**. Não associar ambos ao mesmo endpoint ou ação.
3. “Encerrar organização” afeta um recurso compartilhado e seus dados. A captura antiga afirma exclusão definitiva, mas o prazo de retenção, processamento assíncrono, vínculos, exportação e restauração dependem do domínio real. **A interface final deve descrever a consequência comprovada pelo serviço, sem prometer apagamento imediato/irrecuperável antes dessa validação.**
4. O nome `Marcelo — Conta Pessoal`, o e-mail do shell, a capacidade de 8 GB, `0,3 GB`, 4%, 13:00 e as opções horárias do protótipo são exemplos de apresentação. Obter valores reais da organização ativa.
5. Esta tela configura o **horário padrão para novos lembretes da organização**. O “Horário silencioso” de Notificações é uma preferência pessoal separada. O primeiro não altera retroativamente lembretes já programados, salvo se o domínio existente explicitamente definir isso; não assumir essa propagação.
6. Não acrescentar faturamento, plano, fuso editável, usuários, exportação, integrações ou controles de exclusão adicionais nesta entrega. Se a política de encerramento exigir um fluxo de exportação/espera legal, tratá-lo no processo de encerramento real antes de expor a ação final.

## 2. Rota, shell e contexto

- Usar a rota **Configurações** já existente no roteador; item lateral marcado `aria-current="page"`. Sidebar, logo, menu móvel, identidade e logout usam o shell compartilhado da Visão geral.
- Carregar sempre a **organização ativa** vinculada à sessão; confirmar que ID, permissões, quota e valores editáveis pertencem a ela. Se houver troca de organização durante a sessão, invalidar dados anteriores antes de renderizar a nova.
- Título do documento `Configurações · OmniVence`. Rota protegida; sessão expirada segue especificação de login.
- Usuário com leitura e sem administração pode visualizar dados e uso se autorizado, mas não vê controles editáveis ou destrutivos como se pudesse executá-los. O servidor valida cada operação independentemente da UI.

## 3. Conteúdo e textos

| Local | Texto/regra |
|---|---|
| Selo acima do H1 | `ADMINISTRAÇÃO` |
| H1 | `Configurações` |
| Subtítulo | `Gerencie os dados, os lembretes e o armazenamento da sua organização.` |
| Faixa de contexto | Nome real da organização + `Organização atual` |
| Seção 1 | `Dados da organização`; apoio `Informações que identificam seu espaço de trabalho.` |
| Campo 1 | `Nome da organização (obrigatório)`; ajuda `Este nome aparece para os membros da organização.` |
| Campo 2 | `Horário padrão de novos lembretes (obrigatório)`; ajuda `Usado ao criar um lembrete, salvo quando outro horário for escolhido.` |
| Ação de edição | `Salvar alterações`; em envio `Salvando…` |
| Seção 2 | `Armazenamento`; apoio `Acompanhe o espaço usado pelos arquivos da organização.` |
| Indicador | `{uso} de {limite} utilizados` e `{percentual}% utilizado` |
| Complemento | `{restante} disponíveis` |
| Divisor | `GERENCIAMENTO DA ORGANIZAÇÃO`; H2 `Ações importantes` |
| Apoio de risco | `Confira os efeitos antes de alterar seu acesso ou encerrar a organização.` |
| Card 1 | `Sair da organização`; explicar perda de acesso da pessoa e permanência dos dados/membros; botão `Sair da organização` |
| Card 2 | `Encerrar organização`; texto preciso segundo o processo real; botão `Encerrar organização` |

Retirar `Dados ilustrativos do protótipo` e quaisquer frases de demonstração. No armazenamento, não mostrar `0 GB` por arredondamento se houver uso positivo: apresentar unidade/precisão útil, percentual coerente e valor acessível. Se a capacidade for ilimitada ou indisponível no plano, não inventar barra com 8 GB; usar apresentação adequada aos dados retornados.

## 4. Layout e estilo

### Desktop, acima de 900 px

- Sidebar 256 px fixa e branca, borda `#E8E4F1`; conteúdo sobre `#F8F7FC`, padding superior 37 px, lateral `clamp(24px,3.4vw,62px)`, largura máxima 1600 px. Título e subtítulo seguem a Visão geral.
- Faixa de contexto após cabeçalho: `#F1EBFF`, borda `#DDD6FE`, raio 12 px, padding 13 × 16 px, avatar da organização 37 × 37 px. Mostrar nome completo sem truncar informação essencial.
- Cada seção tem cabeçalho acima de card branco com borda `#E8E4F1`, raio 15 px e sombra discreta. Margem superior de seção 29 px e inferior do cabeçalho 13 px.
- Dados da organização: dois campos em colunas iguais com gap 19 px e padding interno 26 × 27 px. Labels 11 px/800, inputs/selects com 48 px de altura, raio 9 px, borda `#D7D2E3`, texto 12 px e ajuda 10 px. Rodapé do card separado por linha, texto à esquerda e botão de salvar roxo à direita com altura 42 px.
- Armazenamento: padding 25 × 27 px. Uso à esquerda, porcentagem em cápsula lilás à direita; barra de 9 px sobre trilha `#EEEAF5`; texto de restante abaixo. Barra nunca deve ter mínimo visual que distorça porcentagem acessível; para valores positivos inferiores a 1% pode haver um marcador discreto separado da escala, mas `aria-valuenow` e textos devem continuar exatos.
- Área de ações importantes com título 19 px e dois cards lado a lado, gap 17 px, padding 24 × 26 px. Ícone vermelho em caixa clara, texto 11 px/1.65 e botão de contorno vermelho. “Encerrar” pode receber borda ligeiramente mais marcada. Não usar botão preenchido de perigo na visão inicial; reservar ênfase maior para a confirmação final.

### Até 1100 px

- Campos do card e cards de ações importantes empilham em uma coluna. Manter a ordem: dados → armazenamento → sair → encerrar.

### Até 900 px

- Sidebar vira drawer compartilhado, com overlay, Esc, foco contido e retorno ao botão acionador. Conteúdo usa padding móvel do shell.

### Até 650 px

- Cards com padding lateral 18 px; rodapé de edição empilha explicação e botão Salvar em largura total. Barra de armazenamento e textos quebram sem truncar. Confirmações cabem em 320 CSS px e zoom 200% sem rolagem horizontal.

### Tokens

Plus Jakarta Sans hospedada no produto, pesos 400–800; `#4C1D95` marca/ação primária, `#7C3AED` interação, `#A78BFA` foco, `#14121F` texto, `#55507A` apoio, `#F8F7FC` fundo, `#FFFFFF` superfícies, `#E8E4F1` bordas. Perigo usa `#B91C1C` e `#FFF2F1`. Contraste WCAG AA, foco perceptível de 3 px com offset e respeito a `prefers-reduced-motion`.

## 5. Dados da organização e salvamento

- Nome é obrigatório. Aparar espaços nas bordas; recusar string vazia após trim; preservar capitalização/acentos. Limite de caracteres, unicidade e palavras proibidas seguem regras reais do serviço, refletidas nos erros da UI. Não validar unicidade somente no browser.
- Horário padrão é obrigatório e representa um horário civil `HH:mm` na zona da organização. O protótipo lista 08:00–18:00 em passos de uma hora por demonstração; **não adotar esse intervalo como regra sem confirmar o domínio**. Carregar opções canônicas ou usar seletor de hora compatível com as regras reais; não gravar 13:00 como default hardcoded.
- Explicar fuso aplicado perto do campo se disponível. O horário padrão não é o horário silencioso da pessoa. Ao salvar, o servidor decide como esse valor afeta criação futura; a UI não promete remarcação retroativa.
- Alterações nos dois campos são uma operação coerente de organização. Desabilitar envio duplo, manter valores durante requisição e apresentar `Configurações salvas.` somente após confirmação real. Atualizar faixa com novo nome e invalidar caches do shell. Em erro, preservar valores e associar erro ao campo.
- Se houver edição concorrente, enviar versão/ETag quando serviço suportar e apresentar conflito com opção de recarregar, sem sobrescrever silenciosamente mudanças alheias. Confirmar descarte se a pessoa navegar com alterações não salvas, usando o padrão aprovado em Novo vencimento.
- Campos editáveis só para papéis autorizados. Membros sem permissão podem ver nome e horário em modo de leitura se autorizado.

## 6. Armazenamento

- Fonte de verdade: medição e quota do serviço no escopo da organização atual. Não calcular uso somando apenas arquivos visíveis no cliente. Serviço define se conta versões, anexos, arquivos em processamento, itens arquivados e overhead; UI deve usar o mesmo valor do limite aplicado no upload.
- Calcular porcentagem como `usoBytes / limiteBytes × 100` quando limite é positivo e finito, com clamp visual 0–100%. Dados textuais mantêm precisão útil; percentual inteiro arredondado pode aparecer como `0%` para uso muito pequeno, mas o texto de bytes/MB deve evitar falsa impressão de nenhum uso.
- Se uso exceder quota, exibir valor real e tratar barra como 100% com mensagem contextual; se quota for zero, indefinida ou ilimitada, não dividir por zero nem inventar porcentagem.
- Estado de carregamento separado do formulário; falha da métrica mostra `Não foi possível carregar o uso de armazenamento.` e `Tentar novamente`, sem impedir edição autorizada dos dados da organização.
- Medição pode ser eventual; se serviço fornece `measuredAt`, mostrar indicação de atualização conforme necessidade. Não animar indicador de forma que pareça medição em tempo real.

## 7. Sair da organização

- Ação é **remoção da associação da pessoa autenticada** à organização atual, não logout e não exclusão da organização.
- Antes de oferecer, confirmar regras do domínio: papel Owner/último administrador pode precisar transferir titularidade, convidar outro administrador ou estar impedido de sair. Mostrar razão específica e ação apropriada; não abrir confirmação que inevitavelmente falhará.
- Diálogo: título `Sair da organização?`; texto `Você perderá o acesso à organização “{nome}”. Os dados e demais membros permanecerão nela.`; botões `Cancelar` (foco inicial) e `Sair da organização` (perigo). A versão final deve usar a consequência real da identidade/papel.
- Confirmar chama o serviço uma única vez. Durante processamento, bloquear repetição e manter diálogo. Somente após sucesso remover o contexto atual, invalidar caches e direcionar à seleção de organizações ou onboarding conforme fluxo existente. Se ainda houver outras organizações, oferecer contexto de troca. Não direcionar automaticamente a uma organização sem autorização.
- Erros de regra, rede e conflito são distintos; manter acesso e diálogo se serviço não confirmar saída. Não anunciar sucesso antecipado. A auditoria de membros deve seguir o serviço.

## 8. Encerrar organização

- Visível e executável somente por papel com autorização expressa para encerrar; o backend verifica novamente. A permissão de renomear ou de sair **não** implica permissão de encerrar.
- Antes de conectar a ação, confirmar contrato de encerramento, vínculos, retenção, exigência de exportação, período de carência, cobrança pendente, ações assíncronas, comunicação aos membros e disponibilidade de restauração. A captura antiga afirma apagamento definitivo, mas isso não é evidência suficiente para implementar deleção física imediata.
- Na página, texto deve descrever a consequência exata confirmada: se permanente, dizer que os dados não poderão ser recuperados; se houver período de retenção, descrevê-lo. Não usar “exclusão definitiva” para uma operação reversível.
- Diálogo separado do de saída: título `Encerrar organização?`; identificar **nome e ID canônico** devolvidos pelo servidor, efeitos, membros afetados e prazo/possibilidade de recuperação. Exigir digitação exata do identificador canônico, não apenas do nome que pode ser duplicado/renomeado. O campo é **obrigatório** para essa confirmação; o rótulo “(opcional)” da captura antiga está incorreto.
- A primeira ação do diálogo é `Cancelar`, com foco inicial. `Encerrar organização` só habilita após valor exato e demais confirmações que a política efetiva exigir. Esc e clique fora cancelam antes da requisição; durante envio, não permitir saída que deixe estado ambíguo.
- Confirmação pode iniciar job assíncrono. Mostrar o estado retornado pelo serviço (`solicitado`, `em andamento`, `concluído` ou erro), sem dizer “encerrada” antes de confirmação. Se operação irreversível for concluída, invalidar sessão/contexto e redirecionar ao fluxo seguro de organizações.
- Se a implementação atual não tiver endpoint, autorização e política de retenção definidos, manter o controle de encerramento indisponível ou fora da UI de produção até esses requisitos existirem. **Não ligar o botão a uma exclusão genérica**.
- Registrar auditoria server side e idempotência para impedir duplo encerramento; não registrar texto digitado do campo de confirmação em analytics.

## 9. Estados e mensagens

| Estado | Resultado esperado |
|---|---|
| Carregando organização | Shell visível; valores editáveis ainda não apresentados como reais. |
| Nome vazio | `Informe o nome da organização.` junto ao campo; focar. |
| Horário ausente/inválido | `Selecione um horário válido para os novos lembretes.` junto ao controle. |
| Salvando | `Salvando…`, sem envio duplo e com valores preservados. |
| Sucesso de edição | `Configurações salvas.`; faixa e controles atualizados. |
| Erro de validação | Erro por campo sem apagar o outro. |
| Falha de rede | `Não foi possível conectar. Verifique sua conexão e tente novamente.` |
| Serviço indisponível | `Não foi possível salvar as configurações agora. Tente novamente em alguns instantes.` |
| Sem permissão de edição | Campos em leitura ou estado de acesso insuficiente, conforme permissão real. |
| Métrica de armazenamento indisponível | Erro local e retry, sem converter para `0 GB`. |
| Saída/encerramento bloqueado por regra | Motivo específico seguro devolvido pelo serviço; nenhuma mudança otimista. |
| Sessão expirada | Login seguro com destino interno quando ainda autorizado. |

## 10. Semântica e acessibilidade

- Uma região `<main>`, um H1, H2 para Dados da organização, Armazenamento e Ações importantes, H3 para os dois cards de risco. `<form>` envolve somente campos e Salvar; Sair e Encerrar são botões `type=button` fora do envio do formulário.
- Labels associados aos campos; `required` e erro por `aria-describedby`/`aria-invalid`. Status de gravação em `aria-live=polite`, erros em `role=alert`. Não comunicar falta de permissão apenas por botão acinzentado sem explicação.
- Uso de armazenamento com `<progress>` ou `role=progressbar` e valor/limite acessíveis. Quando não houver quota finita, apresentar texto em vez de progressbar enganosa.
- Diálogos de risco com `role=dialog`, `aria-modal=true`, título e descrição associados, foco contido, Esc para cancelar quando seguro, e retorno ao acionador após cancelamento. Após sucesso que remove o contexto, foco vai ao destino de navegação. Nome/ID completos devem quebrar, não truncar.
- Botões com alvo ≥44 × 44 px; contraste AA; zoom 200% e largura 320 CSS px sem cortes ou overflow. Drawer móvel segue regras já especificadas no shell.

## 11. Contrato semântico de integração

Mapear os modelos e endpoints reais a estas operações; não presumir nomes físicos:

```ts
type OrganizationSettings = {
  id: string;
  name: string;
  defaultReminderTime: string; // HH:mm, horário civil
  timeZone: string;             // IANA
  version?: string;
  permissions: {
    canEdit: boolean;
    canLeave: boolean;
    canClose: boolean;
  };
};
type StorageUsage = {
  usedBytes: number;
  limitBytes?: number; // ausente se ilimitado/não aplicável
  measuredAt?: string;
};
type UpdateSettingsInput = {
  name: string;
  defaultReminderTime: string;
  expectedVersion?: string;
};
```

Ler settings, quota e permissões no escopo da sessão; update, leave e close são operações separadas, com autorização, validação e auditoria no servidor. A saída não deve reutilizar o logout; o encerramento não deve reutilizar a exclusão de membro. Cache por organização/identidade; invalidar após mutações. Proteger solicitações conforme sessão/CSRF existente e não confiar em ID arbitrário fornecido pelo cliente.

## 12. Critérios de aceite

1. Revisão visual contra `OmniVence-configuracoes-prototipo.html` em 1440×900, 1280×800, 900×900, 390×844 e 320×700: hierarquia, cartões, ações e responsividade coerentes com as outras telas, sem overflow horizontal.
2. Nome, horário, fuso, quota e uso vêm da organização ativa; nenhum valor ilustrativo hardcoded. O armazenamento não arredonda uso positivo para zero enganoso e trata limite ausente/indisponível.
3. Editar exige permissão; valida obrigatórios; preserva valores em erro; atualiza shell somente após sucesso; mudanças simultâneas não são sobrescritas silenciosamente.
4. “Sair da organização” e logout têm efeitos diferentes. Último responsável/Owner é tratado segundo regra do domínio; sem sucesso do serviço a pessoa continua associada.
5. “Encerrar organização” exige permissão própria, confirmação de ID exato e descreve o efeito real confirmado. Não existe execução irreversível por um clique na página nem falsa mensagem de conclusão de job assíncrono.
6. Teclado, leitor de tela, modais, barra de uso, alertas e foco operam corretamente em desktop e mobile. Estados loading, erro, sem permissão e sessão expirada são distintos.
7. Testes relevantes cobrem validação/salvamento, arredondamento/quota, escopo por organização, permissão de saída/encerramento, confirmação exata e idempotência. Revisão manual visual/acessível antes de concluir.

## 13. Definição de pronto

A tela está pronta quando reproduz a interface aprovada com dados reais, salva com segurança, mede armazenamento de forma honesta e diferencia logout, saída da organização e encerramento. **O encerramento somente pode ser habilitado em produção depois de verificados seu contrato, permissões, retenção, vínculos e consequência efetiva.**
