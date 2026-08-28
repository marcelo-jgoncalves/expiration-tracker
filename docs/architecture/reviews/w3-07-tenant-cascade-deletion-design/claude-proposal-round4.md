# W3-07 — Round 4 (Claude tréplica, respondendo à Rodada 2 do Codex, nota 5,1/10, 9 achados bloqueantes)

Decisão do Marcelo (2026-08-28): fechar a janela de ressurreição com uma pré-condição real,
não um contrato "best-effort". Resolve o núcleo dos achados 4/6/7/8.

## Resolução estrutural — pré-condição: desativar autenticação antes de varrer

`TenantCascadeDeletionService.execute(tenantId)` passa a ter um primeiro passo obrigatório,
antes de qualquer `Scan`: `cognito-idp:AdminDisableUser` real no usuário Cognito do tenant
(MVP `tenantId=userId`) — bloqueia **toda nova autenticação** a partir desse instante (nenhum
login novo, nenhum refresh de token novo aceito pelo Cognito). Isso fecha, por construção, a
classe de achados "escrita nova recria o que o Scan já apagou": toda escrita mutável do sistema
exige uma `RequestContext` resolvida a partir de um token Cognito válido
(`resolveRequestContext`, M1) — sem login novo possível, não há caminho de escrita novo
possível, exceto o resíduo explícito abaixo.

**Resíduo aceito e documentado (não escondido)**: (a) uma requisição já autenticada, em voo no
milissegundo exato do `AdminDisableUser` (token já validado, ainda não processado) — janela de
milissegundos, mesma classe de risco residual que qualquer sistema real de exclusão aceita; (b)
trabalho assíncrono **já enfileirado** para o tenant antes do disable (uma mensagem SQS de
`reminder-dispatch`/`notification-router` já em voo) — não depende de login novo, então o
disable não a impede. Mitigação para (b), proporcional sem reabrir bloqueio imediato de leitura
em todo o sistema: a Rodada de convergência (abaixo) já resolve isso na prática, porque essas
mensagens produzem exatamente as linhas (`NotificationIntent`/`OutboxEvent`/`NotificationAttempt`)
que o próprio Scan de convergência re-descobre e apaga na passagem seguinte — o filtro está
fechado para escrita NOVA (via login), não para o dreno natural de fila já em voo, que por
definição é finito e curto (segundos a poucos minutos, não indefinido).

Isso também resolve o achado 6 (convergência) de fato, não só "limita no tempo": depois do
`AdminDisableUser`, a única fonte de escrita nova possível é o resíduo (b), finito por natureza
(fila drena e some) — `maxPasses` deixa de ser um limite arbitrário para lidar com um problema
sem fim e passa a ser exatamente o número de vezes necessário para drenar filas já em voo, que
é pequeno e mensurável (proposto: 5 passagens com backoff crescente, generoso vs. o tempo de
retry máximo das filas envolvidas).

## Resolução achado 1 (TenantEntitlement omitido) + inventário corrigido de novo

Confirmado, omissão real. `TenantEntitlement` (`entitlement.ts`) tem `tenantId`+`version` →
categoria OCC-versionada.

## Resolução achado 2 (`DeviceSession`) e achado 3 (`LoginAttempt`)

