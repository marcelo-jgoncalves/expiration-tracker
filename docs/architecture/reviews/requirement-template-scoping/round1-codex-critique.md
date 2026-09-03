## Veredito

A direção snapshot é correta, mas o desenho transacional ainda não fecha os próprios invariantes. Os principais problemas são: contagem errada da transação, ausência de fence de versão do template, dedupe interno dos itens não especificado e promessa excessiva de equivalência entre preview e apply.

### NOTA DA RÉGUA: 6,4/10

A régua mistura requisitos essenciais com decisões arquiteturais já escolhidas:

1. **Critério 1 (25%)**: snapshot é adequado, mas 25% é excessivo. A decisão é importante, porém simples depois de tomada.
2. **Critério 2 (20%)**: corretamente exige proteção transacional, mas indevidamente pressupõe que a unicidade deva ser por nome em toda a entidade `Requirement`. “Duplicidade óbvia” pode significar reaplicação do mesmo item/template, não necessariamente proibição universal de requisitos homônimos.
3. **Critério 3 (15%)**: “sem histórico de versões” é uma decisão de escopo, não um critério pesado de qualidade. Além disso, as fontes apresentadas sustentam snapshot, mas não demonstram que nenhum produto versiona templates.
4. **Critério 4 (15%)**: compartilhar um planejador é boa disciplina, mas não garante equivalência observável sob concorrência. O peso premia estrutura de código acima da semântica.
5. **Critério 5 (15%)**: reutilizar precedente não deve valer tantos pontos quando justamente esse precedente amplia três operações existentes e impõe uma nova regra de domínio.
6. **Critério 6 (10%)**: atomicidade deveria pesar mais. O critério também aceita “folga” sem definir orçamento para os checks adicionais necessários.

A régua omite explicitamente: limite de 400 KB do item embutido, payload total de 4 MB da transação, unicidade interna dos itens, existência/estado do Subject, fence de versão do template, consistência das decisões de skip e autorização sobre o Subject.

### NOTA DO DESIGN: 6,6/10

#### 1. Contagem de ações está errada

A proposta afirma:

```text
40 Requirements + 40 pointers + 1 fence = 81
```

Mas o próprio D-5 exige também um `ConditionCheck` do template ACTIVE. Portanto:

```text
2N + tenant fence + template check = 82 ações para N=40
```

Se for necessário verificar atomicamente a existência/estado do Subject, são **83 ações**.

Ainda cabe no limite de 100, mas o critério 6 não está atendido como escrito: a invariante documentada está incorreta. “Folga para evolução” também é fraca: restam 18 ações, não 19, e nenhuma reserva funcional foi definida.

#### 2. Falta fence da versão lida do template

Checar somente `status = ACTIVE` não impede:

1. apply lê template versão 7;
2. update grava versão 8 com itens diferentes;
3. apply confirma apenas que continua ACTIVE;
4. apply materializa os itens antigos e grava `sourceTemplateAppliedVersion = 7`.

Isso produz uma aplicação atomicamente consistente no DynamoDB, mas baseada numa versão obsoleta depois de uma edição concluída. O check deveria ser, no mesmo `ConditionCheck`:

```text
status = ACTIVE AND version = :versionRead
```

Assim, não aumenta a contagem de ações e fecha o TOCTOU principal. O cliente pode reler, replanejar e tentar novamente.

#### 3. O resultado do planejamento não é serializável para os itens pulados

Para itens planejados como `skip`, nenhum estado observado entra na transação. Logo:

1. apply lê um requisito homônimo e decide pular;
2. esse requisito é apagado ou renomeado;
3. apply confirma os demais itens;
4. ao final, o nome não existe, embora o resultado diga que foi pulado por duplicidade.

Isso não viola o all-or-nothing dos writes realizados, mas viola uma interpretação forte de “aplicar o plano”. Fechar totalmente essa janela exigiria checks sobre os ponteiros pulados, consumindo até mais 40 ações e podendo ultrapassar 100.

O design precisa escolher e documentar uma destas semânticas:

- `skip` é apenas decisão baseada no snapshot de leitura e pode ficar obsoleta; ou
- o estado que justificou cada `skip` também é protegido na transação, o que exige reduzir bastante o cap.

Hoje a proposta sugere garantias mais fortes do que realmente oferece.

#### 4. Preview e apply não “concordam por construção”

