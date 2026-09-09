# A09 — Hub do fornecedor (Subject Hub)

**Rota:** `/subjects/:id`
**Acesso:** todos os papéis; export restrito (ver RBAC)
**Nav ativo:** "Fornecedores"

## Estrutura

1. `PageHeader`: `above`="← Voltar para Fornecedores"; título = nome do fornecedor; descrição = "{Tipo} · CNPJ {cnpj}"; ações: "Editar fornecedor" (secondary, link), "Exportar dossiê" (tertiary, link → A17).
2. **Painel "Conformidade"**:
   - Porcentagem grande (tabular-nums) + fração por extenso ("{satisfied} de {total} requisitos satisfeitos") lado a lado — **sempre mostrar ambos**.
   - Linha de breakdown com 3 itens (ícone + texto): "{n} satisfeito(s)" (ícone `dot`), "{n} vencendo em breve" (ícone `alert-triangle`), "{n} em falta" (ícone `x-circle`).
   - Se `total === 0`: porcentagem exibe "—" em vez de "0%" ou erro de divisão.
3. **Grid de cards de link** (`repeat(auto-fill, minmax(220px,1fr))`), cada card = contagem grande + label + nota, navega para:
   - "Requisitos" (contagem total do fornecedor) → lista de Requisitos filtrada por este fornecedor
   - "Documentos" → lista de documentos deste fornecedor
   - "Rastreamento legado" → vínculos de migração legada (nota indica vínculos "MISSING" se houver)
   - "Solicitações e recorrência" → A14

## Dados de exemplo

```
Fornecedor: Conservare Facilities ME, Prestador de serviço, CNPJ 14.221.900/0001-55
Conformidade: total=2, satisfied=1, expiringSoon=0, missing=1 → 50%
Cards: Requisitos=2 (1 em falta) | Documentos=1 (1 versão aceita) | Rastreamento legado=1 (1 vínculo MISSING) | Solicitações=0 (nenhuma série ativa)
```

## RBAC

- "Exportar dossiê": visível apenas para OWNER e ADMIN, mesmo que o usuário atual seja o responsável (`assignee`) direto do fornecedor.
