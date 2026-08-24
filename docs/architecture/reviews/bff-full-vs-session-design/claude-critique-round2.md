# Crítica Claude — Rodada 2 (proposta Codex, Rodada 1)

## Convergência

Forte convergência independente na conclusão central e na maior parte dos 14 pontos: Full BFF,
cookie opaco (não JWT), `__Host-` + `HttpOnly`/`Secure`/`SameSite=Lax`, cookie CSRF separado
legível por JS + header espelhado, same-origin via CloudFront (`/*` SPA, `/bff/*` BFF), BFF
autentica o backend existente anexando Bearer (sem trocar o JWT authorizer nativo por Lambda
authorizer), allowlist explícita (nunca proxy aberto), `no-store`/`CachingDisabled` em `/bff/*`,
rate limiting adicional por sessão reaproveitando o padrão de `GuestRateLimiter`, e BFF sem
autoridade de domínio. Nenhuma reconciliação necessária nesses pontos — mesmo padrão de
convergência forte já registrado em D-036/D-037 deste projeto.

## Pontos que exigem correção ou decisão explícita

### 1. Propagação de correlation ID via header (ponto 11) introduz um trust boundary novo em código já revisado e em produção — sem justificativa

Verifiquei `src/runtime/aws/handlers/items-handler.ts:36-43`: hoje **nenhum handler HTTP aceita
correlationId de header do chamador**. O padrão real é:
`correlationId: event.requestContext.requestId` (gerado pelo próprio API Gateway, nunca pelo
cliente) para o contexto de log ambiente, e `ulid()` gerado localmente para o
`DomainEvent.correlationId` de negócio. O único lugar do projeto onde correlation cross-hop é
propagado por um valor fornecido externamente é `correlationIdFromSqsRecord()`
(`src/shared/observability/context.ts:35`) — e mesmo aí a fonte é um `MessageAttribute` escrito
por código interno (outbox relay), nunca um header HTTP alcançável de fora.

