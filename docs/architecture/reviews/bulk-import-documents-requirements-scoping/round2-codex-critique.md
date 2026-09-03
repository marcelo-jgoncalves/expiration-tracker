# Rodada 2 - Crítica Codex

## 1. Estabilidade da régua v2

A régua v2 está substancialmente melhor que a da Rodada 1. Ela corrige a generalização indevida da pesquisa, separa a escolha interna “um tipo por job” da política de referências e promove atomicidade/idempotência ao maior peso.

Ainda não a considero plenamente estável por três razões:

1. O critério 1 mistura dois resultados relacionados, mas distintos: atomicidade da linha bem-sucedida e persistência idempotente do resultado de uma linha rejeitada durante o commit.
2. O critério 7 recebe 10% apesar de ser uma escolha de simplificação já tomada, não um risco dominante. Parte desse peso deveria cobrir integridade do plano/resultado e protocolo de progresso terminal.
3. Ao retirar completamente o antigo critério de contrato de schema/API, a régua deixa o endpoint `/schema`, os tipos de mapping e seus limites sem cobertura suficiente. Isso permitiu que o achado 12 permanecesse quase inteiro fora da nota.

Minha sugestão para a Rodada 3:

- 25% atomicidade, idempotência e progresso por linha;
- 15% orquestração concorrente upload/mapping/parse;
- 15% identidade e resolução de referências;
- 15% fences de invariantes no commit;
- 10% dedupe e colisões;
- 10% integridade/proveniência do plano e resultado;
- 5% contrato de mapping/schema;
- 5% um tipo por job e compatibilidade com o esqueleto existente.

A régua atual é utilizável, mas ainda permite nota alta para um design que não explica como persiste uma falha de linha nem como o cursor avança depois que a transação foi cancelada.

## 2. Verificação do código citado

A inspeção direta confirmou:

- `TrackedSubject` não possui `externalId`.
- `CreateSubjectInput` também não possui `externalId`.
- `createSubject()` atualmente monta internamente a entidade, contador de entitlement e auditoria, com retry de contenção.
- `createDocument()` possui somente o `ConditionCheck` de `DocumentType ACTIVE`; não verifica o `TrackedSubject`.
- `createRequirement()` já contém fence transacional de Subject, pointer de nome e classificação estrutural de cancelamentos.
- O import atual possui apenas `TrackedSubject`, `mappingVersion`, `lastCommittedRowNumber` e mapping fixo.
- O commit atual realmente executa claim, criação e cursor em writes separados, incluindo placeholder `subjectId: ""`.
- O parse atual faz lookup individual do `ImportDedupRecord`.
- `executeTenantBusinessMutation()` acrescenta o fence do tenant como última entrada e converte especificamente sua falha em `TenantNotActiveError`.
- Não encontrei precedente de `encodeURIComponent` sendo usado dentro de uma chave DynamoDB. Os usos localizados são principalmente URLs/tokens.
- O repositório está em `develop`; os artefatos desta revisão estão não rastreados, mas nenhuma alteração foi feita por mim.

## 3. Julgamento dos 16 achados