Ambos confirmados incorretos, corrigidos por releitura direta:
- **`DeviceSession`** (`user-repository.ts`): sem `version`, atualizado por `PutItem`
  incondicional (`upsertDeviceSession`/`logoutDevice`) → move para categoria **sem versão**
  (existência apenas). Com o `AdminDisableUser` já aplicado (resolução estrutural acima), não há
  mais `PutItem` novo possível recriando a linha depois do delete — o achado original ("um
  PutItem concorrente pode recriar a linha") deixa de se aplicar.
- **`LoginAttempt`**: tem `version`, mas **não tem `tenantId`** (nasce antes da resolução de
  tenant, mesma razão estrutural de `GuestTokenPointer`'s exceção documentada). Verificado:
  `LoginAttempt` já carrega TTL real (`session.ts`, mesmo mecanismo de `purgeAfterTtl`) — move
  para a categoria **excluída do Scan, autopurgável** (mesma justificativa de
  `GuestTokenRateLimit`): não é dado de tenant atribuível por este mecanismo, já se
  autoextingue, e é um registro de TENTATIVA de login (não guarda sessão nem token de longa
  duração) — risco residual desprezível mesmo sem ser tocado por esta cascata.

## Resolução achado 4 (`TenantQuota` mutável) e achado 5 (`OutboxEvent`/`IdempotencyRecord` mutáveis)

Com o `AdminDisableUser` prévio, não há mais consumo de quota novo (toda consulta a quota
acontece dentro de uma requisição HTTP autenticada) — `TenantQuota` pode ficar na categoria
**sem versão** (existência apenas) com segurança agora. `OutboxEvent`/`IdempotencyRecord`
continuam nessa mesma categoria, mas com a ressalva explícita de que a convergência (resíduo b
acima) é o mecanismo que os torna seguros de apagar — uma passagem de convergência que ainda
encontra `OutboxEvent`s do tenant indica fila ainda drenando, não erro; só depois de uma
passagem que já não encontra nenhum é que `COMPLETED` é declarado.

## Resolução achado 7 (segunda tabela / `bff-session-table`)

O `AdminDisableUser` fecha a criação de sessões NOVAS (login/callback exigem um código de
autorização Cognito válido, que deixa de ser emitido). Sessões já existentes na
`bff-session-table` são apagadas pela mesma passagem de descoberta (categoria OCC-versionada
para `Session`, sem versão para `DeviceSession`) — nenhuma pode ser recriada depois, pelo mesmo
argumento estrutural.

## Resolução achado 8 (fence de `Document` perdido antes do S3)

Aceito — a proposta anterior perdia exatamente a disciplina que tornava W3-06 seguro. Corrigido:
candidatos `Document` encontrados pelo Scan **não são apagados diretamente** por
`TenantCascadeDeletionService` — em vez disso, o serviço escreve o MESMO ponteiro
`GSI6PK/GSI6SK = WORKSTATE#PURGE_PENDING` que `DocumentDeletionService` já escreve
(`document-store.ts`, `buildDocumentPurgeGsi6Sk`), com `purgeAfter = now`, e deixa o
`DocumentPurgeWorker` já existente (W3-06, claim→S3→delete, na ordem correta) processar essas
linhas pelo mecanismo já revisado e aprovado (9,2/10) — **única exceção deliberada** à decisão
da Rodada 2 de não usar GSI6: só para `Document`, porque é a única categoria com efeito
colateral S3 real que já tem um mecanismo seguro construído e revisado para exatamente isso.
Reusar > duplicar. Todas as outras categorias (OCC-versionada sem S3, sem versão) continuam
sem GSI6, delete direto condicionado, como as Rodadas 2/3 desenharam.

## Resolução achado 9 (lifecycle do `TenantDeletionRequest`)

`TenantDeletionRequest` vive fora do universo varrido: `entityType <> "TenantDeletionRequest"`
é uma cláusula fixa do `FilterExpression` do Scan (nunca descoberto, nunca apagado por engano),
e é o **único** registro que sobrevive deliberadamente à exclusão do tenant — tombstone
auditável mínimo (`tenantId`, `requestedAt`, `completedAt`, `passesRun`, sem nenhum dado do
tenant em si). Sua própria retenção (quanto tempo esse tombstone em si persiste) fica registrada
como pendência textual explícita, não resolvida aqui — mesma disciplina de escopo do W3-06 para
o `DocumentPurgeReceipt` original antes de D-061 definir `DELIVERY_RECORD`/180 dias (pode reusar
a mesma classe futuramente, decisão de quem implementar).

## Estado do design após Rodada 4

Pré-condição estrutural (`AdminDisableUser`) fecha achados 4/6/7 pela raiz, não por limite de
tempo. Achados 1/2/3/9 corrigidos por releitura direta. Achado 8 resolvido reusando o mecanismo
já aprovado do W3-06 para `Document` especificamente, em vez de duplicar sua disciplina de
fence. Peço reavaliação completa.
