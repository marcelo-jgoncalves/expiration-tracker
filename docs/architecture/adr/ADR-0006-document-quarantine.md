# ADR-0006 — Documentos: S3 com Quarentena Física de 2 Buckets

**Status**: Aceito | **Data**: 2026-08-19 | **Type**: Type 1 (esquema de buckets/ownership) | **Requisitos**: SEC-003, SEC-003a

## Contexto
Documentos enviados pelo usuário são não confiáveis (podem conter malware) e precisam ser isolados antes de disponíveis ao resto do sistema.

## Options Considered
1. **Bucket `quarantine` + bucket `clean`, papéis IAM distintos, promoção só após scan `CLEAN`** (escolhida).
2. Status `PENDING_SCAN` a nível de aplicação num único bucket — rejeitada: barreira de segurança apenas por flag de aplicação, não por IAM (bug de código poderia expor documento não escaneado).
3. Scanner síncrono por upload — rejeitada: GuardDuty Malware Protection é assíncrono por natureza, forçar síncrono adicionaria latência/complexidade desnecessária.

## Rebuttals
Claude propôs inicialmente status a nível de aplicação; Codex propôs quarentena física de 2 buckets (Rodada 1); Claude reconheceu superioridade (Rodada 2) — refinado com estados obrigatórios (`SCANNING`/`CLEAN`/`REJECTED`/`UNSUPPORTED`/`TIMEOUT`) na Rodada 3.

## Evidence
`architecture-fase3-consolidada.md` §7; Red Team cenário 7 (PDF malicioso) — quarentena é a mitigação central.

## Security Impact
Papel IAM do bucket `clean` nunca aceita escrita direta do fluxo de upload — só a função de promoção pode escrever lá.

## Correctness Impact
Fail-closed explícito: `UNSUPPORTED`/`TIMEOUT` não ficam disponíveis por omissão.

## Final Decision
Conforme `architecture-fase3-consolidada.md` §7, com GuardDuty Malware Protection como mecanismo principal e Fargate scanner como fallback.

## References
`architecture-fase3-consolidada.md` §7, `docs/architecture/history/architecture-fase3/red-team-claude-round1.md` cenário 7, `slo.md` §4 (SLA de latência quarantine→clean).
