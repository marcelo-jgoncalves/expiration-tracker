# Crítica Codex — Rodada 1

Nota: 7,6/10

1. Correção e inevitabilidade da alternativa (a)

A alternativa (a) é tecnicamente correta e é claramente a melhor opção para o desenho já implementado. Porém, a proposta exagera ao classificá-la como tecnicamente forçada em sentido absoluto.

Os cookies com prefixo __Host- são host-only: exigem Secure, Path=/ e ausência de Domain. Assim, um cookie emitido por api.exemplo.com não pode ser lido por JavaScript executado em app.exemplo.com. Nesse ponto, Claude está correto. O client.ts atual, que lê __Host-et_csrf por document.cookie, não funcionaria com esses hosts separados. [MDN: Set-Cookie e prefixos de cookie](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie)

Contudo, domínios separados ainda poderiam preservar as garantias principais:

- app.exemplo.com e api.exemplo.com são origens diferentes, mas pertencem ao mesmo site. Cookies SameSite=Strict do host api.exemplo.com podem acompanhar chamadas fetch para esse host, desde que credentials e CORS estejam corretamente configurados.
- O BFF poderia devolver o token CSRF no corpo de uma resposta autenticada de bootstrap ou sessão. O frontend guardaria esse valor em memória e o enviaria no header.
- O servidor ainda poderia exigir a igualdade entre header, cookie __Host-et_csrf host-only e segredo da sessão. A garantia de tripla comparação continuaria existindo; mudaria apenas o canal pelo qual o JavaScript recebe sua cópia.
- Uma solução baseada em iframe hospedado no domínio da API e postMessage também seria possível, embora seja desnecessariamente complexa.

Portanto, (b) não obriga tecnicamente a abandonar __Host-. Ela obriga a alterar client.ts, o bootstrap de sessão e parte do desenho CSRF/CORS. Também existem restrições: os hosts precisam continuar same-site para manter SameSite=Strict; domínios registráveis realmente distintos exigiriam SameSite=None ou outra reformulação, com enfraquecimento maior.

A formulação correta seria: (a) é a única alternativa compatível sem alterações com D-053/D-054 e com a implementação atual. Não é a única arquitetura segura concebível.

Isso não muda minha recomendação: sem benefício concreto para separar os domínios, reabrir o fluxo CSRF e introduzir CORS credenciado seria custo e superfície de falha sem retorno.

2. Problemas no desenho concreto

2.1. AllViewer é inadequada para a origem API Gateway

Este é o problema mais sério da proposta.

A política AllViewer encaminha o Host recebido do viewer, por exemplo app.exemplo.com. A origem regional execute-api espera seu próprio hostname. Além disso, quando o Host do viewer é encaminhado para uma origem HTTPS, a AWS exige compatibilidade desse nome com o certificado da origem; caso contrário, pode ocorrer falha TLS ou resposta inválida.

A política apropriada é AllViewerExceptHostHeader, que encaminha cookies, query strings e os demais headers, mas substitui Host pelo domínio da origem. A própria AWS preconfigura AllViewerExceptHostHeader para origens API Gateway. [AWS: políticas de origin request](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/origin-request-understand-origin-request-policy.html) [AWS: configuração predefinida para API Gateway](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/template-preconfigured-origin-settings.html)

Usar AllViewer como proposto pode tornar a integração simplesmente não funcional. Não é apenas uma questão de otimização.

2.2. Prioridade não é determinada por especificidade

CloudFront não escolhe automaticamente o behavior mais específico. Ele avalia os ordered cache behaviors na ordem configurada e usa o primeiro match. O default behavior fica por último.

