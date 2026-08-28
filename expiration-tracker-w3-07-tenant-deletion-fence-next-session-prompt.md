# Expiration Tracker — Prompt para Próxima Sessão: W3-07 (fence de exclusão de tenant)

> **Uso:** iniciar em uma nova sessão de engenharia, em continuação direta à sessão de
> 2026-08-28 (W3-06/D-061 implementado, Wave 2 fechada, W3-07 pausado em D-062/D-063).
>
> **Repositório:** `https://github.com/marcelo-jgoncalves/expiration-tracker`, branch `develop`.

## Antes de tudo

Leia, nesta ordem, sem pular nenhum:
1. `AGENTS.md` (raiz) e `NEXT_SESSION_PROMPT.md` (raiz) — processo e estado atual.
2. `docs/architecture/reviews/w3-07-tenant-cascade-deletion-design/claude-final-status-not-approved.md` (D-062, 1ª tentativa reprovada).
3. `docs/architecture/reviews/w3-07-tenant-deletion-with-fence-design/claude-status-paused-for-next-session.md` (D-063, 2ª tentativa reprovada — **este é o roteiro de retomada**, leia-o por completo antes de propor qualquer desenho novo).
4. `docs/architecture/decisions-log.md`, entradas D-061/D-062/D-063.

**Confirme o estado real** (`git status`, `git log`, `git branch --show-current`) antes de presumir algo pendente ou concluído — o repositório pode ter mudado desde este prompt.

## O que já foi decidido (não reabrir)

- Objetivo: construir a garantia real de exclusão física de um tenant (cascata + fence contra "ressurreição" de dado). Decisão do Marcelo: **não esperar gatilho comercial** — implementar quando o desenho estiver correto, não quando houver cliente pedindo.
- Duas tentativas já reprovadas em revisão adversarial (D-062: 3,4→5,1→4,7/10; D-063 Rodada 1: 3,2/10). Não repetir os mesmos erros — ambos os documentos acima listam exatamente o que já foi tentado e por que falhou.
- Achado mais grave e ainda não resolvido: o fence de "tenant sendo excluído" não pode ser um dado que a própria cascata apaga — precisa sobreviver à exclusão completa e ser consultado por `RequestContextResolver`/toda superfície de entrada ANTES de qualquer provisionamento automático.
- Lição de processo (já custou 2 rodadas erradas): levantar superfícies de escrita por **ponto de entrada de runtime** (API Gateway, SQS, DynamoDB Streams, S3/EventBridge, EventBridge Scheduler, callback SNS/SES, Step Functions) — nunca por pasta de código (`src/workers/` já produziu falso negativo duas vezes).

## Trabalho desta sessão

1. Fazer o levantamento completo de superfícies de escrita por ponto de entrada de runtime (não redescobrir o que já foi mapeado — só completar/corrigir contra os achados já registrados).
2. Desenhar o tombstone de tenant que sobrevive à cascata.
3. Retomar o protocolo Claude↔Codex (`AGENTS.md` §4, Type 1, gate 9.0) para o fence completo, reaproveitando o mecanismo de descoberta+exclusão já validado (taxonomia de ~40 `entityType`, reuso do `DocumentPurgeWorker`/GSI6 para `Document`, `bff-session-table` como segunda tabela) — essa parte não precisa ser redesenhada, só o fence.
4. Implementar só depois de aprovação real (nota ≥9.0 de ambos os lados, sem arredondar).

Nenhum gate de pilot readiness depende disso — os 3 gates reais (W3-06, evidência operacional Wave 2, GTR-01) já fecharam. Trabalhe com autonomia dentro dos limites de `AGENTS.md`, mas não pule a leitura dos documentos acima.
