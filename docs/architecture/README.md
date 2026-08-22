# docs/architecture/ — Índice e Mapa de Autoridade

```text
Design maturity:        APPROVED (arquitetura conceitual + Implementation Blueprint)
Operational architecture: NOT APPROVED
Current phase:           Implementação real (código/infra/testes) — Implementation Blueprint concluído
Last verified:           2026-08-22 (M6 implementado/deployado/verificado em produção real; design de M7 aprovado, implementação não iniciada — ver `NEXT_SESSION_PROMPT.md`)
```

Ver `ARCHITECTURE.md` (raiz do repo) para o resumo executivo consolidado e `NEXT_SESSION_PROMPT.md` para a próxima ação concreta.

## Precedência de fontes (quando houver divergência)

1. `AGENTS.md` (raiz) — processo de trabalho dos agentes, sempre vence sobre conteúdo de arquitetura.
2. ADR aceito em `adr/` — decisão arquitetural específica e formal.
3. Documento temático corrente (tabela abaixo, coluna "normativo atual") — especificação detalhada do domínio.
4. `ARCHITECTURE.md` — visão consolidada e índice executivo; não sobrescreve silenciosamente um ADR ou documento temático divergente — divergência entre eles é defeito a corrigir, não licença para escolher.
5. `NEXT_SESSION_PROMPT.md` — estado de execução, nunca fonte normativa de arquitetura.
6. `docs/architecture/history/` — evidência histórica de como se chegou a uma decisão, nunca normativo.

## Índice por documento

| Documento | Classificação | Do que trata |
|---|---|---|
| `../ARCHITECTURE.md` | resumo/índice | Documento consolidado final, aponta para todos os outros |
| `../docs/00-prompt-mestre.md` | histórico/processo (ciclo concluído) | Processo Claude↔Codex que produziu o design; não é ponto de entrada de sessão |
| `quality-criteria.md` | normativo atual | 12 critérios de qualidade, pesos, gates G1-G6 |
| `fitness-function.md` | normativo atual | Fitness function derivada dos critérios |
| `requirements.md` | normativo atual | Requisitos funcionais/não-funcionais, unknowns |
| `capacity-model.md` | normativo atual | Modelo de capacidade Stage 0-5 |
| `architecture-fase3-consolidada.md` | normativo atual | Arquitetura AWS conceitual, 14 decisões numeradas |
| `data-model.md` | normativo atual | Modelo de domínio/dados, DynamoDB single-table, 6 GSIs |
| `slo.md` | normativo atual | SLOs, incluindo drenagem de pico extremo |
| `disaster-recovery.md` | normativo atual | RPO/RTO, teste de restore, runbook |
| `incident-runbooks.md` | normativo atual (draft operacional) | Runbooks OPS-006 (falha de disparo, DLQ, provedor, IA), matriz de severidade/escalonamento, template de post-mortem, registro de exercícios |
| `privacy-lgpd.md` | normativo atual | Classes de retenção, direitos do titular |
| `cost-model.md` | normativo atual | Modelo de custo por estágio |
| `mcp-readiness.md` | normativo atual | Prontidão de domínio para MCP futuro |
| `evolution.md` | normativo atual | Transições de estágio, gatilhos |
| `aws-well-architected-review.md` | normativo atual | Revisão pelos 6 pilares AWS, riscos conhecidos |
| `threat-model.md` | normativo atual | Threat model STRIDE, seção 33 — APPROVED (Claude ~9.05 / Codex 9.002) |
| `implementation-blueprint.md` | normativo atual | Implementation Blueprint, seção 60 — componentes, interfaces, eventos/schemas, ordem de deploy, milestones — APPROVED (Claude 9.20 / Codex 9.2) |
| `m3.5-runtime-design.md` | normativo atual | Design do milestone M3.5 (runtime real do Reminder Engine, fechamento de G8) — adapters DynamoDB, handlers Lambda, outbox+relay SQS/DLQ, EventBridge Scheduler+GSI6, testes em 3 camadas — APPROVED (Claude 9.0 / Codex 9.3) |
| `decisions-log.md` | decisão/ADR (log vivo) | D-000 a D-035 (a numeração não é sequencial na ordem das linhas — D-024 a D-028 foram inseridas antes de D-010 a D-023 no arquivo), nota Claude/Codex, status |
| `reviews/m7-extraction-design/` | histórico/evidência de rodada | Artefatos do protocolo Claude↔Codex de M7 (proposta Claude, proposta Codex, crítica, reconciliação final aprovada — D-035) |
| `adr/` | decisão/ADR | 10 ADRs formais para decisões Type 1 |
| `diagrams/diagrams.md` | normativo atual (visual) | 14 diagramas Mermaid |
| `diagrams/project-status.html` | resumo/índice (visual) | **O documento de status do projeto** — painel visual (timeline de marcos, achados reais, pendências); abrir no navegador para uma visão executiva rápida, mais legível que `NEXT_SESSION_PROMPT.md` para esse fim (que continua sendo a fonte de estado detalhado por sessão) |
| `session-log.md` | histórico | Log cronológico compacto por sessão |
| `reviews/` | histórico/evidência de rodada (protocolo `AGENTS.md` §4, pós-M0) | Artefatos de revisão Claude↔Codex de implementação real, por milestone (ex. `reviews/m3.5-runtime-design/`) — mesmo papel de `history/` (evidência, nunca normativo), mas para rodadas ocorridas depois que código passou a existir, em vez das rodadas de design conceitual pré-implementação |
| `history/` | histórico/supersedido | Artefatos de rodada (propostas, críticas, red team) que produziram os documentos normativos acima — ver subseção |

## `history/` — evidência de rodada, por tema

Cada subpasta contém os artefatos de proposta/crítica/tréplica que antecederam o documento normativo correspondente. Nunca tratar como fonte de decisão vigente — só como prova de como o consenso foi alcançado.

| Subpasta | Documento normativo correspondente |
|---|---|
| `history/quality-criteria/` | `quality-criteria.md` |
| `history/architecture-fase3/` | `architecture-fase3-consolidada.md` |
| `history/data-model/` | `data-model.md` |
| `history/slo/` | `slo.md` |
| `history/disaster-recovery/` | `disaster-recovery.md` |
| `history/privacy-lgpd/` | `privacy-lgpd.md` |
| `history/cost-model/` | `cost-model.md` |
| `history/threat-model/` | `threat-model.md` |
| `history/implementation-blueprint/` | `implementation-blueprint.md` |
