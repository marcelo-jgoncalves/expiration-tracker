# Architecture Fitness Function — Plataforma de Controle de Vencimentos

Status: consenso Claude ↔ Codex (Fase 0, pós Rodada 3). Base: `quality-criteria.md`.

## Fórmula

```
Overall = 0.15·Security + 0.14·Privacy_LGPD + 0.14·Correctness_Reliability
        + 0.10·Cost_FinOps + 0.08·Operability_Observability + 0.07·Simplicity
        + 0.07·Maintainability + 0.06·Scalability + 0.06·AI_Trust_Governance
        + 0.05·MultiTenant_Isolation + 0.05·Abuse_CostAttack + 0.03·Extensibility

Escala de cada componente: 0.0 – 10.0
Overall: 0.0 – 10.0, sem arredondamento (8.95 ≠ 9.0)
```

## Gates eliminatórios (independem do Overall)

| Gate | Condição de reprovação |
|---|---|
| G1 — Segurança | Security < 7.0 |
| G2 — Privacidade/LGPD | Privacy_LGPD < 7.0 |
| G3 — Correção/Confiabilidade dos Vencimentos | Correctness_Reliability < 7.0 |
| G4 — Governança de Confiança de IA (condicional) | Se o pipeline de IA/OCR puder criar ou alterar uma data de vencimento sem confirmação humana quando confidence < threshold definido, E o sistema não falhar fechado nesse caso → reprovação automática, independente de nota |
| G5 — Isolamento Multi-tenant (condicional por estágio) | Inativo enquanto o produto for genuinamente single-tenant. Ativa-se automaticamente no primeiro estágio em que dados de tenants distintos compartilhem infraestrutura lógica; a partir daí, qualquer teste negativo de acesso cruzado que passe (isto é, vazar dado de outro tenant) reprova, independente do Overall |
| G6 — Requisitos obrigatórios de Abuso Econômico | Ausência de qualquer um dos seguintes reprova: quotas por usuário/endpoint, rate limiting, limite de tamanho/concorrência de upload, AWS Budgets + anomaly detection, kill switch operável |

## Regra de decisão final

```
STATUS = APPROVED
  SE E SOMENTE SE:
    Claude_Overall >= 9.0
    E Codex_Overall >= 9.0
    E nenhum gate (G1–G6) violado

CASO CONTRÁRIO:
    STATUS = NOT APPROVED → nova rodada obrigatória
```

Claude e Codex atribuem nota **independentemente**, sem ver a nota um do outro antes de registrar a própria (regra anti-anchoring já validada no processo `codex-peer-review-pattern`).

## Como os gates condicionais (G4, G5) devem ser avaliados a cada rodada
Antes de aplicar a fórmula, verificar explicitamente:
1. O desenho atual do pipeline OCR/IA permite alteração automática de vencimento sem revisão humana quando confidence é baixa? → se sim, G4 está ativo e deve ser testado.
2. O estágio de capacidade sendo avaliado (Stage 0–5, ver `capacity-model.md`, a produzir na Fase 2) já envolve dados de mais de um tenant na mesma infraestrutura lógica? → se sim, G5 está ativo.

Essa verificação evita dois erros simétricos: (a) aplicar rigor de gate multi-tenant a um MVP single-tenant, distorcendo a nota sem motivo real; (b) esquecer de ativar o gate quando a arquitetura de fato evoluir para multi-tenant.

## Uso pretendido
Esta fitness function será aplicada:
- ao final da Fase 3 (propostas arquiteturais independentes), rodada a rodada, até status APPROVED;
- novamente após o Architecture Red Team (seção 58 do prompt mestre);
- em qualquer revisão arquitetural futura relevante, para manter comparabilidade histórica via `decisions-log.md`.
