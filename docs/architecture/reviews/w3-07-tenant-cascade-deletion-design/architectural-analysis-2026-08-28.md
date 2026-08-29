# Expiration Tracker — Análise do impasse W3-07

## Fence de exclusão de tenant, recovery de efeitos externos e protocolo claim/outcome

**Data:** 2026-08-28  
**Contexto:** W3-07 — exclusão física de tenant / DSR / LGPD  
**Base da análise:** prompt externo `external-review-prompt.md` (mesma pasta), estado atual descrito do projeto e comportamento dos fluxos reais de Step Functions, Textract, Bedrock e S3.

---

# 1. Conclusão principal

O problema identificado no W3-07 é real, mas a arquitetura atual parece estar tentando resolver uma exigência mais forte do que o caso de exclusão de tenant necessariamente precisa.

O dilema foi corretamente identificado:

- bloquear novo trabalho depois do início da exclusão;
- não quebrar redelivery, idempotência e recovery de trabalho iniciado anteriormente.

Porém, a tentativa mais recente parece assumir implicitamente que:

> Mesmo depois de o tenant entrar em exclusão, os workflows já iniciados precisam continuar preservando sua liveness normal e concluir como se o tenant ainda estivesse ativo.

Essa premissa deve ser questionada.

A recomendação central desta análise é:

> **`ACTIVE → DELETING` deve funcionar como uma barreira de cancelamento do trabalho do tenant.**

A partir desse instante, o sistema não precisa garantir que OCR, Bedrock, Step Functions ou outros workflows de negócio terminem normalmente.

A garantia mais importante passa a ser:

> Um trabalho que já começou pode eventualmente terminar fora do controle da aplicação, mas não pode mais produzir, persistir ou ressuscitar estado do tenant.

Essa mudança de semântica simplifica substancialmente o problema.

---

# 2. Semântica recomendada para o lifecycle

Modelo conceitual:

```text
ACTIVE
   ↓ solicitação de exclusão
DELETING
   ↓ quiescence + purge + proof
DELETED
```

A transição:

```text
ACTIVE → DELETING
```

deve ser tratada como o **linearization point** da exclusão.

Antes dessa transição:

- comportamento normal;
- retry;
- redelivery;
- idempotência;
- recovery;
- novas operações do tenant;
- continuidade dos workflows.

Depois dessa transição:

```text
nova mutação de negócio        → DENY
novo ExtractionRun             → DENY
novo Textract                  → DENY
novo Bedrock                   → DENY
novo workflow                  → DENY
callback atrasado              → ACK / DISCARD
resultado externo tardio       → DISCARD
novo objeto S3 do tenant       → DENY
recovery de business workflow  → CANCEL / NO-OP
purge/lifecycle housekeeping   → ALLOW
```

As operações do próprio mecanismo de exclusão são diferentes de mutações normais do tenant e precisam possuir um caminho explicitamente autorizado.

---

# 3. Por que a tentativa anterior trava

O problema encontrado pelas revisões adversariais é legítimo.

## 3.1 Step Functions

Hoje o fluxo de `start-extraction-run.ts` persiste o `ExtractionRun` e depois chama `StartExecution`.

Em uma redelivery, a chamada ao Step Functions pode ocorrer novamente mesmo quando o `ExtractionRun` já existe.

Isso é desejável.

Exemplo:

```text
persist ExtractionRun
        ↓
commit DynamoDB
        ↓
StartExecution
        ↓
erro transitório / timeout
```

Na nova entrega:

```text
ExtractionRun já existe
        ↓
StartExecution novamente
```

Isso recupera o workflow.

Uma regra ingênua como:

> "Só faça o efeito externo se uma escrita fenced desta invocação tiver acabado de vencer"

quebra esse recovery.

---

## 3.2 Textract

O mesmo princípio aparece no OCR.

A reserva de quota já existente não impede necessariamente uma nova tentativa do efeito externo.

Isso permite que uma redelivery recupere um caso em que:

```text
quota reservada
        ↓
Textract chamado
        ↓
resultado da chamada ficou incerto
```

Textract possui suporte nativo a idempotência por `ClientRequestToken`, o que torna essa repetição controlável.

