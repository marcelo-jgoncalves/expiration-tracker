# A15 — Importação em massa (CSV)

**Rota:** `/app/:orgId/imports/new` (assistente), `/app/:orgId/imports/:jobId` (retomar/ver um job existente, inclusive já concluído — rota persistente, não descartada ao sair da tela)
**Acesso:** `import:read` — **todos os papéis, incluindo VIEWER** (acompanhar status de um job é leitura, não escrita); `import:create`/`import:map`/`import:commit` — WRITE_ROLES (OWNER/ADMIN/MEMBER). VIEWER pode abrir `/imports/:jobId` de um job em andamento ou concluído e ver seu progresso/resultado, mas nunca vê os botões "Enviar e continuar"/"Pré-visualizar"/"Confirmar importação" (omitidos, não desabilitados sem explicação) — para VIEWER a tela abre direto no passo em que o job já está, em modo somente-leitura.
**Nav ativo:** "Fornecedores"
**Layout:** coluna única, max-width 1100px. Wizard dentro de um único `Panel`.

**Revisão 2026-09-10 (screen-spec-audit-2026-09-09, batch 4/6)**: reescrita completa após NOT PASS
(Functional 31.5/100, Visual 42.0/100, Consolidado 35.7/100). Ver
`docs/architecture/reviews/screen-spec-audit-2026-09-09/A15-audit-record.md`.

## Estrutura

1. `PageHeader`: título "Importação em massa", descrição "Envie um CSV para criar Fornecedores, Documentos e Requisitos de uma vez." Sem ações.
2. **Badges de etapa** (fora do painel, acima): "1. Enviar arquivo", "2. Processando", "3. Mapear colunas", "4. Pré-visualizar e deduplicar", "5. Confirmar" — etapa atual destacada (borda forte, peso maior). Etapas já concluídas ficam marcadas com um ícone de check, não apenas texto normal — permite voltar visualmente a uma etapa concluída sem perder onde se está.
3. **Painel único, conteúdo muda conforme a etapa** (`state.step`), mais uma rota persistente por job (`/imports/:jobId`) que reabre exatamente na etapa atual do job salvo, com os dados já preenchidos — condição necessária para o requisito de retomada (P0.2).

### Etapa `upload`
- Dropzone tracejada: ícone `upload`, texto "Arraste um arquivo .csv ou", botão "Selecionar arquivo" (secondary, sm), nota "Até 20 MB · até 10.000 linhas".
- Arquivo maior que 20 MB ou formato incompatível (não `.csv`, encoding não reconhecido): rejeitado no cliente antes do upload, `InlineNotice tone="danger"` explicando o motivo específico ("Arquivo maior que 20 MB." / "Formato não reconhecido — envie um arquivo .csv.") — nunca um erro genérico.
- Botão "Enviar e continuar" (primary) → cria o job (`import:create`), navega para `/imports/:jobId`, avança para `processing`.

### Etapa `processing` (assíncrona — `ASYNC_POLLING`)
- `AsyncFeedback state="PENDING"`: "Analisando o arquivo…" com barra de progresso indeterminada (o backend não expõe progresso granular nesta fase) e nota "Isso pode levar alguns segundos para arquivos grandes."
- Polling a cada 2s enquanto `status=PROCESSING`; timeout do lado do cliente em 60s mostra "Isso está demorando mais que o esperado" com botão "Continuar aguardando" / "Voltar mais tarde" (o job persiste — fechar a aba não o cancela).
- Falha de parsing (arquivo corrompido, CSV malformado): `InlineNotice tone="danger"` com o motivo reportado pelo backend + botão "Enviar outro arquivo" → volta a `upload` mantendo o mesmo `jobId` seria incorreto (arquivo é imutável por job) — na verdade cria um novo job.
- Sucesso → avança para `mapping`.

### Etapa `mapping`
- `InlineNotice tone="warning"` se houver coluna obrigatória sem mapeamento (ex. "1 coluna obrigatória sem mapeamento: "Tipo".").
- Grid 3 colunas (nome da coluna do CSV → seta → campo de destino mapeado): mostra mapeamento automático detectado, incluindo colunas não mapeadas marcadas explicitamente (ex. "tipo → Tipo (não mapeado)"). Um mapeamento inválido (dois campos CSV mapeados para o mesmo campo de destino) é sinalizado inline na própria linha do grid, não apenas no aviso agregado do topo.
- Botões: "Voltar" (`ghost`) → recomeça um novo job em `upload` (o mapeamento de um job com arquivo já processado não retrocede ao arquivo); "Pré-visualizar" (primary) → `preview`. "Pré-visualizar" fica desabilitado enquanto houver mapeamento inválido (não apenas ausente).

