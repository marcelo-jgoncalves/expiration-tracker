# GTR-01 Supersession — Estado Final Consolidado

**Protocolo Claude↔Codex completo, 3 rodadas, nota cega. Claude 9,5/10 (self), Codex 9,8/10
(independente) — ambos ≥9,0 sem arredondar. `APPROVED`.**

## Decisão

`Organization.displayName` **substitui** (REPLACE, não coexiste com) `UserProfile.requesterDisplayName`
como única identidade guest-facing "quem está solicitando este documento". O campo antigo, seus
endpoints HTTP (`GET/PUT /profile`), Lambda dedicada, actions de autorização (`profile:read`/
`profile:update`) e toda a infraestrutura Terraform associada são **removidos por completo** —
não deprecados, não mantidos como override coexistente.

### Justificativa
- `Organization.displayName` é sempre presente na prática (setado obrigatoriamente na criação da
  Organization) — ao contrário de `UserProfile.requesterDisplayName`, que nunca teve UI de
  frontend para ser editado em nenhuma wave, portanto está vazio (fallback genérico) na
  esmagadora maioria dos casos reais.
- Nome de organização é uma identidade de confiança mais estável para um relacionamento externo
  contínuo (document chasing por semanas) do que nome de pessoa individual, que não sobrevive a
  troca/saída de membro.
- Manter override per-user sem demanda de produto real e sem UI planejada é dívida morta, não
  flexibilidade.
- Precedente de mercado (pesquisa `SIM PARCIAL`: DocuSign/PandaDoc/HelloSign, Slack Connect,
  Notion/Linear e-mails transacionais) converge em "nome da conta/organização é a identidade
  primária guest-facing, nome de pessoa é aditivo/opcional, nunca substituto".

### Invariante corrigida como parte desta mudança
`CreateOrganizationService.buildCreateEntries()` passa a fazer `trim()` + rejeitar `displayName`
em branco com `ValidationError` — achado real do Codex (Round 1): a criação de Organization
aceitava whitespace-only sem normalização, o que teria enfraquecido a garantia "sempre
presente/confiável" da nova fonte única. `bff-handlers.ts` também trima antes de chamar o
serviço (defesa em profundidade na fronteira HTTP), mas a autoridade é o serviço.

### Migração de dado existente
`dev` é sintético/resetável (`AGENTS.md` §1) — nenhuma migração de dado necessária. Itens
DynamoDB existentes com o atributo `requesterDisplayName` simplesmente carregam um atributo
morto, não lido por nenhum código após a remoção (DynamoDB é schemaless por item).

### Futuro (deliberadamente fora de escopo agora)
Se um dia houver demanda real de produto por atribuição pessoal ("Ana, da Empresa Alfa" em vez
de só "Empresa Alfa"), a forma correta é um **snapshot imutável no momento da criação do
request** (`DocumentRequest`/`RequirementAssignment`), nunca a ressurreição de um campo
per-user persistente e mutável. Nomeado aqui para não ser redebatido do zero.

## Inventário de remoção (fechamento das 3 rodadas)

Código: `user-repository.ts` (campo+método), `profile-service.ts` (arquivo inteiro),
`profile-handlers.ts` (arquivo inteiro), `profile-handler.ts` (Lambda, arquivo inteiro),
`composition/identity.ts` (wiring), `authorization.ts` (`profile:read`/`profile:update` +
comentários/matriz linhas 57/58/142/165/166), `proxy-allowlist.ts` (2 entradas `/profile`),
`subject.ts`/`dispatch.ts`/`document-request-service.ts` (porta renomeada
`resolveOrganizationDisplayName`, assinatura só `{ tenantId }`), `email-templates.ts` (comentário).

Infra: `infra/main.tf:164` (module call) + dependentes 373-374/861-862/902/921,
`infra/modules/api-gateway/{main.tf,variables.tf}` (rotas `/profile`),
`infra/modules/api-gateway/tests/api_gateway.tftest.hcl`,
`infra/modules/security-audit-observability/tests/security_audit_observability.tftest.hcl`,
`infra/tests/stack.tftest.hcl`, `scripts/build-lambdas.ts:38`.

Testes: deletar `profile-service.test.ts`/`profile-handlers.test.ts`; atualizar
`guest-upload-flow.test.ts`, `document-request-initial-invite.test.ts`,
`document-chasing-dispatch.test.ts:152`, `security-audit-observability-coverage.test.ts:35`,
`resolver.test.ts`; adicionar teste novo em `create-organization.test.ts:22` (trim/blank) e
`bff-handlers.test.ts` (fronteira HTTP).

## Evidência do protocolo

- `round-1-claude-proposal.md`/`round-1-claude-self-grade.md` (9,1 self) / `round-1-codex-critique.txt` (7,8 Codex).
- `round-2-claude-proposal.md`/`round-2-claude-self-grade.md` (9,4 self) / `round-2-codex-critique.txt` (8,8 Codex).
- `round-3-claude-proposal.md`/`round-3-claude-self-grade.md` (9,5 self) / `round-3-codex-critique.txt` (9,8 Codex).

## Status de implementação

Implementado nesta mesma sessão (ver `decisions-log.md` D-129) — escopo tratável diretamente
(migração mecânica limitada, sem infraestrutura nova).
