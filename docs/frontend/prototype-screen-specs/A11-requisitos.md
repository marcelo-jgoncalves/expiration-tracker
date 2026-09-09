# A11 — Requisitos (lista, toda a organização)

**Rota:** `/requirements`
**Acesso:** todos os papéis
**Nav ativo:** "Requisitos"

## Estrutura

1. `PageHeader`: título "Requisitos", descrição "Requisitos de documento, com evidência vinculada, em toda a organização." Sem ações de cabeçalho (criação de requisito acontece via Template aplicado a um fornecedor, A21, não diretamente aqui).
2. **Painel único**, header composto: título + contagem; `FilterGroup` (overflow-x:auto) com opções e contagem:
   - Todos / Em falta (`MISSING`) / Pendente (`PENDING`) / Satisfeito (`SATISFIED`) / Não satisfeito (`NOT_SATISFIED`) / Não se aplica (`NOT_APPLICABLE`)
3. `DataTable` compacta, colunas:
   - Requisito (primary): nome (link → detalhe, provavelmente A12 se satisfeito) + fornecedor/subject (`CellSecondary`)
   - Status: `StatusBadge` — MISSING/NOT_SATISFIED tone `critical`; PENDING tone `warning`; SATISFIED/NOT_APPLICABLE tone `neutral`
   - Validade (numeric, data ou "—")
   - Ações: "Ver" (tertiary, sm, link)

## Dados de exemplo (8 registros)

| Requisito | Fornecedor | Status | Validade |
|---|---|---|---|
| Certificado de Regularidade FGTS | Conservare Facilities ME | MISSING | — |
| CND Federal | Conservare Facilities ME | SATISFIED | 12/03/2027 |
| CND Federal | Atlas Schindler | PENDING | — |
| Contrato de manutenção | Atlas Schindler | SATISFIED | 30/06/2027 |
| Apólice vigente | Porto Seguro | SATISFIED | 01/02/2027 |
| Contrato de locação atualizado | Imobiliária Vértice | MISSING | — |
| Comprovante de propriedade | Imobiliária Vértice | NOT_APPLICABLE | — |
| Contrato de fornecimento | Comerc Energia | SATISFIED | 15/09/2026 |

## Regras de negócio

- Esta é a visão cross-fornecedor de todos os Requisitos da organização; a visão por-fornecedor filtrada vive dentro do Hub do Fornecedor (A09).
- `PENDING` = versão de documento enviada mas ainda não aceita pela revisão (ver A13 Fila de revisão).
