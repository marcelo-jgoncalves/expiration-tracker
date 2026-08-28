# Expiration Tracker — Prompt para IA externa: desenho do protocolo claim/outcome para o fence de exclusão de tenant (W3-07)

> **Uso**: este arquivo é autocontido — cole-o inteiro como prompt inicial para uma IA de engenharia
> (com acesso ao repositório) que vai ajudar a resolver especificamente o gargalo arquitetural em que a
> tentativa atual travou. Não é um pedido de implementação — é um pedido de **estratégia e desenho**.
>
> **Repositório**: `https://github.com/marcelo-jgoncalves/expiration-tracker`, branch `develop`, projeto
> Node/TypeScript, AWS serverless (Lambda, DynamoDB, S3, SQS, SES, Step Functions, Textract, Bedrock),
> multi-tenant, MVP com `tenantId=userId`.

## 1. O que este sistema é

Micro-SaaS de controle de vencimentos/renovações documentais (compliance leve de terceiros — fornecedores
enviam documentos com data de validade, o sistema rastreia e avisa antes do vencimento). Arquitetura
serverless real em produção (`dev`/`main` na AWS), não um protótipo — DynamoDB single-table por tenant,
OCC (optimistic concurrency control) em toda escrita mutável, `TransactWriteItems` como padrão para
qualquer mutação com efeito colateral, pipeline de extração de dados de documentos via Textract (OCR) +
Bedrock (LLM condicional) orquestrado por Step Functions.

Documentação viva do processo de engenharia deste projeto está em `AGENTS.md` (raiz do repo) — leia antes
de propor qualquer coisa, é a fonte canônica de como decisões de arquitetura são tomadas e revisadas aqui
(protocolo Claude↔Codex de debate adversarial, gate mínimo de nota 9,0/10 sem arredondar, mínimo 3 rodadas).

## 2. A feature em questão: W3-07, fence de exclusão física de tenant (DSR/LGPD)

Objetivo: quando um tenant pede exclusão total dos seus dados (direito de exclusão, LGPD/GDPR-like), o
sistema precisa (a) apagar fisicamente todo dado do tenant (cascata de exclusão, mecanismo já aprovado e
implementado — ver §4), e (b) garantir que **nenhum caminho de escrita do sistema pode voltar a escrever
dado desse tenant depois da exclusão declarada concluída** ("não-ressurreição" — o requisito difícil que
ainda não foi resolvido, é o assunto deste documento).

### Histórico: 5 rodadas de revisão adversarial já reprovadas

Este projeto usa um protocolo formal de debate entre duas IAs (Claude e Codex, via CLI, atuando como
arquiteto proponente e crítico adversarial independente) para qualquer decisão de arquitetura Type 1 —
ver `AGENTS.md` §4. O gate de aprovação é nota ≥9,0/10 de ambos os lados, sem arredondar, mínimo 3 rodadas.
W3-07 já passou por 5 rodadas nesta disciplina, todas reprovadas:

| Tentativa | Notas | Achado que travou |
|---|---|---|
| D-062 (`docs/architecture/reviews/w3-07-tenant-cascade-deletion-design/`) | 3,4→5,1→4,7/10 | Descobriu que "não-ressurreição" exige fence em TODO caminho de escrita, não só HTTP autenticado — escopo original não incluía isso |
| D-063 (`docs/architecture/reviews/w3-07-tenant-deletion-with-fence-design/`) | 3,2/10 (Rodada 1) | O fence proposto (`User.status`) era a mesma linha que a cascata apaga — o próprio `RequestContextResolver` re-provisiona um `User ACTIVE` no primeiro login seguinte, ressuscitando o tenant sozinho |
| D-064/D-065 (`docs/architecture/reviews/w3-07-tenant-fence-round2-design/`) | 2,8→4,1→4,8/10 (3 rodadas) | Ver §3 abaixo — é o ponto onde estamos agora |

**Leia os três diretórios de review acima na íntegra antes de propor qualquer coisa** — cada um documenta
não só o desenho tentado mas por que falhou, com achados confirmados contra código real (arquivo:linha),
não hipotéticos. Repetir um erro já documentado é o modo mais rápido de desperdiçar uma rodada.

## 3. Onde a tentativa mais recente travou (o problema real que você precisa resolver)

