# ADR-0008 — Notification Engine: SQS por Canal + Contratos de Adapter

**Status**: Aceito | **Data**: 2026-08-19 | **Type**: Type 1 (contratos) / Type 2 (adapters/provedores) | **Requisitos**: FR-030..034, COST-006

## Contexto
Produto precisa suportar e-mail, Telegram e WhatsApp sem acoplamento a nenhum provedor específico, com isolamento de falha entre canais.

## Options Considered
1. **Fila SQS própria por canal + adapter com contrato comum (envelope + payload específico) + contract tests** (escolhida).
2. Fila única para todos os canais — rejeitada: falha/rate-limit de um provedor propagaria para os demais (Red Team cenários 3-5).
3. Chamada direta no request (sem fila) — rejeitada: sem isolamento nem retry assíncrono.
4. Campo genérico `usaTemplate` no contrato comum — rejeitada (Rodada 3): vazaria particularidade do WhatsApp para os demais canais; corrigido para envelope comum + payload específico por canal.

## Evidence
`architecture-fase3-consolidada.md` §9; `data-model.md` (`NotificationIntent`/`NotificationAttempt`).

## Correctness Impact
Revalidação de versão do item antes do envio (optimistic concurrency) gera notificação corretiva em vez de entregar dado obsoleto (FR-014, Red Team cenário 13).

## Extensibility Impact
Contract test por adapter garante que trocar provedor de e-mail (ex.: SES→outro) não exige mudança de domínio (FR-033).

## Final Decision
Conforme `architecture-fase3-consolidada.md` §9.

## References
`architecture-fase3-consolidada.md` §9, `data-model.md` §2, `red-team-claude-round1.md` cenários 3-5 e 13.
