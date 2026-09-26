# Redesenho do fluxo de detalhe de Fornecedor — Proposta Rodada 3 (Claude)

Rodada 2 recebeu **8,5/10** (Codex separou explicitamente: desenho 9,1/10 — já ≥9,0, sem
mudança estrutural pendente — régua de pesquisa E-014 6,0/10). Esta rodada fecha só os 2 pontos
que impediram a convergência: E-014 formal completa e o contrato comportamental compartilhado de
"Nova solicitação". Nenhuma mudança de mecanismo/estrutura em relação à Rodada 2 (o próprio Codex
não pediu nenhuma).

## Pesquisa externa considerada: SIM PARCIAL

**Escopo**: a existência de navegação local persistente (identidade do recurso + seções
relacionadas) para uma página de detalhe de entidade é padrão externo estabelecido — o CONTEÚDO
específico de cada seção (Conformidade/Requisitos/Solicitações deste produto) é interno, não
informado por pesquisa.

**Fontes (consultadas 2026-09-26)**:
1. Nielsen Norman Group, "Local Navigation Is a Valuable Orientation and Wayfinding Aid"
   (`nngroup.com/articles/local-navigation/`) — organização de pesquisa de UX independente,
   metodologia publicada há décadas, não vendor de produto. Confirma: navegação local existe para
   "indicar onde o usuário está e o que mais existe por perto na hierarquia de informação" —
   exatamente o problema nomeado por Marcelo (perder-se depois de entrar em um fornecedor).
2. Nielsen Norman Group, "Breadcrumbs: 11 Design Guidelines" (`nngroup.com/articles/breadcrumbs/`)
   — breadcrumb **complementa**, nunca substitui, navegação local/global (diretriz 1 do próprio
   artigo); usado aqui só como critério negativo (não basta um link "← Voltar", que é o que 2 dos
   4 destinos atuais já têm e ainda assim geram a queixa de Marcelo) — a conclusão de que "Voltar"
   sozinho é insuficiente NESTE fluxo é minha combinação da diretriz com o problema observado,
   não uma proibição universal que a fonte declare por si só.

**Removido nesta rodada (achado do Codex, Rodada 3)**: uma 3ª fonte de "artigos de prática" citada
sem título/URL identificável foi descartada por não ser verificável — as 2 fontes NN/g acima já
sustentam o critério sozinhas, sem precisar de uma fonte não verificável para representatividade
de mercado.

**Sem padrão convergente em um ponto**: as fontes de prática (não as 2 NN/g) frequentemente
chamam esse padrão de "abas" visualmente, mas nenhuma fonte consultada aqui compara diretamente
"abas com `role=tablist`" vs. "links estilizados como abas, roteados" como estruturas TÉCNICAS
distintas — essa distinção é da WAI-ARIA APG (já citada na Rodada 1/2,
`w3.org/WAI/ARIA/apg/patterns/tabs/`, consultada 2026-08-30/2026-09-26), não das fontes de UX de
produto. **Correção do exagero apontado pelo Codex na Rodada 2**: removo a alegação não verificada
de que GitHub/Linear/Stripe especificamente usam `NavLink`/links roteados em vez de tablist — não
tenho fonte verificável para essa alegação de implementação interna de produtos fechados, só para
o PADRÃO de navegação local em si (que as fontes acima sustentam). Meça a arquitetura técnica só
pela distinção WAI-ARIA, nunca por suposição sobre a implementação de terceiros.

## Checklist de critérios pesados (deriva da pesquisa acima, sub-rubrica desta decisão)

