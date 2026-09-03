# Prompt de início — próxima sessão (gerado em 2026-09-02/03, virada de dia)

> Cole o texto abaixo (a partir de "Leia") como a primeira mensagem da próxima sessão sobre o `expiration-tracker`. Este arquivo é histórico/handoff (`AGENTS.md` §5) — o `NEXT_SESSION_PROMPT.md` é a fonte de estado real, este arquivo só empacota o prompt de arranque. **Supersede `2026-09-02-session-starter-prompt-v3.md`** (sessão anterior — os itens dela, D-184/submitEvidence e a migração `requirement-reindex`, foram fechados como D-184/D-185; esta sessão fechou os 5 workers restantes do `MaintenanceDueIndex`, D-186 a D-190, e abriu a próxima frente real: o roadmap de lançamento).

---

Leia `NEXT_SESSION_PROMPT.md` e `AGENTS.md` inteiro antes de qualquer coisa. Confirme `git branch --show-current` (deve ser `develop`), rode `git pull`, e confirme que `develop` está sincronizado com `main` (`git fetch origin main && git diff origin/main..develop --stat` deve dar vazio).

**Padrão de trabalho autônomo (reforçado por Marcelo, 2026-09-01/02/03 — vale para toda sessão futura, não só esta): prossiga de forma totalmente autônoma e contínua enquanto houver qualquer trabalho de engenharia real e não-ambíguo a fazer. Não pare a não ser que genuinamente não haja mais nada a fazer.** Nunca pare para perguntar "posso continuar?". Qualquer coisa que dependa de uma decisão que só Marcelo pode tomar (decisão de produto/preço, ação destrutiva/irreversível, gasto real de infra novo, ou algo que o protocolo Claude↔Codex do `AGENTS.md` §4 formalmente exige elevar a ele) deve ser **adiada, não perguntada** — registre o pendente claramente em `NEXT_SESSION_PROMPT.md`/`decisions-log.md` e siga imediatamente para a próxima frente de trabalho independente disponível.

**Achado de processo real desta sessão, válido para todas as futuras**: subagentes em background que rodam `npm test`/`terraform test`/`gh run watch` como comando backgrounded e depois "esperam a notificação" ficam travados — um subagente não recebe notificação assíncrona como a sessão principal recebe. Sempre instruir (e, ao delegar, escrever explicitamente no prompt do subagente) para rodar esses comandos **de forma síncrona no mesmo tool call** (ou fazer polling num loop bash com `sleep`, na mesma chamada), nunca "background e espera". Isso aconteceu 3 vezes nesta sessão (D-186, D-189, D-190) e sempre exigiu retomada manual da sessão coordenadora.

**Múltiplas sessões/agentes rodam em paralelo neste repo com frequência.** Se um arquivo mudar de forma inesperada enquanto você edita, pare, confira `git status`/`ListAgents`, e coordene via mensagem antes de forçar através de uma colisão.

## Estado ao final desta sessão (2026-09-02/03)

**D-179 (`MaintenanceDueIndex`) está FECHADO POR COMPLETO — os 9 workers nomeados pelo design foram migrados de `Scan`+`Limit` para GSI8, um a um, cada um verificado ao vivo contra `dev` com prova de isolamento IAM cross-namespace real (`aws iam simulate-principal-policy`):**

| Worker | D-number | Nuance real |
|---|---|---|
| `membership-purge` | D-180/D-181 | Piloto — achou e corrigiu um bug real de deploy (Sid IAM não-alfanumérico) |
| `invitation-purge` | D-182 | Ponteiro PENDING gravado na criação, não numa transição posterior |
| `document-file-reconciliation` | D-183 | Achou que o mecanismo GSI5 anterior nunca teve writer real — código morto |
| `requirement-reindex` | D-185 | Confirmou que o worker só faz drift SATISFIED→NOT_SATISFIED |
| `quota-telemetry-purge` | D-186 | 2 tipos de entidade sem `version`; achou e corrigiu o bug do guard `main()` no Windows (só neste script) |
| `security-audit-purge` | D-187 | 4 tipos de entidade append-only; ponteiro centralizado nas 4 funções `build*Event()` |
| `transient-purge` | D-188 | 2 tipos de entidade com dinâmicas diferentes (create-once vs. multi-transição); achou e corrigiu violação real de fronteira `shared→modules` |
| `delivery-record-purge` | D-189 | 2 tipos de entidade com `version` real; reconfirmou gap conhecido órfão (`NotificationAttemptLookup`, herdado de D-152, não corrigido) |
| `core-user-data-purge` | D-190 | Última fatia — mesma forma do piloto (transição de soft-delete, não criação); achou gap pré-existente real (`ReminderPolicy.deletedAt` nunca tem write path) |

Suíte de testes: 1841 → 1929 (backend) ao longo dessas 5 fatias finais. `develop`/`main` sincronizados (diff zero) ao final, PR #218 (fechamento de D-190) prestes a mergear/já mergeado — confirmar.

