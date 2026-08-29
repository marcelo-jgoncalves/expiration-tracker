# W3-07 (retomada, Round 3) — avaliação da proposta externa "ACTIVE-only fence"

> Sessão de análise/arquitetura pura (sem implementação), a pedido explícito do Marcelo, avaliando o
> arquivo externo `expiration-tracker-w3-07-architectural-analysis-2026-08-28.md` (raiz do repo) contra
> o histórico real de D-062→D-065 (`docs/architecture/reviews/w3-07-tenant-cascade-deletion-design/`,
> `w3-07-tenant-deletion-with-fence-design/`, `w3-07-tenant-fence-round2-design/`) e o código real atual.
> Branch: `develop` (confirmado). `TenantLifecycleRecord` **não existe em código** — este é
> pré-implementação, decisão de direção, não uma revisão de algo já construído.

## A. Reconstrução do estado atual (current-state)

**Código real verificado nesta sessão** (paths reais, não hipotéticos):

- `src/modules/extraction/application/start-extraction-run.ts` — `StartExecution` é chamado
  incondicionalmente em todo retry; comentário do próprio código confirma que isso é seguro porque o
  nome de execução (`runId`, determinístico via `deriveExtractionRunId`) torna `StartExecution` idempotente
  na API da AWS. **Confirma a alegação P1/P6 da análise externa e a "descoberta" de D-065.**
- `src/modules/extraction/application/start-ocr.ts` — `clientRequestToken` é derivado deterministicamente
  de `tenantId|documentId|documentVersion|pipelineVersion|runId`; a reserva de quota (`limit:1` por janela
  de 7 dias, chave `runId|TEXTRACT`) funciona como lock de idempotência, não como cap real. **Confirma a
  alegação sobre Textract.**
- `src/modules/extraction/application/run-bedrock-extraction.ts` — **confirmado: nenhuma idempotency key
  equivalente existe para a chamada ao Bedrock.** A única proteção é a mesma reserva de quota por
  `runId|BEDROCK`, que impede uma segunda *execução* duplicada da Step Functions, mas não protege contra
  ambiguidade dentro da MESMA tentativa (`callAttempts` default = 1, sem retry cross-invocation). Confirma
  a alegação central da análise externa sobre Bedrock.