Compartilhar `planTemplateApplication` elimina divergência algorítmica, mas não divergência temporal. Preview e apply fazem leituras distintas; entre elas podem ocorrer create, rename, delete, archive ou edição do template.

Portanto, o preview é informativo, não uma promessa do resultado do apply. A API precisa deixar isso explícito. Um `previewToken` baseado na versão do template resolveria apenas a mudança do template, não todas as mudanças nos requisitos do Subject.

Também há um erro textual: “existe exatamente um call site da regra” não é verdade; existem pelo menos dois call sites da mesma função.

#### 5. Falta proibir nomes duplicados dentro do próprio template

O planejador recebe `items` e `existing`, mas nada especifica que ele compare os itens entre si. Um template contendo:

```text
"CND Federal"
" cnd   federal "
```

tentará executar dois `Put` sobre o mesmo ponteiro. O DynamoDB não aceita duas ações da mesma transação sobre o mesmo item; isso pode resultar em erro de validação, não no conflito de domínio prometido.

A unicidade por `normalizeDisplayName()` deve ser validada:

- no create;
- no update;
- na duplicação, defensivamente;
- no planejador, como proteção de domínio.

#### 6. O ponteiro por Subject só vale o custo se a unicidade por nome for uma regra real

O ponteiro é tecnicamente a maneira correta de impedir concorrência por nome, inclusive contra criações manuais. Porém ele não é apenas infraestrutura do template: ele muda o contrato global de `Requirement` para “nome único por Subject”.

Isso exige responder antes da implementação:

- Dois requisitos homônimos com notas, aplicabilidade ou contexto distintos são realmente inválidos?
- Um requisito arquivado/inaplicável, se esses estados existirem, continua reservando o nome?
- Renomear um requisito deve poder bloquear edição de outro?
- Imports e futuras operações em lote também terão de manter o ponteiro?

Se a resposta de produto for “sim, nome de Requirement é único no Subject”, o alargamento de create/update/delete é justificável e coerente.

Se o requisito for somente impedir reaplicação do mesmo template, uma claim por `subjectId + sourceTemplateItemId` ou `subjectId + templateId + itemId` seria mais barata, mas não impediria colisões com requisitos manuais nem com templates duplicados. A proposta deve pedir explicitamente a decisão de domínio, não inferi-la do precedente de `DocumentType`.

#### 7. All-or-nothing está correto, mas a experiência de conflito está incompleta

Uma colisão tardia em qualquer ponteiro aborta toda a transação; nenhum requisito é criado. Isso está correto.

Entretanto, “a outra recebe `ConflictError` identificando o item colidente” depende de:

- solicitar e interpretar `CancellationReasons`;
- manter corretamente o índice das ações depois que o wrapper acrescenta o fence;
- distinguir conflito de ponteiro, falha de versão/status do template, Subject inválido e tenant inativo;
- lidar com mais de uma colisão na mesma tentativa.

Mapear rigidamente `CancellationReasons[1]` é frágil. O builder deveria manter metadados entre cada ação e seu item lógico.

#### 8. Existência e estado do Subject não foram fechados

O apply escreve chaves contendo `subjectId`, mas a proposta não diz se há `ConditionCheck` garantindo que o Subject:

- existe;
- pertence ao tenant;
- está em estado que aceita requisitos.

Uma leitura anterior não basta. Se o Subject puder ser apagado ou arquivado concorrentemente, surge outro TOCTOU. Se a entidade já tiver uma regra que torne isso impossível, ela deve ser citada; caso contrário, o check precisa entrar na transação.

#### 9. Itens embutidos precisam de limites de bytes, não apenas quantidade

“Máximo de 40 itens” não protege sozinho contra:

- limite de 400 KB do item DynamoDB;
- payload máximo da transação;
- notas ou nomes excessivamente grandes;
- crescimento futuro da forma do item.

São necessários limites explícitos de comprimento e um teste de pior caso serializado. O cap 40 pode ser adequado, mas sua justificativa atual considera apenas número de ações.

#### 10. Operações do roadmap

As seis operações pedidas estão presentes:

- criação;
- edição;
- duplicação;
- arquivamento;
- preview;
- aplicação.

Desarquivamento e leitura/listagem são complementos razoáveis. Não falta uma operação nominal do roadmap.

Ainda faltam definições operacionais dentro delas:

- aplicação com zero itens criáveis retorna sucesso ou conflito?
- aplicar template arquivado falha com qual código?
- duplicar template arquivado é permitido?
- editar itens de template arquivado é permitido?
- o apply retorna IDs e correspondência item → Requirement?
- nomes duplicados no próprio template são erro em qual nível?