---

## 3.3 `completeOcr`

O fluxo atual segue aproximadamente:

```text
PutObject artefato OCR
        ↓
SendTaskSuccess
```

Se ocorrer:

```text
PutObject                ✓
SendTaskSuccess           timeout
```

a redelivery precisa ser capaz de tentar novamente a sinalização da Step Functions.

Se o fence tratar o trabalho como simplesmente "já executado", o task token pode nunca ser reenviado e a execução fica órfã.

---

# 4. O problema real não é apenas "onde colocar o fence"

O verdadeiro problema arquitetural é separar:

```text
autorização para INICIAR trabalho
```

de:

```text
autorização para CONTINUAR ou RECUPERAR trabalho
```

Essa distinção está correta na hipótese de `claim + outcome`.

Porém, antes de construir um protocolo distribuído adicional para resolver isso, é necessário decidir se a segunda propriedade precisa continuar válida durante `DELETING`.

A recomendação desta análise é:

> **Não.**

Liveness dos workflows deve ser garantida enquanto o tenant está `ACTIVE`.

Depois de `DELETING`, preservar o processamento normal deixa de ser objetivo.

O objetivo passa a ser:

```text
não criar novos efeitos
+
não persistir resultados atrasados
+
convergir para zero dados
```

---

# 5. Comportamento recomendado por efeito

| Fluxo | Tenant `ACTIVE` | Tenant `DELETING` |
|---|---|---|
| Step Functions | recovery atual continua | não iniciar novo run; cancelar ou abandonar execução existente |
| Textract | retry com o mesmo token | não iniciar novo job; resultado tardio é descartado |
| Bedrock | execução normal | não iniciar nova chamada; resultado tardio não pode ser persistido |
| `completeOcr` | retry de callback continua | não criar novo artefato nem ressuscitar workflow; callback pode virar no-op |
| S3 | comportamento normal | apenas operações do purge podem alterar estado |

---

# 6. O protocolo `claim + outcome`

A hipótese não está errada.

Ela identifica corretamente que precisamos separar:

```text
claim = autorização durável para um efeito
```

de:

```text
outcome = resultado observado do efeito
```

Modelo conceitual:

```text
Tenant ACTIVE
      ↓
criar claim
      ↓
claim persiste além da invocação Lambda
      ↓
efeito externo
      ↓
outcome
```

Depois de:

```text
ACTIVE → DELETING
```

poderíamos ter:

```text
novo claim             → proibido
claim preexistente     → pode continuar
```

Isso funciona caso exista uma exigência explícita de negócio dizendo:

> Todo trabalho admitido antes da exclusão precisa poder concluir mesmo depois de o tenant entrar em `DELETING`.

Se essa exigência existir, `claim + outcome` é uma solução plausível.

Mas ela parece mais complexa do que o W3-07 realmente precisa.

---

# 7. Não criar um `ExternalEffectClaim` universal sem necessidade

Mesmo caso a arquitetura adote claims, não é recomendável criar imediatamente uma infraestrutura genérica única para todos os efeitos externos.

O projeto já possui entidades que cumprem parte dessa função.

Exemplos:

- `ExtractionRun` já representa uma admissão durável do workflow;
- Textract já possui uma identidade lógica baseada em token;
- Step Functions já possui nome determinístico de execução;
- outras entidades existentes podem ser reutilizadas.

A preferência deve ser:

```text
reusar identidade e estado existentes
```

antes de:

```text
criar nova camada transversal de claims
```

Isso reduz complexidade e risco de overengineering.

---

# 8. O caso especial do Bedrock

Este é um ponto crítico.

A hipótese original sugere algo próximo de:

```text
claim existe
+
outcome desconhecido
→ repetir o efeito usando idempotency key nativa
```

Isso não é universalmente verdadeiro.

A chamada síncrona `Converse` do Bedrock não oferece uma idempotency key equivalente ao `ClientRequestToken` do Textract.

Considere:

```text
Bedrock processou
        ↓
resposta começou a voltar
        ↓
conexão caiu
        ↓
Lambda não recebeu a resposta
```

