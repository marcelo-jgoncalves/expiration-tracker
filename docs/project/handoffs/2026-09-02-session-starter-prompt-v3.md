# Prompt de início — próxima sessão (gerado em 2026-09-02, fim de tarde/noite)

> Cole o texto abaixo (a partir de "Leia") como a primeira mensagem da próxima sessão sobre o `expiration-tracker`. Este arquivo é histórico/handoff (`AGENTS.md` §5) — o `NEXT_SESSION_PROMPT.md` é a fonte de estado real, este arquivo só empacota o prompt de arranque. **Supersede `2026-09-02-session-starter-prompt-v2.md`** (sessão anterior no mesmo dia — os itens dela, D-175/submitEvidence e a migração `requirement-reindex`, foram fechados nesta sessão como D-184/D-185).

---

Leia `NEXT_SESSION_PROMPT.md` e `AGENTS.md` inteiro antes de qualquer coisa. Confirme `git branch --show-current` (deve ser `develop`), rode `git pull`, e confirme que `develop` está sincronizado com `main` (`git fetch origin main && git diff origin/main..develop --stat` deve dar vazio).

**Padrão de trabalho autônomo (reforçado por Marcelo, 2026-09-01/09-02 — vale para toda sessão futura, não só esta): prossiga de forma totalmente autônoma e contínua enquanto houver qualquer trabalho de engenharia real e não-ambíguo a fazer. Não pare a não ser que genuinamente não haja mais nada a fazer.** Nunca pare para perguntar "posso continuar?". Qualquer coisa que dependa de uma decisão que só Marcelo pode tomar (decisão de produto/preço, ação destrutiva/irreversível, gasto real de infra novo, ou algo que o protocolo Claude↔Codex do `AGENTS.md` §4 formalmente exige elevar a ele) deve ser **adiada, não perguntada** — registre o pendente claramente em `NEXT_SESSION_PROMPT.md`/`decisions-log.md` e siga imediatamente para a próxima frente de trabalho independente disponível. **Marcelo pediu explicitamente para não atrasar o trabalho** — priorize ritmo: quando um agente em background travar num CI/CD real (não rate limit), prefira assumir o merge/verificação você mesmo a esperar passivamente, sempre com o mesmo rigor de checar o estado real (`gh run view`, `aws --profile claude-dev`) antes de declarar algo pronto.

**Se Marcelo pedir explicitamente que uma decisão pendente passe pelo protocolo Claude↔Codex, faça isso mesmo que a decisão pareça pequena/quase-mecânica** — foi exatamente o caso de D-184 nesta sessão (a decisão a/b/c de D-175 parecia trivial, mas o protocolo real achou um problema genuíno na Rodada 2 — replay idempotente ignorando a validação nova — que não teria sido pego com julgamento direto).

**Achado real de processo, válido para todas as futuras sessões**: uma alegação externa de "CD completou com sucesso" (vinda de outro agente/sessão) deve ser sempre checada diretamente via `gh run view`/`aws --profile claude-dev` antes de agir — já aconteceu mais de uma vez nesta sessão de uma alegação estar errada (run real ainda `failure` ou `in_progress`).

**Múltiplas sessões/agentes rodam em paralelo neste repo com frequência.** Se um arquivo mudar de forma inesperada enquanto você edita, pare, confira `git status`/`ListAgents`, e coordene via mensagem antes de forçar através de uma colisão.

## Estado ao final desta sessão (2026-09-02, continuação da sessão que gerou o handoff v2)

Duas frentes em paralelo, ambas fechadas com merge real em `main` e deploy confirmado ao vivo:

