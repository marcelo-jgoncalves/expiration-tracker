tokens used
33.163
## Veredito

A v2 incorporou substancialmente as contestações; não foi mera reescrita. Porém, a reconciliação ainda transforma algumas escolhas do próprio design em critérios prescritivos e deixa lacunas em bytes, leitura completa do Subject e classificação de cancelamentos.

### 1. Régua v2

Melhorias reais:

- reduziu snapshot de 25% para 15%;
- removeu “não versionar” como critério de qualidade;
- elevou atomicidade e incluiu ações, bytes e reserva;
- passou a exigir decisão explícita sobre unicidade;
- separou equivalência algorítmica de equivalência temporal;
- incorporou fence de versão, estado do Subject, unicidade interna e mapeamento estrutural de cancelamentos.

Ainda há problemas:

1. **C3 é excessivamente fechado à implementação proposta.** “As três janelas reais” presume que `status <> DELETED` significa Subject ativo e que unicidade interna é necessariamente a terceira maior janela. O critério deveria exigir consistência transacional dos objetos participantes, deixando a expressão exata depender do modelo de estados.

2. **C2 ainda não define corretamente o que medir em bytes.** “Pior caso serializado” precisa dizer bytes UTF-8 e tamanho DynamoDB, não tamanho de string JSON. Também deveria separar:

   - tamanho do item `RequirementTemplate`;
   - tamanho de cada `Requirement`;
   - soma dos itens da transação;
   - overhead de nomes de atributos, chaves e índices.

3. **C5 premia uma solução específica.** Exigir `expectedTemplateVersion` é razoável, mas preview honesto poderia ser atendido por outro contrato igualmente correto. A régua deveria avaliar a garantia, não o parâmetro escolhido.

4. **C7 é estreito.** Metadados estruturais são necessários, mas não suficientes: a régua deveria cobrar cobertura do fence acrescentado pelo wrapper, precedência justificável e classificação não enganosa sob nova corrida.

5. **Falta completude da leitura de planejamento.** Preview/apply precisam ler todos os requisitos relevantes, com paginação explicitamente esgotada. Caso contrário, o ponteiro preserva integridade, mas o “plano” e a resposta de `skipped` podem ser incompletos.

A régua ficou boa, mas ainda está parcialmente ajustada para declarar vencedor este design específico.

**Nota da régua v2: 8,3/10.**

### 2. Fechamento dos 12 achados

1. **Contagem de ações — fechada na fórmula principal, mas com nova inconsistência.**  
   `2N + 3` está correto para N criações. Porém, a justificativa da reserva está errada: se o template tem no máximo 30 itens, não é possível ter simultaneamente 30 criações e 30 skips. Com `C + S ≤ 30`, proteger skips custaria:

   ```text
   2C + S + 3
   ```

   cujo máximo continua sendo 63, quando `C = 30`. Os alegados 93 representam 60 itens lógicos, violando o cap. A reserva de 37 existe, mas seu propósito declarado não sustenta o cap 30.

2. **Fence de versão — bem fechado.**  
   `status = ACTIVE AND version = :expected` protege a versão materializada e torna a proveniência confiável.

3. **Skips não serializáveis — fechado por escolha explícita, mas com contrato incompleto.**  
   Aceitar skip obsoleto é defensável. Entretanto, o resultado deveria deixar claro que `skipped` significa “observado como duplicado durante o planejamento”, e não necessariamente “continuava duplicado no commit”.

4. **Preview não equivalente — substancialmente fechado.**  
   A distinção algorítmica/temporal está correta. Permanece aberta a concorrência nos requisitos do Subject, adequadamente reconhecida. Falta especificar paginação/completude da leitura.

5. **Unicidade interna — bem fechado.**  
   Validação em create, update, duplicate e planner é a cobertura correta.

6. **Custo e regra global do ponteiro — formalmente fechado, justificativa de domínio apenas moderada.**  
   A regra foi finalmente decidida e os escritores foram enumerados. Mas “dois requisitos homônimos são necessariamente o mesmo dever” é uma decisão forte, não consequência lógica da descrição da entidade. Período, jurisdição ou contexto poderiam distinguir deveres homônimos. É aceitável como decisão deliberada, mas não está demonstrada como verdade inerente ao domínio.

