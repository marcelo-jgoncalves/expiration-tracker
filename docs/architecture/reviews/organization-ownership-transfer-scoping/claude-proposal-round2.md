---
status: draft
owner: Marcelo
authority: proposta Rodada 2 do protocolo Claude↔Codex (AGENTS.md §4) — nível 5, não normativo até convergência
---

# Transferência de titularidade (OWNER) de organização — Rodada 2

Responde aos seis achados do Codex na Rodada 1 (`round1-output`, nota geral 8,2 desenho / 7,0
régua). Este documento não repete o que não mudou de `claude-proposal-round1.md` (contexto,
autorização, escopo, casos de erro gerais) — só as seções corrigidas. Ver `claude-note-round1.md`
para minha concordância explícita com cada achado.

## 1. Correção do achado A — matriz fonte→afirmação, honestidade sobre o que é interno

| Afirmação da proposta | O que a fonte realmente diz | Status |
|---|---|---|
| "Alvo já deve ser Membership ACTIVE aceita, nunca convite pendente" | GitHub, Slack, Google Workspace e Notion exigem os quatro que o sucessor já seja um membro/usuário existente do workspace/org antes de poder receber o papel de dono | **Confirmado pelas 4 fontes** — mantido no checklist como critério informado por pesquisa |
| "Só o próprio OWNER que cede pode iniciar" | GitHub, Slack e Google Workspace: sim, a transferência é uma ação que o dono atual inicia sobre a própria titularidade | **Confirmado pelas 3 fontes** (Notion não trata do fluxo de iniciação) — mantido |
| "Antigo OWNER nunca é removido, vira ADMIN" | **Não confirmado.** GitHub: o antigo owner é removido da organização como parte do fluxo (não rebaixado). Slack: o cedente passa a "Owner" comum, não removido, mas mantendo dois papéis distintos (Primary Owner vs Owner) que não correspondem 1:1 a OWNER/ADMIN deste projeto. Google Workspace: o NOVO super admin remove manualmente o papel do antigo, não é automático nem garantido. | **Decisão interna do OmniVence**, não padrão de mercado — ver justificativa abaixo |
| "Postura de reautenticação antes da execução" | OWASP (norma de segurança, não vendor) recomenda; nenhum dos 4 produtos documenta reautenticação especificamente para ESTA ação (os fluxos de suporte mencionam confirmação por e-mail/2FA de forma genérica, não uma segunda barreira dedicada) | **Parcialmente informado** — a postura geral (ações de maior irreversibilidade merecem fricção extra) é da OWASP; a ausência de um mecanismo específico documentado nos 4 produtos não prova nem desmente a necessidade aqui |
| "Transação atômica evita a janela transitória que o fluxo sequencial dos concorrentes existe para contornar" | **Removido.** Nenhuma das fontes explica POR QUE usam um fluxo sequencial (limitação de infraestrutura vs. escolha deliberada de UX) — essa era uma inferência minha sobre a infraestrutura interna de outros sistemas, apresentada como fato. Não tenho como verificar. | **Removido da proposta** |

**Decisão interna (não é consenso externo) — antigo OWNER vira ADMIN, nunca é removido**:
justificativa é `D-097` (`multi-user-b2b-wave-b2b7-scope.md`), que já registrou que remover
acesso administrativo de alguém no mesmo ato que transfere titularidade cria um risco operacional
maior (o ex-dono pode ter contexto/dados/integrações que só ele sabe operar) do que retê-lo como
ADMIN, que ainda pode ser removido separadamente depois via `RemoveMembershipService`/
`LeaveOrganizationService` já existentes, como uma decisão deliberada e reversível, não acoplada à
transferência. Registro isso explicitamente como escolha do OmniVence, não como algo "que o
mercado faz".

**Checklist corrigido** (critério 3 do doc original mantém peso 15%, mas a coluna "atende" agora
cita a fonte certa; critério "antigo OWNER nunca removido" deixa de aparecer como item pesado
informado por pesquisa — vira parte do desenho técnico da seção 2, decisão interna, sem peso de
régua de pesquisa externa).

## 2. Correção do achado B — auditoria vinculada ao estado realmente alterado, não ao lido antes

Problema real: `target.role` usado no evento de auditoria vinha do `GetItem` anterior à transação,
podendo já estar desatualizado se `expectedTargetVersion` (fornecido pelo cliente) correspondeu a
uma versão mais nova produzida por outra escrita entre a leitura e o envio da requisição.