1. **D-184 — decisão pendente de `submitEvidence()`/guest flow do `DocumentType` (D-175) RESOLVIDA**, via protocolo Claude↔Codex completo (pedido explícito de Marcelo), 3 rodadas reais: E-014 9,3/10, design 9,5/10, `APPROVED`. Resolução: opção (b) modificada — `ConditionCheck(DocumentType.status=ACTIVE)` só se aplica quando `documentType` vem explícito no input do guest (presença, não truthy); ausente permanece exatamente como antes (fallback pra `requirementId`, sem validação nova). Opção (a) rejeitada — nem `DocumentRequest` nem `Requirement` referenciam `DocumentType` hoje, sem mecanismo de descoberta para o guest. Achado real do Codex (Rodada 2): replay idempotente ignora a validação nova — mantido deliberadamente (propriedade preexistente do `idempotencyKey`, documentada/testada, não um gap novo). **Arco `DocumentType` (D-173→D-184) sem nenhuma decisão pendente agora** — só falta o item 6 (schema HTTP guest obrigatório + rota pública de leitura de tipos), não iniciado mas livre para começar quando quiser.
2. **D-185 — quarta fatia do `MaintenanceDueIndex`**: `requirement-reindex` migrado para GSI8, mesmo padrão de D-180/D-182/D-183 (sem poison-record/DLQ, mesma decisão de D-183 — nunca houve fence de tenant `ACTIVE` para este worker). Verificação prévia confirmou que o worker só faz drift SATISFIED→NOT_SATISFIED via `Requirement.evidenceValidUntil`, nunca uma "reindexação de applicability" mais ampla. Prova de isolamento IAM confirmada em 4 direções (positivo no próprio namespace + negativo nos 3 já migrados). **4 de 9 workers migrados**: `membership-purge`, `invitation-purge`, `document-file-reconciliation`, `requirement-reindex`.

`develop`/`main` sincronizados (diff zero) ao final. Suíte 1827/1827, todos os gates locais verdes, `terraform test` 22/22.

## Nenhuma decisão pendente de Marcelo neste momento

Diferente do handoff v2, **não há decisão bloqueante aberta agora** — tudo que dependia de Marcelo (D-175) foi resolvido nesta sessão via o protocolo que ele mesmo pediu. Prossiga direto para a próxima ação sem esperar sinal.

## Próxima ação real, em ordem de valor esperado

1. **MaintenanceDueIndex — continuar a migração worker-a-worker** (nível 3-4, implementação direta de design já `APPROVED`, sem protocolo novo): (a) rodar os 4 scripts de backfill já escritos (`membership-purge`/`invitation-purge`/`document-file-reconciliation`/`requirement-reindex`) contra `dev` — write real, custo trivial, decisão <$5 já pré-autorizada pelo `AGENTS.md` §1; (b) migrar os 5 workers restantes (`quota-telemetry-purge`, `security-audit-purge`, `transient-purge`, `delivery-record-purge`, `core-user-data-purge` — ordem não normativa), cada um seguindo o padrão já validado 4x (ver `decisions-log.md` D-180/D-182/D-183/D-185 como templates — cada worker teve uma nuance própria de "quando o ponteiro é gravado"/se precisa de poison-record, não presumir que um padrão mapeia 1:1 sem reler o worker real primeiro).
2. **`DocumentType` item 6** (schema HTTP guest obrigatório + rota pública de leitura de tipos) — agora livre para começar, sem decisão pendente. Nível 3-4, implementação direta do design já `APPROVED` (D-173 §6), sem protocolo novo — a menos que o scoping real revele algo mais complexo (mesma disciplina de sempre: escopar antes de assumir).
3. **Depois do `MaintenanceDueIndex` fechar os 9 workers**: os outros achados nomeados por D-170 que ainda exigem protocolo — fast path do `RequestContext` (nível 5-6) e redesign do Reminder Producer (nível 5-6), ambos sem rodada Claude↔Codex iniciada ainda.
4. **Depois do `DocumentType` fechar por completo**: item 4 (adaptar M7/OCR ao novo `DocumentVersion`) ou item 1 (Requirement Templates, desbloqueado por `documentTypeId` estável) da macro-ordem de D-161 — ordem exata a confirmar na sessão que retomar.
5. **Wave 1b (Design System)** — deliberadamente por último, pedido explícito de Marcelo.
6. Ou uma nova frente que Marcelo trouxer.

## Leitura obrigatória antes da próxima ação

`AGENTS.md` §2 → `NEXT_SESSION_PROMPT.md` (seção "Próxima ação", já atualizada) → `docs/engineering/decisions-log.md` D-180/D-182/D-183/D-185 (os 4 templates reais de migração de worker) → se retomar o item 6 do `DocumentType`, `docs/architecture/reviews/document-type-scoping/estado-final-consolidado.md` §6 e `docs/architecture/reviews/submit-evidence-document-type-scoping/estado-final-consolidado.md` (D-184, mecanismo exato já implementado que o item 6 vai construir em cima).
