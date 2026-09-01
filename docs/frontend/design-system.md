# Expiration Tracker — Design System v1.0

**Status:** `APPROVED COM EMENDA` (2026-08-31, D-130) — protocolo Claude↔Codex completo, 5 rodadas, Claude 9,2/Codex 9,5. Ver `docs/architecture/reviews/design-system-reconciliation-scoping/estado-final-consolidado.md`. Arquitetura de tokens, regras de processo, catálogo de componentes e patterns deste documento são normativos. Os **valores primitivos concretos** (paleta, fonte, escala tipográfica, radius, foco, cores semânticas, sombra, motion) citados abaixo foram **substituídos** pela §0 a seguir — onde os dois divergem, a §0 e `visual-language-and-design-system.md`/`frontend/src/components/ui/tokens.css` vencem, não os valores originais deste texto.
**Data:** 2026-08-29 (texto original) · **Reconciliado:** 2026-08-31
**Nome da linguagem visual:** **Operational Calm**
**Objetivo:** transformar a identidade visual já existente no protótipo em um design system formal, acessível, responsivo, consistente e preparado para crescimento.

---

# 0. Reconciliação de valores (2026-08-31, D-130)

Este documento foi escrito antes da Direção A ("Operational Calm — Remindax-inspired", accent
blue-indigo) ter sido decidida e implementada com evidência real em
`visual-language-and-design-system.md` (16 rodadas, `VL-G1..VL-G17`, Claude 9,2/Codex 9,04). Os
valores primitivos concretos abaixo descrevem o protótipo anterior a essa direção — não a
identidade real hoje `APPROVED`. Regra de reconciliação:

> Onde este documento cita um **valor concreto** (hex, px, ms, nome de fonte) que tem equivalente
> já implementado em `frontend/src/components/ui/tokens.css`, o valor implementado vence. Onde
> este documento cita um **nome de token simbólico** (`radius.lg`, `action.primary.background`),
> o nome permanece válido — o valor por trás dele é resolvido pela tabela abaixo ou por
> `tokens.css`, não pelo número escrito neste texto. Onde o sistema implementado atribui um
> **papel semântico/default** diferente do assumido implicitamente aqui, o papel implementado
> vence mesmo que o valor numérico exista em algum token do sistema real (ex.: Button).

| Categoria | Este documento | Implementado (`tokens.css`) | Vence |
|---|---|---|---|
| Accent/brand | `purple.600 #7C3AED` | `#7C3AED` (revertido de `#2F4FD0` por decisão direta de produto, D-135, 2026-08-31) | Este documento (coincide com o valor original — a reconciliação de D-130 apontava para `#2F4FD0`, depois revertida) |
| Fonte | Plus Jakarta Sans | System UI stack | Implementado |
| H1/Page title | 32/40 | 22px | Implementado |
| H2/Section | 24/32 | 18px | Implementado |
| Display/demais escalas nomeadas | 36/44 etc. | escala primitiva 12–28px | Implementado |
| Radius | sm8/md12/lg16/xl20 | 4/6/8px | Implementado (nome simbólico, ex. `radius.lg`, permanece — valor é 8px) |
| Foco (cor) | `#6D28D9` | `#2F4FD0` | Implementado |
| Foco (largura) | 2px | 2px | Empate |
| Cores semânticas (success/warning/danger/info) | valores próprios deste doc | `#067647`/`#B54708`/`#B42318`/`#175CD3` | Implementado |
| Shadow.md alpha | `.08` | `rgba(27,35,51,.12)` | Implementado |
| Motion | 120/180/240ms | 120/160ms (sem token `slow`) | Implementado — `slow` fica gap nomeado, não conflito |
| Spacing | 4/8/12/16/20/24/32/40/48/64 | inclui `0/2/4/8...` | Compatível em valor; remapear nome, não substituir escala |
| Botão altura default (§30) | "height: 44px" sem qualificar variante | `Button.tsx` implementa só `sm`/`md`; default `md` = `--control-height-md` (36px). `--control-height-lg` (44px) existe como token global, **não** como variante do Button hoje | Implementado vence como default; `44px` fica resíduo nomeado (adicionar variante `lg` ao Button, ou remover a menção, é decisão futura — não bloqueante) |

Arquitetura de 3 camadas (primitive→semantic→component) prescrita neste documento: a camada de
component-tokens não é retroativamente exigida dos ~9 primitivos já implementados (que usam
deliberadamente 2 camadas, `VL-G8`) — aplica-se a componentes **novos** construídos a partir desta
adoção.

