tokens used
32.087
## Veredito

A Rodada 3 fecha a maior parte dos achados de forma substancial, mas não todos. Há dois pontos importantes ainda abaixo do padrão de fechamento: a classificação do fence de tenant quando `CancellationReasons` está ausente ou malformado e a distinção `Subject inexistente` versus `ARCHIVED` mediante releitura posterior.

Não considero o design ≥ 9,0 nesta rodada. A régua, embora bastante melhor, ainda retém algum viés e uma definição tecnicamente incompleta do cálculo de bytes.

## 1. Os oito achados novos

1. **Reserva do cap 30 — parcialmente fechada.**

A aritmética anterior foi corretamente reconhecida como errada. `3N + 3 = 93` para auditoria por requisito também está correto.

Contudo, isso justifica que `N ≤ 32`; não deriva especificamente o cap 30. O cap 30 é uma escolha conservadora e perfeitamente aceitável, com sete ações de folga, mas “30 é derivado do pior caso” é mais forte que a demonstração. Além disso, a auditoria é descrita como “lacuna conhecida”, não como requisito já comprometido desta evolução. Fechamento suficiente para segurança, mas retoricamente exagerado quanto à derivação.

2. **Bytes e teste de 200 KB — majoritariamente fechado, com precisão técnica pendente.**

Mudar os limites para bytes UTF-8 elimina a contradição entre Unicode válido e o teste. Isso fecha o núcleo do achado.

Ainda há duas fragilidades:

- tamanho de item DynamoDB não é simplesmente a soma de nomes e valores; listas, mapas e tipos têm overhead estrutural;
- `≈120` e `≈2,5 KB` continuam sendo estimativas, enquanto C2 afirma exigir medição no formato contabilizado pelo DynamoDB.

A folga é enorme, portanto não vejo risco prático de exceder 400 KB ou 4 MB. Mas, sob a própria régua, o estimador precisa modelar também containers, tipos e demais overheads, ou ser validado contra uma implementação de referência. O teste em 200 KB é uma boa sentinela, mas não substitui uma prova exata do tamanho.

3. **Paginação — fechado, se o fato de código estiver correto.**

Um `do/while` que acumula até `LastEvaluatedKey` desaparecer fecha integralmente a objeção. A conclusão é proporcional ao fato, desde que `listRequirements()` realmente não imponha depois algum limite ou filtro parcial.

4. **Consistência de leitura — fechado por decisão contratual, com uma afirmação excessiva.**

Declarar leitura eventual e aceitar cancelamento total em vez de `skip` é uma decisão válida; integridade e atomicidade ficam preservadas.

Mas “reaplicar e então pula corretamente” não é garantia de leitura eventual: uma repetição imediata ainda pode observar estado defasado. O correto é “reaplicar é seguro e, quando a leitura convergir, o item será pulado”. Também não procede que tornar a consulta consistente necessariamente exigiria alterar todos os call sites; um parâmetro opcional com default ou um método específico evitaria isso. Essas razões são fracas, mas a escolha permanece aceitável.

5. **Diagnóstico racy do template — bem fechado.**

Um único `TemplatePreconditionFailedError`, sem usar a releitura para escolher a causa histórica, é a solução correta. Rotular o valor relido como observação posterior preserva honestidade epistemológica.

6. **Fence do tenant — não demonstrado completamente.**

No caminho normal, se o wrapper:

- sempre acrescenta o fence por último;
- inspeciona exatamente sua posição; e
- converte sua falha antes de propagar,

então aceito que o caller não precisa rotular o fence.

Entretanto, a conclusão “ou recebe `TenantNotActiveError`, ou recebe uma exceção em que o fence comprovadamente não é a causa” é maior que esses fatos quando `CancellationReasons` está ausente ou malformado. Nesse caso, o wrapper não consegue simultaneamente:

- provar que o fence falhou;
- provar que ele não falhou; e
- evitar inferência causal.

“Fallback conservador” precisa ser especificado. Se transforma ambiguidade em `TenantNotActiveError`, viola C7 ao afirmar causa não revelada. Se propaga `TransactionCanceledException`, o caller não pode afirmar que o fence não foi a causa. O fallback correto é um conflito genérico/indeterminado, sem causalidade específica.

