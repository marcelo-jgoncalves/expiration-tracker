# A17 — Exportar dossiê do fornecedor

**Rota:** `/app/:orgId/subjects/:subjectId/dossier`
**Acesso:** `docarchive:dossier-export` — **restrito a OWNER e ADMIN exclusivamente, sem exceção de responsável/assignee** (mesmo o MEMBER/VIEWER que é o responsável direto pelo fornecedor não pode exportar — regra deliberada, D-205; confirmado correto na auditoria 2026-09-10, não alterado nesta revisão). MEMBER/VIEWER que naveguem para esta rota veem um `EmptyState` explicativo — "Exportar dossiê é restrito a OWNER e ADMIN desta organização." — nunca a tela do wizard com botões desabilitados.
**Nav ativo:** "Fornecedores"
**Layout:** coluna única, max-width `var(--layout-reading-max)`. Wizard de 3 estágios num único `Panel`.

**Revisão 2026-09-10 (screen-spec-audit-2026-09-09, batch 4/6)**: reescrita após NOT PASS
(Functional 47.8/100, Visual 50.0/100, Consolidado 48.7/100). Ver
`docs/architecture/reviews/screen-spec-audit-2026-09-09/A17-audit-record.md`. A regra de RBAC
central (sem exceção de assignee) já estava correta e permanece inalterada; as correções desta
revisão são de lifecycle (scopeHash obsoleto, dois relógios de expiração distintos) e de estados
faltantes.

## Estrutura

1. `PageHeader`: `above`="← Voltar para {fornecedor}"; título "Exportar dossiê"; descrição "{Fornecedor} · pacote de conformidade em PDF ou Excel."
2. **Painel único, conteúdo por estágio** (`state.stage`):

### Estágio `preview`
- Bloco "Escopo (congelado nesta pré-visualização)": lista rótulo/valor —
  - Requisitos incluídos: "{n} de {total}"
  - Documentos incluídos: "{n} versão(ões) aceita(s)"
  - Hash do escopo: identificador técnico (ex. "scope_8f21ac") — colapsável/`Tooltip` explicando: "Identifica exatamente esta versão do escopo. Se os dados mudarem antes de você confirmar, você será avisado e poderá atualizar a pré-visualização" (linguagem correta — sem "garante", ver estado `escopo desatualizado` abaixo).
  - Requisitos/documentos longos (>8 itens): seção colapsável ("Ver todos os {n} requisitos") em vez de uma lista sempre expandida — evita rolagem excessiva em dossiês grandes, nunca uma view desktop-only para isso.
- Bloco "Formato": toggle 2 botões PDF / Excel (o selecionado fica `variant="primary"`, o outro `secondary`).
- `InlineNotice tone="neutral"`: "Apenas OWNER e ADMIN podem exportar o dossiê, mesmo que sejam o responsável direto pelo fornecedor." (reforça a regra de RBAC na própria tela).
- Botão "Confirmar e gerar" (primary) → verifica se o escopo ainda é válido (ver estado abaixo) e, se sim, avança para `generating`.

**Estado — escopo desatualizado (`stale scopeHash`)**: se algum documento/requisito do Subject mudar
entre a pré-visualização ser carregada e "Confirmar e gerar" ser clicado (ex. um novo documento foi
aceito nesse intervalo), o clique é interceptado: `InlineNotice tone="warning"` "O escopo mudou desde
que esta pré-visualização foi carregada." + botão "Atualizar pré-visualização" (recarrega o bloco de
escopo com um novo hash) substitui temporariamente "Confirmar e gerar" — a tela nunca gera
silenciosamente um dossiê com um escopo que já não corresponde ao estado atual sem avisar primeiro.

### Estágio `generating`
- `AsyncFeedback state="PENDING"` mensagem "Gerando dossiê…" (spinner/loading).
- Polling a cada 3s enquanto o run está em progresso; após 45s sem conclusão, mostra "Isso está
  demorando mais que o esperado" com a opção "Voltar mais tarde" — o processamento continua no
  backend e o resultado fica disponível em `/subjects/:subjectId/dossier` na próxima visita (o run
  não é perdido ao sair da tela).
