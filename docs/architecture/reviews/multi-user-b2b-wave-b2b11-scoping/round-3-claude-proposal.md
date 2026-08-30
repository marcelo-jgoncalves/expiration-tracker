# Wave B2B-11 — Round 3 Proposal (achado bloqueante da Rodada 2, tréplica exigida pelo mínimo de 3 rodadas)

## Correção — elegibilidade exige `Membership ACTIVE` **e** `GlobalUser.identityStatus ACTIVE`

Aceito o achado: `resolve-request-context.ts:78` já rejeita qualquer usuário com
`GlobalUser.identityStatus !== "ACTIVE"` na resolução normal de contexto (`AuthenticationError`,
coberto por `resolver.test.ts:241`) — um usuário globalmente suspenso não deveria continuar elegível
a receber notificação/ser assignee só porque sua `Membership` na Organization específica continua
`ACTIVE` (suspensão é uma ação de identidade GLOBAL, deve sobrepor o estado local de Membership para
fins de elegibilidade). Corrigido:

```ts
async resolve(input: { tenantId: string; candidateUserId: string }): Promise<ResolvedRecipient | undefined> {
  const membership = await this.store.get<Membership>(membershipKey(input.tenantId, input.candidateUserId));
  if (!membership) return undefined; // RECIPIENT_NOT_FOUND — não é membro desta Organization

  const globalUser = await this.store.get<GlobalUser>(globalUserKey(input.candidateUserId));
  // GlobalUser inexistente seria uma inconsistência estrutural (Membership não existe sem
  // GlobalUser por construção - accept-invitation.ts exige GlobalUser antes de criar Membership),
  // mas tratado como not-eligible por segurança, nunca como crash.
  const active = membership.status === "ACTIVE" && globalUser?.identityStatus === "ACTIVE";
  return { userId: membership.userId, tenantId: membership.organizationId, active };
  // Membership ACTIVE + GlobalUser SUSPENDED -> active:false -> RECIPIENT_NOT_ELIGIBLE (existe
  // como membro real, só não está elegível agora) - nunca RECIPIENT_NOT_FOUND, que fica reservado
  // para "nunca foi membro desta Organization".
}
```

Mesma decisão para `ItemWatchService`/`assigneeUserId` (Achados #3/#4 da Rodada 1): a validação de
"é um membro ativo" passa a exigir as 2 condições, não só `Membership.status`.

## Teste explícito novo (per o pedido do Codex)

Caso adversarial dedicado: `Membership ACTIVE` + `GlobalUser.identityStatus = SUSPENDED` →
`resolve()` retorna `{active: false}`, nunca `undefined` nem `{active: true}` — prova que a
suspensão global sobrepõe o estado local de Membership, e que a distinção
NOT_FOUND/NOT_ELIGIBLE continua correta mesmo neste terceiro caso.

## Sem mudanças

Correções 1-3 da Rodada 2 (fallback `""`, preservação NOT_FOUND/NOT_ELIGIBLE para
Membership ausente/suspensa, e-mail via `GlobalUser`) permanecem exatamente como fechadas —
esta rodada estende a Correção 2 para incluir a segunda condição (`identityStatus`), não substitui
nada já decidido.
