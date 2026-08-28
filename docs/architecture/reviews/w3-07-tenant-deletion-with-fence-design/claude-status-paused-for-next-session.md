# W3-07 (retomada, D-063) — status: PAUSADO após Rodada 1, para planejamento minucioso na próxima sessão

> Decisão do Marcelo (2026-08-28): não adiar por falta de usuário real hoje — construir a
> garantia completa de exclusão de tenant algum dia, mas com análise minuciosa antes de
> implementar. Esta pasta é a continuação de
> `docs/architecture/reviews/w3-07-tenant-cascade-deletion-design/` (D-062, reprovada em 4
> rodadas) — leia aquela primeiro (especialmente `claude-final-status-not-approved.md`) antes
> desta.

## O que esta rodada tentou

Reabrir o desenho com o fence de "não ressurreição" dentro do escopo desde a Rodada 1 (em vez
de descoberto reativamente, como na tentativa D-062). Achado de partida:
`User.status: "ACTIVE" | "SUSPENDED"` (`user-repository.ts:22`) já existe e já é checado em toda
resolução de contexto HTTP autenticada (`resolve-request-context.ts:67-69`), mas `"SUSPENDED"`
nunca é escrito por nenhum código hoje. A proposta usava isso como fence primário (zero código
novo para a superfície HTTP autenticada) + checagem nova no fluxo de convidado + auditoria dos
workers em `src/workers/`.

## Resultado: Rodada 1, nota 3,2/10, REPROVADA — pior que a rodada equivalente da tentativa anterior

Ver `codex-round1-critique-full.txt` para o texto completo. Achados que qualquer retomada futura
**precisa** resolver desde o desenho inicial, não descobrir depois:

### Achado mais grave — o próprio fence é apagável pela cascata que ele deveria proteger

`RequestContextResolver.resolve()` (`resolve-request-context.ts:49-65`) provisiona
automaticamente um `User` novo com `status: "ACTIVE"` no primeiro login de um `cognitoSub`
sem perfil existente. Se a cascata apaga o `User` (ele é só mais uma linha do tenant, como
qualquer outra), um token ainda válido reautentica e o sistema **recria o tenant sozinho** —
a própria lógica de "provisionar no primeiro login" resssucita o que acabou de ser apagado.
**Consequência de design**: o tombstone/fence do tenant não pode ser a mesma linha que a
cascata elimina — precisa ser um registro que sobrevive à exclusão completa (ex.: um registro
de "tenant encerrado" fora do universo apagável, no mesmo espírito do `TenantDeletionRequest`
já proposto em D-062, mas agora como fonte de verdade que o RESOLVER também consulta, não só
um tombstone passivo).

### Checagens desacopladas (leitura solta antes de agir) têm corrida TOCTOU real

Qualquer "leia `User.status`, depois aja" (proposto para `GuestSubmissionService` e para os
workers) tem uma janela real entre a leitura e o efeito. Para efeitos DynamoDB, o fence precisa
participar da MESMA `TransactWriteItems` da mutação (`ConditionCheck`), não uma leitura solta
antes. Para efeitos externos (SES, S3, SQS, Step Functions) não existe uma condição atômica
equivalente — precisa de um protocolo de claim/drenagem dedicado, não uma checagem simples.

### Auditoria de superfícies de escrita estava errada e incompleta

Confirmado incorreto (releem entidade de origem, mas ainda produzem efeito novo sem fence real):
- `dispatch-outbox-relay` — produz mensagem SQS nova antes de marcar o outbox como publicado.
- `upload-slot-reconciliation` — escreve `Document.status = TIMEOUT` sem reler fence de tenant.
- `document-chasing-dispatch` — pode criar `GuestTokenPointer` novo e mandar e-mail via SES
  depois de o tenant já estar suspenso.

Superfícies inteiras que a auditoria por pasta (`src/workers/`) não capturou:
- `import-commit-handler` — fabrica um `RequestContext` de sistema com papel `OWNER`, nunca
  resolve usuário nem checa status.
- `start-extraction-run`/Step Functions do módulo `extraction` — inicia execução sem fence,
  tarefas subsequentes continuam escrevendo artefato S3/estado depois da suspensão.
- `ses-callback-workflow` — cria/atualiza `WebhookInbox`/`NotificationAttempt`/
  `NotificationPreferences` sem checar fence.
- URLs presignadas de S3 já entregues a um convidado continuam válidas mesmo após o fence —
  um upload feito depois ainda dispara toda a cadeia de finalização/malware/extração.

**Lição estrutural para a próxima tentativa**: organizar o levantamento por **ponto de entrada
de runtime** (API Gateway, fila SQS, DynamoDB Streams, evento S3/EventBridge, EventBridge
Scheduler, callback SNS/SES, Step Functions), nunca por pasta de código (`src/workers/`) —
essa organização já produziu falsos negativos duas vezes (D-062 e esta rodada).

## O que já está validado e deve ser reaproveitado, não redescoberto

- Inventário verificado dos ~40 `entityType` reais do sistema, por presença de `version`/
  `tenantId` (D-062, Rodadas 3-4).
- Mecanismo de descoberta+exclusão (Scan + taxonomia de 3 categorias + convergência por
  re-Scan) — a parte de "como apagar o que já não tem mais escritor" continua válida; o que
  falta é só a garantia de "não ressurreição" antes de declarar concluído.
- `Document` deve reusar o `DocumentPurgeWorker`/GSI6 já aprovado (D-061) — nunca duplicar.
- `Session`/`LoginAttempt`/`DeviceSession` vivem em `bff-session-table`, tabela física separada.
- Usar `User.status` (ou um registro de tenant equivalente) como sinal central é uma boa
  direção — só não pode ser o próprio dado que a cascata apaga, e não pode ser uma leitura
  desacoplada da escrita protegida.

## Próxima sessão — como retomar com rigor

1. Ler esta pasta inteira + `w3-07-tenant-cascade-deletion-design/` (D-062) antes de propor
   qualquer coisa nova — não repetir o levantamento do zero.
2. Levantar TODOS os pontos de entrada de runtime reais (não só `src/workers/`) que podem
   escrever dado de um tenant: grep por `SQSEvent`, `handler(): Promise<void>` (schedule),
   `S3Event`/`EventBridgeEvent`, Step Functions (`infra/state-machines/*.asl.json`), callbacks
   SNS/SES — e para cada um, confirmar se e como ele valida que o tenant/recurso de origem
   ainda é válido.
3. Desenhar o tombstone do tenant como um registro que **sobrevive** à própria cascata e que
   `RequestContextResolver`/toda superfície de entrada consulta ANTES de qualquer
   provisionamento automático (fechando o achado mais grave desta rodada).
4. Decidir, para cada superfície de escrita, se o fence entra via `ConditionCheck` na mesma
   transação (caminhos DynamoDB) ou via um protocolo de claim/drenagem dedicado (efeitos
   externos: SES, S3, Step Functions, filas).
5. Só depois disso desenhar novamente a descoberta+exclusão em si (que já está bem
   encaminhada) — não é o gargalo, o fence é.

## Registro de decisão

D-063 em `docs/architecture/decisions-log.md`: reprovada na Rodada 1 (3,2/10), pausada por
pedido explícito do Marcelo para planejamento minucioso numa sessão dedicada futura, não uma
decisão de abandonar o objetivo.
