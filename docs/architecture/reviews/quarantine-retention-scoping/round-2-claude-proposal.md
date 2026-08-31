# Quarantine/Recovery Window + LGPD Retention Gaps — Round 2 (Claude proposal, reconciliation)

Round 1 scored 5.5/10 from Codex on real, concrete bugs — not disagreements of taste. Accepting all
11 findings; this round redesigns the mechanism to close them, not just patch prose.

## O que muda de verdade em relação à Rodada 1

### 1. Modelo de dados: quarentena vira estado consultável e nomeado, não um `Wait` opaco

`TenantLifecycleRecord` ganha campos novos (finding 5):

```text
recoveryDeadline?: string   // ISO timestamp — quando HELD_FOR_RECOVERY vence, calculado no
                             // momento da transição, nunca recalculado pela execução
closureAttemptId?: string   // novo UUID por tentativa de fechamento — resolve finding 3
executionArn?: string       // guardado para permitir StopExecution determinístico — finding 2
```

`StartExecution` deixa de usar `name: tenantId` (finding 3) — passa a usar
`name: ${tenantId}-${closureAttemptId}` (16-64 chars, mesmo padrão de sufixo já usado por outros
nomes determinísticos deste projeto). Isso resolve o ciclo cancelar→fechar de novo: cada tentativa
tem um nome de execução distinto, então uma segunda `close()` depois de um cancelamento real inicia
uma execução nova, nunca colide com `ExecutionAlreadyExists` de uma execução já parada.

### 2. Grafo: `HELD_FOR_RECOVERY` é estado em voo de primeira classe, não um desvio do `DELETING`

`ACTIVE → HELD_FOR_RECOVERY → DELETING → QUIESCING → PURGING → VERIFIED → DELETED`.

- **`ALLOWED_TRANSITIONS`** (`tenant-lifecycle-record.ts` linha 91, finding 5) ganha exatamente UMA
  aresta nova para `ACTIVE`: `HELD_FOR_RECOVERY → ACTIVE` — não uma regra geral de "qualquer estado
  pode voltar", só essa aresta específica, mantendo o resto do grafo forward-only como já
  `APPROVED`. O comentário existente ("ACTIVE nunca é reentrada") é atualizado para nomear esta
  única exceção, não removido silenciosamente.
- **`IN_FLIGHT_STATUSES`** (`close-organization.ts` linha 48, finding 4) ganha `HELD_FOR_RECOVERY` —
  fecha o bug real que o Codex achou: sem isso, uma repetição de `close()` após
  `ACTIVE→HELD_FOR_RECOVERY` comitar mas `StartExecution` falhar cairia no branch de
  `CLOSURE_UNAVAILABLE_STATUSES` e travaria o tenant permanentemente em hold.
