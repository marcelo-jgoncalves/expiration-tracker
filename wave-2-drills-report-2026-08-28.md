# Wave 2 — Relatório dos Drills Operacionais (2026-08-28)

Executado contra `dev` real (conta AWS `975707451904`, profile `claude-dev`). Detalhe completo com timestamps/logs/comandos: `docs/engineering/pilot-readiness-program.md`, seção Wave 2.

## Resultado

| Drill | Status | Achado principal |
|---|---|---|
| **W2-03** — kill switch M7 | ✅ DONE | Gate off = zero chamada real ao Textract (`OcrDisabledError`, custo zero). Gate on = chamada real completa em ~8s, incluindo callback assíncrono via SNS. Bônus: idempotência real comprovada num retry acidental. |
| **W2-04** — pipeline de lembretes | ✅ DONE | Cadeia real policy→occurrence→dispatch→router disparada de ponta a ponta. Resultado real: `CANCELLED` por `RECIPIENT_NOT_FOUND` (tenant sintético sem perfil) — comportamento correto de fail-safe, não um bug. |
| **W2-05** — DLQ/replay | ✅ DONE | Mensagem "envenenada" enviada à DLQ, redrive real via `start-message-move-task`, worker consumiu sem erro e sem efeito colateral duplicado (`SKIPPED_NOT_CLAIMED`). |
| **W2-06** — restore/RPO-RTO | ✅ DONE | Restore real via PITR. **RTO medido: 3min44s**. 7/7 itens confirmados via scan real (não só a métrica de contagem, que fica defasada até 6h). Tabela de teste removida ao final. |
| **W2-07** — load test | ✅ DONE | 977 invocações reais em 90s (~12 req/s, pico Stage 3). Cota real segurou sob carga: 200 OK, depois 773 corretamente rejeitadas com `429` — não é bug, é o gate funcionando. Só 0,4% de erro real/throttle. Latência p99=1,8s. 20/20 chamadas reais ao Textract também bem-sucedidas. |
| **W2-08** — alarmes / credential compromise | 🟡 PARCIAL | Alarme forçado (`set-alarm-state`) confirmou notificação SNS→e-mail real. Credential-compromise em si não testado. |

## Achado real não planejado (o mais importante deste relatório)

O alarme `exptrk-dev-upload-finalizer-dlq-age` está em `ALARM` **desde 22/08 (6 dias)**, com 3 mensagens reais nunca reprocessadas (sobra de um teste anterior). A notificação por e-mail disparou corretamente na época — mas ninguém agiu. **O mecanismo de alerta funciona; não há evidência de resposta operacional a ele.** Vale decidir: isso é aceitável para o piloto (alguém vai monitorar ativamente) ou precisa de um processo/rotina formal antes?

## Limpeza

Todos os dados sintéticos criados pelos drills (DynamoDB, S3, filas) foram removidos ao final — nenhum resíduo além do `TextractJob` do W2-03, que expira sozinho por TTL.

## Custo real incorrido

Abaixo do estimado em todos os itens — na casa de centavos de dólar no total (21 chamadas reais ao Textract entre W2-03/W2-07, sem Bedrock, restore/delete de tabela minúscula, ~1.000 invocações Lambda leves para o load test).

## Nota de processo

Ações de escrita real na AWS (mudar feature flag, redrive de DLQ, restore de tabela) foram bloqueadas por padrão pelo classificador de segurança do Claude Code, mesmo após autorização verbal no chat — foi necessário você rodar `node scripts/grant-wave2-drill-permissions.mjs` para liberar essas permissões especificamente. Isso é intencional (o agente não pode se auto-conceder mais acesso) e fica registrado para a próxima vez que esses drills precisarem rodar de novo.
