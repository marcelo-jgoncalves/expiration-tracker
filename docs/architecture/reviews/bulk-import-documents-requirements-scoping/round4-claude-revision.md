# Bulk Import — Documents + Requirements + Column Mapping — Rodada 4 (Claude)

Rodada 3: régua Claude 9.3/Codex 9.5 — **estável, ambos ≥9.0, fechada** (`research-protocol.md`
gate de régua). Design Claude 9.1/Codex 8.8 — 1 bloqueante + 3 pequenos restantes. Esta rodada
só ajusta design contra a régua v3 já fechada, sem tocar pesos.

## Bloqueante — wiring real do disparo assíncrono de parse

Confirmado por leitura direta (Codex R3): `OutboxDestination` é união fechada sem destino de
parse; o relay ignora (`SKIPPED_WRONG_DESTINATION`) qualquer evento sem destino reconhecido.
Fechamento concreto, mesmo padrão dos destinos já existentes (`SQS_REMINDER_DISPATCH_V1` etc.):

1. `OutboxDestination` ganha o literal `"SQS_IMPORT_PARSE_V1"`.
2. `infra/modules/` ganha uma fila SQS nova (`import-parse-requested-queue` + DLQ, mesmo padrão
   de redrive policy das filas de reminder/notification já existentes) — wiring Terraform,
   IAM restrito à role do relay (publish) e à role do worker de parse (consume).
3. O relay de outbox (`senders` map) ganha `SQS_IMPORT_PARSE_V1: publishToQueue(importParseQueueUrl)`
   — mesma forma que os outros senders.