**Correção**: o algoritmo exige explicitamente, antes de montar a transação:

```
if (target.version !== expectedTargetVersion) → ConflictError (mesmo tratamento do índice de
  cancelamento — ver seção 4 — só que detectado antes de gastar uma chamada de transação)
if (caller.version !== expectedCallerVersion) → ConflictError
```

Isto não é redundante com a `ConditionExpression` da transação (que continua existindo, contra
corrida real entre esta checagem e o commit) — é o que garante que o `fromRole`/`toRole` gravados
no evento de auditoria correspondem exatamente ao estado que a leitura confirmada acabou de ver,
nunca a um estado hipotético mais novo que a condição da transação também aceitaria (a condição
exige `version = :expectedTargetVersion`, então se a checagem acima já validou
`target.version === expectedTargetVersion`, os dois são necessariamente a mesma leitura — o
`fromRole` gravado é garantidamente o role dessa versão exata, nunca de uma versão posterior).

Cada `MembershipAuditEvent` passa a registrar também `fromVersion`/`toVersion` explícitos (campo
novo, mesmo padrão de `changes` já usado por `ROLE_CHANGED`), não só os papéis.

## 3. Correção do achado C — critério de `TenantLifecycleRecord` reformulado

Critério 7 do checklist original ("Nunca toca `TenantLifecycleRecord`") reescrito para:

> **Não introduz `TenantLifecycleRecord` como mecanismo de transferência ou de representação de
> billing** — a operação não escreve nele em nenhuma circunstância. A leitura que já acontece via
> `resolveWorkingOrganization`/`resolve-request-context.ts` para validar que o tenant está ACTIVE
> continua acontecendo normalmente, ANTES desta operação ser autorizada — não é o algoritmo de
> `TransferOwnershipService` que a invoca de novo, é a resolução de contexto padrão que já roda
> para toda requisição autenticada deste sistema.

Sem nova condição transacional de lifecycle: a operação herda a mesma garantia que qualquer outra
rota autenticada já tem (não é possível chegar ao serviço com um tenant não-ACTIVE, porque a
resolução de contexto já barra isso antes). Não há caso de borda novo aqui além do que já existe
para toda rota do módulo `organization`.

## 4. Correção do achado E — elegibilidade do sucessor inclui identidade global

Passo 5 do algoritmo original ("target deve existir, status ACTIVE") passa a exigir também:

```
targetUser = globalUsers.get(globalUserKey(targetUserId))
if (!targetUser || targetUser.identityStatus !== "ACTIVE") → OwnershipTransferTargetIneligibleError
  (nova classe de erro, distinta de NotFoundError — o alvo EXISTE e é membro, só não está apto a
  exercer o papel agora; mensagem orienta reativar a identidade primeiro, não "tente de novo")
```

Espelha exatamente a mesma dupla checagem que `resolve-request-context.ts:87` já faz para
qualquer sessão autenticada (`GlobalUser.identityStatus === ACTIVE`) — a operação não inventa uma
nova noção de elegibilidade, só verifica ANTES de transferir o que o sistema já verificaria quando
o sucessor tentasse de fato usar o papel.

## 5. Correção do achado F — contrato de erro e resposta incerta explícitos

| Cenário | Erro | Categoria/status |
|---|---|---|
| Chamador não é OWNER da organização | `AuthorizationDeniedError` (authorize() interno) | AUTHORIZATION/403 |
| `targetUserId === ctx.principal.userId` | `SelfOwnershipTransferError` (nova classe) | VALIDATION/400 |
| Alvo sem Membership, ou Membership não-ACTIVE | `NotFoundError` (reaproveitado — mesmo comportamento de `ChangeMembershipRoleService`, "não deixar o status HTTP distinguir existe-mas-oculto de não-existe", já documentado em `app-error.ts:129`) | NOT_FOUND/404 |
| Alvo já é OWNER ACTIVE | `OwnershipTransferTargetAlreadyOwnerError` (nova classe) | BUSINESS_RULE/422 |
| Alvo é Membership ACTIVE mas `GlobalUser.identityStatus !== ACTIVE` | `OwnershipTransferTargetIneligibleError` (nova classe, achado E) | BUSINESS_RULE/422 |
| `caller.version !== expectedCallerVersion` OU `target.version !== expectedTargetVersion` (checagem pré-transação, achado B) | `ConflictError` (reaproveitado) | CONFLICT/409 |
| Transação cancelada, índice 0 (caller) com `ConditionalCheckFailed` | `ConflictError` — "seu papel mudou ou sua versão está desatualizada, recarregue" | CONFLICT/409 |
| Transação cancelada, índice 1 (target) com `ConditionalCheckFailed` | `ConflictError` — "o alvo deixou de ser elegível ou mudou de versão, recarregue e tente de novo" | CONFLICT/409 |
| Transação cancelada, qualquer índice sem `ConditionalCheckFailed` (ex. `TransactionConflict`, throttling) | erro genérico de retry (`DEPENDENCY_UNAVAILABLE`/503, mesmo padrão de outros serviços transacionais deste módulo) — nunca interpretado como conflito de negócio | DEPENDENCY_UNAVAILABLE/503 |

