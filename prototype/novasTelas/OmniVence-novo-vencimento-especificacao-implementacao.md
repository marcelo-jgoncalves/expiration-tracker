# OmniVence — Novo vencimento: especificação de implementação

**Status:** especificação da tela aprovada. **Referência visual obrigatória:** `OmniVence-novo-vencimento-prototipo.html`. **Referências de consistência:** protótipos aprovados de Login e Visão geral. **Idioma:** português do Brasil. **Escopo:** página de criação de um vencimento, seus campos, validação, estados e saída. Este documento descreve o comportamento de produção onde o HTML demonstra apenas a aparência e algumas interações.

## 1. Regras de implementação

1. Reproduzir a hierarquia visual do protótipo: shell da aplicação, retorno, título, bloco “O essencial”, bloco “Complementos” e ações finais. Reutilizar os componentes e tokens da Visão geral para sidebar, logo, menu móvel e identidade do usuário. O item lateral ativo é **Vencimentos**.
2. Os três únicos campos obrigatórios nesta tela são **Nome**, **Categoria** e **Data de vencimento**. Todos os complementos são opcionais. Não exigir preenchimento adicional por causa de condicionais escondidas.
3. O protótipo usa opções ilustrativas para Categoria, Periodicidade e Prioridade, um e-mail demonstrativo, links `#` e um aviso que confirma não salvar. Esses itens **não são fontes de verdade** do produto. Carregar opções reais do domínio, identidade autenticada e rotas existentes. Remover os avisos de protótipo.
4. Não implementar um catálogo paralelo de categorias, pessoas ou periodicidades somente para corresponder às opções demonstrativas. Mapear controles à entidade e às regras reais, preservando rótulos e experiência. Quando o modelo atual não comportar um campo exibido, registrar e implementar a adaptação necessária antes de dar a tela por pronta; nunca descartar silenciosamente dados digitados.
5. Não introduzir upload, anexos, IA, templates automáticos, notificações configuráveis nem novo passo de wizard nesta tela. Esses fluxos têm escopo próprio.
6. Logo provisório aprovado até entrega do vetor final; não recriar a marca por CSS ou vetorização automática.

## 2. Rotas, entrada e saída

- A página abre a partir de “Novo vencimento” na Visão geral ou na listagem. Usar a **rota de criação já definida no roteador do repositório**. Não criar rota duplicada só para este protótipo.
- “← Voltar para Vencimentos” e “Cancelar” levam à listagem de vencimentos. Caso a página tenha sido aberta com filtros/busca da listagem, preservar esse estado por mecanismo de navegação seguro quando o produto já o suporta.
- Em criação bem-sucedida, abrir o detalhe do vencimento recém-criado pela rota real e apresentar confirmação não intrusiva `Vencimento criado com sucesso.`. Não deixar o formulário como se o registro não tivesse sido criado.
- Se o usuário não tem permissão para criar, não renderizar formulário editável; mostrar estado de acesso insuficiente e ação de retorno. Verificar permissão também no servidor.
- Usuário sem sessão segue a regra da aplicação para rota protegida; preservar apenas destino interno seguro. Não salvar o formulário em URL.
- Sidebar, identidade e Sair repetem comportamento do shell aprovado da Visão geral. No protótipo os demais destinos são demonstração; em produção cada item usa a rota existente.

## 3. Microcópia aprovada

| Local | Texto |
|---|---|
| Título da página | `Novo vencimento · OmniVence` |
| Retorno | `← Voltar para Vencimentos` |
| Caminho acima do H1 | `VENCIMENTOS / NOVO` |
| H1 | `Novo vencimento` |
| Apoio | `Comece pelo essencial. Você pode completar os demais detalhes agora ou depois.` |
| Seção 1 | `O essencial` |
| Apoio da seção 1 | `O que é, como se classifica e quando vence.` |
| Seção 2 | `Complementos`; selo `OPCIONAL` no desktop |
| Apoio da seção 2 | `Adicione contexto para facilitar o acompanhamento.` |
| Ação principal | `Criar vencimento` |
| Ação secundária | `Cancelar` |
| Alerta de validação local | `Preencha os campos obrigatórios para continuar.` |
| Sucesso | `Vencimento criado com sucesso.` |

