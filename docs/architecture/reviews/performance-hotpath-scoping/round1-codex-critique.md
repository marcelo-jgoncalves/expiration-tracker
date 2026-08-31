## Rodada 1 — Crítica Codex

**Resultado: NÃO APROVADO nesta rodada.**

A direção geral é boa e o diagnóstico do waterfall frontend está bem sustentado pelo código. Porém, D‑D não preserva integralmente as garantias atuais, e o checklist E‑014 ainda não atende ao formato normativo exigido pelo próprio projeto.

### Achado bloqueante — D‑D não é uma substituição equivalente

Um `UpdateItem` condicional pode oferecer uma garantia correta de limite concorrente para **um único item**:

```text
incrementar somente se count < limit
```

DynamoDB avalia atomicamente a condição e a atualização desse item. Portanto, múltiplas requisições concorrentes não conseguem todas observar o mesmo valor e ultrapassar silenciosamente o limite. Isso elimina a corrida clássica do `Get → compute → Put`.

Mas a transação atual protege duas propriedades diferentes:

1. Não exceder o contador sob concorrência.
2. Consumir quota somente se o `TenantLifecycleRecord` continuar `ACTIVE` no mesmo ponto de linearização.

O segundo contrato vem de `executeTenantBusinessMutation()`, que adiciona um `ConditionCheck` sobre outro item. Um `UpdateItem` isolado não consegue preservar atomicamente essa condição cross-item. `TransactWriteItems` existe justamente para completar ou rejeitar conjuntamente o update e esse check. [AWS — TransactWriteItems](https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_TransactWriteItems.html)

Logo:

- `UpdateItem ADD` simples: **não equivalente nem para o limite**, porque não contém teto.
- `UpdateItem` com condição `count < limit`: equivalente quanto a **não ultrapassar o contador**.
- Esse mesmo update isolado: **não equivalente ao contrato W3‑07/lifecycle** hoje aplicado.

A corrida concreta é:

```text
RequestContext observa ACTIVE
→ tenant muda para DELETING
→ UpdateItem isolado cria/atualiza TenantQuota depois da transição
```

Isso não permite necessariamente que uma request futura atravesse o `RequestContextResolver`, mas viola a fronteira estrutural já aprovada e pode recriar dado tenant-scoped durante/depois da purga. A proposta precisa escolher explicitamente entre:

- manter o fence transacional;
- redefinir `API_REQUEST` como telemetria efêmera fora da lane de business mutations, com TTL e reconciliação de purge;
- ou mover esse contador para uma estrutura dedicada cujo ciclo de vida não dependa do registro tenant-scoped atual.

Não se pode retirar o fence incidentalmente como mera otimização.

### Não há bypass concorrente se o update for desenhado corretamente

Para a garantia antiabuso, um único update condicional é suficiente, desde que tenha todos estes elementos:

- incremento atômico;
- condição atômica de teto;
- inicialização segura do primeiro contador;
- janela representada sem corrida de reset;
- tratamento conservador de falha ambígua;
- preservação explícita do kill switch.

A AWS documenta tanto o incremento atômico quanto a combinação com `ConditionExpression`. Também alerta que contadores atômicos não são idempotentes: uma resposta perdida seguida de retry pode contar a mesma request duas vezes. [AWS — Atomic counter operations](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/example_dynamodb_Scenario_AtomicCounterOperations_section.html), [AWS — Working with items](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/WorkingWithItems.html)

Esse erro é **fail-closed**: produz sobrecontagem ou um 429 antecipado, não permite martelar a API acima do teto. Para uma defesa antiabuso aproximada, isso é aceitável; para billing, crédito financeiro ou limite comercial forte, não seria.

A transação atual também não torna automaticamente uma request inteira idempotente diante de timeout após commit. Portanto, essa diferença não é, por si só, argumento para manter `Get + TransactWriteItems`.

### A janela `"current"` não deve ser mantida

O desenho atual usa um item estável e decide reset comparando `resetAt`. Reproduzir isso em um único update torna a expressão e a concorrência na fronteira da janela desnecessariamente difíceis.

A emenda recomendada é usar bucket temporal na chave:

```text
TYPE#API_REQUEST#<floor(epochSeconds / 60)>
```

Cada nova janela ganha um item novo. O update pode então fazer conceitualmente:

```text
SET count = if_not_exists(count, 0) + 1
CONDITION attribute_not_exists(count) OR count < :limit
```

Mais:

