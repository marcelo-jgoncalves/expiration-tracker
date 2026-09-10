# A09 — Hub do fornecedor (Subject Hub)

**Revision history**: revised 2026-09-09 per
`docs/architecture/reviews/screen-spec-audit-2026-09-09/A09-audit-record.md` (batch 3/6) — route
corrected to include `:orgId`, full RBAC action table added, requirement-label disambiguation applied
(plan §2.4), missing states added, severity-led card treatment authored within SLF-01's constraint
(see `system-level-findings.md`), motion decision named.

**Rota:** `/app/:orgId/subjects/:subjectId`
**Nav ativo:** "Fornecedores"
**Acesso:** ver tabela de ações abaixo — não há papel que veja a tela inteira desabilitada; VIEWER
tem apenas leitura.

## Ações (mapeadas para `authorization.ts`)

| Ação visível | Capability | Tier |
|---|---|---|
| Ler o hub (painel, cards, breakdown) | `subject:read` | todos (READ_ONLY_ROLES) |
| "Editar fornecedor" | `subject:update` | WRITE_ROLES (OWNER/ADMIN/MEMBER) |
| "Excluir fornecedor" (menu overflow do header, com confirmação — ver Estados) | `subject:delete` | ADMIN_ROLES (OWNER/ADMIN) |
| "Exportar dossiê" | `docarchive:dossier-export` | ADMIN_ROLES (OWNER/ADMIN) |
| Cards "Requisitos documentais" / "Documentos" / "Solicitações" (leitura) | `docarchive:requirement-read` / `docarchive:read` / `docarchive:series-read` | todos (READ_ONLY_ROLES) |

VIEWER: vê a tela e todos os cards de leitura; não vê "Editar fornecedor" nem "Excluir fornecedor"
(oculto, não apenas desabilitado — regra de navegação RBAC do plano §2.1). Todos os papéis com
Membership veem "Exportar dossiê" oculto exceto OWNER/ADMIN.

## Estrutura

1. `PageHeader`: `above`="← Voltar para Fornecedores"; título = nome do fornecedor; descrição =
   "{Tipo} · CNPJ {cnpj}" (ou identificador equivalente para Subjects sem CNPJ — ver Regras de dados);
   ações: "Editar fornecedor" (secondary), overflow menu (ícone `more-vertical`) com "Excluir
   fornecedor" (destructive, só OWNER/ADMIN), "Exportar dossiê" (secondary, só OWNER/ADMIN, link →
   A17).
2. Se o Subject estiver arquivado: `InlineNotice tone="neutral"` fixo abaixo do header: "Este
   fornecedor está arquivado. Novas evidências não são solicitadas automaticamente." — não bloqueia a
   leitura, apenas contextualiza.
3. **Painel "Conformidade"** (carrega de forma independente dos cards abaixo — ver Estados):
   - Porcentagem grande (tabular-nums) + fração por extenso ("{satisfied} de {total} requisitos
     satisfeitos") lado a lado — **sempre mostrar ambos**.
   - Linha de breakdown com 3 itens (ícone + texto): "{n} satisfeito(s)" (ícone `dot`), "{n} vencendo
     em breve" (ícone `alert-triangle`), "{n} em falta" (ícone `x-circle`).
   - Se `total === 0`: porcentagem exibe "—" em vez de "0%" ou erro de divisão.
   - Se o painel falhar ao carregar: substituir o conteúdo por `InlineNotice tone="warning"` local com
     "Não foi possível carregar os dados de conformidade." + ação "Tentar novamente" — os cards abaixo
     continuam funcionando independentemente (falha parcial nunca zera as outras seções).
4. **Grid de cards de destino**, com peso visual priorizado por risco (não um grid plano — ver
   Composição visual abaixo):
   - "Requisitos documentais" (contagem total do fornecedor) → lista de Requisitos filtrada por este
     fornecedor, dentro da aba de Requisitos deste hub.
   - "Documentos" → visão de documentos filtrada por este fornecedor (não existe ainda uma Coleção de
     Documentos tenant-wide — este card usa a mesma tela de listagem de Requisitos com o filtro de
     evidência ativado, ou uma view dedicada quando A12's plan closes a Documents Collection gap;
     até lá, aponta para a lista de Requisitos com foco em evidência).
   - "Rastreamento legado (requisitos acompanhados)" → vínculos de migração legada (A10); nota indica
     vínculos "MISSING" se houver. Se A10 ainda não estiver implementada, o card aparece com estado
     "Em breve" (desabilitado, não removido) em vez de linkar para uma tela inexistente.
   - "Solicitações e recorrência" → A14.
   - Se um card referenciar um recurso que foi removido/ficou inacessível desde o último carregamento:
     mostrar "Indisponível no momento" no lugar da contagem, sem quebrar o grid.

## Composição visual (autoria específica do produto)

- Cards com `missingCount > 0` ou `expiringSoonCount > 0` (Requisitos documentais, Documentos)
  recebem tom de destaque (borda `warning`/`danger` conforme severidade + ícone) e aparecem primeiro
  na ordem de leitura; cards sem pendência (Solicitações sem série ativa, Rastreamento legado 100%
  satisfeito) usam tom neutro e aparecem depois — mitigação local dentro da restrição SLF-01
  (ver `system-level-findings.md`), não um novo componente compartilhado.
- Painel de Conformidade sempre precede o grid de cards na ordem de leitura, mesmo em mobile.

## Estados

- Conformidade `null` (nenhum requisito) vs. percentual real — sempre com numerador/denominador.
- Painel de conformidade: loading (skeleton), erro local com retry, sucesso.
- Fornecedor arquivado: notice fixo (ver Estrutura item 2).
- Card cujo recurso vinculado foi removido: "Indisponível no momento" (ver Estrutura item 4).
- A10 ainda não implementada: card "Em breve" desabilitado.
- Exclusão do fornecedor: dialog de confirmação nomeando o fornecedor e a consequência (regra do
  design system §48 — nunca "Tem certeza?" sozinho); foco inicial no botão Cancelar.

## Dados de exemplo

```
Fornecedor: Conservare Facilities ME, Prestador de serviço, CNPJ 14.221.900/0001-55
Conformidade: total=2, satisfied=1, expiringSoon=0, missing=1 → 50%
Cards: Requisitos documentais=2 (1 em falta, destacado) | Documentos=1 (1 versão aceita) |
  Rastreamento legado=1 (1 vínculo MISSING, destacado) | Solicitações=0 (nenhuma série ativa, neutro)
```

## Regras de dados

- Subjects sem CNPJ (CLIENT/EMPLOYEE/ASSET/LOCATION/CUSTOM) usam o identificador equivalente do tipo
  (CPF, matrícula, código de ativo, etc.) na descrição do header — nunca deixar "CNPJ" fixo quando o
  Subject não é COMPANY/VENDOR.

## Motion

- Atualização dos números do painel de Conformidade ao recarregar: transição de opacidade em
  `motion.fast` (120ms), sem reflow do layout.
- Navegação entre cards e a tela de destino: sem animação de transição de página (instantâneo por
  design — operação de navegação frequente, não precisa de coreografia).
- Respeita `prefers-reduced-motion`: desativa a transição de opacidade acima, mantém apenas a troca de
  conteúdo.
