# Expiration Tracker — Prompt para Próxima Sessão: W3-07 (fence de exclusão de tenant)

> **Uso:** iniciar em uma nova sessão de engenharia, em continuação direta à sessão de
> 2026-08-28 (W3-06/D-061 implementado, Wave 2 fechada, W3-07 em 5 rodadas reprovadas: D-062, D-063, D-064, D-065).
>
> **Repositório:** `https://github.com/marcelo-jgoncalves/expiration-tracker`, branch `develop`.

## Antes de tudo

Leia, nesta ordem, sem pular nenhum:
1. `AGENTS.md` (raiz) e `NEXT_SESSION_PROMPT.md` (raiz) — processo e estado atual.
2. `docs/architecture/reviews/w3-07-tenant-cascade-deletion-design/claude-final-status-not-approved.md` (D-062, 1ª tentativa reprovada).
3. `docs/architecture/reviews/w3-07-tenant-deletion-with-fence-design/claude-status-paused-for-next-session.md` (D-063, 2ª tentativa reprovada).
4. `docs/architecture/reviews/w3-07-tenant-fence-round2-design/claude-status-paused-for-next-session.md` (D-064/D-065, 3ª-5ª tentativas, 3 rodadas na mesma sessão — **este é o roteiro de retomada vigente**, leia-o por completo, incluindo as 3 propostas e as 3 críticas do Codex referenciadas nele, antes de propor qualquer desenho novo).
5. `docs/architecture/decisions-log.md`, entradas D-061 a D-065.

**Confirme o estado real** (`git status`, `git log`, `git branch --show-current`) antes de presumir algo pendente ou concluído — o repositório pode ter mudado desde este prompt.

## O que já foi decidido (não reabrir)

- Objetivo: construir a garantia real de exclusão física de um tenant (cascata + fence contra "ressurreição" de dado). Decisão do Marcelo: **não esperar gatilho comercial** — implementar quando o desenho estiver correto, não quando houver cliente pedindo.
- Cinco rodadas já reprovadas em revisão adversarial (D-062: 3,4→5,1→4,7/10; D-063 Rodada 1: 3,2/10; D-064/D-065: 2,8→4,1→4,8/10). Não repetir os mesmos erros — os documentos acima listam exatamente o que já foi tentado e por que falhou, rodada a rodada.
- **Achado central já resolvido, não reabrir**: o tombstone de tenant (`TenantLifecycleRecord`) fica fora do universo apagável pela cascata (mesma disciplina já usada para `IdentityMapping`, que o próprio código já documenta como não-apagável) — confirmado pelo Codex nas 3 críticas de D-064/D-065.
- **Achado central AINDA não resolvido, é o ponto de partida da próxima sessão**: um fence ingênuo ("só chama o efeito externo se uma escrita fenced desta invocação suceder") quebra mecanismos de recovery/idempotência que já existem no código por boas razões (Textract `clientRequestToken`, Step Functions `StartExecution` idempotente por nome, redelivery SQS). A correção real exige um protocolo de **claim + outcome separados** por efeito externo (máquina de estados), não um wrapper genérico único — o fence deve gatear apenas o início de um novo claim, nunca a conclusão/recovery de um claim já em andamento. Ver a seção "Pendências reais" do roteiro (item 4) para o detalhe completo, área por área.
- Convenção de key S3 **não é uniforme** entre buckets — confirmado contra código real: quarantine/import usam `tenant/<tenantId>/...`, clean usa `clean/<tenantId>/...`, OCR (`ocr/<runId>/...`) não tem tenantId na key nenhuma. Qualquer varredura de exclusão física por prefixo precisa tratar os 3 casos separadamente, não assumir um prefixo universal.
- Lição de processo (já custou rodadas erradas): levantar superfícies de escrita por **ponto de entrada de runtime**, não por pasta de código — levantamento exaustivo dos 36 handlers já feito e registrado (ver o roteiro D-064/D-065), não redescobrir.

## Trabalho desta sessão

1. Desenhar o protocolo claim/outcome para efeitos externos (Textract, Bedrock, Step Functions `StartExecution`, `completeOcr`) — é a dependência de tudo mais, ver roteiro D-064/D-065 pendência 1.
2. Só depois, reespecificar `startExtractionRun`/quota Textract-Bedrock/`completeOcr` em cima do protocolo novo.
3. Resolver a convenção de key S3 por bucket real e desenhar a varredura durável com checkpoint (provavelmente uma Step Functions dedicada de purga por tenant, não uma Lambda simples — mesmo padrão de orquestração já usado para `document-extraction`).
4. Reabrir o protocolo Claude↔Codex (`AGENTS.md` §4, Type 1, gate 9.0) com o desenho completo de uma vez — as rodadas desta sessão mostraram que enviar correções parciais gera achados novos nas áreas ainda não tocadas.
5. Implementar só depois de aprovação real (nota ≥9.0 de ambos os lados, sem arredondar).

Nenhum gate de pilot readiness depende disso — os 3 gates reais (W3-06, evidência operacional Wave 2, GTR-01) já fecharam. Trabalhe com autonomia dentro dos limites de `AGENTS.md`, mas não pule a leitura dos documentos acima.