---

# 1. Princípio central

O Expiration Tracker é um produto operacional.

Usuários irão utilizá-lo para acompanhar:

- vencimentos;
- documentos;
- responsáveis;
- renovações;
- fornecedores/clientes/ativos;
- notificações;
- equipes;
- futuramente ciclos documentais mais completos.

A interface deve transmitir:

```text
clareza
+
previsibilidade
+
calma
+
confiança
+
controle
```

e não:

```text
urgência artificial
+
excesso de cor
+
efeitos decorativos
+
densidade desnecessária
+
visual de ERP legado
```

O nome **Operational Calm** representa essa intenção.

---

# 2. O que deve ser preservado do protótipo atual

A direção visual existente é boa e deve ser preservada.

Elementos aprovados como base:

- Plus Jakarta Sans;
- identidade principal roxa;
- superfícies claras;
- contraste forte para informação principal;
- cards com bordas discretas;
- pouca elevação;
- organização por urgência;
- sidebar simples;
- tipografia com hierarquia clara;
- visual contemporâneo sem parecer consumer app;
- linguagem visual amigável sem ser infantil;
- uso moderado de cores semânticas.

Não redesenhar o produto apenas para torná-lo "diferente".

O objetivo deste documento é **sistematizar e amadurecer** essa linguagem.

---

# 3. Princípios do Design System

Toda decisão visual deve respeitar seis princípios.

## 3.1 Operational First

A informação operacional é mais importante que decoração.

Priorizar:

```text
o que precisa de atenção?
quando?
quem é responsável?
qual é o estado?
qual ação é possível?
```

---

## 3.2 Calm by Default

A interface deve ser predominantemente neutra.

Cor forte é reservada para:

- ações;
- seleção;
- estados;
- feedback;
- risco real.

Uma tela não deve parecer crítica quando nada crítico está acontecendo.

---

## 3.3 Semantic Before Decorative

Cores, ícones, badges e destaques devem possuir significado.

Não introduzir novas cores apenas para "variar a interface".

---

## 3.4 Progressive Disclosure

Mostrar primeiro o necessário.

Detalhes técnicos, históricos, metadados e ações raras devem aparecer sob demanda.

---

## 3.5 Accessibility by Construction

WCAG 2.2 AA é requisito do design, não etapa posterior de correção.

O sistema deve possuir tokens e componentes que façam o caminho acessível ser o caminho padrão.

---

## 3.6 Consistency Over Local Optimization

Uma tela não pode inventar:

- novo radius;
- nova cor;
- novo tamanho de botão;
- novo padrão de formulário;
- novo badge;
- nova tipografia;

apenas porque parece melhor isoladamente.

Primeiro verificar o Design System.

---

# 4. Arquitetura do sistema visual

O frontend deve seguir:

```text
Foundation
    ↓
Primitive Tokens
    ↓
Semantic Tokens
    ↓
Component Tokens
    ↓
Components
    ↓
Patterns
    ↓
Screens
```

Nunca:

```text
Screen
→ hexadecimal arbitrário
→ spacing arbitrário
→ font-size arbitrário
```

---

# 5. Design Tokens

Design tokens devem ser a fonte formal das decisões visuais.

Estrutura conceitual:

```text
tokens/
├── primitive
│   ├── color
│   ├── spacing
│   ├── typography
│   ├── radius
│   ├── shadow
│   └── motion
│
├── semantic
│   ├── color
│   ├── typography
│   ├── surface
│   ├── border
│   └── state
│
└── component
```

Sempre que tecnicamente viável, estruturar os tokens de forma compatível com o modelo do **Design Tokens Community Group (DTCG)**.

O projeto não precisa depender de tooling DTCG para existir.

A recomendação é que os nomes e a hierarquia sejam suficientemente semânticos para uma futura exportação/interoperabilidade.

---

# 6. Paleta primitiva — Brand Purple

A identidade roxa atual deve ser mantida.

```text
purple.50   #F5F3FF
purple.100  #EDE9FE
purple.200  #DDD6FE
purple.300  #C4B5FD
purple.400  #A78BFA
purple.500  #8B5CF6
purple.600  #7C3AED
purple.700  #6D28D9
purple.800  #5B21B6
purple.900  #4C1D95
```

Uso principal:

```text
purple.600
```

Hover:

```text
purple.700
```

Pressed:

```text
purple.800
```

Superfícies brand:

```text
purple.50
purple.100
```

---

# 7. Paleta neutra

