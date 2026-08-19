# Controle de Vencimentos — Status e Próxima Sessão

Projeto: micro-SaaS de controle de vencimentos/renovações. Pasta: `c:\Users\Usuario\Desktop\projects\controle-vencimentos\`.
Prompt mestre completo: `docs/00-prompt-mestre.md` (64 seções — processo Claude ↔ Codex com debate obrigatório, arquitetura só aprovada com nota ≥9.0 de ambos, sem arredondamento).

## Regra de processo reforçada pelo usuário (2026-08-19)
Toda etapa (não só a arquitetura final) deve passar por: (1) mínimo 3 rodadas de debate Claude↔Codex, e (2) avaliação independente às cegas por `fitness-function.md`/`quality-criteria.md`, com nota mínima **9.0 de ambos** antes de avançar para a próxima fase. Trabalhar de forma o mais autônoma possível — não pausar para pedir confirmação entre rodadas de debate/nota; só interromper se houver bloqueio real que nenhuma pesquisa/discussão Claude↔Codex resolva.

## Concluído — Fase 0 — APPROVED
- `docs/architecture/quality-criteria.md` — final consolidado, 12 critérios, pesos somando 100%.
- `docs/architecture/fitness-function.md` — final, fórmula, gates G1–G6, regra de aprovação.

## Concluído — Fase 1 (Requirements) — APPROVED
- `docs/architecture/requirements.md`. FR/NFR/SEC/PRIV/COST/SCALE/OPS/Future(FUT)/Constraints/Assumptions/Unknowns/Non-goals com IDs.
- 4 rodadas de debate + avaliação independente às cegas: 1ª nota Claude 9.16 / Codex 8.7 (NOT APPROVED) → lacunas fechadas → reavaliação **Claude 9.16 / Codex 9.03** (APPROVED).
- Seção 13 do requirements.md formaliza rubrica de nota, precedência de gates, fail-closed (FR-043/044), gatilho multi-tenant (SCALE-004), critérios verificáveis de abuso (COST-004/005).

## Concluído — Fase 2 (Capacity Model) — APPROVED
- `docs/architecture/capacity-model.md`. Stage 0 a Stage 5 (dev até 1M usuários), todas as métricas exigidas pela seção 17 do prompt mestre com fórmulas explícitas e classificação KNOWN/ASSUMPTION/ESTIMATE/UNKNOWN.
- Processo: **9 rodadas** de debate de conteúdo (Codex encontrou e Claude corrigiu: erro aritmético de 20% em documentos/storage, uploads/dia não derivados, alertas subestimados, soma de canais errada, IA/OCR sem decompor OCR/LLM/antimalware/retry, métricas ausentes por estágio, storage incompleto, picos só para alertas, Stage 0 com classificações inválidas, contradição no pico extremo da seção 58, um bug de edição que duplicou conteúdo, erro de aritmética no Stage 0, fator de pico 5× mal aplicado em várias linhas, um erro de arredondamento no Stage 1, uma referência textual errada) até **CONSENSO FASE 2 CONFIRMADO**.
- Avaliação independente às cegas: 1ª rodada Claude 8.78 / Codex 8.4 (NOT APPROVED — faltavam cenários de suporte a Segurança/Privacidade/Correção/Operabilidade/Manutenibilidade/Multi-tenant/Abuso/Extensibilidade/Governança IA). Claude adicionou a seção "Cenários adicionais de suporte a critérios da fitness function" com 9 sub-cenários quantificados. Reavaliação: **Codex 9.1** (APPROVED); Claude recalculou a própria nota em ~9.3 aplicando o mesmo reforço.
- Fragilidades residuais menores (não bloqueantes) registradas como UNK-CAP-008 a UNK-CAP-012 no próprio arquivo, para refinamento na Fase 3.

## Próxima ação obrigatória — Fase 3 (Propostas Arquiteturais Independentes)
Conforme seções 18–23 do prompt mestre:
1. Claude cria proposta de arquitetura independente; Codex cria a sua **independentemente** (não induzir Codex a só revisar a proposta do Claude — usar o template "ARCHITECTURE INDEPENDENT DESIGN REQUEST" da seção 18).
2. **Regra absoluta da seção 9/63: ainda NÃO escolher nenhum serviço AWS antes desta fase** — mas a Fase 3 é justamente onde essa escolha começa a acontecer, com base em `requirements.md` + `capacity-model.md`.
3. Mínimo 3 rodadas (Architecture Round 1/2/3: propostas → réplicas/críticas → tréplicas/arquitetura revisada), seguindo o protocolo completo da seção 21 (Research → Proposal → Comparison → Réplica → Tréplica → Consensus → Independent scoring).
4. Avaliação independente às cegas com nota mínima 9.0 de ambos antes de considerar a Fase 3 concluída (mesma regra reforçada acima).
5. Depois: domínios a desenhar (seção 19), decisões que passam por debate individual (seção 20 — Compute, Database, Auth, Reminder scheduling, etc.), ADRs por decisão relevante.

## Padrão de invocação do Codex (validado)
`cd <pasta-do-projeto> && codex exec --skip-git-repo-check "<prompt>"`. Sempre rodar em background (`run_in_background: true`) para não bloquear em timeout e permitir trabalho autônomo contínuo. Sempre perguntar ao Codex ANTES de revelar a posição/nota do Claude quando for avaliação independente (regra anti-anchoring). Cuidado ao usar Edit para substituir blocos grandes de tabela — validar com `grep -n "^## Stage"` (ou equivalente) que não houve duplicação de conteúdo antes de reenviar ao Codex.

## Escopo total do prompt mestre (para dimensionar o trabalho restante)
Projeto multi-sessão longo, análogo ao `capital-agent-v0.2` (ver memória `capital_agent_quality_improvement_initiative`). Faltam: Fase 3 completa (propostas arquiteturais + domain/data model + reminder/notification engine + AI/OCR architecture + security threat model + LGPD + cost model + observability + DR + CI/CD + IaC choice + 14 diagramas Mermaid + Architecture Red Team de 20 cenários), ADRs por decisão relevante, e só então `ARCHITECTURE.md` final com aprovação ≥9.0/10 de ambos os engenheiros — cada etapa intermediária também exige ≥9.0 de ambos antes de prosseguir.
