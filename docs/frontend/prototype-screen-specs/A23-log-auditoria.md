# A23 — Log de auditoria

**Rota:** `/app/:orgId/activity`
**Acesso:** `ADMIN_ROLES` (`activity:read`) — dado disclosure-sensitive, mesmo tier do export em
massa. Esta é uma regra firme, não uma recomendação: MEMBER/VIEWER não conseguem descobrir nem
visualizar esta tela, sua entrada de navegação, nem os dados subjacentes por nenhuma via (URL
direta incluída).
**Nav ativo:** "Configurações" (visível apenas a ADMIN_ROLES, ver acima).

## Estrutura

1. `PageHeader`: título "Log de atividade", descrição "Quem fez o quê, quando — em toda a organização.", contagem total de eventos ao lado do título.
2. **Painel "Eventos"** (header: título + contagem): `DataTable` compacta, colunas:
   - Ator (primary): nome do usuário, ou "Usuário removido" se a conta não existe mais (preservar o evento mesmo após exclusão de conta).
   - Ação: código técnico em `<code>` (formato `recurso:verbo`, ex. `docarchive:review`, `membership:role-change`, `item:delete`, `docarchive:documenttype-metadata-manage`); truncar com reticências + tooltip/expansão ao focar/hover se exceder a largura da coluna, nunca quebra o layout da linha.
   - Recurso: descrição legível do recurso afetado (ex. "Documento — CND Federal (Atlas Schindler)"); mesmo tratamento de truncamento/expansão do código de ação.
   - Quando: data/hora (DD/MM/AAAA HH:MM, fuso horário da organização — exibir o fuso por extenso em tooltip, ex. "Horário de Brasília (UTC-3)"); algarismos tabulares.
3. Paginação: cursor-based, botão "Carregar mais" ao final da lista (não infinite-scroll silencioso — preserva posição de foco e permite ao usuário controlar quando mais dados chegam); anuncia via `aria-live` a contagem de novos eventos carregados.

### Estados

- **Carregando** (inicial): esqueleto de 5 linhas de tabela.
- **Vazio**: `EmptyState` "Nenhum evento registrado ainda.".
- **Erro ao carregar**: `InlineNotice tone="danger"` "Não foi possível carregar o log de atividade." + botão "Tentar novamente".
- **Carregando mais** (paginação): spinner inline no botão "Carregar mais", demais linhas permanecem interativas.
- **Erro ao carregar mais**: o botão volta ao estado normal com `InlineNotice tone="danger"` inline abaixo da tabela + "Tentar novamente" — não perde as linhas já carregadas.
- **Fim da lista**: botão "Carregar mais" é substituído por texto estático "Todos os eventos foram carregados.".
- **Alto volume**: nenhuma paginação numerada é oferecida (o log cresce indefinidamente) — apenas cursor incremental; um filtro por período (ver Regras de negócio) é o principal mecanismo de navegação em volumes grandes.

### Responsivo

- `< 1024px`: a tabela transforma-se em lista de cartões — um cartão por evento, ator em destaque, ação e recurso como linhas rótulo/valor abaixo, timestamp no rodapé do cartão (layout tipo timeline, conforme exigido pelo plano de telas). Nunca apenas encolhe a tabela ou empurra para scroll horizontal.

### Movimento

- Novas linhas carregadas via "Carregar mais" entram com fade em `motion.fast` (120ms), sem reordenar linhas já visíveis.
- Foco permanece no botão "Carregar mais" (ou se substituído pelo texto de fim de lista, move-se para esse texto) após o carregamento, nunca é perdido.
- Respeita `prefers-reduced-motion`: novas linhas aparecem instantaneamente, sem fade.

## Dados de exemplo

```
Marina Costa — docarchive:review — Documento — CND Federal (Atlas Schindler) — 09/09/2026 08:20
Diego Alves — membership:role-change — Membro — Renata Souza — 08/09/2026 16:04
Usuário removido — item:delete — Vencimento — Certidão descontinuada — 05/09/2026 11:47
Marina Costa — docarchive:documenttype-metadata-manage — Tipo de documento — CND Federal — 01/09/2026 09:15
```

## Regras de negócio

- Log é somente-leitura, append-only, nunca editável nem removível pela UI.
- Eventos referenciando um ator cuja conta foi removida devem preservar o registro histórico com o rótulo "Usuário removido" em vez de quebrar/ocultar o evento.
- Um "Recurso" reconhecido (ex. um Documento, um Vencimento ainda existente) é um link para a tela de detalhe correspondente; um recurso já excluído mostra o texto sem link, sem quebrar o evento.
- Filtro por ator, ação, recurso e intervalo de datas: **necessário para a implementação real** dado que o log cresce indefinidamente — não modelado em detalhe neste protótipo (candidato a padrão compartilhado reutilizável por qualquer tela futura de trilha de auditoria/histórico), mas a paginação cursor-based acima já é obrigatória a partir desta versão da spec, não apenas recomendada.
