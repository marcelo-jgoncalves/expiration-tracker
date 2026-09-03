# Prompt de início — próxima sessão (gerado em 2026-09-03, fim de sessão)

> Cole o texto abaixo (a partir de "Leia") como a primeira mensagem da próxima sessão sobre o `expiration-tracker`. Este arquivo é histórico/handoff (`AGENTS.md` §5) — o `NEXT_SESSION_PROMPT.md` é a fonte de estado real, este arquivo só empacota o prompt de arranque. **Supersede `2026-09-03-session-starter-prompt-v4.md`** (sessão anterior — fechou D-179/9 workers e abriu o roadmap de lançamento; esta sessão fechou D-191, D-192, D-193 por completo e aprovou o design de D-194).

---

Leia `NEXT_SESSION_PROMPT.md` e `AGENTS.md` inteiro antes de qualquer coisa. Confirme `git branch --show-current` (deve ser `develop`), rode `git pull`, e confirme que `develop` está sincronizado com `main` (`git fetch origin main && git diff origin/main..develop --stat` deve dar vazio).

**Padrão de trabalho autônomo (reforçado por Marcelo repetidamente ao longo desta sessão — vale para toda sessão futura, não só esta): prossiga de forma totalmente autônoma e contínua enquanto houver qualquer trabalho de engenharia real e não-ambíguo a fazer. Não pare para perguntar "posso continuar?" no próximo passo óbvio de um roadmap já aprovado.** Isso foi corrigido explicitamente nesta sessão depois que o agente parou para confirmar o item 2 do roadmap sem necessidade — Marcelo foi direto: "você não deve parar para me perguntar esse tipo de coisa. A instrução que te dei foi trabalhar com autonomia". Só pause/pergunte quando o próximo passo depender genuinamente de uma decisão que só Marcelo pode tomar (decisão de produto/preço, ação destrutiva/irreversível, gasto real de infra novo, ou algo que o protocolo Claude↔Codex do `AGENTS.md` §4 formalmente exige elevar a ele) — nesses casos, registre o pendente e siga para a próxima frente independente, nunca fique ocioso.

**Regra nova, explícita desta sessão: NUNCA trocar o modelo de um subagente (ex.: Sonnet→Opus) por conta própria, mesmo que um agente anterior tenha falhado ou entregue pouco.** Marcelo pediu isso depois que a sessão relançou um agente com `model: "opus"` sem perguntar. Se um agente falha ou entrega um relatório de escopo em vez de trabalho real, a resposta é relançar com o MESMO modelo e instruções mais diretas/específicas — nunca escalar modelo silenciosamente.

**Protocolo "Dividir para Conquistar" (nomeado explicitamente por Marcelo nesta sessão, vale para todo projeto)**: ao delegar trabalho grande a um subagente, divida em fases/fatias sequenciais menores e autocontidas em vez de um mega-prompt único — cada fatia recebe o output concreto da anterior (design aprovado, arquivos tocados, decisões) e prossegue sem re-derivar contexto. Esta sessão usou isso com sucesso em duas features grandes (D-192: 9 fatias; D-193: 9 fatias) depois que a primeira tentativa de mega-prompt único (fase de implementação de D-192) falhou por um agente que só pesquisou e devolveu relatório em vez de implementar.

**Achado de processo real desta sessão, reforça o handoff anterior**: subagentes que rodam `gh run watch`/CI polling em background e "esperam notificação" ficam travados — um subagente não recebe notificação assíncrona como a sessão principal. Sempre instruir explicitamente (e escrever no prompt do subagente) para fazer polling síncrono do `databaseId` específico dentro da MESMA tool call, nunca background-e-espera. Isso quase aconteceu de novo no fechamento de D-192 (um agente disse "vou pausar aqui esperando o CD") — mas o mesmo agente, por sorte, recebeu a notificação e retomou sozinho; a sessão coordenadora ainda teve que verificar tudo de forma independente porque a atualização de doc do agente nunca foi commitada. **Sempre confira manualmente após um agente relatar "verificação ao vivo completa" — não é garantido que o commit realmente aconteceu.**

**Rate limits de sessão aconteceram 3 vezes nesta sessão** (resets em horários variados) — quando um subagente falha com `rate_limit`/HTTP 429 antes de editar qualquer arquivo, é seguro simplesmente relançar a mesma tarefa assim que o horário de reset (dado no erro, fuso America/Sao_Paulo) passar; confirme com `TZ='America/Sao_Paulo' date` antes de assumir que ainda está bloqueado.

## Estado ao final desta sessão (2026-09-03)

**Três itens do roadmap de lançamento fechados por completo, um quarto com design aprovado:**

| Item do roadmap | D-number | Status |
|---|---|---|
| 1. Requirement Templates | D-191 | 🟢 IMPLEMENTADO, mergeado, verificado ao vivo |
| 2. Bulk onboarding/importação em massa | D-192 | 🟢 IMPLEMENTADO (9 fatias), mergeado, verificado ao vivo |
| 3. WhatsApp operacional | — | ❌ BLOQUEADO em decisão de fornecedor/custo de Marcelo — engenharia é pequena, mas exige conta/vendor/custo recorrente real |
| 4. IA/OCR integrada ao Document Lifecycle | D-193 | 🟢 IMPLEMENTADO (9 fatias), mergeado, verificado ao vivo — flags de ativação deliberadamente OFF |
| 5. Busca e filtros documentais | D-194 | 🟡 design `APPROVED` (5 rodadas, Claude 9,2/Codex 9,3) — **implementação NÃO iniciada** |