A neutralidade deve manter a leve tonalidade violeta já presente na identidade.

## Texto

```text
neutral.text.strong      #14121F
neutral.text.default     #55507A
neutral.text.muted       #6B6688
neutral.text.disabled    #9691AA
```

O antigo tom:

```text
#A29DC4
```

não deve ser usado para texto funcional sobre branco porque possui contraste insuficiente.

Pode existir apenas em elementos decorativos que não carreguem informação obrigatória.

---

# 8. Superfícies

```text
surface.canvas           #F8F7FC
surface.canvas.subtle    #FBFAFF
surface.default          #FFFFFF
surface.subtle           #F6F5FB
surface.brand.subtle     #F5F3FF
surface.overlay          #FFFFFF
```

O shell pode utilizar, opcionalmente, o gradiente histórico:

```text
linear-gradient(180deg, #FBFAFF, #F6F5FB)
```

Esse gradiente deve ser usado apenas em áreas amplas de background.

Não utilizar gradientes em cards operacionais comuns.

---

# 9. Bordas

Separar bordas decorativas de bordas funcionais.

## Decorativas

```text
border.subtle     #E8E5F2
border.default    #D8D4E5
```

Podem possuir contraste visual baixo quando não são necessárias para identificar um componente.

## Interativas

Campos e controles que dependem visualmente da borda para serem identificados devem usar uma borda com contraste suficiente.

Base recomendada:

```text
border.control    #8B85A3
```

Focus:

```text
border.focus      #6D28D9
```

Error:

```text
border.danger     #B91C1C
```

---

# 10. Cores semânticas

Cor deve comunicar significado de forma previsível.

## Success

```text
success.text       #166534
success.default    #15803D
success.surface    #F0FDF4
```

## Warning

```text
warning.text       #92400E
warning.default    #B45309
warning.surface    #FFFBEB
```

## Danger

```text
danger.text        #991B1B
danger.default     #B91C1C
danger.surface     #FEF2F2
```

## Info

```text
info.text          #1E40AF
info.default       #1D4ED8
info.surface       #EFF6FF
```

## Brand

```text
brand.text         #5B21B6
brand.default      #7C3AED
brand.surface      #F5F3FF
```

---

# 11. Regra de uso de cores

Nunca depender apenas da cor.

Exemplo incorreto:

```text
vermelho = erro
verde = sucesso
```

Exemplo correto:

```text
ícone
+
texto
+
cor
```

Exemplo:

```text
⚠ Vence em 3 dias
```

e não apenas um ponto laranja.

---

# 12. Contraste

O sistema deve cumprir no mínimo WCAG 2.2 AA.

## Texto normal

```text
mínimo: 4.5:1
```

## Texto grande

```text
mínimo: 3:1
```

## Política interna

Sempre que razoável:

```text
texto principal    ≥ 7:1
texto secundário   ≥ 4.5:1 com margem confortável
```

Evitar combinações que passam no limite exato.

---

# 13. Tipografia

Fonte oficial:

```text
Plus Jakarta Sans
```

Fallback:

```text
ui-sans-serif
system-ui
sans-serif
```

Pesos:

```text
400 Regular
500 Medium
600 SemiBold
700 Bold
800 ExtraBold
```

Não utilizar peso 300 ou inferior.

---

# 14. Escala tipográfica

## Display

```text
font-size: 36px
line-height: 44px
weight: 800
```

Uso excepcional.

---

## Page Title / H1

```text
32 / 40
weight 800
```

Em telas menores:

```text
28 / 36
```

---

## Section Title / H2

```text
24 / 32
weight 700
```

---

## Subsection / H3

```text
20 / 28
weight 700
```

---

## Body Large

```text
16 / 24
weight 400 ou 500
```

---

## Body

```text
14 / 20
weight 400 ou 500
```

---

## Label

```text
14 / 20
weight 600
```

---

## Metadata

```text
12 / 16
weight 500 ou 600
```

Metadata deve ser secundária e nunca conter a única representação de informação crítica.

---

# 15. Regra de tamanho mínimo de texto

Não usar texto funcional abaixo de:

```text
12px
```

Não usar labels de ação abaixo de:

```text
14px
```

O antigo padrão de 11px para headings auxiliares deve ser removido.

---

# 16. Comprimento de linha

Para texto corrido:

```text
máximo recomendado: 65–75 caracteres
```

Descrições e help text não devem atravessar toda a largura da tela em desktop.

---

# 17. Espaçamento

Escala baseada em 4px:

