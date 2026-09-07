# Rodada 1 — Crítica Codex (ExternalShareLink)

**Revisor**: Codex (`codex exec`), 2026-09-07. Nota cega — sem visão prévia de autoavaliação do Claude.

## Nota cega

Sem considerar qualquer autoavaliação do Claude:

- **Pesquisa externa: 6,4/10**
- **Design contra o checklist proposto: 5,8/10**

A pesquisa tem bons fundamentos para entropia e expiração, mas baixa representatividade justamente nos aspectos mais críticos deste desenho: capability URLs, transporte seguro do token, revogação diante de URLs S3 já emitidas, auditoria de downloads e padrões AWS. O design acerta a direção geral, porém ainda não fecha invariantes essenciais do recurso compartilhado nem sustenta algumas alegações do próprio checklist.

## Achados concretos

### 1. Revogação não é realmente imediata após emissão do presign — ALTO

**Decisões 5 e 7; Critério 3.**

Depois que a aplicação retorna uma URL S3 presigned válida por cinco minutos, revogar o `ExternalShareLink` não invalida essa URL. O visitante pode continuar baixando o arquivo diretamente do S3 até o presign expirar.

Portanto, “efeito imediato” e “relê o item fresco a cada request” só valem para uma nova solicitação à API, não para o acesso ao recurso já autorizado. Isso não fecha literalmente o Critério 3.

O design precisa escolher e declarar uma semântica verificável:

- revogação com janela residual máxima de cinco minutos; ou
- mecanismo que permita revogação efetiva antes disso, como download mediado/autorização na borda — com custo e complexidade próprios.

Com o padrão existente de presign, a primeira opção é provavelmente proporcional, mas o critério e a comunicação do produto precisam dizer isso explicitamente.

### 2. Não existe regra determinística para selecionar “exatamente um DocumentFile” — ALTO

**Decisões 1, 5 e 6.**

O modelo real admite até 20 arquivos por `DocumentVersion`, com exatamente um `PRINCIPAL` e possíveis `ATTACHMENT`. Quando `documentFileId` está ausente, a proposta resolve somente a versão corrente (`Document.currentVersionId`), não qual arquivo dessa versão será servido.

Isso contradiz a promessa de expor “exatamente o conteúdo de 1 `DocumentFile`”. É necessário decidir, por exemplo:

- ausência de `documentFileId` significa o arquivo `PRINCIPAL` da versão corrente; ou
- todo link exige `documentFileId`; ou
- o link compartilha uma versão e apresenta um conjunto fechado de arquivos.

Também faltam as regras para arquivo inexistente, não `CLEAN`, removido ou sem `cleanObject`.

### 3. O vínculo entre link, Document, versão e arquivo não está protegido — ALTO

**Decisões 1, 5, 6 e 7.**

A proposta não define condições transacionais que provem, na criação, que:

- o `Document` pertence ao mesmo tenant;
- o `documentFileId`, quando informado, pertence ao mesmo `documentId`;
- o arquivo pertence à versão pretendida;
- o arquivo está `CLEAN` e possui `cleanObject`;
- a versão está `ACCEPTED`;
- o `Document` está em estado compartilhável.

Também não define quais invariantes serão revalidadas a cada acesso. Persistir IDs sem essas condições permite referência cruzada inválida por bug de chamada e cria comportamento indefinido quando o recurso muda depois da criação.

### 4. Token no query string é uma exposição evitável de credencial — ALTO

**Decisão 5.**

`GET /external-share/{shareId}?token=<selector.secret>` coloca a credencial completa em uma área frequentemente registrada ou propagada:

- histórico do navegador;
- logs de proxy/API Gateway;
- ferramentas de observabilidade;
- screenshots e copy/paste;
- potencialmente `Referer`, dependendo da página e da política aplicada.

Não há decisão sobre `Referrer-Policy`, `Cache-Control: no-store`, redaction de query strings, logs de acesso ou analytics. Tampouco há justificativa para preferir query string em vez de um fragmento consumido por uma página intermediária e trocado por sessão curta, ou outro transporte que não grave o segredo na URL enviada ao backend em cada acesso.

O fato de o token ser de alta entropia não mitiga vazamento da própria capability.

### 5. `shareId` na rota e selector do token criam duas identidades sem regra de reconciliação — MÉDIO/ALTO

**Decisões 1, 5 e 8.**

O ponteiro resolvido pelo selector já retorna o `shareId` canônico. A rota também recebe `{shareId}`, mas o design não diz se:

- ambos devem coincidir;
- o path é ignorado;
- o path participa do hash/MAC;
- divergência vira o mesmo 404 genérico.

Sem uma regra explícita, diferentes implementações podem servir o recurso apontado pelo token mesmo sob outro `shareId`, ou consultar primeiro o path e criar um novo oracle. O desenho deveria ter uma única autoridade de resolução ou exigir igualdade depois do caminho anti-enumeração completo.

### 6. Criação do link e do ponteiro tenantless não foi desenhada — ALTO

**Decisões 1, 3 e 4.**