- TTL para remover buckets antigos;
- `limit`, `windowSeconds` e metadados definidos de forma consistente;
- kill switch avaliado antes do update ou incorporado a uma decisão separada, sem depender de um campo antigo do bucket;
- `ConditionalCheckFailedException` traduzida em 429;
- erros DynamoDB/throttling tratados como dependência indisponível ou fail-closed, nunca interpretados automaticamente como “quota excedida”.

Isso elimina `Get`, retry de OCC e corrida de reset. Não elimina o hot key por tenant — ele continua sendo o ponto deliberado de serialização da quota.

### API Gateway é somente a camada coarse

A proposta está correta ao não tratá-lo como substituto da quota tenant-aware. O throttling de HTTP API é por conta/região, stage ou rota, e a própria AWS o define como best effort/target, não como teto garantido. Não oferece justiça por tenant autenticado. [AWS — HTTP API throttling](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-throttling.html)

Há ainda uma inconsistência quantitativa a resolver: a infraestrutura atual usa `rate=25`, `burst=50`, enquanto a aplicação usa `100/60s` por tenant. O throttle global pode limitar todos os tenants antes que qualquer tenant alcance sua quota individual. Isso pode ser desejado para proteger capacidade, mas deve ser declarado e calibrado; não é uma composição neutra.

### Avaliação das demais decisões

- **D‑A — aprovada conceitualmente com emenda.** A unificação remove o waterfall real. TanStack Query compartilha cache por `queryKey`, e `staleTime` evita refetches de dados ainda frescos. [TanStack Query — Query keys](https://tanstack.com/query/latest/docs/framework/react/guides/query-keys), [TanStack Query — QueryClient](https://tanstack.com/query/latest/docs/reference/QueryClient). Em logout/logout-all, prefiro remover/limpar imediatamente os dados de sessão e caches tenant-scoped, não apenas invalidá-los. Em 401, o estado deve transicionar deterministicamente para não autenticado.
- **D‑B — aprovada com condição.** O touch precisa ser um update condicional que não ressuscite sessão revogada/expirada. O threshold exato pode ficar para benchmark, mas a condição de existência/estado/expiração faz parte do design.
- **D‑C — direção válida, ainda subespecificada.** `createProfileIfAbsent()` parece removível do hot path. Já `onboarding.resolve()` não pode sair antes de mapear quais consumidores do `RequestContext` dependem de seu resultado. A membership `ACTIVE` e lifecycle `ACTIVE` continuam obrigatórios em cada request.
- **D‑E — aprovada com emenda.** O contrato precisa especificar cursor opaco, ordem determinística com desempate estável, limite máximo imposto pelo servidor e resposta `nextCursor`. “Handler exigir limit” não deve permitir que o cliente escolha um valor ilimitado.

### Contestação formal do checklist E‑014

O checklist apresentado não está estável porque:

- não possui pesos;
- não traz âncoras objetivas de atende/não atende;
- não informa data de acesso;
- não justifica representatividade;
- usa Medium/OneUptime para uma decisão de segurança mesmo havendo documentação primária da AWS;
- não inclui o critério mais importante revelado pelo código: preservação explícita do fence W3‑07;
- não inclui semântica de janela, idempotência/falha ambígua, kill switch e cleanup por TTL.

Minha sub-rubrica reconciliada sugerida para a próxima rodada:

1. **30% — Isolamento concorrente:** nenhuma execução aceita após o teto da janela.
2. **25% — Lifecycle/W3‑07:** preserva o fence ou aprova explicitamente uma nova classificação e estratégia de purge.
3. **15% — Janela e reset:** fronteira de janela não permite bypass nem reset perdido.
4. **10% — Falhas e retries:** comportamento fail-open/fail-closed e sobrecontagem estão documentados.
5. **10% — Defesa em camadas:** API Gateway permanece coarse e o limite tenant-aware continua efetivo.
6. **10% — Operabilidade:** TTL, observabilidade de 429, hot-key/capacity e kill switch possuem contrato verificável.

### Notas cegas desta rodada

- **Régua/checklist:** 6,4/10
- **Design contra a régua apresentada:** 7,6/10

A resposta direta à pergunta é: **um `UpdateItem` condicional é equivalente para impedir overshoot concorrente do contador, mas não é equivalente ao mecanismo atual completo, porque perde o fence atômico de lifecycle.** A não idempotência e possível sobrecontagem são aceitáveis para uma quota antiabuso fail-closed; a perda silenciosa do fence W3‑07 não é aceitável sem uma decisão arquitetural explícita.