- **`CLOSURE_UNAVAILABLE_STATUSES`** continua `VERIFIED`/`DELETED`/`BLOCKED`/`HELD` — inalterado
  (`HELD` legado ≠ `HELD_FOR_RECOVERY` novo; nomes deliberadamente distintos para não confundir
  quarentena com o hold operacional/jurídico pré-existente, finding 5's segunda observação).
- `TENANT_ACTIVE_STATUS` continua exclusivamente `"ACTIVE"` — `HELD_FOR_RECOVERY` bloqueia
  `TenantBusinessMutation` corretamente, sem mudança (finding 6, primeira metade já correta).

### 3. Cancelamento: caminho de resolução próprio, não o `RequestContext` normal

Finding 1 é o achado mais sério: a resolução padrão de `RequestContext`
(`resolve-request-context.ts` linha 11) exige `TenantLifecycleRecord.status === ACTIVE` — um OWNER
em `HELD_FOR_RECOVERY` nunca chegaria a `authorize()` pelo pipeline HTTP normal.

**Novo caminho de resolução mínimo, isolado**: `CancelOrganizationClosureService` não reusa
`RequestContext`/`resolveWorkingOrganization()`. Recebe `(cognitoSub, tenantId)` do handler HTTP
diretamente e:
1. Lê `Membership` real (`PK=TENANT#{tenantId}`, `SK=MEMBERSHIP#{userId}` via `GlobalUser` já
   resolvido do JWT) — exige `status=ACTIVE` e `role=OWNER`, mesma checagem dupla já usada por
   `resolve-request-context.ts` (`Membership ACTIVE` + `GlobalUser.identityStatus ACTIVE`,
   precedente de D-107).
2. Lê `TenantLifecycleRecord` — aceita **exclusivamente** `status === HELD_FOR_RECOVERY`; qualquer
   outro estado retorna `OrganizationClosureUnavailableError` (mesmo tipo de erro já existente).
3. Não constrói um `RequestContext` reutilizável — este é um caminho de exceção de uma única ação,
   não um novo modo geral de operar sobre tenant não-`ACTIVE` (finding 1's requisito explícito).

**Coordenação com a execução Step Functions (finding 2, o achado mais importante do todo)**:
1. `StopExecution(executionArn)` é chamado **antes** de qualquer escrita — se falhar, o
   cancelamento inteiro falha (erro 500, nada muda), nunca restaura `ACTIVE` com a execução ainda
   viva.
2. Só depois de `StopExecution` confirmar (`stopDate` presente na resposta, ou
   `ExecutionDoesNotExist`/já parada — idempotente), `transitionTenantLifecycle` roda
   `HELD_FOR_RECOVERY → ACTIVE` com `expectedVersion` (OCC já existente) — se a versão mudou (ex.:
   a execução já tinha avançado o registro para `DELETING` por vencimento do prazo antes do
   `StopExecution` completar), a transição falha com `SystemMutationConflictError` e o
   cancelamento retorna "prazo já vencido, exclusão em andamento" em vez de silenciosamente
   reportar sucesso — fecha a corrida deadline-vs-cancel citada no finding 2.
3. **Do lado da execução** (o "acordar depois de cancelado" do finding 2): o `Task` que roda depois
   do `Wait` de 30 dias já lê `TenantLifecycleRecord` com `ConsistentRead` antes de agir (mesmo
   padrão do worker de purga hoje) — se o `status` não for mais `HELD_FOR_RECOVERY` (foi cancelado
   ou já parado), a execução termina em um estado `Succeeded` explícito de "no-op, cancelado por
   fora", nunca tenta marcar `BLOCKED` para uma transição que não existe mais. Isso é um branch novo
   no ASL (`Choice` checando o status antes do primeiro `Wait→DELETING`), não um efeito colateral
   torcido do `Catch` genérico.

### 4. RBAC: mudanças completas, não "1 action"

Finding 7. `organization:cancel-close` é adicionado ao union `Action` (`authorization.ts` linha 7),
`ACTION_ROLES` (linha 128, `Record<Action, ...>`, `OWNER_ROLES` mesmo tier de `organization:close`),
teste de allowlist novo (mesmo padrão dos testes já existentes por action), e o evento de negação
de autorização já cai na taxonomia fechada existente de `security-audit.ts` sem mudança adicional —
nomeado explicitamente para não ficar implícito de novo.

### 5. Correção honesta da matemática da Rodada 1

Finding 8: 30 não é o ponto médio de 20-90 (55, correto). Justificativa revisada: **30 dias é o
menor precedente convergente real** entre os 4 (Slack-arquivo=30, GitHub=90, AWS=90,
Google=20-25) que ainda cobre 3 de 4 fontes olhando "≥30", e coincide — não por coincidência
estrutural, apenas numericamente — com o prazo já usado internamente para 2 das 9 classes LGPD.
Escolhido por ser o piso defensável mais curto (menor tempo de exposição do OWNER a uma janela
"morta" sem poder operar o tenant), não por ser uma média.

### 6. Contrato mínimo reusável (finding 9) — nomeado explicitamente, não apenas prometido

Qualquer lifecycle futuro (incluindo a feature de arquivos, ainda não escopada) que adote este
padrão precisa declarar, no mínimo, os mesmos 4 campos usados aqui: `recoveryDeadline` (persistido,
nunca só um `Wait` de execução), `closureAttemptId` (identidade de tentativa, nunca reusar o ID da
entidade como nome de execução), autoridade de cancelamento (quem pode agir durante a janela — aqui
OWNER via caminho de resolução dedicado), e uma re-verificação de estado imediatamente antes da
PRIMEIRA ação física irreversível (aqui, o `Choice` antes do `Wait→DELETING`) — sem essa
re-verificação, nenhuma quarentena é real, é só um atraso.

### 7. LGPD: `LEGAL_EVIDENCE` sai da ordem linear (finding 10)

Prioridade revisada em duas pistas, não uma lista única:

**Pista executável (ordem de implementação real)**:
1. `CORE_USER_DATA` — mas decomposta por entidade+evento gerador de `purgeAfter` (não uma unidade
   monolítica): primeiro `ExpirationItem`/`RecurrenceOccurrence` deletados/expirados há 30+ dias
   (maior volume, evento gerador já existe — soft-delete/exclusão explícita).
2. `DELIVERY_RECORD` (intents/attempts, 180 dias) — evento gerador já existe (criação do record),
   prazo fixo, sem ambiguidade de "encerramento".
3. `SECURITY_AUDIT` (365 dias) — evento gerador simples (criação do evento), maior volume acumulado.
4. `QUOTA_TELEMETRY` — baixa sensibilidade, mas evento gerador simples (fim de janela + 30 dias).
5. `ACCOUNT_ACTIVE` fora do fechamento de tenant — decompor por entidade: `Invitation`
   expirada/revogada (evento claro), depois `Membership` removida (evento claro via B2B-8),
   `Channel` é o mais ambíguo (sem evento de "encerramento" formal ainda) — menor prioridade dentro
   desta classe.
6. `TRANSIENT` restante (`WebhookInbox`, `UploadSlot`) — menor exposição residual.

**Pista bloqueada (fora da ordem de implementação linear)**:
- `LEGAL_EVIDENCE` — não é "posição 4", é uma lane separada que só pode começar depois da trava
  jurídica (aprovação jurídica + KMS independente + Object Lock, já `APPROVED` em `privacy-lgpd.md`
  §4) estar resolvida — nenhum trabalho técnico de purga deveria adiantar-se a essa decisão.

### 8. Escopo de implementação: revertido para design-only (finding 11)

A Rodada 1 errou ao estimar isto como "1 estado + 1 Wait + 1 service" implementável no mesmo dia.
A lista real de mudanças (grafo + 3 campos novos + naming de execução + `StopExecution` coordenado
+ caminho de resolução de identidade dedicado + branch novo no ASL + RBAC completo + testes de
concorrência/idempotência) é comparável a uma wave dedicada (ex. B2B-6/B2B-9), não a D-125.

**Esta rodada aprova o MECANISMO como design.** Implementação real fica para uma sessão futura
dedicada — nomeada explicitamente no fechamento (não implícita), mesmo padrão que W3-07 orquestrador
usou entre D-121 (design) e D-124 (implementação em sessão separada).

## Checklist revisado (mesmos pesos da Rodada 1, sem redefinir a régua)
Sem mudança de pesos — a Rodada 1 já fixou o checklist; esta rodada é reconciliação contra os
mesmos 6 critérios, corrigindo os itens onde a Rodada 1 ficou abaixo do esperado (cancelamento
real, cross-cutting, escopo de implementação).