```text
space.0   0
space.1   4px
space.2   8px
space.3   12px
space.4   16px
space.5   20px
space.6   24px
space.8   32px
space.10  40px
space.12  48px
space.16  64px
```

Novos espaçamentos devem utilizar essa escala.

Evitar:

```text
13px
17px
23px
```

sem justificativa explícita.

---

# 18. Densidade

O produto deve ser informacionalmente eficiente sem parecer apertado.

## Desktop

Tabelas podem ser relativamente densas.

## Mobile

Controles e linhas precisam de maior separação.

A densidade não deve reduzir:

- legibilidade;
- target size;
- hierarquia;
- clareza.

---

# 19. Radius

Sistema oficial:

```text
radius.sm    8px
radius.md    12px
radius.lg    16px
radius.xl    20px
radius.full  9999px
```

Uso:

```text
inputs        sm/md
buttons       md
cards         lg
dialogs       xl
badges        full
avatars       full
pills         full
```

Não usar `radius.full` como padrão universal para botões.

O protótipo usa pills em excesso; o sistema final deve reservar essa forma para elementos que semanticamente se comportam como pills.

---

# 20. Shadows

Elevação deve ser rara.

```text
shadow.none
```

Padrão.

```text
shadow.sm
0 1px 2px rgba(20,18,31,.06)
```

Para pequenos overlays/elevação discreta.

```text
shadow.md
0 8px 24px rgba(20,18,31,.08)
```

Para:

- dialog;
- popover;
- dropdown;
- floating surfaces.

Não usar shadows pesadas em todos os cards.

---

# 21. Motion

Movimento deve explicar mudança de estado.

Tokens:

```text
motion.fast      120ms
motion.normal    180ms
motion.slow      240ms
```

Easing:

```text
ease-out
```

para entrada.

```text
ease-in
```

para saída.

Evitar animações superiores a 300ms em interações operacionais normais.

Respeitar:

```text
prefers-reduced-motion
```

Movimento decorativo deve ser eliminado nesse modo.

---

# 22. Iconografia

Adotar uma única família visual.

Características:

```text
outline
stroke ~1.75–2px
round linecap
round linejoin
```

Tamanhos:

```text
16px
20px
24px
```

Evitar misturar:

- filled icons;
- outline icons;
- emojis;
- ilustrações;

para a mesma classe de ação.

---

# 23. Ícones não substituem labels arbitrariamente

Ações frequentes podem ser icon-only quando extremamente convencionais:

```text
fechar
menu
voltar
```

Ações de negócio devem preferir label textual:

```text
Renovar
Arquivar
Convidar membro
Excluir organização
```

Icon-only precisa de nome acessível e tooltip quando necessário.

---

# 24. Layout

## Desktop

Sidebar:

```text
248px
```

pode continuar como referência.

Conteúdo:

```text
max-width recomendado: 1440px
```

Pages operacionais devem aproveitar largura disponível sem criar linhas de texto excessivamente longas.

---

# 25. Responsive breakpoints

Sistema mobile-first.

Referência:

```text
sm    640px
md    768px
lg    1024px
xl    1280px
2xl   1440px
```

Não construir layouts dependentes de breakpoints exatos quando CSS fluido resolver melhor.

---

# 26. Sidebar responsiva

## >= 1024

Sidebar persistente.

## < 1024

Navigation drawer.

Não comprimir a sidebar de 248px sobre uma viewport estreita.

---

# 27. Reflow

Toda tela deve funcionar em:

```text
320 CSS px
```

quando o tipo de conteúdo permitir.

Tabelas bidimensionais podem usar tratamento especial, mas antes avaliar:

- colunas prioritárias;
- stacked rows;
- disclosure;
- responsive cards.

Horizontal scroll é último recurso, não solução padrão.

---

# 28. Content container

Desktop:

```text
padding-inline: 32–48px
```

Tablet:

```text
24px
```

Mobile:

```text
16px
```

Ajustar via tokens/layout primitives.

---

# 29. Components — catálogo obrigatório inicial

O Design System deve possuir pelo menos:

```text
Button
IconButton
Link
Input
Textarea
Select
Combobox
Checkbox
Radio
Switch
DateInput / DatePicker
FormField
FieldError
Badge
StatusBadge
Alert
Toast
Tooltip
Popover
DropdownMenu
Modal/Dialog
Drawer
Tabs
Card
Table
Pagination
Breadcrumb
Sidebar/Nav
Avatar
EmptyState
Skeleton
Spinner
Divider
```

