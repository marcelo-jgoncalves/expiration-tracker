# D-328 — Rodada 4 (correções aos 5 achados reais da Rodada 3, nota Codex 7,2/10)

O Codex reproduziu os 5 achados com scripts reais (pausas de I/O controladas, não só simulação
síncrona) - todos verificados e corrigidos, cada um com um teste que reproduz o MESMO interleaving
real (não apenas a condição já sabida), verificado por mutação antes de submeter esta rodada.

## Achado 1 (Alta) - reenvio ainda podia confirmar um desafio novo com o código antigo

Confirmado: a Rodada 3 calculava `(existing?.version ?? 0) + 1` em memória mas ainda escrevia via
`store.update()` INCONDICIONAL - calcular o próximo `version` nunca bastava sem uma escrita
CONDICIONADA de verdade. Interleaving exato do Codex: reenvio lê A/v1 e pausa antes de escrever;
uma tentativa errada avança A para v2; `confirmPhone(A)` lê v2, valida o código e pausa antes de
escrever; o reenvio grava B/v2 (calculado sobre a leitura ANTIGA v1); a confirmação pendente de A
encontra a versão que esperava e confirma B com o código de A.

**Corrigido de verdade**: `requestConfirmation()` agora usa um laço de retry real: primeira
requisição usa `putIfAbsent` (create-once); reenvios usam `buildUnscopedVersionedUpdate()`
condicionado ao `version` lido, com retry limitado (5 tentativas) que relê o estado fresco a cada
conflito. Isso fecha a corrida por completo: o reenvio só grava depois de confirmar que sua leitura
ainda é a mais recente - nunca calcula sobre uma leitura obsoleta e grava cegamente por cima.

Teste novo (`a resend paused right after its own read never overwrites a real confirmation that
lands while it's paused`) reproduz o interleaving com PAUSA REAL de I/O (intercepta
`store.transactWrite`, não apenas simula sincronamente): pausa o reenvio logo após sua leitura,
deixa uma confirmação legítima acontecer de verdade no meio tempo (version avança para 3), e só
então libera a escrita do reenvio - prova que ela detecta o conflito e nunca regride a versão.
Verificado por mutação (reverti temporariamente para `store.update()` incondicional - o teste trava
em timeout, confirmando que ele de fato depende da correção real).

## Achado 2 (Média) - orçamento de tentativas ainda sem proteção suficiente sob concorrência

Confirmado com uma reprodução determinística: 10 tentativas erradas concorrentes, todas lendo o
MESMO snapshot congelado (`attemptCount=4`) antes de qualquer escrita, terminavam em
`attemptCount=9` - o retry loop da Rodada 3 revalidava `version` mas não o orçamento a cada
iteração.

**Corrigido**: `incrementAttemptCountWithRetry()` agora checa `attemptCount >=
WHATSAPP_PHONE_CONFIRMATION_MAX_ATTEMPTS` no INÍCIO de cada iteração do laço, contra o estado
fresco mais recente - para de incrementar assim que o orçamento é esgotado por qualquer chamada
concorrente. Teste novo reproduz deterministicamente o cenário exato do Codex (10 leituras
congeladas em `attemptCount=4` via um wrapper de `store.get()`) e prova `attemptCount` final <= 5.
Verificado por mutação: sem a checagem, o teste falha com `attemptCount=9` - o MESMO número que o
Codex reportou.

## Achado 3 (Média) - retry de confirmação ignorava expiração

Confirmado: `setConfirmedAtWithRetry()` capturava `now` UMA VEZ fora do laço - um conflito de OCC
seguido de uma espera real (mais de 10 minutos) ainda confirmava usando o `now` congelado no
passado.

**Corrigido**: `now` é recapturado a cada iteração do laço, e a expiração do estado fresco é
checada contra ELE (não contra o `now` original) antes de qualquer retry. Teste novo força um
conflito determinístico (uma escrita concorrente entre a leitura e a escrita) e avança o relógio
além do TTL antes do retry - prova rejeição. Verificado por mutação.

## Achado 4 (Alta) - `logoutAll()` podia retornar sucesso sem revogar após esgotar retries

Confirmado: o laço de retry da Rodada 3 esgotava as 5 tentativas e retornava silenciosamente sem
nenhuma escrita ter persistido `globalLogoutAfter` - o BFF prosseguia como se a revogação global
tivesse acontecido.

**Corrigido**: esgotar as tentativas agora lança `DependencyUnavailableError` (retryable), nunca
retorna silenciosamente. Teste novo força conflito em TODA tentativa (`store.transactWrite` sempre
lança `TransactionCanceledException`) e prova que a exceção é propagada, não engolida. Verificado
por mutação.

## Achado 5 (Alta) - watermark de logout podia retroceder

Confirmado: `now` era capturado uma única vez no início - um logout A mais antigo que perdesse a
corrida contra um logout B mais novo já persistido ainda retentava escrevendo seu PRÓPRIO `now`
mais antigo por cima, retrocedendo o watermark de segurança que
`resolve-request-context.ts`'s comparação `issuedAt < globalLogoutAfter` depende.

**Corrigido**: cada iteração do laço checa primeiro se o watermark JÁ persistido é >= `now` - se
sim, a intenção de segurança já está satisfeita e a função retorna sem escrever nada (nunca
regride). Teste novo simula um logout mais antigo perdendo a corrida contra um watermark mais novo
já persistido, e prova que o watermark final permanece o mais novo, nunca regredido. Verificado por
mutação.

## Nota cega (Claude), Rodada 4

Ver `round-4-claude-selfgrade.md` (arquivo separado).