O sistema não consegue determinar com certeza se:

```text
efeito não ocorreu
```

ou:

```text
efeito ocorreu, foi cobrado e o resultado foi perdido
```

Uma repetição pode produzir:

- segunda chamada;
- custo duplicado;
- resposta diferente;
- semântica at-least-once.

Portanto, nenhuma infraestrutura DynamoDB consegue transformar uma API externa não-idempotente em exatamente-once.

---

# 9. Política explícita para `UNKNOWN_OUTCOME` do Bedrock

Se a arquitetura insistir em preservar recovery de Bedrock, precisa assumir explicitamente uma política.

## Alternativa A — at-most-once

```text
resultado ambíguo
        ↓
não repetir automaticamente
        ↓
marcar UNKNOWN / DEGRADED
```

Vantagem:

- evita custo duplicado.

Desvantagem:

- pode perder uma extração.

---

## Alternativa B — at-least-once

```text
resultado ambíguo
        ↓
repetir chamada
```

Vantagem:

- aumenta chance de completar o processamento.

Desvantagens:

- custo potencialmente duplicado;
- resultado potencialmente diferente;
- não existe exactly-once.

Essa decisão precisa aparecer formalmente no design.

---

# 10. `completeOcr` possui outro problema de idempotência

Existe um problema independente do W3-07.

O artefato OCR utiliza uma key semelhante a:

```text
ocr/<runId>/<randomUUID>.json
```

Considere:

```text
PutObject A             ✓
SendTaskSuccess         timeout
redelivery
PutObject B             ✓
SendTaskSuccess         ✓
```

Agora existem dois artefatos físicos.

Isso piora:

- idempotência;
- rastreabilidade;
- purge;
- DSR;
- enumeração dos dados do tenant.

---

# 11. Recomendação para a key do artefato OCR

Usar uma identidade determinística e tenant-scoped.

Exemplo conceitual:

```text
tenant/<tenantId>/ocr/<runId>/artifact.json
```

ou outra convenção consistente com o storage do projeto.

Benefícios:

```text
retry
+
enumeração por tenant
+
purge
+
idempotência física
```

Uma nova tentativa escreve novamente o mesmo objeto lógico em vez de criar outro UUID arbitrário.

Como o produto ainda está numa fase anterior à produção pública ampla, este é um momento relativamente barato para corrigir o contrato.

---

# 12. S3 e a definição de exclusão concluída

A distinção abaixo está correta:

```text
zero linhas DynamoDB
≠
zero dados físicos
```

Um CSV, documento, OCR ou outra evidência em S3 continua sendo dado mesmo que nenhuma linha DynamoDB aponte para ele.

Portanto:

```text
TenantLifecycleRecord.status = DELETED
```

não pode significar apenas:

```text
não existem mais linhas consultáveis
```

Precisa representar uma garantia mais forte.

---

# 13. Quiescence barrier

O ponto central para provar exclusão é:

> **Primeiro remover a possibilidade de novos writers. Depois provar vazio.**

A ordem deve ser semelhante a:

```text
DELETING
↓
bloquear novas mutações
↓
cancelar/quiescer produtores
↓
esperar writers admitidos anteriormente perderem capacidade de persistência
↓
purga DynamoDB
↓
purga S3
↓
verificação final
↓
DELETED
```

Executar repetidamente scans vazios enquanto writers ainda podem aparecer não prova não-ressurreição.

O conceito de **quiescence barrier** deveria constar explicitamente na próxima proposta.

---

# 14. S3 purge durável

A varredura física S3 não deveria ser uma Lambda simples e sem estado.

Ela precisa considerar:

- paginação;
- `ListObjectVersions`;
- buckets versionados;
- delete markers;
- `DeleteObjects.Errors[]`;
- retries;
- checkpoint;
- retomada;
- prova de convergência.

Uma Step Functions dedicada ao purge de tenant é uma opção coerente com o padrão já existente no projeto.

---

# 15. Convenção de keys S3

Hoje há inconsistência.

Exemplos descritos no projeto:

```text
tenant/<tenantId>/...
clean/<tenantId>/...
ocr/<runId>/<uuid>.json
```