Esses componentes devem ser reutilizados antes de criar variantes locais.

---

# 30. Button

Variantes:

```text
primary
secondary
ghost
danger
```

Não criar cinco níveis diferentes de CTA.

Tamanho padrão:

```text
height: 44px
```

Compacto:

```text
40px
```

Somente quando densidade justificar.

Estado:

```text
default
hover
active
focus-visible
disabled
loading
```

---

# 31. Primary Button

```text
background: brand.default
text: #FFFFFF
```

Hover:

```text
purple.700
```

Pressed:

```text
purple.800
```

Usar no máximo uma ação primária dominante por região lógica.

---

# 32. Secondary Button

Superfície clara.

```text
background: white
border: control/default
text: text.strong
```

Não competir visualmente com primary.

---

# 33. Danger Button

Usado somente para ações destrutivas reais.

Nunca usar red para:

```text
cancelar
voltar
fechar
```

---

# 34. Inputs

Altura normal:

```text
44px
```

Padding horizontal:

```text
12–14px
```

Label sempre visível.

Placeholder não substitui label.

Estados:

```text
default
hover
focus
filled
disabled
read-only
error
```

---

# 35. Focus

Todo elemento interativo deve possuir `focus-visible` evidente.

Padrão recomendado:

```text
2px solid #6D28D9
+
2px offset
```

A implementação pode adaptar a forma para componentes específicos.

WCAG 2.2 AA exige foco visível.

Como padrão interno mais forte, buscar também a clareza definida pelas orientações de Focus Appearance do WCAG 2.2, mesmo sendo um critério AAA.

---

# 36. Target size

WCAG 2.2 AA define mínimo de 24×24 CSS pixels com exceções específicas.

O Design System adota um padrão interno mais confortável:

```text
target mínimo desejado: 40×40px
```

Para controles primários/touch:

```text
44×44px
```

Targets menores devem ser casos excepcionais.

---

# 37. FormField

Todo campo deve ser composto conceitualmente por:

```text
label
control
description?
error?
```

Erro deve:

- explicar o problema;
- apontar correção;
- não depender apenas de vermelho.

---

# 38. StatusBadge

Badges operacionais devem possuir semântica previsível.

Exemplos:

```text
Ativo
Arquivado
Renovado
Vence em breve
Vencido
Pendente
Processando
Erro
```

Badge:

```text
background semantic.surface
text semantic.text
icon/dot opcional
```

Nunca utilizar cores de brand apenas para tornar badges "mais bonitos".

---

# 39. Urgência

Urgência deve obedecer uma hierarquia clara.

Exemplo conceitual:

```text
Vencido
→ danger

Vence muito em breve
→ warning

Normal
→ neutral/success conforme semântica

Sem data / atenção necessária
→ info/neutral
```

A classificação exata pertence ao domínio, não ao Design System.

O Design System apenas define como cada estado semântico é representado.

---

# 40. Cards

Cards devem agrupar informações relacionadas.

Padrão:

```text
background: surface.default
border: border.subtle/default
radius: lg
shadow: none
```

Não transformar cada linha da interface em um card.

---

# 41. Tables

Tabelas são apropriadas para:

- vencimentos;
- documentos;
- membros;
- histórico;
- requisições.

Padrões:

- headers claros;
- alinhamento previsível;
- row hover somente se a linha for interativa;
- ações secundárias agrupadas;
- sorting com estado visível;
- seleção acessível;
- empty state;
- loading state;
- responsive strategy.

---

# 42. Table density

Row height recomendada:

```text
48–56px
```

Desktop.

Não reduzir ao ponto de prejudicar leitura ou targets.

---

# 43. Empty States

Todo conjunto de dados deve possuir estado vazio real.

Estrutura:

```text
título
explicação curta
ação útil
```

Exemplo:

```text
Nenhum vencimento cadastrado

Cadastre o primeiro vencimento para começar a acompanhar prazos.

[Novo vencimento]
```

Evitar ilustração decorativa excessiva.

---

# 44. Loading

Prioridade:

```text
skeleton
```

quando a estrutura da página já é conhecida.

Spinner:

- ações locais;
- espera curta;
- áreas sem layout previsível.

Nunca deixar uma página inteira em branco.

---

# 45. Error States

Erros devem ser localizáveis e acionáveis.

Formato:

```text
o que aconteceu
+
o que o usuário pode fazer
```

Evitar:

```text
Erro 500
Algo deu errado
```

sem ação adicional.

---

# 46. Toast