#### 11. Snapshot versus live-link

Snapshot é a escolha correta para esta fatia. A proveniência opcional e não autoritativa também é coerente.

Porém `sourceTemplateAppliedVersion` só é confiável como “versão efetivamente protegida” depois que o apply condicionar a transação a essa versão. Sem isso, é apenas a versão que foi lida antes da corrida.

Também removeria `documentTypeId` desta fatia. Persistir um campo que deliberadamente não é validado nem propagado cria dado morto e potencialmente enganoso. É melhor adicioná-lo quando o vínculo `Requirement → DocumentType` tiver semântica definida.

#### 12. Riscos não nomeados

- Colisão normalizada entre itens do mesmo template.
- Template editado entre planejamento e commit.
- Subject removido/arquivado durante o apply.
- `skip` tornado inválido por rename/delete concorrente.
- Limite de 400 KB e payload de 4 MB.
- Fragilidade do índice de `CancellationReasons`.
- Nome arquivado possivelmente reservado para sempre pelo ponteiro.
- Mudança global de regra de domínio disfarçada como implementação de dedupe.
- `documentTypeId` órfão ou apontando para catálogo inexistente/arquivado.
- Autorização de apply/preview precisa validar acesso ao Subject, não apenas a action RBAC.
- Backfill é ruído neste contexto sem produção; o correto é estabelecer uma baseline limpa ou executar migração como etapa de implantação, sem tratá-la como risco para usuários existentes.

### Ajustes mínimos para aprovação

1. Decidir formalmente se `Requirement.name` será único por Subject.
2. Corrigir a fórmula para `2N + 2`, ou `2N + 3` com Subject check.
3. Condicionar o template por `status = ACTIVE AND version = versão lida`.
4. Validar unicidade normalizada entre itens.
5. Documentar que skips usam um snapshot potencialmente obsoleto, ou protegê-los e recalcular o cap.
6. Fechar a condição transacional do Subject.
7. Definir limites de bytes e testar o pior caso.
8. Remover `documentTypeId` até sua semântica existir.
9. Tornar o mapeamento de cancelamentos estrutural, não dependente de índice fixo.

NOTA CODEX RODADA 1: 6,6/10
tokens used
22.385
## Veredito

A direção snapshot é correta, mas o desenho transacional ainda não fecha os próprios invariantes. Os principais problemas são: contagem errada da transação, ausência de fence de versão do template, dedupe interno dos itens não especificado e promessa excessiva de equivalência entre preview e apply.

### NOTA DA RÉGUA: 6,4/10

A régua mistura requisitos essenciais com decisões arquiteturais já escolhidas:

1. **Critério 1 (25%)**: snapshot é adequado, mas 25% é excessivo. A decisão é importante, porém simples depois de tomada.
2. **Critério 2 (20%)**: corretamente exige proteção transacional, mas indevidamente pressupõe que a unicidade deva ser por nome em toda a entidade `Requirement`. “Duplicidade óbvia” pode significar reaplicação do mesmo item/template, não necessariamente proibição universal de requisitos homônimos.
3. **Critério 3 (15%)**: “sem histórico de versões” é uma decisão de escopo, não um critério pesado de qualidade. Além disso, as fontes apresentadas sustentam snapshot, mas não demonstram que nenhum produto versiona templates.
4. **Critério 4 (15%)**: compartilhar um planejador é boa disciplina, mas não garante equivalência observável sob concorrência. O peso premia estrutura de código acima da semântica.
5. **Critério 5 (15%)**: reutilizar precedente não deve valer tantos pontos quando justamente esse precedente amplia três operações existentes e impõe uma nova regra de domínio.
6. **Critério 6 (10%)**: atomicidade deveria pesar mais. O critério também aceita “folga” sem definir orçamento para os checks adicionais necessários.

A régua omite explicitamente: limite de 400 KB do item embutido, payload total de 4 MB da transação, unicidade interna dos itens, existência/estado do Subject, fence de versão do template, consistência das decisões de skip e autorização sobre o Subject.

### NOTA DO DESIGN: 6,6/10

#### 1. Contagem de ações está errada

A proposta afirma:

```text
40 Requirements + 40 pointers + 1 fence = 81
```

Mas o próprio D-5 exige também um `ConditionCheck` do template ACTIVE. Portanto:

```text
2N + tenant fence + template check = 82 ações para N=40
```

