---
status: draft
owner: Marcelo
authority: informativo (decisão de domínio reconciliada via protocolo AGENTS.md §4; promovida a ADR/lista de rejeitados formal só na Fase 3)
---

# Fase 2b — Custom fields: rejeitado/adiado por padrão

Sexto cluster de decisão da Fase 2. Decisão nível 4 (`change-risk-scale.md` — decidir NÃO
construir algo também é decisão registrada, mas de baixo risco por ser conservadora). Protocolo
Claude↔Codex completo via MCP, sandbox read-only, eixo Arquitetura.

**Nota final: Claude 9,1 / Codex 9,0 — gate ≥9,0 atingido, sem arredondar.**

## Decisão

**`FieldDefinition`/`FieldValue` (schema dinâmico genérico) fica registrado como capacidade
REJEITADA/ADIADA por padrão**, não implementada agora. Convergência forte e evidência real
sustentam a decisão:

- Zero custom fields hoje (confirmado, `01-gap-analysis.md`).
- Evidência de mercado real de risco: myCOI (concorrente líder) tem reclamação documentada
  (`02-market-research.md`) de que complexidade de configuração cresce muito com "requisitos
  customizados por vendor" — não é cautela hipotética.
- O prompt estratégico já avisa "evite construir um Airtable" (§23).
- Schema dinâmico por tenant enfraqueceria a decisão arquitetural central do projeto (JSON
  Schema + Ajv como fonte de verdade dos contratos, `src/shared/contracts/schema-validator.ts`).

### Alternativa adotada agora (cobre ~80% do valor sem o custo)

- `TrackedSubject.tags[]` (já decidido no cluster 1) — segmentação, filtros simples, agrupamento.
- `RequirementAssignment.requirementName` texto livre (já decidido no cluster 1) — requisito
  customizado sem `RequirementDefinition`.
- **Emenda ao cluster 1** (`03-domain-model-tracked-subject-requirement.md`, registrada aqui, não
  reescrita lá para não duplicar fonte de verdade): `TrackedSubject.notes?: string` e
  `RequirementAssignment.notes?: string` — observação humana não indexada, não pesquisável, não
  usada em automação, editável **só pelo lado do tenant** (nunca pelo convidado do fluxo de guest
  upload/chasing). Isso é ajuste posterior ao cluster 1, não fato já decidido nele — evita 2
  versões concorrentes do mesmo agregado em documentos diferentes.

Suficiente para os primeiros 10-30 clientes: a dor crítica validada por mercado é o fluxo
operacional (subject/vendor → requisito → documento → vencimento → cobrança/chasing →
confirmação humana), não um modelador de dados customizado.

### Se algum dia for inevitável (plano de contingência, não recomendação atual)

Só `TrackedSubject` primeiro (nunca `ExpirationItem`, para não contaminar o core já estável de
vencimento/renovação). Tipos aceitos: `TEXT`, `DATE`, `SELECT`, `BOOLEAN` (não `NUMBER`/`URL` no
v1 — puxam validação/normalização própria). Sem índice novo, sem busca, sem ordenação por custom
field. Sem fórmula, campo condicional, dependência entre campos, permissão por campo, template
global. Limites duros (ex. máx. 10 campos/tenant, máx. 3 `SELECT`, máx. 50 opções/`SELECT`), API
validada por schema JSON estático, nunca payload livre.

### Achado colateral registrado (fora de escopo desta rodada)

Existe caso legítimo de o **convidado** (fluxo de guest upload/chasing) querer deixar uma
observação ("não tenho esse documento, só a versão anterior") — mas isso NÃO deveria ser
`RequirementAssignment.notes` (tenant-only). Se entrar, seria campo próprio em
`DocumentSubmission` (cluster 2), ex. `submitterMessage?: string`, append-only, ligado à
submissão. **Não decidido nesta rodada** — registrado como extensão pequena possível do cluster
2, não como argumento para custom fields genéricos.

## Enquadramento para a Fase 3

Registrar `FieldDefinition`/`FieldValue` genérico no entregável Q (capacidades rejeitadas),
deixando explícito: customização v1 atendida por `tags[]`+`requirementName`+`notes?`; reabertura
exige evidência de cliente real com caso de uso repetido e access patterns explícitos, não
capacidade técnica disponível.

## Próxima ação

Último cluster antes da Fase 3: CSV import/export (eixo Qualidade de Engenharia + Segurança).
