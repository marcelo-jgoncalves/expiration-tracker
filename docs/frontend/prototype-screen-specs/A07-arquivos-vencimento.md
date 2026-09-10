# A07 — Arquivos do vencimento

**Revisão 2026-09-09 (screen-spec-audit-2026-09-09, batch 2/6)**: reescrita após auditoria NOT PASS
(ver `docs/architecture/reviews/screen-spec-audit-2026-09-09/A07-audit-record.md`). Correções: rota
carrega `:orgId`/`:itemId`/`:documentId?`; RBAC de exclusão corrigida para ADMIN_ROLES (era
erroneamente MEMBER+, achado Crítico); ciclo completo de upload (reserva → envio de bytes,
distintos e independentemente falíveis) explicitado; `PENDING_UPLOAD`/`DELETED` adicionados ao
enum de status; `tertiary` substituído; integridade epistêmica reforçada (verificação de malware ≠
aprovação do documento; origem/proveniência do OCR explícita); motion nomeado.

**Rota:** `/app/:orgId/expirations/:itemId/files/:documentId?`
**Acesso:** WRITE_ROLES (OWNER/ADMIN/MEMBER) para upload/confirmação de OCR; ADMIN_ROLES
(OWNER/ADMIN) para exclusão; VIEWER somente leitura
**Nav ativo:** "Vencimentos"
**Layout:** coluna única, max-width `var(--layout-reading-max)`.

## Estrutura

1. `PageHeader`: `above`="← Voltar para o vencimento"; título "Arquivos"; descrição = nome do
   vencimento; ação "Adicionar arquivo" (`primary`) — abre seletor de arquivo/câmera (alternativa não
   drag-and-drop obrigatória).
2. **Painel "Anexos"**: header com título + contagem (ex. "1 arquivo"). `DataTable` compacta,
   colunas:
   - Arquivo (primary): nome do arquivo; vira link "abrir/baixar" **somente quando status = CLEAN**
     — em qualquer outro status o nome aparece como texto simples (não-interativo), pois o arquivo
     ainda não está liberado para acesso.
   - Tipo (ex. PDF)
   - Tamanho (numeric, `tabular-nums`, ex. "482 KB")
   - Status (segurança do arquivo, `StatusBadge` com ícone+texto+cor, nunca só cor):
     - `PENDING_UPLOAD` → "Aguardando envio…" (neutral, ícone `upload`) — reserva feita, bytes ainda
       não confirmados no servidor; se o envio falhar nesta fase, mostra "Falha no envio" (critical)
       com ação "Tentar novamente" (reenvia sem criar uma segunda reserva).
     - `SCANNING` → "Verificando…" (warning, ícone `shield-search`) — transitório; a linha atualiza
       automaticamente quando o resultado chega (poll/subscribe), sem exigir reload manual da página.
     - `CLEAN` → "Verificado (segurança)" (neutral, ícone `shield-check`) — **isto significa apenas
       que o arquivo passou na varredura de malware; não é uma aprovação de conteúdo/conformidade**,
       distinção mantida visualmente do conceito de revisão (que não existe neste módulo legado).
     - `REJECTED` → "Rejeitado (malware)" (critical, ícone `shield-x`)
     - `UNSUPPORTED` → "Tipo não suportado" (critical, ícone `file-x`)
     - `TIMEOUT` → "Verificação expirou" (critical, ícone `clock-alert`) com ação "Tentar novamente"
       (reenvia o arquivo, não apenas reconsulta o status expirado).
     - `DELETED` → linha não aparece na tabela (arquivos excluídos somem da lista; nenhuma UI dedicada
       a "arquivo excluído" é necessária, já que a exclusão é definitiva neste módulo).
   - Ações: "Excluir" (`danger`, sm, ícone-only com nome acessível "Excluir {nome do arquivo}",
     visível somente a ADMIN_ROLES) — abre confirmação inline (`Popover` de 1 passo: "Excluir este
     arquivo? [Cancelar] [Excluir]"), não modal de página inteira (ação reversível apenas até a
     confirmação, sem histórico de restauração depois).