| # | Critério | Peso | Atende | Não atende |
|---|---|---|---|---|
| 1 | Identidade do recurso (nome do fornecedor) permanece visível/fixa ao navegar entre seções | 25% | Header do container nunca desmonta ao trocar de seção (mecanismo `<Outlet>`) | Cada seção remonta seu próprio cabeçalho/nome, como hoje |
| 2 | Navegação local nomeia explicitamente "o que mais existe por perto" (NN/g) | 20% | Links/abas visíveis para TODAS as seções irmãs a qualquer momento dentro do fornecedor | Só existe um link de volta para um nível acima (breadcrumb sozinho) |
| 3 | Nenhum destino nomeado leva ao mesmo conteúdo que outro nomeado diferente | 20% | "Requisitos"/"Documentos" nunca são 2 rótulos para a mesma URL | Card duplicado como hoje |
| 4 | Estrutura técnica corresponde à semântica declarada (WAI-ARIA) | 15% | Se apresentado visualmente como abas, ou é `role=tablist` real com modelo de teclado, ou é link comum sem fingir ser tablist | `aria-selected`/`role=tab` sem os handlers de teclado que o padrão exige |
| 5 | Nenhuma seção acrescenta um clique introdutório sem conteúdo (queixa nomeada por Marcelo) | 20% | Entrar no fornecedor já mostra conteúdo de trabalho (Conformidade+Requisitos), não só cards | Conformidade como passo isolado antes de qualquer lista |

**Como a proposta (Rodada 2, mecanismo inalterado) atende**: 1-OK (container persistente), 2-OK
(nav local com todas as seções), 3-OK (Documentos deixa de ser destino duplicado, condicionado ao
link real da evidência), 4-OK (proposta usa links roteados, nunca finge `tablist`), 5-OK
(Conformidade funde como resumo acima de Requisitos, que é a entrada). Pesos são julgamento do
projeto sobre qual parte do problema de Marcelo cada critério fecha — não derivados
numericamente da NN/g, que fundamenta a EXISTÊNCIA do critério, não o peso exato.
**Nota da régua**: registrando minha própria nota primeiro, nota cega — 9,2/10 (não arredondado).
Codex avalia a régua nesta mesma rodada antes de reavaliar o design contra ela.

## Fechamento do achado "Nova solicitação" (contrato comportamental completo, não só visual)

Aceito a correção do Codex por completo: `RequirementDetail.tsx` passa a adotar o MESMO contrato
que `SubjectRequests.tsx:373-408` já implementa, não só o componente `RadioGroup` visual:
- Estado inicial `deliveryMode = "DEFAULT"` (nunca pré-seleciona `EMAIL`).
- Envia `initialInviteDelivery: deliveryMode` na mutação (hoje não envia override nenhum).
- Exige e-mail no cliente só quando `deliveryMode === "EMAIL"` (espelha a validação client-side
  que já existe em `SubjectRequests.tsx:391`).
- Omite `recipientEmail` do payload quando vazio (`...(email.trim() ? {...} : {})`), nunca envia
  string vazia.
- Erros do servidor aparecem via `FormErrorSummary`/mensagem devolvida, nunca uma promessa fixa de
  "e-mail será enviado" independente do resultado real (a `InlineNotice` que hoje só existe em
  `CreateAvulsoDialog` sobre "aceito pelo provedor, não recebido" precisa aparecer aqui também).
Implementação concreta: extrair o formulário de "Nova solicitação avulsa" de
`SubjectRequests.tsx` (`CreateAvulsoDialog`, hoje só usado ali) para um componente compartilhado
que ambas as entradas (`RequirementDetail` e a seção de Solicitações) montam, em vez de duas
implementações divergentes do mesmo fluxo — fecha o achado por construção, não por paridade
mantida manualmente entre dois arquivos.

## Ressalva mantida (achado da Rodada 1/2, não removida)

Requisitos com evidência vinculada **não constituem** uma coleção completa de documentos do
fornecedor — a fusão de "Documentos" em "Requisitos" cobre só o que já está vinculado a um
requisito. Uma Coleção de Documentos tenant-wide/por-fornecedor real (A12 collection) continua
sendo questão de produto em aberto, registrada como tal, não fingida como resolvida por esta
fatia.
