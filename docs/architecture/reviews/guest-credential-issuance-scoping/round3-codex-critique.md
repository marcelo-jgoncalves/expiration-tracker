# Round 3 — Codex critique

NOTA: 8,1/10

A Rodada 3 corrige de verdade os dois defeitos centrais anteriores: `issuanceGeneration` torna a reemissão representável e o token bruto deixa a tabela compartilhada. Ainda não alcança 9,0 porque restam três gaps concretos de engenharia — um deles crítico.

1. O dual-write DynamoDB → SQS perde notificações permanentemente.

A sequência proposta é:

1. commita credencial + idempotência + pointer;
2. executa `SendMessage`;
3. se o envio falhar, apenas alarma.

Depois do commit, qualquer retry encontra o `IdempotencyRecord` e é tratado como replay seguro. Portanto, ele não tenta novamente o `SendMessage`. O resultado é uma credencial válida cujo token nunca poderá ser recuperado nem entregue.

Isso não é equivalente a “fila pronta antes do consumidor existir”. Uma mensagem já persistida aguarda consumidor; aqui, a mensagem pode nunca ser persistida. Alarme também não é mecanismo de recuperação, especialmente porque o token bruto foi deliberadamente tornado irrecuperável.

Para fechar:

- ou persistir material de entrega cifrado em store dedicado, com IAM/CMK exclusivos, e usar outbox/reconciliação;
- ou inverter o protocolo para tornar a mensagem SQS durável antes do commit e fazer o consumidor validar que a credencial correspondente existe e continua ativa antes de entregar, aceitando/deduplicando mensagens órfãs;
- ou especificar outro protocolo que prove ausência de perda nos crash points entre DynamoDB, SQS e ACK.

DLQ, retries nativos e alarme não resolvem o crash/falha antes de `SendMessage` concluir.

2. O fencing do consumidor continua incompleto.

A Rodada 2 exigiu que o commit cercasse simultaneamente geração, estado live, versão e pointer esperado. A resposta adiciona somente:

```text
issuanceGeneration = :expectedGeneration
```

Isso não impede emissão quando a request mudou para estado terminal sem incrementar a geração, nem prova que o pointer observado ainda é o esperado. A `ConditionExpression` do `DocumentRequest` precisa incluir, no mesmo commit:

- `issuanceGeneration = :expectedGeneration`;
- estado ainda elegível para emissão;
- `version = :expectedVersion`, se versão participa da decisão;
- `activeCredentialSelectorHash` ausente ou igual ao valor esperado;
- transição explícita do pointer.

Falha condicional não deve ser classificada como “evento obsoleto” apenas pelo índice da operação: é necessário reler consistentemente a request e distinguir estado obsoleto de corrupção/invariante violada.

3. A condição de revogação contradiz a idempotência alegada.

Foi especificado:

```text
attribute_not_exists(revokedAt) OR revokedAt = :sameRevokedAt
```

junto de:

```text
SET revokedAt = if_not_exists(revokedAt, :now)
```

Se o retry calcula um novo `:now`, uma credencial já revogada com timestamp anterior não satisfaz `revokedAt = :sameRevokedAt`. Logo, a segunda tentativa pode falhar — exatamente o contrário do texto.

Para idempotência real, basta condicionar pertencimento e selector:

```text
documentRequestId = :did AND selectorHash = :sel
```

e aplicar:

```text
SET revokedAt = if_not_exists(revokedAt, :now)
```

sem exigir igualdade com o timestamp da tentativa atual. Alternativamente, o timestamp original precisa ser determinístico e carregado pelo comando.

Os demais pontos estão satisfatoriamente resolvidos: identidade por geração, proteção contra replay indevido, isolamento do token em relação às roles tenant-facing, idempotência de criação com `payloadHash`, recusa de credencial já vencida e reclassificação honesta do TTL.

O gap impeditivo principal é o primeiro. Enquanto uma falha normal entre o commit DynamoDB e `SendMessage` produzir uma credencial permanentemente impossível de entregar, o desenho não atende Reliability & Fault Recovery nem Event & Integration Correctness. Após fechar esse protocolo e completar as condições transacionais acima, não vejo outra lacuna arquitetural necessária para aprovação; o TTL definitivo e a política de chasing podem permanecer como pendências de produto já nomeadas.
32.267
NOTA: 8,1/10
