# Expiration Tracker — Estado Atual + Próxima Ação

> Este arquivo é estado atual + próxima ação (`AGENTS.md` §2), nunca fonte normativa e nunca histórico narrativo — história detalhada vive em `docs/architecture/{session-log,decisions-log}.md`, `docs/engineering/decisions-log.md` e nas pastas `reviews/`. Cada linha abaixo deve caber em 1-3 frases: o quê + status + referência D-xxx/E-xxx para detalhe completo. **Recompactado em 2026-09-24 (terceira reconciliação de engenharia de contexto — D-236 em 2026-09-08 já tinha feito isso, 2026-08-29 antes disso; o arquivo reacumulou 335 linhas/35,9KB/4235 palavras, estourando o guardrail de `check-doc-drift.ts` e quebrando o CI).** Antes de adicionar uma entrada nova aqui: se o D-número/E-número já tem linha completa em `decisions-log.md` (deveria sempre ter), esta seção só recebe 1-3 frases — nunca reconte a narrativa.

## Branch / as-of

**Não confie nesta seção sem confirmar.** `git branch --show-current` deve ser `develop`; `git log --oneline -5`, `git status` e `git pull` antes de assumir qualquer coisa abaixo como pendente ou concluído — múltiplas sessões/agentes trabalham neste repo em paralelo.

**Padrão de trabalho autônomo (Marcelo, 2026-09-01)**: prosseguir continuamente enquanto houver trabalho real a fazer — nunca parar para pedir "posso continuar?". Só pausar quando o próximo passo depender genuinamente de decisão exclusiva de Marcelo. Registrar o pendente aqui/`decisions-log.md`, seguir para outra frente independente.

**Protocolo Claude↔Codex RETOMADO (2026-09-23/24)** — não está mais suspenso. `AGENTS.md` §4 volta a valer normalmente para toda decisão nível 5-6.

## Fase atual

`Consolidation + Pilot Readiness`, recomendação **CONDITIONAL GO**. M0-M12, Multi-User B2B (15 waves) e Domínio Documental completos. Roadmap competitivo P0 (11 itens) 100% implementado — únicas pendências residuais são não-engenharia: **E-019** (jurídico, bloqueia WhatsApp com usuário real) e validação visual final de Marcelo (identidade visual v2, `prototype/_tmp_validacao/`). Full-audit round2 substancialmente fechado (só E-019 aberto). Detalhe completo de tudo isso: `decisions-log.md` D-143 a D-290, nunca recontado aqui.

## Pendências reais que dependem de decisão de Marcelo (lista consolidada)

Itens resolvidos mantêm só uma linha-ponteiro para `decisions-log.md` — nunca a narrativa completa.

1. Busca OCR/full-text (backlog P1 item 3) — 🔴 bloqueado, escolher entre 3 caminhos em D-202.
2. `--include-cognito` de `scripts/reset-dev-data.ts` contra `dev` — postergado, não perguntar de novo até Marcelo sinalizar.
4. WhatsApp com usuário real — engenharia 100% fechada (D-286/D-328); resta só E-019 (jurídico).
5. Wave 1b (Design System, componentes com overlay/focus-trap) — deliberadamente por último, pedido de Marcelo.
6. User Validation (planejamento de interface) — aguarda sinal explícito dele.
7. Aplicar ao Claude for Startups Program — exige ação direta de Marcelo (dados da empresa). Ver `docs/project/integrations-and-tooling-research-2026-09-11.md` §6.
8. P0.5 "Real System E2E" contra `dev` real — deliberadamente adiado, Marcelo 2026-09-14.
11. Reminder default local time (`Organization.defaultReminderLocalTime`) — implementado/mergeado; revisão adversarial Codex voluntária ainda pendente (nível 4, não normativamente exigida). Contexto: `docs/architecture/reviews/reminder-default-local-time/PROPOSAL.md`. **Próxima no protocolo, prioridade baixa.**
12. ~~Separação de ambientes (ADR-0014, D-305)~~ — **APROVADO via protocolo (D-331, 2026-09-24)** (direção arquitetural apenas), nota cega final Claude 9,3/Codex 9,1. Achado proativo do Claude na R1: management account da Fase 2 deve ser SEMPRE nova/vazia, nunca `975707451904`/`dev` (SCPs não restringem management account). Bug real corrigido: `cd.yml` gravava commit errado no manifesto de deploy sob `workflow_run` (agora usa `head_sha`). **Fases 2-4 (contas AWS staging/produção reais) continuam exigindo autorização explícita e separada de Marcelo, e primeiro a elaboração da Emenda 3** (baseline SCPs/trust, bootstrap de conta nova, contrato de promoção de artefato, DR/budget por conta) — nenhuma dessas 4 peças implementada ainda, registradas como exigência explícita. Detalhe: `decisions-log.md` D-331, `docs/architecture/reviews/adr-0014-environment-separation-adversarial-review/`.
19. Versionamento completo de `Document` (item-level) — **SUSPENSO por Marcelo (2026-09-23)**, incerteza sobre valor de produto; não retomar sem pedido explícito. "Baixar documento" já implementado (D-313).
20. `NotificationEntitlements` seedado no onboarding + endpoint agregado de urgência da Visão Geral — implementados (D-315/D-316), `PENDING_PROTOCOL_REVIEW`. **Próxima no protocolo.**
22. ~~Import CSV em massa para Items~~ — **APROVADO via protocolo Claude↔Codex (D-330, 2026-09-24)**: 3 rodadas, nota cega final Claude 9,1/Codex 9,0. Achados reais corrigidos: claim de dedupe órfã confundida com sucesso (`resolveExistingClaim()`, corrigida em AMBAS as fases parse+commit, e em AMBOS os branches Item/TrackedSubject); colisão de chave via delimitador sem escape (`JSON.stringify`); idempotência de `reserveImport()` ignorando `targetEntityType`; datas equivalentes/hora=24 escapando validação/dedupe. **Achado estrutural registrado, NÃO corrigido** (fora de proporção — pré-existente a D-319 inteiro, mas replicado no branch Item novo): toda escrita de status/cursor nos branches TrackedSubject/Item usa `update()` sem condição de versão — duas execuções concorrentes do worker podem se sobrescrever; precisa de rodada de escopo dedicada (fencing OCC, trazer ao padrão que Document/Requirement já têm). Detalhe: `decisions-log.md` D-330, `docs/architecture/reviews/d319-item-bulk-import-adversarial-review/`.
23. ~~Login/signup/reset de senha via UI própria (D-320→D-321)~~ — **APROVADO via protocolo (D-329, 2026-09-23/24)**, nota cega final Claude 9,3/Codex 9,1. Bug de integração real corrigido (device-remembering do Cognito quebrava refresh de sessão — `device_configuration` removido). Pendências registradas, não bloqueiam: rate-limiting dedicado por conta/IP (obrigatório antes de usuário real, junto com E-019); signup revela e-mail já cadastrado (409, decisão consciente mantida). Detalhe: `decisions-log.md` D-329.
25. Toggle real de canal (E-mail/WhatsApp) — adiado por Marcelo (D-327), não iniciar sem pedido explícito.
26. Confirmação de posse do número no opt-in de WhatsApp — implementado (D-328), `PENDING_PROTOCOL_REVIEW`, nível 4-5. **Próxima no protocolo.**