Rótulos completos com indicação de obrigatoriedade/opcionalidade ficam sempre visíveis; placeholder não substitui label. Preservar capitalização e acentos dos rótulos abaixo.

## 4. Campos e regras

| Ordem | Campo | Obrigação | Controle, apresentação e regra |
|---|---|---|---|
| 1 | Nome | Obrigatório | Texto de linha única; placeholder `Ex.: Licença Ambiental — Unidade Norte`. Aparar espaços nas pontas; recusar resultado vazio. Preservar caixa e acentos. Limite de comprimento e duplicidade seguem o contrato real; se o backend exigir limite, mostrar `maxlength` coerente e erro claro. |
| 2 | Categoria | Obrigatório | Seletor com opção inicial `Selecione uma categoria`. Carregar categorias válidas e autorizadas da organização; enviar **ID canônico**, não texto exibido. Se não houver nenhuma, mostrar estado específico com orientação para configurar a categoria e impedir envio. Não persistir categorias ilustrativas do HTML. |
| 3 | Data de vencimento | Obrigatório | Entrada de data com apresentação local `dd/MM/aaaa`; converter para data civil `YYYY-MM-DD` no contrato. Validar existência real do dia, incluindo ano bissexto. **Datas passadas são permitidas** para registro de pendências já vencidas. Não converter meia-noite local para instante UTC. |
| 4 | Descrição | Opcional | Área de texto com placeholder `Informações importantes, próximos passos ou observações para a equipe.`; preservar quebras de linha; texto vazio vira ausência de valor, não string de espaços. |
| 5 | Emissor | Opcional | Texto de linha única; placeholder `Ex.: Secretaria de Meio Ambiente`. |
| 6 | Número | Opcional | Texto de linha única; placeholder `Número ou referência do documento`. Tratar como texto para preservar letras e zeros iniciais. |
| 7 | Periodicidade | Opcional | Seletor com `Selecione, se aplicável`; opções provenientes do domínio. Não assumir que selecionar uma periodicidade cria automaticamente novas ocorrências, lembretes ou renovações: seguir a semântica do produto e deixar o efeito claro se houver automação existente. |
| 8 | Data de emissão | Opcional | Data civil com apresentação local; vazia vira ausência de valor. Se informada, validar dia existente. Se o domínio exige emissão não posterior ao vencimento, aplicar a mesma regra no cliente e servidor e explicar o erro; não impor uma regra nova apenas na UI. |
| 9 | Responsável | Opcional | Usar seleção de membro/identidade autorizada, com nome e busca, se o domínio representar responsável como usuário. Se o domínio aceitar texto livre, usar entrada textual. O placeholder demonstrativo `Nome ou e-mail do responsável` não autoriza criar vínculos com usuário a partir de texto ambíguo. |
| 10 | Prioridade | Opcional | Seletor com `Selecione, se aplicável`; usar valores canônicos existentes. Não confundir prioridade escolhida com urgência calculada pela data: são dimensões distintas. |
| 11 | Tags | Opcional | Entrada de texto com placeholder `Ex.: financeiro, contrato` e ajuda `Separe por vírgulas para organizar e encontrar depois.` Separar por vírgulas, aparar cada tag, ignorar itens vazios; normalização de duplicatas, tamanho e quantidade segue o contrato do domínio e deve ser exposta por erro claro. |

A ausência dos opcionais deve ser representada conforme a API real (`undefined`, `null` ou omissão), sem gravar textos de placeholder. Não transformar seletor opcional vazio em opção “Não se repete” por padrão. Ao voltar da API com erro por campo, mapear o erro ao controle correspondente sem apagar os demais valores.

### Dependência de dados reais

O protótipo lista `Licença`, `Alvará`, `Certidão`, `Certificado`, `Contrato`, `Seguro` e `Outro`; `Não se repete`, `Mensal`, `Trimestral`, `Semestral`, `Anual`, `Bienal`; `Baixa`, `Média`, `Alta`, `Crítica`. **Essas listas não foram validadas contra o repositório nem aprovadas como regras de negócio.** A implementação deve obter ou mapear as opções reais e manter a interface visual. Se um campo tem significado ou valores diferentes no domínio, usar os valores reais e documentar a diferença no PR de implementação.

