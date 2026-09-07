# Rodada 4 — Crítica Codex (ExternalShareLink), fechamento

**Revisor**: Codex (`codex exec`), 2026-09-07. Nota cega final.

Os três bloqueadores da Rodada 3 foram resolvidos de forma suficiente e concreta.

- **Pesquisa:** a nova fonte primária confirma que uma URL presigned somente pode ser invalidada antecipadamente mediante invalidação das credenciais ou permissões usadas para assiná-la, com impacto mais amplo que um único link. Isso fundamenta corretamente a janela residual de até cinco minutos. [AWS Prescriptive Guidance](https://docs.aws.amazon.com/prescriptive-guidance/latest/presigned-url-best-practices/faq.html), [Amazon S3 User Guide](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html)
- **Cap:** a reconciliação lazy e limitada elimina o bloqueio permanente causado por expirações naturais, preservando o teto concorrente. Na implementação, os deltas do contador deverão ser consolidados em uma única operação sobre o `Document` dentro da transação, pois uma transação DynamoDB não pode operar várias vezes sobre o mesmo item; isso é detalhe executável, não lacuna da decisão.
- **Revalidação:** a semântica de "cópia congelada" agora é inequívoca. Não revalidar `DocumentVersion.state` ou `Document.status` é uma escolha coerente, enquanto `scanStatus`, `cleanObject`, tenant, link e expiração formam a fronteira efetiva de acesso.
- **Transporte:** token no path, handler dedicado que não registra o path bruto, redaction estrutural de `pathParameters.token`, ausência de access logging bruto no stage e `Referrer-Policy: no-referrer` constituem uma fronteira concreta. O regex adicional continua útil para ocorrências `token=...`, embora não seja a defesa principal do novo transporte.

**O protocolo FECHA nesta rodada:** pesquisa e design superam independentemente o gate de 9,0.

**Achado de implementação nomeado (não bloqueia o design, registrar para quem implementar)**: os deltas do contador `activeExternalShareLinkCount` (incremento na criação, decrementos de reconciliação lazy) devem ser consolidados numa única operação de `Update` sobre o item `Document` dentro da mesma `TransactWriteItems` — uma transação DynamoDB não pode conter duas operações sobre o mesmo item.

NOTA FINAL: pesquisa=9,3/10 design=9,2/10
