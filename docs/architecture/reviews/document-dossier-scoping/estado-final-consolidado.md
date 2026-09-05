# Estado Final Consolidado — Roadmap P1 item 16 ("Dossiê documental PDF/Excel")

**Status: `APPROVED` — design técnico, protocolo Claude↔Codex (`AGENTS.md` §4) completo, 4
rodadas, nota cega final Claude 9,3/Codex 9,2 (ambos ≥9,0, sem arredondar). Evidência completa:
`rounds1-2-claude-codex.md`, `rounds3-4-claude-codex-final.md` (neste diretório). DESIGN-ONLY —
nenhum código/schema/infra alterado.**

## Origem

Journey J22 (`docs/frontend/document-domain-journeys-and-acceptance-criteria-v0.2.md:813-836`):
"Exportar dossiê documental" — visão consolidada de um Subject, autocontida, com escopo mostrado
antes de exportar. D-198 confirmou nenhuma capacidade de geração de PDF/Excel existe hoje
(`pdf-lib` só parseia upload, nenhuma lib de Excel).

## Pesquisa externa (E-014): SIM PARCIAL

Drata "Pre-Audit package" e Vanta "evidence list/policy packet" (fontes primárias, 2026-09-05) —
nenhum dos dois mescla bytes de documento num PDF único, mas oferecem pacotes/ZIP de evidência
(não só metadado puro — correção da Rodada 1, achado real do Codex).

## Achados reais que fecharam as 4 rodadas (todos do Codex, verificados por leitura de código)

1. RBAC "ADMIN_ROLES ou assignee" não funcionaria — `authorization.ts:323` só aplica o gate de
   assignee quando `ownerUserId` E `assigneeUserId` existem juntos no resource; `Requirement` não
   tem `ownerUserId`. Fechado: **ADMIN_ROLES exclusivamente**.
2. Histórico de relink de evidência não é reconstruível (`linkEvidence`/`unlinkEvidence` só
   sobrescrevem ponteiros atuais, sem evento próprio) — fechado como limitação explícita nomeada
   do v1, não escondida.
3. PDF+XLSX "mesmo conteúdo" conflitava com truncamento visual — fechado declarando papéis
   distintos: XLSX exaustivo (nunca trunca texto), PDF narrativo (pode envolver texto, nunca omite
   uma linha/Requirement inteiro).
4. `POST` disparar geração imediatamente não cumpria J22 ("mostra escopo antes de exportar") —
   fechado com fluxo preview (`PREVIEW_READY`, sem worker)/confirm (`scopeHash` obrigatório,
   idempotente, dispara worker).
5. Semântica "as of" ambígua — fechado declarando: conjunto de linhas = congelado no preview;
   valores de campo = relidos frescos na geração (nunca stale), `generatedAt` explícito no
   documento gerado.

## Design final (11 decisões)

1. **Escopo v1**: manifesto metadata-first autocontido — nome/status/validade/responsável/
   histórico de versões por Requirement. Bytes de documento escaneado explicitamente FORA de v1
   (decisão futura separada, não porque o mercado "nunca" faz isso, mas por proporcionalidade).
2. **`DossierExportRun`**: `POST /document-archive/subjects/{subjectId}/dossier` cria o run em
   `PREVIEW_READY` (nunca dispara worker) — resposta já é o preview (requirementIds+campos) +
   `scopeHash` (fingerprint canonical JSON+SHA-256, inspirado no padrão de fingerprint de D-194).
3. **Confirm**: `POST .../dossier/{runId}/confirm` (idempotente, exige o mesmo `scopeHash` —
   divergência → 409, força novo preview) dispara UM worker que gera PDF+XLSX na MESMA execução.
4. **Semântica as-of**: conjunto de linhas congelado no preview; valores relidos frescos na
   geração (convenção de releitura fresca de D-193); `generatedAt` declarado no documento.
5. **Sem truncamento silencioso**: geração assíncrona sempre completa (pagina `queryByPk` até o
   fim); se um limite de tamanho for excedido, falha declarada (`DossierTooLargeError`), nunca
   artefato parcial disfarçado de completo.
6. **XLSX exaustivo / PDF narrativo**: mesmo CONJUNTO de dados, papéis de apresentação distintos
   e declarados (XLSX nunca trunca célula; PDF pode wrap/reticências em texto longo, nunca omite
   linha).
7. **Sanitização Excel**: reusa + estende o precedente de `csv-export-writer.ts` (formula-
   injection, `=`/`+`/`-`/`@`, mais tab/controle conforme a lib escolhida exigir).
8. **PDF sem lib de layout nova**: `pdf-lib`'s API de criação, tabela simples/determinística
   (linhas fixas por página, altura fixa), decisão de engenharia proporcional.
9. **Entrega**: `GET .../dossier/{runId}/download?format=pdf|xlsx` só autoriza (ADMIN_ROLES) +
   entrega via presign S3 sob demanda (mesmo padrão de D-204), nunca dispara geração nova.
10. **RBAC**: `ADMIN_ROLES` exclusivamente para o dossiê completo do Subject — sem tier de
    assignee (removido após achado real de disclosure).
11. **Limitação nomeada**: histórico de relink de evidência para `documentId` diferente não é
    reconstruível no v1 (declarado explicitamente no documento gerado, não escondido).

## Escopo explicitamente fora desta decisão

Bundle evidenciário completo (bytes de documento escaneado embutidos/mesclados) — decisão de
produto/design separada, nível 5-6 própria, se algum dia necessária; pacote ZIP único (v1 gera
dois downloads separados via `format=`); log evento-a-evento de decisões (v1 usa lista de
versões, não histórico granular).

## Próxima ação

Implementação real fica para sessão dedicada futura, mesmo padrão de D-121/D-127/D-179/D-191/
D-194/D-197/D-204. Fatias sugeridas (não decididas aqui): (1) `DossierExportRun` + rotas
preview/confirm + `scopeHash`; (2) worker de geração (PDF via `pdf-lib`, XLSX via nova
dependência) + S3 + `DossierTooLargeError`; (3) rota de download autenticada com presign sob
demanda.
