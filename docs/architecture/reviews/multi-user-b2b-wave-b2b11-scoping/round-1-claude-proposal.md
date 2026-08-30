# Wave B2B-11 (Responsibility + Notifications) — Round 1 Proposal

Escopo per `roadmap-evolution/17-multi-user-b2b-revised-strategy.md` §116 (texto integral, deliberadamente
terso): "Integrar: responsible member, ItemWatch, notification routing — para que Multi-User seja
funcionalmente útil, não apenas infra de autorização."

## Classificação de risco (`change-risk-scale.md`)

**Type 1, nível 5** — muda a autoridade de validação de acesso tenant-scoped no pipeline de
notificação (mesma classe de decisão de B2B-6, Tenant Context Injection) e decide quem pode ser
`assigneeUserId`/`ItemWatch.userId` (fronteira de acesso a dado real). Protocolo Claude↔Codex
completo obrigatório.

## Achados reais de código (verificados por leitura, não hipotéticos)

**Achado #1 — `NotificationRecipientResolver` valida contra a entidade errada.**
`src/modules/notification/persistence/dynamodb-recipient-resolver.ts`'s `resolve()` busca
`UserProfile` (`PK=TENANT#<tenantId>#USER#<userId>`, `status: "ACTIVE"|"SUSPENDED"`) para decidir se
um candidato é elegível a receber notificação. Sob o modelo B2B, `UserProfile.status` é vestigial —
o próprio comentário do arquivo (`user-repository.ts:24-27`) diz que `RequestContext.tenant.roles`
já vem de `Membership.role` desde B2B-5/D-095, "nunca lido para autorização" — e `UserProfile.status`
nunca é a mesma coisa que "este usuário tem acesso ATIVO a esta Organization": um usuário removido de
uma Organization (`Membership.status="REMOVED"`) pode ainda ter uma linha `UserProfile` intocada
(nada hoje apaga `UserProfile` na remoção de Membership), então o resolver aprovaria incorretamente
notificar alguém que já não pertence à Organization.

**Achado #2 — `resolveCandidateUserId()`'s fallback está estruturalmente quebrado pós-B2B.**
`src/modules/notification/ports/recipient-resolver.ts:29-32`: `assignee ?? input.tenantId` — sob o
modelo B2B, `tenantId` É `organizationId` (nunca um `userId` real). Sem `assigneeUserId`, o candidato
resolvido é literalmente o ID da Organization tentando ser validado como usuário — falha sempre (não
existe `Membership`/`UserProfile` cuja chave seja o próprio `organizationId` como `userId`), então o
efeito observável hoje é "sempre `RECIPIENT_NOT_FOUND`" quando não há assignee — não é uma
vulnerabilidade (fail-closed), mas é uma regra morta/enganosa que finge ter um fallback e não tem.

**Achado #3 — `ItemWatchService.addWatcher`/`removeWatcher` aceitam qualquer string como `userId`.**
`src/modules/expiration/http/item-watch-handlers.ts:64-82`: `userId` vem direto do path parameter
(`requireUserId`), sem nenhuma validação contra `Membership` real antes de
`deps.watches.addWatcher(context, itemId, userId)`. `item-watch-service.ts:34-49` grava a linha
`ItemWatch` para qualquer `userId` recebido. Mitigado parcialmente hoje pelo Achado #1 (o resolver de
notificação rejeitaria um `userId` forjado na hora de notificar), mas a linha `ItemWatch` em si é
gravada de qualquer forma — dado de negócio incorreto persistido, não é só "sem efeito".

**Achado #4 — `assigneeUserId` (create/update de `ExpirationItem`) sem validação nenhuma.**
`src/modules/expiration/application/expiration-service.ts` (linhas 121/168/261/472): `assigneeUserId`
é atribuído diretamente do input, sem checar se é uma `Membership` real/ativa da Organization. Mesma
classe de gap do Achado #3, na aresta de escrita do "responsible member" em vez do watcher.

## Declaração E-014

**SIM PARCIAL**. Pesquisado 2026-08-30:
- **GitHub** (`docs.github.com`, "Assigning issues and pull requests"): quem PODE ser atribuído
  precisa ser colaborador com permissão real no repositório ou membro da organização com acesso —
  nunca um ID arbitrário.
