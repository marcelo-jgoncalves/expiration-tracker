# Expiration Tracker — Proposta de Melhoria do Design correlationId ↔ X-Ray Trace

**Data:** 2026-08-29  
**Base:** `expiration-tracker-correlationid-trace-join-design-2026-08-29.md`  
**Status desta proposta:** revisão complementar ao design aprovado; nenhuma implementação realizada.

---

# 1. Parecer geral

O design aprovado para criar a junção operacional entre:

```text
correlationId
↔
X-Ray trace
```

é tecnicamente sólido, proporcional ao problema e compatível com o estado atual do Expiration Tracker.

A opção escolhida — ler `_X_AMZN_TRACE_ID`, extrair campos estruturados e adicioná-los ao `SecureLogger` — é preferível neste momento à introdução de uma nova dependência OpenTelemetry apenas para anotar spans.

O design atual deve ser mantido como base.

No entanto, quatro melhorias podem torná-lo mais forte sem aumentar significativamente sua complexidade:

1. validar rigidamente o `Root` antes de expô-lo como `xrayTraceId`;
2. documentar que `correlationId ↔ xrayTraceId` não é necessariamente uma relação 1:1;
3. proteger campos derivados da runtime contra sobrescrita por metadata fornecida pelo caller;
4. adicionar um smoke test real em `dev` provando a junção operacional.

---

# 2. O que deve permanecer do design atual

Manter as seguintes decisões:

```text
correlationId
≠
X-Ray traceId
```

Os dois conceitos continuam distintos.

`correlationId` é uma identidade de correlação da aplicação e do fluxo de negócio.

`xrayTraceId` representa a identidade de tracing gerada pela infraestrutura de observabilidade.

A nova funcionalidade apenas cria uma ponte operacional entre eles.

Também devem permanecer:

- ADOT/X-Ray como mecanismo de tracing;
- ausência de instrumentação manual de clientes AWS SDK;
- ausência de `aws-xray-sdk-core`;
- ausência de nova dependência OpenTelemetry nesta etapa;
- parsing em função pura;
- leitura de `_X_AMZN_TRACE_ID` em runtime;
- nenhum cache global desse valor;
- `Lineage` ignorado;
- comportamento fail-open do logger;
- ausência dos campos quando o header estiver ausente ou inválido.

---

# 3. Melhoria 1 — validar `Root` rigidamente

O design atual propõe aceitar `Root` sempre que o campo estiver presente.

Recomendação:

> O valor só deve ser publicado como `xrayTraceId` se passar por validação sintática do formato documentado do AWS X-Ray.

Formato esperado:

```text
1-xxxxxxxx-xxxxxxxxxxxxxxxxxxxxxxxx
```

Em termos conceituais:

```text
versão 1
+
8 caracteres hexadecimais
+
24 caracteres hexadecimais
```

Uma regex equivalente pode ser:

```text
^1-[0-9a-fA-F]{8}-[0-9a-fA-F]{24}$
```

Comportamento desejado:

```text
Root válido
→ xrayTraceId presente

Root inválido
→ xrayTraceId omitido

parser
→ nunca lança
```

## Justificativa

O campo pode trafegar a partir de contexto externo à aplicação.

Não é desejável colocar um valor arbitrário nos logs estruturados sob um nome que implica ser um trace ID confiável.

A validação é barata, determinística e reduz ambiguidade operacional.

---

# 4. Interface recomendada do parser

O contrato pode continuar equivalente a:

```ts
export interface XrayTraceHeaderFields {
  xrayTraceId?: string;
  xraySampled?: boolean;
  xrayParentId?: string;
}

export function parseXrayTraceHeader(
  raw: string | undefined
): XrayTraceHeaderFields | undefined;
```

Regras recomendadas:

```text
split por ";"
↓
split de cada elemento no primeiro "="
↓
não depender da ordem
```

## Root

```text
válido segundo formato X-Ray
→ xrayTraceId

inválido
→ omitido
```

## Sampled

Aceitar apenas:

```text
"0" → false
"1" → true
```

Qualquer outro valor:

```text
omitido
```

## Parent

Aceitar apenas:

```text
16 caracteres hexadecimais
```

Caso contrário:

```text
omitido
```

## Lineage

Sempre ignorado.

## Header ausente ou sem campos válidos

Retornar:

```text
undefined
```

---

# 5. Melhoria 2 — cardinalidade entre correlationId e xrayTraceId

A documentação deve deixar explicitamente registrado que:

> **correlationId e xrayTraceId não possuem necessariamente uma relação 1:1.**

Isso é especialmente importante porque o Expiration Tracker possui processamento assíncrono.

Exemplo:

```text
HTTP request
correlationId = C1
trace = X1

↓ outbox / SQS

worker
correlationId = C1
trace = X2

↓ Step Functions

outro Lambda
correlationId = C1
trace = X3
```

Nesse caso:

```text
C1
→ X1
→ X2
→ X3
```

continua representando um único fluxo lógico de negócio.

Também podem existir situações batch nas quais uma invocação técnica possua relação com mais de um item lógico.

Portanto, a junção deve ser descrita como:

> **relação observacional entre contexto de aplicação e contexto de tracing**

e não:

> identidade equivalente.

---

# 6. Fluxo operacional esperado

A principal experiência operacional deve ser:

## Partindo do correlationId

```text
correlationId
↓
CloudWatch Logs
↓
linha de log contém xrayTraceId
↓
consultar X-Ray
↓
analisar execução distribuída
```

## Partindo do trace

```text
xrayTraceId
↓
CloudWatch Logs
↓
obter correlationId
↓
seguir o fluxo lógico da aplicação
```

A feature deve ser avaliada pelo quanto ela melhora esse workflow.

---

# 7. Melhoria 3 — campos de runtime devem ser reservados

É necessário verificar como `SecureLogger.write()` combina atualmente:

```text
context
metadata
runtime-derived fields
```

Os campos abaixo devem ser tratados como reservados:

```text
correlationId
tenantId
xrayTraceId
xraySampled
xrayParentId
```

Um caller não deve conseguir sobrescrevê-los acidental ou deliberadamente por metadata arbitrária.

Exemplo que não pode vencer o valor real:

```ts
logger.info("something", {
  xrayTraceId: "fake-value"
});
```

A precedência recomendada é:

```text
caller metadata
↓
application context
↓
runtime-derived reserved fields
```

ou outro mecanismo equivalente que garanta:

> **campos confiáveis produzidos pelo logger vencem metadata arbitrária.**

---

# 8. Melhoria 4 — smoke test real em dev

Os testes unitários do parser são necessários, mas não suficientes para provar o objetivo final.

O objetivo real da feature é:

```text
log
↔
X-Ray trace
```

Portanto, após implementação e testes locais, deve existir um smoke test real em `dev`.

## Procedimento recomendado

```text
1. Deploy da mudança em dev.

2. Invocar uma Lambda com tracing ativo.

3. Localizar uma linha gerada pelo SecureLogger.

4. Confirmar:
   correlationId presente
   xrayTraceId presente
   xraySampled = true

5. Copiar xrayTraceId.

6. Consultar o trace correspondente no X-Ray.

7. Confirmar que o trace representa a mesma invocação/operação.

8. Registrar evidência reproduzível.
```

Resultado:

```text
UNIT TESTED
→ parser funciona

E2E / INTEGRATION PROVEN
→ join operacional realmente funciona
```

Essa distinção deve continuar explícita na documentação.

---

# 9. Sampling

A documentação deve preservar explicitamente:

```text
xraySampled = false
```

não implica falha da integração.

Significa que aquela invocação não possui necessariamente um trace persistido e consultável no X-Ray.

Portanto:

```text
header válido
+
xrayTraceId válido
+
xraySampled = false
```

pode aparecer legitimamente no log.

A feature não deve alegar:

> todo correlationId sempre terá trace consultável.

A alegação correta é:

> quando houver contexto X-Ray válido, o logger registra a identidade do trace; a disponibilidade posterior do trace depende da política de sampling.

---

# 10. xrayParentId — decisão de simplificação opcional

`Parent` não é necessário para cumprir o requisito principal.

O join operacional exige essencialmente:

```text
correlationId
xrayTraceId
xraySampled
```

`xrayParentId` pode oferecer informação diagnóstica adicional, mas seu significado deve ser documentado corretamente.

Ele representa o contexto parent recebido no header.

Não deve ser apresentado como:

```text
span atual desta linha de log
```

Caso se deseje reduzir ruído, uma opção válida é remover `xrayParentId` da primeira implementação.

Essa é uma otimização de simplicidade, não um blocker.

---

# 11. Testes unitários recomendados

Adicionar casos para:

## Header completo

```text
Root válido
Parent válido
Sampled=1
```

## Ordem diferente

```text
Parent
Sampled
Root
```

deve produzir o mesmo resultado.

## Sem header

```text
undefined
""
```

→ `undefined`.

## Root inválido

Exemplos:

```text
Root=abc
Root=1-foo-bar
Root=<tamanho incorreto>
```

→ omitir `xrayTraceId`.

## Sampled inválido

```text
Sampled=yes
Sampled=2
Sampled=
```

→ omitir apenas `xraySampled`.

## Parent inválido

