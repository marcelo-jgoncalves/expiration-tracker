# D-328 — Rodada 3 (correções aos 5 achados reais da Rodada 2, nota Codex 7,2/10)

Verifiquei os 5 achados (2 Alta, 3 Média) com testes reprodutíveis do próprio Codex - todos reais,
nenhum contestado. Corrigidos todos os 5.

## Achado 1 (Alta) - `version` reiniciava a 1 em cada reenvio, quebrando a identidade da condição OCC

Reproduzido exatamente como o Codex descreveu: `requestConfirmation()` sempre reescrevia com
`version: 1` incondicionalmente. Uma escrita PENDENTE de `confirmPhone()` para o desafio ANTERIOR
(que já validou o código velho contra o hash velho, e ia escrever `confirmedAt` condicionado ao
`version` que leu) podia coincidir com o `version: 1` do desafio NOVO pós-reenvio e confirmar o
desafio ERRADO com o código VELHO - a "correção" da Rodada 2 protegia contra concorrência DENTRO de
um desafio, mas não identificava genuinamente QUAL desafio estava sendo confirmado.

**Corrigido**: `buildWhatsAppPhoneConfirmation()` agora recebe `version` como parâmetro obrigatório;
`requestConfirmation()` sempre calcula `(existing?.version ?? 0) + 1` - MONOTÔNICO, nunca reiniciado
a 1. Uma escrita OCC condicionada ao `version` de um desafio anterior agora falha sempre que um
reenvio aconteceu, porque o número real avançou, não porque coincidem ou não por acaso. Teste novo
reproduz a corrida diretamente (captura o `version` do desafio antigo, força um reenvio, tenta a
mesma escrita condicionada que o `confirmPhone()` pendente teria feito) - verificado por mutação
(reverter para `version: 1` fixo faz o teste falhar, confirmado manualmente antes de submeter esta
revisão).

## Achado 2 (Alta) - atalho `confirmedAt` sem checar expiração, replay 24h depois restaura número anterior

Reproduzido: a Rodada 2 corrigiu o atalho para checar o hash do código, mas não a expiração. Um
código já confirmado, reenviado pelo cliente 24h depois (ou guardado por um atacante), ainda
re-executava `setPhoneNumber()`/`recordOptIn()` - se um telefone B tivesse sido confirmado depois
de A, esse replay do desafio de A restaurava A como número atual.

**Corrigido**: o atalho `existing.confirmedAt` agora TAMBÉM checa `isWhatsAppPhoneConfirmationExpired()`
antes de qualquer coisa (mesma checagem já feita no branch de primeira confirmação, agora também
aqui) - um replay do código correto além dos 10 minutos de TTL lógico é rejeitado, independente de
quando a limpeza física do DynamoDB acontece.

## Achado 3 (Média) - incremento de `attemptCount` desistia no primeiro conflito, 20 tentativas concorrentes contabilizadas como 1

Reproduzido: a Rodada 2 corrigiu a escrita para ser condicionada, mas ao perder a corrida
simplesmente desistia (raciocínio errado: "a outra escrita já consumiu o orçamento" - consumiu o
orçamento de OUTRA chamada, não desta).

**Corrigido**: `incrementAttemptCountWithRetry()` - laço de retry limitado (5 tentativas): cada
iteração relê o estado fresco e tenta incrementar A PARTIR DELE, garantindo que cada chamada real
tente consumir seu próprio slot em vez de desistir na primeira colisão. Para de retentar (sem
reincrementar) se o `codeHash` mudou - significa que um reenvio trocou o desafio, e o orçamento de
tentativas da chamada original não se aplica mais a um desafio diferente.

## Achado 4 (Média) - `logoutAll()` podia restaurar um telefone anterior (não `logoutDevice()`, correção do meu próprio erro)

Reproduzido, com a correção justa do Codex: minha Rodada 2 tinha erroneamente incluído
`logoutDevice()` como concorrente de `GlobalUser` - ele escreve `SESSION#<deviceId>`, um item
DIFERENTE, nunca concorrente do `PROFILE`. O concorrente REAL é `logoutAll()`: `PutItem`
incondicional do objeto inteiro, podia ler telefone A/versão 1, esperar `setPhoneNumber()`
confirmar B/versão 2, e sobrescrever de volta para A/versão 1.

**Corrigido**: `logoutAll()` agora usa o mesmo `buildUnscopedVersionedUpdate()` (SET só em
`globalLogoutAfter`, nunca `phoneE164`/qualquer outro campo) com um laço de retry limitado (5
tentativas) - logout deve sempre eventualmente suceder, então em vez de propagar
`TransactionCanceledException` ao chamador, relê o estado fresco e tenta de novo. `tableName` passa
a ser um parâmetro explícito (mesmo padrão de `setPhoneNumber()`, único outro método que precisa de
`transactWrite`). 2 testes novos: prova que um `phoneE164` concorrente nunca é apagado, e que a
função retenta e sucede sob um conflito de versão simulado.

## Achado 5 (Média) - testes da Rodada 2 não provavam a proteção que anunciavam

Aceito integralmente: o teste de `setPhoneNumber()` só provava que uma transação CONSTRUÍDA PELO
PRÓPRIO TESTE era rejeitada, não que `setPhoneNumber()` em si rejeita uma leitura obsoleta. Como a
Rodada 3 já reescreveu a lógica de fundo (retry loops, version monotônico), os testes desta rodada
foram desenhados desde o início para reproduzir o CENÁRIO REAL que o Codex demonstrou (resend
seguido de tentativa de confirmação com o código velho; concorrente apagando `phoneE164`; conflito
de versão forçando retry), não apenas testar o mecanismo de `transactWrite` isoladamente. A limitação
apontada (não intercalar chamadas assíncronas reais) permanece parcialmente - o teste de retry do
`logoutAll()` usa um monkey-patch de `repo.get` para injetar a mutação concorrente NO MEIO da
chamada real (mais próximo de interleaving genuíno que os testes anteriores), verificado por
execução (o teste falha sem o retry loop, passa com ele).

## Correção adicional (doc, não funcional)

Comentários obsoletos em `preferences-handlers.ts` (linhas ~135/~154) que ainda diziam
"`handleRecordWhatsAppOptIn` above stays wired" foram corrigidos para refletir a remoção real da
Rodada 2.

## Nota cega (Claude), Rodada 3

Ver `round-3-claude-selfgrade.md` (arquivo separado).
