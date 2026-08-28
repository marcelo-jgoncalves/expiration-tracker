# W3-06 — Round 4 (Claude tréplica, respondendo à Rodada 3 do Codex, nota 7,8/10, 5 achados bloqueantes)

## Resolução achado "novo" (status apagado pela exclusão lógica)

Correto — `document-deletion-service.ts:51` sobrescreve `status` para `DELETED`, então a tabela
por-status da Rodada 3 é inexequível como escrita. **Correção: não depender de `status` anterior
nenhum.** `cleanObject`/`uploadEvidence`/`malwareEvidence` já sobrevivem à exclusão lógica sem
qualquer mudança (nenhum código os limpa em `deleteDocument`), então são discriminadores
suficientes por si:

```
if (doc.cleanObject) → deleteObjectVersion(doc.cleanObject)               // foi promovido a CLEAN
else if (uploadEvidence?.object ?? malwareEvidence?.object) → deleteObjectVersion(esse objeto)  // teve evidência real, nunca promovido (REJECTED/UNSUPPORTED)
else → nada a apagar por versão explícita (nunca chegou evidência; lifecycle 24h de quarantine já cobre)
```

Nenhum campo novo (`deletedFromStatus` ou similar) é necessário — mais simples que a tabela da
Rodada 3, não mais complexo. Cobre exatamente os mesmos três casos, só que por presença de dado
em vez de status categórico (mais robusto a estados futuros que a Rodada 3 não listou, ex.: um
`TIMEOUT` que teve evidência parcial de malware mas nunca de upload cai automaticamente no
segundo ramo, sem precisar de uma linha nova na tabela).

## Resolução achado 1 (hold pós-claim) — fechamento estrutural, não redução de risco

