# A10 — Rastreamento legado (Legacy Tracked Requirements)

**Versão/data**: 2026-09-10 (autoria original desta sessão, já incorporando a revisão pós-audit
blind Codex — ver `docs/architecture/reviews/screen-spec-audit-2026-09-09/A10-audit-record.md`).

**Autoria**: esta spec nunca foi gerada pelo pacote Claude Design original (lacuna real, ver
`docs/frontend/prototype-screen-specs/README.md`). Escrita do zero nesta sessão, aplicando
diretamente as 5 lições de sistema já convergidas no audit das outras 24 telas
(`docs/architecture/reviews/screen-spec-audit-2026-09-09/system-level-findings.md`, SLF-01..05) —
não é um rascunho ingênuo seguido de auditoria, é autoria já na barra pós-revisão. Auditada em
seguida com o mesmo instrumento (`docs/frontend/screen-spec-audit-rubric.md`); ver
`docs/architecture/reviews/screen-spec-audit-2026-09-09/A10-audit-record.md`.

**Fundamentação de domínio (verificada diretamente no código, não apenas no plano)**:
`src/modules/subject/domain/requirement-assignment.ts` — `RequirementAssignment` é um agregado
simples (MISSING/SATISFIED como únicos estados operacionalmente alcançáveis nesta fase do produto;
o enum de tipo também lista REQUESTED/SUBMITTED/UNDER_REVIEW/REJECTED como reserva de compatibilidade
de schema futura, mas `requirement-service.ts` nunca transiciona para eles — o único caminho de
mutação de status é MISSING↔SATISFIED via link/unlink manual de um `ExpirationItem` já existente).
**Achado real de produto que orienta a tese visual desta tela**: criar um `DocumentRequest` (via
`document-request-service.ts#createDocumentRequest`) NUNCA toca o `status` do `RequirementAssignment`
— os dois ciclos de vida são genuinamente independentes. Isso significa que o status MISSING/SATISFIED
é um **snapshot manual congelado**, enquanto solicitações/submissões e o lembrete automático
(chasing) correm por baixo, no seu próprio ritmo, sem nunca atualizar esse snapshot sozinhos. Este é
o fato de domínio mais importante da tela e organiza toda a composição visual abaixo (§Composição
visual).

## Rota e acesso

**Rota:** `/app/:orgId/subjects/:subjectId/tracking`, `/app/:orgId/subjects/:subjectId/tracking/:assignmentId`
**Nav ativo:** "Fornecedores" (tela alcançada a partir do Hub do Fornecedor, A09 — não tem entrada
própria na navegação principal).

## Ações (mapeadas para `authorization.ts`, verificado diretamente no arquivo)

| Ação visível | Capability | Tier |
|---|---|---|
| Ler a lista de vínculos e o detalhe de um vínculo | `requirement:read` | READ_ONLY_ROLES (todos, inclui VIEWER) |
| "Novo vínculo legado" (criar `RequirementAssignment`) | `requirement:assign` | WRITE_ROLES (OWNER/ADMIN/MEMBER) |
| Editar nome/notas do vínculo | `requirement:update` | WRITE_ROLES |
| Vincular/desvincular um `ExpirationItem` (MISSING↔SATISFIED) | `requirement:review` | WRITE_ROLES |
| "Solicitar documento" (emite `DocumentRequest`/link de convidado G01) | `requirement:request-document` | WRITE_ROLES |
| "Revogar solicitação" (mesma capability de update, não uma ação dedicada — confirmado em `document-request-service.ts#revokeDocumentRequest`, que chama `requirement:update`) | `requirement:update` | WRITE_ROLES |
| "Excluir vínculo" | `requirement:delete` | ADMIN_ROLES (OWNER/ADMIN) |

VIEWER: vê a lista completa e o detalhe de cada vínculo, incluindo o histórico de
solicitações/submissões; não vê "Novo vínculo legado", "Solicitar documento", "Editar", "Vincular/
desvincular item" nem "Excluir vínculo" (ocultos, nunca desabilitados sem explicação — regra de
navegação RBAC do plano §2.1). MEMBER vê e usa todas as ações WRITE_ROLES, mas não "Excluir vínculo"
(oculto, ADMIN_ROLES).

