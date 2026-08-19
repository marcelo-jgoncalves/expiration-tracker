# ADR-0007 — Disaster Recovery: RPO/RTO por Componente e Risco de Região Aceito

**Status**: Aceito | **Data**: 2026-08-19 | **Type**: Type 1 | **Requisitos**: OPS-005

## Contexto
Produto precisa de metas de recuperação claras sem adotar multi-region por prestígio (seção 43 do prompt mestre).

## Options Considered
1. **RPO≤5min/RTO≤4h para falhas dentro da região; falha de região inteira é risco aceito até gatilho de negócio** (escolhida).
2. Multi-region ativo-ativo desde o Day 0 — rejeitada: custo/complexidade desproporcionais ao estágio atual do produto (CON-002).
3. Sem meta formal de RPO/RTO — rejeitada: viola OPS-005 explicitamente.

## Evidence
`disaster-recovery.md`; Red Team cenário 17 (falha de região) e 18 (restore de banco).

## Reliability Impact
Teste de restore real é gate obrigatório antes do primeiro usuário externo (não apenas "PITR habilitado" — distinção corrigida entre design e evidência operacional).

## Trade-offs
Risco de região aceito conscientemente, com gatilho de revisão explícito (primeiro cliente com SLA contratual ou Stage 3) — documentado, não implícito.

## Final Decision
Conforme `disaster-recovery.md` §1-2, com procedimento de restore, reparo seletivo por tenant para corrupção tardia, e matriz `retentionClass`/`legalHold` para backup cross-region por classe de documento (`privacy-lgpd.md`).

## References
`disaster-recovery.md`, `privacy-lgpd.md` §4, `evolution.md` (gatilho de revisão multi-region).
