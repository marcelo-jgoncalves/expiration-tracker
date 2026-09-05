# Rodadas 1-2 — Dossiê Documental PDF/Excel (Roadmap P1, item 16)

## Rodada 1 — Proposta Claude (resumo)

Contexto: roadmap (`roadmap-competitivo-2026-09-01.md:108`) só diz "Dossiê documental PDF/Excel —
facilita auditorias, compliance e compartilhamento". Journey J22
(`docs/frontend/document-domain-journeys-and-acceptance-criteria-v0.2.md:813-836`) mais
específica: "visão consolidada de um Subject", exige "autocontido... entendido fora da
aplicação" e "mostra escopo antes de exportar". `pdf-lib` só é usado para PARSEAR upload
(`parser.ts:16,39`), `PDFDocument.create()` nunca chamado; nenhuma lib de Excel existe.

E-014 SIM PARCIAL: Drata ("Pre-Audit package", evidência consolidada por período) e Vanta
("evidence list"/"policy packet", exports separados) — nenhum dos dois mescla bytes reais num
PDF único, mas convergência mais fraca do que inicialmente lida (ver crítica).

Proposta inicial: dossiê metadata-only (nunca bytes), reuso de `getRequirementsBySubject`, PDF via
`pdf-lib`+Excel via nova lib, entrega assíncrona (padrão D-204), RBAC "ADMIN_ROLES ou assignee".

**Nota cega Codex Rodada 1: 7,2/10.** Achados: (1) pesquisa superestimava "nunca bytes" — Drata/
Vanta oferecem ZIP/pacotes de evidência, não só metadado puro; (2) conteúdo "autocontido"
subatendido pelos campos cacheados do `Requirement` sozinhos; (3) RBAC "ADMIN_ROLES ou assignee"
mal especificado — `authorization.ts:323` só aplica gate de assignee quando `ownerUserId` E
`assigneeUserId` existem juntos, `Requirement` não tem `ownerUserId`; assignee de 1 Requirement
exportando o Subject inteiro é disclosure real; (4) "sempre assíncrono" defensável mas precisa
contrato explícito sobre truncamento; (5) formato de saída (PDF/Excel/ambos/pacote) não nomeado
como bloqueio de produto; (6) sanitização de conteúdo Excel (formula injection) e falta de layout
engine no `pdf-lib` não endereçadas.

## Rodada 2 — Revisão Claude + crítica Codex

Aceitos os 6 pontos: (1) linguagem suavizada para "manifesto metadata-first, bytes fora do v1
como decisão futura separada"; (2) conteúdo enriquecido (nome/tipo do Document, DocumentVersion
completo, histórico de versões); (3) RBAC simplificado para **ADMIN_ROLES exclusivamente**
(removida a opção assignee); (4) contrato "sem truncamento silencioso" — geração assíncrona
sempre completa, falha declarada (`DossierTooLargeError`) em vez de artefato parcial disfarçado;
(5) proposta mínima: gerar sempre PDF+XLSX, dois downloads separados via `format=pdf|xlsx`, sem
pacote ZIP; (6) reuso do precedente de mitigação de formula-injection de
`src/shared/csv/csv-export-writer.ts` para o writer de Excel novo, tabela PDF simples/
determinística sem lib de layout nova.

**Nota cega Codex Rodada 2: 8,3/10.** Achados restantes: (1) histórico de relink do Requirement
não é reconstruível (`linkEvidence`/`unlinkEvidence` só sobrescrevem ponteiros, sem evento
próprio) — precisa virar limitação explícita; (2) `listVersionsUnchecked()` não expõe eventos de
decisão granulares, só a lista de versões; (3) "mesmo conteúdo PDF+XLSX" conflita com truncamento
visual no PDF — papéis dos dois formatos precisam ser declarados distintos; (4) tab/controle como
gatilho de formula-injection no Excel é extensão deliberada, não precedente literal do CSV; (5)
contrato físico do run precisa dizer se 1 `DossierExportRun` gera os dois artefatos ou cada
formato dispara geração separada.