## Estrutura

### Lista (`/tracking`)

1. `PageHeader`: `above`="← Voltar para {fornecedor}"; título "Rastreamento legado"; descrição
   "{Fornecedor} · vínculos MISSING/SATISFIED do mecanismo antigo de acompanhamento — ver 'Requisitos
   documentais' para o mecanismo atual." (a segunda oração é deliberada: nomeia a relação com A11 no
   próprio texto da tela, não só na documentação, porque este é exatamente o par de conceitos que o
   plano §2.4 proíbe confundir); ação de cabeçalho (WRITE_ROLES): "Novo vínculo legado" (secondary —
   ação pouco frequente hoje, nunca a ação dominante da tela, ver §Composição visual).
2. `InlineNotice tone="neutral"` fixo, sempre visível, não dispensável: "Este é o mecanismo antigo de
   acompanhamento. Novos requisitos devem ser criados em Requisitos documentais (A11)." — nunca uma
   mensagem de depreciação alarmante (tone `warning`/`danger` seria falso: o mecanismo ainda é
   suportado e usado em produção, apenas não é mais o caminho recomendado para novos vínculos).
3. `DataTable` compacta, uma linha por `RequirementAssignment`, colunas:
   - Vínculo (primary): `requirementName` + `notes` truncada em `CellSecondary` (tooltip com o texto
     completo se truncado).
   - Status: `StatusBadge` — MISSING tone `warning` + ícone `alert-triangle`; SATISFIED tone `neutral`
     + ícone `check`. Nunca tone `critical`/`danger` para MISSING: este vínculo é uma tarefa em aberto
     do mecanismo legado, não uma violação ativa (o vencimento real, se houver, já tem sua própria
     representação de urgência em A05 via o `ExpirationItem` linkado).
   - Item vinculado: nome do `ExpirationItem` (link → A05) + sua data de vencimento em `tabular-nums`,
     ou "Nenhum item vinculado" (texto de atenção, não em branco) quando MISSING.
   - Atividade recente (coluna com maior densidade de informação da tabela, ver §Composição visual):
     resume em uma linha o estado mais recente entre solicitação e submissão associadas — ex.
     "Solicitação aceita para envio · 3 dias atrás" ou "Envio verificando segurança" ou "Nenhuma
     solicitação em aberto" — nunca a contagem bruta de itens, sempre o evento mais recente
     humanamente legível (rationale de V2: a pergunta operacional real de quem olha esta lista é "o
     que aconteceu por último aqui", não "quantos registros existem").
   - Ações: menu de linha (`more-vertical`) com "Ver" (sempre); "Vincular item"/"Desvincular item"
     (WRITE_ROLES, condicional ao status atual — "Vincular" quando MISSING, "Desvincular" quando
     SATISFIED, nunca os dois ao mesmo tempo); "Solicitar documento" (WRITE_ROLES); "Editar"
     (WRITE_ROLES); "Excluir vínculo" (`danger`, ADMIN_ROLES).

### Detalhe do vínculo (`/tracking/:assignmentId`) — layout de timeline, não de formulário

Esta é a decisão de autoria central da tela (V7): o detalhe não é uma ficha de campos, é uma
**linha do tempo de um relacionamento de conformidade em desativação gradual** — o snapshot
MISSING/SATISFIED fica fixo no topo como uma âncora, e abaixo dele os eventos reais (solicitações
emitidas, submissões recebidas, ocorrências de cobrança automática) correm em ordem cronológica
reversa, deliberadamente visualmente separados do snapshot para que a distinção "o status é uma
foto congelada, os eventos abaixo são o que realmente aconteceu depois dela" nunca fique implícita.

1. `PageHeader`: `above`="← Voltar para Rastreamento legado"; título = `requirementName`; ações
   (WRITE_ROLES): "Editar" (secondary), overflow com "Vincular item"/"Desvincular item", "Solicitar
   documento", "Excluir vínculo" (`danger`, ADMIN_ROLES).
2. **Bloco "Snapshot"** (não um card genérico — tratamento visual distinto do resto da timeline,
   fundo `surface.subtle`, sem sombra, borda inferior mais forte que separa visualmente do fluxo de
   eventos abaixo): `StatusBadge` grande + "Última atualização manual: {satisfiedAt ou createdAt}" +
   nota curta "Este status não muda automaticamente quando uma solicitação ou submissão avança — é
   atualizado apenas quando alguém vincula ou desvincula um item de vencimento aqui." (a nota existe
   porque é exatamente o comportamento real verificado no código — `createDocumentRequest` nunca
   escreve nesse campo — e omiti-la seria a interface afirmando implicitamente mais sincronismo do
   que o sistema garante, disciplina epistêmica do design-system.md §79). Se `linkedItemId` existir:
   nome do item + data de vencimento (link → A05); se o item foi arquivado/excluído desde o vínculo:
   "Item vinculado não está mais disponível" em texto de atenção, sem quebrar o snapshot.