4. A Lambda que hoje só reage ao evento S3 `ObjectCreated` do bucket raw ganha uma SEGUNDA fonte
   de evento (SQS, a fila nova) — ambas invocam o mesmo `parseImportJob(deps, tenantId, jobId)`;
   a idempotência de entrada (`status IN (UPLOADED, AWAITING_MAPPING)` já fecha correr duas vezes
   por engano.

Nada disto muda a forma pura do `parseImportJob()` já revisada nas Rodadas 2-3 — é só o "fio"
que faltava entre o `Put(OutboxEvent)` já desenhado e um consumidor real.

## Alto — `/schema`: identidade do objeto, header > 64 KiB, UTF-8 inválido, registro cortado

Confirmado por leitura direta (Codex R3): `parseCsv()` no EOF inclui um campo ainda `Quoted`
como linha completa (não descarta), e `Buffer.toString("utf-8")` nunca rejeita bytes inválidos
(substitui silenciosamente por `U+FFFD`). Fechamento:

- **Identidade do objeto**: a resposta de `/schema` inclui `objectETag` (do `GetObjectCommand`
  com `Range`) — só informativo/diagnóstico para a UI (nunca comparado contra nada no commit,
  que já usa `planSha256`/`columnMappingSha256`, mecanismos independentes e suficientes); declarado
  explicitamente como não-autoritativo para não sugerir uma terceira trilha de integridade.
- **Header maior que 64 KiB**: se a primeira linha (até o primeiro `\n` real, fora de aspas) não
  aparece dentro do range lido, 400 `HEADER_TOO_LARGE` — nunca tenta adivinhar um cabeçalho
  cortado.
- **UTF-8 inválido**: troca `Buffer.toString("utf-8")` por `new TextDecoder("utf-8", { fatal:
  true }).decode(bytes)` só no caminho de `/schema` (leitura parcial, deliberadamente mais
  estrita que o parse completo, que é onde um erro real deve aparecer de qualquer forma) — bytes
  inválidos viram 400 `INVALID_UTF8`, nunca um caractere de substituição silencioso.
- **Registro cortado em aspas**: `/schema` NUNCA usa `parseCsv()` para a amostra — usa uma
  função nova e deliberadamente mais simples, `sniffCsvHeaderAndSample()`, que primeiro corta o
  buffer no ÚLTIMO `\n` REAL fora de aspas (rastreando `inQuotes` com a mesma regra de aspas
  duplicadas do parser real, mas só para achar a fronteira segura) e só então roda `parseCsv()`
  sobre o prefixo garantidamente completo — a última linha potencialmente truncada nunca chega
  a ser parseada, não é "descartada depois", é excluída antes por construção. Se nenhum `\n`
  fora de aspas existir no range inteiro (arquivo com uma única linha gigante ou span de aspas
  maior que 64 KiB), 400 `HEADER_TOO_LARGE` (mesmo código do caso anterior — a causa raiz para o
  usuário é a mesma: "sua primeira linha não cabe no que inspecionamos").

## Médio — `canonicalJsonStringify()` — contrato explícito

```text
canonicalJsonStringify(value): string
  - object (não array, não null): ordena as CHAVES alfabeticamente, RECURSIVAMENTE em todo
    nível aninhado, serializa cada valor recursivamente.
  - array: preserva a ORDEM (nunca ordenado — ordem é semântica), serializa cada elemento
    recursivamente.
  - string | number | boolean | null: `JSON.stringify` padrão do primitivo.
  - undefined | function | symbol | bigint: LANÇA `CanonicalJsonUnsupportedValueError` — domínio
    fechado (o `ColumnMapping` só usa string/union de string literal, nunca precisa desses
    tipos; lançar em vez de ignorar silenciosamente é a mesma disciplina de "tipo não coberto
    lança" que `estimateDynamoItemBytesUpperBound()` já usa, D-191 §5).
```

Usado em exatamente um call site (`columnMappingSha256 = sha256(canonicalJsonStringify(mapping))`)
— não é utilitário genérico do projeto nesta fatia, só o suficiente para este contrato.

## Médio — limites e composição de chave para `externalId` (Subject/Document/Requirement)

Envelope único, reaproveitado pelos 3 tipos (nunca 3 regras divergentes):

- **Tamanho**: ≤ 200 bytes UTF-8 (`Buffer.byteLength`, mesmo padrão de orçamento de bytes de
  D-191 §5 — não caracteres, que subestimaria multibyte), validado no schema E no serviço.
- **Caracteres proibidos**: `checkControlChars()` (já existe em `import-row.ts`, reusado sem
  reescrever) **mais** o caractere `#` — motivo: `#` é o delimitador estrutural de TODA chave
  composta deste projeto (`TENANT#t#...`); um `externalId` legítimo contendo `#` colidiria de
  forma ambígua com a estrutura da própria chave (ex. `externalId = "A#B"` dentro de
  `SUBJECT#<subjectId>#EXT#A#B` é indistinguível de um `externalId` diferente com outro
  particionamento). Um `externalId` com `#` é `REJECT reason="EXTERNAL_ID_CONTAINS_RESERVED_CHARACTER"`
  — rejeitado na entrada, nunca escapado/codificado. **Correção de uma alegação não verificada
  da Rodada 2**: não existe precedente de `encodeURIComponent` em chave DynamoDB deste projeto
  (confirmado pelo Codex R2 por leitura direta) — a Rodada 2 armou essa alegação sem checar;
  esta rodada a substitui pela rejeição explícita acima, mais simples e sem inventar um
  mecanismo de encoding que nada mais no projeto usa.
- **Normalização**: NENHUMA além de `.trim()` — `externalId` é identificador de integração,
  não nome apresentável (`normalizeDisplayName()` não se aplica; decisão já registrada na
  Rodada 2, mantida).
- **Composição final**:
  ```text
  SubjectExternalIdPointer   SK = POINTER                              (PK já é por externalId)
  ImportDedupRecord Document SK = SUBJECT#<subjectId>#EXT#<externalId> (após validação acima)
  ImportDedupRecord Requirement — não existe: usa `RequirementNamePointer` (nome) OU um
    `ImportDedupRecord` na MESMA forma de Document quando `externalId` está presente.
  ```

## Autoavaliação Rodada 4 (régua v3, já fechada — só a nota de design muda)

1 (25%): inalterado desde R3, atendido. 2 (15%): **fechado agora** — wiring real do
`SQS_IMPORT_PARSE_V1` especificado ponta a ponta. 3 (15%): inalterado, atendido. 4 (15%):
inalterado, atendido. 5 (10%): inalterado, atendido. 6 (10%): inalterado, atendido. 7 (5%):
**fechado agora** — `/schema` sem as 4 lacunas restantes (identidade, header grande, UTF-8,
corte em aspas), `canonicalJsonStringify` com contrato recursivo explícito. 8 (5%): inalterado,
atendido.

**Nota Claude (cega), Rodada 4 — design: 9.3/10** (a régua já fechou na Rodada 3, não
recontada).
