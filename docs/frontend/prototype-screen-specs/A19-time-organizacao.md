# A19 — Time e organização

**Rota:** `/settings/team`
**Acesso:** aba "Membros e convites" → ADMIN+; aba "Organização" → ADMIN+ (encerrar organização → OWNER apenas)
**Nav ativo:** "Configurações"

## Estrutura

1. `PageHeader`: título "Time e organização", descrição "Membros, convites e configurações da organização {nome}."
2. **Tabs** (estilo underline, não pill): "Membros e convites" | "Organização". Tab ativa: texto principal + borda inferior de destaque (cor de ação primária).

### Aba "Membros e convites" (default)

- **Painel "Membros"** (header: título + botão "Convidar membro" secondary sm à direita): `DataTable`, colunas:
  - Membro (primary): nome + e-mail (`CellSecondary`)
  - Papel: `<select>` com OWNER/ADMIN/MEMBER/VIEWER — **desabilitado se o papel atual da linha for OWNER** (não é possível rebaixar o Owner por aqui); opção "OWNER" sempre desabilitada no dropdown (não é possível promover ninguém a Owner por esta tela — transferência de ownership é ação separada, fora do escopo).
  - Status: `StatusBadge` "Ativo" (neutral) / "Suspenso" (warning)
  - Ações: se papel=OWNER → texto "Último OWNER" (`CellSecondary`, sem botão); senão → botão "Remover" (tertiary, sm)
- **Painel "Convites pendentes"**: `DataTable`, colunas: E-mail convidado (primary), Papel, Status (ex. "Pendente · expira em 5 dias"), Ações: "Revogar" (tertiary, sm)

### Aba "Organização"

- **Painel "Identidade da organização"** (padded): `DetailList` com Nome de exibição, Fuso horário, Situação; botão "Editar organização" (secondary) abaixo.
- **Painel zona de perigo** (padded): linha com texto "Encerrar organização" + nota "Ação irreversível-adjacente. Requer confirmação deliberada." à esquerda, botão "Encerrar organização" (danger) à direita.

## Dados de exemplo

```
Membros: Marina Costa (OWNER, ativo) | Diego Alves (ADMIN, ativo) | Renata Souza (MEMBER, ativo) | Paulo Lima (VIEWER, suspenso)
Convites: julia@comerc.com, MEMBER, "Pendente · expira em 5 dias"
Organização: Comerc Facilities, America/Sao_Paulo, Ativa
```

## Regras de negócio

- Sempre deve existir ao menos 1 OWNER ativo; a linha do único OWNER nunca é editável/removível pela UI.
- "Encerrar organização" exige confirmação adicional (modal de confirmação — não modelado no protótipo, mas obrigatório na implementação real dado o texto "requer confirmação deliberada").

## RBAC

- MEMBER/VIEWER: sem acesso a esta tela (redirecionar ou 403).
- ADMIN: acessa ambas as abas, mas não vê/usa "Encerrar organização" (ação exclusiva de OWNER) — ocultar ou desabilitar o botão para ADMIN.