7. **`CancellationReasons` — parcialmente fechado.**  
   `labels` resolve os índices frágeis das ações montadas localmente. Não resolve completamente o fence de tenant acrescentado pelo wrapper, que não possui label. A afirmação de que “os índices permanecem estáveis no prefixo” não basta para classificar a razão adicional.

8. **Estado do Subject — parcialmente fechado.**  
   `attribute_exists(PK) AND status <> DELETED` garante existência e “não deletado”, não necessariamente “ativo”. Isso diverge da própria régua, que exige existir/estar ativo. O design precisa declarar todos os estados de `TrackedSubject` e quais aceitam criação de Requirement.

9. **Limites de bytes — mal fechado.**  
   A estimativa de aproximadamente 70 KB assume aproximadamente um byte por caractere e ignora parte do overhead DynamoDB. Com UTF-8, 200 e 2.000 caracteres podem ocupar até quatro vezes mais bytes. Além disso, `JSON.stringify(...).length` não mede bytes e o tamanho JSON não é exatamente o tamanho contabilizado pelo DynamoDB. O limite provavelmente ainda cabe, mas a demonstração fornecida não prova isso.

10. **Semântica operacional — bem fechada.**  
    As respostas são coerentes, inclusive zero criações como sucesso e duplicação de arquivado.

11. **Proveniência e `documentTypeId` — bem fechado.**  
    O fence dá significado à versão aplicada e o campo morto foi removido.

12. **Riscos não nomeados — majoritariamente fechado.**  
    Skip obsoleto e autorização foram explicitados. Permanecem insuficientemente tratados os riscos de leitura paginada/incompleta, cálculo real de bytes e diagnóstico racy do cancelamento.

### 3. Achados novos

1. **A reserva do cap 30 está fundamentada em aritmética impossível.**  
   Proteger todos os skips não leva a 93 ações sob um template limitado a 30 itens.

2. **O teste de 200 KB pode contradizer o schema.**  
   Se usar bytes UTF-8 e entradas Unicode de pior caso, valores válidos pelo limite em caracteres podem superar 200 KB. Nesse caso, o teste reprova um estado que o serviço promete aceitar. É preciso limitar bytes ou ajustar formalmente o limiar.

3. **Leitura completa dos requisitos não foi especificada.**  
   Se a consulta for paginada e o serviço ler apenas uma página, preview omite skips e apply tenta criar ponteiros existentes, abortando tudo com 409. Integridade permanece, mas a semântica do planejamento falha.

4. **Consistência de leitura também precisa ser declarada.**  
   Uma leitura eventualmente consistente pode omitir uma criação já confirmada. O ponteiro evita duplicata, mas transforma um caso que deveria aparecer como skip em cancelamento total. Isso pode ser aceito, mas precisa estar no contrato operacional.

5. **Precedência não resolve diagnóstico racy.**  
   Após falha do fence composto, reler o template para distinguir “arquivado” de “editado” é apenas uma inferência sobre o estado posterior. Ele pode mudar novamente entre cancelamento e releitura. A API não deve afirmar uma causa histórica que o DynamoDB não revelou.

6. **Fence do tenant não participa do modelo estrutural.**  
   O builder devolve labels apenas para seu prefixo. O wrapper deveria acrescentar também o metadado da ação, ou o erro de tenant precisa ser tratado explicitamente fora desse pareamento.

7. **`createRequirement` muda de contrato sem semântica de erro totalmente descrita.**  
   Agora ele pode falhar porque o Subject não existe/não aceita requisitos, além de conflito de nome e OCC. Falta declarar precedência entre Subject inválido, ponteiro ocupado, versão divergente e tenant inativo.

8. **`status <> DELETED` pode aceitar estados indevidos.**  
   Se existirem `ARCHIVED`, `INACTIVE`, `SUSPENDED` ou equivalentes, todos passam. A condição deve enumerar estados permitidos ou o design deve provar que só existem ACTIVE e DELETED.

## Nota do design v2

O núcleo está muito melhor: fence de versão, atomicidade, unicidade interna, regra global de nome, operações e snapshot estão agora coerentes. Ainda assim, cálculo de bytes, cap/reserva, estado do Subject e cancelamentos não estão fechados no nível necessário para uma nota acima de 9.

**Nota do design v2: 8,1/10.**

NOTA CODEX RODADA 2 - REGUA: 8,3/10  
NOTA CODEX RODADA 2 - DESIGN: 8,1/10