## 5. Layout e estilo

### Desktop, acima de 900 px

- Shell compartilhado da Visão geral: sidebar fixa de 256 px, fundo branco, borda direita `#E8E4F1`, logo e navegação idênticos. Área principal sobre `#F8F7FC`, largura máxima 1450 px, padding superior 36 px, lateral `clamp(24px,4vw,72px)`, inferior 80 px.
- Link de retorno de 12 px/700 acima do título, separado por aproximadamente 19 px. Caminho superior em 10 px/800 com tracking `.13em`. H1 `clamp(27px,2.5vw,36px)`, peso 700, tracking `-.05em`; apoio 13 px, line-height 1.65. Margem inferior do bloco de cabeçalho 27 px.
- Cada seção é um card branco com borda 1 px `#E8E4F1`, raio 16 px, sombra muito sutil, padding superior/lateral de 28/31 px, margem inferior 18 px. Cabeçalho interno com ícone lilás de 36 × 36 px, título 17 px e descrição 11 px; margem até os controles 25 px.
- Campos em grade de duas colunas iguais, distância horizontal 20 px, vertical 19 px. Data de vencimento ocupa a primeira coluna na segunda linha, deixando a segunda vazia conforme o protótipo. Descrição e Tags ocupam as duas colunas. Complementos seguem pares Emissor/Número, Periodicidade/Data de emissão, Responsável/Prioridade.
- Labels 12 px/700, separação de 9 px. Inputs e selects 49 px de altura, fundo branco, borda 1 px `#D7D2E3`, raio 10 px, padding horizontal 14 px, texto 12 px. Textarea com altura inicial 96 px e redimensionamento vertical. Texto de ajuda 10 px. Ações no rodapé do formulário, margem superior 24 px; botão principal 47 px de altura e secundário textual.
- O conteúdo completo rola na página; **não** prender as ações a um footer flutuante nem cobrir campos.

### Até 900 px inclusive

- Sidebar torna-se drawer de 256 px acionado por botão no topo, sobre fundo escurecido. O shell deve reproduzir o menu móvel da Visão geral, inclusive Esc, gerenciamento de foco e bloqueio de interação com conteúdo atrás.
- Conteúdo com padding 20 px superior, 22 px lateral e 55 px inferior. Cabeçalho móvel mostra botão e nome OmniVence.

### Até 650 px inclusive

- Conteúdo com padding 19 px superior, 16 px lateral, 50 px inferior. H1 29 px. Cards com padding 23 px superior e 19 px lateral. Campos em coluna única e gap 18 px, na mesma ordem de leitura do desktop. Selo `OPCIONAL` pode ser oculto porque todos os labels preservam a indicação.
- Botão principal preenche o espaço disponível e Cancelar permanece visível ao lado. Em viewport estreito ou zoom 200%, reorganizar botões em duas linhas se necessário; não cortar rótulos nem permitir overflow horizontal.

### Tokens e estados visuais

- Plus Jakarta Sans, pesos 400–800, hospedada localmente em produção; fallback `system-ui,sans-serif`.
- Marca: `#4C1D95` para botão primário, `#7C3AED` para interação, `#A78BFA` para foco, `#14121F` texto, `#55507A` apoio, branco para superfície, `#F8F7FC` fundo, `#D7D2E3` borda de campos.
- Hover de input/select/textarea escurece borda a `#A89DC2`; foco tem borda `#7C3AED` e halo `0 0 0 4px #7c3aed22`. Erro de campo usa `#B91C1C`; alerta global em `#FEF2F2`, texto `#991B1B`, borda `#FECACA`. Botão hover `#3B1677`.
- Não substituir cores chapadas do logo por gradientes. Garantir contraste AA e suporte a `prefers-reduced-motion`.

## 6. Fluxo e estados