Toast serve para feedback transitório.

Exemplos:

```text
Vencimento criado
Alterações salvas
Convite enviado
```

Não usar toast como única representação de erro que exige ação.

---

# 47. Dialog

Dialog é adequado para:

- confirmação destrutiva;
- formulário curto;
- decisão bloqueante;
- detalhe pequeno.

Não colocar workflows longos dentro de modal.

---

# 48. Destructive confirmations

Ações graves devem explicitar objeto e consequência.

Exemplo:

```text
Excluir organização "ACME Contabilidade"?

Os dados desta organização entrarão no processo de exclusão.
```

Nunca:

```text
Tem certeza?
```

sozinho.

---

# 49. Navigation

A navegação deve refletir a arquitetura do produto, não os módulos técnicos.

Exemplo futuro plausível:

```text
Visão geral
Vencimentos
Documentos
Sujeitos
Equipe
Configurações
```

A lista definitiva deve seguir a Information Architecture atualizada.

---

# 50. Organization Switcher

Multi-User B2B exige um componente oficial.

Deve mostrar:

```text
Organization atual
```

e permitir:

```text
troca
criação
```

quando autorizado.

Nunca tornar o tenant atual ambíguo.

---

# 51. Organization context

Quando múltiplas Organizations existirem, o contexto deve ficar visualmente reconhecível.

Especialmente em:

- configurações;
- equipe;
- ações destrutivas;
- documentos;
- imports;
- renovações.

Não repetir o nome da empresa em todo card; usar contexto de shell de forma eficiente.

---

# 52. Roles e Permissions

UI pode refletir permissões:

```text
ocultar ação inexistente
desabilitar quando pedagogicamente útil
mostrar motivo quando necessário
```

A UI não é boundary de segurança.

A representação deve ser consistente.

---

# 53. Avatars

Usuários podem usar:

```text
iniciais
```

como fallback.

Não exigir upload de foto.

Avatar é apoio visual, nunca identidade única.

Sempre mostrar nome quando contexto exigir precisão.

---

# 54. Responsável

Responsible/User assignee deve ser apresentado com:

```text
nome
avatar opcional
estado de membership quando relevante
```

Não usar apenas uma cor/bolinha.

---

# 55. Accessibility — baseline obrigatório

O Design System deve tornar simples cumprir:

```text
WCAG 2.2 AA
```

Incluindo:

- contraste;
- keyboard;
- focus;
- semantic HTML;
- labels;
- accessible names;
- target size;
- zoom;
- reflow;
- error identification;
- reduced motion;
- screen reader semantics.

Os critérios de engenharia e testes serão definidos em documento separado posteriormente.

---

# 56. Color blindness

Nenhuma informação deve depender exclusivamente de:

```text
red
green
yellow
```

Status deve incluir texto/ícone.

---

# 57. Disabled State

Disabled deve parecer indisponível, mas continuar identificável.

Não utilizar o mesmo estilo de:

```text
placeholder
informação secundária
```

Disabled não deve ser utilizado para esconder permanentemente por que uma ação não está disponível quando essa informação é importante.

---

# 58. Read-only vs Disabled

São estados diferentes.

```text
read-only
→ informação pode ser lida/copied
```

```text
disabled
→ controle não disponível
```

Representação visual precisa diferenciá-los.

---

# 59. Dark Mode

Não é obrigatório para v1.

Mas tokens devem ser semânticos para permitir tema futuro.

Cor não deve ser codificada diretamente dentro dos componentes.

Evitar nomes como:

```text
whiteBackground
darkPurpleText
```

Preferir:

```text
surface.default
text.strong
```

---

# 60. Token naming

Preferir:

```text
color.text.strong
color.text.muted

color.surface.default
color.surface.subtle

color.border.default
color.border.control

color.action.primary.default
color.action.primary.hover

color.status.danger.text
color.status.danger.surface
```

Não nomear pelo valor:

```text
purpleButton
grayText
```

---

# 61. Primitive vs Semantic

É permitido:

```text
purple.600
```

como primitive.

Componentes não devem consumir primitive diretamente na maioria dos casos.

Preferir:

```text
action.primary.background
```

referenciando:

```text
purple.600
```

---

# 62. CSS/API consumption

O método técnico pode ser:

- CSS variables;
- theme object;
- generated tokens;
- Tailwind theme;
- combinação.

A decisão pertence à implementação.

Mas componentes devem consumir semantic tokens.

---

# 63. Component variants

Nova variante de componente precisa possuir significado reutilizável.

