# AppError.retryable — SQS consumer behavior: Round 1 (Claude proposal)

## Contexto herdado (E-011, `docs/engineering/decisions-log.md`)

Auditoria 2026-08-29 achou `AppError.retryable`/`isRetryable()` documentados de forma enganosa
("drives SQS consumer behavior") quando, na prática, nenhum handler SQS real ramifica sobre o
valor — todos reportam `batchItemFailure` incondicionalmente, deixando `maxReceiveCount`+DLQ
nativos do SQS serem o árbitro real de retry-vs-terminal. Marcelo decidiu na época: manter o
comportamento, só corrigir a documentação para ser honesta sobre o escopo atual (diagnóstico/log,
não roteamento). Ficou registrado como pendência explícita: **deveria um handler SQS real passar
a ramificar sobre `retryable`?** Se sim, o que acontece com uma mensagem `retryable:false`
(poison message) — dropar com log de auditoria, mandar direto pro DLQ via chamada SQS explícita,
outra coisa? Quais os riscos de modo de falha (uma classificação errada agora causaria perda real
de dado/processamento pulado, não só retry desperdiçado)?

Autoridade ampliada (`docs/engineering/ai-governance.md` §1, 2026-08-31): este resíduo de produto
está explicitamente dentro do escopo que Marcelo autorizou Claude+Codex a decidir via protocolo
completo.

## Ground truth verificado (não assumido)

- `src/shared/errors/app-error.ts`: taxonomia consistente na prática — todo erro de validação/
  regra de negócio/autorização é `retryable:false` (determinístico, mesma entrada falha do mesmo
  jeito); `DependencyUnavailableError` default `true` (falha de dependência externa, correto:
  throttle/timeout/5xx valem retry); a única exceção real é `ExtractionCommitFailedError`
  (`DEPENDENCY_UNAVALABLE`, `retryable:true`) — correta por documentação própria: falha de commit
  no DynamoDB após sucesso do Textract é candidata legítima a retry, não um erro de payload.
  **Nenhuma inconsistência real encontrada** — a classificação existente já é uma base sã para
  uma política de branching, ao contrário do que a pergunta do prompt sugeriu verificar.
- 3 handlers SQS lidos (`reminder-dispatch-handler.ts`, `email-delivery-handler.ts`,
  `textract-task-handler.ts` por grep) confirmam o padrão idêntico: schema-inválido já É tratado
  como "poison message" NO COMENTÁRIO, mas ainda reporta `batchItemFailure` (retry incondicional
  até o DLQ nativo agir).
- `infra/modules/sqs-worker-queue/main.tf`: `redrive_policy` com `maxReceiveCount` fixo em 5
  (provado por `infra/tests/stack.tftest.hcl:318` e `sqs_worker_queue.tftest.hcl:20`), uniforme
  em todas as filas deste módulo. DLQ real já wireado, sem mecanismo paralelo a inventar.

## Pesquisa externa — declaração (`research-protocol.md`, E-014)

**SIM** — poison-message handling em Lambda+SQS é um padrão bem estabelecido, documentado pela
própria AWS com exemplos de referência.

Fonte 1: AWS Lambda Developer Guide, "Handling errors for an SQS event source in Lambda"
(`docs.aws.amazon.com/lambda/latest/dg/services-sqs-errorhandling.md`, conteúdo obtido via
WebFetch 2026-08-31). Achado central: **todos** os exemplos de referência oficiais da AWS (10
linguagens, incluindo TypeScript) capturam `catch (error)` genérico e reportam
`batchItemFailure` incondicionalmente — nenhum exemplo oficial ramifica por tipo/classe de erro.
A doc não menciona nenhum padrão de "enviar direto pro DLQ via API" como recomendação central;
todo o mecanismo de retry-vs-terminal descrito ali é `maxReceiveCount`+redrive policy nativo.
Trecho literal: "When an invocation fails, Lambda attempts to retry the invocation while
implementing a backoff strategy... If your function code caused the error, Lambda stops
processing and retrying the invocation [current batch]... After your queue's visibility timeout
runs out, the message reappears in the queue" — quem decide releitura vs. DLQ é a fila (SQS),
nunca o handler.

Fonte 2: mesma página, seção "Implementing partial batch responses" — confirma que
`ReportBatchItemFailures` existe para não reprocessar itens BEM-SUCEDIDOS do mesmo batch, não
para dar ao handler um mecanismo de terminação antecipada por classificação de erro.