Se for necessário verificar atomicamente a existência/estado do Subject, são **83 ações**.

Ainda cabe no limite de 100, mas o critério 6 não está atendido como escrito: a invariante documentada está incorreta. “Folga para evolução” também é fraca: restam 18 ações, não 19, e nenhuma reserva funcional foi definida.

#### 2. Falta fence da versão lida do template

Checar somente `status = ACTIVE` não impede:

1. apply lê template versão 7;
2. update grava versão 8 com itens diferentes;
3. apply confirma apenas que continua ACTIVE;
4. apply materializa os itens antigos e grava `sourceTemplateAppliedVersion = 7`.

Isso produz uma aplicação atomicamente consistente no DynamoDB, mas baseada numa versão obsoleta depois de uma edição concluída. O check deveria ser, no mesmo `ConditionCheck`:

```text
status = ACTIVE AND version = :versionRead
```

Assim, não aumenta a contagem de ações e fecha o TOCTOU principal. O cliente pode reler, replanejar e tentar novamente.

#### 3. O resultado do planejamento não é serializável para os itens pulados

Para itens planejados como `skip`, nenhum estado observado entra na transação. Logo:

1. apply lê um requisito homônimo e decide pular;
2. esse requisito é apagado ou renomeado;
3. apply confirma os demais itens;
4. ao final, o nome não existe, embora o resultado diga que foi pulado por duplicidade.

Isso não viola o all-or-nothing dos writes realizados, mas viola uma interpretação forte de “aplicar o plano”. Fechar totalmente essa janela exigiria checks sobre os ponteiros pulados, consumindo até mais 40 ações e podendo ultrapassar 100.

O design precisa escolher e documentar uma destas semânticas:

- `skip` é apenas decisão baseada no snapshot de leitura e pode ficar obsoleta; ou
- o estado que justificou cada `skip` também é protegido na transação, o que exige reduzir bastante o cap.

Hoje a proposta sugere garantias mais fortes do que realmente oferece.

#### 4. Preview e apply não “concordam por construção”

Compartilhar `planTemplateApplication` elimina divergência algorítmica, mas não divergência temporal. Preview e apply fazem leituras distintas; entre elas podem ocorrer create, rename, delete, archive ou edição do template.

Portanto, o preview é informativo, não uma promessa do resultado do apply. A API precisa deixar isso explícito. Um `previewToken` baseado na versão do template resolveria apenas a mudança do template, não todas as mudanças nos requisitos do Subject.

Também há um erro textual: “existe exatamente um call site da regra” não é verdade; existem pelo menos dois call sites da mesma função.

#### 5. Falta proibir nomes duplicados dentro do próprio template

O planejador recebe `items` e `existing`, mas nada especifica que ele compare os itens entre si. Um template contendo:

```text
"CND Federal"
" cnd   federal "
```

tentará executar dois `Put` sobre o mesmo ponteiro. O DynamoDB não aceita duas ações da mesma transação sobre o mesmo item; isso pode resultar em erro de validação, não no conflito de domínio prometido.

A unicidade por `normalizeDisplayName()` deve ser validada:

- no create;
- no update;
- na duplicação, defensivamente;
- no planejador, como proteção de domínio.

#### 6. O ponteiro por Subject só vale o custo se a unicidade por nome for uma regra real

O ponteiro é tecnicamente a maneira correta de impedir concorrência por nome, inclusive contra criações manuais. Porém ele não é apenas infraestrutura do template: ele muda o contrato global de `Requirement` para “nome único por Subject”.

Isso exige responder antes da implementação:

- Dois requisitos homônimos com notas, aplicabilidade ou contexto distintos são realmente inválidos?
- Um requisito arquivado/inaplicável, se esses estados existirem, continua reservando o nome?
- Renomear um requisito deve poder bloquear edição de outro?
- Imports e futuras operações em lote também terão de manter o ponteiro?

Se a resposta de produto for “sim, nome de Requirement é único no Subject”, o alargamento de create/update/delete é justificável e coerente.

Se o requisito for somente impedir reaplicação do mesmo template, uma claim por `subjectId + sourceTemplateItemId` ou `subjectId + templateId + itemId` seria mais barata, mas não impediria colisões com requisitos manuais nem com templates duplicados. A proposta deve pedir explicitamente a decisão de domínio, não inferi-la do precedente de `DocumentType`.

#### 7. All-or-nothing está correto, mas a experiência de conflito está incompleta

