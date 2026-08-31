# Round 3 — Claude tréplica / fechamento

Codex Round 2: 9,6/10, aprovado, sem achado bloqueante. Uma precisão sugerida (não bloqueante):
preferir "pulo do processamento normal / terminalidade antecipada indevida" a "perda real" quando
a alternativa hipotética fosse enviar explicitamente ao DLQ (a mensagem ainda existiria lá,
recuperável por replay manual do DLQ — a perda real seria só se o design hipotético também a
descartasse sem DLQ). Aceito e incorporado na redação final de D-128 abaixo.

**Claude self-grade Round 3 (registrado antes de reler o texto de fechamento do Codex acima,
mantendo nota cega mesmo nesta rodada de convergência): 9,3/10.** Motivo de não ser mais alto:
a proposta segue sem cobrir explicitamente os handlers de import/malware/extração além dos 2 lidos
linha a linha — aceitável para a decisão (que é uniforme e não depende de detalhe por handler),
mas a redação de comentário só será corrigida nos 2 handlers efetivamente lidos, deixando os
demais com a mesma leve imprecisão textual ("poison message... not retryable" + ainda reportado
como batch failure) sem correção nesta sessão — registrado como lacuna consciente, não erro.

## Estado final consolidado

**Decisão**: nenhum handler SQS deste sistema passa a ramificar (`if`) sobre
`AppError.retryable`. O mecanismo real de retry-vs-terminal continua sendo exclusivamente o
nativo do SQS (`maxReceiveCount=5` uniforme, `infra/modules/sqs-worker-queue/main.tf`) + DLQ
redrive. Nenhuma chamada SQS explícita nova (nenhum `SendMessage` direto ao DLQ, nenhum
`DeleteMessage` antecipado por classificação). `retryable` permanece metadado diagnóstico/log,
nunca policy de acknowledgement.

**Por quê**: (1) nenhum padrão de referência (AWS Lambda+SQS docs, WebFetch 2026-08-31) sugere
esse mecanismo como necessário — todo exemplo oficial multi-linguagem trata qualquer exceção
uniformemente; (2) a assimetria de blast radius favorece decisivamente não-branch: um
falso-terminal sob o regime atual não tem efeito extra (a mensagem é retentada normalmente de
qualquer forma), enquanto sob um regime de branch-and-terminate um falso-terminal pularia
processamento devido/adiaria indevidamente a terminalidade de uma mensagem legitimamente
retryable; (3) `toAppError()`'s fallback (`InternalError`, `retryable:false` para qualquer erro
não reconhecido) é evidência ativa de que a taxonomia não foi desenhada/auditada como política de
descarte segura — um timeout de rede inesperado colapsaria para "terminal" sob um regime de
branching; (4) `maxReceiveCount=5` já limita o custo de uma mensagem verdadeiramente poison a um
número pequeno e fixo de tentativas, sem incidente operacional real registrado que justifique a
complexidade/IAM extra de um caminho de roteamento paralelo.

**Classificação de `app-error.ts`**: nenhuma inconsistência real encontrada na taxonomia existente
(auditada: toda subclasse de validação/regra de negócio/autorização é `false` corretamente
determinística; `DependencyUnavailableError` default `true` corretamente; a única exceção,
`ExtractionCommitFailedError` com `true`, é correta pela documentação própria — falha de commit
pós-sucesso do Textract é candidata legítima a retry). Nenhuma mudança de classificação proposta
ou necessária.

**Blast radius / rollback de errar esta decisão**: baixo e simétrico. Se uma auditoria futura
achar evidência operacional real (fila saturada por poison messages, custo de invocação
mensurável, atraso relevante em fila sensível a SLA), a decisão é revisitável isoladamente por
fila/handler sem depender de reabrir esta rodada inteira — rollback é trivial porque nenhuma
mudança de runtime foi feita (só documentação/comentários), não há infraestrutura nova para
desfazer.

**Escopo da implementação desta sessão**: apenas documentação — reescrita dos comentários de
`AppError`/`isRetryable()` em `src/shared/errors/app-error.ts` (de "pendência" para "decidido, ver
D-128") e correção da redação contraditória em `reminder-dispatch-handler.ts`/
`email-delivery-handler.ts` (os 2 handlers efetivamente lidos linha a linha nesta rodada).
Nenhuma mudança de comportamento de runtime, nenhum teste novo necessário (comportamento
inalterado), nenhum touch em `infra/`.

**Gate atingido**: Claude 9,3/Codex 9,6 — ambos ≥9,0 sem arredondar. Protocolo `AGENTS.md` §4
completo em 3 rodadas (mínimo cumprido, convergência real na Rodada 2, tréplica de fechamento na
Rodada 3).