### Etapa `preview`
- `InlineNotice tone="neutral"`: "{n} de {total} linhas válidas. Linhas inválidas não bloqueiam a importação das demais — resultado é reportado por linha." (regra de negócio central: importação é parcial/por-linha, não tudo-ou-nada).
- **Bloco de deduplicação** (etapa própria dentro deste passo, não omitida): "{n} linha(s) correspondem a um Fornecedor já existente (mesmo CNPJ/nome)." — lista as correspondências com opção por linha: "Atualizar existente" / "Criar como novo" (radio por linha, padrão pré-selecionado "Atualizar existente"). Sem isso, uma reimportação acidental duplicaria Subjects.
- `DataTable` "Pré-visualização": colunas Linha (nº), Fornecedor (nome), Resultado (`StatusBadge`: "Válida" neutral / "Duplicata detectada" warning / "Erro: {motivo}" critical).
- Botões: "Voltar" (`ghost`) → `mapping`; "Confirmar importação" (primary) → `commit`.

### Etapa `commit` (assíncrona)
- Ao confirmar, o botão entra em `loading` e a tela mostra `AsyncFeedback state="PENDING"` "Importando…" (commit em lote pode levar mais que uma resposta HTTP síncrona para volumes grandes — mesmo modelo de polling da etapa `processing`).
- Reenviar "Confirmar importação" enquanto um commit já está em voo (duplo clique, ou reabertura da aba) é bloqueado no cliente e idempotente no backend — nunca cria os registros duas vezes; se o job já tiver `status=COMMITTED` ao reabrir `/imports/:jobId`, a tela pula direto para o resultado abaixo em vez de reoferecer "Confirmar".
- `InlineNotice tone="success"`: "Importação concluída: {n} fornecedores criados, {n} documentos criados, {n} requisitos criados, {n} linha(s) ignorada(s) por erro." (as três entidades reais criadas, não apenas fornecedores).
- Falha de commit (parcial ou total): `InlineNotice tone="danger"` distinta da falha de parsing, com o que foi efetivamente criado até a falha (nunca "tudo ou nada" também nesta etapa) + "Tentar novamente" (idempotente sobre o que já foi criado).
- Links: "Ver fornecedores criados" (secondary) → Fornecedores filtrados por este job; "Ver relatório de erros" (`ghost`) → lista completa de linhas com erro, exportável; "Ver resumo deste job mais tarde" (texto com o link persistente `/imports/:jobId`) — o resumo não desaparece ao navegar para outra tela.
- Excedeu quota de armazenamento do tenant durante o commit (documentos do CSV incluem anexos): `InlineNotice tone="danger"` "Cota de armazenamento da organização atingida — {n} linha(s) não puderam anexar documento." com link para a configuração de armazenamento (A19), sem bloquear a criação dos Fornecedores/Requirements que não dependem de anexo.

## Responsivo

Real transformação, não degradação (per plano):
- **Mapping**: o grid de 3 colunas vira pares de campo empilhados (nome da coluna CSV acima, seletor de campo de destino abaixo) — nunca um grid horizontal com scroll.
- **Preview/erros**: a `DataTable` vira uma lista de cards, um por linha, com Linha/Fornecedor/Resultado empilhados e o motivo do erro sempre visível (nunca truncado atrás de hover, que não existe em touch).
- Toda a jornada (upload → processing → mapping → preview/dedupe → commit) é utilizável inteiramente em mobile — não é uma função desktop-only.

## Teclado e foco

Ao avançar de etapa, o foco move para o título da nova etapa (anunciado a leitores de tela via região `aria-live="polite"` nomeando a etapa atual) — nunca permanece no botão da etapa anterior, que já não existe na tela. Radios de dedupe são navegáveis por teclado com o padrão nativo de radio group.

## Motion

Troca de etapa usa `motion.fast` fade cruzado entre o conteúdo do passo anterior e o novo, sem mover o cabeçalho de badges de etapa (que atualiza instantaneamente, sem animação — mudar qual badge está "ativo" é feedback de estado, não uma transição espacial). Barra de progresso indeterminada usa uma animação contínua padrão do design system. `prefers-reduced-motion`: troca de etapa é instantânea, sem fade.

## Dados de exemplo (preview)

```
Linha 2: Conservare Facilities ME — Válida
Linha 3: Atlas Schindler — Duplicata detectada (CNPJ já cadastrado)
Linha 4: Nova Distribuidora Ltda — Erro: tipo ausente
```

## Regras de negócio

- Importação **nunca falha tudo-ou-nada**: cada linha é processada e reportada independentemente; linhas inválidas são puladas, válidas são aplicadas — vale tanto para parsing/preview quanto para o commit final.
- Coluna obrigatória sem mapeamento não impede avançar à pré-visualização, mas é sinalizada (linhas dependentes dessa coluna provavelmente falharão na pré-visualização); um mapeamento inválido (conflito de destino) impede avançar.
- Deduplicação por CNPJ/nome é uma decisão explícita por linha, nunca um "atualizar tudo"/"criar tudo" silencioso.
- Um job é resumível: fechar a aba e reabrir `/imports/:jobId` retoma exatamente onde o job está, nunca perde o progresso.
- Um commit já executado é idempotente — reabrir e "confirmar" de novo nunca duplica os registros criados.

## Conecta-se com

A04/A08/A11 (pontos de entrada); ao concluir, para os recursos criados e de volta para o resumo persistente deste mesmo job de importação.
