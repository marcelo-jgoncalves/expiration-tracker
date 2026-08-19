# Architecture Red Team — Codex, Rodada 1 (Proposta Independente)

Status: análise independente do Codex, sem acesso à análise do Claude, conforme protocolo de propostas independentes.
Base: `docs/architecture/architecture-fase3-consolidada.md`, seção 58 do prompt mestre.

Legenda: **I** impacto; **E** comportamento esperado; **D** detecção; **M** mitigação; **R** recovery; **L** lacuna.

1. **100× crescimento.** I: throttling, latência, custo. E: DynamoDB on-demand/Lambda/SQS/shards escalam horizontalmente. D: métricas de throttling/concorrência/lag/custo. M: reserved concurrency, quotas por tenant, re-sharding. R: ampliar limites/concurrency, drenar filas. **L**: sem plano de load test progressivo nem quotas AWS verificadas por estágio.

2. **1M lembretes no mesmo horário.** I: atraso massivo, pressão sobre provedores. E: ocorrências pré-materializadas + shards + SQS absorvem burst. D: reminder lag, throttling, idade de mensagens. M: jitter, token bucket por canal, re-sharding. R: drenagem conforme SLO. **L**: SLO 1/5/60min não escolhido; 4 shards não demonstrados sob teste extremo.

3. **WhatsApp indisponível 6h.** I: backlog grande, lembretes atrasados. E: retry/backoff, fila independente, sem marcar entregue. D: falhas do adapter, idade da fila. M: token bucket, DLQ, kill-switch. R: reativar e drenar respeitando validade. **L**: falta circuit breaker, política de expiração/obsolescência de mensagem, fallback opcional de canal.

4. **Telegram indisponível.** Mesma estrutura do item 3 — isolamento preserva outros canais. **L**: mesma ausência de circuit breaker/validade/fallback; sem kill-switch Telegram explícito.

5. **E-mail degradado.** I: latência, bounces, throttling. E: adapter SES com concorrência limitada e retry. D: taxa de entrega/bounce, idade da fila. M: backoff/token bucket. R: redrive controlado. **L**: sem classificação entre erro transitório/bounce permanente/complaint, nem política de supressão/reputação.

6. **LLM indisponível.** I: extração automática interrompida. E: Step Functions leva a `PENDING_CONFIRMATION`, nada alterado automaticamente. D: erros/timeouts, confiança. M: parser determinístico, kill-switch AI. R: revisão manual/retry posterior. **L**: falta política explícita de retry/redrive de execuções pendentes e limite de idade do backlog.

7. **PDF malicioso.** I: malware/exploração do pipeline. E: quarentena de 2 buckets, GuardDuty, fail-closed. D: achados GuardDuty, estados `REJECTED/UNSUPPORTED/TIMEOUT`. M: IAM separado, magic bytes, KMS. R: excluir/reter conforme política. **L**: SLA e cobertura por formato/tamanho seguem abertos; falta retenção forense dos rejeitados.

8. **Prompt injection.** I: extração manipulada. E: documento é dado, não instrução; comparação de extratores + confirmação humana. D: divergência/confiança baixa. M: fail-closed. R: revisão manual. **L**: sem testes adversariais, sem versionamento de prompts/modelos, sem restrição explícita de ferramentas/saídas do modelo.

9. **Upload massivo.** I: custo de S3/GuardDuty/OCR/filas. E: token bucket protege API, kill-switch interrompe OCR/AI. D: custo, anomalias, volume. M: presigned URLs curtas, concorrência reservada. R: suspender processamento, limpar por lifecycle. **L real**: **upload direto via URL presigned pode contornar a quota de requests da API** (a quota é verificada na geração da URL, não no PUT direto ao S3); faltam quota de bytes/objetos, tamanho máximo hard, orçamento por tenant, limite de uploads pendentes simultâneos.

10. **Duplicação de eventos.** I: notificações/transições duplicadas. E: idempotência condicional DynamoDB, eventos versionados. D: conflitos de condição (não hà métrica explícita). M: chave idempotente. R: reconciliador corrige. **L**: falta definir escopo/TTL/semântica da chave idempotente por tipo de evento.

11. **Poison message.** I: retries infinitos, custo, bloqueio parcial. E: DLQ por canal após retries. D: oldest-message-age, alarmes. M: isolamento por fila. R: corrigir consumidor + redrive. **L**: falta `maxReceiveCount` definido, quarentena sem redrive automático, proteção contra reprocessar a mesma poison message repetidamente.

