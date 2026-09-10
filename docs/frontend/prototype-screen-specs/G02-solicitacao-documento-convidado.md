# G02 — Solicitação de documento (convidado)

**Rota:** `/document-archive/guest/document-requests/:token`
**Acesso:** público, sem login, via link de uso único + sessão de convidado (CSRF). Validado
**apenas** por credencial opaca + sessão — nunca por `Role` ou qualquer conceito de
Organization/Membership. Esta tela é estruturalmente separada do app autenticado: **sem AppShell,
sem nav de Organization, sem lógica baseada em papel em nenhum ponto**.
**Layout:** sem AppShell. Fundo levemente acinzentado. Card único centralizado (max-width 520px). Wizard de 3 etapas + tela final.

## Estrutura

1. Wordmark "Expiration Tracker".
2. **Badges de etapa** (fora do card, semântica `<ol>` com `aria-current="step"` na etapa ativa): "1. Tipo de documento", "2. Arquivo", "3. Revisar e enviar" — etapa atual destacada; ao trocar de etapa, o foco move-se para o H1 do card (título da nova etapa), anunciado via `aria-live="polite"`.
3. **Card**: título H1 = nome da etapa atual (ou "Evidência enviada" na tela final, ou "Este link não está disponível" no estado `unavailable`); descrição fixa: "{Fornecedor} solicitou evidência para o requisito: **{Requisito}**." (omitida no estado `unavailable`); corpo por etapa (`state.step`):

### Estado `unavailable` (obrigatório — ver "Segurança: colapso anti-enumeração" abaixo)

Substitui todo o card (badges de etapa ocultos): `EmptyState` com ícone neutro, título "Este link não
está disponível", descrição "O link pode ter expirado, sido revogado, já utilizado, ou não existir
mais. Solicite um novo link a quem pediu a evidência." Sem botão de ação.

### Etapa 1 — Tipo de documento
- `<select>` obrigatório "Tipo de documento *" com opções (ex. CND Federal, CND Estadual, CNDT).
  - **Carregando opções**: select desabilitado com placeholder "Carregando tipos disponíveis…".
  - **Falha ao carregar opções**: `InlineNotice tone="danger"` "Não foi possível carregar os tipos de documento aceitos." + botão "Tentar novamente".
- Se nenhum selecionado: `InlineNotice tone="neutral"` "Campo obrigatório — não é possível avançar sem selecionar um tipo."
- Botão "Continuar" (primary, desabilitado até selecionar).

### Etapa 2 — Arquivo
- Dropzone tracejada (ícone `upload`, "Arraste um arquivo ou" + botão "Selecionar arquivo" secondary sm, nota "PDF, JPG ou PNG · até 10 MB"); mesma alternativa não-drag-and-drop de G01 (label associado a `<input type="file">` nativo, focável e ativável por teclado/toque).
- Botões: "Voltar" (`ghost`) → etapa 1; "Continuar" (primary, **desabilitado até haver arquivo selecionado** — mesma disciplina da Etapa 1) → etapa 3.
- **Erro de arquivo** (inválido, tamanho excedido, malware/tipo rejeitado): `InlineNotice tone="danger"` com mensagem específica ao motivo (genérica quanto ao mecanismo de verificação); permanece na Etapa 2, arquivo rejeitado é descartado.

### Etapa 3 — Revisar e enviar
- Resumo rótulo/valor: "Tipo de documento" (label legível escolhido), "Arquivo" (nome do arquivo enviado).
- **O tipo selecionado foi descontinuado/removido entre a seleção e o envio**: `InlineNotice tone="danger"` "O tipo de documento selecionado não está mais disponível. Volte e escolha outro tipo." + botão "Voltar" (leva à Etapa 1, tipo indisponível removido da lista).
- `InlineNotice tone="neutral"`: "Revise antes de enviar. Após o envio, uma pessoa da equipe responsável pode entrar em contato pelos mesmos meios usados para enviar este link, pedindo a correção de um campo específico — mas você não poderá reverter ou reenviar esta submissão por aqui." (envio é definitivo; correção pontual é iniciada pela equipe responsável, por fora deste fluxo — nunca um reenvio livre pelo convidado).
- Botões: "Voltar" (`ghost`) → etapa 2; "Enviar evidência" (primary, desabilitado durante o envio para prevenir duplo submit).
- **Enviando**: `AsyncFeedback state="PENDING"` "Enviando evidência…".
- **Erro ao enviar** (falha de rede, timeout): `InlineNotice tone="danger"` "Não foi possível enviar. Tente novamente." + botão "Tentar novamente", resumo preservado.