O último caso é particularmente problemático porque não possui `tenantId`.

Uma estratégia melhor é tornar todos os objetos tenant-owned diretamente enumeráveis por tenant sempre que possível.

Idealmente, novos objetos deveriam seguir uma convenção aproximadamente assim:

```text
tenant/<tenantId>/<domain>/<resource...>
```

Não é necessário migrar cegamente todo storage atual, mas o contrato futuro deveria convergir nessa direção.

---

# 16. Enforcement estrutural do fence

A ideia de usar ESLint é útil, mas não deve ser tratada como garantia principal.

O próprio desenho anterior já reconheceu bypasses possíveis:

- computed property;
- `BatchWriteCommand`;
- imports dinâmicos;
- aliases;
- adapters antigos;
- exceções crescentes.

Portanto:

> lint deve ser guardrail, não a própria barreira arquitetural.

---

# 17. Fronteira explícita de mutação

Uma solução mais robusta seria criar um ponto arquitetural explícito para mutações tenant-scoped.

Conceitualmente:

```text
TenantMutationExecutor
        │
        ├── normal mutation
        │      exige lifecycle = ACTIVE
        │
        └── deletion/system mutation
               permissão explicitamente restrita
```

O objetivo não precisa ser literalmente uma classe com esse nome.

O importante é existir uma fronteira estrutural em que:

```text
business mutation
→ lifecycle ACTIVE obrigatório
```

e operações privilegiadas do purge precisam usar um caminho diferente e explícito.

---

# 18. Relação com OCC

Essa fronteira deve reaproveitar o modelo já existente do projeto:

- OCC;
- `TransactWriteItems`;
- builders de `src/shared/dynamodb/occ.ts`;
- ConditionChecks existentes.

Não deve criar `ConditionExpression` manual espalhada pelo código.

O lifecycle fence precisa fazer parte da mesma disciplina transacional já usada pelo restante do domínio.

---

# 19. Bootstrap atômico

A direção identificada anteriormente parece correta.

No primeiro login de uma identidade realmente nova, criar atomicamente:

```text
IdentityMapping
+
TenantLifecycleRecord(ACTIVE)
+
User
```

Caso `IdentityMapping` já exista e o lifecycle esteja:

```text
DELETING
```

ou:

```text
DELETED
```

não deve ocorrer reprovisionamento.

Essa regra elimina o problema anterior em que o próprio `RequestContextResolver` poderia ressuscitar um tenant apagado.

---

# 20. Semântica formal recomendada

Uma regra forte e simples seria:

> Toda mutação normal tenant-scoped exige `TenantLifecycleRecord.status = ACTIVE` no mesmo boundary transacional da mutação sempre que tecnicamente aplicável.

E:

> A única classe de operações permitida durante `DELETING` é aquela explicitamente necessária para cancelar, reconciliar, observar ou apagar dados do tenant, sem criar novo estado de negócio.

Isso é mais fácil de:

- explicar;
- testar;
- revisar;
- provar;
- manter.

---

# 21. O que fazer com callbacks tardios

Callbacks podem chegar depois de `DELETING`.

O sistema precisa tratá-los como eventos válidos tecnicamente, mas não como autorização para reconstruir estado.

Exemplo:

```text
Textract termina
        ↓
callback chega
        ↓
tenant = DELETING
        ↓
resultado descartado
        ↓
nenhum novo dado de negócio persistido
```

O mesmo princípio vale para:

- SQS;
- Step Functions callbacks;
- webhooks;
- retries;
- redeliveries;
- processos agendados.

---

# 22. `DELETING` não significa "tudo parou instantaneamente"

É importante não criar uma garantia impossível.

Quando o lifecycle muda para `DELETING`:

- uma chamada externa pode já estar em voo;
- uma Lambda pode estar executando;
- Textract pode já estar processando;
- Step Functions pode possuir execução ativa.

Não é necessário provar que o mundo externo parou exatamente naquele instante.

A garantia realista é:

```text
nenhum novo trabalho é admitido
+
resultados posteriores não podem recriar estado
+
o purge converge depois que o sistema fica quiescente
```

