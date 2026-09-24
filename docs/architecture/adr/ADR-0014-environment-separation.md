# ADR-0014 — Separação real de ambientes (`main` deixa de ser sinônimo de `dev`)

**Status**: revisão adversarial Claude↔Codex EM ANDAMENTO (D-331, 2026-09-24 — protocolo retomado, ver rodadas em `docs/architecture/reviews/adr-0014-environment-separation-adversarial-review/`) | **Data original**: 2026-09-20 | **Type**: Type 1 (nível 6, `change-risk-scale.md` — novo domínio de risco: fronteira de conta AWS) | **Decisor original**: Claude (protocolo suspenso na época), Fases 2-4 aguardam autorização explícita de Marcelo além desta revisão

Pedido de Marcelo, 2026-09-20 (item 2 da ordem desta sessão): corrigir `docs/project/roadmap-competitivo-2026-09-01.md` §17.3 — hoje `main` é literalmente o único ambiente (`dev`), sem staging nem produção.

## Pesquisa externa considerada

**SIM PARCIAL** — fontes:

1. AWS Well-Architected Framework, [SEC01-BP01 "Separate workloads using accounts"](https://docs.aws.amazon.com/wellarchitected/latest/framework/sec_securely_operate_multi_accounts.html), consultado 2026-09-20. Citação direta: *"Account-level separation is strongly recommended, as it provides a strong isolation boundary for security, billing, and access."* e *"Level of risk exposed if this best practice is not established: **High**"*.
2. HashiCorp, documentação oficial de [Terraform CLI Workspaces](https://developer.hashicorp.com/terraform/language/state/workspaces), consultado 2026-09-20. Citação direta: *"Workspaces are not appropriate for system decomposition or deployments requiring separate credentials and access controls."*

**Representatividade**: fonte 1 é a norma primária da própria AWS para esta exata pergunta (não existe RFC vendor-neutro para "como separar ambientes de nuvem" — é uma questão inerentemente específica de plataforma, então a documentação oficial do próprio provedor É a fonte de maior autoridade disponível, não uma limitação a registrar). Fonte 2 é a documentação oficial do mantenedor da própria ferramenta (HashiCorp) sobre seu próprio mecanismo, mesmo padrão de autoridade.

**Escopo do PARCIAL**: a pesquisa decide (a) que separação por CONTA é o padrão estabelecido, superior a separação só por workspace Terraform dentro da mesma conta, e (b) que o mecanismo `terraform workspace` é explicitamente desaconselhado pelo próprio mantenedor para esse fim. A pesquisa **não** decide: (c) o *timing* de quando provisionar cada conta nova dado o estágio real deste projeto (zero usuário real, sem data de lançamento, `AGENTS.md` §1 — decisão de proporcionalidade interna, `principles.md` #1) nem (d) o desenho exato do pipeline de promoção `dev→staging→produção` sobre a infra Terraform já existente deste projeto (decisão interna, depende só de como este repo já modela `cd.yml`/`environment`).

## Checklist de critérios (sub-rubrica desta decisão, subordinada aos eixos de `joint-review-criteria.md` já aplicáveis — Arquitetura, Operações/SRE, Segurança)

1. (peso 35%) **Isolamento real de blast radius** — a separação escolhida impede que uma ação errada (delete, IAM excessivo, bug de `terraform apply`) em `dev` alcance `staging`/`produção`. Só separação por CONTA atende plenamente (fonte 1); separação só por Terraform-directory/backend dentro da mesma conta atende parcialmente (states diferentes, mas mesmas credenciais/IAM/limite de conta); `terraform workspace` não atende (fonte 2).
2. (peso 20%) **Sem mecanismo desaconselhado pelo próprio mantenedor da ferramenta** — nunca usar `terraform workspace` para isto (fonte 2, gate binário: atende/não atende).
3. (peso 20%) **Proporcional ao estágio real do projeto** — não provisionar infraestrutura para um ambiente sem gatilho de uso real concreto (`principles.md` #1); a estrutura em si (contas + OUs) pode/deve ser decidida cedo (`principles.md` #2 — fronteira de conta é cara de mudar depois), mas o PROVISIONAMENTO de cada conta específica escala com necessidade real.
4. (peso 15%) **Não quebra o pipeline `dev` já funcionando** — `cd.yml` é hoje o único caminho de deploy real deste projeto; qualquer mudança não pode deixar `dev` sem deploy funcionando durante a transição.
5. (peso 10%) **Reversível/incremental** — cada fase é útil e segura mesmo que a fase seguinte nunca aconteça (não é um "big bang" que deixa o projeto pior se parar no meio).

## Options Considered

**Estado em 2026-09-20** (registro histórico da decisão original — as opções abaixo refletem o que
era conhecido/avaliado naquela data; a opção 5 foi adicionada na revisão adversarial de 2026-09-24).

1. **AWS Organizations + uma conta por ambiente (`dev` atual + `staging` nova agora + `production` nova só perto do lançamento real), Terraform com backend/diretório próprio por ambiente, nunca `terraform workspace`** (escolhida) — atende plenamente o critério 1 (peso 35%) e 2 (peso 20%); Control Tower (opção 5) também atenderia ambos, mas foi rejeitado por desproporção ao estágio (critério 3), não por não atender isolamento.
2. **Separação só por Terraform directory/backend dentro da MESMA conta AWS** (ex. `infra/environments/{dev,staging}/`, mesmo `975707451904`) — rejeitada como solução final (viola o critério 1: mesma conta = mesmo limite de IAM/blast radius, exatamente o "Level of risk: High" que a fonte 1 nomeia), mas é um passo intermediário legítimo se o custo/tempo de criar contas novas for proibitivo — não é o caso aqui (contas AWS são gratuitas para criar, só cobram pelo uso real).
3. **`terraform workspace` (mecanismo nativo do CLI)** — rejeitada explicitamente pela própria documentação do mantenedor (fonte 2, critério 2).
4. **Não fazer nada agora, manter só `dev`** — rejeitada por instrução direta de Marcelo (item 2 desta sessão), que já decidiu que isto deve ser corrigido agora, não adiado de novo.
5. **AWS Control Tower** (avaliada na revisão adversarial, D-331) — orquestra Organizations +
   Service Catalog + IAM Identity Center, automatizando provisionamento de conta (Account Factory)
   e aplicação de guardrails a escala. Documentação oficial: *"If you are hosting more than a
   handful of accounts, it's beneficial to have an orchestration layer..."* — este projeto terá 2-3
   contas de carga de trabalho (`dev`/`staging`/`production`), 3-4 no total incluindo a management
   account — "handful" da própria documentação, abaixo do limiar onde a automação de Control Tower
   paga seu próprio overhead
   operacional (mais um serviço para entender/manter — julgamento deste projeto, a documentação da
   AWS não define um limiar econômico explícito). Rejeitada por desproporção ao estágio (critério
   3, peso 20%), não por incompatibilidade — Control Tower pode se registrar sobre uma Organization
   já existente se o número de contas crescer o suficiente para justificar a automação, preservando
   a escolha de conta-por-ambiente já feita aqui, embora com adequações reais de inscrição/
   governança no momento da adoção (não é uma migração "grátis").

## Evidence

**Estado em 2026-09-20** (registro histórico do ponto de partida — `infra/variables.tf` e
`.github/workflows/cd.yml` já mudaram desde então, ver Fase 1/Emenda 1 abaixo): `docs/project/
roadmap-competitivo-2026-09-01.md` §17.3 (registro do gap, 2026-09-19); `infra/variables.tf`
(`variable "environment"` travava `validation { condition = var.environment == "dev" }` —
literalmente impossível declarar outro ambiente sem mudar este arquivo); `infra/
backend.hcl.example`/`infra/env/dev.tfvars` (um único backend S3, uma única tfvars, confirma zero
separação naquele momento); `.github/workflows/cd.yml` (deploy disparava em qualquer sucesso de CI
em `main`, sem gate de ambiente); `aws organizations describe-organization --profile claude-dev` →
`AWSOrganizationsNotInUseException` (confirmado ao vivo, 2026-09-20: esta conta não pertencia a
nenhuma Organization — ponto de partida real, não hipotético; ainda não reverificado desde então).

## Reliability Impact

Risco de NÃO fazer isto: qualquer erro de `terraform apply`/dado sintético/IAM excessivo em "dev" hoje já é o pior caso possível, porque não há um ambiente de validação intermediário antes de expor o mesmo código a um usuário real — o primeiro "staging real" seria, na prática, o primeiro cliente. Risco de fazer isto incorretamente: uma conta AWS nova mal configurada (sem MFA na root, sem billing alerts) é uma superfície de ataque nova — a Fase 2 (abaixo) deve herdar os mesmos guardrails de segurança que a conta `dev` já tem (least-privilege IAM, OIDC sem credencial de longa duração), nunca uma conta "mais fraca" só por ser nova.

## Trade-offs

- **A favor**: fecha a lacuna nomeada há um dia (§17.3) com o padrão que a própria AWS chama de "Level of risk: High" se não seguido; a estrutura de conta é uma decisão cara-de-mudar (`principles.md` #2) — fazer isso agora, com pouco dado sintético em `dev`, é o momento mais barato possível (esperar até ter usuário real tornaria a migração muito mais arriscada).
- **Contra**: cria overhead real de gestão (mais uma conta para monitorar, MFA, billing) antes de haver usuário real; a conta de `produção` ficaria vazia por potencialmente meses (E-019/D-052 ainda bloqueiam lançamento real) — mitigado pela decisão de só criar `production` perto do gatilho real (ver Rollout).

## Final Decision

**Arquitetura-alvo**: AWS Organizations com uma management account nova e vazia (nunca a conta
`975707451904` atual — ver Emenda 2 abaixo) + OU `Workloads` contendo contas-membro `dev` (a conta
`975707451904` já existente migra para dentro, sem migração de dados — vira a conta-membro `dev`
da Organization) e `staging` (nova); OU `Production` reservada, conta criada só no gatilho abaixo.
Terraform ganha `infra/env/{dev,staging,production}.tfvars` (cada um com seu próprio
`aws_account_id`) e cada ambiente usa seu próprio backend S3 (bucket por conta, nunca
compartilhado) — nunca `terraform workspace`. Pipeline de promoção: `cd.yml` continua
auto-deployando `dev` a cada CI verde em `develop` (D-306, emenda desta mesma sessão — ver abaixo;
NUNCA mais automaticamente por `main` até staging/produção existirem de fato — `workflow_dispatch`
manual continua disponível em `main` como fallback, só o gatilho automático mudou); uma
nova `cd-staging.yml` promove o MESMO artefato já testado (não rebuilda) via `workflow_dispatch`
manual; `cd-production.yml` só é criado quando a conta de produção existir. Contrato de "promover o
mesmo artefato" (empacotamento imutável, digest, retenção, leitura cross-account) ainda não está
definido — achado da revisão adversarial (Emenda 3 abaixo), necessário antes da Fase 3.

**Rollout faseado** (nenhuma fase deixa o projeto pior se a próxima nunca acontecer, critério 5):

- **Fase 1 — feita nesta sessão** (nível 3-4, sem custo/ação irreversível): `infra/variables.tf` passa a aceitar `"dev"`/`"staging"`/`"production"` como valores válidos de `environment` (hoje só `"dev"`), preparando o contrato sem alterar nenhum comportamento de `dev` (nenhum `.tfvars`/backend novo aponta para esses valores ainda — puramente aditivo). Este ADR + entrada em `decisions-log.md` + atualização de `roadmap-competitivo-2026-09-01.md` §17.3.
- **Fase 2 — precisa de autorização explícita de Marcelo antes de executar**: criar uma AWS
  Organization **NOVA e VAZIA** (nunca transformando `975707451904` na management account — ver
  Emenda 2 abaixo, achado da revisão adversarial D-331) e migrar `975707451904` para
  dentro dela como conta-membro `dev`, mais a conta `staging` nova. **Por quê pausar aqui, apesar
  da autonomia de infra já concedida (`AGENTS.md` §7/`ai-governance.md` §1)**: criar uma conta AWS
  real é uma ação de escopo diferente de editar Terraform dentro da conta já existente — precisa de
  um e-mail dedicado (mesmo padrão já usado para tenants sintéticos, ex.
  `marcelo.mjgoncalves+aws-staging@gmail.com`), fica ligada ao billing real de Marcelo, e não é uma
  ação dentro do "fluxo padrão PR→CI(plan)→CD(apply em `dev`, via `develop`, D-306)" que a
  autonomia de infra já cobre — é
  criação de uma fronteira de identidade nova, não edição de um recurso dentro de uma fronteira já
  aprovada.
- **Fase 3 — depois da Fase 2**: provisionar `staging` via Terraform (mesmos módulos de `dev`, backend/tfvars próprios), configurar OIDC/trust role na conta nova, criar `cd-staging.yml`.
- **Fase 4 — gatilho explícito de REAVALIAÇÃO (`principles.md` #5), não "quando fizer sentido" vago, e nunca criação automática**: quando UMA das condições valer — (a) E-019 (aviso de privacidade/DPA Meta) resolvido E D-052 (billing) desbloqueado, ou (b) Marcelo decidir uma data de lançamento antes disso, ou (c) Marcelo pedir explicitamente antes de qualquer uma das anteriores — isso abre uma REAVALIAÇÃO da prontidão real (nunca autoriza, por si só, criar a conta `production`), seguida de autorização explícita de Marcelo e dos gates de implantação concretos que a Emenda 3 exige (achado da revisão adversarial).

## Emenda (2026-09-20, mesma sessão) — Marcelo redirecionou o próximo passo imediato

Depois deste ADR escrito, Marcelo decidiu explicitamente **não** criar contas AWS novas ainda
("não vamos usar outras contas ainda") e pediu, em vez disso, corrigir primeiro a inconsistência
mais imediata dentro da ÚNICA conta atual: `cd.yml` disparava deploy de `dev` em push/CI verde em
`main`, quando `develop` é o branch de trabalho real (`AGENTS.md` §3) — o nome do branch que
dispara não correspondia ao papel real de nenhum dos dois branches. Isto não invalida a
arquitetura-alvo deste ADR (conta por ambiente continua sendo o padrão recomendado pela pesquisa,
Fases 2-4 abaixo inalteradas) — é uma correção de escopo menor, mais barata, que resolve a
confusão de nomenclatura agora, sem depender de conta nova nenhuma.

**Decisão da emenda** (registrada como D-306 em `decisions-log.md`, nível 3-4 — mudança mecânica de
configuração de CI/CD, sem novo domínio de risco): `cd.yml` passa a disparar em
`workflow_run` do `CI` completando em `develop` (não mais `main`); `main` fica sem gatilho
AUTOMÁTICO de deploy até staging/produção existirem de fato (`workflow_dispatch` manual continua
disponível em `main` como fallback, ver Final Decision acima). Achado real verificado via
documentação oficial do
GitHub antes de implementar (`AGENTS.md` §4): `workflow_run` sempre executa a versão do arquivo de
workflow que está no branch PADRÃO do repositório (`main`, confirmado via
`gh repo view --json defaultBranchRef`), nunca a do branch que disparou o CI — o filtro
`branches:` só decide QUANDO disparar, nunca qual versão do arquivo roda. Implicação prática: esta
mudança só passa a valer de fato depois que este PR for mergeado em `main` (que atualiza a cópia
que o GitHub consulta); o próprio merge deste PR não dispara deploy (CI roda em `main` nesse
push, mas o `cd.yml` já atualizado, lido do próprio `main` pós-merge, não casa mais `branches:
[develop]` contra um evento de `main`) — a validação real só acontece no próximo push a
`develop` depois do merge, não presumir "funciona" antes de observar isso ao vivo.

## Emenda 2 (2026-09-24, revisão adversarial Claude↔Codex, D-331) — resolve a ambiguidade da Fase 2

A redação original da Fase 2 apresentava duas opções como equivalentes: transformar a conta atual
(`975707451904`, que JÁ hospeda toda a carga real de `dev`) na management account da nova
Organization, OU criar uma management account nova e migrar `975707451904` para dentro dela como
conta-membro. **Pesquisa externa feita nesta revisão** (documentação oficial AWS Organizations,
seção "Delegated administrator" de "Terminology and concepts for AWS Organizations"): *"We
recommend that you store your AWS resources in other member accounts in the organization and keep
them out of the management account. This is because security features like Organizations service
control policies (SCPs) do not restrict any users or roles in the management account."*

Isso decide a ambiguidade: a primeira opção (dev = management account) deixaria `dev`
estruturalmente fora do alcance de SCPs, uma camada de governança real que o ADR quer poder usar
plenamente em todas as contas-membro. **Correção de precisão (achado do Codex, Rodada 1)**: SCPs
são uma camada ADICIONAL de governança, não a origem exclusiva do isolamento entre contas — a
separação por conta já entrega fronteiras reais de identidade/recursos/billing mesmo sem nenhuma
SCP configurada (é isso que fundamenta o critério de peso 35% desde a decisão original). O ponto
real da Emenda 2 é mais restrito: não desperdiçar, de saída, a capacidade de aplicar SCPs a `dev`
no futuro. **Decisão**: a Fase 2 sempre cria uma management account nova e vazia; `975707451904`
migra para dentro da Organization como conta-membro `dev`, nunca o inverso. Texto da Fase 2 acima
já atualizado para refletir isso.

## Emenda 3 (2026-09-24, revisão adversarial Claude↔Codex, D-331) — elaboração exigida antes da Fase 2/3

A Rodada 1 do protocolo identificou peças reais da arquitetura-alvo que este ADR ainda não define
em detalhe suficiente para EXECUTAR a Fase 2/3 com segurança — nenhuma delas invalida a decisão
central (Organizations, conta-por-ambiente), mas todas precisam de resposta concreta ANTES da
autorização de execução, não só "resolver quando chegar lá":

1. **Baseline de SCPs e isolamento de trust** — a promessa de "uma ação errada em `dev` nunca
   alcança produção" ainda não tem os controles concretos que a sustentam: baseline de SCPs por OU
   (com `all features` habilitado), roles de deploy independentes por ambiente (credenciais de
   `dev` sem acesso ao state/roles de `staging`/`production`), trust OIDC restrito por ambiente,
   proteção via GitHub Environments, e acesso administrativo de emergência para a management
   account (que fica FORA do alcance de SCPs por definição — ver Emenda 2).
2. **Sequência de bootstrap** — como o backend S3 e o OIDC trust role de cada conta NOVA são
   provisionados na primeira vez (`infra/providers.tf` já assume que o bucket de state existe antes
   do `init` — quem cria esse bucket, e como, sem violar a regra de nunca rodar `apply` local?).
   Inclui também como `dev` (`975707451904`) entra na Organization sem que políticas herdadas
   quebrem o pipeline já funcionando (contas convidadas não recebem `OrganizationAccountAccessRole`
   automaticamente).
3. **Contrato de promoção de artefato** — "promove o MESMO artefato já testado" (Final Decision
   acima) ainda não define empacotamento imutável, digest/checksum, retenção, autorização de
   leitura cross-account, nem a associação entre artefato/commit/deploy saudável que a promoção
   precisa para ser confiável.
4. **DR e budget por conta nova** — a política de DR existente cobre falha regional, mas não decide
   como cobrir comprometimento/perda de acesso a uma CONTA inteira (cenário distinto). O módulo de
   budget (`infra/env/dev.tfvars`) tem `budget_notification_emails` vazio hoje — "herdar os
   guardrails de dev" (Reliability Impact acima) não está comprovado para alertas financeiros;
   cada conta nova precisa de destinatários/limites próprios definidos explicitamente, não herdados
   por omissão.
5. **Gatilho da Fase 4 é necessário mas não suficiente** — resolver E-019/D-052 autoriza a
   REAVALIAÇÃO da Fase 4, nunca a criação automática da conta de produção; uma reavaliação com
   autorização explícita de Marcelo + gates de implantação concretos continua exigida mesmo depois
   do gatilho disparar.

**Correção de implementação já aplicada nesta rodada** (achado concreto, não só de design): o
manifesto de deploy (`cd.yml`, step "Persist deploy manifest...") gravava `github.sha` como
`commitSha` — em `workflow_run`, esse valor resolve para o último commit do branch PADRÃO (`main`),
nunca o commit de `develop` que o job realmente fez checkout e deployou (`head_sha`, já usado
corretamente no `ref:` do checkout). Corrigido para usar a mesma expressão condicional do
checkout, em ambos os pontos que registravam o commit (manifesto S3 e resumo do job).

## Pendência explícita

Protocolo Claude↔Codex retomado (2026-09-24) — revisão adversarial em andamento, ver
`docs/architecture/reviews/adr-0014-environment-separation-adversarial-review/` para as rodadas
(nota cega, ≥9,0, mínimo 3 rodadas, ainda não convergido). A Fase 1 (aditiva, reversível, sem
custo) já foi executada porque não altera nenhum comportamento de `dev` enquanto o ADR não fecha;
as Fases 2-4 aguardam tanto a convergência do protocolo (incluindo a elaboração da Emenda 3) quanto
a autorização explícita de Marcelo nomeada acima.

## References

`docs/project/roadmap-competitivo-2026-09-01.md` §17.3, `docs/engineering/change-risk-scale.md` (nível 6), `docs/engineering/research-protocol.md` (declaração SIM PARCIAL), `infra/variables.tf`, `.github/workflows/cd.yml`. Emenda 2: [AWS Organizations — Terminology and concepts, "Delegated administrator"](https://docs.aws.amazon.com/organizations/latest/userguide/orgs_getting-started_concepts.html), consultado 2026-09-24.