Concordo que "reduzir a janela" não é fechar. Fechamento real: **toda escrita de `legalHold`
neste sistema, presente ou futura, é obrigada pela convenção já existente e vinculante do próprio
repositório (`AGENTS.md` §7: "toda escrita mutável usa os builders de `occ.ts` ... nunca
`UpdateItem`/`PutItem` cru") a passar por `buildVersionedUpdate`/OCC com `expectedVersion`** —
isso não é um mecanismo novo proposto por este design, é a única forma sancionada de escrever
qualquer campo em qualquer entidade deste projeto, já enforced por convenção de longa data (nenhum
outro campo de nenhuma entidade tem uma exceção a essa regra hoje).

Consequência: o `claim` (achado 3 abaixo) já condiciona em `expectedVersion`. Um setter de hold
futuro que respeite a mesma convenção OCC obrigatória também condiciona sua escrita em
`expectedVersion`. **As duas transações não podem ambas suceder sobre a mesma versão** — é
exclusão mútua por construção do OCC do projeto, não por um handshake ad-hoc deste design:
- Se o claim commita primeiro (`version → N+1`, `GSI6PK → CLAIMED`), o setter de hold que leu a
  versão `N` falha seu próprio `TransactWriteItems` (`expectedVersion = N` não bate mais),
  reforçando a mesma re-leitura que qualquer conflito de OCC já força em todo o resto do sistema
  — cabe à feature de hold (fora de escopo aqui) decidir o que fazer ao reler e achar
  `GSI6PK = WORKSTATE#PURGE_CLAIMED` (ex.: recusar o hold com erro "documento em purga", ou
  aceitar e emitir um alerta operacional) — **essa decisão de produto é de W3-07/feature de hold,
  não desta decisão**, mas o desenho aqui já torna a condição de corrida estruturalmente
  impossível, não apenas provável de ser pega a tempo.
- Se o hold commita primeiro, o claim (`expectedVersion` desatualizado) falha e nunca toca S3.

Nenhuma leitura extra pré-delete é necessária (removida — era defesa supérflua uma vez que a
janela real já não existe). **Pendência textual explícita mantida**: a feature de hold futura deve
tratar o caso "hold perdeu a corrida de OCC contra um claim já commitado" — comportamento
específico dela, fora do escopo Type 1 desta decisão.

## Resolução achado 3 (API do builder inexequível)

`buildVersionedUpdate` (`occ.ts`) ganha uma extensão aditiva e tipada (não um fragmento de string
solto):

```typescript
export interface VersionedUpdateInput {
  // ...campos existentes inalterados...
  /** Extra ConditionExpression clauses ANDed to the base condition, each with its own
   * caller-supplied names/values. Caller is responsible for unique attribute name/value
   * placeholders that do not collide with the base ("#version"/":expectedVersion"/etc.) or with
   * `set`/`remove` keys - buildVersionedUpdate throws on any detected collision. */
  extraConditions?: Array<{ expression: string; names?: Record<string, string>; values?: Record<string, unknown> }>;
}
```

`buildVersionedUpdate` funde `names`/`values` de cada `extraConditions[i]` nos mapas já existentes
(lançando erro descritivo se alguma chave colidir com `#set${i}`/`:set${i}`/`#rem${j}`/
`#version`/`:expectedVersion`/`#tenantId`/`:tenantId`/`#updatedAt`/`:now`/`:one` — checagem
mecânica simples, mesma disciplina de "falha-fechado" do resto do projeto), e concatena
`AND (${expression})` para cada entrada à `ConditionExpression` final. Uso concreto do claim:

```typescript
buildVersionedUpdate({
  tableName, key, tenantId, expectedVersion: doc.version,
  set: { GSI6PK: "WORKSTATE#PURGE_CLAIMED", GSI6SK: claimedGsi6Sk, purgeAttempts: (doc.purgeAttempts ?? 0) + 1 },
  extraConditions: [
    { expression: "attribute_not_exists(#legalHold) OR #legalHold = :false", names: { "#legalHold": "legalHold" }, values: { ":false": false } },
    { expression: "#status = :deleted", names: { "#status": "status" }, values: { ":deleted": "DELETED" } },
    { expression: "GSI6PK = :expectedPk AND GSI6SK = :expectedSk", values: { ":expectedPk": "WORKSTATE#PURGE_PENDING", ":expectedSk": doc.GSI6SK } },
    { expression: "purgeAfter <= :now", values: { ":now": nowIso } },
  ],
})
```

Cobre exatamente as invariantes que a Rodada 3 pediu, de forma mecanicamente segura (sem colisão
de placeholder), reusando o helper existente em vez de bifurcar a lógica de OCC do projeto.

## Resolução achado 4 (estado terminal ausente)

Novo campo `purgeStatus?: "STUCK"` materializado no próprio item `Document` (não só métrica).
Transação de reconciliação de lease expirado passa a ter dois desfechos, não um:
- `purgeAttempts < 5`: devolve a `WORKSTATE#PURGE_PENDING` (comportamento já descrito), incrementa
  nada aqui (o incremento é só no claim).
- `purgeAttempts >= 5`: `TransactWriteItems` condicionado (mesmo `expectedVersion`) que **remove**
  `GSI6PK`/`GSI6SK` (sai de ambas as filas, nunca mais reclaimado automaticamente) e seta
  `purgeStatus: "STUCK"`. Estado **reprocessável, não descartado**: reverter exige uma ação
  administrativa explícita (fora de escopo implementar uma rota HTTP para isso agora — registrar
  como pendência textual, mesma disciplina de `principles.md` #1; a reversão manual imediata, se
  necessária antes de existir essa rota, é um `UpdateItem` operacional único feito por um humano
  com acesso real à tabela, igual a qualquer break-glass hoje) que zera `purgeAttempts` e
  reescreve o ponteiro `PENDING`. Alarme dedicado (`document_purge_stuck_total > 0`) já proposto na
  Rodada 3 continua como o sinal que aciona essa ação manual — a diferença agora é que o estado
  em si sobrevive de forma consultável (`Scan`/relatório futuro por `purgeStatus = STUCK`), não só
  como uma métrica que pode se perder.
- Fencing da reconciliação: a query de lease expirado (`WORKSTATE#PURGE_CLAIMED`, `GSI6SK < now`)
  só devolve linhas cujo `GSI6SK` (que embute `claimExpiresAt`) já passou — a transação de
  devolução usa o mesmíssimo `expectedVersion`/`GSI6PK`/`GSI6SK` lidos nessa query como
  `extraConditions`, então uma execução antiga que "acorda" tarde e tenta finalizar depois de já
  ter perdido a lease falha essa condição (a reconciliação já rodou e mudou a versão) — nunca
  duas transações confirmam sobre o mesmo lease.

## Resolução achado 5 (discriminador de recibo)

Descartado "ausência de `cleanObject`/`quarantineObject`" como discriminador (correto, Codex —
não é seguro). Usar `entityType` (atributo comum a toda entidade,
`data-model.md` §1: "Atributos comuns... `entityType`") — já presente em toda linha, incluindo
`DocumentPurgeReceipt`. O worker lê o item completo (GSI6 é `ALL`-projected) e despacha por
`entityType` **antes** de montar a condição de claim:

- `entityType === "Document"`: claim usa as `extraConditions` do achado 3 (`legalHold`,
  `status = DELETED`, GSI6 esperado, `purgeAfter`), depois S3 pela lógica do achado
  "status apagado" acima, depois `Delete Document` + `Put DocumentPurgeReceipt`.
- `entityType === "DocumentPurgeReceipt"`: claim usa `extraConditions` própria (sem `status`,
  que este tipo não tem — só GSI6 esperado + `purgeAfter <= now`), sem nenhuma chamada S3, só
  `Delete` da própria linha.

Dois branches tipados dentro do mesmo `DocumentPurgeWorker`/mesma invocação agendada — "mesmo
worker" quer dizer mesmo deployable/mesma Lambda/mesmo agendamento, nunca "mesma função de claim
sem diferenciação de tipo" (a ambiguidade que a Rodada 3 apontou corretamente).

## Estado do design após Rodada 4

Todos os 5 achados bloqueantes da Rodada 3 endereçados com mudança concreta e verificável contra
o código real. Peço reavaliação — se algo ainda não fechar para ≥9.0, preciso do apontamento
exato, idealmente já indicando se é um achado genuinamente novo ou uma reabertura.