---

# 23. Propriedade de segurança desejada

A propriedade central pode ser formulada assim:

> Depois do linearization point `ACTIVE → DELETING`, nenhuma operação de negócio pode criar novo estado persistente tenant-owned que sobreviva ao processo de exclusão.

Isso é mais preciso do que exigir:

> nenhum efeito externo pode existir depois desse instante.

A segunda formulação é provavelmente impossível de garantir integralmente em sistemas distribuídos.

---

# 24. Propriedade de liveness desejada

Durante `ACTIVE`:

> Toda operação admitida deve conservar os mecanismos normais de retry, redelivery, idempotência e recovery.

Durante `DELETING`:

> O sistema deve convergir para zero dados físicos do tenant e impedir reintrodução de estado de negócio.

Essa separação remove a contradição atual.

---

# 25. Se ainda for necessário preservar trabalho pré-existente

Caso exista uma decisão formal de que operações iniciadas antes da exclusão devem poder concluir, então a solução muda.

Nesse caso, usar um modelo próximo de:

```text
durable admission capability
+
effect-specific recovery
+
outcome journal
```

seria justificável.

A regra seria:

```text
claim criado enquanto ACTIVE
→ autorização durável para aquele trabalho específico
```

Depois de `DELETING`:

```text
novo claim
→ DENY

claim preexistente
→ continuation allowed
```

---

# 26. Claims devem ser específicos aos efeitos

Mesmo nesse cenário, é perigoso tratar todos os providers da mesma forma.

## Step Functions

Possui semântica própria de execução e nome determinístico.

## Textract

Possui `ClientRequestToken`.

## Bedrock

Não possui idempotência equivalente na chamada usada.

## S3

Pode tornar o write idempotente usando key determinística.

Portanto:

```text
effect recovery policy
```

precisa ser explícita por tipo de efeito.

---

# 27. O que não tentar garantir

Não tentar afirmar:

```text
exactly-once distributed execution
```

entre DynamoDB e serviços externos.

Sem uma transação distribuída real envolvendo os providers, isso não existe.

O desenho deve trabalhar conscientemente com:

- at-most-once;
- at-least-once;
- idempotência;
- UNKNOWN_OUTCOME;
- reconciliation.

---

# 28. Proposta de arquitetura para a Rodada 4

A próxima proposta deveria começar pela decisão semântica, antes dos detalhes de código.

## Fase A — Lifecycle barrier

```text
ACTIVE
↓
atomic transition
↓
DELETING
```

Depois dessa transição:

- nenhum novo trabalho;
- nenhuma nova mutação de negócio;
- nenhum novo efeito externo.

---

## Fase B — Quiescence

- impedir novos producers;
- cancelar o que for cancelável;
- impedir persistência de resultados tardios;
- aguardar writers preexistentes deixarem de ter capacidade útil de escrita.

---

## Fase C — Purge

- DynamoDB;
- tabela principal;
- bff-session-table;
- S3;
- objetos versionados;
- transient OCR;
- filas/artefatos aplicáveis.

---

## Fase D — Verification

Provar separadamente:

```text
zero tenant-owned DynamoDB state
```

e:

```text
zero tenant-owned physical object state
```

---

## Fase E — DELETED

Somente depois da prova convergente:

```text
DELETING → DELETED
```

---

# 29. O papel do `TenantLifecycleRecord`

O `TenantLifecycleRecord` deve permanecer fora da cascata tenant-owned.

Ele é:

- tombstone;
- fence;
- registro de lifecycle;
- prova de que aquele tenant já existiu;
- mecanismo de anti-reprovisionamento.

Portanto, não deve ser tratado como dado normal apagável do tenant.

Essa decisão das rodadas anteriores parece correta e não deveria ser reaberta.

---

# 30. Avaliação do protocolo claim/outcome

Como direção arquitetural:

**aproximadamente 7/10.**

Pontos positivos:

- identifica corretamente admission vs continuation;
- reconhece redelivery;
- reconhece efeitos externos;
- tenta preservar liveness;
- reconhece necessidade de outcome explícito.

Problemas:

- tende a universalizar providers com garantias diferentes;
- Bedrock não encaixa no modelo "retry seguro por idempotency key";
- aumenta significativamente a complexidade;
- pode transformar o W3-07 em infraestrutura transversal de efeitos externos;
- talvez resolva uma garantia que nem deveria existir durante `DELETING`.

---

# 31. Avaliação da alternativa proposta

A abordagem:

```text
ACTIVE-only fence
+
cancellation
+
quiescence
+
durable purge
+
proof
```

parece significativamente mais adequada.

Ela:

- reduz estados;
- reduz infraestrutura;
- preserva recovery enquanto realmente necessário;
- define uma semântica clara para exclusão;
- facilita testes;
- facilita revisão adversarial;
- facilita prova de não-ressurreição;
- reduz risco de overengineering.

É uma direção com maior chance de atingir o gate arquitetural de 9+/10 do projeto.

---

# 32. Ponto estratégico

W3-07 deve ser tratado proporcionalmente ao seu risco real.

O projeto já está numa fase de:

```text
Consolidation + Pilot Readiness
```

e existe uma regra explícita contra overengineering:

> Esta mudança reduz um risco real para o primeiro cliente ou apenas aumenta a quantidade de software?

Criar uma infraestrutura distribuída genérica de claims/outcomes para vários providers só deveria ocorrer se houver uma necessidade real e demonstrável.

---

# 33. Recomendação final

Antes da próxima Rodada Claude↔Codex, mudar o framing arquitetural.

Em vez de começar com:

```text
Como preservar recovery de todo trabalho já iniciado depois da exclusão?
```

começar com:

```text
Quais garantias realmente precisam continuar válidas depois de ACTIVE → DELETING?
```

A resposta recomendada é:

```text
business-work liveness: NÃO
deletion liveness: SIM
non-resurrection: SIM
physical purge convergence: SIM
auditability: SIM
```

Assim, a proposta pode abandonar a necessidade de um protocolo universal de `claim + outcome` para o W3-07.

---

# 34. Resumo executivo

O projeto encontrou um problema distribuído legítimo:

```text
fence forte
vs
redelivery/recovery
```

A hipótese de `claim + outcome` percebe corretamente que início e continuação são conceitos diferentes.

Porém, o ponto decisivo é anterior:

> **Durante uma exclusão de tenant, o sistema realmente precisa continuar executando normalmente o trabalho daquele tenant?**

A recomendação é:

> **não.**

O lifecycle `DELETING` deve transformar o objetivo de "completar o trabalho" em "cancelar, impedir novas persistências e convergir para zero dados".

O desenho recomendado é:

```text
ACTIVE
↓
DELETING  ← linearization point
↓
deny new business work
↓
discard late outcomes
↓
quiescence
↓
durable DynamoDB + S3 purge
↓
verification
↓
DELETED
```

O protocolo `claim + outcome` deve permanecer como alternativa caso exista uma exigência explícita de preservar trabalho pré-admitido durante `DELETING`, e mesmo nesse caso precisa ser específico por efeito — especialmente porque Bedrock não possui a mesma semântica de idempotência de Textract e Step Functions.

A maior oportunidade de simplificação é:

> **resolver a semântica de `DELETING` antes de construir mais infraestrutura.**

---

# Referências técnicas

- Expiration Tracker repository:  
  https://github.com/marcelo-jgoncalves/expiration-tracker

- AWS Step Functions — `StartExecution`:  
  https://docs.aws.amazon.com/step-functions/latest/apireference/API_StartExecution.html

- Amazon Textract — `StartDocumentTextDetection`:  
  https://docs.aws.amazon.com/textract/latest/APIReference/API_StartDocumentTextDetection.html

- Amazon S3 consistency model:  
  https://docs.aws.amazon.com/AmazonS3/latest/userguide/Welcome.html

---

# Arquivo de origem analisado

`expiration-tracker-w3-07-claim-outcome-protocol-external-review-prompt.md`

O documento original registra o impasse arquitetural, as revisões D-062 a D-065, o comportamento dos fluxos de recovery existentes e as pendências de S3, tenant lifecycle, structural enforcement e bootstrap atômico.
