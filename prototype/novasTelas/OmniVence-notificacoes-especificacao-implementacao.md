# OmniVence — Notificações: especificação de implementação

**Status:** especificação da tela aprovada. **Referência visual:** `OmniVence-notificacoes-prototipo.html`, com as decisões textuais desta especificação prevalecendo sobre ele. **Referência de consistência:** shell e tokens das telas aprovadas. **Idioma:** português do Brasil. **Escopo:** preferências pessoais de canais, verificação de número WhatsApp e horário silencioso.

## 1. Decisões que prevalecem sobre o protótipo

1. **Não renderizar a pill “EM PREPARAÇÃO” ao lado de WhatsApp.**
2. **Não exibir o texto “A verificação é demonstrativa neste protótipo” nem qualquer mensagem equivalente na aplicação.** O controle “Enviar código” precisa realizar verificação real antes de entrar em produção; se o serviço de verificação ainda não existir, o controle não deve aparecer como funcional. O fluxo de mensagens pelo WhatsApp pode ter disponibilidade independente da verificação do número.
3. Não incluir avisos de “Protótipo visual”, valores de exemplo ou confirmação falsa de salvamento. As ações funcionam com dados reais do usuário autenticado.
4. Esta página configura **a pessoa logada**, nunca as preferências globais da organização nem as dos outros membros. O backend deriva a identidade da sessão; não confia em `userId` arbitrário do browser.
5. A captura antiga mostra padrão do sistema ainda não personalizado. Exibir esse aviso somente quando a API indicar ausência de preferência salva; não deduzir o estado comparando valores ao default.
6. E-mail, WhatsApp e horário silencioso são preocupações distintas. Número informado ou verificado não significa automaticamente que mensagens WhatsApp estão ativas. Não mostrar “WhatsApp ativado” sem o serviço de entrega estar habilitado e a opção pessoal ter sido consentida/ativada.
7. Não acrescentar SMS, push, granularidade por evento, frequência, digest, regras por organização nem novos canais nesta entrega.

## 2. Rota, shell e acesso

- Usar a rota de **Notificações** já definida no roteador. Item lateral selecionado com `aria-current="page"`.
- Reutilizar sidebar, logo, identidade da pessoa e menu móvel da Visão geral. Sair usa o mecanismo real de sessão.
- A tela exige sessão válida. Em sessão expirada, seguir retorno a `/login` com destino interno seguro. Preferências são lidas e alteradas apenas pelo próprio usuário autenticado; conferir autorização no serviço.
- A página é uma configuração, não uma caixa de notificações recebidas. O H1 permanece `Notificações` porque é a nomenclatura do menu, mas o texto de apoio explicita a função.

## 3. Conteúdo de interface

| Área | Texto/regra |
|---|---|
| `<title>` | `Notificações · OmniVence` |
| Selo acima do H1 | `PREFERÊNCIAS PESSOAIS` |
| H1 | `Notificações` |
| Apoio | `Escolha como você recebe lembretes. Estas preferências não alteram as de outras pessoas.` |
| Aviso quando padrão | Título `Suas preferências atuais`; texto `Você está usando as configurações padrão. Personalize os canais e horários abaixo.` |
| Aviso após dados personalizados | Título `Suas preferências atuais`; texto `Estas são as preferências salvas para a sua conta.` |
| Card esquerdo | `Canais de notificação`; apoio `Controle os canais pelos quais você quer ser avisado.` |
| E-mail | `E-mail`; apoio `Enviado ao endereço associado à sua conta.`; estado textual `Ativado` ou `Desativado` |
| WhatsApp | `WhatsApp`; apoio `Cadastre e verifique um número para receber avisos quando este canal estiver disponível.` **Sem pill junto ao título.** |
| Telefone | `Número de celular (opcional)`; placeholder `+55 11 99999-9999` |
| Ação do telefone | `Enviar código`, somente quando houver serviço real pronto para executar a verificação |
| Card direito | `Horário silencioso`; apoio `Defina um período sem envio de lembretes.` |
| Bloco ilustrativo | `Um intervalo para você se concentrar.` e `Fora desse horário, os lembretes seguem suas preferências de canal.` |
| Horas | `Das (opcional)` e `Até (opcional)` |
| Ajuda | `Preencha os dois horários para ativar o intervalo. Um período que atravessa a meia-noite também é aceito.` |
| Rodapé do formulário | `Preferências pessoais`; apoio `Alterações feitas aqui se aplicam somente à sua conta.` |
| Botão principal | `Salvar preferências`; durante envio `Salvando…` |