Não criar:

```text
Button variant="expirationPageSpecialPurple"
```

Criar apenas variantes semânticas.

---

# 64. Component composition

Preferir componentes pequenos e composáveis.

Exemplo:

```text
Card
CardHeader
CardContent
CardFooter
```

em vez de:

```text
ExpirationDetailSuperCard
```

quando o padrão puder ser reutilizado.

---

# 65. Patterns

Além de componentes, o sistema deve reconhecer patterns recorrentes:

```text
PageHeader
FilterBar
DataTable
DetailSummary
FormSection
DangerZone
SettingsSection
EntityPicker
AssigneePicker
OrganizationSwitcher
PermissionGate
EmptyState
ConfirmationFlow
```

Patterns podem compor componentes sem virar primitives globais.

---

# 66. Page Header

Estrutura:

```text
eyebrow/breadcrumb opcional
title
description opcional
primary action
secondary actions
```

Não criar headers visualmente diferentes em cada página.

---

# 67. Form Section

Formulários maiores devem ser divididos por significado.

Exemplo:

```text
Informações básicas
Validade
Responsabilidade
Documentos
Notificações
```

Não criar um formulário contínuo de dezenas de campos sem estrutura.

---

# 68. Danger Zone

Configurações destrutivas devem ficar visualmente separadas.

Exemplo:

```text
Excluir organização
```

Nunca misturar visualmente com preferências comuns.

---

# 69. Copy / tom

O texto de UI deve ser:

```text
direto
calmo
natural
específico
```

Evitar:

```text
Oops!
Uhu!
Super!
Incrível!
```

Também evitar tom burocrático excessivo.

---

# 70. Datas

Datas devem priorizar compreensão local.

Português brasileiro:

```text
29/08/2026
```

Quando contexto temporal for importante:

```text
29/08/2026 · vence em 3 dias
```

Não depender apenas de "em 3 dias", pois isso envelhece.

---

# 71. Números e quantidade

Use formatação local.

```text
1 vencimento
2 vencimentos
```

Evitar strings rígidas quando pluralização for necessária.

---

# 72. Responsividade de ações

Desktop:

```text
ações podem ficar inline
```

Mobile:

```text
primary action full-width quando apropriado
secondary actions empilhadas
menus para ações raras
```

---

# 73. Mobile navigation

A sidebar desktop não deve simplesmente encolher.

Usar:

```text
header
+
navigation drawer
```

ou padrão equivalente.

Organization switcher precisa continuar acessível.

---

# 74. Tabelas mobile

Prioridade:

```text
nome
estado
data
responsável quando crítico
```

Metadados menos importantes podem ir para disclosure.

Não tentar reproduzir oito colunas em 320px.

---

# 75. Breakpoint-independent design

Sempre que possível, usar:

```text
flex-wrap
minmax()
grid auto-fit
container-aware layout
```

antes de adicionar dezenas de media queries.

---

# 76. Z-index

Definir escala pequena e explícita:

```text
base
sticky
dropdown
overlay
modal
toast
```

Não usar:

```text
99999
1000000
```

em componentes normais.

---

# 77. Layering

Dropdown deve aparecer acima de conteúdo.

Modal acima de dropdown da página.

Toast acima do shell.

Tooltip acima do componente.

A implementação deve centralizar essa escala.

---

# 78. Status visual de carregamento assíncrono

Para processos como:

```text
upload
malware scan
OCR
extração
import
```

usar estados explícitos.

Exemplo:

```text
Enviando
Verificando segurança
Processando
Concluído
Falhou
```

Não mostrar `CLEAN` ou estados técnicos diretamente ao usuário quando houver linguagem de produto melhor.

---

# 79. Epistemic Integrity na UI

A interface não pode afirmar mais do que o sistema sabe.

Exemplo:

```text
Arquivo verificado quanto a malware
```

não significa:

```text
Documento aprovado
```

Visualmente, estados técnicos e de negócio devem permanecer distintos.

---

# 80. AI/OCR confidence

Se campos forem extraídos automaticamente:

```text
valor extraído
+
estado de revisão
+
origem
```

quando necessário.

Não representar baixa confiança apenas por cor.

---

# 81. Design System documentation

Cada componente oficial deve documentar:

```text
purpose
anatomy
variants
states
sizes
accessibility notes
do
don't
examples
```

Não é necessário escrever documentação gigantesca para primitives triviais.

---

# 82. Fonte única visual

O frontend não deve possuir simultaneamente:

