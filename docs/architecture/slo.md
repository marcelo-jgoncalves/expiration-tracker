# SLOs — Expiration Tracker (Consolidado)

Status: **APPROVED** (Design Maturity) — Claude ~9.08 / Codex 9.001 (exato), ambos ≥9.0, nenhum gate violado.

## Resultado da avaliação
Rodada 1: propostas independentes convergentes no ponto mais crítico (SLO de drenagem do pico extremo = 5min, fechando UNK-CAP-006). Rodada 2: Codex reagiu aos 3 pontos abertos do Claude — concordou parcialmente com dashboard (SLI por operação antes do Stage 3, não bloqueante agora) e reconciliação Stage 5 (orçamento provisório, critério de saída antes de produção), e teve **objeção técnica válida** sobre visibilidade de rejeição ("atingir REJECTED" mede processamento, não UX) — Claude formalizou o SLO `REJECTED→consultável/notificado`. Nota do Codex: 9.001 (exato). Claude: ~9.08. **STATUS: APPROVED.**
Base: `docs/architecture/slo-claude-round1.md`, `docs/architecture/slo-codex-round1.md`, `docs/architecture/capacity-model.md`, `docs/architecture/architecture-fase3-consolidada.md`, `docs/architecture/data-model.md`. Seção 39 do prompt mestre.

## Histórico do debate
- **Rodada 1** — propostas independentes. Convergência muito forte, inclusive na decisão mais importante do documento: **drenar o cenário de pico extremo (1M ocorrências) em 5 minutos**, com justificativa quase idêntica nas duas propostas (1 min exige concorrência desproporcional para uma precisão que o tick de 1min do scanner já não garante; 60 min torna o atraso perceptível). A proposta do Codex era estruturalmente mais madura — adotada como base de consolidação: tabela por estágio (Stage 0–5) em vez de faixas amplas, convenções explícitas de medição (janela móvel, exclusões de manutenção, denominador de sucesso), SLIs numéricos para o pico extremo (≥99% em 5min, 100% em 15min, backlog decrescente), e separação clara entre "tentativa de entrega" e "entrega confirmada" por canal.
- **Rodada 2** — pendente: 3 pontos abertos pelo Claude (dashboard, visibilidade de rejeição de documento, estimativa não validada do Stage 5) ainda não reagidos pelo Codex.

---

## 1. Convenções de medição
- Janela móvel de 30 dias; Stage 0 usa apenas métricas de teste.
- Latências medidas no backend, excluindo rede do cliente e tempo de entrega final do provedor.
- Manutenções programadas só podem ser excluídas com aviso prévio e limite de 4h/mês nos Stages 1–2; a partir do Stage 3 entram no cálculo.
- Operações inválidas, bloqueadas por quota (COST-005) ou rejeitadas por segurança não entram no denominador de sucesso.
- SLOs de IA medem conclusão técnica (chegar a `EXTRACTED` ou `PENDING_CONFIRMATION`), não tempo de confirmação humana.
- DLQ: alarme de idade em 1h, escalonamento em 4h (decisão já fixada no Red Team, Fase 3 Rodada 6 — repetida aqui como SLO formal).

## 2. Metas por estágio
| SLI/SLO | Stage 0 | Stage 1 | Stage 2 | Stage 3 | Stage 4 | Stage 5 |
|---|---:|---:|---:|---:|---:|---:|
| API, p95 | ≤1,5s | ≤800ms | ≤800ms | ≤600ms | ≤500ms | ≤500ms |
| API, p99 | ≤3s | ≤2s | ≤2s | ≤1,5s | ≤1,2s | ≤1,2s |
| Sucesso API não-5xx | ≥98% | ≥99,0% | ≥99,5% | ≥99,9% | ≥99,95% | ≥99,95% |
| Disponibilidade mensal | best effort | ≥99,0% | ≥99,5% | ≥99,9% | ≥99,95% | ≥99,95% |
| Reminder freshness normal, p99 | ≤3min | ≤3min | ≤3min | ≤2min | ≤2min | ≤2min |
| Extração IA/OCR, p95 | ≤10min | ≤5min | ≤5min | ≤5min | ≤7min | ≤10min |
| Extração IA/OCR, p99 | ≤30min | ≤15min | ≤15min | ≤15min | ≤20min | ≤30min |
| Quarentena→disponível, p95 | ≤10min | ≤3min | ≤3min | ≤3min | ≤3min | ≤3min |
| Quarentena→disponível, p99 | ≤30min | ≤10min | ≤10min | ≤10min | ≤10min | ≤10min |

"Reminder freshness" = primeira publicação bem-sucedida na fila do canal − `dueAt` (não recebimento pelo usuário). Com tick de 1 minuto do Reminder Scanner (`architecture-fase3-consolidada.md` §8), p99 de 2min permite um tick perdido/jitter sem prometer precisão subminuto.

Disponibilidade mais baixa nos Stages 1–2 é deliberada: consistente com o risco de falha de região aceito conscientemente no Red Team (cenário 17) e o RTO de 4h já fixado (Fase 3 Rodada 4) — **não prometer o que a arquitetura atual não sustenta** (seção 39, evitar SLO arbitrariamente enterprise). Stage 3 é o gatilho de revisão dessa postura.