**Item pendente real, não bloqueante, carregado para a próxima sessão**: o bug do guard `main()` (`if (import.meta.url === \`file://${process.argv[1]}\`)` nunca casa no Windows/Git Bash deste ambiente — `main()` silenciosamente nunca roda, sem erro) foi corrigido nos 5 scripts novos desta sessão (`backfill-gsi8-{quota-telemetry-purge,security-audit-purge,transient-purge,delivery-record-purge,core-user-data-purge}.ts`) mas **continua presente em 6 scripts irmãos mais antigos**: `backfill-gsi8-{document-file-reconciliation,invitation-purge,membership-purge,requirement-reindex}.ts`, `backfill-reminder-policies.ts`, `reset-dev-data.ts`. Ação recomendada: aplicar o mesmo fix de uma linha (`fileURLToPath(import.meta.url) === process.argv[1]`) nos 6, e reverificar/reexecutar os backfills de D-180/D-182/D-183/D-185 contra `dev` para confirmar se os ponteiros GSI8 daquelas fatias realmente foram escritos — não presumir que já estão corretos só porque a sessão anterior relatou sucesso sem esse fix.

## Nenhuma decisão pendente de Marcelo neste momento

Marcelo confirmou nesta sessão: terminar os workers de D-179 primeiro (feito), depois entrar direto no roadmap de lançamento. Não há decisão bloqueante aberta agora.

## Próxima ação real, em ordem de valor esperado

1. **Roadmap de lançamento (`docs/project/roadmap-competitivo-2026-09-01.md`) — COMEÇAR AGORA, item 1: Requirement Templates.** Este é o documento normativo que define os 11 itens **P0** necessários antes do lançamento comercial, em ordem já decidida. Auditoria real do estado de cada item (feita nesta sessão, ver `NEXT_SESSION_PROMPT.md` para a tabela completa e os grep/leituras que a embasam):
   - Requirement Templates (item 1) — ❌ não implementado, explicitamente deferido no código (`requirement-assignment.ts`). **Candidato a nível 5-6, provável protocolo Claude↔Codex/E-014** (define um padrão — templates/checklists reutilizáveis — que sistemas fora do projeto já resolveram) — escopar de verdade antes de estimar risco, não presumir.
   - Bulk onboarding (item 2) — 🟡 parcial, `src/modules/import/` existe mas escopo real (cobre Documents+Requirements como o roadmap pede?) não confirmado.
   - WhatsApp (item 3) — ❌ não implementado, só modelado no type system.
   - IA/OCR integrada ao novo Document Lifecycle (item 4) — 🟡 parcial, M7 é E2E PROVEN mas contra o lifecycle antigo.
   - Busca/filtros (item 5) — ❓ não investigado ainda.
   - Dashboard (item 6) — ❌ nenhuma implementação real encontrada.
   - Relatórios/export/audit (item 7) — 🟡 parcial (export CSV D-126, Admin Activity Log D-149).
   - Document Types (item 8) — 🟢 bem avançado (D-173→D-186), falta só o item 6 do design original.
   - Guest Collection (item 9) — 🟡 backend avançado (D-143-D-147).
   - Storage/Versioning/Renewal (item 10) — 🟢 avançado (D-163-D-168).
   - Frontend completo (item 11) — ❌ não iniciado, deliberadamente por último (estratégia do próprio roadmap).
2. **Item de manutenção não-bloqueante, pode intercalar**: fix do guard `main()` nos 6 scripts irmãos restantes + reverificação dos backfills antigos (ver acima) — nível 1-2, mecânico, não precisa de protocolo.
3. **Depois do `DocumentType` fechar por completo** (item 6 do design original, `docs/architecture/reviews/document-type-scoping/estado-final-consolidado.md` §6): item 4 (adaptar M7/OCR ao novo `DocumentVersion`) ou item 1 (Requirement Templates, desbloqueado por `documentTypeId` estável) da macro-ordem de D-161 — mas note que o roadmap de lançamento (item acima) já reordena isso: Requirement Templates é o item 1 do roadmap de lançamento, então provavelmente já é a prioridade real agora, não um "depois".
4. Achados nível 5-6 ainda sem rodada Claude↔Codex, mais antigos, menor prioridade que o roadmap de lançamento: fast path do `RequestContext`, redesign do Reminder Producer.
5. **Wave 1b (Design System)** — deliberadamente por último, pedido explícito de Marcelo.
6. Ou uma nova frente que Marcelo trouxer.

## Leitura obrigatória antes da próxima ação

`AGENTS.md` §2 → `NEXT_SESSION_PROMPT.md` (seção "Roadmap de lançamento", já com a auditoria completa dos 11 itens) → `docs/project/roadmap-competitivo-2026-09-01.md` inteiro (a fonte normativa) → se começar Requirement Templates, ler `docs/architecture/reviews/document-type-scoping/` e o histórico de `Requirement`/`RequirementAssignment` (`src/modules/subject/domain/requirement-assignment.ts`) para entender o que já existe e não reinventar; escopar antes de estimar nível de risco.
