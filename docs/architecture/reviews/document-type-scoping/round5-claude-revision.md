# DocumentType — Rodada 5 (revisão Claude, resposta à crítica do Codex sobre a Rodada 4)

Nota da Rodada 4: régua 9,2/10 (segue estável, não reavaliada — Codex confirmou "não contradiz").
Design **8,6/10** (subiu de 8,5, não fecha). Achados 1 e 4 fecham (schema HTTP corrigido para
linguagem design-only; CRUD do catálogo migrado para a lane com fence sempre por último — ambos
confirmados sem ressalva). Achados 2 e 3 continuam bloqueantes por um motivo concreto e único:
**a Rodada 4 errou a identidade da 4ª entrada real de `submitEvidence()`** — alegou
`Put(DocumentFile)`, o código real (`guest-document-access-service.ts:364`) é
`Put(IdempotencyRecord)`. Corrigido abaixo com leitura direta da linha real, não repetindo a
alegação não verificada da Rodada 4.

## 2+3. [bloqueante→fechado nesta rodada] Ordem real de `submitEvidence()` e por que o mapeamento posicional fica mais simples, não mais complexo

Leitura direta de `guest-document-access-service.ts:360-375` (a `TransactWriteItems` real, hoje,
antes desta decisão) — **5 entradas, nenhuma é `DocumentFile`** (este fluxo guest antigo nunca
adotou `reserveFiles()`/D-163; ele grava `Document`/`DocumentVersion`/`DocumentVersionEvent`
diretamente, é um caminho estruturalmente mais simples que o fluxo interno, achado que a Rodada 4
deveria ter confirmado por leitura em vez de assumir simetria com `createDocument()`):

```
[0] Put(Document)
[1] Put(DocumentVersion)
[2] Put(DocumentVersionEvent)
[3] Put(IdempotencyRecord)
[4] Update(DocumentRequest)
```

Com o `ConditionCheck(DocumentType.status=ACTIVE)` novo desta decisão, adicionado na posição 0 (mesma
convenção de `createDocument()`, Rodada 3):

```
[0] ConditionCheck(DocumentType.status = ACTIVE)   // novo
[1] Put(Document)
[2] Put(DocumentVersion)
[3] Put(DocumentVersionEvent)
[4] Put(IdempotencyRecord)
[5] Update(DocumentRequest)
[6] fence de lifecycle (TenantBusinessMutation, sempre por último)
```

**O achado real do Codex sobre a posição `[4]`/`IdempotencyRecord` (linha 3741 da crítica) revela
que o mapeamento posicional granular que a Rodada 4 propôs nunca deveria ter sido proposto** — não
é só um erro de identidade da entrada, é um erro de desenho da resposta a erro. Leitura de
`guest-document-access-service.ts:377-390` (o `catch` real, já existente, não tocado por esta
decisão): hoje, **qualquer** `TransactionCanceledException` (por qualquer posição) já colapsa
uniformemente:

```ts
catch (err) {
  if (isTransactionCanceled(err)) {
    const replay = await this.store.get(idempotencyKey);
    if (replay) return replay.resultSnapshot;          // replay idempotente, não erro
    throw new GuestAccessInvalidError();                // qualquer outra causa, anti-enumeração
  }
  if (err instanceof TenantNotActiveError) throw new GuestAccessInvalidError();
  throw err;
}
```

Comentário real já presente no código (linha 383-385) documenta a razão: "A genuine race... or the
tenant leaving ACTIVE — the guest never sees which; same anti-enumeration collapse as every other
failure mode on this surface." Este é o mesmo contrato que a crítica da Rodada 5 do Codex apontou
(linha 3743): expor `DocumentTypeNotActiveError` como uma classe distinta nesta superfície
quebraria esse contrato de anti-enumeração deliberado (um guest não deve conseguir diferenciar "tipo
inválido" de "corrida comum" de "tenant sendo fechado" — todas colapsam na mesma resposta genérica,
mesma disciplina de `InvitationTokenUnavailableError`/outras superfícies não-autenticadas deste
projeto).

**Decisão correta, mais simples que a Rodada 4 propôs**: o `ConditionCheck` novo na posição `[0]`
**não muda o `catch` de `submitEvidence()` em nada** — o `isTransactionCanceled(err)` já existente
cobre a nova causa de cancelamento (posição `[0]` falhando) exatamente como cobre qualquer uma das
6 outras. Nenhum mapeamento posicional novo, nenhuma classe de erro nova chega a esta superfície.
`DocumentTypeNotActiveError` (definida na Rodada 4, mantida) é exclusiva do caminho **interno**
(`createDocument()`, `document-archive-service.ts`, onde o caller é autenticado e a distinção de
causa é informação legítima de UX de admin, nunca um vetor de enumeração) — o guest flow nunca a
lança, por design, não por lacuna.

`renameDocumentType()` mantém o mapeamento granular da Rodada 4 (índices `[0]`-`[2]`+fence em
`[3]`) sem mudança — é caminho interno/administrativo, mesma justificativa de `createDocument()`,
confirmado FECHADO pela Rodada 5 do Codex.

## Síntese

2 achados restantes da Rodada 4 fecham com uma correção só: a 4ª entrada real de `submitEvidence()`
é `Put(IdempotencyRecord)`, não `Put(DocumentFile)` (este fluxo guest nunca usa `DocumentFile`/
`reserveFiles()`), e o `catch` existente já trata qualquer cancelamento uniformemente por
anti-enumeração — a Rodada 4 estava tentando introduzir uma granularidade que o próprio desenho do
serviço já rejeita deliberadamente. `createDocument()` (caminho interno, sem essa restrição)
mantém o mapeamento granular já fechado nas Rodadas 3/4. Nenhuma outra mudança de mecanismo desta
decisão é afetada — schema HTTP (achado 1) e CRUD do catálogo na lane (achado 4) seguem fechados
como a Rodada 4 já estabeleceu, régua E-014 estável em 9,2/10.
