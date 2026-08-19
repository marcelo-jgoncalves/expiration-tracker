# Crítica da proposta de Claude — Rodada 2

## Avaliação geral

A proposta tem boa cobertura temática e transforma várias decisões de arquitetura em responsabilidades, interfaces e critérios de aceite razoavelmente concretos. Ela é especialmente forte em segurança, disciplina de DAL, reconciliação de quotas, tratamento de resultado desconhecido de providers e explicitação dos workers.

Ainda assim, não considero o blueprint pronto para aprovação. Há falhas importantes no scheduler, inconsistências entre fronteiras modulares e transações, alguns mecanismos AWS descritos incorretamente e contradições no sequenciamento dos milestones. O problema mais sério é que o caminho crítico reminder → notification ainda pode perder trabalho.

**Nota: 7,6/10.** Requer nova rodada; não atende ao limiar 9,0.

## Problemas bloqueantes

### 1. O scheduler por GSI3 não é consultável como descrito

A proposta usa:

```text
GSI3PK = TENANT#t#DUE#yyyyMMddHHmm#NN
```

e afirma que o producer consulta os shards do minuto corrente. Isso não funciona globalmente: `Query` exige a partition key completa, inclusive `tenantId`. O producer não sabe quais tenants possuem ocorrências naquele minuto sem antes enumerá-los ou manter outro índice — o que elimina a vantagem do scheduler.

Esse erro também existia na minha proposta independente e precisa ser corrigido no merge, não relativizado.

Uma solução concreta seria:

```text
GSI3PK = DUE#yyyyMMddHHmm#NN
GSI3SK = TENANT#tenantId#OCCURRENCE#occurrenceId
```

O producer consulta os quatro shards globais daquele minuto. O item base continua tenant-scoped; apenas a chave do índice operacional constitui exceção à regra “toda chave começa com `TENANT#tenantId`”. Essa exceção deve ser explicitamente justificada no `data-model.md`, com:

- IAM restrito ao worker do scheduler;
- projeção mínima no GSI, sem conteúdo sensível;
- tenantId presente no item/SK para reconstrução segura do contexto;
- dimensionamento de shards conforme o pico global;
- regra para aumentar o número de shards sem tornar ocorrências antigas invisíveis;
- teste de isolamento que prove que nenhuma API tenant-facing consulta esse índice.

Alternativas possíveis são uma tabela operacional separada ou um diretório minute→tenants, mas ambas aumentam bastante a complexidade.

### 2. “Próximo tick reprocessa” é falso com consulta apenas ao minuto corrente

O `reminder-producer` aparece sem DLQ porque seria idempotente e “o próximo tick reprocessa”. Porém, no minuto seguinte ele consultaria outra chave. Uma falha durante o minuto `M` deixa `M` para trás.

É necessário escolher e especificar um mecanismo real:

- consultar uma janela de atraso, por exemplo `[now-5min, now]`;
- manter checkpoint/lease persistente;
- ou reconciliar continuamente ocorrências `DUE` ainda não publicadas.

Também é preciso definir a transição condicional de estado da ocorrência (`SCHEDULED → CLAIMED/PUBLISHED`) e como ocorre a recuperação de claims expirados. Idempotência por si só evita duplicação; ela não garante recuperação de trabalho perdido.

### 3. `ReminderTriggered` não é um evento meramente “reconstruível”

Esse evento inicia o envio ao usuário, mas foi classificado como EventBridge direto, sem outbox. Se a atualização da ocorrência for persistida e a publicação falhar, o lembrete pode desaparecer. Se a publicação ocorrer antes da persistência, pode haver duplicação ou estado inconsistente.

É preciso definir um protocolo atômico ou recuperável, por exemplo:

1. `TransactWriteItems` marca a ocorrência e cria um outbox;
2. o dispatcher publica em SQS;
3. consumidores deduplicam por `occurrenceId`;
4. o sweeper recupera outboxes vencidos.

