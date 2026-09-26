# OmniVence — tela de login: especificação de implementação

**Status:** especificação para implementação da tela aprovada. **Referência visual obrigatória:** `OmniVence-login-prototipo.html`. **Idioma:** português do Brasil. **Escopo:** entrada por e-mail e senha, navegação até recuperação de senha e estados correspondentes. Esta especificação substitui a especificação resumida anterior para a tela de login.

## 1. Regra de prioridade e limites

1. Reproduzir a aparência do protótipo aprovado no estado padrão. Este documento define comportamento, integração e acessibilidade onde o protótipo é apenas demonstrativo.
2. O seletor flutuante “Protótipo · padrão” e seus estados são ferramentas de demonstração: **não entram na aplicação**.
3. O PNG do logo embutido no protótipo é provisório. Usar o mesmo visual até que o SVG oficial seja entregue; não redesenhar o símbolo, aplicar filtro, extrair automaticamente vetor, nem substituir por um monograma.
4. Não acrescentar cadastro público, login social, SSO, MFA, depoimentos, métricas, animações, captcha visível ou novo texto de marketing. Esses fluxos só entram mediante requisito funcional separado.
5. Esta especificação define a experiência e uma interface de integração. Não presume que o repositório atual exponha endpoints ou biblioteca de autenticação específicos. **Adaptar à infraestrutura de autenticação existente sem alterar o comportamento visível aqui definido.** Se algum requisito depender de uma capacidade inexistente, implementar o adaptador/endpoint necessário antes de dar a tela como concluída; não simular autenticação em produção.

## 2. Rotas e navegação

- Rota da tela: `/login`.
- Destino padrão depois do login: `/dashboard`.
- Recuperação: `/recuperar-senha`. O link navega para essa rota; esta entrega exige que exista uma tela funcional de recuperação ou que ela seja implementada no mesmo trabalho. Fluxo mínimo: campo de e-mail, envio, confirmação neutra, link para voltar a `/login`.
- Se uma rota protegida redirecionar para login, preservar o destino original apenas se for um caminho interno seguro iniciado por `/`, sem `//`, esquema ou host externo. Após autenticação, navegar para esse destino; caso contrário, `/dashboard`. Evitar redirect aberto.
- Usuário já autenticado ao abrir `/login`: redirecionar ao destino interno seguro, senão `/dashboard`, após validação da sessão. Enquanto essa validação ocorre, mostrar um estado neutro de carregamento sem piscar o formulário.
- Sessão expirada durante uma rota protegida: enviar a `/login` preservando o destino interno; mostrar a mensagem contextual “Sua sessão expirou. Entre novamente para continuar.” somente nesse caso.
- Após login, não deixar senha nem tokens em parâmetros de URL, estado persistente do formulário, analytics ou logs. Para retorno com botão Voltar, a rota de login deve redirecionar novamente se houver sessão válida.

## 3. Conteúdo exato

| Local | Texto |
|---|---|
| Título da página | `Entrar · OmniVence` |
| Logo, alternativa acessível | `OmniVence — Gestão inteligente de vencimentos` |
| Painel esquerdo, topo | `OmniVence` |
| Selo | `CONTINUIDADE SOB CONTROLE` |
| Chamada | `Antecipe prazos.` + quebra de linha + `Cuide do que vem depois.` |
| Texto institucional | `Documentos, responsáveis e vencimentos conectados para que sua equipe acompanhe cada pendência até a resolução.` |
| Base do painel | `Clareza para agir no momento certo.` |
| Título do formulário | `Acesse sua conta` |
| Apoio | `Entre para acompanhar prazos e manter tudo em dia.` |
| Campo 1 | `E-mail`; placeholder `voce@empresa.com.br` |
| Campo 2 | `Senha`; placeholder `Digite sua senha` |
| Alternância da senha | `Mostrar` / `Ocultar` |
| Recuperação | `Esqueceu a senha?` |
| Botão primário | `Entrar`; em envio `Entrando…` |
| Orientação | `O acesso é fornecido pela sua organização. Se ainda não recebeu um convite, fale com o administrador da sua equipe.` |
| Rodapé | `© 2026 OmniVence` no protótipo; na aplicação, ano corrente calculado em tempo de execução |

Não exibir subtítulo institucional em duplicidade fora da imagem de logo. O painel esquerdo é conteúdo institucional, não um segundo formulário.

