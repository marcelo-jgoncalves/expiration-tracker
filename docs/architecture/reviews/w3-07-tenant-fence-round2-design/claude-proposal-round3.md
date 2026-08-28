# W3-07 — Tenant Deletion Fence, Proposta Round 3

> Corrige o checklist de 8 achados da Rodada 1 (agora com status real após Round 2: 1 resolvido, 4 parciais,
> 3 não resolvidos) e os 4 achados novos da Rodada 2 (N1-N4), todos confirmados contra código real em
> `codex-round2-critique-full.txt`. Nota Round 2: 4,1/10.

## N1 — Fence anexado ao FIM da transação, não como primeiro item (corrige o achado mais grave da Rodada 2)

Código real confirmado pelo Codex: `dispatch.ts:126/244` e `reminder-materializer.ts:312/373` assumem índice
fixo (`occurrence` no índice 0, `policy fence` no índice 1) para interpretar `CancellationReasons` de uma
`TransactWriteItems` cancelada. `fencedTransactWrite` deixa de inserir o `ConditionCheck` do tenant como
primeiro item — passa a fazer `items.push(tenantFenceCheck)` (append), preservando todos os índices que o
código de interpretação de falha já depende. Verificação exigida na implementação real: reler cada um dos 4
call sites citados e confirmar que nenhum também assume "o último índice é sempre X" antes de fechar isto
como resolvido — não presumir aqui, sinalizado explicitamente para a próxima rodada verificar contra código.

## N2 — Limite de 99 itens, enforcement explícito

`fencedTransactWrite` lança erro síncrono se `items.length >= 99` **antes** de anexar o item do fence (i.e.
rejeita a partir de 99 itens de entrada, não de 100), com teste cobrindo 98→permitido, 99→rejeitado. Não
existe hoje nenhuma transação real perto disso (maior é 5 itens, `DynamoDbExtractedFieldStore`), mas o guard
é barato e fecha a lacuna apontada.

## 2 — Bootstrap: porta estendida, não criado do zero em `shared/dynamodb` (corrige achado #2)

Confirmado: `IdentityStore` (`src/modules/identity/ports/identity-store.ts`) não tem `transactWrite`, e um
primitivo em `shared/dynamodb` não pode importar tipos de `IdentityMapping`/`User` (regra de fronteira
`shared` → `modules` já existente, `AGENTS.md` §7). Correção: o bootstrap não vive em `shared/dynamodb` —
vive em `src/modules/identity/application/bootstrap-tenant.ts`, mesmo módulo que já possui os tipos de
domínio, e usa um `transactWrite(entries: TransactWriteEntry[]): Promise<void>` **novo método no port
`IdentityStore`** (mesmo padrão que `dynamodb-document-store.ts`/`dynamodb-expiration-store.ts` já
implementam para seus próprios módulos — não é um padrão novo, é estender o port de identidade ao mesmo nível
dos outros). `TransactWriteEntry`/builders de `occ.ts` continuam genéricos em `shared/dynamodb` (sem mudança
ali) — só o *chamador* concreto do bootstrap fica no módulo de identidade, que é o único que precisa conhecer
a forma real de `IdentityMapping`/`TenantLifecycleRecord`/`User`.

`TenantLifecycleRecord` (chave/status, sem lógica de domínio) fica declarado em `shared/dynamodb/` como um
tipo estrutural puro (`{ PK, SK, status }`), sem depender de nenhum módulo — todo módulo que precisa do
`ConditionCheck` do fence (não só identity) usa só essa forma estrutural, nunca importa o módulo identity.

Correção do bug de tratamento do `LOST_RACE` apontado pelo Codex: `bootstrapTenant` propaga o
`InternalError` que `IdentityMappingRepository.findOrCreate`/`find` já lança quando o mapeamento
"desaparece" após perder a corrida (não silencia, não presume `mapping` definido sem checar).

## 3 — Enforcement ESLint real, cobrindo alias e namespace import (corrige achado #3)

Confirmado: o repo usa `.eslintrc.cjs` (ESLint 8.57, config legado, não Flat Config) — a Rodada 2 propôs
sintaxe errada. Correção, como `overrides` em `.eslintrc.cjs`:

```js
overrides: [
  {
    files: ["src/**/*.ts"],
    excludedFiles: [
      "src/shared/dynamodb/tenant-lifecycle.ts",
      "src/modules/identity/application/bootstrap-tenant.ts",
    ],
    rules: {
      "no-restricted-imports": ["error", {
        paths: [{
          name: "@aws-sdk/lib-dynamodb",
          importNames: ["PutCommand", "UpdateCommand", "DeleteCommand", "TransactWriteCommand"],
          message: "Construa comandos DynamoDB mutáveis só via tenant-lifecycle.ts (W3-07 fence).",
        }],
      }],
      "no-restricted-syntax": ["error", {
        // cobre `new ddb.PutCommand(...)` (namespace import), que no-restricted-imports não pega
        selector: "NewExpression[callee.type='MemberExpression'][callee.property.name=/^(Put|Update|Delete|TransactWrite)Command$/]",
        message: "Construa comandos DynamoDB mutáveis só via tenant-lifecycle.ts (W3-07 fence).",
      }],
    },
  },
],
```

`no-restricted-imports` com `importNames` casa pelo nome **exportado original**, não pelo alias local — cobre
`import { PutCommand as X }`. A regra `no-restricted-syntax` cobre o caso de namespace (`import * as ddb`).
Combinadas, fecham as duas classes de bypass que o Codex demonstrou. Fixtures de teste obrigatórias na
implementação real: os dois exemplos de bypass do Codex, mais o caso direto `new PutCommand(...)`, todos
devem falhar fora dos anchors e passar dentro.

## 4/N3 — `StartExecution`/Textract: fence em toda invocação, não só na criação (corrige achado #4 e N3)

Achado confirmado: `start-extraction-run.ts:68-80` chama `StartExecution` **incondicionalmente**, mesmo
quando `putIfAbsent` retorna `false` (redelivery de uma mensagem já processada). A tabela da Rodada 2 estava
errada. Correção real: toda invocação de `startExtractionRun` — criação nova OU redelivery de uma já
existente — precisa de uma escrita fenced fresca **nesta invocação**, não apenas na primeira vez. Trocar o
`putIfAbsent` condicional simples por uma transição de status fenced (`ExtractionRun.status: "CREATED" →
"STARTING"`, via `fencedTransactWrite`) que roda sempre, inclusive em redelivery — se a transição falhar
(porque já está `STARTING`/`COMPLETED`, ou porque o fence de tenant falhou), `StartExecution` não é chamado.
Isso também fecha a classe geral: "efeito externo só depois de escrita fenced desta invocação", sem exceção
de "já existia".

## 6 — Textract corrigido com o mesmo padrão do Bedrock (corrige achado #6)

`start-ocr.ts:84` tem o mesmo bug do Bedrock (ignora `QuotaExceededError` de reserva pré-existente e chama
`StartDocumentTextDetection` mesmo assim). Correção idêntica à do Bedrock: só prossegue se a reserva desta
invocação suceder. Contrato de `TenantQuotaService.consume()` muda de `Promise<void>` para
`Promise<"RESERVED" | "ALREADY_RESERVED">` — call sites que hoje toleram uma reserva pré-existente como
autorização (Bedrock e Textract) passam a exigir `"RESERVED"` especificamente antes do efeito externo; outros
call sites do `consume()` que não têm esse requisito (ex.: `API_REQUEST` do middleware HTTP) continuam
aceitando qualquer um dos dois valores sem mudança de comportamento.

## N4 — Artefato OCR: fence imediatamente antes do `PutObject` (corrige achado novo)

`complete-ocr.ts:84` escreve o artefato OCR via `deps.artifacts.put(...)` depois que o job Textract já
concluiu — a escrita de `TextractJob` que precede isso na mesma função é antiga (feita em `startOcr`, minutos
antes), não satisfaz a regra de "fenced nesta invocação". Correção: `completeOcr` faz uma transição fenced
própria (`TextractJob.status: "IN_PROGRESS" → "COMPLETING"`, via `fencedTransactWrite`) imediatamente antes
da chamada a `deps.artifacts.put(...)` — se falhar, o artefato nunca é escrito.

## 7/8 — Exclusão física de S3 verificável, substituindo a suposição de lifecycle passivo (corrige achados #7 e #8)