- `src/modules/extraction/application/complete-ocr.ts` + `src/modules/extraction/persistence/s3-ocr-artifact-store.ts`
  — **bug real e independente de W3-07, confirmado por leitura direta**: `S3OcrArtifactStore.put()` usa
  `ocr/${runId}/${randomUUID()}.json`. `completeOcr` explicitamente re-executa `collectPages` (leitura
  idempotente do lado do Textract) em toda redelivery e, se `PutObject` já teve sucesso numa tentativa
  anterior mas `SendTaskSuccess` falhou/expirou, a redelivery grava um **segundo objeto físico sob uma key
  diferente** (novo UUID) antes de tentar `SendTaskSuccess` de novo. O comentário do próprio módulo
  confirma que o artefato nunca é apagado por este handler ("`delete()` é usado SOMENTE por
  `ExtractionValidationTaskHandler`, ainda não implementado"). Isso é exatamente o cenário descrito na
  análise externa §10 — **confirmado contra código real, não hipotético.**
- `TenantLifecycleRecord`: não existe em `src/` — busca `grep -ril "TenantLifecycle" src/` não retorna nada.
  Existe apenas como conceito de design em `docs/architecture/decisions-log.md` (D-062 a D-065). Não há
  writers tenant-scoped hoje que checam um lifecycle fence, porque o fence ainda não foi implementado.
- `resolve-request-context.ts` provisiona `User` novo `ACTIVE` automaticamente no primeiro login sem
  perfil (achado de D-063, ainda válido — não verificado linha a linha novamente nesta sessão porque D-063
  já o fez com evidência de código e nada mudou na área desde então segundo `decisions-log.md`).
- `GuestSubmissionService` é uma superfície de escrita pública que nunca passa por Cognito/`RequestContext`
  (achado de D-062, reconfirmado como não neutralizado por nenhuma decisão posterior).
- `bff-session-table` é uma tabela física separada da tabela principal (achado de D-062), nunca coberta por
  nenhum mecanismo de fence proposto até agora.

**Trajetória histórica (não redescoberta, só resumida — ver os arquivos originais para detalhe completo):**

| Decisão | Direção | Nota final | Resultado |
|---|---|---|---|
| D-062 | Cascata física por `tenantId`, sem fence de "não ressurreição" no escopo original | 3,4→5,1→4,7 | REPROVADO — achou que fence era necessário em todo write path, inclusive `GuestSubmissionService` e `bff-session-table` |
| D-063 | Fence via `User.status`, reaberto com "não ressurreição" já no escopo | 3,2 (rodada 1) | PAUSADO — `RequestContextResolver` resuscita tenant sozinho se `User` for a mesma linha apagada pela cascata |
| D-064/D-065 | Tombstone `TenantLifecycleRecord` separado + wrappers `fencedTransactWrite` | 2,8→4,1→4,8 | PAUSADO — fence ingênuo ("só chama efeito externo se escrita fenced venceu") quebra recovery real (StartExecution idempotente, `clientRequestToken`, redelivery SQS); achado central: precisa de "claim + outcome" por efeito |

O tombstone `TenantLifecycleRecord` fora do universo apagável pela cascata é o único elemento que
sobreviveu **sem reabertura** em todas as 3 rodadas anteriores — não deve ser reaberto aqui também.

## B. Por que as rodadas anteriores travaram (root cause)

A causa raiz não foi "onde colocar o fence" (isso foi resolvido cedo — tombstone separado). A causa raiz
foi um **objetivo mal formulado, nunca uma decisão de arquitetura**: as rodadas 1-3 do Round 2 (D-064/D-065)
assumiram implicitamente, sem nunca verificar se era um requisito real, que **todo trabalho de negócio
admitido antes de `DELETING` precisa continuar tendo suporte total de recovery/idempotência depois de
`DELETING`** — a mesma garantia de liveness que o sistema já dá durante `ACTIVE`. Essa suposição nunca foi
declarada como requisito de produto ou LGPD; foi um artefato de como o problema foi enquadrado ("como
preservar recovery de tudo que já começou?"), e forçou cada correção a reconstruir, efeito por efeito
(Textract/Bedrock/Step Functions/S3), a mesma disciplina de retry/idempotência que o sistema já tem para o
caso `ACTIVE` — só que agora coexistindo com um fence. Isso é estruturalmente mais complexo que o problema
original.

A análise externa acerta ao inverter a pergunta: "quais garantias realmente precisam sobreviver depois de
`ACTIVE → DELETING`?" em vez de "como preservar tudo?". Essa inversão é a contribuição real da proposta
externa, independente de os detalhes dela estarem certos (não estão todos, ver §D/M abaixo).

## C. Requirement clarification — a pergunta central do prompt

**Pergunta:** existe algum requisito real (produto/jurídico/arquitetural), documentado independentemente
desta cadeia de reviews, de que trabalho de negócio já admitido precisa concluir depois que o tenant entra
em exclusão?

**Resposta, verificada por Codex nesta sessão contra `docs/architecture/privacy-lgpd.md` (documento
`APPROVED`, não um dos documentos desta cadeia de reviews) e não refutada por mim:** **não existe tal
requisito.** O documento de privacidade/LGPD vigente exige o oposto — "bloqueio imediato de
notificações/uso" no início do fluxo de exclusão, tombstone transacional, purge idempotente, revogação de
canais e links. Não há nenhuma cláusula prometendo que OCR/Bedrock/extração continuam até o fim depois que
uma exclusão começou.

**Classificação:** a exigência de "trabalho pré-existente deve concluir" foi **historical/review-derived
assumption**, não um requisito real de produto, jurídico ou arquitetural. Ela nasceu da forma como D-064/
D-065 formularam o problema ("não quebrar recovery"), generalizando uma propriedade que o sistema garante
durante `ACTIVE` (porque durante `ACTIVE` recovery É um requisito real de confiabilidade) para um estado
(`DELETING`) em que ninguém nunca formulou essa garantia como necessária.

Isso não significa "descartar recovery é grátis" — ver P2/P3 na crítica do Codex (§O abaixo): abandonar
liveness de negócio ainda exige que cada workflow tenha uma saída terminal explícita (não pode virar
"espera até timeout" silenciosamente, nem redelivery infinita).

## D. Matriz de efeitos externos

| Efeito | Idempotência hoje (`ACTIVE`) | Comportamento proposto pós-`DELETING` | Gap identificado pelo Codex |
|---|---|---|---|
| Step Functions `StartExecution` | Determinístico por nome (`runId`) — confirmado em código | Deny novo `StartExecution`; execução em voo não reabre nem é aguardada | Precisa de saída terminal explícita (a ASL já tem `TimeoutSeconds`/`HeartbeatSeconds` reais — não é infinito, mas abandonar sem `SendTaskSuccess/Failure` correto gera ruído operacional) |
| Textract `StartDocumentTextDetection` | `ClientRequestToken` determinístico — confirmado em código | Deny novo claim/quota reservation; callback tardio é `ORPHAN_JOB`/no-op | Job continua existindo do lado do provider; não conta como "zero físico" sem ser coberto no inventário de providers |
| Bedrock `Converse`/`InvokeModel` | **Nenhuma** — confirmado em código; at-most-one-local-attempt sem proteção cross-invocation | Deny nova chamada; resposta tardia nunca persistida | Correto conforme análise externa — Bedrock não precisa de idempotency key retroativa DESDE QUE nenhuma chamada nova seja emitida pós-fence; não corrige o problema de ambiguidade pré-existente durante `ACTIVE` (fora do escopo do W3-07, dívida técnica separada) |
| `completeOcr` / S3 OCR artifact | **Key não-determinística (`randomUUID()`)** — bug confirmado, produz artefato órfão sob `PutObject` sucesso + `SendTaskSuccess` falho | Independente do fence: key deveria ser determinística e tenant-scoped já hoje | Mesmo com key determinística, um bucket versionado ainda cria múltiplas VERSÕES físicas — determinismo lógico ≠ objeto físico único; purge ainda precisa apagar todas as versões |
| S3 (quarantine/import/clean/OCR) | Keys parcialmente tenant-scoped (`tenant/<id>/...`, `clean/<id>/...`), OCR sem `tenantId` na key | Bloquear emissão de novas URLs presignadas; aguardar expiração das já emitidas; purge por prefixo real por bucket | URL presignada emitida enquanto `ACTIVE` pode ser usada depois de `DELETING` — não passa por DynamoDB, não é fenced por `ConditionCheck` nenhum |
| SQS/outbox/DLQ | Redelivery + outbox pattern já existentes | Descarte terminal, não redelivery infinita | Payload tenant-owned pode persistir em fila/DLQ por dias; SQS não oferece purge seletivo por tenant — não pode ser incluído em "zero físico" sem uma exceção documentada |
| Step Functions history / CloudWatch Logs / traces | N/A | N/A | Podem reter `tenantId`/inputs — mesma classe de exceção documentada, não "zero físico" absoluto |
| DynamoDB PITR / backups | Retenção de até 35 dias (backup) / 90 dias teto (`privacy-lgpd.md` PRIV-006) | Restore precisa consultar tombstone e repurgar | Já é requisito existente em `privacy-lgpd.md` §3, não novo — reforça que o design deve reusar esse mecanismo, não inventar um paralelo |

## E. Alternativas comparadas

| Critério | A: claim+outcome universal (D-065) | B: durable claims effect-specific | C: ACTIVE-only fence + cancellation + quiescence + purge (proposta externa, refinada) | D: alternativa superior encontrada? |
|---|---|---|---|---|
| Safety (não ressurreição) | Forte, mas nunca convergiu numa implementação coerente em 3 rodadas | Forte em teoria, ainda mais estados que A pela especificidade por efeito | Forte para DynamoDB com `ConditionCheck` universal; condicional para S3/efeitos externos (ver D) | Não encontrada — C é a única direção que atingiu >4,8/10 nesta linhagem |
| Liveness | Preserva liveness de negócio pós-DELETING (não é requisito real, ver C) | Idem A, por efeito | Abandona liveness de negócio pós-DELETING deliberadamente (correto, ver §C) | — |
| Complexidade | Muito alta — nunca convergiu | Mais alta ainda (estado por efeito × por provider) | Moderada — reusa OCC/TransactWriteItems já existentes | — |
| Corretude sob semântica real de provider | Tenta uniformizar Bedrock (sem idempotency key) com Textract/Step Functions (com) — incoerente | Mesma incoerência, só mais explícita | Alinhada — cada efeito tem política própria, sem fingir Bedrock exactly-once | — |
| Testabilidade | Combinatória, nunca fechada | Pior ainda | Propriedades negativas (non-resurrection) e purge são testáveis isoladamente | — |
| Operabilidade | Journals/reconcilers por provider — carga operacional alta | Pior | Um lifecycle + uma Step Functions de purge — carga operacional conhecida (mesmo padrão de W3-06/D-061, já aprovado 9,1/9,2) | — |
| Defensabilidade LGPD/DSR | Preserva processamento que já deixou de ter valor de negócio para o titular que pediu exclusão | Idem | Melhor alinhamento: prioriza bloqueio de uso + convergência para apagamento, como `privacy-lgpd.md` já exige | — |
| Blast radius | Todos os efeitos externos, transversal | Pior | Concentrado na fronteira de mutação/storage — mais contido | — |
| Overengineering | Já materializado: 3 rodadas, nunca aprovado, complexidade crescente | Pior | Risco moderado, mas real (ver gaps do Codex) — não é grátis | — |

Nenhuma alternativa D superior foi encontrada nesta sessão. A pesquisa não identificou um quarto modelo
genuinamente distinto — apenas variações de C (grau de rigor no purge/quiescence).

**Conclusão da comparação: C domina A e B para o requisito real documentado (§C).** A só voltaria a ser
justificável se surgisse uma exigência formal e explícita, aprovada por Marcelo, de que trabalho
pré-admitido precisa concluir pós-exclusão — o que hoje não existe.

## F. Arquitetura recomendada (visão executiva)

Adotar a direção C (ACTIVE-only fence), **não como aprovada**, mas como a única direção que deve prosseguir
para uma Rodada 4 de detalhamento — substituindo definitivamente o objetivo de "claim + outcome universal"
de D-065. Elementos centrais:

1. **Fence estrutural único**: toda mutação de negócio tenant-scoped exige `TenantLifecycleRecord.status =
   ACTIVE` verificado por `ConditionCheck` no MESMO `TransactWriteItems` da mutação, reusando os builders de
   `src/shared/dynamodb/occ.ts` — nunca `ConditionExpression` manual, nunca `BatchWriteCommand` para
   estado tenant-owned. `TenantLifecycleRecord` permanece fora do universo apagável pela cascata (herdado,
   confirmado, não reaberto).
2. **Cancelamento, não recovery, pós-`DELETING`**: cada workflow externo (Step Functions/Textract/Bedrock)
   ganha uma saída terminal explícita quando encontra o tenant em `DELETING` — nunca "sem resposta até
   timeout". Callbacks tardios (Textract SNS/SQS, Step Functions task token, Bedrock response) tornam-se
   no-op auditável, não descarte silencioso.
3. **S3 determinístico + quiescence + purge versionado**: keys tenant-scoped e determinísticas (corrige o
   bug real de `s3-ocr-artifact-store.ts`) + bloqueio de emissão de novas URLs presignadas + espera pelo
   deadline conhecido de URLs já emitidas + purge que cobre TODAS as versões/delete markers em buckets
   versionados, não apenas a versão "atual".
4. **Quiescence como prova de incapacidade de escrita, não como ausência física de mensagens em voo**: ver
   §J.
5. **Bypass privilegiado explicitamente modelado e restrito**: a transição `ACTIVE→DELETING` e o pipeline
   de purge são operações Type 1 (autenticação forte, tenant-binding, auditoria, idempotência, proteção
   contra DoS por exclusão forçada de tenant alheio) — não uma mutation HTTP comum.
6. **Bootstrap atômico**: `IdentityMapping + TenantLifecycleRecord(ACTIVE) + User` numa única transação,
   com condição que bloqueia reprovisionamento se o lifecycle for `DELETING`/`DELETED` — resolve o achado
   central de D-063 (`RequestContextResolver` resuscitando tenant sozinho).

## G. Máquina de estados (lifecycle)

```text
                 (bootstrap atômico)
                        │
                        ▼
                     ACTIVE ───────────────┐
                        │                  │ (nunca: reprovisionar
      solicitação DSR / │                  │  se DELETING/DELETED)
      decisão admin     ▼                  │
                    DELETING ◄─────────────┘
                        │
         deny novas mutações de negócio
         deny novos claims externos
         cancelar/abortar workflows em voo (saída terminal)
         discard de late outcomes (no-op auditável)
                        │
                        ▼
                   QUIESCING
      (bloquear novos writers já provado;
       aguardar deadline de URLs presignadas/
       timeouts de Step Functions/Lambda)
                        │
                        ▼
                    PURGING
      (Step Functions dedicada, checkpointed:
       DynamoDB tabela principal + bff-session-table
       + S3 todas as versões/markers, todos os buckets
       inventariados)
                        │
              verificação de convergência
           (re-scan vazio após última deleção,
            DeleteObjects.Errors[] tratado)
                        │
                        ▼
                    VERIFIED
                        │
                        ▼
                    DELETED
        (tombstone permanece — TenantLifecycleRecord
         nunca é apagado pela própria cascata)
```

Estados adicionais necessários para robustez (ver §I/M): `BLOCKED`/`HELD` (legal hold ou erro de purge
persistente), nunca um timeout automático promovendo para `DELETED`.

## H. Invariantes de segurança (safety)

1. Nenhuma mutação de negócio tenant-scoped commita em DynamoDB sem `ConditionCheck` de
   `TenantLifecycleRecord.status = ACTIVE` no mesmo `TransactWriteItems`.
2. Nenhum novo claim de efeito externo (Textract, Bedrock, `StartExecution`, emissão de nova URL
   presignada) é admitido depois de `DELETING`.
3. Nenhum resultado observado depois de `DELETING` (callback, redelivery, resposta tardia) persiste como
   novo estado de negócio tenant-owned.
4. `TenantLifecycleRecord` nunca é alvo da própria cascata de purge.
5. O caminho de transição de lifecycle e o caminho de purge são estruturalmente inacessíveis a partir de
   qualquer input tenant-controlled (nenhum `tenantId` de payload externo seleciona o alvo da purga).
6. Toda purga física (DynamoDB + S3, incluindo versões e delete markers) é seguida de verificação de
   convergência antes de `DELETED`.

## I. Invariantes de liveness

1. Durante `ACTIVE`: toda operação admitida preserva os mecanismos normais de retry, redelivery,
   idempotência e recovery já existentes (nada regride).
2. Durante `DELETING`: o sistema converge para `DELETED` em tempo finito e conhecido (deadline derivado de
   timeouts de Lambda, TTL de URL presignada, timeout de Step Functions) — nunca fica preso
   indefinidamente por definição de "quiescência" não observável (ex.: "fila vazia do tenant").
3. Nenhum workflow externo fica esperando indefinidamente por uma resposta que o sistema já decidiu não
   processar (toda saída pendente recebe uma resposta terminal explícita, não silêncio).
4. Falha de purga não promove `DELETED` por timeout — vai para `BLOCKED`/`HELD` com alarme e remediação
   manual segura.

## J. Definição de quiescence (adotando a formulação da crítica do Codex, mais rigorosa que a proposta externa original)

A proposta externa original definia quiescence como "aguardar writers admitidos anteriormente perderem
capacidade de persistência" sem dizer como isso é observável. **Correção adotada**: quiescence não pode ser
provada por "ausência física de trabalho pendente" (SQS/DLQ não oferecem enumeração/remoção seletiva
confiável por tenant, mensagens podem ficar retidas por dias) — deve ser provada por **incapacidade de
escrita**, uma propriedade estrutural, não uma observação de fila vazia:

1. Todo writer de negócio tenant-scoped (inventariado, não assumido) consulta `ACTIVE` atomicamente — prova
   estrutural/de código, não runtime.
2. Nenhuma URL presignada pode sobreviver além de um deadline conhecido (TTL de emissão + margem).
3. Lambdas têm timeout máximo conhecido (configuração real, não suposição).
4. Toda Step Functions relevante é parada explicitamente ou tem timeout global/por estado conhecido.
5. Nenhum callback/outbox consumer tem bypass do fence.
6. Só depois do deadline derivado de (2)-(5), S3/DynamoDB são purgados e a verificação final roda.

Produtores assíncronos reais inventariados nesta sessão (não hipotéticos, via `decisions-log.md` D-062/D-064
e leitura de código): HTTP autenticado e guest (`GuestSubmissionService`), uploads via URL presignada,
eventos S3/EventBridge de quarantine/import, resultado de malware scan, SQS de reminder
dispatch/materialization, DynamoDB Streams (outbox relay, notification router), SQS de e-mail/callback SES,
document chasing, upload finalizer/reconciliation, import parse/commit, extraction starter, Step Functions
`document-extraction`, Textract completion via SNS/SQS, scheduler de reminder producer, reminder
claim/DST reconciliation, outbox sweeper, document purge scheduler (W3-06/D-061), upload-slot
reconciliation, Lambdas em execução, redelivery/replay operacional de SQS/DLQ.

## K. Prova de exclusão física (DynamoDB + S3)

**Alegação aprovável** (não a alegação ampla "zero dado físico" da proposta externa, que o Codex considera
falsa/inexequível): *"zero estado tenant-owned acessível na tabela principal, tabela BFF e nos buckets
inventariados, exceto tombstone/audit/backup/retenção de provedor explicitamente classificados."*

Requisitos concretos:

- DynamoDB: tabela principal + `bff-session-table` + qualquer outra tabela tenant-owned real (levantar
  inventário explícito, não assumir só duas).
- S3: `ListObjectVersions` com paginação (`KeyMarker`/`VersionIdMarker`) para todos os buckets versionados
  (quarantine/clean/import); tratamento de `DeleteObjects.Errors[]`; delete markers; multipart uploads
  incompletos (não aparecem em `ListObjectVersions` — precisam de `ListMultipartUploads` dedicado);
  convergência confirmada por re-scan vazio após a última deleção, não uma única varredura.
- Exceções explicitamente classificadas e documentadas (não "zero físico" silencioso): `TenantLifecycleRecord`
  (tombstone), `SECURITY_AUDIT`/`AuditEvent` redigido, backups (PITR até 35 dias, teto de 90 — já normativo
  em `privacy-lgpd.md` §3/§6), SQS/DLQ residual (sem enumeração seletiva confiável), Step Functions
  execution history, CloudWatch Logs/traces, retenção própria de Textract/Bedrock/SES do lado do provider.

## L. Enforcement estrutural

Concordo com a proposta externa em rejeitar lint como garantia principal e com a crítica do Codex de que
ESLint sozinho (a direção de D-065) não fecha bypasses via `BatchWriteCommand`, imports dinâmicos ou
comandos construídos por propriedade computada. Ordem de preferência para a Rodada 4 detalhar:

1. **Repository/transaction-builder boundary** (reusar `occ.ts`) como o único caminho de escrita
   tenant-scoped — mutação normal nunca constrói `TransactWriteItems` manualmente fora dele.
2. **Application service / mutation executor** que injeta o `ConditionCheck` automaticamente, não deixa a
   decisão para cada handler lembrar de incluí-lo.
3. **ESLint como guardrail secundário**, não como a barreira (`no-restricted-imports` +
   `no-restricted-syntax` para `BatchWriteCommand`/import dinâmico/propriedade computada de comando).
4. **Architecture test** (mesmo padrão de `infra/tests/stack.tftest.hcl` para infra) verificando que nenhum
   módulo de negócio importa comandos DynamoDB mutáveis fora dos adapters autorizados.

O caminho de purge/transição administrativa precisa ser um tipo/porta estruturalmente distinto do caminho
de mutação de negócio (não uma flag booleana no mesmo executor) — reduz risco do bypass privilegiado
identificado em P10.

## M. Matriz de falhas (principais cenários, não exaustiva — ver crítica completa do Codex)

| Cenário | Risco sem correção | Mitigação exigida |
|---|---|---|
| Leitura de `ACTIVE` seguida de pausa, lifecycle vira `DELETING`, só então chama efeito externo | Efeito admitido "depois" do fence sem ter sido bloqueado | Definir "admitido" pela transação que verificou `ACTIVE`, não pelo instante da chamada ao provider — chamada só é válida se amparada por uma admissão já linearizada |
| URL presignada emitida em `ACTIVE`, usada depois de `DELETING` | Objeto S3 novo criado sem passar por DynamoDB | Deadline de TTL conhecido antes de considerar quiescente; nunca assumir que emissão implica uso imediato |
| `BatchWriteCommand` usado para estado tenant-owned | Bypassa qualquer `ConditionCheck` | Proibir estruturalmente (enforcement §L) |
| Outbox relay grava via `UpdateCommand` isolado (confirmado em `dynamodb-outbox-relay-store.ts`) | Escrita fora da transação fenced | Precisa entrar na disciplina transacional ou ter proteção equivalente |
| `waitForTaskToken` nunca recebe resposta pós-fence | Não é infinito (ASL real tem `TimeoutSeconds`/`HeartbeatSeconds`), mas gera ruído operacional e atraso | Enviar `SendTaskFailure`/estado terminal explícito ao detectar `DELETING`, não silêncio |
| Purga trava em `DeleteObjects.Errors[]` permanente (IAM/KMS/Object Lock) | `DELETING` permanente sem alarme | Estado `BLOCKED`/`HELD`, alarme, remediação manual, nunca timeout→`DELETED` |
| Tenant A tenta forçar `DELETING` de tenant B | Denial-of-service e destruição irreversível de terceiro | Transição de lifecycle como operação Type 1 privilegiada, tenant-binding forte, auditoria |
| Key S3 do OCR não determinística (bug já confirmado) | Múltiplos artefatos, um deles nunca enumerável por `runId` único | Corrigir key determinística tenant-scoped ANTES ou junto do W3-07 — já é dívida técnica independente |

## N. Impacto de migração/implementação (estimativa apenas, não implementação)

Ordem de grandeza qualitativa, não sprint plan:

- Correção do bug de key S3 do OCR (`s3-ocr-artifact-store.ts`): pequena, isolada, pode ser feita
  independentemente do W3-07 (dívida técnica já identificada, não bloqueada por decisão de fence).
- `TenantLifecycleRecord` + bootstrap atômico + `ConditionCheck` universal via `occ.ts`: médio — toca todo
  writer tenant-scoped identificado, mas reusa infraestrutura já existente (builders de `occ.ts`), não cria
  camada nova.
- Cancelamento/saída terminal por efeito externo (Step Functions/Textract/Bedrock): médio — mais simples
  que o protocolo claim+outcome de D-065 porque cada efeito só precisa de UMA política de "o que fazer se
  `DELETING`", não uma state machine de recovery completa.
- Purge Step Functions dedicada (DynamoDB + S3 versionado, checkpointed): médio-alto — mesma classe de
  esforço do `DocumentPurgeWorker` já aprovado e implementado em D-061 (W3-06), que serve de precedente
  direto e reduz risco de estimativa.
- Enforcement estrutural (boundary + ESLint + architecture test): pequeno-médio, incremental sobre `occ.ts`.

Estimativa qualitativa geral: **significativamente menor que o protocolo claim+outcome universal de
D-065**, que nunca convergiu em 3 rodadas — essa é a principal razão prática, além da arquitetural, para
preferir esta direção.

## O. Registro do debate Claude↔Codex

**Rodada A (Claude, análise inicial)**: leitura completa de `AGENTS.md`, do arquivo externo, do histórico
D-062→D-065, e verificação direta contra código real dos 5 arquivos centrais (`start-extraction-run.ts`,
`start-ocr.ts`, `run-bedrock-extraction.ts`, `complete-ocr.ts`, `s3-ocr-artifact-store.ts`). Confirmou como
reais todas as alegações técnicas centrais da proposta externa (StartExecution idempotente por nome,
`clientRequestToken` determinístico, ausência de idempotência no Bedrock, bug de key S3 aleatória).
Formulou prompt de crítica adversarial cega para o Codex, incluindo as 12 proposições do prompt original,
sem revelar avaliação própria antecipada.

**Rodada B (Codex, crítica adversarial cega)** — arquivo completo em `codex-roundA-critique-full.txt`,
prompt em `codex-roundA-prompt.txt`. Resultado: **direção C endorsada sobre A/B** ("A direção ACTIVE-only
fence + quiescence + purge verificável é arquiteturalmente superior ao protocolo universal claim+outcome"),
mas **não aprovável como está**. Achados principais (refutação das 12 proposições):

- P1 (linearization point único): verdadeiro só sob condição — "admitido" deve ser definido pela transação
  que verificou `ACTIVE`, não pelo instante da chamada ao provider (contraexemplo: leitura de `ACTIVE`
  seguida de pausa, efeito chamado depois de `DELETING`).
- P2 (abandonar liveness não viola invariantes): verdadeiro só sob condição — cada workflow precisa de
  saída terminal explícita (`ABORTED_TENANT_DELETING` ou equivalente), não pode virar timeout silencioso;
  OCC/outbox/UNKNOWN_OUTCOME continuam exigindo tratamento explícito, não indiferença.
- P3 (descartar callbacks tardios é seguro): parcialmente falso — seguro para não-ressurreição, não para
  custo/ruído operacional (Bedrock já cobrado, Step Functions aguardando até timeout real, URL presignada
  ainda válida).
- P4 (check transacional universal é suficiente): verdadeiro só para DynamoDB, falso como garantia
  universal — `BatchWriteCommand`, `UpdateCommand` isolado do outbox relay (confirmado em código real),
  S3/SES/SQS/Bedrock/Textract/Step Functions não são cobertos por transação DynamoDB nenhuma.
- P5 (S3 sem claim/outcome por objeto): verdadeiro sob condições — key determinística resolve idempotência
  lógica, mas bucket versionado ainda cria múltiplas versões físicas; purge precisa cobrir todas.
- P6 (in-flight Step Functions/Textract não compromete): verdadeiro, sob as mesmas condições de P1/P4.
- P7 (Bedrock não precisa de claim/outcome universal): sustenta-se — não corrige a dívida pré-existente de
  ambiguidade em `ACTIVE`, mas não precisa corrigi-la para o W3-07.
- P8 (quiescence verificável): verdadeiro só com definição mais modesta — "incapacidade de escrita", não
  "ausência física de trabalho pendente" (ver §J).
- P9 (purge prova zero físico): falso na formulação ampla, condicionado para DynamoDB+S3 com exceções
  explícitas (SQS/DLQ, Step Functions history, logs/traces, backups, retenção de provider).
- P10 (nenhuma via privilegiada abusável): não demonstrado — autorização/tenant-binding/CSRF/rate-limit da
  própria transição de lifecycle e do bypass de purge ainda não especificados.
- P11 (sem deadlock/stuck DELETING): falso sem mecanismos adicionais — lista de 11 cenários concretos de
  stuck identificados (ver `codex-roundA-critique-full.txt` P11).
- P12 (proporcionalidade): direção proporcional; "zero físico universal" seria desproporcional/inexequível;
  ignorar `bff-session-table`/URLs presignadas/multipart seria underengineering.

**Requisito bloqueante real**: Codex confirmou independentemente (não influenciado pela minha leitura) que
não há requisito documentado exigindo conclusão de trabalho pré-admitido pós-exclusão, e que
`privacy-lgpd.md` aponta na direção oposta (bloqueio imediato).

**Nota do Codex: 7.8/10** — não atinge o gate de 9,0. Endossa a direção, não aprova o design.

**Rodada C (reconciliação, Claude)**: concordo integralmente com a crítica do Codex — nenhum dos 10 gaps
bloqueantes listados (§O, lista completa abaixo) é uma objeção de bad faith ou nitpick; todos são reais e
exigiriam retrabalho de detalhamento antes de uma implementação. Não vejo motivo para discordar da nota
7,8/10 nem para forçar arredondamento. Não localizei nenhum contra-argumento válido aos 12 vereditos do
Codex.

**Minha própria nota independente (Claude), formada ANTES de ver o texto final do Codex** (a ordem real da
sessão foi: li a análise externa, verifiquei código, formulei o prompt de crítica cega SEM registrar uma
nota própria por escrito antes de receber a resposta do Codex — não há, portanto, um registro formal de nota
cega dupla nesta rodada específica, uma limitação de processo desta sessão registrada explicitamente na
seção Q): minha avaliação pós-hoc da mesma direção, calibrada pelos mesmos 12 vereditos, converge para a
mesma faixa — **7,5-8,0/10** como direção, não como design aprovável. Não houve rodada D (fresh
verification) nem rodadas adicionais nesta sessão — ver §Q para o motivo e a recomendação de continuidade.

## O-2. Rodada C — reconciliação de Claude endereçando os 10 gaps da Rodada B

Verificação adicional de código real: `GuestSubmissionService.startSubmission()` nunca passa por
`RequestContext` e escreve via `store.transactWrite()` própria (confirmado); `DynamoDbOutboxRelayStore`
(`tryAcquireLease`/`markPublished`/`listPendingReminderDispatch`) usa `UpdateCommand`/`QueryCommand` crus,
fora dos builders de `occ.ts` (confirmado); `resolve-request-context.ts` confirma o bug do bootstrap de
D-063 ainda presente linha a linha (`findOrCreate` + `createProfileIfAbsent` sequenciais, sem nenhuma
checagem de lifecycle); `TenantQuotaService.consume()` (`quota.ts`) é a admissão real usada antes de todo
efeito pago (Textract/Bedrock) via uma escrita condicional de item único (`updateConditional`/`putIfAbsent`),
não uma `TransactWriteItems` — não passa pelos builders de `occ.ts` nem tem nenhum `ConditionCheck` de
lifecycle hoje.

Proposta de fechamento por gap (registrada por extenso em `codex-roundD-prompt.txt`, não duplicada aqui):
propriedade formal escopada a "zero estado tenant-owned acessível" com exceções explícitas; inventário real
de writers (`GuestSubmissionService`, outbox relay classificado como housekeeping, `bff-session-table` via
`TransactWriteItems` multi-tabela); enforcement via wrapper obrigatório + `extraConditions` já existente em
`occ.ts` + architecture test + ESLint secundário; bypass privilegiado via IAM separado + `DataSubjectRequest`
verificado (reusando `privacy-lgpd.md` §3) + tenant binding; protocolo por efeito (Step Functions/Textract/
Bedrock gateados antes da admissão, `completeOcr` sem gate imediatamente antes do `PutObject`); quiescence
como bound de timeouts reais (declarado como pendência de inventário, não fechado nesta rodada); purge S3
com paginação/versões/`Errors[]`; state machine anti-stuck com `BLOCKED`/`HELD`; autorização forte reusando
o fluxo DSR existente; bootstrap atômico via uma única `TransactWriteItems`. Fix da key S3 do OCR proposto:
`ocr/<tenantId>/<runId>.json` em vez de `ocr/${runId}/${randomUUID()}.json` — key determinística e
tenant-scoped; como o bucket `EXTRACTION_TRANSIENT` é confirmadamente não-versionado (achado de D-065), uma
redelivery apenas sobrescreve o mesmo objeto físico, eliminando o artefato órfão.

**Rodada D — crítica adversarial fresca do Codex** (`codex-roundD-critique-full.txt`, nota cega quanto ao
score, sem ancorar em 7,8): endossou a direção geral, mas rebaixou 8 dos 10 vereditos de "closed" para
"PARTIALLY CLOSED" e 1 para "NOT CLOSED" (quiescence bounded — a definição conceitual está correta, mas o
deadline numérico não existe). Achados centrais novos:

- **TOCTOU real não eliminado**: "verificar `ACTIVE` e depois chamar o provider" continua sendo uma leitura
  seguida de pausa, não uma admissão atômica — só fecha se a checagem `ACTIVE` estiver na MESMA transação
  que cria uma capability durável e consumível para aquele efeito específico (não uma leitura solta antes).
- **Contradição interna**: a propriedade formal diz que toda mutação tenant-owned exige o fence, mas o
  carve-out do outbox relay permite alterar `OutboxRecord` sem ele — precisa ser uma lane tipada e estreita,
  não uma exceção textual.
- O fix de key do OCR foi **validado como correto**: `deriveExtractionRunId()` deriva de
  `tenantId|documentId|documentVersion|pipelineVersion`, então uma redelivery legítima do MESMO run nunca
  deveria produzir dois artefatos distintos — overwrite em bucket não-versionado é semanticamente correto,
  com duas ressalvas menores (não elimina resíduo se o callback nunca terminar; entregas concorrentes
  sobrescrevem a mesma key, teoricamente seguro já que ambas consultam o mesmo job do Textract, mas vale
  testar a corrida e considerar checksum/ETag).
- **12 gaps, não 10** — a crítica original tinha mais 2 itens (resíduos permitidos com minimização/prazo por
  classe; plano de testes de concorrência) que a reconciliação não havia endereçado.

**Nota do Codex na Rodada D: 8,4/10** — subiu de 7,8, mas ainda abaixo do gate. 5 bloqueadores priorizados
para 9,0: (1) formalizar admissão/capability por efeito eliminando o TOCTOU (SES/Textract/Bedrock/Step
Functions/S3); (2) inventário executável completo de writers/presigners/timeouts/storages, do qual derivar
numericamente o bound de quiescence; (3) fechar purge S3 com multipart/keys legadas/paginação também no
bucket não-versionado/re-scan convergente; (4) especificar boundary estrutural e bypass privilegiado como
APIs/tipos/IAM verificáveis, incluindo a lane outbox e mutations BFF multi-tabela; (5) fechar state-machine
recovery e plano mínimo de testes concorrentes/provider semantics.

## O-3. Rodada E — segunda reconciliação de Claude, focada nos bloqueadores #1 e #4

Endereçando especificamente o TOCTOU (bloqueador #1) e as lanes tipadas (bloqueador #4), com verificação
adicional de código: `TenantQuotaService.consume()` confirmado como escrita condicional de item único
(`updateConditional`/`putIfAbsent`), não uma transação. Proposta: converter o passo final de `consume()`
para uma `TransactWriteItems` de 2 itens (a escrita de quota existente + um `ConditionCheck` de
`TenantLifecycleRecord.status = ACTIVE`, via os helpers já existentes de `occ.ts`), exigindo estender a
porta `IdentityStore` com um método `transactWrite` (mesma direção de extensão de porta que D-065 já havia
identificado para o bootstrap) — isso torna a própria reserva de quota a admissão durável e fenced para a
chamada a Textract/Bedrock, atomicamente. O mesmo raciocínio para `ExtractionRun`/`StartExecution`
(converter `putIfAbsent` para uma transação de 2 itens) e para presigned uploads (`GuestSubmissionService`/
`DocumentService` já usam `transactWrite` — só falta adicionar o `ConditionCheck` como última entrada, sem
extensão de porta). Para SES, proposto que o worker de envio releia o lifecycle imediatamente antes da
chamada, aceitando como risco residual documentado, não uma garantia atômica. Para `completeOcr`, adotada
a posição do Codex: nunca gatear imediatamente antes do `PutObject`; aceitar que uma escrita iniciada em
`ACTIVE` pode terminar depois de `DELETING`, e confiar na purge+reverificação para a garantia final. Lanes
tipadas propostas: `TenantBusinessMutation` (só construível pelo executor fenced, que anexa o
`ConditionCheck` — não uma convenção de chamador) vs. `SystemMutation` (allowlist estreita e nomeada:
transição de lifecycle, deletes da purga, bookkeeping do outbox relay — nunca criação de conteúdo novo).

**Rodada E — crítica adversarial fresca do Codex** (`codex-roundE-critique-full.txt`): veredito mais
detalhado e mais rigoroso tecnicamente:

- **Admissão transacional (Textract/Bedrock/Step Functions): fechada arquiteturalmente**, mas só sob um
  contrato de concorrência que o design precisa declarar explicitamente: *"`ACTIVE→DELETING` bloqueia novas
  admissões; operações já admitidas atomicamente antes da transição podem terminar."* Sob esse contrato, a
  alegação correta não é "o tenant está ACTIVE no momento da chamada ao provider" (falso — o processo pode
  pausar/perder conexão entre o commit e a chamada), mas sim "esta chamada foi admitida enquanto ACTIVE" —
  distinção que o design deve declarar com essas palavras, não deixar implícita.
- **Achado novo real sobre retry**: `startExecution()` hoje roda mesmo quando `putIfAbsent()` encontra um
  run já existente (comportamento correto hoje, ver §A) — o desenho novo precisa permitir esse retry
  recuperar um run já admitido SEM exigir nova admissão ACTIVE, ou persistir evidência de admissão
  suficiente para distinguir isso de um run legado não admitido. Não estava resolvido na Rodada E.
- **S3 presigned upload: NÃO fechado só por "transação, depois a próxima linha"** — a URL presignada é uma
  capability portável que um cliente pode usar minutos depois, independente do processo que a emitiu.
  Precisa de política explícita: capabilities emitidas antes de `DELETING` podem ser usadas até expirar;
  uploads tardios bem-sucedidos são colocados em quarentena e nunca promovidos a estado de negócio (a
  promoção é que precisa ser fenced, não o upload); a reverificação da purga cobre objetos que chegaram por
  uma URL ainda válida; o TTL máximo da URL é o bound documentado de risco residual.
- **SES**: a leitura simples antes do envio é mais fraca do que o necessário — "limitado pela latência do
  worker" não é um bound determinístico. Proposta melhor do Codex: usar a própria transição
  `PREPARED/FAILED_RETRYABLE → SUBMITTING` (que já existe no módulo de notificação) como ponto de admissão,
  anexando o `ConditionCheck ACTIVE` a ELA — mais forte que uma leitura solta, sem inventar um novo modelo
  de consistência. Ainda assim, aceitar essa política exige uma decisão explícita registrada: "bloqueio
  imediato de novos envios no ponto de admissão atômica, permitindo que chamadas já admitidas ao provedor
  se resolvam" — se o requisito real fosse mais forte (cancelar todo envio ainda não aceito pelo SES no
  instante da exclusão), nem a leitura nem a transação bastariam; seria necessário um protocolo de
  lease/drain coordenado com a transição de lifecycle. Codex não acredita que essa interpretação mais forte
  seja necessária, mas exige que o documento escolha explicitamente uma das duas.
- **`completeOcr`**: o argumento de não-ressurreição é sólido para o DynamoDB, mas não é sozinho um
  argumento completo de purga/LGPD — o artefato OCR em S3 é dado pessoal mesmo que nenhum `ExtractedField`
  seja criado. A resolução só é aceitável se: a key é determinística e descobrível por posse de
  tenant/run; artefatos tardios (criados depois do primeiro scan da purga) são encontrados por
  reverificação; deleção de objeto versionado cobre toda versão/delete marker; a condição de conclusão da
  purga não pode passar enquanto um writer tardio ainda puder criar um objeto não descoberto; o artefato
  tem um TTL limitado como rede de segurança adicional.
- **Lanes tipadas (bloqueador #4): fechado em termos arquiteturais**, sujeito a regras de enforcement
  concretas: execução de transação DynamoDB crua confinada à camada de persistência/infraestrutura; portas
  de negócio expõem só a operação fenced, nunca arrays de transação arbitrários; o "brand"/construtor é
  module-private ou de outra forma não-forjável sem cast unsafe; enforcement de boundary impede módulos de
  negócio de importar o executor cru; teste arquitetural/de tipo prova que chamadores representativos não
  conseguem escolher `SystemMutation`; cada operação de sistema tem um motivo nomeado e estados de lifecycle
  permitidos — e "três call sites" deve virar uma enumeração real, não uma contagem afirmada (o próprio
  Codex identificou que lifecycle transitions + purge deletes + `tryAcquireLease` + `markPublished` já são
  mais operações do que essa contagem sugeria).
- **Fronteira de deferimento**: Codex concorda explicitamente que o plano de testes de concorrência
  completo (bloqueador #5) é legítimo deferir para uma sessão de implementação. Mas discorda que o
  inventário completo de writers/presigners (bloqueador #2) e a semântica de conclusão do S3 (parte do
  bloqueador #3 — multipart, keys legadas, versionamento, reverificação) possam ser adiados da mesma forma:
  "a alegação central é universal — nenhuma mutação de negócio do tenant depois do fence — logo um
  inventário incompleto de writers significa que a arquitetura não estabeleceu sua própria fronteira de
  cobertura."

**Nota do Codex na Rodada E: 8,8/10.** Textual: *"A 9.0 is reachable, but not through further prose-only
reconciliation of the same proposal... requires an implementation-adjacent architecture session using the
real code and infrastructure inventory, though it does not require completing the entire implementation
first."*

## O-4. Rodada F — inventário real implementation-adjacent (não mais prosa)

A pedido explícito do Marcelo (autorização para continuar até o gate de 9,0 ou até ficar demonstrável que é
inatingível), esta sessão executou o levantamento que a Rodada E apontou como faltante: grep real contra
`src/**` e `infra/`, não mais suposição.

**Achados reais**: ~62 arquivos com `transactWrite`/`updateConditional`/`putIfAbsent`; uso de comando
DynamoDB cru (`PutCommand`/`UpdateCommand`/`BatchWriteCommand`) confirmado confinado a exatamente 12
arquivos, todos adapters `dynamodb-*-store.ts` ou `occ.ts` mesmo — já atrás do boundary de porta/adapter,
exceto o outbox relay (já classificado). TTLs de presign confirmados: `document-service.ts` 600s,
`import-service.ts` 900s, `guest-submission-service.ts` 600s (máximo real = 900s). Timeouts de Lambda/SQS
confirmados contra `infra/main.tf`: máximo real = 60s (Lambda que chama Bedrock `Converse`). ASL
`document-extraction.asl.json`: `HeartbeatSeconds=120`/`TimeoutSeconds=600` no `waitForTaskToken`. SES:
adapter real confirmado em `ses-email-adapter.ts`; a claim `SUBMITTING` em `email-delivery-workflow.ts` usa
`buildVersionedUpdate` (item único, não transação) — mesma forma que `quota.consume()`. `StartExecution`:
confirmado que `ExecutionAlreadyExists` já é capturado e tratado como no-op idempotente hoje
(`sfn-extraction-execution-starter.ts`). Ponto real de persistência de negócio da extração confirmado como
`commitOrDiscard` em `run-extraction-validation.ts` (`PERSIST_EXTRACTED_FIELDS`/`MARK_PENDING_CONFIRMATION`)
— não `completeOcr`, que só grava artefato transitório. Promoção de upload para estado de negócio confirmada
em 4 workers com `transactWrite` próprio: `upload-finalizer/finalizer.ts`,
`submission-finalizer/finalizer.ts`, `malware-result/result-processor.ts`,
`submission-malware-result/result-processor.ts`.

**Fechamentos propostos**: S3 presign fechado via bound real (900s+margem) + fencing do passo de PROMOÇÃO
(não do upload em si); SES fechado como pergunta explícita de produto/jurídico com recomendação de
engenharia condicionada (Opção 1: bloqueio no ponto de admissão vs. Opção 2: lease/drain); `StartExecution`
pós-`DELETING` com semântica explícita (nova admissão negada transacionalmente; retry de run existente
permitido sem nova admissão, pois a própria existência da linha já é prova de admissão anterior).

**Crítica adversarial da Rodada F** (`codex-roundF-critique-full.txt`): validou a correção técnica central
(distinção entre "segurança indefinida via fence" e "bound de limpeza operacional"), mas encontrou 2 furos
reais novos: (1) as 4 evidence mutations intermediárias (`uploadEvidence`/`malwareEvidence`/`SCANNING`) são
elas mesmas `TenantBusinessMutation`, não só a transição final `CLEAN` — cada uma precisa do
`ConditionCheck`; (2) o cópia S3 para o bucket `clean` acontece ANTES do commit DynamoDB fenced em
`advance-after-evidence.ts`/`advance-after-submission-evidence.ts` — se `DELETING` vence a corrida entre a
cópia e o commit, existe um objeto `clean` órfão sem linha `Document` correspondente. Também apontou que a
fórmula de quiescence (900s+margem) não é um bound válido de sistema porque SQS retém mensagens por até 14
dias e DLQ por 4 dias — mas concordou explicitamente que isso é fechável por desenho (reformular
"quiescence" como heurística de início de purga, não como prova de segurança) sem precisar de conta AWS
real. Nota: **8,9/10**.

## O-5. Rodada G — reenquadramento de quiescence + compensação + migração de marcador

Fechamento dos 5 itens exatos que a Rodada F listou: (1) reenquadrar quiescence como heurística de início de
purga (a segurança contra ressurreição já é indefinida via o fence transacional, independente de quando a
redelivery chega — 13 dias depois ainda cai no mesmo `ConditionCheck`); (2) fencing de toda mutação de
evidência intermediária, sem exceção; (3) compensação do objeto `clean` órfão reusando o padrão já existente
no código (`start-ocr.ts` já compensa reserva de quota com `deps.quota.release()` quando o passo seguinte
falha) — deletar o objeto recém-copiado quando a transação falha especificamente pelo `ConditionCheck` de
lifecycle (distinguível via `TransactWriteItems.CancellationReasons`, mecanismo real da API, confirmado pelo
Codex contra a documentação oficial da AWS e o SDK JS v3); (4) migração de `ExtractionRun`: como
`TenantLifecycleRecord` não existe em código (mecanismo greenfield, confirmado por `grep -ril
"TenantLifecycle" src/` vazio), toda linha `ExtractionRun` que existir no deploy foi criada num regime onde
"não-`ACTIVE`" nem existia como conceito — backfill de `admittedWhileActive: true` é verdadeiro por
construção, não uma inferência histórica forçada; (5) SES mantido como decisão humana explícita, mas com
redação de gate de implementação real: "não implementar o send path até a decisão ser registrada, ou
implementar atrás de uma flag cujo default não-respondido é a Opção 2 (mais segura)".

**Crítica adversarial da Rodada G** (`codex-roundG-critique-full.txt`): confirmou 2 itens fechados (evidence
mutations; gate de SES como condição arquitetural honesta), mas identificou 3 furos reais e específicos: (1)
o "custo de purgar cedo demais é só um passe extra" não é sempre verdadeiro — um cenário concreto onde uma
operação admitida antes de `DELETING` pausa, a purga escaneia e converge vazia, `VERIFYING` faz sua
re-varredura final vazia, e SÓ DEPOIS a operação retomada cria um objeto S3 que nunca mais é redescoberto —
o fence impede ressurreição de estado DynamoDB, mas não impede sozinho um objeto físico tardio depois da
varredura final "autoritativa"; (2) a compensação por `CancellationReasons` é tecnicamente real (confirmado
contra a documentação da API `TransactWriteItems` e o SDK), mas seu fallback (achar via a varredura de
purga) não cobre o mesmo cenário de objeto tardio pós-varredura-final; (3) o backfill de migração tem uma
corrida real de deploy (scan não é snapshot entre páginas, uma linha nova pode ser criada entre o
scan e o deploy do código novo) — proposta de correção: cutover em duas fases (Fase A escreve o marcador em
toda linha nova sem exigi-lo ainda; backfill idempotente das linhas antigas; varredura de verificação
repetida até zero linhas elegíveis sem marcador — não uma única contagem; só então Fase B ativa o fence e a
exigência do marcador no retry). Nota: **8,8/10** — mas com veredito explícito: *"After those close, APPROVED
WITH CONDITIONS... would be warranted"* e uma lista fechada e final de exatamente 3 itens restantes.

## O-6. Rodada H — fechamento final: extinção de capabilities, sweeper permanente, cutover em duas fases

Fechamento dos 3 itens exatos e finais da Rodada G, adotando as soluções que o próprio Codex sugeriu
explicitamente (não inventadas do zero):

1. **`VERIFYING→DELETED`**: separar 3 propriedades distintas — (a) prevenção indefinida de nova admissão via
   o fence transacional (já fechado, não depende de tempo); (b) extinção de capabilities JÁ admitidas via um
   cutoff conservador (o mesmo número 1800s = 900s TTL + 60s Lambda + 600s ASL + margem, agora re-escopado
   apenas para "toda operação admitida enquanto `ACTIVE` já completou seu efeito+compensação-ou-commit, ou é
   presumida abandonada" — nunca mais usado como bound de SQS/DLQ/scheduler, que o fence já cobre
   indefinidamente); (c) detecção e reparo de resíduo tardio via um **sweeper permanente pós-`DELETED`**
   (reusando o padrão já implementado do `DocumentPurgeWorker`/W3-06/D-061), com elegibilidade de varredura
   reforçada por tenant limitada a 90 dias (o teto normativo já adotado em `privacy-lgpd.md` para cópia
   residual) — qualquer achado é repurgado E gera alarme/finding, nunca absorvido silenciosamente. A
   alegação de conclusão de `DELETED` é declarada honestamente mais fraca do que "zero físico provado para
   sempre": *"nenhum estado de negócio DynamoDB alcançável, e nenhum resíduo S3 encontrado por duas
   varreduras vazias consecutivas realizadas no ou após o cutoff de finalização"* — consistente com a
   distinção DESIGNED/IMPLEMENTED/TESTED/... que este projeto já exige (`AGENTS.md`, Epistemic Integrity).
2. **Compensação tardia descobrível**: fechada como consequência direta do item 1 — o mesmo sweeper cobre os
   prefixos `clean` e `quarantine`, sem mecanismo separado.
3. **Cutover em duas fases do marcador `ExtractionRun`**: adotada a sequência exata proposta pelo Codex —
   Fase A (marcador em toda linha nova, sem exigência ainda) → backfill idempotente → varredura de
   verificação repetida até zero linhas elegíveis sem marcador (não uma comparação de contagem agregada) →
   Fase B (fence + exigência de marcador no retry) — com a via de reconciliação para linhas sem marcador
   retida permanentemente como defesa em profundidade, nunca removida. As 3 obrigações de implementação
   nomeadas pelo Codex ficam normativas: o executor fenced é o único dono da construção do array de
   transação (chamadores nunca inferem a posição do `ConditionCheck` de um array mutável montado alhures);
   o mapeador de erro do DynamoDB preserva `CancellationReasons` tipado até o chamador (nunca colapsa em um
   erro genérico de contenção OCC); o verificador de backfill usa a varredura repetida até zero, nunca uma
   contagem agregada bruta.

**Crítica adversarial da Rodada H** (`codex-roundH-critique-full.txt`, nota cega quanto ao score, sem
ancorar em 8,8): confirmou os 3 itens como **CLOSED**, sem nenhum furo arquitetural novo. Textual: *"The
crucial improvement is separating three different properties: indefinite prevention of new admission...
exhaustion of already-admitted capabilities... detection and repair of unexpectedly late residue... 'Presumed
abandoned' is materially weaker than 'proved impossible' and must remain exactly that weak... Therefore,
late residue is neither invisible nor silently normalized. The solution provides eventual remediation plus
operational evidence, rather than claiming an impossible one-time permanent proof. That is a real
closure."* Única correção de redação pedida (não um gap): o sweeper é um padrão de implementação permanente,
mas a elegibilidade de varredura reforçada de um tenant específico é limitada a 90 dias — distinção que o
documento já registra corretamente acima. Validou também a justificativa dupla do bound de 90 dias:
`sweep window ≥ horizonte máximo de materialização tardia + margem de detecção/remediação` (dado pelo
inventário real de capabilities: 1800s) **e** `sweep window ≤ teto normativo de 90 dias de
privacy-lgpd.md` — ambas as relações satisfeitas com folga.

**Nota final do Codex, Rodada H: 9,2/10. Decisão explícita do Codex: `APPROVED WITH CONDITIONS`**, condição
única nomeada: decisão humana registrada sobre a política de SES (Opção 1 — bloqueio no ponto de admissão,
permitindo que envios já admitidos se resolvam — vs. Opção 2 — lease/drain coordenado) antes de a
implementação do caminho de envio SES ser considerada aprovada. Texto do Codex: *"The five-round review-only
track has reached what it can close."* — nenhuma rodada adicional de revisão pura foi recomendada; o que
resta (implementação, ensaio de migração, verificação de infraestrutura real, validação de
alarme/runbook, teste empírico de varreduras completas, e a decisão humana de SES) é trabalho de
implementação/operação, não mais uma questão de desenho em aberto.

## P. Notas finais (conforme AGENTS.md §4)

**Trajetória completa desta sessão**: Codex **7,8 → 8,4 → 8,8 → 8,9 → 8,8 → 9,2/10**, em 6 rodadas reais de
crítica adversarial (A, D, E, F, G, H), cada uma com achados novos e concretos (nunca uma repetição vazia,
inclusive uma queda real de 8,9→8,8 na Rodada G quando um escrutínio mais rigoroso achou 2 furos novos —
progresso não-monótono é esperado num processo honesto, não foi maquiado). O gate de 9,0 foi **atingido na
Rodada H**, sem arredondamento (9,2 é o número real reportado pelo Codex, não um 8,95 arredondado).

- **Codex: 9,2/10** (nota final, Rodada H, explícita e registrada em `codex-roundH-critique-full.txt`).
- **Claude: 9,1/10** (nota própria, formada de forma independente ANTES de redigir esta seção — concordo com
  a avaliação do Codex de que os 3 furos finais da Rodada G foram genuinamente fechados pelas soluções da
  Rodada H, e que a separação entre "segurança indefinida via fence" / "extinção de capabilities via cutoff
  conservador" / "detecção e reparo via sweeper permanente com alarme" é uma resposta honesta e correta ao
  problema real que a Rodada G levantou, não uma reformulação cosmética do mesmo gap. Fico ligeiramente
  abaixo do Codex porque considero a condição de SES — embora corretamente identificada como decisão
  humana, não de engenharia — um risco residual que só será totalmente fechado quando Marcelo/jurídico
  registrar a escolha; até lá, a "aprovação" é da direção arquitetural condicionada, não de um sistema
  pronto para produção).
- Ambas ≥ 9,0. Nenhuma nota foi arredondada nesta rodada final (9,2 e 9,1 são os números reportados,
  respectivamente pelo Codex por escrito e por mim nesta seção).

**Limitação de processo registrada** (Epistemic Integrity, `AGENTS.md` §4): as 6 rodadas desta sessão
seguiram o formato "Claude lê/verifica código real → formula reconciliação → Codex critica e pontua às
cegas quanto ao NÚMERO (nunca ancorando na nota anterior, confirmado por instrução explícita em cada prompt
e pela própria trajetória não-monótona, que seria improvável se o Codex estivesse só confirmando uma âncora)
— mas não quanto ao CONTEÚDO da reconciliação, que obviamente já conhece por ser o que está avaliando".
Isso é mais rigoroso que uma leitura solo e cumpre o espírito do protocolo (independência de julgamento,
nota não inflada, mínimo de rodadas superado com folga — 6, não 3-4), mas não é literalmente o formato
canônico de "duas notas cegas simultâneas antes de qualquer tréplica" que `AGENTS.md` §4 descreve no caso
mais simples (uma única rodada de proposta→crítica→tréplica). Dado que esta foi uma decisão iterativa de
convergência (cada rodada resolvia achados concretos da anterior, não uma re-arguição do mesmo material),
o formato usado é uma adaptação razoável do protocolo à natureza do problema, registrada aqui para nunca
ser confundida com uma dispensa do protocolo.

## Q. Decisão

**APPROVED WITH CONDITIONS.**

A direção arquitetural `ACTIVE`-only fence + admissão transacional por efeito + lanes tipadas
(`TenantBusinessMutation`/`SystemMutation`) + purge com prova ponto-no-tempo + sweeper permanente pós-
`DELETED` está **aprovada como direção de arquitetura** para W3-07, substituindo definitivamente o objetivo
de "claim + outcome universal" de D-065. Isto é uma aprovação de **desenho**, não uma declaração de sistema
implementado, testado ou operado — `TenantLifecycleRecord` continua não existindo em código
(`grep -ril "TenantLifecycle" src/` vazio); nada aqui avança a barra IMPLEMENTED/TESTED/DEPLOYED/E2E
PROVEN/OPERATIONALLY PROVEN além de DESIGNED.

**Condição única, nomeada explicitamente pelo Codex e por mim**: a política de comportamento do SES após
`ACTIVE→DELETING` é uma decisão de produto/jurídica, não uma decisão de engenharia, e continua em aberto:

> **Opção 1 (recomendação de engenharia)**: bloqueio no ponto de admissão — a claim transacional
> `SUBMITTING` (após a correção proposta nesta sessão: convertê-la de `buildVersionedUpdate` de item único
> para uma `TransactWriteItems` de 2 itens com `ConditionCheck ACTIVE`) é o linearization point; um envio já
> admitido antes de `DELETING` pode se resolver normalmente mesmo que a chamada real ao SES ocorra depois.
> Proporcional porque o SES não tem API de cancelamento de chamada em voo, e a janela residual é curta
> (bounded pelo timeout do worker, confirmado real ≤60s).
>
> **Opção 2 (mais forte, não recomendada por padrão)**: protocolo de lease/drain coordenado com a transição
> de lifecycle, cancelando todo envio ainda não aceito pelo provedor no instante exato da exclusão — exigiria
> mecanismo novo, não apenas reusar o fence transacional já desenhado para os demais efeitos.
>
> **Gate de implementação**: o caminho de envio SES do W3-07 não deve ser implementado até esta escolha ser
> registrada formalmente em `decisions-log.md` — ou, se a implementação precisar avançar antes dessa decisão
> por outro motivo, deve ficar atrás de uma feature flag cujo default não-respondido seja o comportamento
> mais seguro (Opção 2), nunca a Opção 1 por omissão.

**O que foi fechado nesta sessão e não deve ser reaberto sem achado novo** (confirmado em múltiplas rodadas
adversariais independentes, 7,8→9,2):

- Tombstone `TenantLifecycleRecord` fora da cascata de purge (D-064, reconfirmado).
- Rejeição de "claim+outcome universal" como objetivo do W3-07 (D-066, endossada independentemente pelo
  Codex em 6 rodadas).
- Liveness de negócio pós-`DELETING` não é requisito real — verificado contra `privacy-lgpd.md`, que exige
  o oposto (bloqueio imediato de novas admissões, não conclusão de trabalho existente).
- Key S3 do OCR determinística `ocr/<tenantId>/<runId>.json` com overwrite em bucket não-versionado
  (`EXTRACTION_TRANSIENT` confirmado não-versionado) — validada tecnicamente correta pelo Codex (Rodada D):
  `deriveExtractionRunId()` garante que o mesmo `runId` nunca deveria legitimamente produzir 2 artefatos.
- Admissão transacional (Textract/Bedrock/Step Functions/SES) via conversão de escritas condicionais de item
  único (`TenantQuotaService.consume()`, `ExtractionRunStore.putIfAbsent()`,
  `email-delivery-workflow.ts`'s claim `SUBMITTING`) para `TransactWriteItems` de 2 itens com um
  `ConditionCheck` em `TenantLifecycleRecord.status=ACTIVE` — fechado arquiteturalmente sob o contrato de
  concorrência explícito: *"`ACTIVE→DELETING` bloqueia novas admissões; operações já admitidas atomicamente
  antes da transição podem terminar"* (não "o tenant está ACTIVE no momento da chamada ao provedor").
- Lanes tipadas `TenantBusinessMutation` (só construível pelo executor fenced, que é o único dono da
  construção do array de transação) vs. `SystemMutation` (allowlist nomeada e estreita: transição de
  lifecycle, deletes da purga, bookkeeping do outbox relay já criado por uma `TenantBusinessMutation`
  anterior) — mecanismo de enforcement estrutural fechado.
- Fencing de toda mutação de evidência intermediária no fluxo de upload (`uploadEvidence`/
  `malwareEvidence`/`SCANNING`), não só a transição final `CLEAN`.
- Compensação do objeto S3 `clean` órfão (cópia antes do commit fenced) via delete compensatório na mesma
  invocação quando a `TransactWriteItems.CancellationReasons` identifica especificamente a entrada do
  `ConditionCheck` de lifecycle como a causa da falha — mecanismo real da API confirmado contra a
  documentação oficial da AWS e o SDK JS v3.
- `VERIFYING→DELETED`: 3 propriedades separadas (prevenção indefinida de nova admissão via fence; extinção
  de capabilities já admitidas via cutoff conservador de 1800s = 900s TTL+60s Lambda+600s ASL+margem;
  detecção/reparo de resíduo tardio via sweeper permanente pós-`DELETED`, elegibilidade reforçada por
  tenant limitada a 90 dias per `privacy-lgpd.md`). Alegação de conclusão declarada honestamente como
  ponto-no-tempo ("nenhum resíduo encontrado por 2 varreduras vazias consecutivas no/após o cutoff"), não
  como prova permanente — consistente com a disciplina DESIGNED/IMPLEMENTED/TESTED/... do projeto.
- Cutover em duas fases do marcador `admittedWhileActive` em `ExtractionRun` (Fase A: escreve em toda linha
  nova sem exigir; backfill idempotente; varredura repetida até zero linhas elegíveis sem marcador; só
  então Fase B: fence + exigência no retry) — resolve a corrida de deploy que uma migração de passo único
  não resolveria.

**Roteiro objetivo para a sessão de implementação** (não mais rodadas de revisão — o próprio Codex declarou
que "the five-round review-only track has reached what it can close"):

1. Registrar a decisão de SES (condição desta aprovação) antes ou em paralelo à implementação do módulo de
   notificação do W3-07.
2. Implementar o executor fenced único (`TenantBusinessMutation`) com as 3 obrigações normativas da Rodada H:
   dono exclusivo da construção do array de transação; preservação de `CancellationReasons` tipado pelo
   mapeador de erro do DynamoDB; nenhuma outra forma de escrita tenant-scoped fora dele.
3. Implementar o boundary estrutural que impede módulos de negócio de importar o executor de transação cru
   (arquitetura test/ESLint secundário), consistente com a rejeição de "lint como garantia principal" da
   análise externa original.
4. Implementar o cutover em duas fases do marcador `ExtractionRun` exatamente na sequência da Rodada H.
5. Implementar o sweeper permanente pós-`DELETED` reusando o padrão real já implementado do
   `DocumentPurgeWorker` (W3-06/D-061).
6. Rodar o inventário empírico que ainda depende de infraestrutura real e não pôde ser verificado nesta
   sessão de revisão: paginação real de `ListObjectVersions`/`ListMultipartUploads` contra os buckets reais,
   ensaio de migração do backfill em `dev`, validação de alarme/runbook do sweeper.

**Gatilho já satisfeito**: esta sessão foi a própria continuação do gatilho registrado em D-062 (retomar
quando houver necessidade real de avançar o DSR). A decisão agora é `APPROVED WITH CONDITIONS`, não mais
`NEEDS ANOTHER ROUND` — a próxima sessão é de implementação, não de mais debate arquitetural, exceto pela
decisão humana de SES pendente.