```text
tokens oficiais
+
cores duplicadas em CSS
+
valores duplicados em componentes
+
tema paralelo
```

A implementação deve escolher uma fonte de verdade.

---

# 83. Proibição de valores arbitrários

Depois da migração:

novos componentes não devem introduzir diretamente:

```text
hex colors
font-size
border-radius
shadow
spacing
```

quando já existir token correspondente.

Exceções precisam ter justificativa real.

---

# 84. Migração do protótipo atual

A nova implementação deve preservar:

```text
Plus Jakarta Sans
purple identity
light shell
navigation pattern
information hierarchy
operational calm
```

e alterar:

```text
hardcoded styles
low-contrast tertiary text
11px functional text
excessive pill radius
fixed desktop-only behavior
missing focus design
incomplete state model
```

---

# 85. Design decisions explicitamente aprovadas

## Manter

```text
Plus Jakarta Sans
brand purple
light-first UI
white cards
subtle borders
minimal shadows
sidebar navigation
status colors
clean operational tables
```

## Alterar

```text
text contrast
tiny labels
responsive behavior
focus treatment
token architecture
component state definitions
overuse of full-pill radius
```

---

# 86. Dark mode decision

Status:

```text
SUPPORTED BY ARCHITECTURE
NOT REQUIRED FOR INITIAL IMPLEMENTATION
```

Tokens precisam permitir.

Não implementar dark mode apenas para demonstrar flexibilidade.

---

# 87. Internationalization readiness

Design deve suportar strings maiores.

Não criar botões com width fixo baseado em português.

Labels precisam aceitar expansão.

O produto pode permanecer em PT-BR inicialmente.

---

# 88. Accessibility references

Base normativa principal:

**WCAG 2.2**

https://www.w3.org/TR/WCAG22/

Referência de contraste:

https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html

Referência de target size:

https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html

Referência de focus appearance:

https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance.html

---

# 89. Design Tokens reference

Referência recomendada:

**Design Tokens Community Group — Design Tokens Format Module 2025.10**

https://www.designtokens.org/TR/2025.10/format/

O DTCG não é uma W3C Recommendation, mas sua especificação de tokens está estável e é adequada como referência de interoperabilidade para projetos novos.

---

# 90. Do / Don't geral

## DO

```text
use semantic tokens
preserve strong hierarchy
use white space intentionally
make states explicit
use clear labels
prefer border over shadow
keep critical information visible
design responsive from the start
```

## DON'T

```text
invent colors per screen
use color alone as meaning
hide critical state behind hover
use 11px operational text
turn every action into a pill
use gradients everywhere
create one-off component variants
rely on desktop width
```

---

# 91. Definition of visual conformity

Uma tela é visualmente aderente ao Design System quando:

```text
usa somente tokens aprovados
+
usa componentes oficiais ou patterns justificados
+
possui hierarquia tipográfica correta
+
não cria cores/radius/spacing locais
+
possui todos os estados visuais necessários
+
é responsiva
+
mantém contraste adequado
+
mantém Operational Calm
```

Os **critérios formais de qualidade de engenharia, testes, métricas e gates de frontend serão definidos em documento separado**.

Este documento define a linguagem visual e os contratos de design.

---

# 92. Resultado esperado

A interface final deve parecer uma evolução natural do protótipo atual:

```text
mesma identidade
+
mais consistente
+
mais acessível
+
mais madura
+
mais previsível
+
mais escalável
```

O usuário que conhece o protótipo deve reconhecer imediatamente o produto.

Mas a implementação deve deixar de parecer um conjunto de telas desenhadas individualmente e passar a se comportar como:

> **um sistema visual coerente e reutilizável.**

---

# 93. Diretriz final para a IA engenheira

Ao implementar o frontend:

1. trate este documento como contrato do Design System;
2. preserve a identidade Operational Calm;
3. crie tokens antes de componentes;
4. crie semantic tokens antes de consumir primitives;
5. reutilize componentes antes de criar variantes;
6. não introduza valores visuais arbitrários;
7. WCAG 2.2 AA deve orientar as escolhas;
8. mobile/reflow deve ser considerado desde o primeiro componente;
9. estados de interação devem existir desde a primeira implementação;
10. qualquer desvio relevante deve ser documentado e justificado antes de se tornar novo padrão.

O objetivo não é reproduzir literalmente o HTML do protótipo.

O objetivo é:

> **transformar a linguagem visual aprovada do protótipo em um Design System profissional, consistente e sustentável para o Expiration Tracker.**
