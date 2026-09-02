# Prompt de início — próxima sessão (gerado em 2026-09-02, fim de tarde)

> Cole o texto abaixo (a partir de "Leia") como a primeira mensagem da próxima sessão sobre o `expiration-tracker`. Este arquivo é histórico/handoff (`AGENTS.md` §5) — o `NEXT_SESSION_PROMPT.md` é a fonte de estado real, este arquivo só empacota o prompt de arranque. **Supersede `2026-09-02-session-starter-prompt.md`** (sessão anterior no mesmo dia — os itens 1-3 daquele prompt, D-163→D-168/`DocumentFile`, foram fechados nesta sessão, junto com D-169→D-183).

---

Leia `NEXT_SESSION_PROMPT.md` e `AGENTS.md` inteiro antes de qualquer coisa. Confirme `git branch --show-current` (deve ser `develop`), rode `git pull`, e confirme que `develop` está sincronizado com `main` (`git fetch origin main && git diff origin/main..develop --stat` deve dar vazio).

**Padrão de trabalho autônomo (reforçado por Marcelo, 2026-09-01/09-02 — vale para toda sessão futura, não só esta): prossiga de forma totalmente autônoma e contínua enquanto houver qualquer trabalho de engenharia real e não-ambíguo a fazer. Não pare a não ser que genuinamente não haja mais nada a fazer.** Nunca pare para perguntar "posso continuar?". Qualquer coisa que dependa de uma decisão que só Marcelo pode tomar (decisão de produto/preço, ação destrutiva/irreversível, gasto real de infra novo, ou algo que o protocolo Claude↔Codex do `AGENTS.md` §4 formalmente exige elevar a ele) deve ser **adiada, não perguntada** — registre o pendente claramente em `NEXT_SESSION_PROMPT.md`/`decisions-log.md` e siga imediatamente para a próxima frente de trabalho independente disponível. Nunca fique ocioso esperando resposta enquanto houver outra tarefa executável. **Marcelo pediu explicitamente nesta sessão para não atrasar o trabalho** — priorize ritmo: quando um agente em background travar num CI/CD real (não rate limit), prefira assumir o merge/verificação você mesmo a esperar passivamente, sempre com o mesmo rigor de checar o estado real (`gh run view`, `aws --profile claude-dev`) antes de declarar algo pronto.

Para qualquer decisão de arquitetura/segurança/dado/produto real (Type 1, nível 5-6 da escala de risco, ou qualquer coisa que o próprio Marcelo pediu para passar pelo protocolo), use o protocolo Claude↔Codex completo (pesquisa externa quando aplicável — E-014 —, mínimo 3 rodadas, nota cega, gate ≥9.0 sem arredondar, `codex exec --skip-git-repo-check "<prompt>"` em primeiro plano, nunca combinar `- < arquivo.txt` com `&`). Para decisões que o próprio scoping classificar como nível 3-4 — incluindo implementação direta de um design já `APPROVED` por rodada anterior — julgamento de engenharia direto é suficiente, sem nova rodada.

**Achado real de processo desta sessão, vale para todas as futuras**: uma alegação externa de "CD completou com sucesso" (vinda de outro agente/sessão) foi corretamente rejeitada nesta sessão por checagem direta via `gh run view` antes de agir — o run real estava `failure`. Nunca tratar uma alegação não verificada como fato, mesmo vinda de outro agente confiável — sempre confirmar `gh run view`/`aws --profile claude-dev` você mesmo antes de declarar uma fatia pronta.

**Múltiplas sessões/agentes rodam em paralelo neste repo com frequência.** Se um arquivo mudar de forma inesperada enquanto você edita, pare, confira `git status`/`ListAgents`, e coordene via mensagem antes de forçar através de uma colisão — não presuma que você é o único trabalhando.

## Estado ao final desta sessão (2026-09-02, sessão longa, D-162 a D-183)

Esta sessão fechou, nesta ordem, com merge real em `main` e (onde aplicável) deploy confirmado ao vivo em `dev`:

1. **`DocumentFile` (D-163→D-168) — arco inteiro 100% COMPLETO.** Entidade + `reserveFiles()`/fence do PRINCIPAL (D-164); `applyFileScanResult`/`confirmFileScanClean`/`applyFileScanTimeout` (D-165); worker de reconciliação GSI5 (D-166); presign real + rota HTTP de `reserveFiles()` (D-167); gate `fileSetSealed` em `commitUpload()` (D-168). Único item fora de escopo nomeado (não bloqueante): o worker S3/GuardDuty real que chamaria `applyFileScanResult()` em produção — evento de infraestrutura física, sessão dedicada futura.
2. **D-169 — worker de purga `Membership`**: fecha a Prioridade 5 remanescente de D-127 (retenção LGPD), desbloqueado por `Membership.removedAt` (D-158). Deployado e confirmado ao vivo.
3. **D-170 — reconciliação factual de uma auditoria de performance externa** trazida por Marcelo (`docs/project/performance-audit-2026-09-02.md`): confirmou vários achados reais (RequestContext caro, quota `API_REQUEST` transacional, Reminder Producer/Dispatch com loops seriais) e um achado MAIS grave do que o documento original supôs — 9 dos 10 workers de manutenção/purga (incluindo 2 implementados na própria sessão) sofrem de starvation estrutural real via `Scan`+`Limit` sem cursor persistido.
4. **D-171 — fix mecânico do N+1/serialização no Reminder Dispatch**: GetItem direto, leituras paralelas, concorrência limitada no batch SQS preservando `batchItemFailures` por item. Sem protocolo (nível 1-4).
5. **D-172 — D-D de D-136 implementado**: lane `EphemeralTelemetryMutation` real para a quota `API_REQUEST` (design já `APPROVED` numa sessão anterior, implementação direta).
6. **`DocumentType` (D-173→D-178) — arco quase completo, 1 item bloqueado numa decisão de Marcelo.** Design `APPROVED` via protocolo Claude↔Codex completo (D-173, 5 rodadas reais, Claude 9,3/Codex 9,4). Implementado: entidade + CRUD do catálogo (D-174); `createDocument()` gated por `DocumentType.status=ACTIVE` (D-175, **parcial** — `submitEvidence()`/guest flow deliberadamente NÃO tocado, achado real de contradição com o design, ver decisão pendente abaixo); rename `Document.documentType`→`documentTypeId` (D-176); rotas HTTP do catálogo CRUD (D-177); fix de um bug real achado no caminho — rota `reserveFiles()` faltando na allowlist do BFF (D-178). **Item 6 do arco (schema HTTP guest) continua bloqueado, ver "Decisão pendente" abaixo.**
7. **MaintenanceDueIndex (D-179→D-183) — design `APPROVED` + 3 de 9 workers migrados e verificados ao vivo.** Design via protocolo Claude↔Codex completo (D-179, 4 rodadas reais, Claude 9,2/Codex 9,3) — novo GSI8 esparso global, isolamento IAM por `dynamodb:LeadingKeys`, revalidação atômica, poison-record/DLQ, backfill cobrindo vencimento futuro. Piloto `membership-purge` (D-180/D-181, achou e corrigiu um bug real de deploy — `Sid` de IAM não-alfanumérico rejeitado pelo CD real depois do CI verde). `invitation-purge` (D-182). `document-file-reconciliation` (D-183, achou que o mecanismo GSI5 anterior nunca teve writer real — código morto funcional apesar de "IMPLEMENTADO E VERIFICADO"). Cada migração com prova ao vivo de isolamento IAM cross-namespace (`aws iam simulate-principal-policy`, positivo+negativo).

`develop`/`main` sincronizados (diff zero) ao final da sessão. Suíte 1809/1809, todos os gates locais (`typecheck`/`lint`/`check-boundaries`/`check-docs`/`validate-schemas`/`build:lambdas`) verdes, `terraform test` 22/22.

## Decisão pendente real — só Marcelo pode resolver (não bloqueia o resto)

**`submitEvidence()`/guest flow do domínio `DocumentType`** (achado em D-175, ainda aberto): `SubmitEvidenceInput.documentType` é opcional no schema HTTP guest real e cai para `requirementId` quando ausente, numa rota já em produção. Aplicar o `ConditionCheck(DocumentType.status=ACTIVE)` incondicionalmente (como o design D-173 §4 descreve) quebraria a maioria dos uploads guest hoje. 3 opções nomeadas em `decisions-log.md` D-175:
- **(a)** tornar `documentTypeId` obrigatório no schema guest agora (adianta parte do item 6);
- **(b)** aplicar o `ConditionCheck` só quando `documentType` vier explícito no input;
- **(c)** manter `submitEvidence()` como está até o item 6 formal (migração do schema guest) ser implementado.

Isto NÃO bloqueia nenhuma outra frente de trabalho — se Marcelo não sinalizar, siga para outra fatia independente (ver abaixo) e retome quando ele decidir.

## Próxima ação real, em ordem de valor esperado

1. **MaintenanceDueIndex — continuar a migração worker-a-worker** (nível 3-4, implementação direta de design já `APPROVED`, sem protocolo novo): (a) rodar os 3 scripts de backfill já escritos (`membership-purge`/`invitation-purge`/`document-file-reconciliation`) contra `dev` — write real, custo trivial, decisão <$5 já pré-autorizada pelo `AGENTS.md` §1; (b) migrar os 6 workers restantes (`requirement-reindex`, `quota-telemetry-purge`, `security-audit-purge`, `transient-purge`, `delivery-record-purge`, `core-user-data-purge` — ordem não normativa), cada um seguindo o padrão já validado 3x (ver `decisions-log.md` D-180/D-182/D-183 como templates, cada worker pode ter uma nuance própria de "quando o ponteiro é gravado" — não presumir que o padrão de `membership-purge` mapeia 1:1, como D-182/D-183 já mostraram).
2. **`DocumentType` item 6** — só depois da decisão de Marcelo sobre `submitEvidence()`/guest (ver acima).
3. **Depois do `MaintenanceDueIndex` fechar os 9 workers**: os outros achados nomeados por D-170 que ainda exigem protocolo — fast path do `RequestContext` (D-C, nível 5-6) e redesign do Reminder Producer (nível 5-6) — ambos sem rodada Claude↔Codex iniciada ainda.
4. **Depois do `DocumentType` fechar**: item 4 (adaptar M7/OCR ao novo `DocumentVersion`) ou item 1 (Requirement Templates, desbloqueado por `documentTypeId` estável) da macro-ordem de D-161 — ordem exata a confirmar na sessão que retomar.
5. **Wave 1b (Design System)** — deliberadamente por último, pedido explícito de Marcelo.
6. Ou uma nova frente que Marcelo trouxer.

## Leitura obrigatória antes da próxima ação

`AGENTS.md` §2 → `NEXT_SESSION_PROMPT.md` (seção "Próxima ação", já atualizada) → `docs/architecture/reviews/maintenance-due-index-scoping/estado-final-consolidado.md` (design completo do GSI8) → `docs/engineering/decisions-log.md` D-180/D-182/D-183 (os 3 templates reais de migração de worker, cada um com uma nuance diferente) → se a decisão pendente do guest flow for retomada, `docs/engineering/decisions-log.md` D-175.
