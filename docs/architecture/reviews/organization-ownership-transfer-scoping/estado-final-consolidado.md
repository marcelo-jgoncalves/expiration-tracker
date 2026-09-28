---
status: CONVERGIDO — desenho aprovado via protocolo Claude↔Codex, implementação ainda NÃO iniciada
owner: Marcelo
---

# Transferência de titularidade (OWNER) de organização — convergência final

**Pedido original (2026-09-28)**: "agora eu quero que você comece a avaliar a questão de
transferir a ownership de uma organization e submeta isso ao protocolo."

**Resultado**: 5 rodadas do protocolo Claude↔Codex (AGENTS.md §4), nível 5
(`change-risk-scale.md`). Convergência em **Claude 9,2/10, Codex 9,2/10 geral (9,3 régua)** —
ambos ≥9,0, sem arredondamento, mínimo de 3 rodadas superado.

## Progressão de nota

| Rodada | Claude (autor) | Codex (crítico) | Achados principais fechados |
|---|---:|---:|---|
| 1 | 7,5 | 8,2 desenho / 7,0 régua | Pesquisa externa atribuída incorretamente a consenso; auditoria sem versão vinculada; critério de `TenantLifecycleRecord` proibia leitura normal; elegibilidade do sucessor não verificava `GlobalUser.identityStatus`; contrato de erro incompleto |
| 2 | 8,3 | 8,7 desenho / 7,8 régua | Matriz de pesquisa reconciliada; contrato de cancelamento por índice; "403 = sucesso" corrigido |
| 3 | 8,6 | 8,7 / 8,5 | Pesos somando 100%; regressão do Slack corrigida; classificador com 4 índices |
| 4 | 8,7 | 8,8 / 8,9 | Separação `isTransactionCanceled`/razões; precedência por categoria de falha; reconciliação sem prova de causalidade |
| 5 | **9,2** | **9,2 / 9,3** | Alegação de auditoria restrita aos 3 serviços verificados; códigos reais de `CancellationReasons[].Code`; garantia de leitura delimitada a observações independentes |

## Desenho final aprovado

- **Serviço dedicado** `TransferOwnershipService`, novo arquivo
  `src/modules/organization/application/transfer-ownership.ts`.
- **Transação única de 4 entradas** (`TransactWriteItems`): Update Membership do chamador
  (OWNER→ADMIN), Update Membership do alvo (X→OWNER), Put `MembershipAuditEvent` do chamador, Put
  `MembershipAuditEvent` do alvo — mesmo `correlationId` nos dois eventos.
- **`Organization.ownerCount` não é tocado** — delta líquido zero numa troca pura; evita a colisão
  de chave que `buildOwnerCountDeltaEntry` chamado duas vezes na mesma transação produziria
  (confirmado contra a documentação da AWS).
- **Novo Action** `membership:transfer-ownership`, gated `OWNER_ROLES` — mesmo tier de
  `organization:close`/`organization:cancel-close`.
- **Novo `MembershipAuditAction = "OWNERSHIP_TRANSFERRED"`**, distinto de `ROLE_CHANGED`, com
  `previousVersion`/`newVersion` reaproveitados do campo já existente em `audit-event.ts`.
- **Elegibilidade do alvo**: Membership ACTIVE (nunca convite pendente) + `GlobalUser.identityStatus
  === "ACTIVE"` — nova classe de erro `OwnershipTransferTargetIneligibleError` quando a identidade
  global não está ativa.
- **Checagem de versão pré-transação**: `caller.version === expectedCallerVersion` e
  `target.version === expectedTargetVersion` verificados antes de montar a transação, para que o
  `fromRole`/`toRole` gravado na auditoria corresponda exatamente ao estado lido.
- **Classificador de cancelamento por categoria** (`classifyTransferCancellation`): permanente
  (`ValidationError`, `ItemCollectionSizeLimitExceeded`) sempre domina; razão desconhecida detectada
  antes de qualquer ramo de conflito por índice; conflito por índice (0=chamador, 1=alvo,
  2/3=auditoria); transitório (`TransactionConflict`, `ThrottlingError`,
  `ProvisionedThroughputExceeded`) por último.
- **Reconciliação de resposta incerta**: duas leituras `GetItem`/`ConsistentRead: true`
  independentes (nunca a `Query` eventualmente consistente de `ListMembersService` — requisito de
  implementação novo), declaradamente sem prova de simultaneidade ou causalidade histórica; retry
  preserva as versões originais; resultado inconclusivo explícito quando a leitura falha ou o
  chamador perde acesso.
- **Step-up authentication**: adiamento formalizado, não implementado nesta fatia. Gatilho de
  reavaliação: antes do primeiro usuário real com titularidade em jogo, ou quando qualquer outra
  ação `OWNER_ROLES` de alta irreversibilidade (incluindo `organization:close`, que tem a mesma
  lacuna hoje) ganhar step-up primeiro. Responsável: Marcelo, quando o gatilho disparar.
- **Fora de escopo, explícito**: transferência de responsabilidade de billing/pagador; estado de
  organização pausada reversível (`TenantLifecycleRecord` não é tocado nem reaproveitado);
  reatribuição de OWNER de um terceiro sem o próprio OWNER iniciar; UI/frontend.

## Pesquisa externa (research-protocol.md, E-014)

**SIM PARCIAL** — GitHub, Slack, Google Workspace, Notion (fluxo de transferência, exigência de
sucessor já-membro-ativo, postura de reautenticação) + OWASP (norma de step-up). Distinção honesta
final entre confirmação direta (3-4 fontes conforme o critério) e decisão interna do OmniVence (ex.
antigo OWNER vira ADMIN em vez de removido — nenhuma das 4 fontes confirma esse padrão
especificamente).

## Não certificado por esta convergência

Implementação real, testes, deploy — o protocolo aprovou o **desenho**, não código. Antes de
implementar: seguir a mesma ordem já usada no digest de WhatsApp (D-347) — implementar, testar,
rodar a suíte completa, e só então considerar o item fechado (`docs/engineering/definition-of-done.md`).
`npm run check-docs` não pôde ser executado durante a Rodada 5 por erro de ambiente do lado do
Codex (`ENOMEM`/`EPERM`) — não se declara esse gate verde a partir desta convergência; deve ser
rodado normalmente na sessão que implementar.