| Estado | Comportamento |
|---|---|
| Inicial | Campos vazios, sem erros; botão `Criar vencimento` disponível. Carregar categorias e outros catálogos sem mostrar opções inventadas. |
| Catálogos carregando | Desabilitar apenas seletor dependente ou exibir skeleton do campo; manter demais campos editáveis. Falha de catálogo mostra erro e ação de tentar novamente; não trocar por lista fictícia. |
| Tentativa com obrigatórios vazios | Alerta `Preencha os campos obrigatórios para continuar.`; mensagens `Informe o nome do vencimento.`, `Selecione uma categoria.`, `Informe uma data válida.` nos campos pertinentes; foco no primeiro erro na ordem de leitura. |
| Campo com formato inválido | Exibir mensagem específica junto ao campo; preservar os demais valores. Data de emissão inválida recebe seu próprio erro mesmo sendo opcional. |
| Enviando | Desabilitar envio duplicado, mostrar `Criando vencimento…` e estado acessível de progresso; manter valores e permitir leitura. Não limpar formulário antes de confirmação. |
| Criado | Confirmar e navegar ao detalhe do registro retornado. Revalidar dados que alimentam a Visão geral e a listagem. |
| Falha de validação no servidor | Mostrar mensagem geral `Confira os campos indicados e tente novamente.`; associar erros por campo e focar o primeiro. Preservar todos os valores. |
| Falha de rede | `Não foi possível conectar. Verifique sua conexão e tente novamente.`; restaurar botão; preservar valores. |
| Serviço indisponível | `Não foi possível criar o vencimento agora. Tente novamente em alguns instantes.`; preservar valores. |
| Sem autorização | Informar ausência de permissão e impedir novo envio. Não reinterpretar como erro de campo. |
| Conflito/duplicata | Usar mensagem específica do domínio se o serviço confirmar conflito; não bloquear nomes iguais apenas no navegador. |

Ao editar um campo inválido, retirar seu indicador de erro e revalidá-lo em blur ou no próximo envio; a mensagem global deve refletir o estado atual. Focar o resumo de erro quando vier somente erro de servidor sem campo associado. Evitar scroll brusco e deslocamento grande da página.

### Saída com alterações pendentes

- “Cancelar”, “Voltar” e navegação lateral: se algum valor foi modificado em relação ao estado inicial, abrir confirmação acessível com título `Descartar alterações?`, texto `As informações preenchidas serão perdidas.` e ações `Continuar editando` (foco inicial) e `Descartar e sair`. Se nada mudou, navegar imediatamente.
- Navegação do próprio browser/fechamento da aba com alterações: usar proteção de navegação do roteador e `beforeunload` apenas quando houver alterações não salvas; o texto da confirmação nativa do navegador não é controlável.
- Após criação bem-sucedida, desativar proteção de saída antes da navegação. Não guardar rascunho persistente sem requisito próprio.

## 7. Semântica e acessibilidade

- Um `<main>`, um `<h1>`, um `<form>`, títulos de seção H2 e agrupamento lógico com `section aria-labelledby` ou `fieldset/legend`. Cada controle possui `<label for>`; obrigatoriedade também em `required` e estado anunciado. Complementos podem ser deixados vazios sem erro.
- Ordem Tab segue Nome → Categoria → Data de vencimento → Descrição → Emissor → Número → Periodicidade → Data de emissão → Responsável → Prioridade → Tags → Criar vencimento → Cancelar; links de retorno/sidebar seguem a ordem do DOM e não recebem `tabindex` positivo.
- Erros de campo por `aria-describedby` e `aria-invalid=true`; resumo com `role=alert`; status de envio por `aria-live=polite`. Após erro, mover foco conforme §6. Não comunicar erro apenas por cor.
- Date picker acessível por teclado e dispositivos móveis; se um componente customizado for usado, deve permitir digitação/seleção de `dd/MM/aaaa`, correção de data e navegação sem mouse. O formato enviado é separado do formato exibido.
- Alvos de toque principais ≥44 × 44 px; labels visíveis; zoom até 200% e largura de 320 CSS px sem perda de ação ou conteúdo. Menu drawer com foco contido e devolvido ao acionador. Modal de descarte contém foco, fecha com Esc equivalendo a `Continuar editando` e devolve o foco à origem.
- Ícones decorativos sem nome redundante; logo com alt `OmniVence`; indicar Vencimentos como rota atual da barra lateral com `aria-current` no item apropriado.

