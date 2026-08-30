# Expiration Tracker — Estado Atual + Próxima Ação

> Este arquivo é estado atual + próxima ação (`AGENTS.md` §2), nunca fonte normativa e nunca histórico narrativo — história detalhada vive em `docs/architecture/{session-log,decisions-log}.md` e nas pastas `reviews/`. Recompactado em 2026-08-29 (reconciliação de engenharia de contexto, ver `docs/architecture/reviews/context-engineering-reconciliation/`) para parar de acumular narrativa sessão-a-sessão já duplicada nesses dois arquivos — a versão anterior tinha 1067 linhas, a maior parte delas o histórico completo de D-058 a D-083, palavra por palavra já presente em `decisions-log.md`.

## Branch / as-of

**Não confie nesta seção sem confirmar.** `git branch --show-current` deve ser `develop`; `git log --oneline -5` e `git status` antes de assumir qualquer coisa abaixo como pendente ou concluído — múltiplas sessões/máquinas trabalham neste repo. Escrito com `develop` em sincronia com `main` logo após o merge do PR #84 (reconciliação de contexto completa, commit `fe32861`).

## Fase atual

`Consolidation + Pilot Readiness` concluído com recomendação **CONDITIONAL GO** (`docs/engineering/pilot-readiness-assessment.md`). M0-M11 implementados e deployados; M7 (extração/OCR) code-complete e **E2E PROVEN** em `dev`; Full BFF + Frontend Production Foundation `APPROVED` e implementados; planejamento de interface 8/9 etapas `APPROVED` (só falta User Validation, em suspenso a pedido do Marcelo). W3-07 (exclusão física de tenant/DSR/LGPD) tem design `APPROVED WITH CONDITIONS` (D-066/D-067) e está em implementação incremental por chunks (D-068 a D-083). M12 (billing) bloqueado por decisão de fornecedor (D-052). **Multi-User B2B (D-084 a D-093): design técnico `APPROVED` via protocolo Claude↔Codex, physical model formalizado (Wave B2B-1, D-086) e timing decidido diretamente pelo Marcelo — proceder agora, supersedendo o gatilho comercial que antes gated M13.** Waves B2B-0 a B2B-3 `DONE`; Wave B2B-4 (Onboarding) com **escopo `APPROVED` via protocolo (D-092)**, implementação ainda não iniciada. Esta é a maior iniciativa de arquitetura autorizada no momento, próxima ação real é implementar o `OnboardingStateResolver` de B2B-4 — ver "O que está em andamento" item 1. **Lembrete de calibração (D-093, `AGENTS.md` §1)**: projeto sem usuário real nem produção — não pesar "quebraria conta/sessão existente em `dev`" como risco bloqueador.

Ver `docs/architecture/README.md` (linha `Design maturity`/bloco de status no topo) para o resumo executivo mais completo — este arquivo não duplica aquele bloco, só aponta para ele.

## O que já está implementado (referência, não repetir aqui)