Só há rota e transação descritas para revogação. Faltam, na criação:

- chave PK completa do `ExternalShareLink`;
- escrita atômica do link e do ponteiro;
- `buildVersionedCreate`/condições contra colisão;
- fencing do tenant na mesma transação;
- fences do `Document` e do arquivo;
- tratamento de colisão do selector;
- idempotência da requisição;
- rollback lógico se emissão/resposta falhar;
- cap de links ativos por documento/tenant.

Se link e ponteiro forem escritos separadamente, uma falha intermediária deixa link inutilizável ou ponteiro órfão. Para uma decisão de modelo de dados nível 5, essa omissão é bloqueante.

### 7. Generalizar `GuestRateLimiter` não entrega “por token/IP” automaticamente — ALTO

**Decisão 9; Critério 6.**

O `GuestRateLimiter` existente cobre apenas selector; o próprio código declara que a dimensão IP é responsabilidade do WAF. Há outro precedente mais próximo no repositório, `DocumentArchiveGuestRateLimiter.consumeBoth`, que efetivamente trata request key e IP.

A proposta diz que a lógica existente é “N tentativas por janela por IP/selector”, mas isso não corresponde ao `GuestRateLimiter` citado. É necessário especificar:

- limiter de aplicação por selector;
- limiter por IP ou IP+selector;
- regra WAF para a nova rota;
- como o IP confiável é extraído, sem aceitar header falsificável;
- comportamento indistinguível ao atingir o limite.

Além disso, a Decisão 8 promete sempre 404, enquanto rate limiting normalmente produz 429. Se o 429 só ocorrer para selectors reais, volta o oracle já encontrado historicamente no fluxo guest. A ordem exata — parse, hash, rate limit, lookup e comparação dummy — precisa estar no design.

### 8. `timingSafeEqual` sozinho não fecha resistência a enumeração temporal — MÉDIO/ALTO

**Decisões 3 e 8; Critérios 1 e 4.**

A proposta menciona comparação constante, mas não exige o caminho dummy usado no código real quando o ponteiro/link não existe. Um selector inexistente pode encerrar antes do fetch do link e da comparação HMAC, enquanto um selector existente executa mais leituras e criptografia.

É necessário exigir explicitamente uma comparação dummy com hash de tamanho válido e uniformizar a ordem das operações. Mesmo assim, “resposta idêntica” não significa latência perfeitamente indistinguível; o critério deveria ser formulado em termos do mecanismo controlável.

### 9. `status: EXPIRED` não tem transição definida e pode mentir — MÉDIO

**Decisões 1, 2 e 8.**

A expiração é verificada comparando `expiresAt`, mas não há worker ou mutação que altere `ACTIVE → EXPIRED`. Assim, um link vencido continuará armazenado e listado como `ACTIVE` até o TTL físico removê-lo, que é assíncrono e não imediato.

Opções coerentes seriam:

- remover `EXPIRED` do estado persistido e derivar o estado efetivo em leitura; ou
- definir um reconciliador/transição real;
- manter `status` apenas como `ACTIVE | REVOKED` e tratar expiração como dimensão temporal separada.

Também é preciso definir se `purgeAfterTtl` vale no instante da expiração ou depois de uma janela de retenção de auditoria.

### 10. Há contradição no default de expiração — MÉDIO

**Decisão 2.**

A decisão declara “máximo 30 dias, default 7”, mas depois afirma que a criação “rejeita `ttlDays` ausente”. Se ausência é rejeitada, não existe default. Deve ser uma das duas regras:

- `ttlDays` ausente resulta em sete dias; ou
- `ttlDays` é obrigatório e sete dias é apenas sugestão da interface.

### 11. Semântica “CURRENT” amplia acesso sem novo consentimento — ALTO

**Decisão 6.**

Um link criado hoje pode autorizar amanhã o download de bytes que não existiam quando o admin compartilhou o documento. Isso não é apenas uma diferença de conveniência: muda o objeto autorizado após a decisão administrativa inicial.

Além disso, faltam regras para:

- `currentVersionId` ausente;
- substituição por nova versão enquanto o acesso está em andamento;
- documento arquivado;
- versão corrente sem `PRINCIPAL CLEAN`;
- mudança de classificação/sensibilidade;
- link direcionado a arquivo fixo versus link “vivo”.

Considerando que a feature é descrita como compartilhar um `DocumentFile` específico, o default mais seguro e auditável é congelar `documentFileId` — ou, ao menos, congelar `versionId` e resolver o `PRINCIPAL`. “CURRENT” deveria exigir escolha explícita do criador, não ser assumido silenciosamente.

### 12. A pendência de senha é material demais para ficar fora do design avaliado — ALTO

**Decisões 3 e 5; pendência de produto 2.**

A proposta reconhece que apólices e contratos podem ser sensíveis e que a exigência de senha muda a postura de segurança, mas simultaneamente afirma que a pendência não bloqueia o fechamento do protocolo.

Isso é inconsistente com a própria classificação nível 5-6. A escolha altera:

- modelo de credencial;
- armazenamento de hash da senha/PIN;
- rate limiting;
- UX e recuperação;
- auditoria;
- resposta a tentativas;
- possibilidade de encaminhamento acidental do link.

O protocolo pode aprovar um design explicitamente “capability bearer sem segundo fator”, mas não pode considerar o modelo completo enquanto a postura fundamental ainda será decidida antes da implementação.

### 13. Auditoria cobre apenas acesso bem-sucedido e omite o ciclo administrativo — MÉDIO/ALTO

**Decisões 4, 7 e 10; Critério 7.**

Para governança, é mais importante registrar o ciclo completo:

- criação;
- revogação;
- tentativa de revogação conflitante;
- acesso/download autorizado;
- mudanças relevantes no alvo de um link “CURRENT”;
- falhas agregadas/rate-limitadas, sem produzir um evento durável por ataque.

A proposta fala somente em `EXTERNAL_SHARE_LINK_ACCESSED`. Também não define se “acesso” significa resolução do link, emissão do presign ou download real. Uma URL emitida não prova que o S3 foi acessado; sem eventos de dados do S3, a auditoria não pode afirmar “download”.

`lastAccessedAt` e `accessCount` aparecem no modelo, mas nenhum fluxo de atualização é definido. Atualizá-los com OCC em todo acesso criaria contenção e poderia tornar download dependente de telemetria; deixá-los sem writer torna os campos enganosos.

### 14. “IP hash” está subespecificado — MÉDIO

**Decisão 10.**

Hash simples de IPv4 é reversível por enumeração do espaço. É necessário definir HMAC com segredo/pepper apropriado, versão/rotação, finalidade e retenção. Reusar o pepper do token acoplaria domínios criptográficos que deveriam ser separados.

Também falta definir qual endereço é confiável quando a chamada passa por API Gateway/CloudFront e quais headers nunca devem ser aceitos diretamente do cliente.

### 15. O estado do tenant não é revalidado na leitura anônima — ALTO

**Decisões 4, 5 e 7.**

A criação/revogação usa fencing, mas a rota pública não passa por `RequestContext`. A proposta não exige verificar que o `TenantLifecycleRecord` continua `ACTIVE` antes de emitir um novo presign.

Assim, um link ainda válido poderia continuar emitindo novas capabilities enquanto o tenant está `DELETING`, inclusive durante purge concorrente. A leitura pública precisa de uma regra explícita de lifecycle, e falha deve colapsar no erro genérico.

### 16. Metadados mínimos ainda podem vazar conteúdo mutável ou tenant-controlled — MÉDIO

**Decisão 5.**

“Nome do documento, nome do tipo, data de emissão” não está ligado precisamente aos campos reais nem às regras de sanitização. O nome do tipo é mutável; metadata configurável pode conter valores tenant-controlled. É preciso definir uma resposta fechada, seus limites e sanitização, e proibir retorno acidental do `Document`, `DocumentVersion` ou `DocumentFile` completos.

### 17. Ausência de limites de governança e listagem — MÉDIO

**Decisões 1 e 4.**

Existe permissão de listagem, mas não há:

- rota/contrato de listagem;
- paginação;
- estados efetivos;
- filtro por documento;
- cap de links ativos;
- tratamento de links vencidos;
- identificação segura do alvo;
- política de retenção.

Sem cap, um admin ou cliente defeituoso pode gerar quantidade ilimitada de ponteiros tenantless e registros de auditoria.

## Calibração do checklist

O checklist está incompleto e parcialmente superestima o que mede.

- **Critério 1** mistura entropia e comparação constante, mas omite transporte/armazenamento seguro da capability, redaction e caminho dummy.
- **Critério 3** define revogação imediata sem considerar presigns já emitidos. Do modo proposto, é impossível atendê-lo literalmente.
- **Critério 4** considera apenas corpo/status, omitindo diferenças de rate limit, ordem de lookup e timing.
- **Critério 5** deveria exigir integridade do vínculo e elegibilidade do arquivo (`ACCEPTED`, `CLEAN`, mesmo tenant/document/version), não apenas ausência de navegação lateral.
- **Critério 6** atribui ao `GuestRateLimiter` uma capacidade por IP que ele não possui.
- **Critério 7**, com apenas 5%, está subponderado para uma feature de exposição externa de documentos sensíveis. Sua formulação “todo acesso bem-sucedido e nem toda falha” também não é um critério decidível.
- Faltam critérios pesados para: transporte seguro do token, lifecycle do tenant, vínculo transacional do alvo, comportamento diante de presign já emitido, criação atômica link+pointer e governança do ciclo administrativo.
- A pesquisa usa OWASP e uma fonte oficial do Dropbox adequadamente, mas a afirmação sobre Google depende de fonte secundária, e faltam fontes primárias sobre AWS presigned URLs e capability URLs. Isso deixou exatamente os principais riscos do design fora da régua.

O núcleo reutilizável — token opaco, hashes com pepper, expiração finita, erro genérico e presign curto — é sólido. Porém, os achados 1, 2, 3, 4, 6, 7, 11, 12 e 15 impedem aprovação nesta rodada.