- **Falha de geração**: `InlineNotice tone="danger"` com o motivo quando disponível (ex. limite de
  tamanho do pacote) + botão "Tentar novamente" (gera um novo run sobre o mesmo escopo congelado,
  sem exigir nova pré-visualização se o escopo ainda for válido).
- (No protótipo há um botão de simulação para avançar manualmente; a implementação real transiciona
  sozinha via polling — a spec não representa esse botão de simulação como parte do fluxo real.)

### Estágio `ready`
- `InlineNotice tone="success"`: "Dossiê gerado."
- Bloco de validade, com os **dois relógios de expiração tratados como estados distintos** (nunca
  fundidos numa única frase de "válido por 30 dias"):
  - **Validade do export em si (30 dias, D-235)**: "Este dossiê fica disponível para download até
    {data, = geração + 30 dias}." Passado esse prazo, o run expira de verdade e não pode mais ser
    baixado nem ter sua URL regenerada — a tela mostra "Este dossiê expirou. Gere um novo." com botão
    "Gerar novo dossiê" (volta a `preview`, verificando o escopo novamente).
  - **URL de download presignada (vida curta, dentro da janela dos 30 dias acima)**: se a URL
    específica expirar antes do prazo dos 30 dias, o botão "Baixar dossiê" detecta a falha do link
    (erro do storage) e mostra "Link expirado — gerar novo link" (regenera apenas a URL, sem
    reprocessar o dossiê, já que o run ainda existe e ainda está dentro da janela de 30 dias).
- Botão "Baixar dossiê" (primary).

## Responsivo

Full parity (per plano). Blocos de "Escopo"/"Formato" empilham verticalmente sem alteração de
conteúdo abaixo de 768px (já são blocos de coluna única). Seções colapsáveis de requisitos/documentos
longos funcionam de forma idêntica em mobile.

## Teclado e foco

Ao avançar de estágio (`preview` → `generating` → `ready`), o foco move para o título/mensagem do
novo estágio e é anunciado via `aria-live="polite"` — quem usa leitor de tela não precisa perceber a
transição apenas visualmente pelo spinner. Toggle de formato (PDF/Excel) é um `radiogroup` acessível
por teclado, não dois botões independentes sem relação semântica.

## Motion

Troca de estágio usa `motion.normal` fade cruzado. O spinner de `generating` usa a animação de
loading padrão do design system (contínua, não decorativa). `prefers-reduced-motion`: troca de
estágio é instantânea; o indicador de progresso passa de spinner giratório para uma barra estática
com o texto "Gerando…" atualizado por polling, sem rotação contínua.

## Regras de negócio

- O "escopo" (quais requisitos/documentos entram) é **congelado no momento da pré-visualização** via
  hash. Se os dados mudarem depois de a confirmação já ter sido enviada com sucesso, o dossiê gerado
  reflete o escopo congelado no momento da confirmação, não o estado atual — mas se a mudança ocorrer
  **antes** da confirmação (enquanto a pré-visualização ainda está na tela), o usuário é avisado e
  precisa atualizar a pré-visualização antes de prosseguir (ver estado `escopo desatualizado` acima).
  A versão anterior desta spec afirmava genericamente "o dossiê final ainda reflete o que foi
  mostrado" sem distinguir os dois momentos — corrigido nesta revisão.
- O export (run) expira 30 dias após a geração (D-235) — depois disso não pode mais ser baixado nem
  ter uma nova URL gerada; é preciso gerar um dossiê novo.
- A URL de download presignada é um artefato de vida mais curta que o export em si — pode expirar
  antes dos 30 dias e ser regenerada sem reprocessar o dossiê, desde que o export ainda esteja dentro
  da janela de validade.
- Formatos suportados: PDF, Excel (XLSX).

## Conecta-se com

A09 (ambos os sentidos).