Outra possibilidade é não marcar definitivamente a ocorrência até haver um registro persistido de dispatch. Em qualquer caso, “EventBridge direto porque é reconstruível” só seria defensável se a reconstrução automática estivesse especificada e testada.

### 4. Cancelar todas as ocorrências na mesma transação não escala

A proposta exige que `ItemDueDateChanged` e o cancelamento das ocorrências relacionadas aconteçam na mesma `TransactWriteItems`. Isso esbarra nos limites de 100 itens e 4 MB por transação e pressupõe que todas as occurrence IDs já sejam conhecidas. Uma política extensa, recorrências futuras ou vários canais podem ultrapassar facilmente esse limite.

O payload também inclui `cancelledOccurrenceIds[]`, que pode exceder o limite de tamanho do item/outbox/evento.

Uma solução mais robusta é invalidar por versão:

- o item recebe `itemVersion = N+1`;
- ocorrências antigas permanecem com `itemVersion = N`;
- producer e consumer recusam ocorrências cuja versão não corresponde à atual;
- um worker assíncrono cancela/remove ocorrências antigas em lotes;
- novas ocorrências são materializadas idempotentemente para `N+1`.

A transação crítica contém item + comando/outbox de rematerialização, não uma quantidade ilimitada de cancelamentos.

### 5. As fronteiras modulares se contradizem

No início, nenhum módulo pode acessar a tabela ou estado interno de outro. Depois:

- Expiration cancela `ReminderOccurrence` na própria transação;
- Notification revalida `ExpirationItem`;
- `retention-purge` atua sobre todos os módulos “via DAL”;
- a extração é atribuída a Document/Expiration;
- o outbox sweeper pertence simultaneamente a vários módulos.

Ou a fronteira é lógica, permitindo um transaction coordinator com operações DAL fornecidas pelos módulos, ou há isolamento estrito e essas transações cross-module não podem existir. O blueprint deve declarar:

- quem é dono de cada entidade;
- quem pode compor transações entre entidades;
- quais APIs internas são permitidas;
- se módulos compartilham um `UnitOfWork`;
- como a regra será verificada sem inviabilizar atomicidade.

“Preparar extração futura em serviços separados sem reescrita” também está superestimado: transações DynamoDB cross-module, chamadas síncronas internas e uma tabela compartilhada criam acoplamento que exigiria redesenho na extração.

## Erros ou imprecisões técnicas

### 6. “Lambda sem VPC” não significa sem egress

A proposta diz que uma Lambda sem VPC e sem permissões IAM de rede externa não possui egress. Isso é incorreto. Uma Lambda fora de VPC normalmente possui acesso de saída à internet; IAM não bloqueia conexões arbitrárias de rede.

Para realmente impedir egress, a função deve estar em subnets privadas sem NAT/IGW utilizável, com endpoints VPC estritamente necessários e controles adicionais de DNS/rede. Se precisar chamar AWS APIs, devem ser enumerados os endpoints necessários.

Também não se passa `--memory` a um container Lambda como se fosse `docker run`. Memória e timeout são configurações da função; CPU é proporcional à memória. Limite de páginas, tamanho expandido e timeout interno pertencem ao código/parser.

### 7. O alerta “ConsumedReadCapacity do shard” não existe nesse nível

CloudWatch fornece consumo por tabela/índice, não por valor individual de partition key. Para observar um shard lógico seriam necessários EMF/custom metrics, Contributor Insights ou telemetria explícita do producer.

Além disso, “duplicação manual dos shards” não é suficiente. Alterar de 4 para 8 shards exige versionamento da função de particionamento ou consulta simultânea de gerações antigas e novas; caso contrário, ocorrências já gravadas nos quatro shards antigos ficam invisíveis.

### 8. CSP com nonce não funciona apenas com uma response headers policy estática

CloudFront Response Headers Policy pode definir CSP estática, mas não gerar um nonce por resposta e inserir o mesmo nonce no HTML estático. As opções coerentes são:

- eliminar conteúdo inline;
- usar hashes CSP estáticos;
- ou gerar/transformar HTML dinamicamente, por exemplo com compute na borda/origem.