Uma colisão tardia em qualquer ponteiro aborta toda a transação; nenhum requisito é criado. Isso está correto.

Entretanto, “a outra recebe `ConflictError` identificando o item colidente” depende de:

- solicitar e interpretar `CancellationReasons`;
- manter corretamente o índice das ações depois que o wrapper acrescenta o fence;
- distinguir conflito de ponteiro, falha de versão/status do template, Subject inválido e tenant inativo;
- lidar com mais de uma colisão na mesma tentativa.

Mapear rigidamente `CancellationReasons[1]` é frágil. O builder deveria manter metadados entre cada ação e seu item lógico.

#### 8. Existência e estado do Subject não foram fechados

O apply escreve chaves contendo `subjectId`, mas a proposta não diz se há `ConditionCheck` garantindo que o Subject:

- existe;
- pertence ao tenant;
- está em estado que aceita requisitos.

Uma leitura anterior não basta. Se o Subject puder ser apagado ou arquivado concorrentemente, surge outro TOCTOU. Se a entidade já tiver uma regra que torne isso impossível, ela deve ser citada; caso contrário, o check precisa entrar na transação.

#### 9. Itens embutidos precisam de limites de bytes, não apenas quantidade

“Máximo de 40 itens” não protege sozinho contra:

- limite de 400 KB do item DynamoDB;
- payload máximo da transação;
- notas ou nomes excessivamente grandes;
- crescimento futuro da forma do item.

São necessários limites explícitos de comprimento e um teste de pior caso serializado. O cap 40 pode ser adequado, mas sua justificativa atual considera apenas número de ações.

#### 10. Operações do roadmap

As seis operações pedidas estão presentes:

- criação;
- edição;
- duplicação;
- arquivamento;
- preview;
- aplicação.

Desarquivamento e leitura/listagem são complementos razoáveis. Não falta uma operação nominal do roadmap.

Ainda faltam definições operacionais dentro delas:

- aplicação com zero itens criáveis retorna sucesso ou conflito?
- aplicar template arquivado falha com qual código?
- duplicar template arquivado é permitido?
- editar itens de template arquivado é permitido?
- o apply retorna IDs e correspondência item → Requirement?
- nomes duplicados no próprio template são erro em qual nível?

#### 11. Snapshot versus live-link

Snapshot é a escolha correta para esta fatia. A proveniência opcional e não autoritativa também é coerente.

Porém `sourceTemplateAppliedVersion` só é confiável como “versão efetivamente protegida” depois que o apply condicionar a transação a essa versão. Sem isso, é apenas a versão que foi lida antes da corrida.

Também removeria `documentTypeId` desta fatia. Persistir um campo que deliberadamente não é validado nem propagado cria dado morto e potencialmente enganoso. É melhor adicioná-lo quando o vínculo `Requirement → DocumentType` tiver semântica definida.

#### 12. Riscos não nomeados

- Colisão normalizada entre itens do mesmo template.
- Template editado entre planejamento e commit.
- Subject removido/arquivado durante o apply.
- `skip` tornado inválido por rename/delete concorrente.
- Limite de 400 KB e payload de 4 MB.
- Fragilidade do índice de `CancellationReasons`.
- Nome arquivado possivelmente reservado para sempre pelo ponteiro.
- Mudança global de regra de domínio disfarçada como implementação de dedupe.
- `documentTypeId` órfão ou apontando para catálogo inexistente/arquivado.
- Autorização de apply/preview precisa validar acesso ao Subject, não apenas a action RBAC.
- Backfill é ruído neste contexto sem produção; o correto é estabelecer uma baseline limpa ou executar migração como etapa de implantação, sem tratá-la como risco para usuários existentes.

### Ajustes mínimos para aprovação

1. Decidir formalmente se `Requirement.name` será único por Subject.
2. Corrigir a fórmula para `2N + 2`, ou `2N + 3` com Subject check.
3. Condicionar o template por `status = ACTIVE AND version = versão lida`.
4. Validar unicidade normalizada entre itens.
5. Documentar que skips usam um snapshot potencialmente obsoleto, ou protegê-los e recalcular o cap.
6. Fechar a condição transacional do Subject.
7. Definir limites de bytes e testar o pior caso.
8. Remover `documentTypeId` até sua semântica existir.
9. Tornar o mapeamento de cancelamentos estrutural, não dependente de índice fixo.

NOTA CODEX RODADA 1: 6,6/10