3. **Timeline de eventos** (lista vertical, mais recente no topo, cada entrada com ícone por tipo de
   evento + timestamp relativo com data absoluta em tooltip):
   - Entradas de `DocumentRequest`: "Solicitação enviada para {recipientEmail}" com
     `StatusBadge` do status atual (REQUESTED/OPENED/SUBMITTED/COMPLETED/CANCELLED/EXPIRED/REVOKED —
     ver §Estados para o texto de cada um) + link "Copiar link do convidado" enquanto ainda ativo +
     ação "Revogar" inline (WRITE_ROLES, apenas se ativo).
   - Entradas de `DocumentSubmission`: "Arquivo enviado: {fileName}" com seu próprio
     `StatusBadge` (PENDING_UPLOAD/SCANNING/CLEAN/REJECTED/UNSUPPORTED/TIMEOUT — ver §Estados),
     aninhada visualmente sob a solicitação que a originou (indentação, não uma entrada irmã solta) —
     porque no domínio real toda submissão pertence a uma solicitação específica
     (`DocumentSubmission.documentRequestId`), e a timeline deve refletir essa relação, não apenas
     listar os dois tipos lado a lado.
   - Entradas informativas de cobrança automática (`DocumentChasingOccurrence`, exibidas somente
     como informação, nunca editáveis aqui — confirmado no plano): "Lembrete automático agendado para
     {scheduledAt} (tier {T7|T3|Expirado})" quando `SCHEDULED`/`CLAIMED`; "Lembrete automático enviado"
     quando `TRIGGERED`; ocorrências `CANCELLED` somem da timeline (cobrança cancelada não é um evento
     que aconteceu, é um evento que deixou de acontecer — não polui o histórico).
   - Estado vazio da timeline (vínculo criado, nenhuma solicitação emitida ainda): uma única entrada
     neutra "Nenhuma solicitação emitida ainda" em vez de uma seção em branco.

## Composição visual (autoria específica do produto — V7)

- A tabela da lista usa peso visual **por atividade recente, não por status MISSING/SATISFIED
  isoladamente**: um vínculo MISSING com uma solicitação `SUBMITTED` aguardando revisão é ordenado e
  destacado antes de um vínculo MISSING sem nenhuma atividade — a pergunta real de quem abre esta
  tela é "o que precisa da minha atenção agora", e um MISSING parado não é mais urgente que um
  MISSING com trabalho pendente de revisão. Isso é uma mitigação local dentro da mesma classe de
  problema descrita por SLF-01 (grid plano ignorando severidade real), mas aplicada aqui a uma tabela,
  não a um grid de cards.
- O bloco "Snapshot" no detalhe é deliberadamente **estático e visualmente "morto"** (sem badge
  animado, sem indicação de progresso) em contraste direto com a timeline abaixo dele, que é
  deliberadamente **viva** (cada evento novo aparece com uma pequena transição, ver §Motion) — a
  composição em si comunica a tese do produto (mecanismo legado = câmera lenta de um snapshot; o
  trabalho real acontece nos eventos) sem precisar de nenhum texto explicando isso, além da nota
  epistêmica do item 2 acima.
