# Expiration Tracker — Status e Próxima Sessão

Projeto: micro-SaaS de controle de vencimentos/renovações. Pasta: `c:\Users\Usuario\Desktop\projects\expiration-tracker\`. Repo GitHub: `marcelo-jgoncalves/expiration-tracker` (privado).

Mapa completo de documentação, status vigente e regra de precedência: `docs/architecture/README.md`. Regras de processo e ferramentas: `AGENTS.md`. Log cronológico de sessões: `docs/architecture/session-log.md`.

## Status atual

```text
DESIGN MATURITY STATUS: APPROVED
ARCHITECTURE STATUS: NOT APPROVED
```

Todo o processo de arquitetura conceitual (Fases 0-3 do prompt mestre + os 14 entregáveis das seções 35-52) está completo e aprovado — ver `ARCHITECTURE.md` na raiz para o documento consolidado. `ARCHITECTURE STATUS: NOT APPROVED` é o estado normativo correto até haver implementação real testada sob falha/carga (rubrica B, requirements.md §13.1) — não é reprovação de mérito.

Engenharia de contexto do projeto (este arquivo, `AGENTS.md`, `docs/architecture/README.md`, `docs/project/working-memory.md`) foi revisada e reestruturada em 2026-08-19 — ver `docs/architecture/session-log.md` para o resumo.

## Concluído nesta sessão — Threat Model (seção 33) — APPROVED
`docs/architecture/threat-model.md`. STRIDE completo, 22 ameaças (17 em comum entre as duas propostas independentes), 6 de severidade Alta (session theft/CSP, PDF sem sandbox de parser, leaked documents, compromised provider, supply-chain sem pin por digest, dependency compromise), 7 lacunas novas a fechar antes/durante a implementação. Nota final: **Claude ~9.05 / Codex 9.0 (exato 9.002)** — ambos ≥9.0, nenhum gate violado, 2 rodadas.

## Próxima ação obrigatória

1. **Implementation Blueprint** (`docs/architecture/implementation-blueprint.md`, não iniciado) — componentes, módulos, interfaces, eventos, schemas, ordem de deploy, milestones, dependências, critérios de aceite técnicos. Pode incorporar diretamente as 7 lacunas do threat model (CSP, sandbox de PDF, matriz de autorização, egress allowlist, redactor de logs, supply-chain hardening, gestão de dependências) como requisitos técnicos de implementação, não itens à parte.
2. Implementação real seguindo as ~27 decisões já consolidadas (`docs/architecture/decisions-log.md`).
3. Testes de carga real, teste de restore real (gate já definido em `disaster-recovery.md` §6), exercício do runbook de credencial comprometida.
4. Reavaliação sob rubrica (B) — Operational Evidence — só então `ARCHITECTURE STATUS` pode legitimamente virar `APPROVED`.
5. Decisões de produto ainda pendentes de pesquisa externa (não bloqueiam início da implementação, mas bloqueiam habilitar os canais/features específicos): BSP WhatsApp (pricing real, UNK-003), modelo Bedrock específico, região AWS (bloqueante para LGPD/transferência internacional), MFA obrigatório vs. opcional (UNK-006).
