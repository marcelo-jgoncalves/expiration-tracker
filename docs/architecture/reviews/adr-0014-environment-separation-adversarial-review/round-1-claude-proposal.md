# ADR-0014 — Separação de ambientes — Rodada 1 (proposta Claude)

## Contexto

ADR-0014 (2026-09-20, D-305) decidiu a arquitetura-alvo para separar `dev`/`staging`/`production`
em contas AWS distintas (AWS Organizations), rejeitando `terraform workspace` e separação
só-por-diretório-mesma-conta, com pesquisa externa `SIM PARCIAL` (AWS Well-Architected SEC01-BP01,
doc oficial HashiCorp sobre workspaces). Decidido sem o protocolo Claude↔Codex formal (suspenso na
época), autorizado por Marcelo. Nível 6 (`change-risk-scale.md`) — exige nota cega ≥9,0, mínimo 3
rodadas. Revisão adversarial completa agora que o protocolo voltou.

**Escopo desta revisão**: a decisão arquitetural em si (Fases 1-4 do ADR) e a Fase 1 + emenda D-306
já implementadas (código real). Fases 2-4 (criar contas novas) continuam exigindo autorização
explícita de Marcelo além desta revisão — o protocolo decide se a ARQUITETURA está correta, nunca
autoriza a execução de criação de conta/billing real por si só.

## Decisão revisada

- **Arquitetura-alvo**: AWS Organizations, uma conta por ambiente (`dev` atual + `staging`/
  `production` novas), backend Terraform próprio por conta (nunca `terraform workspace`).
- **Critérios ponderados** (peso 35% isolamento de blast radius, 20% não usar mecanismo
  desaconselhado pelo mantenedor, 20% proporcional ao estágio, 15% não quebra `dev`, 10%
  reversível) — usados para eliminar as 3 alternativas rejeitadas de forma justificada.
- **Rollout faseado**: Fase 1 (aditiva, feita) — `infra/variables.tf` aceita `staging`/
  `production` como valores válidos (nenhum backend/tfvars real aponta para eles ainda). Fase 2
  (criar contas, aguarda autorização de Marcelo) — Fase 3 (provisionar staging) — Fase 4 (criar
  produção, gatilho explícito: E-019+D-052 resolvidos, OU data de lançamento decidida, OU pedido
  direto de Marcelo).
- **Emenda D-306** (mesma sessão): `cd.yml` mudou de disparar em push a `main` para
  `workflow_run` da `CI` completando em `develop` — corrige uma inconsistência de nomenclatura
  (branch de trabalho real é `develop`, `AGENTS.md` §3) encontrada ao escrever este ADR, não
  depende de conta nova.

## Verificação real desta rodada — Fase 1 + D-306 funcionando ao vivo

Confirmado via `infra/variables.tf` (bloco `validation` aceita `["dev", "staging", "production"]`,
comentário cita ADR-0014 explicitamente) e `.github/workflows/cd.yml` (trigger `workflow_run` em
`CI`/`branches: [develop]`, comentário documenta o incidente real de 2026-08-21 que motivou a
mudança — dois workflows disputando o mesmo lock do Terraform).

**Evidência ao vivo, não só leitura de código** (`gh run list --workflow="Deploy (CD)"`,
2026-09-22 a 2026-09-24, 8 runs mais recentes): CD dispara consistentemente via `workflow_run`
após CI completar em `develop`, incluindo o comportamento correto do guard `if` quando CI falha —
run `35942732354` foi `skipped` porque o CI correspondente (`35942489974`, corrigido nesta mesma
sessão de protocolo) tinha falhado; run em andamento no momento desta escrita (`35947667154`,
disparado pelo commit D-330 desta sessão) confirma o mecanismo continua ativo. Isto é exatamente a
validação que a "Pendência explícita" do próprio ADR pedia ("a validação real só acontece no
próximo push a develop depois do merge, não presumir 'funciona' antes de observar isso ao vivo") —
agora observada, com múltiplos dias de evidência real, não uma suposição.

## Achado real desta rodada, trazido proativamente (não escondido)

**A Fase 2 apresenta uma ambiguidade que, resolvida da forma errada, contradiz a própria
justificativa do ADR.** O texto da Fase 2 apresenta como opções equivalentes: *"transforma a conta
atual em management account OU cria uma nova management account e migra `975707451904` para dentro
dela como membro `dev`"*. Pesquisa externa feita nesta rodada (AGENTS.md §4): a documentação
oficial da AWS Organizations (`docs.aws.amazon.com/organizations/.../orgs_getting-started_concepts.html`,
seção "Delegated administrator") diz literalmente: **"We recommend that you store your AWS
resources in other member accounts in the organization and keep them out of the management
account. This is because security features like Organizations service control policies (SCPs) do
not restrict any users or roles in the management account."**

Isso significa que a PRIMEIRA opção apresentada (transformar `975707451904` — que JÁ hospeda toda a
carga real de `dev` — na management account) contradiz diretamente a própria fonte que o ADR já usa
(SEC01-BP01) para justificar a decisão inteira: SCPs nunca restringem a management account, então
`dev` ficaria estruturalmente FORA do alcance do mecanismo de enforcement (SCPs) que é o real
diferencial de "separação por conta" sobre as alternativas rejeitadas — exatamente o critério de
peso 35% ("isolamento real de blast radius") que a Fase 2, se resolvida errado, deixaria de cumprir
para o ambiente que mais precisa dele hoje (o único com carga de trabalho real).

**Recomendação**: a ÚNICA opção compatível com a própria pesquisa já citada é criar uma management
account NOVA, vazia, e migrar `975707451904` para dentro da Organization como conta-membro `dev`
— nunca o inverso. Proponho que o ADR seja emendado para resolver esta ambiguidade AGORA (decisão
de arquitetura, parte do escopo desta revisão), não deixada para quando a Fase 2 for autorizada.

## Auto-nota cega (Claude, antes de ver a crítica do Codex)

Ver `round-1-claude-selfgrade.md` (arquivo separado).
