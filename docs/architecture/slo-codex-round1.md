# SLOs — Codex, Rodada 1 (Proposta Independente)

Status: proposta independente do Codex, sem acesso à proposta do Claude.
Base: `docs/architecture/capacity-model.md`, `docs/architecture/architecture-fase3-consolidada.md`.

## 1. Convenções de medição
- Janela móvel de 30 dias; Stage 0 usa apenas métricas de teste.
- Latências medidas no backend, excluindo rede do cliente e tempo de entrega final do provedor.
- Manutenções programadas só podem ser excluídas com aviso prévio e limite de 4h/mês nos Stages 1–2; a partir do Stage 3 entram no cálculo.
- Operações inválidas, bloqueadas por quota ou rejeitadas por segurança não entram no denominador de sucesso.
- SLOs de IA medem conclusão técnica, não tempo de confirmação humana.
- DLQ mantém a decisão existente do Red Team: alarme com mensagem mais antiga em 1h, escalonamento em 4h.

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

"Reminder freshness" = primeira publicação bem-sucedida na fila do canal − dueAt (não recebimento pelo usuário). Com tick de 1 minuto, p99 de 2 minutos permite um tick perdido/jitter sem prometer precisão subminuto.

Disponibilidade mais baixa nos Stages 1–2 é deliberada: RTO de 4h aceito, sem recuperação cross-region. Stage 3 é o gatilho de revisão. Não promete 99,99% sem redundância/evidência compatíveis.

## 3. Pico extremo — fechamento de UNK-CAP-006
**Decisão: drenar 1.000.000 de ocorrências em até 5 minutos.**
SLIs: ≥99% publicadas em até 5min após dueAt; 100% em até 15min (salvo indisponibilidade regional); backlog decrescente continuamente após o 1º minuto.
Exige ~3.333 agendamentos/s, até 5.000 intents/s (fan-out 1,5). Justificativa: 1min exigiria 16.667/s só para preservar precisão que o scanner de 1min já não garante; 60min tornaria o atraso perceptível, incompatível com a freshness normal. SLO cobre scheduler/enqueue interno, não ignora quotas de provedor.

## 4. Upload, quarentena e extração
Caminho feliz: `upload concluído → CLEAN` p95≤3min, p99≤10min. Todo upload alcança estado terminal (CLEAN/REJECTED/UNSUPPORTED/TIMEOUT) em ≤15min para 99,9% dos casos — UNSUPPORTED/TIMEOUT são fail-closed, não contam como sucesso.
Extração medida de CLEAN até EXTRACTED ou PENDING_CONFIRMATION — confiança baixa encaminhada corretamente não é falha; resultado aplicado automaticamente ao item errado tem meta zero.

## 5. Reconciliação
Completa segmentada ≥1x/24h. Janela: ≤2h Stages 0–3, ≤6h Stage 4, ≤12h Stage 5 (~8M itens). ≥99,9% de ocorrências ausentes recriadas na mesma execução. Sweeper de outbox/upload/webhook inbox: cadência ≤5min, p99 de reenfileiramento/restituição ≤15min. Revalidação DST dos próximos 7 dias integra a execução diária.

## 6. Tentativa de entrega por canal
| Canal | p95 | p99 |
|---|---:|---:|
| E-mail/SES | ≤2min | ≤5min |
| Telegram | ≤2min | ≤5min |
| WhatsApp | ≤5min | ≤15min |
Meta de tentativa registrada: ≥99,9% Stages 1–3, ≥99,95% Stages 4–5. Aceite pelo provedor ≠ entrega ao destinatário (SLIs separados). Pico extremo usa a janela interna de 5min, tentativa externa segue sujeita à quota do provedor.
