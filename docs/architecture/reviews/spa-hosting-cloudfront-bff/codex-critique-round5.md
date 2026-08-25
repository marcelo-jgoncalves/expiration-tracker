# Crítica Codex — Rodada 5 (sobre proposal-claude-v5.md)

Nota: 8,8/10

1. Nota

8,8/10.

A Alternativa (a), CloudFront + Full BFF na mesma distribution, continua arquiteturalmente correta. Porém, a v5 ainda não satisfaz o gate mínimo de 9,0 porque a matriz determinística permanece incompleta e surgiu uma nova opção tecnicamente inválida no gate do `execute-api`.

2. Pontos efetivamente fechados

Os seguintes achados da Rodada 4 foram resolvidos adequadamente:

- A política de assets sem extensão agora possui dois controles verificáveis: `RESERVED_PREFIXES` versionado e validação do conteúdo de `frontend/dist/`.
- `Referrer-Policy` foi fixado literalmente como `strict-origin-when-cross-origin`, em conformidade com `bff-handler.ts`.
- O uso do bloco nativo `content_security_policy` corrige a imprecisão técnica da v4.
- A necessidade de adicionar `idempotency-key` a `FORWARDED_REQUEST_HEADERS` está correta. O código real confirma que atualmente somente `content-type` e `if-match` são encaminhados.
- A ligação direta “CloudFront VPC origin → API Gateway privado” foi corretamente removida.
- Os behaviors explícitos `/bff` e `/bff/*` continuam sendo a solução correta para impedir fallback acidental para `index.html`.

3. A matriz ainda não contém o caso 403 exigido

A Rodada 4 exigiu explicitamente “pelo menos um 403 real e um 404 real”. A v5 afirma responder a esse requisito, mas V1–V6 contêm apenas:

- 200;
- 401;
- 404.

Não existe nenhum caso 403.

O código real oferece um caso determinístico: uma mutação proxied com sessão válida, mas token CSRF ausente ou incorreto, retorna 403 em `handleProxy`. Por exemplo:

- Path: `POST /bff/api/items`
- Auth: sessão válida
- CSRF: cookie/header ausente ou divergente
- Camada: `handleProxy`/`checkCsrf`
- Status: 403
- Verificação: JSON não HTML e corpo diferente de `index.html`

Esse caso precisa entrar na matriz.

4. V6 não é determinístico

V6 fixa o path como:

“`/manifest` (se existir) ou qualquer path sem extensão fora de `RESERVED_PREFIXES`”.

Isso ainda deixa o executor escolher o path e condiciona o caso à existência de algo não definido. Portanto, contradiz a promessa de uma matriz com path fixo.

Além disso, se `/manifest` significar um arquivo estático real, ele seria rejeitado pela própria regra de build por não possuir extensão. Se significar uma rota do React Router, isso precisa ser dito e a rota precisa realmente existir.

V6 deve escolher uma rota SPA real e estável do projeto, com path literal — por exemplo `/items`, caso seja uma rota válida — e exigir corpo idêntico ao `index.html`.

5. V1 e V2 não fixam corretamente a camada produtora

V1 e V2 declaram a camada como “API Gateway/BFF (rota inexistente)”. No Terraform atual não existe `$default` route no HTTP API do BFF. Logo, `/bff` e `/bff/` não chegam à Lambda: o 404 é produzido pelo API Gateway antes de `bff-handler.ts`.

“API Gateway/BFF” volta a combinar duas camadas justamente onde a matriz deveria distingui-las. Deve constar literalmente:

- Camada: API Gateway HTTP API, pré-Lambda.
- Evidência adicional recomendada: ausência de invocação da Lambda para V1/V2, por métrica ou log correlacionado.

6. Nova incorreção: CloudFront Function em `origin-request`

A opção 5(a) diz que o header secreto poderia ser injetado “via uma CloudFront Function no `origin-request`”.

Isso não é suportado. CloudFront Functions só podem ser associadas a `viewer-request` e `viewer-response`; eventos `origin-request` e `origin-response` exigem Lambda@Edge. A documentação oficial é explícita sobre essa restrição: [AWS — Associate functions with distributions](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/associate-function.html).

As opções tecnicamente válidas são:

- header estático configurado na origem custom da distribution; ou
- Lambda@Edge em `origin-request`, se houver justificativa real para lógica dinâmica.

Também convém usar a nomenclatura Terraform correta para a origem: `custom_header`, não `custom_headers_config`, que sugere outro tipo de bloco.

7. Observação menor sobre o gate de build

A proposta chama a validação de “teste de CI”, mas diz que ela roda apenas no job de deploy. Isso é uma contradição operacional. Para impedir que um artefato inválido chegue a `develop`/`main`, o checker deve executar no gate de PR ou no comando de build compartilhado entre CI e deploy, não somente durante publicação.

Não considero esse ponto isoladamente bloqueante para a decisão arquitetural, mas o texto deve escolher uma política precisa.

8. O que falta exatamente para chegar a 9,0

1. Adicionar um caso 403 determinístico à matriz, preferencialmente uma mutação com sessão válida e CSRF inválido.
2. Substituir V6 por um path SPA literal, real e invariável.
3. Corrigir V1/V2 para identificar API Gateway pré-Lambda como a camada produtora do 404.
4. Remover “CloudFront Function em `origin-request`” e substituir por header estático da origem ou Lambda@Edge.
5. Esclarecer se a validação de `frontend/dist/` roda no CI de PR, no deploy, ou em ambos.

9. Veredito

A decisão arquitetural permanece promissora e tecnicamente adequada, mas a proposal v5 ainda não está aprovada pelo protocolo.

Nota final: 8,8/10.
tokens used