| # | Estado | Avaliação |
|---|---|---|
| 1 | Parcial | `AWAITING_MAPPING` é a direção correta, mas a corrida ainda não foi fechada. O parse pode ler `UPLOADED` sem mapping enquanto o POST grava o mapping; depois, o update stale do parse pode sobrescrever o item inteiro. Todas as transições precisam de OCC e de um protocolo de releitura/reconciliação. Chamar o parse inteiro sincronamente no handler também introduz risco de timeout e acoplamento HTTP. |
| 2 | Parcial | A transação única fecha o caminho de sucesso, mas o caminho de falha de negócio é internamente impossível como descrito: quando um `ConditionCheck` falha, o cursor na mesma transação não avança. É necessária uma transação alternativa que grave resultado de falha + cursor sob OCC. |
| 3 | Parcial | `externalId` no Subject e pointer dedicado corrigem a identidade estrutural. Porém “administrável fora de import” não está desenhado: só a criação foi mencionada; update, remoção/troca do pointer, conflito e lifecycle permanecem indefinidos. |
| 4 | Fechado no design | O fence de Subject em `createDocument()` é necessário e está corretamente colocado na mesma transação. A classificação por posição deve preferencialmente usar labels, como `createRequirement()`, e não índices literais frágeis. |
| 5 | Fechado | `schemaVersion` e autoridade única em `job.targetEntityType` resolvem a duplicação e o campo morto. |
| 6 | Parcial | A chave sintética resolve retry sem `externalId`. Entretanto o texto chama `ImportDedupRecord` de “scoped ao job”, enquanto as chaves com `externalId` são duráveis e cross-job; só a chave sintética é job-scoped. O contrato deve distinguir essas duas funções. |
| 7 | Parcial | Builders por entidade e `trim()`/case sensitivity são melhorias. Faltam limites de comprimento, canonicalização formal e validação dos componentes. O precedente alegado de `encodeURIComponent` em SK não foi confirmado. |
| 8 | Parcial | As estruturas `seen*` estão definidas, mas há contradição: “segunda ocorrência é rejeitada” e “as duas linhas são rejeitadas” não são o mesmo comportamento. Um algoritmo one-pass naturalmente aceita a primeira e rejeita a segunda; rejeitar ambas requer pré-contagem ou revisão retroativa do plano. |
| 9 | Fechado | Separar ID de display name e resolver display name pelo pointer existente é consistente. O ID resolvido no plano mais fence de status no commit fecha rename/deprecate TOCTOU. |
| 10 | Parcial | Hash no job e manifest melhora a proveniência, mas depende de transições OCC que ainda não foram especificadas. Também falta canonicalização do objeto antes de calcular `columnMappingSha256`; serialização JSON não deve ficar implicitamente dependente da ordem de propriedades recebidas. |
| 11 | Aberto | `Record<string,string>` continua exatamente permissivo. Validação contra `FIELD_CATALOG` em runtime ajuda, mas não é o tipo discriminado solicitado e não representa `subjectRefKind`/`documentTypeRefKind` de modo estruturalmente seguro. |
| 12 | Aberto | `/schema` continua sem contrato suficiente: resposta, charset/BOM, tamanho/header limits, arquivo ainda ausente, checksum/identidade do objeto, autorização e comportamento concorrente não foram definidos. “GET idempotente” não resolve esses pontos. |
| 13 | Parcial | BatchGet elimina o N+1, mas um pointer exige depois buscar a entidade apontada. Portanto podem ser duas fases de BatchGet, não “até 50 chamadas” no pior caso. Também faltam retry de `UnprocessedKeys`, deduplicação entre fases e limites de memória/resposta. |
| 14 | Parcial | A taxonomia conceitual melhorou, mas `COMMIT_FAILED` não pode ser “registrado no plano” sem mutar/regravar o plano S3 que foi tratado como imutável. Não existe entidade/estrutura de resultado definida. O avanço do cursor após cancelamento também exige uma segunda transação. |
| 15 | Parcial | IDs resolvidos e `dedupKeyUsed` melhoram a explicabilidade do preview. Ainda falta proveniência do resultado do commit: sucesso, falha, código estável, timestamp e eventual entity ID criado. |
| 16 | Fechado | A linguagem agora representa corretamente uma decisão de escopo desta fatia. |

Resumo: 4 achados fechados de verdade (`4`, `5`, `9`, `16`), 10 parcialmente resolvidos e 2 ainda abertos (`11`, `12`).

## 4. Achados remanescentes ou novos, por severidade

### Bloqueantes

