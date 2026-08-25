# Crítica Codex — Rodada 3 (sobre proposal-claude-v3.md)

Nota: 8,9/10

1. Nota

Nota: 8,9/10.

A v3 corrige o bloqueante principal da Rodada 2, mas ainda não atinge o gate de 9,0. Restam duas lacunas concretas no contrato de roteamento: o path exato /bff e o predicado excessivamente amplo usado pela CloudFront Function.

2. Veredito sobre a CloudFront Function

A troca de custom_error_response por uma CloudFront Function viewer-request é tecnicamente correta.

O fluxo relevante é:

- CloudFront seleciona o cache behavior usando o URI recebido.
- A function associada àquele behavior executa antes da consulta ao cache.
- Alterar request.uri modifica o cache key e o objeto solicitado à origem.
- Essa alteração não troca o cache behavior nem a origem já selecionados.

A AWS documenta expressamente que mudar o URI na function não muda o behavior nem a origem. Portanto, uma requisição originalmente compatível com /bff/* seleciona o behavior do BFF e nunca executa a function associada exclusivamente ao default behavior. Já uma rota da SPA seleciona o default behavior e pode ser reescrita para /index.html sem migrar para outra origem. [AWS — CloudFront Functions event structure](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/functions-event-structure.html)

Isso resolve por construção o mascaramento de 403/404 do BFF identificado na Rodada 2. Viewer-request também é o evento correto: a reescrita acontece antes da consulta ao cache; viewer-response seria tarde demais para selecionar /index.html. [AWS — Determine function purpose](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/function-code-choose-purpose.html)

3. Achado relevante: /bff/* não fecha necessariamente o path exato /bff

A v3 afirma que a function “nunca toca /bff/*”, o que é verdadeiro para paths como:

- /bff/login
- /bff/session
- /bff/api/items
- /bff/api/rota-inexistente

Entretanto, o namespace completo não está fechado. O pattern /bff/* não deve ser tratado como prova de cobertura do path exato /bff. Esse path pode cair no default behavior e, por não conter ponto, ser reescrito para /index.html.

Consequência: GET /bff pode devolver a SPA em vez de um erro do namespace BFF. Isso não recria o vazamento grave de 403 de autorização das rotas existentes, mas contradiz a propriedade mais ampla de que paths reservados ao BFF nunca viram HTML.

O que falta:

- definir explicitamente o comportamento de /bff;
- preferencialmente adicionar um behavior exato /bff apontando para a origem BFF, além de /bff/*; ou
- definir redirect explícito /bff → /bff/ e garantir que /bff/ seja encaminhado ao BFF;
- incluir /bff, /bff/ e /bff/* nos testes reais de não retorno de HTML.

Somente excluir /bff dentro da function não basta: nesse momento o default behavior e a origem S3 já foram escolhidos. A própria AWS confirma que a alteração feita pela function não muda essa seleção.

4. Achado relevante: “não contém ponto” não equivale a “é rota da SPA”

O código:

if (!uri.includes(".")) {
  request.uri = "/index.html";
}

classifica todo recurso sem ponto como rota client-side. Isso pode mascarar um arquivo estático legítimo sem extensão, por exemplo:

- /manifest
- /health
- /.well-known/acme-challenge/token
- qualquer futuro artefato publicado com nome sem extensão

Nesses casos, a solicitação não chega ao objeto S3 pretendido: recebe index.html, possivelmente com status 200.

A proposta precisa transformar essa heurística em contrato explícito. Alternativas aceitáveis:

- allowlist dos prefixos reais do React Router;
- denylist explícita dos namespaces reservados, combinada com a regra de extensão;
- regra de publicação proibindo assets sem extensão e reservando /.well-known, acompanhada de teste;
- fallback por segmentos conhecidos da aplicação.

No mínimo, a suíte da function deve cobrir:

- / e uma rota SPA conhecida → /index.html;
- rota SPA com parâmetros → /index.html;
- asset com extensão → URI preservado;
- recurso estático permitido sem extensão → URI preservado, se essa categoria existir;
- /bff, /bff/ e /bff/api/... → nunca reescritos;
- query string preservada.

5. Métodos HTTP e cache

A function deveria verificar explicitamente request.method === "GET" || request.method === "HEAD" antes de reescrever.

O default behavior aceita apenas GET e HEAD, portanto métodos mutantes não devem alcançar a origem S3 normalmente. Ainda assim, colocar a guarda na function:

- expressa o contrato de que SPA fallback só existe para navegação/leitura;
- evita comportamento surpreendente em testes da function;
- protege contra uma ampliação futura de allowed_methods;
- impede que POST ou PATCH para um path fora de /bff sejam transformados conceitualmente em uma solicitação a index.html.

Quanto ao cache, viewer-request executa antes da consulta ao cache, e o URI reescrito participa do cache key. Assim, várias rotas SPA convergirem para o mesmo objeto /index.html é o comportamento desejado. A v3 já deixa corretamente invalidação e política de publicação de index.html para as etapas 3/4; não encontrei um novo bloqueante nisso.

6. Response Headers Policy do BFF

A correção está conceitualmente correta.

Com override=false:

- se a origem já enviar o header, CloudFront preserva o valor da origem;
- se a origem não o enviar, CloudFront acrescenta o valor da policy.

Essa é precisamente a semântica necessária para um piso de segurança sem substituir decisões do BFF. [AWS — Understand response headers policies](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/understanding-response-headers-policies.html)

A implementação deve testar os headers individualmente, incluindo Content-Security-Policy com frame-ancestors 'none'. “Mesmo conjunto” em prosa não prova equivalência, especialmente porque frame-ancestors é uma diretiva de CSP, não um header autônomo.

Também recomendo teste real de uma resposta gerada antes do Lambda, e não apenas uma resposta normal do BFF, pois essa é exatamente a lacuna que justifica a policy.

7. CORS

A correção exigida está alinhada com frontend/src/api/client.ts:

- content-type;
- x-csrf-token;
- idempotency-key;
- if-match;
- GET, POST, PUT, PATCH e DELETE.

O teste deve usar comparação por conjunto ou contains, sem depender de ordem ou capitalização. Também deve preservar allow_credentials=true e a origem explícita; testar apenas headers e métodos permitiria uma regressão independente nesses dois campos.

Como a configuração atual do repositório ainda não contém Idempotency-Key, If-Match nem PATCH, o achado só pode ser considerado fechado quando o código e o teste forem efetivamente implementados.

8. Gate do execute-api

Owner, trigger e estágio agora estão suficientemente definidos:

- owner: Marcelo;
- natureza: decisão Type 1 pelo protocolo;
- trigger: planejamento de produção pública fora de dev/pilot fechado;
- obrigação intermediária: controles críticos continuam no API Gateway/BFF.

Não considero necessária a implementação imediata de WAF ou resource policy para aprovar esta direção arquitetural.

Há, porém, uma formulação que deve ser validada antes do gate: restringir diretamente um endpoint execute-api a aws:SourceArn da distribution não deve ser assumido como mecanismo já demonstrado. CloudFront acessando API Gateway como custom origin não fornece automaticamente a mesma identidade IAM usada por integrações AWS assinadas. O gate deve avaliar mecanismos realmente aplicáveis — por exemplo custom header secreto validado na origem, custom domain/API mapping apropriado, mTLS quando aplicável, ou outro controle comprovado — sem pré-aprovar a hipótese de resource policy por SourceArn.

9. O que falta exatamente para chegar a 9,0

1. Fechar explicitamente o roteamento de /bff, /bff/ e /bff/*.
2. Substituir ou formalizar a heurística global “URI sem ponto = rota SPA”.
3. Guardar a reescrita por método GET/HEAD.
4. Adicionar testes unitários da function cobrindo rotas SPA, assets, métodos, query string e namespace BFF.
5. Ampliar o teste real no CloudFront para /bff, /bff/ e ao menos um 403 e um 404 do BFF, afirmando status, Content-Type e corpo não HTML.
6. Testar os valores concretos da Response Headers Policy, inclusive CSP/frame-ancestors, e uma resposta que não tenha passado pelo Lambda.
7. No teste CORS, preservar também allow_credentials=true e a origem explícita.
8. Tratar aws:SourceArn como hipótese a validar no gate, não como mitigação presumidamente disponível.

10. Conclusão

A v3 elimina corretamente o bloqueante da Rodada 2: 403/404 reais de paths que selecionam /bff/* não são transformados pelo fallback da SPA. A reprovação por 0,1 não decorre dessa solução central, mas de o contrato ainda não cobrir o path exato /bff e de usar uma heurística que pode converter recursos estáticos legítimos sem extensão em index.html. Essas correções são localizadas e não exigem rever a arquitetura CloudFront + Full BFF.