3. **Painel "Dados extraídos (OCR)"** (some inteiramente se nenhum arquivo tem extração — nunca
   mostra painel vazio): lista de campos extraídos automaticamente do arquivo mais recente com status
   CLEAN, cada linha:
   - Label do campo + origem ("Extraído automaticamente de {nome do arquivo}") + nota de confiança
     "Sugerido com N% de confiança" abaixo do label, se ainda não confirmado.
   - Valor extraído (`tabular-nums` quando numérico/data) + ação: botão "Confirmar" (`secondary`, sm)
     se pendente, ou `StatusBadge` "Confirmado por {nome}" (neutral, ícone `check`) se já confirmado —
     nunca promovido automaticamente de sugerido para confirmado.
   - **Conflito de confirmação concorrente**: se duas pessoas tentam confirmar o mesmo campo quase
     simultaneamente, a segunda tentativa recebe `InlineNotice tone="info"` "Este campo já foi
     confirmado por {nome}" em vez de erro genérico ou duplicidade silenciosa.

## Dados de exemplo

```
Arquivo: alvara-2026.pdf, PDF, 482 KB, status CLEAN
OCR: Número do documento = AL-2024-00931 (92% confiança, pendente confirmação, extraído de
     alvara-2026.pdf)
     Data de emissão = 14/01/2026 (confirmado por Marina Costa)
```

## Regras de negócio

- Upload é um processo de duas fases, independentemente falíveis: (1) reserva do upload
  (`document:reserve-upload`) e (2) envio efetivo dos bytes. Uma reserva sem envio confirmado nunca
  aparece como arquivo "pronto" — fica em `PENDING_UPLOAD` até o envio ser confirmado ou falhar.
- Todo arquivo passa por verificação de segurança (antivírus/malware) antes de ficar disponível para
  abrir/baixar; estado `SCANNING` é transitório e atualiza automaticamente na tela.
- `CLEAN` (verificado quanto a malware) nunca deve ser lido pela interface como "documento aprovado"
  — são conceitos técnico e de negócio distintos (integridade epistêmica).
- Dados extraídos por OCR requerem confirmação humana explícita antes de serem considerados corretos
  (nunca aplicados automaticamente sem revisão); um campo sugerido sempre mostra de onde veio.

## RBAC

| Ação | OWNER | ADMIN | MEMBER | VIEWER |
|---|---|---|---|---|
| Ver arquivos / dados OCR | ✓ | ✓ | ✓ | ✓ |
| Adicionar arquivo | ✓ | ✓ | ✓ | — |
| Confirmar campo OCR | ✓ | ✓ | ✓ | — |
| Excluir arquivo | ✓ | ✓ | — | — |

VIEWER: sem "Adicionar arquivo", sem "Excluir", sem "Confirmar" (apenas visualiza). MEMBER: sem
"Excluir" (correção do achado crítico da auditoria: a versão anterior desta spec permitia exclusão a
MEMBER+, contradizendo `document:delete` = ADMIN_ROLES em `authorization.ts`).

## Responsivo e acessibilidade

- Paridade total. Tabela de anexos vira lista de cards empilhados em mobile (nome, tipo+tamanho na
  mesma linha secundária, status, ação de excluir) — nunca scroll horizontal como solução padrão.
- Comparação sugerido-vs-confirmado do painel OCR empilha verticalmente em mobile (label/confiança,
  depois valor+ação), preservando a mesma ordem de leitura do desktop.
- Seletor de arquivo funciona a partir de câmera/galeria em dispositivos móveis, com alternativa sem
  arrastar-e-soltar. Progresso de envio é anunciado a leitor de tela (`aria-live="polite"`).

## Motion

- Transição de status de uma linha (ex. `SCANNING` → `CLEAN`) usa `motion.fast` (120ms, ease-out) no
  badge, sem reordenar a tabela nem deslocar outras linhas. Confirmação de campo OCR troca o botão
  "Confirmar" pelo `StatusBadge` "Confirmado" com o mesmo `motion.fast`, mantendo a largura da célula
  estável (sem layout shift). Upload em progresso usa uma barra de progresso contínua, não um spinner
  indeterminado, quando o percentual é conhecido. `prefers-reduced-motion`: todas as transições acima
  colapsam para troca instantânea de estado.
