# A12 — Detalhe do documento

**Revision history**: revised 2026-09-09 per
`docs/architecture/reviews/screen-spec-audit-2026-09-09/A12-audit-record.md` (batch 3/6) — route
corrected to include `:orgId`, full RBAC action table added including the service-level
reviewer-or-admin gate, files/scan/OCC/claim states added, mobile timeline+preview transform
specified, motion decision named.

**Rota:** `/app/:orgId/documents/:documentId`
**Nav ativo:** "Requisitos" (chega-se aqui a partir de um Subject, um Requisito, ou um link direto —
ver Conexões)

## Ações (mapeadas para `authorization.ts` + regra de serviço)

| Ação visível | Capability | Tier |
|---|---|---|
| Ler documento/histórico/metadados | `docarchive:read` | todos (READ_ONLY_ROLES) |
| "Editar metadados" | `docarchive:document-metadata-update` | WRITE_ROLES |
| "Enviar nova versão" | `docarchive:upload` | WRITE_ROLES |
| "Revisar" (claim/aceitar/rejeitar) | `docarchive:review` | WRITE_ROLES, **mais um gate de serviço**: OWNER/ADMIN podem decidir qualquer versão RECEIVED/UNDER_REVIEW elegível; um MEMBER só pode decidir uma versão que ele mesmo reivindicou ou que ninguém reivindicou ainda — se outro MEMBER já reivindicou, o MEMBER atual **não vê** a ação "Revisar" (ausente, não desabilitada, para não sugerir um bloqueio temporário) |

VIEWER: apenas leitura — nunca vê "Editar metadados", "Enviar nova versão" ou "Revisar".

**Não existe ação "Arquivar documento"** mesmo o campo `Document.status` admitindo ARCHIVED — não
inventar esse botão (confirmado no plano: nenhuma rota existe para isso).

## Estrutura

1. `PageHeader`: `above`="← Voltar para o requisito" (ou para o Subject/lista de origem, conforme
   Conexões); título = "{Tipo de documento} — {Fornecedor}" (ex. "CND Federal — Atlas Schindler");
   descrição = "Requisito: {tipo} · Tipo: {categoria}"; ações: "Editar metadados" (secondary, WRITE_ROLES),
   "Enviar nova versão" (primary, WRITE_ROLES).
2. `InlineNotice tone="warning"` condicional (quando há versão em andamento): "Nova versão em
   andamento: arquivo recebido, aguardando revisão. O envio segue em 3 etapas — reservar versão,
   enviar arquivos, confirmar — e pode falhar em qualquer etapa isoladamente." Se uma etapa já falhou:
   substitui o texto por "Falha ao {etapa}. [Tentar novamente]" com a etapa concluída preservada (o
   processo é retomável a partir da etapa que falhou, nunca reinicia do zero).