- **Linear** (`linear.app/docs/assigning-issues`, fetch direto): "Issues in public teams can be
  assigned to any workspace member" / "Private team issues can only be assigned to members of the
  private team" — e explicitamente, **usuários suspensos não podem receber atribuição**.

Convergência real 2/2 sobre **"quem pode ser responsible/assignee deve ser um membro real e ativo"**
— confirma os Achados #3/#4 como gaps reais, não hipotéticos. **Sem convergência clara** sobre "quem
é notificado quando não há assignee" (Jira/Linear não documentam uma regra universal; a busca não
achou uma resposta única) — essa parte da decisão fica sob proporcionalidade própria (`principles.md`
#1), não sob pesquisa externa como régua.

## Proposta concreta

### 1. `NotificationRecipientResolver` migrado para `Membership`

`DynamoDbNotificationRecipientResolver.resolve()` passa a buscar `Membership`
(`membershipKey(tenantId, candidateUserId)`) em vez de `UserProfile`, checando
`membership.status === "ACTIVE"` (não `UserProfile.status`). `ResolvedRecipient` continua com a
mesma forma (`userId`/`tenantId`/`active`) — nenhuma mudança de contrato para o router chamador.

### 2. `resolveCandidateUserId()` — remove o fallback quebrado, torna `undefined` explícito

```ts
export function resolveCandidateUserId(input: { assigneeUserId?: string }): string | undefined {
  const assignee = input.assigneeUserId?.trim();
  return assignee && assignee.length > 0 ? assignee : undefined;
}
```

`tenantId` removido da assinatura (nunca foi um candidato válido). Sem `assigneeUserId`, nenhum
candidato é resolvido — o router já trata isso como `RECIPIENT_NOT_FOUND`/cancelamento auditável,
comportamento inalterado na prática (já era o resultado de fato hoje), só honesto sobre a regra.

### 3. `ItemWatchService.addWatcher`/`removeWatcher` validam `Membership` ativa

Antes de gravar/remover a linha `ItemWatch`, `addWatcher()` busca `Membership` do `userId` alvo na
Organization do `ctx` — rejeita com um `AppError` nomeado (`NotFoundError` ou um novo
`InvalidWatcherError`, a decidir na Rodada 1 do Codex) se não houver `Membership` `ACTIVE`.

### 4. `assigneeUserId` (create/update `ExpirationItem`) valida `Membership` ativa

Mesma checagem do item 3, na escrita do item. Requer acesso a `OrganizationStore`/`Membership` a
partir de `ExpirationService` — dependência nova entre módulos (`expiration` → `organization`),
avaliar se `check-boundaries`/`.dependency-cruiser.cjs` já permite essa direção ou se precisa de porta
nova (pergunta aberta ao Codex).

## Fora de escopo desta wave

Definir um destinatário PADRÃO quando não há assignee (ex. notificar todos os OWNER/ADMIN) — sem
convergência externa clara e não pedido explicitamente pelo §116 ("notification routing" já cobre
rotear para o assignee real corretamente; inventar um destinatário padrão seria escopo novo não
aprovado). UI de atribuição de responsável/watcher no frontend (B2B-10 já fechou o frontend
tenant-aware básico; uma tela dedicada de "responsible member" picker fica para quando houver pedido
de produto explícito).

## Perguntas abertas para a Rodada 1 do Codex

1. `ItemWatchService`/`ExpirationService` validarem `Membership` diretamente cria uma dependência de
   módulo nova (`expiration` → `organization`) — isso é aceitável, ou deveria passar por uma porta
   compartilhada (`MembershipValidator` em `shared/`) para não acoplar os módulos diretamente?
2. O nome do erro para "watcher/assignee alvo não é um membro ativo" — reaproveitar `NotFoundError`
   (mais genérico) ou um erro nomeado novo (`InvalidAssigneeError`/`InvalidWatcherError`, mais
   específico, mesma disciplina de erro nomeado já usada no projeto)?
3. Existe algum outro escritor/leitor de `assigneeUserId`/`ItemWatch.userId` que eu não tenha
   encontrado por este grep que também precisaria da mesma validação?