**Conclusão da pesquisa**: o padrão canônico da própria AWS é exatamente o que este codebase já
faz (branching zero, redrive nativo). Um branching explícito no handler para mandar
`retryable:false` direto ao DLQ seria um desvio do padrão de referência, não uma correção de
gap — precisa justificar-se por um ganho concreto (menos ruído/latência de retry inútil) que supere
o risco novo que introduz (uma chamada SQS direta ao DLQ, e o modo de falha de classificação
errada virar perda real em vez de desperdício).

## Checklist ponderado (derivado da pesquisa)

1. **Alinhamento com o padrão de referência AWS** (30%) — manter o mecanismo nativo
   (`maxReceiveCount`+redrive) como única fonte de verdade de retry-vs-terminal pontua alto;
   inventar um caminho paralelo pontua baixo a menos que o ganho justifique o desvio.
2. **Blast radius de uma classificação errada** (25%) — uma mensagem transitória mal classificada
   como `retryable:false` sob um mecanismo de branch-and-drop-early causa perda real; sob o
   mecanismo atual (sempre retry até `maxReceiveCount`), o pior caso de má classificação é
   inofensivo (mensagem que já teria ido pro DLQ de qualquer forma, só via caminho nativo).
3. **Ganho real mensurável** (20%) — quantas retentativas são efetivamente desperdiçadas hoje?
   Com `maxReceiveCount=5` e backoff da própria Lambda (não configurável por mensagem), o custo é
   pequeno (minutos, não horas) e nenhuma fila deste sistema é sensível a latência de poison
   message (nenhuma é sync-user-facing).
4. **Simplicidade/reversibilidade** (15%) — zero código novo pontua alto; qualquer chamada SQS
   direta (`SendMessage` ao DLQ + delete manual da fonte) introduz um segundo caminho de escrita
   à fila DLQ, exigindo IAM extra, coordenação de exclusão dupla (a mensagem original ainda existe
   até `batchItemFailure` decidir; mandar cópia ao DLQ sem tirar da fonte duplica).
5. **Consistência entre as 10+ filas do sistema** (10%) — qualquer política deve valer
   uniformemente (mesmo módulo Terraform, mesmo `maxReceiveCount=5`), não caso a caso.

## Proposta Round 1

**Não implementar branching ativo sobre `retryable` em nenhum handler SQS.** Fechar a pendência de
E-011 como decisão explícita (não mais "pendente"), com o seguinte raciocínio registrado:

1. O padrão de referência da própria AWS confirma (Fonte 1/2 acima) que retry-vs-terminal deve
   ser decidido pelo mecanismo nativo da fila, não por um `if` no handler — o codebase já segue
   esse padrão.
2. `maxReceiveCount=5` já limita o blast radius de uma mensagem verdadeiramente poison a 5
   tentativas (minutos, não horas) antes do DLQ nativo assumir — o "desperdício" que uma
   ramificação ativa eliminaria é pequeno e não observado como problema real hoje (nenhum
   incidente de fila saturada por poison message neste projeto).
3. O risco novo que o branching introduziria (uma classificação `retryable:false` errada agora
   causando perda real de mensagem, em vez de apenas retries desperdiçados) é assimétrico e pior
   do que o problema que resolveria — especialmente porque a superfície de erro `retryable:false`
   inclui categorias amplas (`VALIDATION`, `BUSINESS_RULE`, `AUTHORIZATION`) cuja classificação é
   feita para contexto HTTP síncrono (M1), nunca auditada pensando em "é seguro derrubar esta
   mensagem de fila permanentemente".
4. Nenhuma fila deste sistema hoje é sensível a latência de poison message a ponto de justificar a
   complexidade/IAM extra de um roteamento explícito ao DLQ.

**Ação concreta**: fechar E-011 com uma entrada nova no decisions-log (`D-128`,
`docs/architecture/decisions-log.md`, mesmo padrão de D-124/D-125/D-127), reescrever o comentário
de `AppError`/`isRetryable()` em `app-error.ts` para declarar a decisão como fechada (não mais
"pendência", mas "decidido: não branch, ver D-128"), sem nenhuma mudança de comportamento de
runtime. Nenhuma mudança nos handlers SQS além do comentário/doc.

## Fora de escopo (explícito)

- Qualquer mudança em `maxReceiveCount`/redrive policy (permanece 5, decisão anterior não
  revisitada aqui).
- Powertools for AWS Lambda batch processor (mencionado pela doc oficial como utilitário) — fora
  de escopo, mudança de dependência não solicitada.
- Revisitar a classificação `retryable` de qualquer subclasse individual de `AppError` — auditada
  e considerada consistente (ver Ground truth acima), nenhuma mudança proposta.