3. **Grid 2 colunas** (1 col ≤860px):
   - Painel "Documento": `DetailList` com Fornecedor, Tipo de documento, Situação (`Ativo`/`Arquivado`
     — rotulado explicitamente como "Situação do documento" para não ser confundido com o status da
     versão), Versão atual aceita (com data de validade).
   - Painel "Metadados ({tipo})": `DetailList` com campos específicos do tipo de documento (ex. para
     CND Federal: Órgão emissor, Número da certidão, Data de emissão) + indicador de campo obrigatório
     pendente em destaque (ícone `alert-triangle` + texto em cor de aviso, ex. "CNPJ do emissor — não
     informado" — nunca só a cor).
4. **Painel "Versões"** (header com título + contagem): `DataTable` compacta "Histórico de versões",
   colunas:
   - Versão (primary, ex. "v3", "v2")
   - Status: `StatusBadge` — RECEIVED tone `warning` + ícone `clock`; UNDER_REVIEW tone `warning` +
     ícone `eye` (distinto de RECEIVED); ACCEPTED tone `neutral` + ícone `check`; SUPERSEDED tone
     `neutral` + ícone `history` (distinto de ACCEPTED); REJECTED tone `critical`.
   - Origem (ex. "Upload manual", "Solicitação (guest)")
   - Emitido em (data)
   - Revisor ("—" se não revisado)
   - Ações: se status RECEIVED, ou UNDER_REVIEW reivindicada pelo ator atual → "Revisar" (link para
     A13 com este item selecionado, respeitando o gate de serviço acima); se UNDER_REVIEW reivindicada
     por outro E o ator não é OWNER/ADMIN → sem ação de revisão (mostra "Em revisão por {nome}" como
     texto, não como ação); senão → "Ver arquivo" (abre o arquivo principal; se scan estiver pendente,
     mostra "Verificando segurança" no lugar do link).

## Estados

- Upload: 3 etapas (reservar → enviar arquivo → confirmar), cada etapa falha independentemente e é
  retomável (ver Estrutura item 2). Uma vez que o conjunto de arquivos está selado, não é possível
  adicionar mais arquivos.
- Scan de arquivo: pendente (bloqueia decisão de aceitar), infectado (bloqueia definitivamente aquela
  versão, mostrado com `tone="critical"`).
- Revisão: claim pode expirar/ser perdido (outro revisor assumiu) — se isso ocorrer enquanto o ator
  está na tela de revisão, mostrar notice e reverter para o estado de leitura.
- Decisão concorrente: se dois revisores decidirem quase simultaneamente, a segunda chamada recebe
  conflito — mostrar "Esta versão já foi decidida por outra pessoa" e recarregar o histórico.
- Terminal: uma versão ACCEPTED/REJECTED/SUPERSEDED/WITHDRAWN não pode mais ser revisada.
- Uma nova versão ACCEPTED supera automaticamente a anterior (que vira SUPERSEDED).
- Campo de metadado obrigatório vazio: indicador visual, nunca bloqueio de salvar (é uma
  incompletude, não um erro de validação).
- Campo de metadado arquivado/removido do catálogo: mantém o valor histórico em Documentos antigos.
- Conflito de edição concorrente de metadados (OCC): "Alguém alterou este documento enquanto você
  editava. Revise as mudanças antes de salvar novamente."
- Loading inicial: skeleton do grid + tabela. Erro ao carregar: `InlineNotice` com retry.

## Dados de exemplo

```
Documento: Fornecedor=Atlas Schindler, Tipo=CND Federal, Situação do documento=Ativo,
  Versão atual aceita=v2 · válida até 12/03/2027
Metadados: Órgão emissor=Receita Federal, Número da certidão=AB1234567890,
  Data de emissão=12/09/2026, campo pendente=CNPJ do emissor
Versões: v3 RECEIVED (07/09/2026, upload manual) | v2 SUPERSEDED (12/03/2026, Marina Costa) |
  v1 SUPERSEDED (10/03/2025, Solicitação guest, Marina Costa)
```

## Regras de negócio

- Estados de versão: `RECEIVED` (recebida, aguarda revisão) → `UNDER_REVIEW` (revisor reivindicou) →
  `ACCEPTED` (aceita, vira versão vigente) ou `REJECTED`; versão anterior aceita vira `SUPERSEDED`
  quando uma nova é aceita.
- Upload de nova versão é um processo de 3 etapas (reservar → enviar arquivo → confirmar), cada etapa
  pode falhar isoladamente — tratado como transação retomável a partir da etapa que falhou.
- Metadados são específicos por tipo de documento (ver Catálogo de Tipos, A20) — campos obrigatórios
  não preenchidos devem ser destacados visualmente.
- Revisão de uma versão UNDER_REVIEW só pode ser concluída por quem a reivindicou, ou por OWNER/ADMIN
  a qualquer momento (regra de serviço `assertReviewerOrAdmin` — não é apenas RBAC de tier).

## Conexões

- Entradas: A09 (aba Documentos do Subject), A11 (link de evidência de um Requisito satisfeito), A13
  (item da fila), link direto.
- "Enviar nova versão" mantém o usuário nesta mesma tela (não navega para outra).
- Revisar pendente → A13, focada nesta versão.
- Nome do "Tipo de documento" → A20 (Catálogo de Tipos).

## Responsivo

- Full parity — ações de revisão nunca são degradadas em mobile.
- Histórico de versões vira uma timeline vertical (não tabela) em mobile: cada versão como um item com
  status, origem, data e ação, empilhados verticalmente.
- Preview de arquivo pode abrir em tela cheia em mobile.

## Motion

- Linha de versão que muda de estado (aceitar/rejeitar) anima com fade+colapso em `motion.fast`
  (120ms) antes de reordenar a tabela/timeline.
- Troca entre painel "Documento" e "Metadados" (se implementada como tabs em telas estreitas): sem
  animação de conteúdo, apenas troca instantânea.
- Respeita `prefers-reduced-motion`: remove o fade/colapso, mantém apenas a atualização de conteúdo.
