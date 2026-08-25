# Crítica Codex — Rodada 2 (sobre proposal-claude-v2.md)

Nota: 8,5/10

1. Resultado geral

A v2 corrige adequadamente os três erros centrais da Rodada 1:

- abandona a tese absoluta de que a Alternativa (a) seria tecnicamente forçada;
- substitui AllViewer por AllViewerExceptHostHeader;
- descreve corretamente a precedência explícita dos ordered cache behaviors;
- acrescenta os métodos HTTP necessários;
- reconhece e especifica a correção do CORS;
- separa a política de security headers da SPA e do BFF;
- registra a exposição direta do endpoint execute-api.

Entretanto, a proposta ainda contém uma lacuna arquitetural relevante no tratamento do fallback da SPA e uma correção incompleta no ownership dos security headers.

2. Achado bloqueante: custom_error_response não é isolado por behavior

A afirmação abaixo não é implementável da forma sugerida:

“Sem fallback de erro do S3 aplicado ao path /bff/*.”

Em uma distribuição CloudFront, custom_error_response pertence à distribuição, não a um cache behavior específico. Portanto, se a etapa seguinte configurar globalmente 403 ou 404 para devolver index.html, essa transformação também poderá atingir respostas 403/404 vindas da origem BFF.

Isso produz consequências graves:

- um 403 real de CSRF ou autorização pode virar index.html;
- um 404 da allowlist ou da API pode virar a SPA;
- o status pode ser alterado para 200, dependendo da configuração;
- o ApiClient tentará interpretar HTML como JSON e produzirá erro de processamento, ocultando o erro real;
- a decisão prometida de preservar “a resposta real do backend” não estará garantida.

A existência do ordered behavior /bff/* não isola custom_error_response. Ele seleciona a origem e demais políticas do behavior, mas a configuração global de respostas de erro continua relevante.

A decisão precisa escolher explicitamente um mecanismo de SPA routing que não transforme erros do BFF. Por exemplo:

- CloudFront Function no viewer request, reescrevendo somente rotas elegíveis da SPA para index.html e excluindo explicitamente /bff e /bff/*; ou
- outro mecanismo equivalente que não dependa de custom_error_response global para 403/404.

Também deve existir teste Terraform que prove que 403/404 do BFF não são convertidos em index.html. Um comentário no HCL não prova essa propriedade.

3. Security headers do BFF: ownership parcialmente fechado

A v2 está correta ao não aplicar a CSP da SPA ao behavior do BFF. Porém, “nenhuma Response Headers Policy” deixa uma lacuna em respostas que não passam pelo Lambda.

O conjunto de headers está realmente presente em src/runtime/aws/handlers/bff-handler.ts, não diretamente em bff-handlers.ts. Ele cobre respostas produzidas normalmente pelo runtime Lambda. Não cobre necessariamente:

- erros gerados pelo próprio CloudFront;
- falhas de conexão ou TLS com a origem;
- respostas 502/503/504 produzidas antes do Lambda;
- respostas geradas pelo API Gateway para rotas ou falhas que não alcancem a integração.

Essas respostas podem não conter HSTS, CSP, nosniff ou Referrer-Policy. Portanto, a frase de que os headers “vêm do próprio BFF” só é verdadeira para respostas que chegam ao runtime.

A solução mais coerente é definir uma Response Headers Policy específica para /bff/*, distinta da política da SPA, com os valores apropriados para JSON e redirects. Ela pode preservar headers equivalentes da origem e preencher os ausentes, conforme a semântica de override escolhida. Isso também torna o ownership realmente completo na borda observada pelo browser.

No mínimo, a decisão precisa declarar conscientemente que respostas de infraestrutura do BFF podem não receber esses headers e justificar por que esse risco é aceito. No estado atual, essa exceção não é mencionada.

4. CORS: correção correta, mas deve virar critério verificável

A leitura de frontend/src/api/client.ts confirma os gaps:

- Content-Type;
- X-CSRF-Token;
- Idempotency-Key;
- If-Match;
- métodos POST, PUT, PATCH e DELETE.

A v2 especifica a correção adequada para Idempotency-Key, If-Match e PATCH. Contudo, como o Terraform atual ainda contém apenas Content-Type e X-CSRF-Token, e não inclui PATCH, a decisão deve exigir teste de infraestrutura que verifique o conjunto completo. Sem isso, o bug pode reaparecer ou a implementação pode ficar incompleta.

Isso não bloqueia a direção arquitetural, mas é necessário para considerar a correção encerrada.

5. Exposição direta do execute-api: risco reconhecido, mas mal governado

Registrar a exposição como residual é melhor do que ignorá-la, e ela não invalida o Full BFF. Entretanto, “candidato a WAF/mitigação numa etapa futura” ainda não constitui uma pendência bem governada.

Faltam:

- trigger concreto para reavaliação;
- owner;
- gate de prazo ou estágio;
- definição dos controles que não podem ser colocados exclusivamente no CloudFront enquanto o bypass existir.

Especialmente importante: enquanto o endpoint direto permanecer público, WAF, rate limiting ou qualquer autorização adicionada somente ao CloudFront não podem ser descritos como proteção efetiva da origem.

A decisão deveria registrar algo como: antes de introduzir controle de segurança exclusivamente na borda ou antes de produção pública, reavaliar e mitigar o acesso direto; até lá, throttling e controles críticos permanecem também no API Gateway/BFF.

6. Pontos considerados corretos

Não encontrei nova objeção à escolha principal:

- uma distribuição com duas origens é apropriada;
- OAC somente na origem S3 está correto;
- API Gateway regional pode ser custom origin HTTPS sem custom domain;
- AllViewerExceptHostHeader preserva cookies, query strings e headers necessários sem encaminhar o Host do viewer;
- CachingDisabled no behavior /bff/* é correto;
- allowed_methods e cached_methods agora estão coerentes;
- os cookies com prefixo __Host- e o client atual justificam fortemente a arquitetura same-origin;
- separar CSP da SPA e CSP do BFF é a decisão correta.

7. O que falta para chegar a 9,0

Para atingir o gate mínimo, a proposta precisa:

1. Remover a premissa de que o fallback 403/404 pode ser isolado por cache behavior.
2. Escolher um mecanismo concreto de SPA routing que exclua /bff e /bff/* sem transformar erros do backend.
3. Exigir teste que prove que 403 e 404 do BFF permanecem respostas do BFF.
4. Fechar o tratamento de security headers para respostas geradas por CloudFront/API Gateway, ou registrar explicitamente a exceção e sua justificativa.
5. Transformar as correções de CORS em assertions de infraestrutura.
6. Dar owner, trigger e gate operacional à exposição direta do execute-api.

8. Nota

Nota: 8,5/10.

A recomendação arquitetural permanece correta e a v2 resolve de forma substancial os achados da Rodada 1. Ainda não atinge 9,0 porque o tratamento proposto para o fallback da SPA depende de um isolamento por behavior que CloudFront não oferece para custom_error_response. Isso pode corromper exatamente as respostas 403/404 do BFF que a proposta afirma preservar.
