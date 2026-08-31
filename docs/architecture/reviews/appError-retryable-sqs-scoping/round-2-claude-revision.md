# AppError.retryable — SQS consumer behavior: Round 2 (Claude revision)

Endereça os 3 achados reais do Codex Round 1 (régua 8,5/design 8,7, ambos abaixo do gate).

## Achado 1 — reformulação normativa corrigida

Aceito integralmente. Trocando a alegação "AWS prescreve exclusividade do redrive nativo" por:
**a AWS não oferece, nos exemplos/documentação consultados (`services-sqs-errorhandling.html`,
`with-sqs.html`, WebFetch 2026-08-31), nenhum padrão de classificação de erro por tipo que
justifique adicionar um mecanismo de branching aqui — todo exemplo de referência oficial
(10 linguagens) reporta qualquer exceção capturada como `batchItemFailure` incondicional, e a
doc reconhece `DeleteMessage` explícito como a via alternativa quando um consumidor QUER
terminar uma mensagem sem esperar redrive, mas não a recomenda para classificação de erro.**
Critério 1 do checklist renomeado: "Aderência aos mecanismos documentados e ausência de
necessidade comprovada para um caminho adicional" (peso mantido em 30%).

## Achado 2 — duração não demonstrada, removida

Aceito. `infra/modules/sqs-worker-queue/main.tf:20` (`visibility_timeout_seconds =
consumer_timeout_seconds * 6`) varia por fila conforme o timeout do consumidor — nenhuma duração
fixa é demonstrável a partir só do `maxReceiveCount`. Frase revisada para D-128: "O número de
recepções é limitado a 5 antes do redrive (`maxReceiveCount`, uniforme em todas as filas deste
módulo); o tempo real até o DLQ depende da visibilidade configurada por fila e do comportamento
operacional (backoff) da Lambda, não de uma duração fixa." O argumento econômico (retries
desperdiçados são limitados e não catastróficos) permanece válido sem afirmar uma janela em
minutos.

## Achado 3 — taxonomia como metadado diagnóstico, não base seguraç para política de descarte

Aceito, achado mais forte que o meu original. `toAppError()` (`app-error.ts`, função exportada no
fim do arquivo) converte QUALQUER exceção não reconhecida como `AppError` em `InternalError`
(`retryable:false`) — um timeout de rede inesperado, um erro do AWS SDK não capturado
explicitamente, ou um bug de integração que escape de qualquer `catch` mais específico, todos
colapsam para "terminal". Isso significa que, sob um regime de branching ativo, o próprio
mecanismo de normalização geral do codebase produziria falsos-terminais estruturalmente — não é
um detalhe de uma subclasse mal calibrada, é o comportamento do fallback central. Linguagem
corrigida: `retryable` é **metadado diagnóstico contextual coerente**, não uma política
comprovadamente segura de acknowledgement/descarte de mensagem de fila. Critério 2 do checklist
passa a nomear os dois modos de erro de classificação explicitamente:
- falso-terminal (uma mensagem retryable classificada `false`): sob o regime atual, nenhum efeito
  extra (ainda seria retentada 5x pelo SQS de qualquer forma, porque não há branching); sob um
  regime de branch-and-drop, perda real/pulo de processamento.
- falso-retryable (uma mensagem terminal classificada `true`): até 5 tentativas inúteis e DLQ
  normal — sempre limitado e recuperável, em qualquer regime.

Essa assimetria (o pior caso de um regime SEM branching é sempre limitado; o pior caso de um
regime COM branching pode ser perda real) é o argumento central da proposta — mais forte do que
"nenhum incidente hoje", que era o argumento fraco do Round 1.

## Escopo documental — inventário honesto

Aceito. Existem mais consumidores SQS além dos 3 lidos linha a linha (import, malware,
extração/Textract, upload, document chasing, confirmados por `grep -rl "SQSEvent"
src/runtime/aws/handlers/`). D-128 não afirma mais "10+ filas confirmadas por leitura" — afirma
"o padrão (schema-validate → `batchItemFailure` incondicional em erro) é estrutural, decorrente de
como `SQSBatchResponse`/`batchItemFailures` funciona no SDK (`aws-lambda` types) mais o costume
já formalizado neste codebase (`reminder-dispatch-handler.ts`/`email-delivery-handler.ts` como
referência), não uma alegação de ter lido cada handler individualmente."

## Comentários existentes — correção de redação

Aceito a correção proposta. Os comentários em `reminder-dispatch-handler.ts` e
`email-delivery-handler.ts` que dizem "poison message... not a retryable failure" enquanto ainda
adicionam o item a `batchItemFailures` são logicamente contraditórios lidos ao pé da letra.
Reescrita planejada (Round 3/implementação): "deterministic poison message — will fail identically
on redelivery, but still retried up to `maxReceiveCount` and redriven under the uniform native SQS
policy (D-128: no branching on `retryable` in any SQS consumer)."

## Proposta revisada (decisão inalterada, fundamentação corrigida)

Mantém a conclusão do Round 1: **nenhum branching sobre `retryable` em nenhum handler SQS,
nenhuma chamada direta a DLQ, nenhuma mudança de runtime** — mas agora apoiada em:
1. Ausência de padrão de referência que justifique o mecanismo adicional (não mais "AWS proíbe").
2. Assimetria de blast radius (falso-terminal sob branching pode perder dado; sob o regime atual,
   nunca) como argumento central, não "sem incidente hoje".
3. `retryable` explicitamente redocumentado como metadado diagnóstico, nunca uma política de
   descarte comprovadamente segura — a normalização de `toAppError()` é evidência ativa CONTRA
   uma política de descarte, não apenas neutra.
4. Reavaliação futura condicionada a evidência operacional concreta (saturação de fila, custo
   material, atraso mensurável), não a uma auditoria estática como esta.

`D-128` (`docs/architecture/decisions-log.md`) registra isso; comentários em `app-error.ts` e nos
2 handlers lidos diretamente são corrigidos para a redação não-contraditória acima.