`develop`/`main` sincronizados (diff zero) ao final desta sessão.

**D-192 (Bulk Import) — achados reais ao longo das 9 fatias**: nenhum bug de produção crítico, mas um achado de processo (a fatia final relatou "verificação ao vivo completa" e uma atualização de doc que nunca foi commitada — a sessão coordenadora teve que corrigir manualmente).

**D-193 (OCR/Extraction reconciliation) — achados reais ao longo das 9 fatias, o mais rico em bugs pré-existentes desta sessão**:
1. **Bug crítico de produção real, corrigido na fatia 1**: uploads via `document-archive` (o pipeline NOVO, D-163+) ficavam presos em `PENDING_UPLOAD` PARA SEMPRE — os handlers físicos (`upload-finalizer-handler.ts`/`malware-result-handler.ts`) só reconheciam os formatos de chave do módulo `document` ANTIGO, uma chave `document-archive/...` era descartada silenciosamente sem retry/DLQ.
2. Payload de evento faltando `versionId` (fatia 6) — o worker de convergência assíncrona de `Requirement` não tinha como descobrir qual `DocumentVersion` refrescar.
3. Nome de role IAM excedendo o limite de 64 caracteres do IAM (fatia 7), pego por uma falha real de `terraform test`.
4. Violação de fronteira `domain-must-not-reach-application-layers` (fatia 8), pega por `test/architecture/tenant-fence-boundary.test.ts` na primeira rodada.
5. Um teste `terraform test` desatualizado desde D-179 (contava 7 GSIs quando já existiam 8) — corrigido de passagem na fatia 5.

**D-193 flags de ativação (`EXTRACTION_DOCUMENT_ARCHIVE_TRIGGER_ENABLED`/`DOCUMENT_ARCHIVE_PROMOTION_ENABLED`) seguem OFF** — decisão deliberada e reversível, não um bloqueio técnico: nenhuma fatia testou o mecanismo contra tráfego real em `dev` (só `InMemoryDocumentArchiveStore`/mocks), então ligar agora seria a primeira exposição real ao Textract sem supervisão dedicada. Sem urgência dado "sem usuários reais" (`AGENTS.md` §1).

**D-194 (Busca e filtros) — design aprovado, dividido em fatias pelo próprio design**, ver `docs/architecture/reviews/search-and-filters-scoping/estado-final-consolidado.md`:
- Fatia 1: `src/shared/domain/validity-state.ts` (nível 3-4, sem novo protocolo) — unifica válido/vencendo/vencido/permanente/aguardando-revisão através de 4-5 enums diferentes.
- Fatia 2: `Requirement.assigneeUserId` + mecanismo completo transportado de `ExpirationItem.assigneeUserId` (D-122/D-125) — nível 5.
- Fatia 3: 3 modos de busca (`searchSubjects`/`searchRequirements`/`searchExpirationItems`) via GSI7/GSI1 já existentes, SEM GSI novo — nível 4.
- Fatias 4-5: materialização/projeção dedicada e índice por assignee — deferidas com gatilho quantitativo nomeado no design, não construir ainda.
- Achado real que redirecionou o design: `Document` não tem `name`/`tags` — busca por nome é sobre `TrackedSubject` (via GSI7), não sobre `Document` diretamente.

## Próxima ação real, em ordem de valor esperado

1. **D-194, Fatia 1** (`validity-state.ts`) — começar aqui, é a base das outras duas fatias, nível 3-4, sem protocolo novo necessário salvo achado real durante a implementação.
2. **D-194, Fatia 2** (`Requirement.assigneeUserId`) — depois da fatia 1.
3. **D-194, Fatia 3** (3 modos de busca) — depois da fatia 2.
4. **Item 3 do roadmap (WhatsApp)** segue bloqueado — só retomar se Marcelo trouxer a decisão de fornecedor/custo. Não é bloqueante para o resto do roadmap.
5. Depois de D-194 completo: item 6 (Dashboard), item 7 (Relatórios), item 9 (Consolidar Guest/Requests/Review/Recurrence) — nenhum investigado a fundo ainda nesta rodada, escopar antes de estimar.
6. Pendentes menores herdados, não bloqueantes: `RT-LANE-FALLBACK-01` (D-191), backfill de `RequirementNamePointer` (D-191), bug do guard `main()` em 6 scripts antigos (D-186→D-190), Range GET real de 64 KiB (D-192), decisão de ativar as flags de D-193.

## Leitura obrigatória antes da próxima ação

`AGENTS.md` §2 → `NEXT_SESSION_PROMPT.md` (seção "Roadmap de lançamento", auditoria completa dos 11 itens) → se retomar D-194, ler `docs/architecture/reviews/search-and-filters-scoping/estado-final-consolidado.md` inteiro antes de escrever qualquer código — a divisão em fatias já está decidida ali, não redecidir.