## 3. Pico extremo — fechamento de UNK-CAP-006
**Decisão: drenar 1.000.000 de ocorrências em até 5 minutos** (dos 3 cenários modelados em `capacity-model.md`).

SLIs: ≥99% das ocorrências publicadas na fila de notificação em até 5min após `dueAt`; 100% em até 15min (salvo indisponibilidade regional); backlog deve decrescer continuamente após o 1º minuto.

Exige ~3.333 agendamentos/s, até 5.000 intents/s (fan-out médio de 1,5 canal, `capacity-model.md`). Justificativa: 1min exigiria ~16.667 agendamentos/s apenas para preservar uma precisão que o próprio scanner de 1 minuto já não garante — desproporcional. 60min tornaria o atraso perceptível pelo usuário, incompatível com a "reminder freshness" normal de ≤2–3min já fixada acima — inconsistência interna se o pico extremo fosse 12-30x mais lento que o caso normal sem justificativa de produto. 5 minutos é o meio-termo tecnicamente e financeiramente defensável. O SLO cobre scheduler e enqueue interno — não ignora as quotas específicas de SES/Telegram/WhatsApp, que têm SLO próprio de tentativa (seção 6).

## 4. Upload, quarentena e extração
Caminho feliz (arquivo dentro dos limites, efetivamente limpo): `upload concluído → CLEAN` p95≤3min, p99≤10min. Todo upload deve alcançar algum estado terminal (`CLEAN`/`REJECTED`/`UNSUPPORTED`/`TIMEOUT` — estados de `data-model.md`) em ≤15min para 99,9% dos casos. `UNSUPPORTED`/`TIMEOUT` permanecem fail-closed e não contam como disponibilidade bem-sucedida (consistente com a decisão §7 da arquitetura).

Extração medida de `CLEAN` até `EXTRACTED` ou `PENDING_CONFIRMATION` (via `ExtractionRun`, `data-model.md`). Sucesso = produzir um desses estados auditáveis; baixa confiança encaminhada corretamente para confirmação **não é falha** de SLO. Resultado aplicado automaticamente ao item errado é erro de correção com meta **zero** (gate G4, não negociável por SLO).

**Visibilidade de rejeição (refinamento da Rodada 2, revisão do Codex)**: "documento atingiu `REJECTED`/`UNSUPPORTED`/`TIMEOUT`" mede processamento interno, não é o mesmo que o usuário poder ver isso. SLO formalizado: `REJECTED/UNSUPPORTED/TIMEOUT → estado consultável pela API + evento de notificação enfileirado`, p95 ≤1min, p99 ≤5min a partir do estado terminal. Renderização no cliente fica fora do backend (não mensurável pela arquitetura), mas a disponibilização da informação para consulta/notificação não fica mais implícita.

## 5. Reconciliação
Completa segmentada ≥1x/24h (NFR-004). Janela de conclusão: ≤2h Stages 0–3, ≤6h Stage 4, ≤12h Stage 5 (~8M itens, estimativa não validada por teste real — ver "Pontos abertos"). ≥99,9% das ocorrências ausentes detectadas recriadas na mesma execução. Sweeper de outbox/upload/webhook inbox (Red Team Rodada 6, `data-model.md`): cadência ≤5min, p99 de reenfileiramento/restituição ≤15min. Revalidação de timezone/DST dos próximos 7 dias integra a execução diária (decisão Fase 3 Rodada 4).

## 6. Tentativa de entrega por canal
Medida de `NotificationIntent` elegível até a primeira chamada aceita/rejeitada explicitamente pelo provedor.
| Canal | p95 | p99 |
|---|---:|---:|
| E-mail/SES | ≤2min | ≤5min |
| Telegram | ≤2min | ≤5min |
| WhatsApp | ≤5min | ≤15min |

Meta de tentativa registrada: ≥99,9% Stages 1–3, ≥99,95% Stages 4–5. **Aceite pelo provedor ≠ entrega ao destinatário** — confirmação, bounce e falha permanente são SLIs separados (não definidos aqui, dependem de `NotificationAttempt.status`, `data-model.md`). Pico extremo usa a janela interna de 5min; tentativa externa segue sujeita à quota específica de cada provedor (Red Team, cenários 3–5).

## Pontos abertos (Claude, Rodada 1 — aguardando reação do Codex)
1. Sem SLO de latência específico para o dashboard (queries GSI1/GSI2 potencialmente mais pesadas que outros endpoints da API) — só a meta genérica de API se aplica hoje.
2. Sem SLO explícito de "tempo até o usuário ver que um documento foi rejeitado" como experiência de usuário — implícito no SLA de quarentena (seção 4), mas não formalizado como métrica de UX separada.
3. Janela de reconciliação do Stage 5 (≤12h) é estimativa não validada por nenhum teste real de throughput de scan em lote sobre ~8M itens — registrado como tal, não fingindo certeza.