12. **DLQ cresce por dias.** I: perda operacional, custo, expiração. E: alarmes de idade, redrive previsto. D: idade, mas não profundidade/taxa. M: canal isolado. R: redrive após correção. **L**: sem owner, SLA, retenção, limiar de crescimento, runbook, controle de velocidade do redrive.

13. **Data alterada após alerta agendado.** I: alerta obsoleto/incorreto. E: outbox crítico + revalidação de versão antes do envio; gera correção. D: mismatch de versão, reconciliador. M: idempotência, sweeper. R: cancelar ocorrência antiga/materializar nova. **L real**: a transação atômica entre alteração do item, invalidação da ocorrência antiga e materialização da nova não está especificada — permanece uma corrida (race condition) possível perto do horário de envio.

14. **Documento removido durante processamento.** I: resultado "ressuscitado", erro, retenção indevida. E: exclusão rastreável prevista, mas concorrência com Step Functions não definida. D: falhas de leitura seriam visíveis. M/R: não especificados. **L real**: falta tombstone/version-check em cada etapa da Step Function, cancelamento da execução em andamento, descarte de resultado tardio, garantia de apagamento em artefatos derivados (Textract/Bedrock).

15. **Provedor duplica webhook.** I: estado/notificações duplicadas. E: assinatura validada, idempotência geral. D: conflitos de idempotência. M/R: deduplicar, responder sucesso ao replay. **L real**: não há um "inbox" de webhook dedicado com `providerEventId`, TTL e proteção anti-replay/ordenação fora de sequência — a idempotência genérica de NFR-002 não é o mesmo que um padrão de inbox robusto.

16. **Credencial comprometida.** I: acesso a dados, envio fraudulento, custo. E: IAM least privilege, Secrets Manager, CloudTrail reduzem impacto. D: CloudTrail/Cost Anomaly Detection. M: roles por função, KMS. R: não definido. **L real**: falta rotação/revogação emergencial, alertas de uso anômalo específicos, runbook de resposta, procedimento de investigação/notificação LGPD.

17. **Falha de região.** I: indisponibilidade total, perda potencialmente maior que o RPO declarado. E: MVP aceita região única, RTO≤4h. D: alarmes regionais. M: backups/versionamento locais (não cross-region). R: sem mecanismo concreto. **L real**: RPO de 5min via PITR **não equivale** a DR regional — faltam cópias cross-region, IaC de recuperação, região-alvo definida, estratégia de DNS/failover.

18. **Restore de banco necessário.** I: indisponibilidade, inconsistência entre banco/S3/filas/outbox. E: PITR/backups habilitados. D: não definida. M: PITR reduz perda. R: restore real pendente. **L**: faltam testes de restore, critérios de integridade pós-restore, reconciliação entre DynamoDB restaurado e S3/filas/outbox, tratamento de eventos duplicados pós-restore.

19. **Erro de deploy.** I: regressão/interrupção. E: canário, smoke test, rollback de alias Lambda. D: métricas, smoke tests. M: scans, testes, aprovação manual. R: rollback. **L real**: rollback de alias Lambda **não cobre** mudanças incompatíveis em schema DynamoDB, contratos de evento ou Step Functions — falta estratégia expand/contract e rollback de estado, não só de código.

20. **Ataque de custo AWS.** I: gasto excessivo, exaustão de capacidade. E: WAF, quota por tenant, Budgets, anomaly detection, kill-switches. D: alertas de custo/volume. M: rate limits, interrupção AI/OCR/WhatsApp. R: bloquear origem/tenant, drenar/descartar trabalho inválido. **L**: AWS Budgets **não são hard caps** (só alertam) — faltam limites técnicos por recurso/tenant, proteção específica para presigned uploads (ver item 9), detecção antes (não só depois) de operações caras assíncronas.

## Resumo das lacunas reais (Codex)
| Área | Lacuna prioritária |
|---|---|
| Provedores | Circuit breaker, validade do backlog, fallback, classificação de erros |
| Upload/custo | Quotas de bytes/objetos e proteção de URLs presigned (contornam quota de request) |
| Filas/DLQ | Runbook, ownership, retenção, redrive seguro, poison quarantine |
| Concorrência | Transações/version-checks para alteração de data e exclusão de documento |
| Webhooks | Inbox idempotente, anti-replay, ordenação |
| Segurança | Rotação/revogação emergencial e resposta a credencial comprometida |
| DR/restore | Recuperação cross-region e restore testado com reconciliação |
| Deploy | Compatibilidade e rollback de dados/eventos/infraestrutura (expand/contract) |
| Capacidade | SLO do pico de 1M e load tests validando shards/quotas |
| IA | Testes adversariais, versionamento de prompt/modelo, redrive do backlog pendente |
