# A23 — Log de auditoria

**Rota:** `/audit-log`
**Acesso:** ADMIN+ (recomendado; dado sensível de toda a organização)
**Nav ativo:** "Configurações"

## Estrutura

1. `PageHeader`: título "Log de atividade", descrição "Quem fez o quê, quando — em toda a organização."
2. **Painel "Eventos"** (header: título + contagem): `DataTable` compacta, colunas:
   - Ator (primary): nome do usuário, ou "Usuário removido" se a conta não existe mais (preservar o evento mesmo após exclusão de conta).
   - Ação: código técnico em `<code>` (formato `recurso:verbo`, ex. `docarchive:review`, `membership:role-change`, `item:delete`, `docarchive:documenttype-metadata-manage`).
   - Recurso: descrição legível do recurso afetado (ex. "Documento — CND Federal (Atlas Schindler)").
   - Quando: data/hora (DD/MM/AAAA HH:MM).

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
- Esta tela não tem filtros no protótipo atual — **considerar adicionar** filtro por ator, ação, recurso e intervalo de datas na implementação real, dado que o log cresce indefinidamente (paginação também recomendada).
