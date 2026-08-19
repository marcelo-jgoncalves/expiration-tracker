# Expiration Tracker — Status e Próxima Sessão

Projeto: micro-SaaS de controle de vencimentos/renovações. Pasta: `c:\Users\Usuario\Desktop\projects\expiration-tracker\` (renomeada de `controle-vencimentos` em 2026-08-19; repo GitHub: `marcelo-jgoncalves/expiration-tracker`, privado).
Prompt mestre completo: `docs/00-prompt-mestre.md` (64 seções — processo Claude ↔ Codex com debate obrigatório, arquitetura só aprovada com nota ≥9.0 de ambos, sem arredondamento).

## Regra de processo reforçada pelo usuário (2026-08-19)
Toda etapa (não só a arquitetura final) deve passar por: (1) mínimo 3 rodadas de debate Claude↔Codex — **mínimo, não teto**: continuar quantas rodadas forem necessárias até um padrão world-class, não parar em 3 por formalidade — e (2) avaliação independente às cegas por `fitness-function.md`/`quality-criteria.md`, com nota mínima **9.0 de ambos** antes de avançar para a próxima fase. Trabalhar de forma o mais autônoma possível — não pausar para pedir confirmação entre rodadas de debate/nota; só interromper se houver bloqueio real que nenhuma pesquisa/discussão Claude↔Codex resolva. Manter `architecture-fase3-consolidada.md`, `decisions-log.md` e os diagramas sempre atualizados a cada rodada relevante.

## Concluído — Fase 0 — APPROVED
- `docs/architecture/quality-criteria.md` — final consolidado, 12 critérios, pesos somando 100%.
- `docs/architecture/fitness-function.md` — final, fórmula, gates G1–G6, regra de aprovação.

## Concluído — Fase 1 (Requirements) — APPROVED
- `docs/architecture/requirements.md`. FR/NFR/SEC/PRIV/COST/SCALE/OPS/Future(FUT)/Constraints/Assumptions/Unknowns/Non-goals com IDs.
- 4 rodadas de debate + avaliação independente às cegas: **Claude 9.16 / Codex 9.03** (APPROVED, após 1ª rodada NOT APPROVED com Codex 8.7).
- Seção 13 formaliza rubrica de nota, precedência de gates, fail-closed (FR-043/044), gatilho multi-tenant (SCALE-004), critérios verificáveis de abuso (COST-004/005).

## Concluído — Fase 2 (Capacity Model) — APPROVED
- `docs/architecture/capacity-model.md`. Stage 0 a Stage 5 (dev até 1M usuários), fórmulas explícitas, classificação KNOWN/ASSUMPTION/ESTIMATE/UNKNOWN.
- 9 rodadas de debate de conteúdo (erros aritméticos, métricas ausentes, bug de duplicação, fator de pico mal aplicado — todos corrigidos) até consenso confirmado.
- Avaliação independente às cegas: **Claude ~9.3 / Codex 9.1** (APPROVED, após 1ª rodada NOT APPROVED com 8.78/8.4).

## Concluído — Fase 3 (Arquitetura AWS Conceitual) — APPROVED (Design Maturity)
- `docs/architecture/architecture-fase3-consolidada.md` — arquitetura consolidada: Lambda + monólito modular, API Gateway HTTP API, DynamoDB on-demand single-table, S3 (quarentena de 2 buckets), Cognito, EventBridge + outbox seletivo com sweeper, SQS por canal de notificação (SES/Telegram/WhatsApp) com contract tests, Textract+Bedrock via Step Functions Standard com fail-closed (`PENDING_CONFIRMATION`), CDK+GitHub Actions, kill switch via AppConfig, WAF condicional.
- Processo: 5 rodadas — (1) propostas independentes Claude/Codex com convergência muito forte; (2) crítica cruzada + análise crítica própria do Claude à proposta do Codex (`round2-claude-critique.md`, anti-sycophancy); (3) tréplica do Codex refinando outbox/Step Functions/WhatsApp; (4) **correção metodológica real**: a 1ª nota (Codex 5.9) expôs que a rubrica de evidência original exigia implementação/teste, impossível antes da arquitetura ser aprovada — corrigido formalizando duas rubricas em `requirements.md` §13.1 (**A: Design Maturity** para checkpoints conceituais; **B: Operational Evidence** para o gate final pós-implementação); 7 ADRs materialmente relevantes fechados (quota por tenant em HTTP API, dimensionamento de shards do reminder engine, DST, metas RTO/RPO, padrão IAM/CDK, WAF×HTTP API, tipo de Step Functions); (5) nota final.
- Avaliação independente às cegas (rubrica A): **Claude 9.10 / Codex 9.04** (exato, sem arredondamento) — ambos ≥9.0, nenhum gate violado. **STATUS: FASE 3 APPROVED.**
- Itens abertos remanescentes (não bloqueiam a Fase 3, dependem de pesquisa de mercado ou de fases posteriores): BSP WhatsApp (pricing/quotas), modelo Bedrock específico, SLA de latência quarantine→clean (depende de `slo.md`), payload específico WhatsApp (depende do BSP), teste real de restore (depende de `disaster-recovery.md` e infraestrutura implantada).
- Diagramas Mermaid (6 de 14 exigidos pela seção 52) em `docs/architecture/diagrams/diagrams.md`, sincronizados com a arquitetura consolidada. Painel de status visual em `docs/architecture/diagrams/status-projeto.html`.
- **Importante**: esta aprovação é do checkpoint de **desenho conceitual** (rubrica A). O Gate de Aprovação Final da seção 23 do prompt mestre (rubrica B) só se aplica depois do Architecture Red Team (seção 58) e de implementação real.

## Próxima ação obrigatória — Architecture Red Team (seção 58) + domínios/decisões detalhadas
1. Executar os 20 cenários de red team da seção 58 (100x crescimento, 1M lembretes no mesmo horário, WhatsApp/Telegram/e-mail indisponíveis, LLM indisponível, PDF malicioso, prompt injection, upload massivo, duplicação de eventos, poison message, DLQ crescendo, data alterada pós-agendamento, documento removido durante pipeline, webhook duplicado, credencial comprometida, falha de region, restore de banco, erro de deploy, ataque de custo) contra `architecture-fase3-consolidada.md` — para cada cenário: impacto, detecção, mitigação, recovery, lacuna.
2. Revisar e pontuar novamente após o red team (mesmo processo de nota independente ≥9.0 ambos).
3. Em paralelo/depois: domínios a desenhar em detalhe (seção 19), decisões individuais ainda superficiais (seção 20 — Search se necessário, Analytics, API versioning, MCP readiness), ADRs formais em `docs/architecture/adr/` (modelo da seção 24) para cada decisão já tomada em `decisions-log.md`.
4. Documentos ainda não iniciados: `privacy-lgpd.md`, `cost-model.md`, `slo.md`, `disaster-recovery.md`, `mcp-readiness.md`, `aws-well-architected-review.md`, `domain-model.md`, `data-model.md`.

## Padrão de invocação do Codex (validado, com nota de robustez)
`cd <pasta-do-projeto> && codex exec --skip-git-repo-check "<prompt>"`. Sempre rodar em background (`run_in_background: true`). Sempre perguntar ao Codex ANTES de revelar a posição/nota do Claude quando for avaliação independente (regra anti-anchoring). Cuidado ao usar Edit para substituir blocos grandes de tabela — validar com `grep -n "^## Stage"` (ou equivalente) que não houve duplicação antes de reenviar ao Codex. **Se um processo `codex` ficar rodando por muito mais tempo que rodadas anteriores comparáveis (ex.: >10 min quando outras levaram 1-5 min), verificar `CPU` do processo (PowerShell `Get-Process -Id <pid>`) — CPU quase zero com runtime alto indica que travou esperando stdin (geralmente causado por prompt muito longo/com escaping problemático), não que está "pensando"; nesse caso, matar o processo (`taskkill //F //PID <pid>`) e relançar com prompt mais enxuto.**

## Nota sobre renomear pastas com git ativo no Windows
Ao renomear uma pasta de projeto que é um repo git, **não usar Rename-Item/Move-Item direto** se houver risco de o `.git` estar sendo escaneado pelo Windows Defender logo após um commit/push — o rename pode falhar no meio e corromper o `.git` (dividido entre origem e destino). Método seguro usado nesta sessão: garantir que tudo está commitado e pushado, depois deletar a pasta local e clonar de novo do GitHub já com o nome novo (`gh repo rename` primeiro, depois `git clone` local).

## Escopo total do prompt mestre (para dimensionar o trabalho restante)
Projeto multi-sessão longo, análogo ao `capital-agent-v0.2` (ver memória `capital_agent_quality_improvement_initiative`). Faltam: Architecture Red Team, domain/data model detalhado, privacy-lgpd.md, cost-model.md, slo.md, disaster-recovery.md, mcp-readiness.md, aws-well-architected-review.md, 8 diagramas Mermaid restantes, ADRs formais individuais, e só então `ARCHITECTURE.md` final com aprovação ≥9.0/10 de ambos os engenheiros (rubrica B, pós-implementação) — cada etapa intermediária também exige ≥9.0 de ambos antes de prosseguir.