Com apenas /bff/* e o default, o resultado pretendido funciona. Mas a justificativa está factualmente errada e cria risco quando novos patterns forem adicionados. A precedência precisa ser explicitamente controlada e testada. [AWS: ordem dos cache behaviors](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/DownloadDistValuesCacheBehavior.html)

2.3. Métodos HTTP precisam ser explicitados

O behavior /bff/* deve permitir GET, HEAD, OPTIONS, PUT, POST, PATCH e DELETE, mesmo que nem todos sejam usados hoje. O padrão restrito de CloudFront aceita apenas GET e HEAD. Sem allowed_methods correto, logout e todas as mutações falham antes de chegar ao BFF.

Também convém restringir cached_methods a GET e HEAD, embora CachingDisabled torne isso secundário.

2.4. Query strings precisam chegar integralmente

Login, callback OIDC e proxy dependem de query strings, incluindo code, state, returnTo e queries repassadas à API. AllViewerExceptHostHeader encaminha query strings e cookies; uma política customizada futura precisa preservar isso explicitamente.

CachingDisabled está correto e, combinado com Cache-Control: no-store já emitido pelo handler, impede cache de respostas de sessão, redirects e Set-Cookie.

2.5. A origem execute-api pode ser usada diretamente

CloudFront não exige que o API Gateway tenha custom domain. O api_endpoint regional pode ser usado como custom origin HTTPS, desde que:

- origin_protocol_policy seja https-only;
- origin_ssl_protocols seja TLSv1.2;
- o origin domain seja apenas o hostname, sem https ou path;
- Host seja substituído pelo hostname da origem, razão adicional para AllViewerExceptHostHeader.

Um custom domain para o API Gateway só seria necessário se existisse outro requisito operacional ou se fosse decidido encaminhar um Host compatível com ele. [AWS: TLS e domínio da origem](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/DownloadDistValuesOrigin.html)

2.6. OAC e API Gateway coexistem sem conflito

Não há conflito em uma distribution dual-origin. OAC é configurado e associado apenas à origem S3. A origem API Gateway permanece uma custom origin HTTPS. Cada behavior seleciona seu origin_id.

A bucket policy deve limitar leitura ao ARN da distribution. O OAC não deve ser aplicado à origem execute-api.

2.7. CORS

No fluxo de produção same-origin, o browser não precisa de CORS para /bff/*. O header Origin pode aparecer em algumas requisições, mas a política de same-origin do navegador não exige resposta CORS.

Entretanto, o fallback cross-origin atual está incompleto para o próprio client.ts:

- allow_headers não inclui Idempotency-Key;
- allow_headers não inclui If-Match;
- allow_methods não inclui PATCH, embora ApiClient trate PATCH como mutação.

Logo, a afirmação “nenhuma mudança no CORS” só é válida para produção via CloudFront. Não é válida para o cenário declarado de desenvolvimento ou invocação direta.

Também deve ser registrado que o endpoint execute-api continua publicamente acessível, permitindo contornar futuros WAF, rate limits ou controles existentes apenas no CloudFront. Isso não quebra a autenticação BFF, mas precisa ser uma decisão consciente.

3. Requisitos de segurança e cabeçalhos

É aceitável deixar a sintaxe final da CSP para a próxima etapa. Não é aceitável deixar indefinida a responsabilidade arquitetural pelos headers, porque agora existem dois behaviors e dois produtores potenciais de cabeçalhos.

Esta decisão deveria fixar pelo menos:

- viewer_protocol_policy com redirect-to-https em ambos os behaviors; cookies Secure tornam isso obrigatório;
- HSTS aplicado pelo CloudFront a todas as respostas da origem SPA, inclusive erros;
- CSP específica do SPA no behavior S3;
- frame-ancestors, X-Content-Type-Options, Referrer-Policy e Permissions-Policy no behavior SPA;
- política explícita sobre sobrescrita ou preservação dos headers vindos do BFF;
- ausência de cache para todas as respostas /bff/*;
- prevenção de fallback de caminhos /bff/* para index.html ou S3 em respostas 403/404.

O BFF já emite HSTS, CSP default-src 'none', frame-ancestors 'none', nosniff e Referrer-Policy. Essa CSP é apropriada para respostas JSON e redirects, mas não para index.html. Portanto, não se deve aplicar indiscriminadamente uma única Response Headers Policy contendo a CSP do SPA a ambos os behaviors.

HSTS faz mais sentido como garantia da borda CloudFront, pois é a origem observada pelo usuário. O header emitido diretamente pelo BFF pode ser mantido como defesa adicional para acesso execute-api, embora includeSubDomains sobre um hostname execute-api tenha pouca utilidade prática.

Assim, os valores detalhados podem ficar para a etapa seguinte, mas ownership, separação por behavior e requisitos mínimos deveriam ser parte desta decisão Type 1.

4. Nota

Nota: 7,6 de 10.

A direção arquitetural é boa: uma distribution, S3 privado com OAC, /bff/* no mesmo origin do browser, CachingDisabled e preservação integral do Full BFF existente são escolhas adequadas.

A nota cai por três motivos relevantes:

- a tese de inevitabilidade é mais forte do que os fatos permitem;
- AllViewer é uma escolha concreta incorreta para uma origem execute-api e pode quebrar a integração por encaminhar Host;
- a explicação de prioridade automática por especificidade está errada.

Também faltam requisitos essenciais de allowed_methods, HTTPS obrigatório, encaminhamento integral de query strings, ownership dos security headers e tratamento consciente do acesso direto ao execute-api.

Conclusão: alternativa (a) aprovada como direção, mas a proposta não deve ser aprovada no estado atual. Requer correção para AllViewerExceptHostHeader e fechamento explícito dos pontos acima antes de atingir nota 9,0.