1. **Não existe protocolo executável para falha de linha.** A transação contendo criação, claim e cursor é cancelada integralmente por um fence. Para continuar, o worker precisa executar uma transação alternativa contendo, no mínimo, resultado durável da linha + avanço OCC do cursor + tenant fence. Sem isso, a linha falha indefinidamente ou o cursor é avançado por write separado sem resultado confiável.

2. **A corrida mapping/parse ainda admite lost update.** O store atual faz `PutCommand` incondicional do item inteiro. O desenho precisa exigir OCC tanto em `UPLOADED → AWAITING_MAPPING` quanto em `UPLOADED/AWAITING_MAPPING → PARSING`, com releitura após conflito. O estado não pode ser derivado de uma leitura stale.

3. **O refactor de `createSubject()` não é mecânico como alegado.** Hoje ele possui leitura/criação de entitlement, quota check e até 20 retries. Um builder puro com `entitlement` ausente da assinatura não consegue reproduzir esse comportamento. O design deve dizer quem lê o entitlement, como fixa sua versão, quando gera novo ID e como reconstrói a transação após contenção sem confundir colisão do claim com retry técnico.

### Altos

4. **`COMMIT_FAILED` não tem armazenamento definido.** O plano S3 é apresentado como congelado e protegido por hash; não pode simultaneamente receber resultados de commit. É necessário um ledger/relatório separado ou estado por linha com contrato explícito.

5. **Lifecycle de `Subject.externalId` está incompleto.** É preciso decidir se é imutável. Se for editável, `updateSubject()` deve trocar/remover pointers atomicamente, com OCC e colisão classificável. Se for create-only, não deve ser descrito como administrável para Subjects existentes.

6. **Execução síncrona do parse pelo endpoint de mapping é uma regressão arquitetural potencial.** Parse inclui leitura de até 5 MiB, até 5.000 linhas, BatchGets, quota e escrita S3. O endpoint deveria produzir um sinal durável/idempotente para o worker, ou limitar-se a uma transição que um mecanismo assíncrono garantido consome.

7. **A classificação posicional precisa sobreviver à composição.** `createRequirement()` já usa labels estruturais porque índices literais quebram quando entries são adicionadas. Os três builders deveriam retornar entries acompanhadas de labels/códigos de falha, especialmente porque import acrescenta claim e cursor.

8. **O contrato de `/schema` permanece insuficiente**, inclusive quando o job ainda está `UPLOADED` mas o objeto não existe.

### Médios

9. `ColumnMapping` continua permissivo e deveria ser uma união discriminada por `targetEntityType`/`schemaVersion`, ainda que o target continue autoritativo no job.

10. A resolução em lote precisa especificar duas fases pointer→entity, retry de `UnprocessedKeys` e validação de que o pointer continua correspondendo à entidade esperada.

11. A política intra-arquivo deve escolher explicitamente entre “first wins” e “reject all colliding rows”.

12. O hash do mapping precisa de serialização canônica definida.

13. Limites e encoding das chaves de integração precisam ser parte do contrato, não apenas `encodeURIComponent`.

## 5. O que falta para a Rodada 3

Para atingir 9.0, a próxima revisão precisa, no mínimo:

- desenhar as duas transações por resultado: sucesso e falha de linha, ambas avançando o cursor atomicamente com um registro durável;
- definir onde vivem os resultados de commit, sem alterar o plano congelado;
- tornar todas as transições mapping/parse OCC-safe e retirar ou justificar formalmente o parse síncrono no handler;
- detalhar o fluxo de entitlement/retry de `buildCreateSubjectEntries`;
- decidir o lifecycle de `Subject.externalId`;
- fechar o contrato de `/schema` e tipar `ColumnMapping`;
- corrigir a contagem e a semântica dos BatchGets;
- escolher inequivocamente a política de colisão intra-arquivo.

Não aprovo ainda régua e design no gate conjunto de 9.0 sem arredondamento.

**Nota Codex (cega), Rodada 2 - régua: 8.7/10.**  
**Nota Codex (cega), Rodada 2 - design: 7.8/10.**