## 8. Integração com o domínio e segurança

Camada de formulário separada do serviço de persistência. Contrato semântico, mapeado ao modelo real do projeto:

```ts
type CreateDueInput = {
  name: string;
  categoryId: string;
  dueDate: string; // YYYY-MM-DD, data civil
  description?: string;
  issuer?: string;
  documentNumber?: string;
  recurrenceCode?: string;
  issueDate?: string; // YYYY-MM-DD, data civil
  responsibleIdOrText?: string; // conforme o domínio real, nunca ambos implicitamente
  priorityCode?: string;
  tags?: string[];
};
type CreateDueResult = { id: string };
```

- O cliente **não** escolhe livremente `tenantId`, dono, criador ou permissão; o servidor deriva/autentica o escopo da organização ativa. Verificar no servidor categoria, responsável, periodicidade, prioridade, comprimentos, datas e permissões.
- Usar endpoint/serviço de criação já existente; não presumir nome de rota HTTP nem tabela. O resultado deve trazer ID válido para abrir o detalhe. Não realizar duas criações no mesmo envio; considerar token de idempotência se a infraestrutura existente oferecer, especialmente após timeout e retry.
- Não registrar descrição, documento, identificadores pessoais ou outros valores de formulário em telemetria indiscriminada. Usar CSRF/proteção de sessão conforme arquitetura atual. Escape de conteúdo na visualização posterior; não renderizar HTML informado em descrição ou tags.
- Se a API atual ainda não aceita um dos complementos exibidos, estender o contrato ou bloquear a entrega dessa tela até decidir seu tratamento; uma resposta de sucesso não pode ocultar descarte de dados.
- Catálogos e membros vêm do escopo da organização ativa, com estados de carregamento/erro próprios. Se não houver permissão para ver um catálogo opcional, manter a criação possível com esse campo ausente, desde que o contrato permita.

## 9. Critérios de aceite verificáveis

1. Comparação com o protótipo em 1440×900, 1280×800, 900×900, 390×844 e 320×700: mesma hierarquia, espaçamento, cards e ordem, sem rolagem horizontal nem controles cobertos.
2. Shell igual ao da Visão geral; OmniVence substitui Expiration Tracker; Vencimentos ativo; links e logout funcionais, sem `#` demonstrativo ou toast de protótipo.
3. Somente os três obrigatórios impedem envio quando vazios. Nome composto só de espaços é inválido; data válida passada é aceita; datas impossíveis são rejeitadas; opcionais vazios não são persistidos como placeholders.
4. Categorias e demais códigos são obtidos do domínio real; categoria enviada por ID; responsável e periodicidade respeitam seus modelos. Os valores ilustrativos do protótipo não são gravados como catálogo paralelo.
5. Envio único cria exatamente um registro no tenant autorizado, preserva todos os campos fornecidos e abre o detalhe correto. Falha de rede/servidor preserva valores e permite nova tentativa. Autorização também é verificada no servidor.
6. Cancelar/Voltar/menu com formulário alterado oferecem decisão explícita; sem alterações saem diretamente. Sucesso não exibe a confirmação de descarte.
7. Teclado e leitor de tela alcançam todos os controles em ordem, compreendem labels, obrigatoriedade, erros e progresso; modal e menu administram foco. Zoom 200% mantém os botões acessíveis.
8. Testes relevantes cobrem validação de obrigatórios, transformação de datas e tags, mapeamento dos catálogos, submissão única, erros do servidor, proteção contra perda de dados e saída após sucesso. Revisão visual manual completa a aprovação.

## 10. Definição de pronto

A implementação está pronta quando reproduz o protótipo, usa dados e permissões reais, salva todos os campos informados, impede perda acidental de edição e trata todos os estados e critérios acima. Diferenças entre o formulário demonstrativo e o domínio efetivo devem ser registradas e resolvidas durante a integração; **não** tratadas como autorização para inventar regras de negócio.