A tentativa D-064/D-065 (a mais recente, 3 rodadas na mesma sessão) resolveu o achado central de D-063 — o
tombstone de tenant (`TenantLifecycleRecord`) agora fica **fora do universo apagável pela cascata** (mesma
disciplina que o código já usa para `IdentityMapping`, que o próprio `identity-mapping-repository.ts`
documenta como "a delete of an IdentityMapping is not a supported operation"). Isso foi confirmado como
resolvido pelo Codex nas 3 críticas — **não reabrir esse ponto**.

O que travou é diferente e mais sutil, e é o motivo desta sessão externa:

> **O sistema já tem, em vários pontos reais, um protocolo de recovery para efeitos externos que falham
> entre a chamada e a persistência** (Textract usa `clientRequestToken` idempotente, Step Functions
> `StartExecution` usa nome de execução determinístico, SQS entrega pelo menos uma vez e todo worker
> assíncrono precisa tolerar redelivery). **Um fence "ingênuo" — "só chame o efeito externo se uma escrita
> DynamoDB fenced desta invocação suceder" — quebra esse recovery**, porque trata toda redelivery como se
> fosse a primeira tentativa: se a escrita fenced já rodou numa tentativa anterior e o efeito externo falhou
> depois dela, a redelivery encontra o estado "já tentado" e nunca repete o efeito, deixando o trabalho
> órfão permanentemente (ou, pior, nunca recupera um resultado que na verdade já ocorreu).

Exemplos concretos confirmados contra código real nesta sessão (ver os 3 arquivos `codex-roundN-critique-full.txt`
em `docs/architecture/reviews/w3-07-tenant-fence-round2-design/` para o texto completo e a citação exata de
arquivo/linha):

