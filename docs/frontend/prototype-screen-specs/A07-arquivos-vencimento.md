# A07 — Arquivos do vencimento

**Rota:** `/expirations/:id/files`
**Acesso:** MEMBER+ para upload/edição; VIEWER somente leitura
**Nav ativo:** "Vencimentos"
**Layout:** coluna única, max-width `var(--layout-reading-max)`.

## Estrutura

1. `PageHeader`: `above`="← Voltar para o vencimento"; título "Arquivos"; descrição = nome do vencimento; ação "Adicionar arquivo" (primary).
2. **Painel "Anexos"**: header com título + contagem (ex. "1 arquivo"). `DataTable` compacta, colunas:
   - Arquivo (primary, link para abrir/baixar)
   - Tipo (ex. PDF)
   - Tamanho (numeric, ex. "482 KB")
   - Status (segurança do arquivo, `StatusBadge`):
     - `CLEAN` → "Verificado (segurança)" (neutral)
     - `SCANNING` → "Verificando…" (warning)
     - `REJECTED` → "Rejeitado (malware)" (critical)
     - `UNSUPPORTED` → "Tipo não suportado" (critical)
     - `TIMEOUT` → "Verificação expirou" (critical)
   - Ações: "Excluir" (tertiary, sm)
3. **Painel "Dados extraídos (OCR)"**: lista de campos extraídos automaticamente do arquivo, cada linha:
   - Label do campo + (opcional) nota de confiança "Sugerido com N% de confiança" abaixo do label, se ainda não confirmado.
   - Valor extraído + ação: botão "Confirmar" (secondary, sm) se pendente, ou `StatusBadge` "Confirmado" (neutral) se já confirmado.

## Dados de exemplo

```
Arquivo: alvara-2026.pdf, PDF, 482 KB, status CLEAN
OCR: Número do documento = AL-2024-00931 (92% confiança, pendente confirmação)
     Data de emissão = 14/01/2026 (confirmado)
```

## Regras de negócio

- Todo arquivo passa por verificação de segurança (antivírus/malware) antes de ficar disponível; estado `SCANNING` é transitório.
- Dados extraídos por OCR requerem confirmação humana explícita antes de serem considerados corretos (nunca aplicados automaticamente sem revisão).

## RBAC

- VIEWER: sem "Adicionar arquivo", sem "Excluir", sem "Confirmar" (apenas visualiza).
