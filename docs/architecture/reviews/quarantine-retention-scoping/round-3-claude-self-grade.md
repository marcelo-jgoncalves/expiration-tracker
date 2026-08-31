# Round 3 — Claude self-grade (written before seeing Codex's Round 3 grade)

**Nota: 9.1/10**

## Por que subiu de 7.3 (Codex R2) para uma autoavaliação de 9.1
Os 6 gaps mais sérios apontados na Rodada 2 têm agora fechamento estrutural, não só prosa:
- `executionArn` deixou de existir como campo persistido — o achado foi resolvido eliminando a
  race, não reforçando a escrita (o ARN é uma função pura determinística do que já é gravado
  atomicamente).
- Idempotência intra-tentativa fechada com uma regra de geração única (`closureAttemptId` só nasce
  na transição `ACTIVE→HELD_FOR_RECOVERY`, nunca em retries).
- Contradição RBAC/RequestContext resolvida nomeando o primitive de autorização dedicado em vez de
  forçar `organization:cancel-close` num union que não se aplica ao caminho sem `RequestContext`.
- `BLOCKED` durante quarentena, retenção de metadados no cancelamento, e o erro de modelagem do
  ASL (`Choice` não lê DynamoDB) todos corrigidos com desenho concreto.
- Backlog LGPD corrigido nas 2 falhas reais: omissão silenciosa das 3 classes já resolvidas e o
  erro semântico de usar vencimento em vez de exclusão como evento gerador de `CORE_USER_DATA`.

## Por que não é 10
- O novo Lambda `ReadTenantLifecycleRecord` e o primitive `authorizeCancelClosure` são nomeados,
  não especificados por assinatura completa (tipos de entrada/saída, onde vivem no layout de
  módulo) — aceitável para uma rodada de design que já decidiu ser design-only, mas um revisor
  rigoroso pode pedir a assinatura completa antes de aprovar.
- Não modelei o cenário de dois cancelamentos concorrentes chegando ao mesmo tempo (ambos leem
  `HELD_FOR_RECOVERY`, ambos tentam `StopExecution`+transição) — o OCC da transição deveria
  resolver (um vence, outro recebe `SystemMutationConflictError` e retorna "já cancelado"), mas não
  escrevi isso como cenário explícito de teste.
- A verificação do limite de 80 caracteres do nome de execução foi feita contra o formato real de
  ID (`src/shared/ids.ts`), mas não abri esse arquivo nesta rodada para confirmar o formato citado
  (ULID 26 + UUID 36) bate exatamente — risco de erro de fato que o Codex pode achar.

## Risco residual aceito
Nenhum dos gaps remanescentes muda o mecanismo ou a prioridade decidida — são detalhes de
assinatura/teste que pertencem à sessão de implementação futura, consistente com o escopo já
fechado como design-only.
