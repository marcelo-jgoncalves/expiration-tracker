# A12 — Detalhe do documento

**Rota:** `/documents/:id`
**Acesso:** todos os papéis; revisão restrita a MEMBER+ (ver A13)
**Nav ativo:** "Requisitos" (chega-se aqui a partir de um Requisito satisfeito)

## Estrutura

1. `PageHeader`: `above`="← Voltar para o requisito"; título = "{Tipo de documento} — {Fornecedor}" (ex. "CND Federal — Atlas Schindler"); descrição = "Requisito: {tipo} · Tipo: {categoria}"; ações: "Editar metadados" (secondary), "Enviar nova versão" (primary).
2. `InlineNotice tone="warning"` condicional (quando há versão em andamento): "Nova versão em andamento: arquivo recebido, aguardando revisão. O envio segue em 3 etapas — reservar versão, enviar arquivos, confirmar — e pode falhar em qualquer etapa isoladamente." (comunica que o processo de upload é transacional em 3 passos e cada passo pode falhar independentemente — importante para tratamento de erro no backend).
3. **Grid 2 colunas** (1 col ≤860px):
   - Painel "Documento": `DetailList` com Fornecedor, Tipo de documento, Situação, Versão atual aceita (com data de validade).
   - Painel "Metadados ({tipo})": `DetailList` com campos específicos do tipo de documento (ex. para CND Federal: Órgão emissor, Número da certidão, Data de emissão) + indicador de campo obrigatório pendente em destaque (texto em cor de aviso, ex. "CNPJ do emissor — não informado").
4. **Painel "Versões"** (header com título + contagem): `DataTable` compacta "Histórico de versões", colunas:
   - Versão (primary, ex. "v3", "v2")
   - Status: `StatusBadge` — RECEIVED/UNDER_REVIEW tone `warning`, ACCEPTED/SUPERSEDED tone `neutral`, REJECTED tone `critical`
   - Origem (ex. "Upload manual", "Solicitação (guest)")
   - Emitido em (data)
   - Revisor ("—" se não revisado)
   - Ações: se status RECEIVED → "Revisar" (link para A13/fila com este item selecionado); senão → "Ver arquivo"

## Dados de exemplo

```
Documento: Fornecedor=Atlas Schindler, Tipo=CND Federal, Situação=Ativo, Versão atual aceita=v2 · válida até 12/03/2027
Metadados: Órgão emissor=Receita Federal, Número da certidão=AB1234567890, Data de emissão=12/09/2026, campo pendente=CNPJ do emissor
Versões: v3 RECEIVED (07/09/2026, upload manual) | v2 SUPERSEDED (12/03/2026, Marina Costa) | v1 SUPERSEDED (10/03/2025, Solicitação guest, Marina Costa)
```

## Regras de negócio

- Estados de versão: `RECEIVED` (recebida, aguarda revisão) → `UNDER_REVIEW` (revisor reivindicou) → `ACCEPTED` (aceita, vira versão vigente) ou `REJECTED`; versão anterior aceita vira `SUPERSEDED` quando uma nova é aceita.
- Upload de nova versão é um processo de 3 etapas (reservar → enviar arquivo → confirmar), cada etapa pode falhar isoladamente — tratar como transação com possibilidade de estado intermediário/retomável.
- Metadados são específicos por tipo de documento (ver Catálogo de Tipos, A20) — campos obrigatórios não preenchidos devem ser destacados visualmente.