Achado aceito integralmente: a distinção "zero linha DynamoDB consultável" ≠ "zero dado físico do titular" é
real, e um documento/CSV em S3 é dado pessoal mesmo sem linha DynamoDB. Correção estrutural, não paliativa:

**Toda key S3 de dado de tenant já segue (ou passa a seguir) o prefixo `tenant/<tenantId>/`** — confirmado já
verdadeiro para `ImportService.rawObjectKey` (`tenant/${tenantId}/imports/${jobId}/raw.csv`); a implementação
real precisa confirmar/padronizar o mesmo para as keys de `Document` (quarantine/clean) e artefato OCR, que
hoje podem não seguir essa convenção — item de verificação explícito para a próxima rodada, não presumido
aqui.

O passo final da cascata deixa de ser "espera 900s e assume": passa a ser uma **varredura ativa e
verificável por bucket**, rodando depois do `DRAIN_WINDOW_SECONDS` (ainda necessário para efeitos SES/quota/
outbox já em voo, mas não mais a garantia de exclusão física):

1. Para cada bucket relevante (quarantine, clean, import, OCR-transient): `ListObjectsV2({ Prefix:
   "tenant/<tenantId>/" })`, incluindo `ListObjectVersions` nos buckets versionados (confirmar quais
   buckets têm versionamento — `spa-hosting`/`document-buckets` já usam versionamento por outro motivo,
   verificar na implementação real quais dos buckets de dado de tenant também têm).
2. `DeleteObjects` em lote (até 1000 por chamada) de tudo que a listagem retornar, incluindo todas as
   versões e delete markers.
3. Repetir (1)+(2) até a listagem retornar vazia (convergência, mesmo padrão já usado para o Scan DynamoDB).
4. Só então `transitionTenantLifecycle(tenantId, "DELETING", "DELETED")`.

Isso responde diretamente ao achado #8 ("prazo máximo de eliminação"): não é mais um número fixo assumido —
é "até a varredura por prefixo convergir em zero", igual ao mecanismo já aprovado para DynamoDB (D-062),
aplicado agora a S3. Uma URL presignada usada depois do passo (1)-(3) já ter rodado uma vez cria um objeto
novo que a próxima iteração do loop (1)-(3) ainda descobre — só fecha de vez quando a listagem vem vazia
duas vezes seguidas (mesma disciplina de "convergência" que o Scan DynamoDB já usa), não numa única
passagem.

## Checklist atualizado

| # | Achado | Status após Round 3 |
|---|---|---|
| N1 | Fence quebra índices de `CancellationReasons` | Corrigido — append, não prepend |
| N2 | Limite de 99 itens | Corrigido — guard explícito + teste |
| 2 | Bootstrap não implementável nos ports reais | Corrigido — vive em `modules/identity`, port `IdentityStore` estendido |
| 3 | ESLint real (não dependency-cruiser, não Flat Config) | Corrigido — `.eslintrc.cjs` overrides, cobre alias+namespace |
| 4/N3 | `StartExecution` incondicional em redelivery | Corrigido — fence em toda invocação via transição de status |
| 6 | Textract com o mesmo bug do Bedrock | Corrigido — mesmo padrão, contrato de `consume()` muda |
| N4 | Artefato OCR sem fence na invocação | Corrigido — transição fenced imediatamente antes do `PutObject` |
| 7/8 | "Zero linha" ≠ "zero dado físico"; sem prazo real | Corrigido — varredura S3 por prefixo até convergência, substitui a espera fixa |
| 5 | `DRAIN_WINDOW_SECONDS` não derivado dos tempos reais | Mantido só para efeitos SES/outbox em voo (300s de lease); a garantia de exclusão física agora vem da convergência S3 (item 7/8), não do prazo fixo |

## Pendências explícitas para a próxima rodada verificar (não fechadas aqui, sinalizadas para não repetir o
## erro de afirmar sem checar)

- Confirmar se as keys de `Document`/artefato OCR já seguem `tenant/<tenantId>/...` ou precisam de migração.
- Confirmar quais buckets de dado de tenant têm versionamento habilitado (afeta se `ListObjectVersions` é
  necessário além de `ListObjectsV2`).
- Reverificar os 4 call sites de `CancellationReasons` por índice depois do append, incluindo qualquer
  suposição de "último índice" que o append possa quebrar.