- **Teste contrafactual (rubric V7)**: substituindo "vínculo legado"/"solicitação"/"submissão" por
  "Item"/"Pedido"/"Envio" genéricos, a estrutura ainda comunica algo específico — um estado
  congelado no topo, mais um log de eventos vivos abaixo, explicitamente rotulado como
  dessincronizado do estado congelado — que não é o template genérico de lista+detalhe de qualquer
  admin CRUD. Passa.

## Papéis tipográficos e comportamento com dados longos (V2)

- `requirementName` (linha da tabela / título do detalhe): papel `Label` (14/20, weight 600), nunca
  abaixo disso mesmo em densidade compacta — é o identificador primário do vínculo.
- `notes` (tabela, `CellSecondary`) e a descrição do PageHeader: papel `Body` (14/20, weight 400),
  truncadas em uma linha com reticências + `title`/tooltip com o texto completo — nunca quebradas em
  múltiplas linhas dentro da tabela (quebraria o alinhamento vertical das outras colunas).
- Timestamps (relativo na timeline, absoluto no tooltip; datas de vencimento na coluna "Item
  vinculado"): papel `Metadata` (12/16, weight 500) em `tabular-nums` — nunca a única representação
  de um prazo relevante (a data absoluta sempre existe, no tooltip ou por extenso conforme o espaço).
- `recipientEmail` e `fileName` (timeline): papel `Body`, com `word-break: break-all` acima de ~32
  caracteres em vez de truncar — endereço de e-mail e nome de arquivo cortados no meio (`...`) são
  frequentemente ambíguos ou inúteis para o usuário decidir uma ação; truncar é aceitável apenas na
  coluna estreita da tabela (com tooltip), nunca dentro da timeline expandida do detalhe.
- Nomes de fornecedor longos com CNPJ (herdados de A09, ex. "Conservare Facilities e Serviços Gerais
  ME — CNPJ 14.221.900/0001-55") no `above` do PageHeader: mesma regra de A09, nunca larguras fixas
  calculadas a partir do texto de exemplo mostrado nesta spec.
- Hierarquia entre snapshot e timeline nunca depende só de cor: o bloco Snapshot usa peso tipográfico
  mais forte (`H3`, 20/28, weight 700) no `StatusBadge` grande + label, enquanto cada entrada da
  timeline usa `Body`/`Label` — a diferença de peso tipográfico, não apenas o fundo `surface.subtle`,
  é o que sustenta "isto é uma âncora, aquilo é um fluxo".

## Estados de interação (V4/V5 — além do default do componente)

- **Linha da tabela**: hover = fundo `surface.subtle` + o menu de ações (`more-vertical`) passa de
  invisível para visível (nunca visível por padrão em toda linha — reduziria a leitura da tabela a
  ruído); focus-visible (navegação por teclado) = mesmo tratamento do hover + anel de foco do sistema;
  linha nunca fica "selecionada" (não há seleção múltipla nesta tela).
- **Link "Item vinculado" / "Copiar link do convidado" / links de navegação na timeline**: sublinhado
  aparece apenas no hover/focus (não permanente — reduz ruído visual numa timeline densa), cor
  `brand.text`, nunca a única pista (o cursor pointer e o sublinhado ao hover já diferenciam link de
  texto estático).
- **Botão "Vincular item"/"Desvincular item"/"Solicitar documento"/"Revogar"/"Editar"**: estado
  `loading` (spinner inline + label muda para o gerúndio: "Vinculando…"/"Solicitando…"/
  "Revogando…") com o próprio botão desabilitado durante a chamada — nunca permite um segundo clique
  disparar uma segunda mutação concorrente (mesma disciplina de idempotência de "Gerar agora" em A14).
  Enquanto uma ação está em `loading`, os demais botões da mesma linha/timeline permanecem habilitados
  (uma mutação em voo não trava a tela inteira).
- **Ação oculta por RBAC** (VIEWER, ou ADMIN_ROLES-only para MEMBER): nunca renderizada como
  `disabled` com tooltip explicando RBAC — simplesmente ausente do menu, mesma regra do plano §2.1 já
  aplicada em A09/A11/A14; `disabled` é reservado a pré-condições de dados (ex. "Gerar" indisponível
  por falta de destinatário em outras telas), nunca a falta de permissão.
- **read-only vs disabled**: um vínculo cujo item está arquivado (ver Estados) mostra os campos do
  snapshot como leitura normal (não acinzentados) — a informação continua válida e copiável, apenas a
  ação de "Vincular/Desvincular" fica temporariamente indisponível com o motivo explícito no tooltip,
  nunca escondida silenciosamente.

## Feedback pós-mutação (todas as ações de escrita)

- **Vincular/Desvincular item**: sucesso → `Toast` "Item vinculado" / "Item desvinculado" + o
  `StatusBadge` do snapshot atualiza para MISSING/SATISFIED com a mesma transição de opacidade descrita
  em §Motion; erro (ex. conflito de versão porque outra pessoa editou o vínculo entretanto) →
  `InlineNotice tone="warning"` no bloco Snapshot "Este vínculo foi alterado por outra pessoa. Revise
  os valores atuais." + recarrega o snapshot atual, sem fechar nenhum dialog em voo.
- **Solicitar documento**: sucesso → `Toast` "Solicitação criada" + nova entrada aparece no topo da
  timeline (fade-in, ver Motion); erro → `InlineNotice tone="danger"` dentro do dialog de criação
  (reaproveita o mesmo dialog/campos de A14 — destinatário, prazo opcional), formulário permanece
  preenchido.
- **Revogar solicitação**: sucesso → `Toast` "Solicitação revogada" + o `StatusBadge` daquela entrada
  da timeline muda para REVOKED in-place (nunca remove a entrada — histórico permanece); erro →
  `InlineNotice tone="danger"` inline na própria entrada da timeline (não um toast que desaparece —
  mesma disciplina de A14 para falhas operacionalmente relevantes).
- **Editar (nome/notas)**: sucesso → `Toast` "Vínculo atualizado" + fecha o dialog; erro de validação
  → `InlineNotice tone="danger"` dentro do dialog, campo específico destacado.
- **Excluir vínculo**: sucesso → `Toast` "Vínculo excluído" + retorna à lista (o vínculo some da
  tabela); erro → `InlineNotice tone="danger"` dentro do dialog de confirmação, dialog permanece aberto.

## Prioridade por atividade recente — regra operacional (V1/V3)

Chave de ordenação da lista, do mais prioritário para o menos: (1) vínculos com uma solicitação em
`SUBMITTED` (evidência aguardando decisão humana) primeiro; (2) vínculos MISSING sem solicitação em
andamento; (3) vínculos MISSING com solicitação `REQUESTED`/`OPENED` (aguardando o destinatário, fora
do controle do tenant); (4) vínculos SATISFIED sem pendência. Empate dentro do mesmo grupo: evento mais
recente primeiro (`updatedAt` do vínculo ou da última solicitação/submissão associada, o que for mais
recente). Reordenação em tempo real (novo evento chega via polling) nunca move a linha embaixo do
cursor do usuário no meio de uma leitura — a nova posição só é aplicada no próximo carregamento
completo da lista (refresh manual ou navegação), nunca por um reflow súbito enquanto a tela está sendo
lida ativamente.

## Acessibilidade — região viva

A timeline do detalhe é uma `aria-live="polite"` região quando uma nova entrada chega via
polling/refresh automático (não em toda renderização) — o leitor de tela anuncia apenas o resumo da
nova entrada (ex. "Nova submissão recebida: certidao_regularidade.pdf"), nunca a timeline inteira
sendo relida. Mutações disparadas pelo próprio usuário (ex. após "Solicitar documento") usam o toast
como o mecanismo de anúncio primário (os toasts já são `role="status"` no sistema) — a região viva da
timeline serve apenas para eventos que chegam de fora da ação do próprio usuário.

## Estados

- **Vínculo MISSING sem item vinculado**: célula "Nenhum item vinculado"; ação de linha "Vincular
  item" abre um `Combobox` de `ExpirationItem`s do mesmo Subject ainda não vinculados a nenhum
  vínculo ativo — nunca aceita um id livre (o backend confirma existência via `ExpirationItemLookup`
  antes de aceitar, e a UI reflete essa mesma restrição na busca, nunca "digite o ID").
- **Vínculo SATISFIED com item posteriormente arquivado/excluído**: ver §Detalhe item 2 — nunca
  reverte o `status` sozinho (o backend nunca faz isso automaticamente); mostrado como um alerta
  visual "Item vinculado não está mais disponível — considere revisar este vínculo" com ação
  "Desvincular" sugerida, mas não forçada.
- **Solicitação ativa/expirada/revogada** (`DocumentRequest.status`): `StatusBadge` — REQUESTED/OPENED
  tone `neutral` "Aguardando abertura"/"Aberta pelo destinatário"; SUBMITTED tone `warning`
  "Aguardando revisão"; COMPLETED tone `neutral` + ícone `check` "Concluída"; CANCELLED tone `neutral`
  "Cancelada"; EXPIRED tone `warning` "Expirada"; REVOKED tone `neutral` "Revogada". Nunca "Enviada"
  como confirmação de entrega (mesma disciplina epistêmica de A14 — o sistema confirma emissão do
  link, não recebimento pelo destinatário).
- **Submissão** (`DocumentSubmission.status`): PENDING_UPLOAD "Aguardando envio"; SCANNING
  "Verificando segurança"; CLEAN tone `neutral` + ícone `check` "Recebido"; REJECTED tone `critical`
  "Rejeitado" + motivo se disponível; UNSUPPORTED tone `warning` "Formato não suportado"; TIMEOUT tone
  `warning` "Verificação expirou" — nomes de produto, nunca os literais técnicos do enum expostos
  (design-system.md §78).
- **Vínculo com item arquivado do fornecedor**: se o próprio `TrackedSubject` estiver arquivado
  (mesmo `InlineNotice` de A09), esta tela herda o mesmo aviso fixo abaixo do header.
- **Revogar uma solicitação**: `Dialog` de confirmação nomeando objeto e consequência (design-system
  §48): "Revogar a solicitação enviada para {recipientEmail}? O link do convidado deixará de
  funcionar imediatamente. Submissões já recebidas permanecem." — botão de confirmação `danger`
  (ação irreversível sobre um recurso ativo, distinta da "Cancelar série" reversível de A14).
- **Excluir vínculo**: `Dialog` de confirmação nomeando o vínculo e o fornecedor; nunca "Tem
  certeza?" sozinho; foco inicial no botão Cancelar.
- **Erro ao carregar a lista/detalhe**: `InlineNotice tone="warning"` + "Tentar novamente"; falha
  parcial (ex. timeline não carrega mas o snapshot carregou) nunca esconde o que já carregou.
- **Carregando**: skeleton de tabela (lista) / skeleton do bloco snapshot + placeholders de timeline
  (detalhe) — nunca spinner de página inteira.
- **Vazio — nenhum vínculo legado para este fornecedor**: "Nenhum vínculo legado registrado" +
  "Vínculos legados existem apenas para fornecedores migrados do mecanismo antigo — novos requisitos
  devem ser criados em Requisitos documentais." + ação "Ir para Requisitos documentais" (link → A11
  filtrada) em vez de convidar a criar um vínculo legado novo por padrão (a criação de novos vínculos
  continua tecnicamente possível — ação de cabeçalho — mas o empty state não empurra essa direção,
  reforçando a tese de "mecanismo em desativação gradual" mesmo na ausência de dados).

## Dados de exemplo

```
Fornecedor: Conservare Facilities ME

Vínculo a1 "Certidão de regularidade — modelo antigo"
  Status: MISSING, sem item vinculado
  Timeline: solicitação r1 enviada para financeiro@conservare.com.br (SUBMITTED, aguardando revisão)
            → submissão s1 "certidao_regularidade.pdf" (CLEAN)
            → lembrete automático (chasing) agendado tier T3 para 15/09/2026

Vínculo a2 "Alvará — vínculo migrado 2024"
  Status: SATISFIED, vinculado a "Alvará de Funcionamento" (vence 12/03/2027)
  Timeline: solicitação r2 enviada há 8 meses (COMPLETED)
            nenhum lembrete agendado (satisfeito, chasing não se aplica a vínculos SATISFIED)
```

## Regras de negócio

- O `status` (MISSING/SATISFIED) de um `RequirementAssignment` é alterado apenas por
  vincular/desvincular manualmente um `ExpirationItem` já existente — nunca é recalculado a partir do
  progresso de uma solicitação ou submissão. Uma solicitação `COMPLETED` ou uma submissão `CLEAN` não
  muda o status por si só; alguém do tenant precisa revisar a evidência recebida e então usar
  "Vincular item" para registrar a satisfação.
- `REQUESTED`/`SUBMITTED`/`UNDER_REVIEW`/`REJECTED` existem no enum de status do próprio
  `RequirementAssignment` como compatibilidade de schema futura, mas nenhuma tela ou serviço atual os
  produz — a UI nunca deve exibir um desses quatro valores como status de vínculo (só MISSING/
  SATISFIED são operacionalmente possíveis hoje); se algum dia aparecerem, tratar como bug de dados,
  não como um estado de produto a desenhar.
- Uma submissão pertence sempre a uma solicitação específica (nunca "solta") — a timeline reflete
  essa relação por aninhamento, nunca lista as duas em paralelo sem vínculo visual.
- Cobrança automática (chasing) é somente informativa nesta tela — não existe ação de
  criar/cancelar/reagendar uma ocorrência de chasing diretamente aqui (o plano confirma isso
  explicitamente); a única forma de afetar o cronograma de cobrança é através do ciclo de vida da
  própria solicitação (revogar/cancelar a solicitação cancela as ocorrências de chasing dependentes,
  como efeito colateral do backend, não como uma ação separada na UI).
- Excluir um vínculo é um soft-delete (`deletedAt`) — o histórico de auditoria permanece, mas o
  vínculo desaparece da lista e não pode mais receber novas solicitações.

## Conecta-se com

A09 (origem, "Rastreamento legado" no grid de cards); item vinculado → A05; "Solicitar documento" →
emite um link de convidado G01 (nunca G02 — G01 é especificamente o fluxo de upload legado sem
formulário de requisito, per plano §8); uma submissão recebida permanece só nesta timeline (o
mecanismo legado não tem fila de revisão dedicada equivalente a A13 — revisar aqui significa "olhar
a submissão e decidir vincular o item manualmente", não um item na fila de A13).

## Responsivo

Full parity (per plano). Lista: `DataTable` vira lista de cards empilhados abaixo de 768px — cada
card mostra Vínculo como título, `StatusBadge`, item vinculado (ou "Nenhum item vinculado"),
atividade recente, e ações num menu overflow "Mais ações para {vínculo}" (ícone-only com nome
acessível). Detalhe: o bloco Snapshot permanece fixo no topo em qualquer largura (nunca colapsa para
dentro da timeline); a timeline continua uma lista vertical única, sem transformação em tabela.

## Teclado e foco

Linhas de tabela navegáveis por teclado (`role="row"` com foco programático); Enter na linha focada
abre o detalhe. Ao fechar qualquer `Dialog` (revogar, excluir, vincular/desvincular item), o foco
retorna ao elemento que abriu o dialog, nunca ao topo da página.

## Motion

- Novo evento aparecendo na timeline (após "Solicitar documento" ou uma submissão chegar via
  polling/refresh): fade-in em `motion.normal` (180ms) no topo da lista de eventos, sem deslocar o
  bloco Snapshot acima — reforça a leitura de "a timeline é viva, o snapshot é parado" também no
  comportamento, não só na composição estática.
- Navegação lista→detalhe e entre linhas da tabela: instantânea, sem transição de página (operação
  frequente, mesma decisão de A09/A11 — coreografia atrasaria trabalho repetido).
- Abertura de `Dialog`/`Combobox`: usa o token de motion padrão do componente (sem decisão local
  adicional necessária).
- Respeita `prefers-reduced-motion`: o fade-in de novo evento é substituído por aparição instantânea,
  mantendo a posição e o foco.