Itens 0, 3, 9, 10, 13-18, 21, 24 — todos **RESOLVIDOS**, detalhe completo em `decisions-log.md` (respectivamente D-none/CI #380, D-317, D-319, D-315, várias D-31x, D-321, D-322/D-323); não recontados aqui.

## Próxima ação recomendada

**Ordem de prioridade do protocolo Claude↔Codex** (retomado 2026-09-23/24, ver itens acima): ~~item 22~~ (D-330) → ~~item 12~~ (D-331) → item 26 (WhatsApp phone confirmation) → item 20 (NotificationEntitlements/urgência) → item 11 (reminder default local time, voluntário). Item 19 suspenso, não entra na fila.

**Última sessão (2026-09-23/24)**: D-329 (login/D-321), D-330 (bulk import/D-319) e D-331 (ADR-0014/separação de ambientes) — as 3 revisões adversariais concluídas e aprovadas, ver itens 23/22/12 acima. D-328 (WhatsApp phone confirmation) implementado, ainda na fila do protocolo (item 26, próximo). Este arquivo recompactado (guardrail de `check-doc-drift.ts` estourado, ver nota do cabeçalho).

**Regras permanentes**: `terraform apply` NUNCA roda localmente (só via CD); `plan`/`validate`/`fmt`/`test` locais liberados. Antes de PR `develop`→`main`: sempre rodar suíte e2e completa sem filtro e conferir o CI real do PR (D-322 — specs desatualizadas já ficaram vermelhas por múltiplos commits sem detecção). Paralelização multi-agente: default é fork serial, só paralelizar se Marcelo pedir velocidade explicitamente. `docs/engineering/task-completion-checklist.md`/skill `/task-checklist` — uso obrigatório ao fim de toda tarefa.

## Programa de Performance — ENCERRADO (Marcelo, 2026-09-19/21)

Escada 10k→100k→500k encerrada, não retomar sem novo pedido explícito. PERF-12 (pipeline de lembretes) implantado; degrau de 10k revalidado (SLO 300s atingido); degrau de 100k confirmado via AWS direto (100% TRIGGERED, mas SLO de 300s NÃO atingido a essa escala — não bloqueador, sem usuário real). Detalhe completo: `decisions-log.md` D-299 a D-310, `docs/engineering/performance/TODO.md`. Backlog registrado, não implementado: `dispatch-outbox-relay-processor.ts` processa lotes sequencialmente (~14/s) — risco se 100k/500k reproduzirem o gargalo; aguardando decisão de quando priorizar.

**Achados incidentais registrados, não bloqueantes**: gate `Authenticated k6 smoke` com flakiness de cold start; ADOT descarta lotes de trace sob carga sustentada; consolidação de PRs Dependabot do Terraform em andamento.

## Status de evidência (não presumir E2E sem checar)

A maioria dos mecanismos do roadmap está `IMPLEMENTED`/`UNIT TESTED` e confirmada `Active` contra `dev`, mas **nem todo mecanismo tem prova E2E de ponta a ponta pelo gatilho real** (cron/SQS real) — nomeado individualmente onde relevante em `decisions-log.md`. Não assumir E2E PROVEN sem checar.

## Links para histórico (não reler por padrão — só sob demanda)

- `docs/architecture/session-log.md` — linha do tempo compacta, uma entrada por sessão.
- `docs/architecture/decisions-log.md` / `docs/engineering/decisions-log.md` — toda decisão com nota Claude/Codex e status (D-0xx / E-0xx).
- `docs/architecture/reviews/` — artefatos de cada rodada Claude↔Codex por tema.
- `docs/project/handoffs/` — prompts de handoff de sessões anteriores, superseded por este arquivo.
- `docs/frontend/` — planejamento de interface + `interface-quality-standard.md` + `prototype/`.
- `docs/architecture/multi-user-b2b-wave-tracker.md` — detalhe fatia-a-fatia do Multi-User B2B.