- **Backend por módulo/milestone**: `AGENTS.md` §7 (invariantes estáveis) + `ARCHITECTURE.md` (visão consolidada).
- **Frontend/planejamento de interface**: `docs/frontend/README.md` (índice completo, blockers técnicos BLOCKER-A/B/C todos resolvidos, GTR-01 com decisão de produto pendente W5-01 já fechada).
- **Engenharia/qualidade**: `docs/engineering/README.md` (padrões, gates, backlog do programa de pilot readiness).
- **Infra**: Terraform (`infra/`, ADR-0009), CI/CD via GitHub Actions OIDC.
- **Reconciliação de engenharia de contexto (2026-08-29)**: `DONE`, mergeada em `main` (PR #84) — root cleanup + `AGENTS.md`/este arquivo reconciliados + 2 guardrails novos em `check-doc-drift.ts`, revisão Claude↔Codex 9,3/10. Registro completo: `docs/architecture/reviews/context-engineering-reconciliation/`.
- **E-011 (logging/tracing) — junção `correlationId`↔X-Ray**: `E2E PROVEN` (2026-08-29) — smoke test real em `dev` via `aws --profile claude-dev` confirmou `xrayTraceId` no log idêntico ao trace real do X-Ray. Detalhe: `docs/architecture/correlationid-xray-trace-join.md`.
- **E-012 (2026-08-29) — Definition of Done por item de todo list**: `APPROVED` via protocolo Claude↔Codex (3 rodadas, Claude 9,1/Codex 9,2). Regra de processo permanente, vigente a partir de agora em toda sessão: nenhum item de todo list que produza/altere código real é `completed` sem passar pelo gate do seu nível de risco — ver `docs/engineering/definition-of-done.md` (granularidade, gate por nível, registro de evidência `DoD:`). **Emenda E-013 (2026-08-30)**: aplicação de `test-engineering-standard.md` tornada operacional (não só referencial) — G-V3 (mutação nomeada por escrito) exigido explicitamente por teste, não só "suíte verde". Achado do Marcelo, corrigido retroativamente nos testes de B2B-2.
- **D-093 (2026-08-30) — sem usuário real nem produção, não pesar esse risco**: `AGENTS.md` §1 ganhou parágrafo permanente — projeto em fase de construção, sem usuário real, sem produção (deploy só em `dev`, dado sintético resetável), sem prazo. Nunca tratar "quebraria conta/sessão existente em `dev`" como risco bloqueador por si só; não dispensa rigor de engenharia/segurança/protocolo §4. Achado do Marcelo, motivado por D-092 ter invocado essa categoria de risco indevidamente (a conclusão técnica de D-092 continua válida por outras razões).

## O que está em andamento

1. **Multi-User B2B — autorizado a prosseguir, Waves B2B-0 a B2B-3 `DONE`, Wave B2B-4 com escopo `APPROVED` (D-084 a D-093).** Design técnico `APPROVED` (protocolo completo em `roadmap-evolution/17-multi-user-b2b-revised-strategy.md` §125) e timing decidido diretamente pelo Marcelo. Estado detalhado por subitem (evidência `DoD:`, judgment calls de sequenciamento documentados) vive em `docs/architecture/multi-user-b2b-wave-tracker.md` — não duplicado aqui. Resumo: **B2B-0** inventário read-only; **B2B-1** physical model formalizado via protocolo Claude↔Codex 5 rodadas (D-086, `docs/architecture/multi-user-b2b-physical-model.md`); **B2B-2** fundação de identidade global aditiva (D-087/D-088) — unifica os 2 caminhos de login no `TenantBootstrapService` já fenced, fechando o gap de fencing do BFF achado na Wave B2B-0; **B2B-3** `Organization`/`Membership`/`CreateOrganizationService` (D-089/D-090/D-091) — isolamento IAM do GSI4, domain/persistence, transação atômica de criação, ainda não wireado a nenhum fluxo de login/onboarding.

   **Wave B2B-4 (Onboarding), escopo `APPROVED` via protocolo Claude↔Codex 4 rodadas (D-092, `docs/architecture/multi-user-b2b-wave-b2b4-scope.md`), IMPLEMENTAÇÃO AINDA NÃO INICIADA — esta é a próxima ação real.** Deliverable único: `OnboardingStateResolver` (`src/modules/organization/application/onboarding-state.ts`, novo) — serviço puro, SEM wiring em `bootstrap-identity.ts`/`resolve-request-context.ts`/`bff-auth-service.ts`, SEM exposição HTTP. Classifica um `userId` em 4 estados via procedimento sequencial estrito (não condições paralelas — a ordem importa, ver `multi-user-b2b-wave-b2b4-scope.md` para o procedimento exato de 5 passos): `HAS_USABLE_MEMBERSHIP` (existe `Membership` `ACTIVE`, incondicional) → `SUSPENDED_ONLY` (nenhuma `ACTIVE`, existe `SUSPENDED`) → (ignorar `REMOVED`) → `LEGACY_TENANT_ONLY` (`TenantLifecycleRecord` legado existe) → `NO_TENANT_NO_MEMBERSHIP` (nem um nem outro — só alcançável de verdade após Wave B2B-5, testável agora via fixture sintético). Consome `OrganizationStore.queryGsi4()` (já existe, B2B-3) + `tenantLifecycleKey()`/`TenantLifecycleRecord` (já existe, `shared/tenant-lifecycle/`). Testes cobrindo os 4 estados com G-V3 aplicado desde a escrita (mutação nomeada por comentário, per E-013) — não retrofitar depois. `CreateOrganizationService` (B2B-3) permanece sem consumidor até B2B-5/B2B-6. Remoção do auto-provision legado e gate real de login continuam formalmente redesignados para **Wave B2B-5** (§110 do roadmap). **D-093**: não invocar "risco a usuário/produção" como justificativa nesta ou em nenhuma wave futura — o projeto não tem nenhum dos dois; a razão de manter o classificador desacoplado do login é qualidade de engenharia (decomposição, não misturar escopo de B2B-4/B2B-5), não proteção de usuário inexistente.
2. **W3-07 — purge pipeline durável**: implementado e revisado (D-081/D-082/D-083, Codex 9,1/10, "pronto para avançar"). **Decisão pendente**: orquestrador real (Step Functions vs. Lambda+EventBridge Scheduler) — Type 1, `AGENTS.md` §4, precisa do Marcelo ou do protocolo Claude↔Codex. Downstream disso: Terraform da IAM role do handler de purge, teste de integração real dos adaptadores AWS, e o achado não-bloqueante de acoplar validação de prefixo↔bucket (ambos aguardando a decisão de orquestrador). **Nota de sequenciamento**: Multi-User B2B (item 1) muda a semântica de `TenantLifecycleRecord`/BFF session que o W3-07 assume (`roadmap-evolution/17` §125.4) — avaliar se vale decidir o orquestrador antes ou depois de Wave B2B-5/B2B-6 fecharem essa semântica, para não implementar o orquestrador duas vezes.
3. **W3-07 — fencing dos writers de negócio** (`TenantBusinessMutation`): a maioria dos writers reais já fenced (chunks D-068 a D-080, ver `decisions-log.md`). Gap residual documentado, não explorável hoje: entradas sem PK `TENANT#`-prefixed E sem `tenantId` declarado (`LoginAttempt`/`GuestRateLimitRecord`) passam sem verificação — nenhum call site real produz isso.

## Gates / bloqueios abertos

| Item | Precisa de | Onde está o detalhe |
|---|---|---|
| Orquestrador do purge W3-07 (Step Functions vs. Lambda+EventBridge) | Decisão do Marcelo ou protocolo Claude↔Codex (Type 1) — ver nota de sequenciamento com Multi-User B2B acima | `decisions-log.md` D-083 |
| `AppError.retryable` — deveria decidir comportamento real de SQS retry/DLQ? | Decisão de produto do Marcelo | `docs/engineering/decisions-log.md` E-011 |
| 7 de 9 classes de retenção LGPD sem purga física real (`privacy-lgpd.md` §4) | Decisão de escopo/priorização do Marcelo antes de qualquer implementação | `docs/engineering/pilot-readiness-program.md` W3-06 |
| User Validation (planejamento de interface) | Sinal explícito do Marcelo para retomar | `docs/frontend/README.md` |
| Wave 1 (Design System reconciliation) | Marcelo atualizar o Design System formal primeiro | `docs/engineering/pilot-readiness-program.md` Wave 1 |

## Decisões deliberadamente adiadas (já decididas como "não agora", não esquecidas)

- M12 (Billing) — bloqueado por escolha de fornecedor de pagamento (D-052).
- Opção B (atributo de span OpenTelemetry para correlationId↔trace) — candidata futura, 3 pré-requisitos nomeados, não perseguida agora (`correlationid-xray-trace-join.md` §2).
- Document Lifecycle Management — mesma classe, arquivado como informativo (`docs/architecture/roadmap-evolution/16-document-lifecycle-strategic-analysis.md`).
- BFF/frontend quality standard (rubrica mais ampla que `interface-quality-standard.md`) — proposta não adotada (`docs/frontend/bff-frontend-quality-standard-proposal.md`).
- Itens explicitamente fora de escopo do próprio Multi-User B2B (`roadmap-evolution/17` §98): custom roles, ABAC, SAML/SCIM, seat billing, platform admin/impersonation, department hierarchy.

## Próxima ação, em ordem de valor esperado

1. **Multi-User B2B, Wave B2B-4 — implementar `OnboardingStateResolver`** (item 1 de "O que está em andamento") — escopo já `APPROVED` (D-092), maior iniciativa autorizada, decompor por `docs/engineering/definition-of-done.md` (E-012/E-013) antes de fechar cada subitem.
2. Decidir o orquestrador do purge W3-07 (item 2) — considerar a nota de sequenciamento com Multi-User B2B antes de decidir.
3. `AppError.retryable` — decisão de produto pendente, não implementar sem sinal explícito do Marcelo.
4. Decisão de escopo/priorização das 7 classes de retenção LGPD restantes, quando o Marcelo quiser priorizar.

## Leitura obrigatória antes da próxima ação

`AGENTS.md` §2 (início de sessão) → `docs/architecture/README.md` (mapa vigente) → a linha da tabela "Gates / bloqueios abertos" relevante à tarefa escolhida, e só então o documento/pasta de review que ela referencia.

## Status de evidência (não presumir E2E sem checar)

| Item | Status |
|---|---|
| M7 extração/OCR | `E2E PROVEN` (verificação real 2026-08-27 contra `dev`) |
| Full BFF + Frontend Production Foundation | `APPROVED` + implementado, `E2E PROVEN` |
| W3-06 (`USER_DOCUMENT` purge) | `IMPLEMENTED`/`E2E PROVEN` (`terraform plan`/`test` reais contra `dev`) |
| W3-07 purge pipeline (D-081-083) | `IMPLEMENTED`/`UNIT TESTED` — sem orquestrador wireado, sem teste de integração AWS real |
| E-011 correlationId↔X-Ray | `E2E PROVEN` (smoke test real 2026-08-29 contra `dev`) |
| Visual Language + Design System | `APPROVED ... PROVISIONAL PENDING USER VALIDATION` |

## Links para histórico (não reler por padrão — só sob demanda)

- `docs/architecture/session-log.md` — linha do tempo compacta, uma entrada por sessão.
- `docs/architecture/decisions-log.md` / `docs/engineering/decisions-log.md` — toda decisão com nota Claude/Codex e status (numeração D-0xx / E-0xx, não sequencial na ordem das linhas).
- `docs/architecture/reviews/` — artefatos de cada rodada Claude↔Codex por tema.
- `docs/project/handoffs/` — prompts de handoff de sessões anteriores, superseded por este arquivo, preservados como evidência.
- `docs/frontend/` — os 8 documentos de planejamento de interface + `interface-quality-standard.md` + `prototype/`.