## 4. Layout e medidas

### Desktop, largura acima de 850 px

- Altura mínima: `100vh`; duas colunas CSS Grid: esquerda `minmax(0, 1fr)` e direita `minmax(490px, 48%)`.
- Painel esquerdo: fundo sólido `#4C1D95`, texto branco. Padding vertical 48 px; horizontal `clamp(38px, 6vw, 106px)`. Distribuição vertical `space-between` entre identificador superior, bloco central e frase inferior.
- Decoração: círculos concêntricos discretos em CSS, posicionados no canto inferior direito, sem captura de clique e `aria-hidden`; não usar foto, ícone de calendário, gradiente nem efeito de brilho. A decoração do protótipo serve de referência precisa.
- Conteúdo central esquerdo: largura máxima 550 px. Selo 12 px/700, chamada `clamp(38px, 4vw, 64px)` com line-height 1.13 e letter-spacing `-0.055em`, parágrafo 17 px com line-height 1.8 e largura máxima 480 px.
- Área direita: padding vertical 42 px, horizontal `clamp(28px, 5.8vw, 102px)`; flex vertical. Logo no topo, formulário centralizado verticalmente e rodapé abaixo. Logo com caixa máxima 245 × 70 px, `object-fit: contain`, alinhamento à esquerda.
- Formulário com largura máxima 430 px e largura 100%. Cabeçalho: margem inferior 31 px. Título `clamp(29px, 2.6vw, 37px)`, line-height 1.2, peso 700, letter-spacing `-0.045em`; apoio 15 px/1.6.
- Campo: margem inferior 19 px; rótulo 13 px/700, distância até controle 9 px. Entrada 100% × 52 px, raio 10 px, borda 1 px `#D7D2E3`, padding horizontal 15 px. Campo senha reserva 78 px à direita para o botão de visibilidade.
- Link de recuperação alinhado à direita, com margem inferior 24 px. Botão principal 100% × 52 px, raio 10 px. Orientação abaixo com margem superior 22 px. Rodapé 12 px.

### Tablet e celular, largura até 850 px inclusive

- Ocultar completamente o painel esquerdo; manter o logo, título, formulário, orientação e rodapé. Não usar rolagem horizontal.
- Área principal com `min-height: 100dvh`, padding superior 27 px, laterais 25 px e inferior 25 px; formulário com máximo de 460 px, centralizado vertical e horizontalmente pelo espaço disponível.
- Logo com caixa máxima 215 × 61 px. Abaixo de 420 px, título 29 px.
- Se a altura da janela/teclado não comportar o conjunto, permitir rolagem vertical natural; nunca cobrir campos ou botão com elementos fixos.
- Usar a mesma ordem de foco e de leitura do DOM no desktop e no celular. O painel oculto não deve ser alcançado pelo leitor de tela em telas pequenas.

### Tipografia, cores e interação

- Família: Plus Jakarta Sans nos pesos 400, 500, 600, 700 e 800; fallback `system-ui, sans-serif`. Hospedar os arquivos de fonte dentro do produto, com subset latino que inclua acentos do português; `font-display: swap`. A dependência de Google Fonts no arquivo demonstrativo não é uma exigência de produção.
- Tokens: `--purple-deep:#4C1D95`, `--purple:#7C3AED`, `--lilac:#A78BFA`, `--ink:#14121F`, `--muted:#55507A`, `--white:#FFFFFF`, `--field-border:#D7D2E3`, `--error:#B91C1C`, `--error-text:#991B1B`, `--error-bg:#FEF2F2`, `--error-border:#FECACA`.
- Botão padrão `#4C1D95`/branco; hover `#3B1677`. Texto de link `#4C1D95` com sublinhado em hover. Estados de foco perceptíveis: input borda `#7C3AED` e halo `0 0 0 4px #7c3aed22`; botões e links outline 3 px `#A78BFA`, offset 3 px.
- Respeitar `prefers-reduced-motion`; não depender de movimento para indicar estado. Garantir contraste WCAG AA para texto funcional; não usar lilás como texto normal sobre branco.

## 5. Semântica e acessibilidade

