> **Status: histórico/supersedido.** Artefato de rodada do processo Claude↔Codex; não é normativo. Documento sucessor: `../../slo.md`.

# SLOs — Claude, Rodada 1 (Proposta Independente)

Status: proposta independente do Claude, antes de ver a do Codex.
Base: `docs/architecture/requirements.md`, `docs/architecture/capacity-model.md`, `docs/architecture/architecture-fase3-consolidada.md`, `docs/architecture/data-model.md`. Seção 39 do prompt mestre: "definir SLOs por fase, evitar SLOs arbitrariamente enterprise."

## Princípio
SLOs por **estágio de capacidade** (Stage 0–5, `capacity-model.md`), não um número único fixo para sempre — evita tanto SLO frouxo demais para Stage 5 quanto SLO "enterprise" caro demais para Stage 0–1 (seção 39 exige explicitamente evitar isso).

## 1. API (latência)
| Estágio | p50 | p99 | Justificativa |
|---|---|---|---|
| Stage 0–1 | ≤ 300ms | ≤ 1.5s | Lambda cold start é o principal fator; sem tráfego suficiente para justificar provisioned concurrency (custo, viola COST-001) |
| Stage 2–3 | ≤ 200ms | ≤ 1s | Provisioned concurrency seletiva nos endpoints mais usados (dashboard, login) passa a se justificar |
| Stage 4–5 | ≤ 150ms | ≤ 800ms | Volume justifica otimização mais agressiva de cold start |

## 2. Reminder freshness (frescor do lembrete — a decisão mais importante deste documento)
**Fecha UNK-CAP-006** (SLO de drenagem do cenário de pico extremo, pendente desde a Fase 2): dos três cenários modelados em `capacity-model.md` (drenar em 1/5/60 min), a escolha é **drenar em 5 minutos** para o cenário adversarial de 1M ocorrências simultâneas.
**Justificativa**: 1 minuto exige concorrência de consumidor ~5x maior que 5 minutos (16.667/s vs. 3.333/s) sem benefício de produto claro — usuário não percebe diferença prática entre notificação 1 min ou 5 min após o vencimento predito. 60 minutos é barato mas cria uma janela em que "lembrete" e "realidade" divergem por até uma hora num evento raro — aceitável seria, mas 5 min já é confortavelmente barato E rápido o suficiente. Escolha de meio-termo deliberada, não a mais barata nem a mais cara.
Para o **caso normal** (não pico extremo): reminder freshness (tempo entre "devido" e "agendado na fila") ≤ 1 minuto em todos os estágios — decorre diretamente do tick de 1 minuto do Reminder Scanner (`architecture-fase3-consolidada.md` §8), não é uma meta adicional, é uma consequência do desenho já aprovado.

## 3. Extração (IA/OCR)
| Métrica | Alvo | Justificativa |
|---|---|---|
| Tempo de execução da Step Function (upload limpo → ExtractedField ou PENDING_CONFIRMATION) | ≤ 2 min p95 | Usuário espera feedback razoavelmente rápido após upload, mas não é tempo real — não há requisito de UX síncrona (FR-041 não exige resposta imediata) |
| Taxa de PENDING_CONFIRMATION | sem alvo numérico fixo — é uma métrica de **qualidade do pipeline**, não de SLO de disponibilidade; monitorada (FR-042 já exige precisão/recall/calibração), não é uma promessa ao usuário |

## 4. Filas críticas (SLA de quarentena, DLQ)
**Fecha item aberto #9** (SLA de latência quarantine→clean, pendente desde a Fase 3): ≤ 2 min p95 para o caminho feliz (coberto pelo GuardDuty), ≤ 15 min p95 quando cai no fallback Fargate (item `UNSUPPORTED`). Justificativa: GuardDuty Malware Protection tipicamente processa em segundos a poucos minutos; Fargate sob demanda tem cold start de container, daí o alvo mais frouxo.

**DLQ (formaliza os valores já fixados no Red Team, Rodada 6)**: alarme de idade em 1h, escalonamento (revisão humana) em 4h — já decidido, repetido aqui como SLO formal, não uma nova decisão.

**Reconciliação diária (NFR-004)**: cadência ≤ 24h já é requisito; SLO formal aqui: execução completa (todos os itens ativos verificados) em ≤ 2h de janela de execução em todos os estágios até Stage 4; Stage 5 (8M itens) pode exigir até 4h — a validar com dado real de throughput de scan em lote, não uma garantia definitiva nesta fase.

## 5. Entrega por canal
| Canal | SLO de tentativa (não de entrega — fora do controle do sistema) | Justificativa |
|---|---|---|
| E-mail | 1ª tentativa em ≤ 1 min após NotificationIntent | SES é rápido; principal fator é a fila interna, não o provedor |
| Telegram | 1ª tentativa em ≤ 1 min | Mesma lógica |
| WhatsApp | 1ª tentativa em ≤ 2 min | BSP pode ter latência adicional de validação de template — folga maior |
**Nota**: SLO é de *tentativa de envio*, nunca de *entrega confirmada* — entrega depende do provedor externo, fora do controle da arquitetura (consistente com o Red Team, cenários 3–5).

## 6. Disponibilidade (uptime)
| Estágio | Alvo | Justificativa |
|---|---|---|
| Stage 0–2 | Sem SLA formal a clientes (best-effort) | MVP, sem cliente pagante com contrato (mesmo gatilho já usado para região única no Red Team) |
| Stage 3+ | 99.5% mensal (best-effort ainda, mas monitorado) | Ainda sem redundância multi-region — não prometer o que a arquitetura atual não sustenta |
Formalizado explicitamente: **não fixar 99.9%+ agora** seria um SLO "arbitrariamente enterprise" (proibido pela seção 39) dado que a arquitetura aceita conscientemente risco de falha de região (Red Team cenário 17).

## Lacunas conscientes (para debate com o Codex)
1. Não defini SLO de latência para o dashboard especificamente (só API genérica) — dashboard pode ter queries mais pesadas (GSI1/GSI2) que outros endpoints.
2. Não defini SLO de "tempo até o usuário ver que um documento foi rejeitado" — está implícito no SLA de quarentena, mas não explicitado como experiência do usuário.
3. O alvo de reconciliação do Stage 5 (≤4h) é uma estimativa não validada por nenhum teste real — registrado como tal, não fingindo certeza.
