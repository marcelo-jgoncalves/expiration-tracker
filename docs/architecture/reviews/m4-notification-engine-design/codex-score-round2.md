## Avaliação independente — Rodada 2

**Nota: 8,4/10**

O design convergido é tecnicamente forte: define corretamente os limites transacionais, usa outbox com recuperação por sweeper, trata duplicação e ambiguidade do SES de forma explícita, mantém isolamento tenant-scoped, apresenta uma matriz consistente de fail-closed/fail-open e especifica testes relevantes nas três camadas.

Entretanto, ainda não está completamente pronto para virar código. Alguns itens classificados como “follow-up de implementação” são decisões centrais do fluxo necessário ao exit criterion e precisam ser fechados no design.

### Achados que impedem nota ≥ 9,0

1. **Bloqueante — mecanismo de lookup do `NotificationAttempt` continua indefinido (#7).**

   O callback precisa localizar a tentativa para completar a rastreabilidade `occurrence → intent → attempt → callback`. A chave proposta da tentativa contém `attemptNumber`, que não pode ser obtido apenas de `attemptId`. O próprio documento oferece duas alternativas — SK derivável ou item ponteiro — mas não escolhe uma normativamente.

   Isso não é detalhe de implementação: muda modelo de dados, composição da transação de criação da tentativa, IAM, testes de concorrência e caminho crítico do callback.

   **O que fecha:** adotar explicitamente o ponteiro tenant-scoped:

   ```text
   PK = TENANT#<tenantId>#ATTEMPT#<attemptId>
   SK = LOOKUP
   → intentPk, attemptSk
   ```

   Ele deve ser criado atomicamente com a tentativa, usando `ConditionExpression`, relido consistentemente pelo callback e validado contra tenant, intent, provider e account. Alternativamente, redesenhar a SK da tentativa para ser diretamente derivável de `attemptId`, mas uma das duas opções precisa ser normativa antes de codar.

2. **Alto — correlação por tags SES ainda depende de hipótese não validada e o fallback GSI5 está incompleto (#6 e #8).**

   Tags são a fonte primária, mas sua presença nos eventos reais `DELIVERY`, `BOUNCE` e `COMPLAINT` ficou para prova no sandbox. Ao mesmo tempo, o fallback por GSI5 só funciona quando já existe um tenant confiável; o design não define de onde esse tenant viria quando justamente as tags estão ausentes. Portanto, “tags ausentes → GSI5” não constitui hoje um caminho de recuperação completo.

   **O que fecha:**

   - definir as tags como pré-condição técnica validada por um spike/sandbox antes da implementação integral;
   - especificar comportamento por tipo de callback quando alguma tag estiver ausente;
   - declarar que, sem tenant confiável, o evento vira `UNMATCHED`, sem consulta global;
   - reconciliar normativamente o GSI5 tenant-scoped com o exemplo global do blueprint;
   - manter teste de callback anterior à persistência do `MessageId`.

   A validação AWS pode acontecer como primeiro passo da implementação, mas deve existir uma decisão explícita de fallback caso o resultado seja negativo.

3. **Alto — regras de intent corretivo ainda têm ambiguidade semântica (#4).**

   A seção 6 primeiro determina a criação de novo intent quando o item muda e continua ativo, mas depois afirma que “uma correção externa” só é criada se já houver tentativa `ACCEPTED`, `DELIVERED` ou `UNKNOWN`. Não está suficientemente claro se:

   - antes de qualquer envio cria-se um novo reminder correto;
   - após envio possível cria-se uma mensagem explicitamente corretiva;
   - ou ambos usam o mesmo `kind = CORRECTIVE`.

   Isso afeta conteúdo, idempotência, estados, experiência do usuário e os testes de FR-014.

   **O que fecha:** separar normativamente dois casos:

   - `REPLACEMENT`: substitui o intent stale antes de qualquer possível entrega;
   - `CORRECTIVE`: informa correção quando uma entrega stale pode ter ocorrido.

   Para cada caso, definir condição de criação, template, chave idempotente e transição do intent supersedido.

4. **Médio — a política para `UNKNOWN` aparece como proposta, mas continua formalmente aberta (#5).**

   O texto técnico escolhe corretamente at-most-once automático: uma tentativa `SUBMITTING` expirada vira `UNKNOWN` e não chama SES novamente. Porém, o documento convergido ainda lista essa política como pendente de validação.

   Essa decisão governa diretamente perda versus duplicação no efeito externo e não deveria ficar a critério de quem implementar o worker.

   **O que fecha:** ratificar como decisão normativa:

   - nenhum retry automático de `SUBMITTING` ou `UNKNOWN`;
   - callback pode reconciliar o estado;
   - redrive exige nova `redriveGeneration` e ação operacional explícita;
   - registrar que o trade-off aceito é at-most-once automático com possível perda.

5. **Médio — rate limiting agregado do SES não foi escolhido (#9).**

   `maximum concurrency` limita concorrência, mas não garante sozinho a taxa de chamadas por segundo nem acompanha necessariamente a quota real da conta SES. O design deixa aberta a adoção do token bucket distribuído, embora isso altere persistência, permissões e comportamento de retry.

   **O que fecha:** definir um critério objetivo antes de codar, por exemplo: consultar a quota SES do ambiente e provar por teste que concurrency mais ritmo efetivo permanecem abaixo dela; caso contrário, incluir desde M4 o bucket agregado `__SYSTEM__`. O design também deve dizer que throttling conclusivo do SES é retryable sem criar nova tentativa lógica.

### Itens que podem permanecer como follow-up de implementação

- **#3 — custo/escala do Scheduler:** pode ser validado durante a implementação, pois o mecanismo normativo já foi escolhido. Devem ser testados idempotência, limpeza do schedule e corrida entre schedule e redelivery.
- **#11 — eventos de domínio:** corretamente condicionado à existência de consumidor real; estado durável e auditoria bastam para o milestone.
- **#12 — API de preferências:** não bloqueia o exit criterion se onboarding/migração criarem o registro e a Camada 3 preparar o usuário de teste. O escopo da API deve ser decidido antes de declarar M4 funcional para usuários, mas não antes de iniciar o runtime.

### Síntese

Os fundamentos de segurança, resiliência e testabilidade estão acima do gate. O que impede aprovação é a existência de decisões ainda abertas exatamente no trecho central do milestone: localizar a tentativa, correlacionar o callback, distinguir substituição de correção e determinar o comportamento definitivo de `UNKNOWN`.

Fechados os achados 1–4 — e transformado o item #9 em critério técnico verificável — o design tem condições de superar **9,0** sem exigir reestruturação arquitetural.
