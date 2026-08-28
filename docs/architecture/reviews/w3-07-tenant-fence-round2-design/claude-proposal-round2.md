# W3-07 — Tenant Deletion Fence, Proposta Round 2

> Corrige os 7 achados bloqueantes de `codex-round1-critique-full.txt` (nota 2,8/10). Não redescobre nada de
> `claude-proposal-round1.md` que não tenha sido invalidado — só as partes corrigidas são reescritas aqui, o
> resto (achado central resolvido, tombstone fora do Scan, direção geral) permanece válido e foi confirmado
> pelo próprio Codex na seção "Verificações sem achado bloqueante" da Rodada 1.

## Achado adicional que muda a Rodada 2: `IdentityMapping` já é permanente por invariante existente

`identity-mapping-repository.ts:69` já documenta: *"a delete of an IdentityMapping is not a supported
operation"* — ou seja, o próprio código já trata `IdentityMapping` como fora do universo apagável, **antes**
de qualquer desenho de W3-07. Isso dá uma base real para o desenho: `TenantLifecycleRecord` fica ao lado de
`IdentityMapping` na mesma lista de exclusão do Scan de descoberta+exclusão — não é um precedente novo, é
consistente com uma invariante já existente.

## 1. Três primitivos distintos (corrige achado #1)

`fencedSingleWrite` de Round 1 tentava servir três casos incompatíveis com a mesma regra fixa "exige
ACTIVE". Substituído por três funções separadas em `src/shared/dynamodb/tenant-lifecycle.ts`:

```ts
// Caso A — bootstrap: só usado quando IdentityMapping NÃO existe ainda (primeiro login real de um
// cognitoSub nunca visto). Cria IdentityMapping + TenantLifecycleRecord(ACTIVE) + User(ACTIVE) na MESMA
// TransactWriteItems, cada Put condicionado a attribute_not_exists(PK) — sem ConditionCheck de lifecycle
// (não existe lifecycle ainda para checar; a criação do próprio lifecycle É o Put condicional).
async function bootstrapTenant(input: { cognitoSub, tenantId, userId, now }): Promise<"CREATED" | "LOST_RACE">

// Caso B — escrita normal fenced: usada por toda escrita de dado de tenant (incluindo
// createProfileIfAbsent quando IdentityMapping JÁ existe mas User sumiu - o cenário exato de
// "ressurreição" do D-063). ConditionCheck contra TenantLifecycleRecord.status = "ACTIVE" injetado como
// PRIMEIRO item de QUALQUER TransactWriteItems que grave dado de tenant.
function fencedTransactWrite(items: TransactWriteEntry[], tenantId: string): TransactWriteEntry[]

// Caso C — transição administrativa: NUNCA usado por escrita normal, só pela cascata. ConditionCheck
// contra o status ANTERIOR esperado (não ACTIVE fixo) - ACTIVE->DELETING ou DELETING->DELETED.
async function transitionTenantLifecycle(tenantId, expectedStatus, nextStatus): Promise<void>
```

`fencedTransactWrite` nunca cria nem transiciona o próprio `TenantLifecycleRecord` — só lê (via
ConditionCheck). Os três primitivos são mutuamente exclusivos por construção: nenhum caminho de código chama
mais de um para a mesma operação.

## 2. Resolver corrigido (corrige achado #2 — bootstrap do primeiro tenant)

```ts
async resolve(input) {
  const existingMapping = await this.identityMappings.find(claims.sub);   // leitura, não findOrCreate

  let mapping: IdentityMapping;
  if (existingMapping) {
    mapping = existingMapping;                       // tenant já existe (ACTIVE, DELETING ou DELETED)
  } else {
    const result = await bootstrapTenant({ cognitoSub: claims.sub, tenantId: newTenantId, userId: newUserId, now });
    if (result === "LOST_RACE") {
      mapping = await this.identityMappings.find(claims.sub);   // outro request venceu a corrida, releitura
    } else {
      mapping = { ...candidate };                     // bootstrap desta invocação venceu
    }
  }

  let profile = await this.users.getProfile(mapping.tenantId, mapping.userId);
  if (!profile) {
    // Só alcançável quando IdentityMapping já existia mas User sumiu — cenário de "ressurreição" do
    // D-063. fencedTransactWrite injeta o ConditionCheck contra TenantLifecycleRecord aqui; se
    // DELETING/DELETED, a transação falha e este catch vira 403, sem provisionar nada.
    try {
      profile = await this.users.createProfileIfAbsent({ ... });  // internamente usa fencedTransactWrite
    } catch (err) {
      if (isConditionalCheckFailed(err)) throw new AuthenticationError("Tenant no longer active.", { tenantId: mapping.tenantId });
      throw err;
    }
  }
  // resto inalterado (status !== ACTIVE do User, globalLogoutAfter, device session...)
}
```

