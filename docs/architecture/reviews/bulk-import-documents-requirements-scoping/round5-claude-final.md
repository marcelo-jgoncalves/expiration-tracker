# Bulk Import — Documents + Requirements + Column Mapping — Rodada 5 (Claude, final possível)

Régua fechada desde a Rodada 3 (9.3/9.5, ambos ≥9.0). Design Rodada 4: Claude 9.3/Codex 8.8 —
2 pontos remanescentes (claim atômico de parse; vínculo objeto `/schema`↔parse) + 2 notas
menores (limite de Range no `TextDecoder`; escopo de `#`/limites dos demais componentes de
chave). `AGENTS.md` §4: mínimo 3, esta é a 5ª e última antes de reportar desacordo — reviso os
4 pontos de forma direta, sem introduzir mecanismo novo além do estritamente necessário.

## 1. Claim atômico do parse (concorrência real dos dois triggers)

Aceito integralmente — dois triggers (evento S3 + evento SQS do outbox) podem, de fato, invocar
`parseImportJob()` quase simultaneamente, e "ler o job, depois decidir" tem uma janela real
entre leitura e escrita. Correção: a PRIMEIRA ação de `parseImportJob()`, antes de qualquer
leitura de S3, é um `Update` condicional que É o claim:

```text
parseImportJob(deps, tenantId, jobId):
  job = get(jobKey)
  if !job or job.status not in (UPLOADED, AWAITING_MAPPING): return SKIPPED
  if !job.columnMapping:
    // claim para AWAITING_MAPPING é igualmente condicional, mesma forma abaixo
    ok = update(jobKey, { status: AWAITING_MAPPING }, condition: version = job.version)
    return ok ? AWAITING_MAPPING : SKIPPED (perdeu a corrida — outro já mudou o job)
  claimed = update(jobKey, { status: PARSING }, condition: version = job.version AND
                    status IN (UPLOADED, AWAITING_MAPPING))
  if !claimed: return SKIPPED_ALREADY_CLAIMED   // o outro trigger venceu, este simplesmente para
  // só a partir daqui lê S3/faz o trabalho pesado — exatamente UM vencedor possível
  ...
```

A condição dupla (`version` E `status IN (...)`) fecha tanto duas entregas do MESMO trigger
(SQS at-least-once) quanto uma corrida ENTRE os dois triggers diferentes — qualquer um dos dois
que perder o `Update` condicional retorna imediatamente, nunca lê S3 nem produz um segundo
plano. Isto substitui a frase vaga "ambos idempotentes pela mesma condição de entrada" das
Rodadas 2-3 (que descrevia proteção de LEITURA, não de ESCRITA) pelo claim real.

