# Crítica Codex — Rodada 4 (sobre proposal-claude-v4.md)

Nota: 8,9/10

1. Nota

Nota: 8,9/10.

A v4 melhora materialmente a proposta e fecha o problema central de /bff. Ainda não alcança 9,0 porque três contratos permanecem incompletos e um mecanismo listado para o gate do execute-api é tecnicamente inaplicável à topologia descrita.

2. Roteamento do path exato /bff

O ordered_cache_behavior com path_pattern = "/bff" fecha corretamente o achado principal da Rodada 3.

Com os behaviors dedicados para /bff e /bff/*:

- /bff não cai mais no default behavior;
- /bff/ e as rotas funcionais continuam indo para a origem BFF;
- a CloudFront Function da SPA não consegue trocar a origem já selecionada;
- erros do API Gateway/BFF não viram index.html.

Esse ponto está aprovado.

3. Heurística para assets sem extensão ainda não foi realmente fechada

A nova function preserva /.well-known/ e /bff*, mas continua reescrevendo qualquer outro path cujo último segmento não tenha ponto.

Portanto, os exemplos levantados na Rodada 3 continuam mascarados:

- /manifest
- /health
- /robots, caso algum recurso desse tipo seja publicado
- qualquer outro asset futuro sem extensão fora de /.well-known/

A frase “exigiria ser adicionado à lista acima ou publicado sob um prefixo dedicado” descreve uma obrigação futura, mas não a transforma em contrato verificável. Não há:

- lista de prefixos estáticos reservados;
- regra executável que impeça publicar assets sem extensão;
- teste que compare os objetos publicados com o predicado da function;
- teste explícito provando a política para um recurso sem extensão, como /manifest.

A solução pode continuar usando essa heurística, mas precisa assumir formalmente uma destas opções:

- allowlist das rotas/prefixos reais do React Router; ou
- denylist versionada de namespaces estáticos, acompanhada de regra de publicação; ou
- teste de build que falhe se o artefato gerar um asset sem extensão não reservado.

Sem isso, a lacuna foi documentada, mas não fechada.

4. Suíte real de roteamento ainda está abaixo do que a Rodada 3 exigiu

A suíte unitária proposta está adequada, incluindo método, query string, assets, /.well-known/ e os três formatos de /bff.

A verificação real, porém, regrediu em precisão. A v4 exige somente:

- /bff;
- /bff/algo-inexistente-e-nao-autorizado;
- status “401/403/404 conforme o caso”.

Isso não garante separadamente as propriedades pedidas na Rodada 3:

- teste real de /bff/;
- um 403 real e determinístico;
- um 404 real e determinístico;
- distinção entre erro pré-Lambda e erro produzido pelo BFF;
- autenticação apropriada quando necessária para alcançar o 404 da allowlist, em vez de parar antes em 401.

“401/403/404 conforme o caso” permite que uma mudança de 403 para 401, ou de 404 para 401, passe sem detectar que a camada esperada deixou de ser exercitada.

A matriz deve fixar path, estado de autenticação e status esperado para cada caso, incluindo pelo menos /bff, /bff/, um 403 real e um 404 real, sempre afirmando Content-Type não HTML e corpo diferente do index.html.

5. Response Headers Policy ainda não tem todos os valores concretos

HSTS, CSP e nosniff estão definidos concretamente e coincidem com src/runtime/aws/handlers/bff-handler.ts.

O Referrer-Policy, entretanto, continua especificado como “mesmo valor de bff-handler.ts”. O valor atual real é:

strict-origin-when-cross-origin

Logo, a proposta deve registrá-lo literalmente. Dizer que os valores foram fixados e simultaneamente delegar um deles à implementação corrente preserva drift bidirecional e enfraquece o teste esperado.

Também há uma imprecisão técnica: CloudFront Response Headers Policy possui configuração específica de Content-Security-Policy dentro de security_headers_config. CSP pode ser exposto como custom header, mas “CSP não tem bloco dedicado” não é verdadeiro e não deveria fundamentar a escolha. A proposta deve usar o bloco nativo ou justificar explicitamente por que prefere custom_headers_config.

O teste pré-Lambda é uma boa correção, desde que use um caso determinístico e afirme os quatro valores exatos.

6. CORS

A especificação de teste agora cobre corretamente:

- headers;
- métodos;
- allow_credentials = true;
- allow_origins = [var.app_origin];
- comparação sem dependência de ordem ou capitalização.

Esse achado da Rodada 3 está fechado no nível de infraestrutura proposta.

Há, contudo, uma integração adjacente que a implementação deve verificar: o BFF atual só encaminha content-type e if-match ao backend em proxy-service.ts. Idempotency-Key consta como header necessário no novo contrato CORS, mas atualmente é descartado pelo proxy. Permiti-lo no preflight não garante que chegue à API de recurso. A implementação precisa adicionar Idempotency-Key à allowlist de encaminhamento e testá-lo ponta a ponta, ou declarar explicitamente por que nenhuma rota proxied depende dele. No estado atual do repositório, depende.

7. Gate do endpoint execute-api

A remoção de aws:SourceArn como mitigação presumida está correta.

Dois candidatos são descritos honestamente:

- custom header secreto validado pelo BFF pode diferenciar o tráfego normal da distribuição, desde que sejam definidos armazenamento, rotação e comportamento fail-closed;
- WAF na distribuição reduz abuso na borda, mas, como a própria proposta reconhece, não impede acesso direto ao execute-api.

O terceiro candidato está tecnicamente incorreto: “API Gateway privado + CloudFront com VPC origin” não é uma conexão diretamente suportada. CloudFront VPC origins suportam recursos como ALB, NLB e instância EC2 dentro da VPC; um endpoint privado do API Gateway não é diretamente uma VPC origin do CloudFront.

Se essa alternativa permanecer, ela precisa incluir um origin intermediário suportado e explicar a topologia, ou ser substituída por uma opção comprovadamente aplicável. O gate não pode trocar uma hipótese inválida por outra.

8. O que falta exatamente para chegar a 9,0

1. Tornar verificável a política para assets sem extensão, por allowlist de rotas, namespace estático reservado ou validação dos artefatos do build.
2. Fixar uma matriz de testes reais determinística cobrindo /bff, /bff/, pelo menos um 403 real e um 404 real, com estado de autenticação e camada produtora da resposta definidos.
3. Escrever literalmente Referrer-Policy = strict-origin-when-cross-origin e corrigir a afirmação sobre a inexistência de bloco nativo de CSP.
4. Garantir e testar que Idempotency-Key não apenas passa no CORS, mas é encaminhado pelo Full BFF à API.
5. Remover “API Gateway privado + CloudFront VPC origin” como ligação direta ou especificar uma topologia intermediária realmente suportada.

9. Veredito

A coexistência CloudFront + Full BFF continua arquiteturalmente válida, e o problema de /bff exato foi corretamente resolvido. A proposta v4 ainda não está aprovada pelo gate do protocolo.

Veredito final: 8,9/10, abaixo do mínimo de 9,0.
