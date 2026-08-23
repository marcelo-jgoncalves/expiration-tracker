---
status: draft
owner: Marcelo
authority: informativo (revisão quantitativa de um pré-requisito já registrado em D-039/06-domain-model-automated-chasing.md; não é uma decisão de arquitetura nova, não passa pelo protocolo Claude↔Codex — é verificação de números contra limites já decididos em `slo.md`/`capacity-model.md`)
---

# Mini-revisão de capacidade — Automated Document Chasing reaproveitando GSI3

`06-domain-model-automated-chasing.md` (D-039) condicionou a reutilização do GSI3 por
`DocumentChasingOccurrence` a esta revisão, antes da implementação real: "revisão quantitativa de
`documentRequestsAtivos × triggersPorRequest × concentraçãoPorMinuto` contra os limites já
modelados". Esta é essa revisão — pré-requisito fechado antes de qualquer código de cluster 4 ser
escrito.

## Método

Mesma metodologia de `capacity-model.md` (fórmula `diário × 5 ÷ 1440` para pico por minuto,
rótulos ASSUMPTION/ESTIMATE/KNOWN explícitos). Usa o Stage 5 (1.000.000 de tenants) já modelado
como pior caso orgânico, e compara o pico combinado (reminders existentes + chasing novo) contra o
SLO de drenagem de pico extremo já fechado em `slo.md` §3 (5 minutos, ~3.333 agendamentos/s) — não
contra o pico orgânico de reminders isoladamente, que não é o limite dimensionante real do GSI3.

## Estimativa de volume — Stage 5

| Variável | Valor | Classificação |
|---|---|---|
| Tenants (Stage 5, `capacity-model.md`) | 1.000.000 | KNOWN (definição do estágio) |
| Taxa de adoção de `TrackedSubject`/`RequirementAssignment` (feature nova, nicho mais estreito que `ExpirationItem` — "vendor/employee document compliance", não todo tenant precisa) | 20% dos tenants | ASSUMPTION |
| Tenants adotantes | 200.000 | derivado |
| `TrackedSubject` ativos médios por tenant adotante (abaixo do teto de 25 do plano free, `TenantEntitlement`/D-038 — a maioria não satura o limite) | 10 | ASSUMPTION |
| `TrackedSubject` ativos totais | 2.000.000 | derivado |
| `RequirementAssignment` médios por subject | 2 | ASSUMPTION (mesma ordem de grandeza do "requisitos associados" citado em `03-domain-model-tracked-subject-requirement.md`) |
| `RequirementAssignment` totais | 4.000.000 | derivado |
| Fração de assignments com `DocumentRequest` ativo num instante dado (a janela do token é ≤14 dias dentro de um ciclo de vida de requisito tipicamente mais longo — a maioria do tempo o requisito está `SATISFIED` ou ainda sem solicitação aberta) | 15% | ASSUMPTION |
| `DocumentRequest` ativos simultâneos | 600.000 | derivado |
| Gatilhos de chasing realizados por `DocumentRequest` ao longo do seu ciclo de vida (preset `document-request-standard-v1` lista até 5 níveis — T-30/T-14/T-7/T-3+EXPIRED — mas a maioria dos `DocumentRequest` tem janela ≤14 dias, então T-30 raramente dispara; média realista fica perto de 3, não 5) | 3 | ASSUMPTION |
| `DocumentChasingOccurrence` geradas / 14 dias | 1.800.000 | derivado (600.000 × 3) |
| `DocumentChasingOccurrence` / dia | ≈ 128.571 | derivado (÷14) |
| Pico por minuto (fórmula `diário × 5 ÷ 1440`) | ≈ 446/min (≈ 7,4/s) | ESTIMATE |

## Comparação contra os limites já fechados

- **Pico orgânico combinado (Stage 5)**: reminders (~463/min, ~7,7/s, já modelado) + chasing
  (~446/min, ~7,4/s, esta revisão) ≈ **909/min (~15,2/s)**. Mesma ordem de grandeza do pico de
  reminders isolado — a adição de chasing aproximadamente **dobra** o pico orgânico do GSI3, mas
  não muda a ordem de grandeza.
- **SLO de drenagem de pico extremo** (`slo.md` §3, já fechado): ~3.333 agendamentos/s. O pico
  orgânico combinado (~15,2/s) é **~220× menor** que essa capacidade dimensionante — a margem já
  existente no GSI3 (dimensionado para o cenário adversarial de 1M ocorrências/5min, não para o
  tráfego orgânico) absorve confortavelmente o tráfego de chasing sem exigir shards adicionais.
- **Pior caso de concentração** (a preocupação real citada em D-039, não o volume médio): hoje
  não existe criação em lote de `DocumentRequest` — a única rota é `POST` individual via API
  tenant-facing (M10 desta sessão). O pior caso plausível é um tenant grande criando até seu teto
  de 25 `TrackedSubject`/assignments no mesmo minuto com o mesmo `deadline` — no máximo dezenas de
  ocorrências concentradas num shard-minuto, desprezível frente à capacidade por shard já
  dimensionada para o cenário de 1M. **Quando CSV import (D-042, ainda não implementado) existir**,
  esta análise precisa ser refeita — import em massa de `DocumentRequest` é o cenário de
  concentração que poderia de fato aproximar-se do pico extremo, não o tráfego orgânico atual.

## Conclusão

**GSI3 reaproveitado sem índice paralelo, sem shards adicionais — aprovado para implementação.**
Duas ações concretas exigidas independente do resultado (já previstas em D-039, não uma decisão
nova):

1. **Atualizar o entendimento documentado do GSI3** em `data-model.md` de "scheduler de
   `ReminderOccurrence`" para "scheduler global de ocorrências agendadas, discriminado por
   `entityType` na própria chave" — mudança de entendimento/documentação, não de mecanismo de
   proteção (mesmas salvaguardas: só producer/reconciliation leem o índice, projeção mínima sem
   PII, IAM restrito).
2. **Alarmes de GSI3 segmentados por `entityType`** desde o primeiro dia de implementação — para
   que um pico anômalo de chasing (ex.: bug de materialização em loop) seja distinguível de um
   pico de reminders na observabilidade, não apenas no agregado.

**Revisitar esta revisão quando**: CSV import de `DocumentRequest` for implementado (pior caso de
concentração muda de ordem de grandeza); taxa de adoção real de `TrackedSubject` divergir
significativamente dos 20%/10/2 assumidos aqui (não há dado real ainda — é o primeiro uso do
recurso); ou o preset de política de chasing ganhar mais níveis/canais que os 3 assumidos.
