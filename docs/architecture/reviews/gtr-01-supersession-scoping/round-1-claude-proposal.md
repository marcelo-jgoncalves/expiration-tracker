# GTR-01 Supersession Scoping — Round 1 (Claude Proposal)

## Contexto

GTR-01 (D-060/W5-01): a identidade "quem está solicitando este documento" mostrada a um
submitter externo (guest) vem de `UserProfile.requesterDisplayName` — campo opcional,
editável via `PUT /profile`, sem UI de frontend nunca implementada para editá-lo (verificado:
`frontend/src` não tem nenhuma referência a `requesterDisplayName` nem a `/profile`). Fallback
genérico "Solicitante não identificado" quando ausente.

Desde Wave B2B-10/D-106, `Organization.displayName` existe como campo real, obrigatório-de-fato
(setado na criação da Organization, `CreateOrganizationService`) e atualizável via
`UpdateOrganizationSettingsService` (`OWNER_ROLES`).

Call sites reais confirmados (grep exaustivo em `src/`):
- `src/modules/identity/persistence/user-repository.ts` — campo `UserProfile.requesterDisplayName`, método `setRequesterDisplayName`.
- `src/modules/identity/application/profile-service.ts` — `ProfileService.setRequesterDisplayName`/`readOwnProfile`.
- `src/modules/identity/http/profile-handlers.ts` — `GET/PUT /profile`.
- `src/modules/identity/domain/authorization.ts` — action `profile:update`.
- `src/modules/subject/application/guest-submission-service.ts` — interpola no `GuestRequestInfo.requesterDisplayName` exposto ao guest.
- `src/modules/subject/application/document-request-service.ts` — resolve nome do próprio caller para o e-mail de convite inicial.
- `src/runtime/aws/composition/subject.ts` — `resolveRequesterDisplayName()`, leitura pontual do `UserProfile`.
- `src/workers/document-chasing-dispatch/dispatch.ts` — `resolveRequesterDisplayName` injetado, usado nos tiers T7/T3 do chasing.
- `src/modules/notification/providers/email-templates.ts` — interpola `requesterName` no template guest-facing.

Nenhum call site em `frontend/` — a feature é 100% backend, nunca exposta em UI real.

## Declaração de pesquisa externa (`research-protocol.md`)

**`SIM PARCIAL`**. "Quem aparece como remetente para um terceiro externo, num produto B2B
multi-usuário" tem precedente real parcial:
- DocuSign/PandaDoc/HelloSign: e-mail de assinatura mostra "[Nome da pessoa] via [Nome da
  empresa]" ou só "[Nome da empresa]" dependendo de configuração de conta — o nome da conta
  (organização) é sempre a identidade de confiança primária; o nome da pessoa é aditivo, nunca
  substituto quando ausente.
- Slack Connect / e-mails transacionais de ferramentas B2B (Notion, Linear): remetente
  externo-facing é predominantemente a marca do workspace/conta, não o usuário individual —
  reduz superfície de phishing (usuário individual pode sair da organização; marca da conta é
  estável).
- Não é um padrão universalmente "resolvido" como RBAC/invite (não há um único padrão
  dominante — DocuSign permite as duas variantes por configuração de conta), mas a direção
  "org-name é a identidade primária/mais confiável, nome de pessoa é aditivo/opcional" converge
  nas referências acima.

Checklist derivado (régua desta rodada):
1. Identidade primária guest-facing deve ser **sempre presente/confiável** — nunca um fallback
   genérico visível na maioria dos casos reais.
2. Preferir superfície de confiança **estável através de mudança de membership** (org sobrevive
   à saída de um membro individual; pessoa não).
3. Não introduzir um segundo campo config configurável que nunca teve UI e nunca foi
   genuinamente adotado (risco de dívida morta, não risco de produto).
4. Migração de dado existente em `dev` deve ser honesta sobre volume real antes de decidir
   descartar.

## Decisão proposta

**REPLACE, não coexistir.** `Organization.displayName` passa a ser a única fonte de "quem está
solicitando" nos guest-facing touchpoints (e-mails de guest submission, e-mails de chasing
T7/T3, convite inicial). `UserProfile.requesterDisplayName` é **removido** (campo, endpoints
`GET/PUT /profile`, action `profile:update`, resolver dedicado) — não apenas deprecado.

Justificativa:
- **Critério 1 (sempre presente)**: `Organization.displayName` é setado obrigatoriamente na
  criação da Organization (`CreateOrganizationService`) — nunca ausente na prática, ao
  contrário de `UserProfile.requesterDisplayName` que, sem UI de frontend nunca implementada
  para editá-lo, quase certamente está vazio em 100% dos casos reais hoje (fallback genérico é
  o comportamento observado de fato, não hipotético).
- **Critério 2 (estabilidade)**: organização sobrevive a troca/saída de membro; nome de pessoa
  individual não é uma identidade estável para um relacionamento de confiança externo contínuo
  (ex. document chasing que persiste por semanas, span de vários lembretes).
- **Critério 3 (dívida morta)**: manter o campo per-user como override "coexistente" adiciona
  uma segunda fonte de verdade e um endpoint HTTP que nunca teve consumidor de frontend em
  nenhuma wave — não há evidência de demanda real por override per-request, e não há UI
  planejada para isso em nenhum documento de frontend.
- Não há impacto de frontend a corrigir (nenhuma tela consome o campo hoje).

## Migração de dado existente

`dev` é sintético/resetável (`AGENTS.md` §1). Verificação de baixo custo antes de remover:
`aws dynamodb scan --profile claude-dev` filtrado por `SK=PROFILE` e `requesterDisplayName`
presente, só para registrar honestamente se algum valor real foi setado (não bloqueia a
decisão de design, informa só o texto da migração). Ação: nenhuma migração de dado é
necessária — o campo é apenas removido do schema de leitura/escrita; itens existentes no
DynamoDB simplesmente carregam um atributo morto (sem TTL/cleanup dedicado, mesmo padrão já
aceito em outras remoções deste projeto — atributo extra em item não usado não é erro de
schema, DynamoDB é schemaless por item).

## Plano de implementação (se aprovado)

1. `subject.ts` (composition): `resolveRequesterDisplayName()` passa a ler `Organization.displayName` (já tem `tenantId`/`organizationId` disponível no mesmo escopo) em vez de `UserProfile`.
2. `guest-submission-service.ts`: `resolvedRequesterName` vem do injected resolver (assinatura já abstrai a fonte — nenhuma mudança de contrato do serviço, só do resolver).
3. `document-request-service.ts`: idem para o e-mail de convite inicial.
4. `dispatch.ts` (worker): idem — `resolveRequesterDisplayName` já é uma porta injetada, muda só o composition root.
5. Remover: `profile-handlers.ts` (rotas `GET/PUT /profile`), `profile-service.ts`, `setRequesterDisplayName`/campo em `user-repository.ts`, action `profile:update` em `authorization.ts`, rota no API Gateway (Terraform, se existir rota dedicada — verificar `infra/`).
6. Atualizar `docs/frontend/README.md` (GTR-01 já citado lá) e `docs/architecture/decisions-log.md`.

## Nota de escopo

Nível 5-6 (`change-risk-scale.md`): decisão de UX/trust guest-facing + remoção de superfície
HTTP pública existente. Protocolo completo aplicável, autoridade ampliada
(`ai-governance.md` §1) cobre o resíduo de produto (replace vs. coexist).
