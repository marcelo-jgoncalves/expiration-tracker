# Expiration Tracker — Status e Próxima Sessão

Projeto: micro-SaaS de controle de vencimentos/renovações. Pasta: `c:\Users\Usuario\Desktop\projects\expiration-tracker\`. Repo GitHub: `marcelo-jgoncalves/expiration-tracker` (privado).
Prompt mestre completo: `docs/00-prompt-mestre.md` (64 seções — processo Claude ↔ Codex com debate obrigatório).

## STATUS ATUAL: DESIGN MATURITY APPROVED — ARCHITECTURE.md publicado
Todo o processo de arquitetura conceitual (Fases 0–3 do prompt mestre + todos os documentos das seções 35-52) está **completo e aprovado**. Ver `ARCHITECTURE.md` na raiz do repositório para o documento final consolidado.

### O que foi concluído (10 checkpoints pontuados, todos ≥9.0 de Claude e Codex, sem arredondamento)
1. **Fase 0** — Quality Criteria + Fitness Function (`docs/architecture/quality-criteria.md`, `fitness-function.md`) — consenso de conteúdo, 3 rodadas.
2. **Fase 1** — Requirements (`requirements.md`) — Claude 9.16 / Codex 9.03.
3. **Fase 2** — Capacity Model (`capacity-model.md`) — Claude ~9.3 / Codex 9.1, fecha UNK-CAP-006 depois na Fase de SLO.
4. **Fase 3 + Red Team** — Arquitetura AWS conceitual (`architecture-fase3-consolidada.md`) — Claude 9.13 / Codex 9.20 pós-Red-Team.
5. **Domain/Data Model** (`data-model.md`) — Claude ~9.05 / Codex 9.10. 17 entidades, DynamoDB single-table, 6 GSIs.
6. **SLOs** (`slo.md`) — Claude ~9.08 / Codex 9.001. Fecha SLO de drenagem do pico extremo = 5min.
7. **Disaster Recovery** (`disaster-recovery.md`) — Claude ~9.10 / Codex 9.10. RPO/RTO, teste de restore, runbook.
8. **Privacy/LGPD** (`privacy-lgpd.md`) — Claude ~9.15 / Codex 9.10. 8 classes de retenção, direitos do titular.
9. **Cost Model** (`cost-model.md`) — Claude ~9.15 / Codex 9.20. WhatsApp domina 76-94% do custo.
10. **MCP Readiness + Evolution + AWS Well-Architected Review** (pacote) — Claude ~9.25 / Codex 9.30.

Mais: **8 ADRs formais** (`docs/architecture/adr/`) para decisões Type 1; **14 diagramas Mermaid** completos (`docs/architecture/diagrams/diagrams.md`); **26 decisões** registradas em `decisions-log.md`; painel visual atualizado (`docs/architecture/diagrams/status-projeto.html`).

### Distinção de status formal (importante para não reabrir debate desnecessário)
```text
DESIGN MATURITY STATUS: APPROVED   ← o que este processo entrega (rubrica A, requirements.md §13.1)
ARCHITECTURE STATUS: NOT APPROVED  ← seção 62 do prompt mestre, rubrica B (Operational Evidence) — 
                                       correto e esperado, pois nada foi implementado ainda
```
Esta distinção foi validada pelo Codex numa verificação final de consistência do `ARCHITECTURE.md` — ele corrigiu uma tentativa inicial de usar um terceiro estado ("NOT YET EVALUATED") que não existe na seção 62, que só admite APPROVED/NOT APPROVED. O `ARCHITECTURE STATUS: NOT APPROVED` **não é uma reprovação de mérito** — é o estado normativo correto até haver implementação real testada sob falha/carga.

## Próxima ação obrigatória — Implementation Blueprint (seção 60) e além
1. **Implementation Blueprint** (`docs/architecture/implementation-blueprint.md`, não iniciado) — componentes, módulos, interfaces, eventos, schemas, ordem de deploy, milestones, dependências, critérios de aceite técnicos. Só agora pode começar (a arquitetura estava proibida de ser implementada antes da aprovação, seção 60).
2. **Threat model formal** (`docs/architecture/threat-model.md`, seção 33) — risco de severidade Alta identificado em `aws-well-architected-review.md`, recomendado antes ou junto do início da implementação.
3. Implementação real seguindo as ~26 decisões já consolidadas.
4. Testes de carga real, teste de restore real (gate já definido em `disaster-recovery.md` §6), exercício do runbook de credencial comprometida.
5. Reavaliação sob rubrica (B) — Operational Evidence — só então a seção 62/`ARCHITECTURE STATUS` pode legitimamente virar `APPROVED`.
6. Decisões de produto ainda pendentes de pesquisa externa (não bloqueiam início da implementação, mas bloqueiam habilitar os canais/features específicos): BSP WhatsApp (pricing real, UNK-003), modelo Bedrock específico, região AWS (bloqueante para LGPD/transferência internacional), MFA obrigatório vs. opcional (UNK-006).

## Padrão de invocação do Codex (validado ao longo de toda a sessão)
`cd <pasta-do-projeto> && codex exec --skip-git-repo-check "<prompt>"`. Sempre rodar em background (`run_in_background: true`). Sempre perguntar ao Codex ANTES de revelar a posição/nota do Claude quando for avaliação independente (regra anti-anchoring). Cuidado ao usar Edit para substituir blocos grandes de tabela — validar com `grep -n "^## Stage"` (ou equivalente) que não houve duplicação antes de reenviar ao Codex. Se um processo `codex` ficar rodando muito mais tempo que rodadas comparáveis, verificar CPU via `Get-Process -Id <pid>` — CPU quase zero com runtime alto indica travamento esperando stdin (prompt longo/escaping problemático), não "pensando"; matar e relançar com prompt mais enxuto.

## Nota sobre renomear pastas com git ativo no Windows
Não usar Rename-Item/Move-Item direto se houver risco de o `.git` estar sendo escaneado pelo Windows Defender logo após commit/push — pode corromper o `.git`. Método seguro: garantir tudo commitado/pushado, deletar a pasta local, clonar de novo do GitHub com o nome novo.

## Regra de processo (vale para a fase de implementação também, se o mesmo rigor for mantido)
Mínimo 3 rodadas de debate Claude↔Codex — **mínimo, não teto**. Avaliação independente às cegas com nota mínima 9.0 de ambos antes de considerar algo concluído. Trabalhar de forma autônoma — só interromper se houver bloqueio real que nenhuma pesquisa/discussão resolva. Manter documentação sempre atualizada a cada rodada relevante.