O texto sobre WhatsApp acima informa disponibilidade do **envio de lembretes**, sem representar que verificar número por si só ativa esse canal. Quando o produto liberar envio, substituir a frase por instrução funcional apropriada e oferecer controle de adesão separado. Não expor um switch WhatsApp ainda sem serviço de entrega.

## 4. Layout e estilo

### Desktop

- Shell compartilhado de 256 px de sidebar fixa, fundo do conteúdo `#F8F7FC`, padding superior 37 px e lateral `clamp(24px,3.4vw,62px)`. Largura máxima da área desta página 1600 px.
- Cabeçalho com selo 11 px/800, H1 `clamp(27px,2.5vw,37px)`/700 e apoio 13 px. Espaço até aviso 23 px.
- Aviso de preferência atual: fundo `#F1EBFF`, borda `#DDD6FE`, raio 12 px, padding 15 × 18 px, ícone em caixa de 30 px, título 11 px e texto 11 px. Não representar o aviso como erro.
- Duas colunas iguais com gap 17 px. Cards brancos de borda `#E8E4F1`, raio 16 px, sombra leve, padding 26 × 27 px. Cabeçalhos internos têm ícone 37 × 37 px, título 17 px e apoio 11 px.
- Card de canais: linha E-mail com texto à esquerda e switch à direita; estado textual visível. Uma divisória separa WhatsApp. Input de telefone e botão de verificação aparecem em linha quando há espaço; ajuda de campo abaixo, sem o aviso demonstrativo do HTML.
- Card de horário: bloco suave `#F8F7FC` com lua decorativa e texto; controles de hora em grade `1fr auto 1fr`, intervalo visual “até”; campos de 45 px e raio 9 px.
- Barra de ação após os cards: branca, borda e raio 13 px, texto à esquerda e botão roxo de 43 px à direita; não fixá-la sobre conteúdo. Padding 15 × 19 px.
- Plus Jakarta Sans 400–800 hospedada no projeto. Marca `#4C1D95`, interação `#7C3AED`, foco `#A78BFA`, texto `#14121F`, apoio `#55507A`; contraste AA. Sem gradiente ou efeitos chamativos.

### Responsividade

- Até 1100 px: cards empilhados, mesma ordem do DOM: Canais, Horário, Salvar. Não reduzir campos a larguras ilegíveis.
- Até 900 px: sidebar vira drawer compartilhado com controle de foco, sobreposição e Esc.
- Até 650 px: card com padding 22 × 18 px; input e botão de telefone podem ocupar linhas separadas; botão Salvar ocupa a largura da barra, que empilha seus textos. Horários mantêm dois inputs quando couberem e empilham em 320 CSS px/zoom 200% se necessário.
- Nenhum elemento fixo cobre o botão ou os campos com teclado virtual aberto; sem rolagem horizontal. Respeitar `prefers-reduced-motion`.

## 5. Fonte dos dados e estado do formulário

