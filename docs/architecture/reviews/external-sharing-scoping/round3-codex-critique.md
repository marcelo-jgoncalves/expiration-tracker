codex
A Rodada 3 corrigiu genuinamente a maior parte dos problemas anteriores. Confirmo como fechados: nomes reais dos atributos, ordem anti-enumeração alinhada ao precedente D-143, comparação dummy, congelamento do arquivo, distinção correta entre auditoria CloudWatch e contador de produto, cap concorrente sem `Query` prévia, DTO fechado, tenant lifecycle e decisão explícita de bearer token sem senha.

Minha nota cega, porém, ainda não permite fechar o protocolo.

**Pesquisa: 8,7/10**

A leitura direta do código melhorou bastante a pesquisa de precedentes internos, especialmente o uso de [guest-document-access-service.ts](C:/Users/Usuario/Desktop/projects/expiration-tracker/.claude/worktrees/agent-ab51b87b6f0cca0ea/src/modules/document-archive/application/guest-document-access-service.ts). Permanecem abaixo do gate:

- A janela residual de presign foi aceita por analogia interna, mas ainda falta fonte primária AWS sobre validade, revogabilidade e credenciais temporárias de URLs preassinadas. Isso sustenta diretamente o critério 4.
- A evidência de mercado ainda depende parcialmente de fonte secundária para Google e não demonstra com a mesma qualidade as políticas de senha, expiração e revogação alegadas.
- O precedente de upload bearer é relevante, mas não equivale integralmente à divulgação de conteúdo existente: escrita em quarentena e leitura de documento aceito têm consequências de confidencialidade diferentes. Ele apoia a decisão sem senha, mas não a resolve sozinho como “mesma categoria de dado”.

**Design: 8,4/10**

Achados que impedem o fechamento:

1. **O contador atômico não modela corretamente expiração natural.**  
   `activeExternalShareLinkCount` sobe na criação e só desce na revogação. Como expiração é derivada e não produz transição persistida, cinco links que expirem naturalmente deixam o documento permanentemente no teto, embora haja zero links ativos. É necessário definir uma solução fechada: contador de slots ocupados com liberação explícita/reconciliada; revogação permitida para links expirados; ou outra representação que preserve atomicidade sem drift. Também deve usar `if_not_exists(..., 0)` ou backfill equivalente para documentos anteriores ao novo atributo, além de condição contra underflow.

2. **A revalidação do alvo ainda não tem semântica completa após a criação.**  
   A proposta exige `DocumentVersion.state = ACCEPTED` em cada acesso, mas também declara o link congelado. Quando essa versão virar `SUPERSEDED`, não está decidido se o link deve continuar servindo o snapshot ou invalidar-se. Também falta declarar o efeito de `Document.status = ARCHIVED` e garantir que o presign use exclusivamente o `cleanObject` fresco do `DocumentFile` revalidado. Essas transições são normais do domínio e mudam concretamente a autorização anônima.

3. **A mitigação de vazamento do token ainda contém uma pré-condição não resolvida.**  
   A redaction da query string continua descrita como algo “a confirmar na implementação”. O código atual não oferece uma garantia genérica de redigir a query string inteira; o redactor protege campos chamados `token`, mas não necessariamente uma URL/query serializada como texto. Para satisfazer o critério 2, o design precisa fixar a fronteira concreta: a Lambda pública não inclui query parameters/raw URL em contexto ou logs, e o formato de access log do API Gateway não registra `$context.http.path` com query/raw query contendo o segredo.

Portanto, **o protocolo não pode fechar nesta rodada**: pesquisa e design ficaram abaixo de 9,0, sem arredondamento. Os demais achados anteriores considero genuinamente fechados e não os reabro.

NOTA FINAL: pesquisa=8,7/10 design=8,4/10
