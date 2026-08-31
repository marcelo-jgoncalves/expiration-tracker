## Rodada 3 — Parecer Codex

**Veredito: a classificação de `API_REQUEST` como `QUOTA_TELEMETRY` é correta, mas D-127 não autoriza retirar esse registro da lane fenced.** A proposta reutiliza corretamente a classe de retenção; extrapola-a incorretamente para uma exceção à invariante de escrita do W3-07.

Não é necessário reabrir ou alterar a taxonomia de D-127. É necessário aprovar, pelo protocolo Type 1, uma emenda específica ao W3-07/D-011 que crie uma lane de telemetria efêmera pós-lifecycle — caso essa continue sendo a opção escolhida.

### Diferença material

D-127 decidiu:

- classificação e prazo de retenção;
- prioridade de implementação da purga por idade;
- não existência de hold para `QUOTA_TELEMETRY`.

Ele não decidiu:

- que telemetria tenant-scoped pode ser criada após `ACTIVE → DELETING`;
- que TTL substitui a descoberta/purga da organização;
- que `QUOTA_TELEMETRY` fica fora da definição de dado tenant-scoped do W3-07.

O próprio consolidado de D-127 diz que `QUOTA_TELEMETRY` hoje só é purgada no fechamento do tenant e prescreve uma futura purga por idade. Já `privacy-lgpd.md` §4.2 registra `MembershipInviteRateLimitRecord` como coberto estruturalmente pelo scan `TENANT#<id>#...`. Portanto, esse precedente demonstra **TTL mais purge**, não **TTL em vez de purge/fence**.

Há ainda uma afirmação factual a corrigir: o item não “sobrevive no máximo janela + 30 dias”. O TTL do DynamoDB é assíncrono e best-effort; itens expirados normalmente são apagados alguns dias depois e continuam aparecendo em leituras até a exclusão. A AWS não oferece um limite máximo rígido para essa remoção. [Documentação oficial do DynamoDB TTL](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/TTL.html)

### Bloqueante remanescente de D-D

O caso de corrida é:

1. `RequestContextResolver` observa `ACTIVE`;
2. lifecycle muda atomicamente para `DELETING`;
3. o `UpdateItem` isolado cria/incrementa o bucket;
4. a varredura de purge pode já ter ultrapassado essa chave;
5. surge um resíduo tenant-scoped tardio, sem limite rígido de remoção pelo TTL.

A baixa sensibilidade e a retenção curta reduzem o impacto, mas não alteram a propriedade formal violada. Retenção responde “por quanto tempo manter”; o fence responde “quando uma nova escrita ainda pode ser admitida”.

### Caminhos aceitáveis

1. **Manter o fence**, usando `TransactWriteItems` para `API_REQUEST`. Preserva W3-07, mas reduz pouco o custo/latência.

2. **Criar formalmente uma `EphemeralTelemetryMutation` lane**, aprovada como emenda ao W3-07, com contrato explícito:

   - somente tipos allowlisted, inicialmente `API_REQUEST`;
   - nenhum dado de negócio, PII direta, entitlement ou capability;
   - escrita permitida após a leitura stale de `ACTIVE`;
   - `purgeAfterTtl = windowEnd + 30d`;
   - item permanece detectável pelo purge e pelo sweeper pós-`DELETED`;
   - leituras ignoram buckets expirados;
   - ausência do item nunca concede direito comercial;
   - teste adversarial da corrida `ACTIVE → DELETING`;
   - métrica/alarme para resíduos após `DELETED`.

3. **Retirar completamente a identidade tenant da telemetria**, se for possível preservar a quota por outro identificador não reversível e sem necessidade de reconciliação. Isso seria uma mudança maior e também exigiria protocolo.

Recomendo o caminho 2: ele captura honestamente a semântica desejada sem fingir que D-127 já decidiu a exceção.

### Outras correções necessárias

- A chave proposta usa `floor(epochSeconds/60)`, mas o texto diz que `windowSeconds` continua configurável. Deve ser `floor(epochSeconds/windowSeconds)` ou a janela de 60 segundos precisa ser explicitamente fixada para `API_REQUEST`.
- O atributo TTL real da tabela é `purgeAfterTtl`, não `ttl`.
- O fail-open de `API_REQUEST` é defensável, mas é uma nova decisão antiabuso/disponibilidade e deve distinguir:
  - falha de dependência → permite e registra;
  - `ConditionalCheckFailedException` → 429;
  - erro de validação/corrupção/bug → não deve ser silenciosamente tratado como indisponibilidade.
- Recalibrar o API Gateway é necessário, mas “acima da soma esperada em dev” não é um critério operacional durável. O valor deve derivar de capacidade protegida, concorrência Lambda/DynamoDB e margem sobre o limite agregado esperado.

D-A, D-B, D-C e D-E estão materialmente fechados no nível de design descrito.

**Nota da Rodada 3: 8,7/10 — NÃO APROVADO.** O único bloqueante arquitetural é a exceção implícita ao W3-07. Com a lane efêmera formalizada e as correções acima, a proposta tem caminho claro para superar 9,0.