### Etapa final — "Evidência enviada"
- `InlineNotice tone="success"`: "Recebemos seu envio. Ele será analisado pela equipe responsável — esta confirmação não significa que o documento foi aprovado."

### Segurança: colapso anti-enumeração (obrigatório)

Credencial inválida, expirada, revogada, não encontrada, sessão de convidado não iniciada/expirada,
e token CSRF inválido são **causas internas distintas que produzem exatamente UM estado externo**:
`unavailable`, descrito acima — mesma cópia, mesmo ícone, mesmo tratamento visual em todos os casos,
sem exceção, idêntico ao estado `unavailable` de G01 (mesmo padrão visual reutilizado nas duas telas
de convidado, não reinventado por tela). A UI nunca deve revelar, por texto, ícone ou aparência,
qual das causas se aplica. Uma tentativa `SEND_UNCERTAIN` de entrega da credencial (do lado do
operador, A14) nunca é revelada ao convidado como fato de um jeito ou de outro — o convidado só vê
`unavailable` ou o wizard funcionando normalmente, nunca um estado intermediário sobre a entrega.

### Reenvio com o mesmo `idempotencyKey`: first-write-wins (D-243/D-244)

Se o convidado reenviar a Etapa 3 com a **mesma** chave de idempotência da requisição (ex. duplo
clique, retry automático do cliente após timeout aparente que na verdade teve sucesso no servidor) e
um `documentTypeId` **diferente** do que foi originalmente aceito, o backend retorna o snapshot
originalmente aceito, **sem revalidar contra o novo tipo**. A UI deve tratar essa resposta como
sucesso normal (mesma tela final "Evidência enviada") — nunca deve mostrar um erro de conflito nem
sugerir que o tipo foi trocado; do ponto de vista do convidado, o envio simplesmente teve sucesso
(o valor efetivamente registrado é o da primeira submissão aceita, não o da tentativa mais recente).

### Movimento

- Transição entre etapas: slide horizontal na direção da navegação (para frente ao avançar, para
  trás ao voltar) em `motion.normal` (180ms); altura do card não colapsa/expande abruptamente
  (altura mínima reservada pelo conteúdo mais alto entre as etapas).
- Foco move-se para o H1 da etapa recém-exibida a cada transição (ver badges de etapa acima).
- Respeita `prefers-reduced-motion`: troca de etapa torna-se instantânea, sem slide.

## Dados de exemplo

```
Fornecedor: Atlas Schindler
Requisito: CND Federal
Opções de tipo: CND Federal (Receita Federal) | CND Estadual | CNDT — Débitos Trabalhistas
```

## Regras de negócio

- Distinto de G01: aqui o convidado **escolhe o tipo de documento** dentre opções compatíveis com o Requisito solicitado (o requisito pode aceitar mais de um tipo de documento como evidência válida).
- `documentTypeId` é um campo **obrigatório** (D-243/D-244) — não existe opção de "tipo não especificado"; a Etapa 1 nunca permite avançar sem uma seleção válida.
- Submissão é definitiva (não pode ser desfeita pelo convidado), mas o processo de revisão humana pode solicitar correções pontuais depois, iniciadas pela equipe responsável por fora deste fluxo — ver Etapa 3 acima para a cópia exata que evita contradizer "não pode reverter".
- Mesmo texto de aviso de G01 sobre não haver confirmação de aprovação via este canal.
- Política de reenvio: ver "Reenvio com o mesmo `idempotencyKey`: first-write-wins" acima — nunca reavalia contra um `documentTypeId` diferente enviado numa segunda tentativa com a mesma chave.