A proposta mistura política estática com nonce dinâmico sem explicar o mecanismo.

### 9. O envelope não representa corretamente EventBridge

`"specversion": "eventbridge-v1"` mistura conceitos de CloudEvents e EventBridge. EventBridge usa seu próprio envelope (`source`, `detail-type`, `id`, `time`, `detail`); CloudEvents usa `specversion: "1.0"`.

Deve ser escolhido um contrato claro:

- envelope de domínio dentro de `detail`; ou
- CloudEvents mapeado de forma documentada para EventBridge.

Caso contrário, producers, schema registry, testes e consumidores terão interpretações diferentes.

### 10. Audit precisa de recuperação, não “sem DLQ perdível”

“Sem DLQ perdível — falha aqui é crítica, alarme direto” não é uma estratégia de durabilidade. Alarmar não recupera eventos após o período de retry do EventBridge. Se auditoria é requisito de segurança, o consumidor deve ter target DLQ/arquivo recuperável, retry documentado e reconciliação.

Além disso, um consumidor único não torna a tabela append-only por si só. A garantia vem de IAM sem `UpdateItem/DeleteItem`, condições de escrita, eventual ledger/assinatura conforme requisito e retenção adequada.

### 11. A lógica de intent corretivo está semanticamente perigosa

Se uma notificação ainda não enviada está obsoleta, normalmente ela deve ser cancelada ou recalculada. Criar automaticamente um intent `CORRECTIVE` pode enviar ao usuário uma “correção” de algo que ele nunca recebeu.

É necessário distinguir:

- stale antes do primeiro envio: cancelar/substituir;
- envio confirmado e dado alterado depois: avaliar correção;
- resposta do provider `UNKNOWN`: não assumir nem sucesso nem falha e aguardar webhook/reconciliação;
- falha permanente antes da entrega: correção provavelmente não se aplica.

Também falta dizer como quiet hours alteram `scheduledAt`, e não apenas que são “checadas”.

### 12. Webhook inbox está subespecificado

“Grava inbox antes de processar” é correto para idempotência, mas faltam garantias importantes:

- preservar bytes exatos necessários à validação da assinatura;
- validar limites de tamanho antes de persistir;
- separar eventos inválidos/quarentena para evitar abuso de storage;
- fazer `PutItem` condicional por `providerEventId`;
- lidar com providers que não garantem ID globalmente único;
- criptografar e aplicar retenção curta ao payload bruto;
- não confiar em `tenantId`, account ou correlation data vindos do webhook sem mapeamento local.

O `rawPayloadRef: "s3://.../hash"` também é ambíguo: não se sabe se aponta para o payload ou apenas para um hash.

## Inconsistências de produto, domínio e sequenciamento

### 13. M0 não contém os recursos necessários para seu próprio critério de saída

M0 declara “itens 1–8” e exige CRUD básico de item. Mas as Lambdas CRUD estão no item 9. Portanto o milestone não pode satisfazer seu critério de saída.

Há outras inconsistências:

- M2 diz completar o item 3, embora buckets já estejam na fundação;
- M3 posterga o hardening, embora a seção 4 diga que ele existe desde o primeiro deploy;
- observabilidade só chega em M4, deixando M0–M3 sem alarmes suficientes;
- WAF está depois da API e simultaneamente marcado “antes da exposição pública”;
- AppConfig/kill switches chegam depois dos componentes que deveriam nascer usando-os.

### 14. A autenticação está duplicada ou mal separada

A proposta inclui:

- API Gateway com Cognito authorizer;
- módulo Identity validando JWT;
- “Lambda de autenticação/autorização”.

É necessário distinguir autenticação no edge de autorização no domínio. Se API Gateway valida JWT, o backend deve validar/tratar claims confiáveis recebidas no contexto e resolver identidade/tenant; não deveria haver necessariamente uma Lambda Identity separada.