- Carregar preferências efetivas do usuário e metadados necessários: `isCustomized`, `emailEnabled`, `quietHoursStart`, `quietHoursEnd`, fuso de referência, telefone em formato seguro/mascarado, estado de verificação e disponibilidade real do fluxo de verificação/entrega.
- Se não houver preferência personalizada, preencher controles com **defaults devolvidos pelo serviço**, mostrar aviso de padrão. Não gravar overrides somente por visitar a página.
- Switch E-mail altera estado local e texto Ativado/Desativado imediatamente, mas só persiste ao clicar Salvar. Ao descartar alterações, restaurar valores salvos. Não apagar endereço de e-mail da conta ao desativar notificações.
- Telefone: preferir E.164 na persistência, com seleção/normalização de país definida pelo serviço. Input permite formatação legível do Brasil; validar número plausível no cliente e definitivo no serviço. Nunca armazenar o telefone sem a ação e política de consentimento que o produto estabelecer. O envio de código é uma operação separada de Salvar preferências.
- Horário silencioso: ambos vazios = desativado; ambos preenchidos e diferentes = ativo; apenas um preenchido ou horários iguais = erro. `22:00` até `07:00` significa cruzar meia-noite. Usar o fuso da conta ou organização exibido ao usuário; na ausência de configuração, `America/Sao_Paulo`. Não interpretar horários como UTC nem supor duração fixa de 24 h em dias de mudança de fuso.
- Horário silencioso suspende **envio** de lembretes que o domínio classifica como adiáveis; o tratamento de eventos críticos e o destino dos lembretes retidos (entrega depois ou descarte) devem seguir a política de notificações já implementada. Não inventar política de fila nesta página. Na interface, não prometer “nenhum lembrete” se há exceções reais.
- Salvar E-mail/horário silencioso em uma operação atômica ou com estratégia que não anuncie sucesso parcial. Desabilitar envio duplo e manter valores durante requisição. Em sucesso, atualizar versão/base de comparação e aviso para personalizada. Sucesso: `Preferências salvas.` em região de status.
- Ao sair com alterações não salvas, usar confirmação de descarte do padrão aplicado ao formulário Novo vencimento. Um código já solicitado não é revertido por esse descarte.

## 6. Verificação do telefone WhatsApp

A implementação deve tornar o botão `Enviar código` real ou deixar indisponível com explicação honesta até a infraestrutura de verificação existir. A versão de produção não pode alegar envio sem realizá-lo.

Fluxo quando disponível:

1. Usuário informa número, confirma que deseja receber código naquele número e aciona Enviar código. Validar e normalizar; não enviar se número vazio/inválido.
2. Serviço inicia desafio com expiração, limite de tentativas e proteção contra abuso. UI mostra telefone mascarado, campo `Código de verificação`, ações `Confirmar código`, `Reenviar código` somente após intervalo autorizado e `Alterar número`. Não revelar se outra conta possui o número.
3. Após código válido, serviço marca **aquele número** como verificado para a pessoa autenticada. Se o número for editado, o estado volta a não verificado. Exibir `Número verificado` com contexto acessível.
4. Erros: código incorreto ou expirado, limite de tentativas, falha de envio e rede são estados distintos com mensagens recuperáveis. Não registrar código em logs, analytics ou URL; expirar desafios no servidor.
5. Verificação do número **não ativa** automaticamente notificações por WhatsApp. Quando entrega pelo canal for disponibilizada, criar controle explícito de ativação/consentimento em requisito separado.

Se a infraestrutura ainda não suporta o fluxo, manter o número como dado opcional apenas se houver base funcional e consentimento definidos para armazená-lo; caso contrário, retirar temporariamente campo e botão da implementação, mantendo o restante da página utilizável. Essa é uma dependência de produto, não uma autorização para simular sucesso. A referência visual do protótipo continua orientando o bloco quando a capacidade existir.

## 7. Estados e mensagens

| Estado | Resultado |
|---|---|
| Carregando | Shell/cabeçalho visíveis, controles indisponíveis com placeholders; não exibir defaults como se já fossem salvos. |
| Padrão | Aviso de configuração padrão, valores efetivos fornecidos pelo serviço, sem override gravado. |
| Personalizado | Aviso de preferências salvas; controles refletem dados da conta. |
| Um horário vazio | `Preencha os dois horários para definir o período silencioso.`; focar campo ausente. |
| Horários iguais | `Escolha horários diferentes para o início e o fim.`; focar “Até”. |
| Salvando | Botão `Salvando…` desabilitado; controles preservam valores. |
| Sucesso | `Preferências salvas.`; estado do aviso passa a personalizado. |
| Erro de validação do serviço | Erros associados ao campo relevante, sem perder os demais valores. |
| Falha de rede | `Não foi possível conectar. Verifique sua conexão e tente novamente.`; botão volta a permitir tentativa. |
| Serviço indisponível | `Não foi possível salvar as preferências agora. Tente novamente em alguns instantes.` |
| Sem permissão/sessão expirada | Estado próprio ou login seguro, nunca “preferências padrão” como fallback. |
| Conflito de versão | Informar que as preferências mudaram em outra sessão, oferecer recarregar/reconciliar; não sobrescrever silenciosamente. |

Ao editar campo com erro, remover o indicador específico e revalidar em blur ou novo envio. A mensagem deve ser anunciada em `role=alert` sem depender só de cor.