```text
Parent=foo
Parent=123
Parent=ZZZZZZZZZZZZZZZZ
```

→ omitir apenas `xrayParentId`.

## Lineage

```text
Lineage=...
```

→ ignorado.

## Campos desconhecidos

Devem ser ignorados.

## Parser nunca lança

Fuzz/simple malformed cases devem confirmar comportamento fail-open.

---

# 12. Teste de precedência do logger

Adicionar regression test provando:

```text
caller envia:

{
  xrayTraceId: "fake",
  xraySampled: false
}
```

mas:

```text
process.env["_X_AMZN_TRACE_ID"]
```

contém um contexto válido.

Resultado esperado:

```text
log contém valores derivados da runtime,
não os valores falsos do caller.
```

Esse teste protege a confiabilidade semântica dos campos.

---

# 13. Opção OpenTelemetry continua adiada

Manter a alternativa futura:

```text
app.correlationId
```

como atributo/annotation do span.

Não implementar agora.

Pré-requisitos continuam sendo:

1. provar localmente que `trace.getActiveSpan()` captura o span esperado;
2. provar em `dev` que o atributo é exportado;
3. decidir explicitamente metadata vs X-Ray annotation pesquisável.

Somente depois desses três pontos deve ser considerada uma evolução em que:

```text
correlationId
→ busca direta no X-Ray
```

A solução atual já oferece valor suficiente sem essa complexidade.

---

# 14. Nenhuma mudança recomendada para M5

Esta melhoria não exige reabrir:

```text
ADOT Lambda layer
X-Ray active tracing
instrumentação automática
decisão de não usar aws-xray-sdk-core
decisão de não instrumentar AWS SDK manualmente
```

O trabalho é apenas uma extensão do logging estruturado.

Portanto:

> **o design deve ser tratado como aditivo ao M5, não como revisão da arquitetura de tracing.**

---

# 15. Impacto esperado

| Área | Impacto |
|---|---|
| Domínio | nenhum |
| DynamoDB | nenhum |
| APIs | nenhum |
| Auth | nenhum |
| IAM | nenhum |
| Terraform | provavelmente nenhum |
| Runtime dependency | nenhuma |
| Logging | pequena alteração |
| Observabilidade | melhoria significativa |
| Testes | pequenos e determinísticos |
| Deploy | baixo risco |

---

# 16. Prioridade recomendada

Classificação:

```text
baixo esforço
+
baixo risco
+
valor transversal
```

A mudança não deve interromper milestones críticos grandes.

Porém, também não parece apropriado deixá-la indefinidamente no backlog.

À medida que o sistema adiciona mais:

- SQS;
- outbox;
- guest workflows;
- reminder workers;
- malware processing;
- imports;
- Step Functions;
- Textract;

o valor de troubleshooting dessa junção aumenta.

Portanto, é um bom candidato a pequeno milestone de observabilidade.

---

# 17. Critérios de aprovação da implementação

Considerar a implementação completa somente quando:

```text
parser implementado
+
Root validado
+
Sampled validado
+
Parent validado ou deliberadamente removido
+
Lineage ignorado
+
SecureLogger integrado
+
campos reservados protegidos
+
unit tests passando
+
lint/typecheck passando
+
smoke test em dev executado
+
correlationId → xrayTraceId → trace provado
+
documentação atualizada
```

---

# 18. Status de evidência esperado

Depois de apenas código + testes locais:

```text
IMPLEMENTED
UNIT TESTED
```

Depois do deploy:

```text
DEPLOYED
```

Depois do smoke real:

```text
INTEGRATION / E2E PROVEN
```

Não declarar:

```text
OPERATIONALLY PROVEN
```

sem evidência operacional suficiente além do smoke inicial.

---

# 19. Parecer final

A implementação deve seguir a Opção D já aprovada:

> **extrair e registrar de forma estruturada o contexto `_X_AMZN_TRACE_ID` no `SecureLogger`, sem nova dependência ou mudança da instrumentação ADOT/X-Ray.**

Antes da implementação, recomenda-se incorporar quatro melhorias:

```text
1. validar rigidamente Root;

2. documentar que correlationId ↔ xrayTraceId
   não é necessariamente 1:1;

3. reservar e proteger os campos derivados da runtime;

4. exigir smoke E2E em dev comprovando a junção real.
```

Essas mudanças fortalecem o design sem alterar sua filosofia original.

A proposta permanece:

```text
simples
aditiva
baixo risco
sem nova infraestrutura
sem nova dependência
alto valor operacional
```

e está bem alinhada com o padrão atual de engenharia do Expiration Tracker:

> **resolver uma lacuna operacional real com o menor mecanismo capaz de fornecer evidência verificável.**