7. **Precedência de `createRequirement` — ainda não fechada corretamente.**

A ordem foi declarada, mas `SUBJECT_FENCE` combina existência e `status = ACTIVE`. A transação revela apenas que a condição composta falhou.

Usar uma releitura posterior para escolher entre:

- `NotFoundError` 404; e
- `ConflictError` 409 por `ARCHIVED`

repete exatamente o problema epistemológico corrigido em N5. O Subject pode ter sido removido, recriado ou mudado de estado depois do cancelamento. Dizer que a releitura está “rotulada como observação posterior” não resolve o fato de ela estar escolhendo o tipo de erro.

A saída coerente é um erro único de pré-condição do Subject, ou então declarar que 404/409 descreve apenas o estado observado após a falha, sem apresentá-lo como causa do cancelamento. Este é o fechamento mais claramente insuficiente da rodada.

8. **Estados do Subject — bem fechado.**

Se o enum é de fato `ACTIVE | ARCHIVED | DELETED`, a conclusão é correta: `<> DELETED` admitia `ARCHIVED`, e `status = ACTIVE` fecha o buraco tanto no apply quanto em `createRequirement`.

## 2. Os três fatos de código

O repositório não está presente neste workspace; portanto não consigo certificá-los por leitura independente nesta execução. Tomando como verdadeiros os trechos relatados:

- **`queryByPk` esgota paginação:** aceito o fato e a conclusão.
- **O wrapper acrescenta o fence por último e o converte antes do caller:** aceito para `CancellationReasons` válidos; não aceito a conclusão absoluta para razões ausentes/malformadas sem conhecer precisamente o fallback.
- **`TrackedSubjectStatus = ACTIVE | ARCHIVED | DELETED`:** aceito o fato e a conclusão. A condição correta é `status = ACTIVE`.

## 3. Régua v3

A v3 está consideravelmente menos enviesada:

- C3 tornou-se realmente genérico;
- C5 passou a avaliar garantia, não um parâmetro nominal;
- C7 agora cobra cobertura, precedência e honestidade causal;
- os pesos somam corretamente 100%.

Ainda resta viés moderado:

- C1 dedica 20% a uma decisão de unicidade específica desta proposta. A formulação admite qualquer decisão de produto, mas “enforced transacionalmente em todo caminho” favorece diretamente a arquitetura escolhida;
- C4 continua premiando especificamente snapshot/proveniência, embora seja uma propriedade importante deste caso;
- C2 usa uma definição simplificada e parcialmente inexata de tamanho DynamoDB;
- há alguma sobreposição entre C1, C3 e C7, todos recompensando aspectos da mesma ampliação transacional.

Não é mais uma régua “feita para garantir vitória”, mas ainda é uma régua fortemente moldada em torno deste design. Fica pouco abaixo de 9,0.

## 4. Achados novos/remanescentes

Os principais são:

1. **O diagnóstico racy reaparece em `createRequirement`.** A releitura posterior escolhe 404 versus 409, embora a transação só revele falha da condição composta.

2. **O fallback do fence de tenant está subespecificado.** Com razões ausentes/malformadas, a alegação de classificação total é logicamente impossível sem aceitar erro genérico/indeterminado.

3. **O estimador DynamoDB descrito não contabiliza explicitamente overhead estrutural de listas, mapas e tipos.** A margem torna o design seguro, mas C2 promete exatidão maior que a oferecida.

4. **A auditoria justifica um teto abaixo de 33, não especificamente 30.** Isso não invalida o cap; apenas corrige a afirmação de que 30 foi matematicamente derivado.

## Fechamento do protocolo

A régua está próxima, mas ainda não alcança 9,0 sem arredondamento. O design também não alcança: o problema de causalidade em `createRequirement` é material sob o próprio C7, e o fallback do fence precisa ser explicitado.

NOTA CODEX RODADA 3 - REGUA: 8,8/10  
NOTA CODEX RODADA 3 - DESIGN: 8,7/10
