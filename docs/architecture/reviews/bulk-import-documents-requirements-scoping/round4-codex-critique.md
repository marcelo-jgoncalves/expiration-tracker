# Rodada 4 - Crítica Codex

A régua v3 permanece fechada. Avalio somente o design.

## 1. Wiring do disparo assíncrono — PARCIAL

O destino real foi corretamente definido: novo literal em `OutboxDestination`, sender registrado no relay, fila/DLQ, IAM e event source fecham a lacuna original. A leitura de `outbox.ts` e `relay.ts` confirma que esses são exatamente os pontos necessários para um destino ser consumido.

Resta uma falha de concorrência: estado permitido não constitui idempotência. O `parseImportJob()` atual lê o job e depois faz um `update` não condicional; duas entregas simultâneas podem observar o mesmo estado elegível e ambas executar o parse. Além disso, o handler atual entende apenas o envelope S3/EventBridge, enquanto a mensagem direta do outbox terá outro formato. O design precisa especificar:

- discriminação e validação dos dois envelopes;
- claim atômico condicional do estado elegível para `PARSING`, com apenas um vencedor.

## 2. Contrato de `/schema` — PARCIAL

Fechados: descarte do registro cortado, limite explícito do header e uso de decodificação UTF-8 fatal.

Ainda há duas lacunas:

- `objectETag` meramente informativo não vincula o objeto inspecionado ao posteriormente processado. `planSha256` e `columnMappingSha256` protegem outros artefatos, não provam que o parse usou o mesmo objeto observado por `/schema`. O ETag/versionId deve ser persistido e conferido no parse, ou a leitura deve usar precondição equivalente.
- Um Range de 64 KiB pode terminar no meio de uma sequência UTF-8 válida; `TextDecoder(..., { fatal: true })` sobre esse fragmento a rejeitaria falsamente. A leitura parcial precisa tolerar somente a sequência final incompleta, continuando a rejeitar bytes realmente inválidos.

Também convém não devolver `HEADER_TOO_LARGE` quando o header terminou, mas apenas a primeira linha de amostra não coube no range.

## 3. `canonicalJsonStringify` — FECHADO

O contrato agora cobre recursão em todos os objetos, preservação semântica da ordem de arrays, primitivas e rejeição explícita dos tipos não suportados. É determinístico para o único call site declarado.

## 4. `externalId` e chaves DynamoDB — PARCIAL

O limite de 200 bytes, validação duplicada em schema e serviço, `trim()` sem outra normalização e rejeição explícita de controles são decisões claras.

A leitura direta confirma:

- `checkControlChars()` existe em `import-row.ts`, embora atualmente seja privado;
- não há precedente de `encodeURIComponent` para componentes de chave DynamoDB — os usos reais são em URL/S3;
- também não encontrei precedente geral de rejeição de `#` em valor fornecido pelo usuário antes da composição de chave.

Rejeitar `#` é uma política válida, mas a justificativa de que ele necessariamente causaria colisão é excessiva: como sufixo opaco de `EXT#${externalId}`, ele não gera por si só colisão entre externalIds distintos. Mais importante, o ponto pedia limites para os componentes de chave; a resposta fixa somente `externalId`, sem declarar limites/alfabeto dos demais componentes interpolados (`subjectId`, nomes normalizados etc.). O escopo deve ser explicitamente restringido a componentes controlados pelo sistema ou completar o contrato deles.

## Veredito

O destino de outbox deixou de ser bloqueante, mas o design ainda não converge: faltam claim atômico do parse e vínculo autoritativo entre o objeto observado por `/schema` e o objeto efetivamente processado. Como resta apenas uma rodada, esses são os dois ajustes indispensáveis; os demais podem ser fechados declarativamente.

Não aprovo o design nesta rodada.

**Nota Codex (cega), Rodada 4 - design: 8.8/10.**