## 8. Semântica e acessibilidade

- Uma região `<main>`, um `<h1>`, seções H2 “Canais de notificação” e “Horário silencioso”, e `<form>` com labels reais.
- Switch E-mail é checkbox nativo estilizado, com nome acessível `Receber lembretes por e-mail` e estado `checked`. Texto Ativado/Desativado é visível e não substitui a semântica do controle.
- Número de celular usa `type=tel`, `inputmode=tel`, `autocomplete=tel`; label e ajuda por `aria-describedby`. Os horários usam labels “Das”/“Até” e entrada acessível por teclado. Fuso precisa ser identificado em texto próximo aos horários quando definido pelo serviço.
- Botão Enviar código e fluxo de confirmação são operáveis por teclado; erro associado ao número/código; não comunicar estado verificado só por ícone.
- Salvar anuncia progresso e resultado em `aria-live=polite`; erros em `role=alert`; foco fica no controle relevante. Se um modal de verificação for usado, conter foco, fechar com Esc e devolvê-lo ao acionador.
- Drawer do shell segue especificação da Visão geral. Alvos de toque ≥44 × 44 px, foco visível 3 px, contraste AA, zoom 200% e largura 320 CSS px sem perda de conteúdo.

## 9. Contrato semântico de integração

Adaptar serviços e rotas reais sem presumir nomes de endpoint:

```ts
type NotificationPreferences = {
  isCustomized: boolean;
  emailEnabled: boolean;
  quietHoursStart?: string; // HH:mm, horário civil
  quietHoursEnd?: string;   // HH:mm, horário civil
  timeZone: string;         // IANA, exibido ao usuário
  phoneMasked?: string;
  phoneVerified: boolean;
  phoneVerificationAvailable: boolean;
  whatsappDeliveryAvailable: boolean;
  version: string;         // controle de concorrência, se suportado
};
type PreferencesPatch = {
  emailEnabled: boolean;
  quietHoursStart?: string;
  quietHoursEnd?: string;
  expectedVersion?: string;
};
```

Serviço lê/escreve por identidade da sessão e valida no servidor formato, horário, autorização e controle de concorrência. Separar endpoints/operações de preferência, emissão de desafio, confirmação e reenvio de código. Não enviar telefone completo em logs e analytics; mascarar onde possível. Respeitar limites de taxa e proteção contra CSRF conforme a arquitetura de sessão. Não fazer o browser enviar mensagens diretamente a provedores de WhatsApp. Quando a página voltar ao foco ou após alteração bem-sucedida, revalidar preferências e estado de verificação.

## 10. Critérios de aceite

1. Visual compatível com o protótipo em 1440×900, 1280×800, 900×900, 390×844 e 320×700, com shell compartilhado, responsividade e sem overflow horizontal. **A pill “EM PREPARAÇÃO” e o texto sobre verificação demonstrativa não aparecem.**
2. Estado padrão vem do serviço e não vira preferência personalizada só por abrir a página; salvar altera apenas preferências da pessoa autenticada.
3. Switch de e-mail, intervalos vazios, completos, iguais e atravessando meia-noite funcionam segundo regras acima, no fuso explicitado. Saída com alterações oferece descarte.
4. Salvar confirma somente sucesso real, evita duplicidade, preserva valores em erro e distingue rede, validação, falta de permissão e conflito.
5. Enviar código realiza verificação real com limites e confirmação, ou não é oferecido como ação funcional enquanto serviço inexistente. Número verificado não ativa automaticamente mensagens WhatsApp.
6. Teclado e leitor de tela compreendem canais, estados, horários, erros e progresso; foco do menu e de eventuais diálogos funciona; zoom 200% mantém controles acessíveis.
7. Testes relevantes cobrem defaults/override, escopo por usuário, horários com virada de dia, validações, persistência, erro e fluxo de código; QA visual e manual de acessibilidade antes de concluir.

## 11. Definição de pronto

A tela está pronta quando reproduz a interface aprovada com as duas remoções pedidas, carrega e salva preferências reais por usuário, aplica corretamente o horário silencioso e não simula verificação de telefone. A disponibilidade de envio de lembretes pelo WhatsApp fica independente do número verificado e só pode ser anunciada quando o serviço de entrega estiver de fato habilitado.