A proposta do Codex ("os handlers atuais precisariam ser ajustados para aceitar esse header como
fonte confiável só quando vier do BFF") pede uma mudança real em Lambdas já revisadas e
deployadas (M1-M11, algumas com nota de revisão registrada, ex. M5 9,1/10) para um benefício
puramente de observabilidade do frontend — e a rota `/items` etc. continua alcançável
diretamente (com Bearer válido) por qualquer cliente que não seja o BFF (mobile futuro, Postman,
scripts), então "só quando vier do BFF" não é uma fronteira que o handler consiga verificar hoje
sem inventar um segredo compartilhado BFF↔backend, que nenhuma das duas propostas especificou.

Alternativa mais simples e sem blast radius em código já verificado: **não tocar nos handlers de
recurso**. Cada hop continua gerando seu próprio `requestId`/`correlationId` exatamente como já
faz (API Gateway→BFF tem o seu; BFF→API Gateway→handler tem o seu, como sempre teve). O BFF loga
estruturadamente os dois IDs juntos (o dele e o `requestId` que o handler devolveu, se vier em
algum header de resposta, ou simplesmente o timestamp+rota) — a correlação acontece na consulta
de logs, não por um campo de confiança forçado no meio do caminho. Isso é consistente com o
princípio já aplicado no projeto de não ampliar o blast radius de uma função já verificada em
produção para escopo novo (mesmo raciocínio do parser-sandbox de M6 não ser estendido por M7).

**Pergunta para a tréplica**: Codex concorda em deixar os handlers de recurso intocados neste
ADR, tratando correlação BFF↔backend como problema de correlação de log (join por timestamp/rota
no agregador), não de propagação de campo confiável? Se não, qual mecanismo concreto de
autenticação do header (HMAC assinado pelo BFF? mTLS interno? Lambda-to-Lambda direto sem passar
pelo API Gateway público?) evita que qualquer chamador direto (Bearer válido, sem passar pelo
BFF) falsifique o mesmo header hoje?

### 2. Modelo de armazenamento de sessão (ponto 8): reaproveitar `DeviceSession` existente tem um problema de ordem de resolução

O Codex propõe alinhar ao `DeviceSession` já existente (`TENANT#t#USER#u` / `SESSION#<deviceId>`,
`user-repository.ts:29`). Isso funciona para os campos de revogação (`deviceLogoutAfter`,
`refreshFamilyId`) que já são o dono correto dessa informação — concordo em não duplicar isso.

Mas o lookup do cookie acontece **antes** de saber `tenantId`/`userId` — exatamente a mesma
situação estrutural que já levou o próprio blueprint a criar uma exceção de particionamento
tenantless dedicada para `cognitoSub → userId`
(`implementation-blueprint.md:1796`, `IDENTITY#cognitoSub#<sub>` / `MAP`) em vez de tentar indexar
por uma chave que inclui um dado ainda não resolvido. Um cookie opaco tem exatamente esse mesmo
problema: `PK=TENANT#<tenantId>#USER#<userId>#SESSION#<deviceId>` não pode ser a chave de lookup
primária por cookie, porque no momento do lookup nem `tenantId` nem `userId` são conhecidos —
só o valor do cookie.

Proposta de reconciliação: manter `DeviceSession` exatamente como está (dono da semântica de
revogação por dispositivo/global, sem nenhuma mudança), e adicionar **mais uma exceção tenantless
do mesmo padrão já usado 2x** (`IdentityMapping`, `GuestTokenPointer`) — um ponteiro
`PK=SESSION#<cookieHandleHash>` / `SK=POINTER` apontando para `{tenantId, userId, deviceId}`
(nunca duplicando token nele; o token cifrado fica no `DeviceSession` ou num campo dedicado deste
ponteiro, a decidir na rodada final, mas não em ambos). Isso é aditivo, zero risco ao agregado já
em produção, e seria a 4ª ocorrência do mesmo padrão de exceção — o que sugere que talvez valha a
pena nomear esse padrão explicitamente em `data-model.md` em vez de continuar tratando cada
ocorrência como caso especial isolado (nota para o documento final, não bloqueia esta decisão).

### 3. Cifrar o refresh token com KMS (ponto 8): concordo, mas falta decidir CMK dedicada vs. chave gerenciada

Ponto real que minha proposta Rodada 1 não tinha e o Codex acertou: o refresh token (30 dias de
validade) não deveria ficar em texto claro no item de sessão do DynamoDB, mesmo estando atrás de
IAM least-privilege — defesa em profundidade contra um `dump`/backup mal escopado. Adoto esse
ponto.

Falta decidir CMK dedicada vs. `aws/dynamodb` gerenciada. D-033 já rejeitou uma CMK dedicada por
bucket em contexto equivalente (custo real ~US$1/mês/CMK só por existir, sem volume que
justifique, `decisions-log.md` D-033) e usa chave gerenciada com isolamento vindo de outro
mecanismo (buckets físicos distintos + IAM). Mesmo raciocínio provavelmente se aplica aqui —
proponho `aws/dynamodb` (chave gerenciada AWS) por padrão, com isolamento vindo de IAM
least-privilege no item de sessão, não de uma CMK cara. Pergunta para a tréplica: Codex concorda,
ou há um motivo de compliance/rotação que justifique CMK dedicada aqui especificamente (ex.
rotação de chave desacoplada do resto da tabela)?

### 4. Pergunta em aberto que nenhuma das duas propostas decidiu: rotas de recurso continuam aceitando Bearer direto (sem passar pelo BFF)?

Nenhuma proposta disse explicitamente se, depois do Full BFF existir, as rotas atuais
(`/items`, `/subjects`, etc., JWT authorizer nativo) continuam publicamente alcançáveis por um
cliente que já tenha um access token válido por fora do BFF (ex. um futuro app mobile, ou um
cliente de API/integração usando Cognito diretamente) — ou se a intenção é que, na prática, só o
BFF as chame. Isso não muda infraestrutura (o authorizer não muda de qualquer forma, ponto 6 de
ambas propostas), mas muda a postura declarada do ADR: se a resposta é "sim, continuam abertas",
isso deveria constar explicitamente como decisão (nenhuma revogação de acesso direto), porque é
relevante para qualquer avaliação futura de superfície de ataque ("o BFF é a ÚNICA forma de
chegar nas rotas" é uma afirmação materialmente diferente de "o BFF é uma forma adicional").
Proponho registrar explicitamente: **rotas de recurso continuam aceitando Bearer direto, sem
remoção de acesso** — o Full BFF é aditivo, não substitui o mecanismo de autenticação existente,
mantém a porta aberta para um cliente mobile/API futuro sem exigir um segundo desenho de
autenticação depois. Pergunta para a tréplica: Codex concorda?

### 5. `SameSite=Lax` sem justificativa explícita contra `Strict`

Codex chegou à mesma escolha (`Lax`) que eu, mas sem justificar por que não `Strict`. Minha
justificativa (Rodada 1, item 3): o login usa Authorization Code via Hosted UI do Cognito, que é
um redirect cross-site de volta para a aplicação (`callback_urls`,
`infra/modules/cognito/main.tf:93`) — `SameSite=Strict` faria o browser **não enviar** o cookie
de sessão nesse retorno na primeira visita (comportamento padrão de `Strict` em navegação
top-level vinda de origem externa), quebrando o fluxo de login. Peço ao Codex apenas confirmar
esse raciocínio (ou refutá-lo com um mecanismo concreto que preserve `Strict`) — não é um
desacordo, é uma lacuna de justificativa a fechar antes de considerar este ponto decidido.

### 6. Refresh transparente vs. endpoint de refresh explícito para o frontend

Codex manteve `/bff/session/refresh` como rota explícita (possivelmente chamada pelo frontend).
Minha proposta (Rodada 1, item 8) defende refresh **transparente**: o BFF renova o access token
internamente sempre que uma chamada de recurso chega com o token expirando, sem o SPA precisar
chamar um endpoint de refresh proativamente — o frontend só reage a 401 de sessão morta. Isso
reduz a superfície de allowlist e simplifica o contrato do frontend (nunca precisa saber de
timing de token). Pergunta para a tréplica: existe um caso de uso real que exija um endpoint de
refresh explícito chamável pelo frontend (ex. renovar sessão proativamente antes de uma ação
longa), ou o refresh transparente cobre 100% dos casos e o endpoint explícito pode ser eliminado
do desenho final?
