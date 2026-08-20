## Avaliação independente — Rodada 3

**Nota: 8,8/10**

**Não bate o gate de 9,0.** Dos sete fechamentos, cinco estão adequadamente resolvidos, mas dois ainda deixam ambiguidades relevantes para implementação.

### Avaliação dos sete fechamentos

1. **Lookup tenant-scoped de `NotificationAttempt`: parcialmente resolvido.**

A escolha arquitetural foi fechada corretamente: ponteiro tenant-scoped, criado atomicamente com a tentativa, seguido da validação de tenant/provider/account.

Ainda falta tornar normativo:

- `ConsistentRead=true` na leitura do ponteiro e da tentativa;
- `ConditionExpression` que impeça colisão ou sobrescrita do ponteiro.

Essas propriedades constavam no critério de fechamento da rodada 2, mas não foram incorporadas explicitamente ao texto normativo da rodada 3.

2. **Tags SES + GSI5/`UNMATCHED`: resolvido.**

O design agora estabelece corretamente:

- spike como precondição da implementação;
- ausência de tenant confiável resulta em `UNMATCHED`;
- nenhuma busca global cross-tenant;
- GSI5 permanece tenant-scoped e só pode ser usado quando o tenant já é conhecido;
- callback anterior à persistência do `MessageId` permanece coberto pelos testes da base.

O exemplo de `providerMessageId` como possível fonte local de tenant é pouco convincente sem outro índice, mas isso não compromete a segurança: nessa situação, o comportamento efetivo continua sendo `UNMATCHED`, como deveria.

3. **Separação `REPLACEMENT` versus `CORRECTIVE`: insuficiente.**

A separação conceitual, templates e chaves idempotentes foram bem definidos. Porém, o predicado normativo usa somente a existência de tentativa `ACCEPTED`/`DELIVERED`/`UNKNOWN`.

Isso contradiz a especificação-base, que reconhece `SUBMITTING` como estado em que o limite externo pode ter sido atravessado. Pela redação da rodada 3, um intent com tentativa atualmente `SUBMITTING` poderia ser classificado como `REPLACEMENT`, embora a mensagem stale possa ter sido enviada.

Estados posteriores também precisam de tratamento explícito, especialmente `COMPLAINED`; depender de o implementador reconstruir que a tentativa anteriormente passou por `ACCEPTED` não é uma especificação determinística.

**O que fecha:** separar normativamente dois casos:

   - `PREPARED`, `FAILED_RETRYABLE`, `FAILED_TERMINAL` e `NOT_SENT_STALE`: nenhuma entrega possível, portanto `REPLACEMENT`;
   - `SUBMITTING`, `ACCEPTED`, `DELIVERED`, `UNKNOWN` e `COMPLAINED`: entrega stale possível ou comprovada, portanto `CORRECTIVE`;
   - tratamento explícito de `BOUNCED`, idealmente considerando se houve evidência anterior de entrega, em vez de deixar isso implícito no histórico.

4. **Política `UNKNOWN`: resolvido.**

A opção at-most-once está ratificada de forma inequívoca, incluindo ausência de retry automático, reconciliação por callback e redrive operacional com nova geração.

5. **Rate limiting SES: resolvido com ressalva não bloqueante.**

Existe agora um gate objetivo: consultar a quota, medir o ritmo real e introduzir o bucket agregado caso concurrency não seja suficiente. `ThrottlingException` também foi classificada como retryable sem criar nova tentativa lógica.

Na implementação, será necessário garantir que esse retry passe por um estado conclusivamente retryable, sem repetir uma tentativa meramente encontrada em `SUBMITTING`; a máquina de estados da base permite isso.

6. **DLQ da `SesCallbackQueue`: resolvido.**

DLQ própria e `maxReceiveCount=5` estão agora explícitos e coerentes com alarmes, infraestrutura e teste de poison message.

7. **Regressão cross-tenant do destinatário: resolvido.**

O caso obrigatório cobre resolução, cancelamento determinístico e ausência de enfileiramento do e-mail. É a regressão correta para o achado de isolamento.

### Exatamente o que falta para atingir 9,0

1. Determinar que o ponteiro e a tentativa são lidos com consistência forte e que a criação do ponteiro usa condição contra sobrescrita/colisão.

2. Redefinir o critério `REPLACEMENT`/`CORRECTIVE` pela possibilidade de o limite externo ter sido atravessado, incluindo explicitamente os estados listados acima.

Com esses dois ajustes normativos, o design fica em condição de superar o gate de **9,0** e seguir para implementação.