- **`src/modules/extraction/application/start-extraction-run.ts`**: hoje chama `StartExecution` (Step
  Functions) **incondicionalmente**, mesmo quando a criação do registro `ExtractionRun` no DynamoDB já
  existia (redelivery) — isso é deliberado, recupera de uma falha entre persistir o run e iniciar a state
  machine. Uma correção ingênua do fence ("só chama `StartExecution` se a transição de status desta
  invocação suceder") cria run órfão permanentemente quando `StartExecution` falha transitoriamente depois
  da transição já ter commitado.
- **`src/modules/extraction/application/start-ocr.ts`** e **`run-bedrock-extraction.ts`**: ambos usam
  `TenantQuotaService.consume()` para reservar quota antes de chamar o serviço externo (Textract/Bedrock).
  Hoje, se uma reserva já existe (de uma tentativa anterior), o código **tolera isso deliberadamente e
  prossegue** para o efeito externo — é assim que uma redelivery recupera. `TenantQuotaService` (ver
  `src/modules/identity/application/tenant-quota-service.ts` ou onde estiver, grep por `TenantQuotaRecord`)
  não guarda nenhum identificador de quem fez a reserva (`owner`/idempotency key) — só um contador por
  janela. Não dá para distinguir hoje "isto é um replay legítimo do mesmo consumidor" de "outro consumidor
  excedeu a quota" nem de "o kill switch está ativo".
- **`src/modules/extraction/application/complete-ocr.ts`**: persiste o artefato OCR (`PutObject` em S3) e
  depois sinaliza o Step Functions (`SendTaskSuccess`/`SendTaskFailure`) via task token. Se
  `SendTaskSuccess` falhar depois do `PutObject` ter sucedido, uma correção de fence que trate a primeira
  escrita como "já concluído, não repetir" impede o reenvio do task token — a execução Step Functions fica
  parada esperando um token que nunca chega.

### O achado estrutural (a pergunta real que este documento pede para você responder)

**Como desenhar um fence de "não-ressurreição de dado de tenant excluído" que:**
1. **gateia o início de um novo trabalho** (nenhuma chamada nova a Textract/Bedrock/Step Functions pode
   nascer depois que o tenant entrou em exclusão), **mas**
2. **nunca bloqueia a conclusão/recovery de um trabalho que já começou antes da exclusão** (idempotência e
   liveness existentes precisam sobreviver)?

A hipótese de trabalho registrada no roteiro de retomada (ver `claude-status-paused-for-next-session.md` na
pasta D-064/D-065) é um **protocolo de claim + outcome separados** por efeito externo — uma pequena máquina
de estados por tipo de efeito (não um único wrapper genérico), onde:
- **Claim**: registra a intenção de iniciar o efeito, com um identificador único desta tentativa lógica
  (não desta invocação Lambda — sobrevive a redelivery). O fence de tenant só é checado ao criar um claim
  **novo**.
- **Outcome**: registra o resultado do efeito (sucesso/falha/desconhecido), separado do claim, de forma que
  uma redelivery consiga diferenciar "claim existe, outcome desconhecido → posso repetir o efeito com
  segurança via idempotency key nativa do provedor" de "claim existe, outcome já registrado → só recuperar,
  nunca repetir o efeito".

Essa hipótese **não foi verificada em profundidade** — é o ponto de partida, não uma decisão fechada. Pode
haver uma solução mais simples, ou um padrão já conhecido da indústria (saga pattern, outbox com estado
duplo, etc.) que se encaixe melhor no código real deste projeto. **Sua tarefa é avaliar essa hipótese
criticamente e propor o desenho correto**, não implementá-la cegamente.

## 4. O que já está aprovado e implementado — reusar, nunca redesenhar

- **Mecanismo de descoberta+exclusão por Scan** (D-062, Rodadas 3-4): inventário verificado de ~40
  `entityType` reais do sistema, taxonomia por presença de `version`/`tenantId`, convergência por re-Scan.
  Este mecanismo em si está correto e aprovado — o que falta é só o fence de não-ressurreição em cima dele.
- **`DocumentPurgeWorker`/GSI6** (D-061, `docs/architecture/reviews/w3-06-user-document-purge-design/`):
  purga real de `Document`/objeto S3 via claim/lease sobre GSI6 — já implementado e em produção. Reusar
  para `Document`, nunca duplicar.
- **`bff-session-table`**: `Session`/`LoginAttempt`/`DeviceSession` vivem numa tabela DynamoDB física
  separada da tabela principal — qualquer mecanismo de descoberta tenant-wide precisa cobrir as duas
  tabelas, não presumir uma só.
- **`IdentityMapping` como registro permanente**: já documentado no código real como não-apagável
  (`identity-mapping-repository.ts`) — o tombstone de tenant (`TenantLifecycleRecord`) segue a mesma
  disciplina, ao lado dele, fora do Scan de descoberta+exclusão.
- **Builders OCC de `src/shared/dynamodb/occ.ts`**: `buildVersionedUpdate`/`buildVersionedCreate`/
  `buildVersionConditionCheck`/`buildExistenceConditionCheck` — toda escrita mutável do sistema já passa por
  eles (regra normativa, `AGENTS.md` §7). Qualquer fence novo deve reusar esses primitivos, não reinventar
  `ConditionExpression` manual.

## 5. Pendências específicas que a próxima rodada de desenho precisa fechar

Além do protocolo claim/outcome (§3, o gargalo principal), estas ficaram identificadas e não resolvidas:

1. **Convenção de key S3 não é uniforme** — confirmado contra código real:
   - Quarantine e import raw/plan: `tenant/<tenantId>/...` (enumerável por prefixo).
   - Clean (`src/modules/document/application/advance-after-evidence.ts`): `clean/<tenantId>/<itemId>/<documentId>`
     (tenantId presente, mas prefixo diferente — precisa de uma varredura por bucket, não um prefixo único).
   - OCR (`src/modules/extraction/persistence/s3-ocr-artifact-store.ts`): `ocr/<runId>/<uuid>.json` — **sem
     tenantId na key**, não enumerável por prefixo nenhum. Precisa de outra estratégia (ex.: indexar
     `runId→tenantId` via os registros `ExtractionRun` no DynamoDB **antes** de apagá-los, gerando a lista de
     keys OCR a apagar a partir do índice, não por listagem de prefixo S3).
2. **Varredura S3 de exclusão física precisa ser durável, com checkpoint** — não uma função sem estado.
   Precisa paginar `ListObjectVersions` (buckets quarantine/clean/import são versionados; OCR transient não
   é), tratar `DeleteObjects.Errors[]` (sucesso HTTP não significa que toda versão foi apagada), e
   provavelmente ser uma Step Functions dedicada de purga por tenant (mesmo padrão de orquestração já usado
   para `document-extraction`), não uma única Lambda.
3. **Distinção formal "zero linha DynamoDB consultável" ≠ "zero dado físico do titular"** — um documento/CSV
   em S3 é dado pessoal mesmo sem linha DynamoDB apontando para ele. O contrato de "exclusão concluída"
   (`TenantLifecycleRecord.status = DELETED`) precisa cobrir as duas garantias, com prova verificável para
   ambas, não só a primeira.
4. **Enforcement estrutural do fence** (impedir que um call site futuro esqueça de aplicá-lo): a hipótese
   validada nesta sessão foi uma regra ESLint em `.eslintrc.cjs` (o repo usa ESLint 8.57, config legado, não
   Flat Config) combinando `no-restricted-imports` (pega `import { PutCommand as X }`) com
   `no-restricted-syntax` num seletor de `NewExpression` sobre `MemberExpression` (pega
   `new ddb.PutCommand()`) — mas ainda tem bypasses residuais conhecidos (`new ddb["PutCommand"]()`,
   `BatchWriteCommand` não coberto, imports dinâmicos) e a lista de exceções (`excludedFiles`) só cobria os
   arquivos novos, não os dezenas de adapters legítimos existentes que precisariam migrar para o wrapper.
5. **Bootstrap atômico do primeiro tenant**: o `RequestContextResolver.resolve()`
   (`src/modules/identity/application/resolve-request-context.ts`) hoje cria `IdentityMapping` antes de
   qualquer checagem de lifecycle — para um tenant genuinamente novo, não existe `TenantLifecycleRecord`
   ainda. A hipótese validada foi criar `IdentityMapping`+`TenantLifecycleRecord`+`User` atomicamente numa
   única `TransactWriteItems` só quando `IdentityMapping` ainda não existe — mas isso exige estender o port
   `IdentityStore` (`src/modules/identity/ports/identity-store.ts`) com um método `transactWrite`, que hoje
   não existe (outros módulos como `document`/`expiration` já têm esse método em seus próprios ports —
   confirmar o padrão real neles antes de replicar).

## 6. O que se pede desta sessão

**Não é implementação.** É análise e desenho — o objetivo é chegar a um desenho que, quando submetido de
novo ao protocolo Claude↔Codex (`AGENTS.md` §4), tenha chance real de atingir nota ≥9,0/10 de ambos os
lados, em vez de repetir o padrão desta sessão (correções pontuais que resolvem um achado e revelam outro).

Passos sugeridos, mas você tem liberdade para propor uma ordem/abordagem diferente se achar melhor
fundamentada:

1. Leia os 3 diretórios de review completos (`w3-07-tenant-cascade-deletion-design/`,
   `w3-07-tenant-deletion-with-fence-design/`, `w3-07-tenant-fence-round2-design/`) — as propostas E as
   críticas, não só um lado.
2. Avalie criticamente a hipótese do protocolo claim/outcome (§3) contra o código real de
   `start-extraction-run.ts`, `start-ocr.ts`, `run-bedrock-extraction.ts`, `complete-ocr.ts` — ela é a
   direção certa, ou existe uma alternativa mais simples/robusta para este código específico?
3. Desenhe o protocolo (ou a alternativa que você propuser) em detalhe suficiente para resolver os 3
   efeitos externos reais (Textract, Bedrock, Step Functions) sem quebrar o recovery existente.
4. Endereçe as pendências do §5 (convenção de key S3, varredura durável, enforcement estrutural, bootstrap
   atômico) — pode reusar as hipóteses já validadas nas rodadas anteriores (estão descritas com detalhe em
   `claude-proposal-round3.md`) ou propor melhores, mas precisa justificar a escolha contra o código real.
5. Produza um documento de desenho (formato livre, mas precisão de arquivo:linha ao citar código real é
   obrigatória — as rodadas anteriores mostraram que alegações não verificadas contra código custam rodadas
   inteiras) pronto para ser submetido como Rodada 4 do protocolo Claude↔Codex.

## 7. Convenções deste repositório que você deve seguir ao propor o desenho

- Toda escrita mutável usa os builders de `src/shared/dynamodb/occ.ts`, nunca `UpdateItem`/`PutItem` cru.
- Eventos/comandos críticos usam o outbox pattern de `src/shared/outbox/outbox.ts` dentro da mesma
  `TransactWriteItems` do agregado.
- Erros de aplicação usam a taxonomia de `src/shared/errors/app-error.ts` (`AppError` + subclasses).
- Schemas JSON são a fonte de verdade dos contratos de evento/comando (`schemas/`), validados via Ajv.
- TypeScript estrito (`noUncheckedIndexedAccess`), sem `console.*` fora de `src/shared/observability/`.
- O protocolo Claude↔Codex exige nota mínima 9,0/10 de ambos os lados, sem arredondar (8,99 não vira 9),
  protocolo de nota cega (quem responde depois não vê a nota do primeiro até ambos existirem registrados).