Um tenant genuinamente novo nunca aciona o `ConditionCheck` (bootstrap não tem um para checar — o próprio
Put condicional do lifecycle É a garantia). Um tenant existente sempre tem `TenantLifecycleRecord` (invariante
mantida desde o bootstrap, nunca apagado) — não existe mais o caso "lifecycle ausente para tenant existente"
que quebrava a Rodada 1.

## 3. Enforcement via ESLint, não dependency-cruiser (corrige achado #3)

```js
// eslint.config.js, aplicado a src/**/*.ts exceto os arquivos-âncora
{
  files: ["src/**/*.ts"],
  ignores: [
    "src/shared/dynamodb/tenant-lifecycle.ts",
    "src/shared/dynamodb/fenced-write.ts",
  ],
  rules: {
    "no-restricted-syntax": ["error", {
      selector: "NewExpression[callee.name=/^(Put|Update|Delete|TransactWrite)Command$/]",
      message: "Construa comandos DynamoDB mutáveis só via os wrappers de tenant-lifecycle.ts/fenced-write.ts (W3-07 fence).",
    }],
  },
}
```

`GetCommand`/`QueryCommand`/`ScanCommand` (leitura) **não** entram no seletor — só os 4 construtores
mutáveis, resolvendo o falso positivo apontado pelo Codex. Fixtures de teste: um arquivo com `new
PutCommand(...)` fora dos dois arquivos-âncora deve falhar o lint; o mesmo código dentro deles deve passar.
Verificação real desta rodada: `eslint.config.js` já existe no repo (`npm run lint` usa Flat Config), a
sintaxe acima é compatível com a versão instalada — a rejeitar/confirmar na implementação real, não
assumida sem checar `package.json`.

## 4. Inventário expandido além de DynamoDB (corrige achado #4)

Lista de escritores não-DynamoDB confirmados pelo Codex, com a correção de sequenciamento exigida para cada
um — regra geral: **nenhum efeito mutável externo (S3 write, SES send, StartExecution) sem uma escrita
`fencedTransactWrite` bem-sucedida imediatamente antes, na mesma invocação**, para que uma falha de fence
aborte antes do efeito, não depois:

| Escritor | Efeito | Correção de ordem exigida |
|---|---|---|
| `import-parse-service.ts:129` (S3 `putObject`, plano JSONL) | Cria artefato S3 | Marcar `ImportJob.status="PARSING"` via `fencedTransactWrite` **antes** do `putObject`; se falhar, nunca escreve o artefato |
| `s3-ocr-artifact-store.ts:17` (S3 `PutObjectCommand`, artefato OCR) | Cria artefato S3 transiente | Mesma correção — a escrita de estado do `ExtractionRun`/`TextractJob` que precede logicamente já deve ser fenced; garantir que ela ocorre antes, não depois |
| `s3-document-object-store.ts:38` (S3 `CopyObjectCommand`, promoção quarantine→clean) | Copia objeto | Sem alteração de ordem — resultado sem `fencedTransactWrite` correspondente (persistência do `Document`/`DocumentSubmission` promovido) é objeto órfão sem linha DynamoDB, mesma mitigação aceita em §7 do Round 1 (nenhuma ressurreição de dado consultável) |
| Uploads presignados (`documents-handler`, `imports-handler`, `guest-documents-handler`) | Emite capability S3 | Ver §5 |
| SQS enfileirado por `outbox-sweeper-handler`/`dispatch-outbox-relay` | Replay de outbox já commitado | Sem ação nova — o outbox já foi gravado via `fencedTransactWrite`; reenviar uma mensagem de um outbox já commitado antes do `DELETING` não é uma nova decisão de escrita, é replay de uma decisão já fenced |
| `sfn-extraction-execution-starter.ts` (`StartExecution`) | Inicia Step Functions | `ExtractionRun` já é criado via `fencedTransactWrite` em `startExtractionRun` antes do `StartExecution` (confirmar ordem exata na implementação) — se a criação falhar por fence, a execução nunca inicia |

## 5. Janela de claim→efeito: bounded, não "milissegundos" (corrige achados #5 e #6)

Correção de dois tipos:

**(a) Bug real independente encontrado pelo Codex, corrigir como parte desta feature**:
`run-bedrock-extraction.ts:145` ignora deliberadamente `QuotaExceededError` de uma reserva pré-existente e
prossegue para a chamada Bedrock. Isso permite que uma reserva feita antes do `DELETING` autorize uma
chamada depois. Correção: a chamada Bedrock só prossegue se a reserva de quota **desta invocação** suceder
via `fencedTransactWrite` — uma reserva pré-existente não é mais aceita como passe.

**(b) Sequência da cascata ganha um passo de drenagem explícito com prazo definido**, substituindo a
suposição implícita de "janela pequena" do Round 1:

1. `transitionTenantLifecycle(tenantId, "ACTIVE", "DELETING")`.
2. **Espera de drenagem, `DRAIN_WINDOW_SECONDS = 900`** (15min — cobre: TTL de URL presignada guest de 600s
   com margem, lease de processamento de e-mail/outbox de 5min, visibility timeout de fila + retries). Nenhum
   trabalho novo pode nascer depois do passo 1 (todo `fencedTransactWrite` novo falha); o que já estava em
   voo tem até este prazo para completar ou falhar sozinho no próprio fence.
3. `StopExecution` best-effort em toda execução Step Functions ativa do tenant (reduz custo Bedrock/Textract
   desperdiçado, não é requisito de correção).
4. Descoberta+exclusão (Scan + taxonomia, mecanismo já aprovado de D-062/D-061) roda **depois** da espera.
5. Re-Scan de convergência confirma zero itens.
6. `transitionTenantLifecycle(tenantId, "DELETING", "DELETED")` — só depois de (2)+(5), nunca antes.

Isso torna o prazo máximo de eliminação um número concreto e testável (`DRAIN_WINDOW_SECONDS`), respondendo
diretamente à exigência do achado #8 do Codex ("qual é o prazo máximo").

## 6. URLs presignadas — residual aceito e delimitado, não reaberto como falha de dado (refina achado #7)

O achado #7 do Codex mistura duas garantias diferentes: (i) nenhuma linha DynamoDB de tenant é escrita após
`DELETING` — **essa garantia continua de pé**, porque a finalização (`upload-finalizer-handler`/
`malware-result-handler`) persiste via `fencedTransactWrite`, então mesmo um upload físico tardio nunca vira
dado consultável; (ii) o sistema pode, numa janela de milissegundos dentro da MESMA invocação HTTP, terminar
de emitir uma URL presignada que tecnicamente ainda funciona no S3 — verdade, mas é emissão de uma
*capability*, não escrita de *dado*. Correção aplicada mesmo assim (defesa adicional, não porque a garantia
de dado estivesse quebrada): inserir uma releitura barata do `TenantLifecycleRecord` imediatamente antes de
`signer.presignUpload` em `GuestSubmissionService.startSubmission`/`ImportService.reserveImport`/
`documents-handler`'s `handleReserveUpload`, abortando se não `ACTIVE`. Reduz a janela para o mínimo
tecnicamente possível (duas leituras na mesma invocação); não pretende eliminá-la — nenhum sistema
assíncrono real elimina TOCTOU de emissão de capability, só a preservação de dado é a garantia forte deste
desenho.

## 7. O que muda na sequência de descoberta+exclusão (D-062/D-061, inalterado em essência)

Sem mudanças no mecanismo de Scan+taxonomia em si — só a posição dele na sequência (§5, passos 4-5 rodam
depois da espera de drenagem, não logo após o passo 1).

## 8. Checklist de rastreamento dos achados da Rodada 1

| # | Achado Rodada 1 | Resolução nesta rodada |
|---|---|---|
| 1 | Wrapper único autocontraditório | Três primitivos (§1) |
| 2 | Bootstrap do primeiro tenant impossível | Resolver reestruturado, bootstrap atômico separado (§2) |
| 3 | dependency-cruiser tecnicamente inviável | Regra ESLint AST (§3) |
| 4 | Inventário incompleto (S3/SQS/SFN) | Tabela expandida com correção de ordem por escritor (§4) |
| 5 | Janela de claim→efeito maior que assumido | `DRAIN_WINDOW_SECONDS=900` explícito na sequência da cascata (§5b) |
| 6 | Bug real do Bedrock ignorando quota já reservada | Corrigido como parte da feature (§5a) |
| 7 | URLs presignadas emitidas após transação fenced | Releitura adicional antes do presign + esclarecimento da garantia real (§6) |
| 8 | Sem prazo máximo de eliminação | `DRAIN_WINDOW_SECONDS` + convergência pós-espera dá um número concreto (§5b) |