Para workers assíncronos, não existe JWT. O `tenantId` deve vir de um registro/evento persistido e confiável, ser validado contra a chave do item e propagado em um contexto de sistema. A afirmação “tenantId é derivado uma única vez no middleware de autenticação” não cobre esses workers.

### 15. `authorize(...)->boolean` é insuficiente para autorização por recurso

Uma matriz `action × resourceType` evita permissões ausentes, mas não prova que a instância pertence ao tenant nem trata estados e relações do recurso. É preciso combinar:

- permissão coarse-grained por ação/tipo;
- chave tenant-scoped gerada internamente;
- leitura/condição que torne impossível acessar outro tenant;
- regras por estado, ownership ou role quando aplicáveis;
- tratamento consistente entre API e workers.

Retornar apenas `boolean` também perde a causa da decisão e dificulta auditoria; uma decisão tipada seria melhor.

### 16. O modelo de deleção está ambíguo

Há `archiveItem` e `deleteItem (soft delete)` sem diferenças de estado, efeitos sobre reminders, retenção, restauração ou unicidade. Se ambos existem, o blueprint deve especificar suas máquinas de estado e consequências.

### 17. O blueprint ainda não fecha detalhes essenciais do single-table

Apesar de citar o `data-model.md`, faltam contratos implementáveis para:

- chaves de outbox e consulta dos `PENDING`;
- índices e transições de `ReminderOccurrence`;
- condição idempotente de criação de intent/attempt;
- materialização por policy version;
- itens do webhook inbox;
- paginação e backpressure dos jobs;
- comportamento do GSI6 durante purge;
- limites de transação e tamanho dos itens.

Sem uma matriz “operação → PK/SK/GSI → condição → consistência → paginação”, o DAL continua sujeito a interpretações incompatíveis.

## Pontos em que Claude foi melhor ou mais preciso

Há partes em que esta proposta foi mais forte do que a minha abordagem inicial:

- A separação explícita entre antimalware e limites defensivos do parser é correta e importante. GuardDuty não substitui isolamento contra consumo abusivo de CPU/memória.
- O reconciliador de `UploadSlot`, em vez de depender apenas de TTL, é um refinamento operacional muito bom. TTL do DynamoDB não é pontual nem adequado como mecanismo único de restituição de quota.
- O estado `UNKNOWN` para providers é preciso e evita a falsa equivalência “timeout = falha”.
- O uso de `value_ref` para recipient reduz a replicação de telefone/e-mail em intents e filas, embora ainda seja necessário definir resolução e redaction.
- A exigência de adapters com contract tests e distinção entre falha permanente/transitória é mais implementável do que uma descrição genérica de canais.
- O redactor central acompanhado de fixtures para logs, traces, eventos e DLQ é mais concreto do que simplesmente declarar “não logar PII”.
- O pinning por SHA/digest, SBOM e `npm ci` transforma supply-chain hardening em controles verificáveis.
- A proposta admite três lacunas próprias no final. Essa auto-crítica é útil, embora não cubra os problemas mais graves do scheduler e da durabilidade do dispatch.

## Alterações mínimas para a próxima rodada

Antes de um merge aprovável, eu exigiria:

1. corrigir a chave/consulta do scheduler e documentar a exceção global do GSI;
2. definir lookback, checkpoint ou lease para minutos perdidos;
3. tornar o dispatch de reminders atomicamente recuperável;
4. substituir cancelamento transacional ilimitado por invalidação por versão e limpeza em lotes;
5. resolver formalmente a contradição entre ownership modular e transações cross-module;
6. corrigir as afirmações sobre egress de Lambda, métricas por shard e CSP nonce;
7. adicionar DLQ/replay ao audit e aos eventos críticos;
8. corrigir a semântica de stale/corrective notifications;
9. reorganizar milestones para que segurança mínima e observabilidade acompanhem cada entrega;
10. adicionar uma matriz de access patterns e contratos de idempotência/transição por entidade.

A proposta é uma base útil, mas esses pontos afetam correção e durabilidade do produto, não apenas nível de detalhe documental.
