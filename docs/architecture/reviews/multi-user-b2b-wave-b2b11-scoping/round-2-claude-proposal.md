# Wave B2B-11 — Round 2 Proposal (3 achados bloqueantes reais, nota Codex 8,0/10)

## Correção 1 — fallback: manter `string`, trocar o VALOR, não a assinatura

Aceito o achado: `notification-router-workflow.ts:61-62` já assume retorno `string` e chama
`.trim()` — `undefined` quebraria isso. Além disso, `notification-router-workflow.test.ts:149` cria
um item SEM `assigneeUserId` e só roteia porque o fallback vira `TENANT`, dependendo do
comportamento antigo (quebrado, mas "funcionando por acidente"). Corrigido sem mudar a assinatura:

```ts
export function resolveCandidateUserId(input: { assigneeUserId?: string }): string {
  const assignee = input.assigneeUserId?.trim();
  return assignee && assignee.length > 0 ? assignee : "";
}
```

`tenantId` removido dos PARÂMETROS (nunca foi um candidato válido), mas o tipo de retorno continua
`string` — o caller já trata string vazia via `candidateWasEmpty = candidateUserId.trim().length
=== 0`, nenhuma mudança no `notification-router-workflow.ts` além de parar de passar `tenantId` para
a função. `notification-router-workflow.test.ts:149` precisa ser atualizado: o teste que hoje
"passa por acidente" (esperava rotear para `TENANT` como se fosse um userId real) passa a testar o
comportamento CORRETO — sem assignee, `candidateWasEmpty` é verdadeiro, cancelamento explícito, não
uma tentativa de resolver um `userId` que nunca existiu.

## Correção 2 — preservar a distinção `RECIPIENT_NOT_FOUND` vs. `RECIPIENT_NOT_ELIGIBLE`

Aceito o achado: o comportamento atual distingue "não encontrado" (`undefined`) de "existe mas
inativo" (`active: false`) — minha proposta original colapsaria `SUSPENDED`/`REMOVED`/nunca-existiu
em um único `undefined`. Corrigido, mapeamento explícito de `Membership.status` para
`ResolvedRecipient`:

```ts
async resolve(input: { tenantId: string; candidateUserId: string }): Promise<ResolvedRecipient | undefined> {
  const membership = await this.store.get<Membership>(membershipKey(input.tenantId, input.candidateUserId));
  if (!membership) return undefined; // RECIPIENT_NOT_FOUND — mesma semântica de hoje (UserProfile ausente)
  return { userId: membership.userId, tenantId: membership.organizationId, active: membership.status === "ACTIVE" };
  // SUSPENDED ou REMOVED -> active:false -> RECIPIENT_NOT_ELIGIBLE, mesma semântica de hoje
}
```

`Membership` nunca existiu (usuário nunca foi membro desta Organization) → `undefined`.
`Membership` existe com `status` `SUSPENDED`/`REMOVED` → `active:false`. `ACTIVE` → `active:true`.
Nenhuma classe de estado nova inventada — reaproveita exatamente as 2 saídas que o router já trata.

## Correção 3 — e-mail de entrega precisa vir de `GlobalUser`, não `UserProfile`

Achado real, verificado por leitura antes de aceitar: `resolveRecipientEmail()`
(`runtime/aws/composition/notification.ts:50-56`) lê `UserProfile`
(`TENANT#<tenantId>#USER#<userId>`/`PROFILE`) — criado LAZILY só no primeiro `RequestContext`
resolvido NAQUELA Organization (`resolve-request-context.ts`). `Membership`, por outro lado, já
existe assim que um convite é aceito (`accept-invitation.ts`), **antes** de qualquer login real
naquela Organization. Verificado: `AcceptInvitationService.accept()` exige `GlobalUser` já existente
(`bff-auth-service.ts:672-675`, lança se ausente) — `GlobalUser.emailNormalized` está garantidamente
disponível no momento em que a Membership passa a existir, ao contrário de `UserProfile`. Corrigido:

```ts
async function resolveRecipientEmail(client: DynamoDBDocumentClient, tableName: string, userId: string): Promise<string | undefined> {
  const result = await client.send(new GetCommand({ TableName: tableName, Key: globalUserKey(userId), ConsistentRead: true }));
  const globalUser = result.Item as { emailNormalized?: string } | undefined;
  return globalUser?.emailNormalized;
}
```

`tenantId` removido do parâmetro (chave de `GlobalUser` é tenantless, `USER#<userId>`/`PROFILE`) —
fecha exatamente o gap que o Codex apontou: um membro recém-aceito que ainda não logou naquela
Organization específica agora tem e-mail resolvível, sem depender de `UserProfile` ter sido
provisionado.

## Sem mudanças

Achados #3/#4 (validação de `Membership` ativa em `ItemWatchService`/`assigneeUserId`) mantidos como
na Rodada 1. Porta `MemberEligibilityResolver`/`MembershipEligibilityReader` no módulo consumidor
(sugestão do Codex, não-bloqueante) incorporada como decisão de implementação — evita espalhar
`membershipKey()`/o modelo físico de `organization` em `expiration`. Erro nomeado: `NotFoundError`
reaproveitado (não um erro novo), per a preferência do Codex de não diferenciar por enumeração
externa — distinção `SUSPENDED` vs. inexistente fica só em métricas/logs internos, nunca na resposta
HTTP.