**Resposta incerta (crash/timeout entre a transação e a resposta ao cliente)**: a operação não é
idempotente por design (não tem token de idempotência dedicado, mesmo padrão de
`ChangeMembershipRoleService`/`RemoveMembershipService` hoje — nenhum serviço deste módulo tem).
Reconciliação: se o cliente reenviar a mesma chamada, o chamador (agora ADMIN, se a primeira
tentativa teve sucesso) falha em `authorize()` com 403 — isso É o sinal de sucesso da primeira
tentativa (distinto de um 409 de conflito de versão, que sinaliza que outra coisa mudou, não
necessariamente esta operação). O cliente (frontend) deve, ao receber 403 nesta rota
especificamente após havê-la chamado, re-buscar a lista de membros antes de reportar erro ao
usuário — comportamento de UI, não deste documento de backend, mas registrado aqui para não ser
esquecido na fatia de implementação de frontend.

Plano de validação (testes) ampliado conforme sugerido: corrida entre duas transferências
concorrentes, corrida entre transferência e `changeRole`/`removeMembership` no mesmo alvo,
adulteração de versão (cliente manda `expectedTargetVersion` desatualizado de propósito), cada
classe de erro de auditoria isoladamente, tentativa cross-tenant, e o cenário de resposta incerta
acima (segunda chamada idêntica após sucesso da primeira).

## 6. Step-up authentication — adiamento formalizado

Mantida a inclinação pela opção 2 (aceitar risco residual nesta fase), agora com gatilho e
responsável explícitos, conforme pedido pelo Codex:

> **Item de hardening registrado, não implementado nesta fatia**: adicionar step-up
> (reautenticação ou confirmação equivalente) antes de QUALQUER ação hoje gated `OWNER_ROLES` que
> mude a titularidade/controle de uma organização (`membership:transfer-ownership` +
> `organization:close`, que já tem a mesma lacuna hoje, achado não introduzido por esta proposta).
> **Gatilho de reavaliação**: antes do primeiro usuário real com titularidade real em jogo (fim da
> fase "sem usuário real" do `AGENTS.md` §1), OU se qualquer outra ação deste sistema ganhar
> step-up primeiro (para não ficar como exceção isolada). **Responsável**: Marcelo decide o desenho
> exato quando o gatilho disparar (mecanismo de reautenticação ainda não existe neste projeto,
> nenhum precedente interno a seguir). Este documento não cria o mecanismo agora nem finge que ele
> existe.

## O que não mudou desde a Rodada 1

Serviço dedicado `TransferOwnershipService`, `TransactWriteItems` único (2 Updates de Membership +
2 Puts de auditoria), delta zero em `ownerCount` (sem chamar `buildOwnerCountDeltaEntry`, evitando
a colisão de chave já confirmada pelo Codex como real via a doc da AWS), novo Action
`membership:transfer-ownership` gated `OWNER_ROLES`, novo `MembershipAuditAction =
"OWNERSHIP_TRANSFERRED"` distinto de `ROLE_CHANGED`, fora de escopo (billing/payer, pausa
reversível de tenant, reatribuição por terceiro, UI).

**Garantia reformulada (achado D)**: a transação garante que nenhuma escrita parcial fica visível
(nunca um estado onde só uma das duas Memberships foi atualizada) — não garante que um `GetItem`
concorrente fora da transação veja necessariamente "0 ou 2 OWNERs" de forma consistente entre duas
leituras separadas (um leitor pode ver o cedente já ADMIN e o sucessor ainda não-OWNER se ler entre
essas duas posições relativas, ou o inverso) — essa é uma limitação inerente de qualquer leitura
não-transacional fora do commit, não uma falha desta proposta, e não há necessidade de resolvê-la
aqui porque nenhuma decisão de negócio depende dessa fotografia conjunta continuar consistente
para um observador externo à transação.