**Discriminação de envelope**: o handler Lambda (nunca `parseImportJob()` em si, que continua
puro e testável só com `{tenantId, jobId}`) inspeciona a forma do evento recebido —
`event.Records?.[0]?.eventSource === "aws:s3"` (evento S3 direto, formato já tratado hoje) vs.
`event.Records?.[0]?.body` contendo um JSON `{tenantId, jobId}` (mensagem SQS do outbox,
formato novo) — extrai `{tenantId, jobId}` de qualquer um dos dois e chama a MESMA função pura.
Mesmo padrão de "handler traduz evento concreto, função de aplicação é agnóstica", já usado em
outros workers deste projeto (`AGENTS.md` §7: "workers assíncronos puros... deliberadamente
observability-agnostic").

## 2. Vínculo objeto `/schema` ↔ objeto parseado — reclassificado, não é gap de correção

Aceito a pergunta, contesto que exija mecanismo novo. O que `planSha256` já garante (Rodada 1,
mecanismo pré-existente do módulo, inalterado) é exatamente a invariante que importa para
CORREÇÃO: o commit nunca aplica um plano diferente do que o preview mostrou — os BYTES
efetivamente parseados estão hasheados no plano, e o commit falha (`FAILED_INTEGRITY_MISMATCH`,
já existente) se o plano mudar. `/schema` não participa dessa cadeia de integridade — é uma
leitura auxiliar, ANTES do parse, cujo único consumidor é a UI para montar o mapeamento. Se o
usuário reenviasse um arquivo diferente para a MESMA presigned URL depois de chamar `/schema`
(único jeito de "`/schema` viu bytes diferentes dos que o parse usa"), o `columnMapping`
configurado contra o cabeçalho antigo simplesmente falharia campo-a-campo no parse real (colunas
referenciadas que não existem no CSV novo → 400 já coberto por D-2/Rodada 1) ou produziria um
plano capturado pelo hash de qualquer forma — nunca um commit sobre dado que o preview não
mostrou. **Esta janela (reupload para a mesma presigned URL antes de expirar) já existe
IDÊNTICA no import de Subject hoje, sem `/schema`** — não é introduzida por esta fatia.
Reclassificado: `objectETag` em `/schema` continua só diagnóstico de UI ("isto foi o que
inspecionamos"); nenhuma trilha de integridade nova é necessária porque `planSha256` já cobre a
invariante que realmente importa. Registrado explicitamente para não parecer uma lacuna
escondida.

## 3. `TextDecoder({fatal:true})` cortando sequência UTF-8 válida na fronteira do Range

Aceito — um Range de 64 KiB pode terminar no meio dos bytes de um único code point multibyte.
Correção: antes de decodificar, `sniffCsvHeaderAndSample()` primeiro decodifica com
`TextDecoder("utf-8")` **sem** `fatal`, mas verificando o SUFIXO: se os últimos 1-3 bytes do
buffer formam o INÍCIO de uma sequência multibyte incompleta (checagem padrão de continuation
bytes UTF-8, `0x80-0xBF` seguindo um byte líder sem os continuation bytes completos), esses
bytes finais são DESCARTADOS do buffer antes de decodificar — nunca incluídos na decisão de
válido/inválido. só ENTÃO decodifica o restante com `fatal: true`. Isso distingue "corte
mecânico do Range no meio de um caractere" (esperado, sempre tolerado, silenciosamente truncado)
de "byte realmente inválido no meio do conteúdo" (rejeitado com 400 `INVALID_UTF8`, como antes).

## 4. Escopo de `#`/limites dos demais componentes de chave — reduzido ao que é realmente entrada de usuário

Aceito a crítica de proporcionalidade: a política de `#` se aplica só a `externalId`, que É o
único componente de chave desta fatia efetivamente digitado por um usuário externo em texto
livre. Os outros componentes interpolados nas chaves novas desta fatia já têm origem controlada,
sem precisar de uma regra nova:

- `subjectId`/`documentId`/`requirementId`/`templateItemId`: sempre gerados pelo próprio
  sistema (ULID via `id-generator.ts`), nunca texto de usuário — nenhum limite novo necessário.
- `normalizedName` (usado por `RequirementNamePointer`, caminho de dedupe fraco de
  `Requirement`): já validado pelo limite EXISTENTE de `Requirement.name` (orçamento de bytes já
  fechado por D-191 §5, reusado sem reabrir), não uma regra nova desta fatia.
- `documentTypeRef`/`subjectRef` (valor de CSV que ALIMENTA a resolução, não que vira
  componente de chave em si — o valor RESOLVIDO, `documentTypeId`/`subjectId`, é que entra na
  chave, e esse já é controlado pelo sistema): sem limite de tamanho de chave aplicável — o
  limite relevante é o de `externalId` acima, quando é POR `externalId` que a resolução
  acontece.

Reformulação da justificativa do `#` (aceito que "colisão automática" era forte demais, Codex
R4 correto): a razão de proibir `#` não é "colide inevitavelmente" — é **impossibilidade de
distinguir, sem uma regra de escaping adicional que este projeto não usa em nenhuma outra chave
hoje, dois `externalId` reais diferentes que produzem a MESMA sequência de bytes de SK** (ex.
`externalId="A"` sob `subjectId="B#C"` viraria `SUBJECT#B#C#EXT#A`, byte-idêntico a
`externalId="C#EXT#A"` sob `subjectId="B"` — mas como `subjectId` é sempre ULID gerado pelo
sistema, sem `#`, essa ambiguidade específica não ocorre na prática; a ambiguidade real e
suficiente para justificar a proibição é mais simples: dois `externalId` diferentes que só
diferem em onde um `#` interno cai (`"AB#C"` vs `"AB"` seguido por continuação `"C"` de outro
campo) produzem SKs indistinguíveis SE algum componente futuro reusar essa mesma chave
concatenando mais um campo depois — proibir `#` na ENTRADA é a forma mais simples de nunca
depender dessa garantia frágil, não uma prova de colisão imediata com o design de hoje).
Mantida a rejeição — motivo reformulado para precisão, comportamento inalterado.

## Autoavaliação Rodada 5

1: fechado (claim atômico real, condição dupla version+status). 2: reclassificado com
justificativa (não gap de correção, `planSha256` já cobre a invariante que importa) — aceito
que isto é uma decisão de julgamento, não uma prova formal; é o único ponto desta rodada onde
posso genuinamente não convencer o Codex. 3: fechado (boundary UTF-8 tolerante ao corte
mecânico do Range). 4: fechado (escopo restrito a `externalId`, demais componentes já
controlados por mecanismos existentes, justificativa de `#` corrigida).

**Nota Claude (cega), Rodada 5 — design: 9.4/10** (mantenho abaixo de 9.5 porque o ponto 2 é
uma reclassificação argumentada, não uma prova — reconheço que o Codex pode legitimamente não
aceitar e isso ficaria registrado como desacordo residual, não forçado a consenso).
