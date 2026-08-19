# ADR-0005 — Controles de Segurança e Kill Switch

**Status**: Aceito | **Data**: 2026-08-19 | **Type**: Type 1 | **Requisitos**: COST-004/005, gate G6, SEC-006/007

## Contexto
Produto precisa de defesa contra abuso de custo (chamadas de IA, WhatsApp) sem depender só de detecção pós-fato.

## Options Considered
1. **AWS AppConfig para kill switch de emergência (`AI`/`OCR`/`WHATSAPP`) + SSM Parameter Store para flags não-emergenciais** (escolhida).
2. SSM Parameter Store para tudo — rejeitada para o caso de emergência: sem validação/rollout controlado/histórico operacional que AppConfig oferece nativamente.
3. Flags em variável de ambiente de deploy — rejeitada: não atende COST-004 (exige novo deploy para reagir a um ataque em andamento).

## Evidence
`architecture-fase3-consolidada.md` §14; Red Team cenário 20 (ataque de custo) — kill switch é a mitigação central.

## Cost Impact
Kill switch com comportamento fail-safe por operação: IA fica pendente para revisão manual (não descarta); OCR mantém jobs em fila; WhatsApp suspende sem marcar como entregue.

## Security Impact
IAM least privilege via `ScopedLambdaFunction` (padrão CDK compartilhado); Secrets Manager para credenciais externas; CloudTrail para auditoria de uso.

## Trade-offs
AppConfig adiciona uma dependência de serviço a mais comparado a SSM puro — aceito pelo ganho de rollout controlado em cenário de emergência real.

## Final Decision
AppConfig para os 3 kill switches de emergência; SSM aceitável para flags simples não-emergenciais.

## References
`architecture-fase3-consolidada.md` §14, `red-team-claude-round1.md`/`red-team-codex-round1.md` cenário 20, `cost-model.md` (controles de G6).
