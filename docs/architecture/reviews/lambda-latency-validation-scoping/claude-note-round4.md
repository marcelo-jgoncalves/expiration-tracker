---
status: final (rodada 4)
---

# Nota da Rodada 4 — Claude (autor da proposta)

Codex: 8,4/10. Não aprovou ainda, mas **executou de verdade os 3 scripts de sourcemap contra cópias
locais dos bundles** (confirmou `toBffRequest:61`/`extractClaims:10` com nomes preservados) - o
bloqueio do Cognito está resolvido e confirmado por execução real, não só leitura de código. Isso
ainda não valida os ZIPs deployados de verdade (só bundles locais) - vou fazer isso na execução.

- **3 rotas de fixture inexistentes**: `GET /documents/{documentId}` não existe (é `GET
  /items/{itemId}/documents/{documentId}`); `GET /document-archive/requirements` não existe (é `GET
  /document-archive/requirements/{subjectId}`); `GET /organizations` não existe (é `GET
  /organizations/members`). Procede - inventei rotas plausíveis sem checar contra o `switch` real de
  cada handler.
- **Comando/nome do worker errados**: faltava `--function-name`; e o nome real (Terraform,
  `infra/main.tf:714`) é `exptrk-dev-outbox-sweeper-reminder-dispatch`, não
  `exptrk-dev-outbox-sweeper-handler` como eu presumi pelo nome do arquivo-fonte. Também: "outbox-
  sweeper complete" é emitido mesmo com `failed > 0` (não é garantia de sucesso), e o worker publica
  em SQS (pode acionar consumidores reais de e-mail/WhatsApp), não é "só DynamoDB" como descrevi.
- **Exclusividade temporal não alinhada à granularidade real do CloudWatch**: `StartTime` arredonda
  pro minuto, período mínimo de agregação é 60s - meu buffer de 1 segundo entre fim da janela e
  início da sintética não garante exclusão dentro do mesmo minuto agregado. Procede.
- **Fórmula estatística com casos indefinidos**: sinal da correção de continuidade não especificado
  pra todo caso; `σᵤ=0` (tudo empatado) sem tratamento; mediana anterior=0 (percentual indefinido)
  sem tratamento; `n<8` deveria nunca gerar classificação confirmatória mesmo atingindo o piso de 5.
- **Critério de "subiu" (diferença absoluta ≥1) não protege contra o caso real**: `1/1000→1/10` é um
  aumento real de taxa (0,1%→10%) mas diferença de contagem = 0 - meu critério deixaria passar.
- **Matriz incompleta**: faltam ações explícitas pra "sem dado", "dados incompletos", "falha de
  smoke", "resultado indicativo" (n baixo) - nenhum desses pode cair implicitamente em "estável/
  MANTER aprovado". Descrição do rollback também precisa dizer "todas as funções do manifesto,
  inclusive fora dos 5 handlers de A" (é isso que o workflow realmente faz).

Nota geral desta rodada (minha, como autor): **7,2/10** - a estrutura de fundo (pontos de exceção,
separação estatística, sinais de erro complementares) já está correta e o Codex confirmou boa parte
por execução real; o que resta agora é fechar casos de borda concretos (nomes reais de recurso, rotas
reais, granularidade de métrica, casos limite de fórmula) - o mesmo padrão de progressão das rodadas
anteriores, cada vez mais raso. Corrigido por completo na Rodada 5.