- Uma região `<main>`, um `<h1>` “Acesse sua conta”, um `<form>` e `<label>` associado a cada input; o painel institucional pode ser `<aside>` com título acessível.
- E-mail: `type=email`, `inputMode=email`, `autoComplete=username`, `name=email`, `required`. Senha: `type=password`, `autoComplete=current-password`, `name=password`, `required`. Não desativar gerenciadores de senha, copiar/colar nem autocomplete.
- Botão Mostrar/Ocultar: `type=button`; alterna o tipo sem apagar valor nem mover foco; nome acessível “Mostrar senha” / “Ocultar senha” e `aria-pressed` coerente. Pressionar Enter dentro dos campos envia o formulário.
- Erro de campo: texto de erro associado com `aria-describedby` e `aria-invalid=true`; além disso, alerta resumido no início do formulário com `role=alert`. Ao erro de validação local, focar o primeiro campo inválido. Ao erro de servidor, focar o alerta ou anunciá-lo por região viva sem perder o valor do e-mail.
- Em carregamento, botão desabilitado e texto “Entrando…”; anunciar o estado em região com `aria-live=polite`. O foco não deve ser enviado arbitrariamente ao começo da página.
- Ordem por Tab: e-mail → senha → Mostrar/Ocultar → Esqueceu a senha? → Entrar. Elementos decorativos fora da árvore de acessibilidade. Áreas clicáveis de links e botões com altura/tamanho de alvo de ao menos 44 px, inclusive o link (usar padding ou área envolvente sem mudar aparência).
- Idioma da página `pt-BR`; zoom até 200% e reflow em 320 CSS px sem perda de conteúdo; textos não truncados; rótulos visíveis mesmo com placeholder vazio.

## 6. Estados e mensagens

| Estado | Comportamento e texto |
|---|---|
| Inicial | Campos vazios; senha escondida; botão ativo; nenhum alerta. Foco inicial segue navegação normal, sem autofocus. |
| E-mail vazio | Após envio: `Informe um e-mail válido para continuar.`; marcar e focar e-mail. |
| E-mail malformado | Mesma mensagem de e-mail vazio; validação após trim de espaços externos. |
| Senha vazia | Após e-mail válido e envio: `Informe sua senha para continuar.`; marcar e focar senha. |
| Enviando | Desabilitar envio duplicado; manter campos visíveis e seus valores; botão `Entrando…`. |
| Credenciais recusadas | `Não foi possível entrar. Confira seus dados e tente novamente.`; preservar e-mail, limpar senha, restaurar botão. Não distinguir conta inexistente de senha incorreta. |
| Rede indisponível/timeout | `Não foi possível conectar. Verifique sua conexão e tente novamente.`; preservar e-mail, limpar senha, restaurar botão. |
| Serviço indisponível | `O acesso está temporariamente indisponível. Tente novamente em alguns instantes.`; preservar e-mail, limpar senha, restaurar botão. |
| Tentativas limitadas | `Muitas tentativas de acesso. Aguarde alguns minutos e tente novamente.`; respeitar o intervalo devolvido pelo serviço, sem contador inventado. |
| Sessão expirada | Mensagem contextual do §2 acima; manter formulário padrão. |
| Sucesso | Redirecionar, sem exibir toast de sucesso ou atrasar artificialmente. |

Validação de formato: usar o algoritmo nativo de `type=email` após remover apenas espaços nas extremidades do e-mail; não criar regex restritiva. Não remover espaços da senha nem alterar caixa do e-mail mostrado ao usuário. Limpar mensagens antigas no início de nova tentativa; ao editar o campo inválido, remover o seu erro de campo, mantendo o erro geral até próxima tentativa ou até uma nova digitação coerente. Não revelar detalhes internos de respostas da API.

## 7. Contrato de autenticação na aplicação

A tela chama uma camada `AuthService`; componentes visuais não fazem fetch direto. O serviço integra o mecanismo já adotado pelo projeto e expõe estas operações sem mudar sua semântica:

```ts
type LoginInput = { email: string; password: string };
type LoginFailure =
  | { kind: 'invalid_credentials' }
  | { kind: 'rate_limited'; retryAfterSeconds?: number }
  | { kind: 'network' }
  | { kind: 'unavailable' }
  | { kind: 'unknown' };
interface AuthService {
  getSession(): Promise<{ authenticated: boolean }>;
  signIn(input: LoginInput): Promise<{ ok: true } | { ok: false; error: LoginFailure }>;
  requestPasswordReset(email: string): Promise<void>;
}
```

- `signIn` só retorna `ok:true` quando a sessão já é válida para a próxima navegação. Se o provedor usa desafio adicional obrigatório, esse caso não pode ser convertido em sucesso: entregar fluxo autenticado adicional conforme requisito próprio antes de ativar esse provedor.
- Normalizar erros do provedor para os tipos acima. `unknown` usa a mensagem de serviço indisponível; registrar diagnóstico técnico sem credenciais ou dados sensíveis.
- Preferir sessão mantida pelo mecanismo existente do produto, com cookies seguros `HttpOnly`, `Secure`, política `SameSite` adequada e proteção CSRF quando aplicável. **Não introduzir armazenamento de token em `localStorage` ou `sessionStorage` pela tela.** Se a arquitetura já usa outro mecanismo, preservar suas garantias e documentar o adaptador na implementação.
- Todas as chamadas de autenticação em HTTPS em produção. Respeitar throttling do serviço; não implementar bloqueio de conta fictício no cliente. O botão desabilitado previne múltiplos envios da mesma tentativa.
- Recuperação: envio com resposta visível idêntica para e-mails existentes ou inexistentes: `Se houver uma conta vinculada a este e-mail, enviaremos instruções para redefinir a senha.`. A tela de recuperação deve validar o e-mail e dar retorno de falha de rede sem informar se a conta existe.
- O formulário não deve enviar dados a endpoints de demonstração nem conter senha ou usuário de teste embutidos. Não adicionar chamadas externas de rastreamento nessa tela.

## 8. Composição técnica e assets

- Implementar com os componentes e convenções já usados no repositório; criar componente de página, formulário e adaptador de autenticação separáveis. Reutilizar os componentes existentes somente se preservarem fielmente o resultado visual e acessível.
- Manter os tokens da tela centralizados, prontos para reaproveitamento posterior; não fazer refatoração global de design system nesta entrega.
- Colocar o logo provisório em asset do projeto sem a codificação base64 do protótipo. O fundo externo do PNG é transparente. Substituir pela versão vetorial oficial quando ela for aprovada. Alt apropriado e dimensionamento proporcional; não esticar nem reconstruir.
- O arquivo HTML entregue é referência de design e de microcópia; remover seu JavaScript demonstrativo. Evitar CSS inline disperso e dependência de CDN para funcionalidades de produção.
- Ajustar CSP e política de fontes/imagens aos recursos efetivamente hospedados, sem `unsafe-inline` por causa do protótipo.

## 9. Critérios de aceite verificáveis

1. Em 1440×900 e 1280×800, há duas colunas, mesma hierarquia, proporções, textos, cores e ritmo visual do protótipo. Em 850×900, 390×844 e 320×700, painel institucional oculto, todos os controles visíveis por rolagem natural e sem overflow horizontal.
2. Logo legível e proporcional; tipografia correta; nenhum seletor de estados demonstrativos na tela de produção.
3. Tab e Shift+Tab alcançam controles na ordem indicada; Enter submete; botão de senha funciona por teclado e leitor de tela; zoom 200% não perde ação principal.
4. E-mail vazio, inválido, senha vazia, falha de credenciais, timeout, indisponibilidade e limitação de tentativas exibem exatamente a mensagem e preservação de campo definidas nesta especificação.
5. Envio duplo não gera duas tentativas simultâneas. A senha nunca aparece em URL, log, analytics nem armazenamento persistente.
6. Login válido cria sessão reconhecida por rota protegida, redireciona ao destino interno seguro ou `/dashboard`; destino externo malicioso é descartado.
7. Link de recuperação abre fluxo funcional e confirmação neutra. Logout/sessão expirada retornam ao login conforme as regras acima.
8. Revisão visual contra o protótipo e teste manual de teclado/leitor de tela em desktop e celular. Testes automatizados devem cobrir validação, normalização dos tipos de falha, prevenção de envio duplicado e redirecionamento seguro; testes de integração devem usar o serviço real ou ambiente de homologação configurado, sem credenciais em código.

## 10. Definição de pronto

A tela só está pronta quando aparência, estados, integração real de autenticação, recuperação, segurança de navegação e acessibilidade acima estiverem verificados. Qualquer diferença inevitável imposta pelo provedor real (por exemplo, desafio de MFA) deve ser registrada como decisão explícita e implementada em um fluxo próprio; nunca convertida silenciosamente em uma suposição de UI.
