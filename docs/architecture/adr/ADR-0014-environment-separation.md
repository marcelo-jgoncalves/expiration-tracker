# ADR-0014 — Separação real de ambientes (`main` deixa de ser sinônimo de `dev`)

**Status**: `PENDING_PROTOCOL_REVIEW` (decidido por Claude sozinho, protocolo Claude↔Codex suspenso até 2026-09-23 — `NEXT_SESSION_PROMPT.md`, mandato autônomo 2026-09-19) | **Data**: 2026-09-20 | **Type**: Type 1 (nível 6, `change-risk-scale.md` — novo domínio de risco: fronteira de conta AWS) | **Decisor**: Claude, com decisão dos 3 parâmetros de produto (nível do default etc. não se aplica aqui — ver seção de escopo) ainda a confirmar com Marcelo nos pontos marcados

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

1. **AWS Organizations + uma conta por ambiente (`dev` atual + `staging` nova agora + `production` nova só perto do lançamento real), Terraform com backend/diretório próprio por ambiente, nunca `terraform workspace`** (escolhida) — única opção que atende o critério 1 (peso 35%) e 2 (peso 20%) plenamente.
2. **Separação só por Terraform directory/backend dentro da MESMA conta AWS** (ex. `infra/environments/{dev,staging}/`, mesmo `975707451904`) — rejeitada como solução final (viola o critério 1: mesma conta = mesmo limite de IAM/blast radius, exatamente o "Level of risk: High" que a fonte 1 nomeia), mas é um passo intermediário legítimo se o custo/tempo de criar contas novas for proibitivo — não é o caso aqui (contas AWS são gratuitas para criar, só cobram pelo uso real).
3. **`terraform workspace` (mecanismo nativo do CLI)** — rejeitada explicitamente pela própria documentação do mantenedor (fonte 2, critério 2).
4. **Não fazer nada agora, manter só `dev`** — rejeitada por instrução direta de Marcelo (item 2 desta sessão), que já decidiu que isto deve ser corrigido agora, não adiado de novo.

## Evidence

`docs/project/roadmap-competitivo-2026-09-01.md` §17.3 (registro do gap, 2026-09-19); `infra/variables.tf` (`variable "environment"` hoje trava `validation { condition = var.environment == "dev" }` — literalmente impossível declarar outro ambiente sem mudar este arquivo); `infra/backend.hcl.example`/`infra/env/dev.tfvars` (um único backend S3, uma única tfvars, confirma zero separação hoje); `.github/workflows/cd.yml` (deploy dispara em qualquer sucesso de CI em `main`, sem gate de ambiente); `aws organizations describe-organization --profile claude-dev` → `AWSOrganizationsNotInUseException` (confirmado ao vivo, 2026-09-20: esta conta não pertence a nenhuma Organization hoje — ponto de partida real, não hipotético).

## Reliability Impact

Risco de NÃO fazer isto: qualquer erro de `terraform apply`/dado sintético/IAM excessivo em "dev" hoje já é o pior caso possível, porque não há um ambiente de validação intermediário antes de expor o mesmo código a um usuário real — o primeiro "staging real" seria, na prática, o primeiro cliente. Risco de fazer isto incorretamente: uma conta AWS nova mal configurada (sem MFA na root, sem billing alerts) é uma superfície de ataque nova — a Fase 2 (abaixo) deve herdar os mesmos guardrails de segurança que a conta `dev` já tem (least-privilege IAM, OIDC sem credencial de longa duração), nunca uma conta "mais fraca" só por ser nova.

## Trade-offs

- **A favor**: fecha a lacuna nomeada há um dia (§17.3) com o padrão que a própria AWS chama de "Level of risk: High" se não seguido; a estrutura de conta é uma decisão cara-de-mudar (`principles.md` #2) — fazer isso agora, com pouco dado sintético em `dev`, é o momento mais barato possível (esperar até ter usuário real tornaria a migração muito mais arriscada).
- **Contra**: cria overhead real de gestão (mais uma conta para monitorar, MFA, billing) antes de haver usuário real; a conta de `produção` ficaria vazia por potencialmente meses (E-019/D-052 ainda bloqueiam lançamento real) — mitigado pela decisão de só criar `production` perto do gatilho real (ver Rollout).

## Final Decision

**Arquitetura-alvo**: AWS Organizations com management account + OU `Workloads` contendo contas-membro `dev` (a conta `975707451904` já existente, sem migração de dados — ela SE TORNA a conta `dev` da Organization) e `staging` (nova); OU `Production` reservada, conta criada só no gatilho abaixo. Terraform ganha `infra/env/{dev,staging,production}.tfvars` (cada um com seu próprio `aws_account_id`) e cada ambiente usa seu próprio backend S3 (bucket por conta, nunca compartilhado) — nunca `terraform workspace`. Pipeline de promoção: `cd.yml` continua auto-deployando `dev` a cada merge em `main` (sem mudar o fluxo já funcional); uma nova `cd-staging.yml` promove o MESMO artefato já testado (não rebuilda) via `workflow_dispatch` manual; `cd-production.yml` só é criado quando a conta de produção existir.

**Rollout faseado** (nenhuma fase deixa o projeto pior se a próxima nunca acontecer, critério 5):

- **Fase 1 — feita nesta sessão** (nível 3-4, sem custo/ação irreversível): `infra/variables.tf` passa a aceitar `"dev"`/`"staging"`/`"production"` como valores válidos de `environment` (hoje só `"dev"`), preparando o contrato sem alterar nenhum comportamento de `dev` (nenhum `.tfvars`/backend novo aponta para esses valores ainda — puramente aditivo). Este ADR + entrada em `decisions-log.md` + atualização de `roadmap-competitivo-2026-09-01.md` §17.3.
- **Fase 2 — precisa de autorização explícita de Marcelo antes de executar**: criar a AWS Organization (transforma a conta atual em management account OU cria uma nova management account e migra `975707451904` para dentro dela como membro `dev`) e a conta `staging` nova. **Por quê pausar aqui, apesar da autonomia de infra já concedida (`AGENTS.md` §7/`ai-governance.md` §1)**: criar uma conta AWS real é uma ação de escopo diferente de editar Terraform dentro da conta já existente — precisa de um e-mail dedicado (mesmo padrão já usado para tenants sintéticos, ex. `marcelo.mjgoncalves+aws-staging@gmail.com`), fica ligada ao billing real de Marcelo, e não é uma ação dentro do "fluxo padrão PR→CI(plan)→CD(apply em main)" que a autonomia de infra já cobre — é criação de uma fronteira de identidade nova, não edição de um recurso dentro de uma fronteira já aprovada.
- **Fase 3 — depois da Fase 2**: provisionar `staging` via Terraform (mesmos módulos de `dev`, backend/tfvars próprios), configurar OIDC/trust role na conta nova, criar `cd-staging.yml`.
- **Fase 4 — gatilho explícito de reavaliação (`principles.md` #5), não "quando fizer sentido" vago**: criar a conta `production` quando UMA das condições valer: (a) E-019 (aviso de privacidade/DPA Meta) resolvido E D-052 (billing) desbloqueado, ou (b) Marcelo decidir uma data de lançamento antes disso, ou (c) Marcelo pedir explicitamente antes de qualquer uma das anteriores.

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
`workflow_run` do `CI` completando em `develop` (não mais `main`); `main` fica sem gatilho de
deploy até staging/produção existirem de fato. Achado real verificado via documentação oficial do
GitHub antes de implementar (`AGENTS.md` §4): `workflow_run` sempre executa a versão do arquivo de
workflow que está no branch PADRÃO do repositório (`main`, confirmado via
`gh repo view --json defaultBranchRef`), nunca a do branch que disparou o CI — o filtro
`branches:` só decide QUANDO disparar, nunca qual versão do arquivo roda. Implicação prática: esta
mudança só passa a valer de fato depois que este PR for mergeado em `main` (que atualiza a cópia
que o GitHub consulta); o próprio merge deste PR não dispara deploy (CI roda em `main` nesse
push, mas o `cd.yml` já atualizado, lido do próprio `main` pós-merge, não casa mais `branches:
[develop]` contra um evento de `main`) — a validação real só acontece no próximo push a
`develop` depois do merge, não presumir "funciona" antes de observar isso ao vivo.

## Pendência explícita

Protocolo Claude↔Codex completo (nota cega, ≥9,0, mínimo 3 rodadas) ainda não rodou — suspenso até Codex voltar (previsto 2026-09-23). Este ADR fica `PENDING_PROTOCOL_REVIEW` até essa rodada acontecer; a Fase 1 (aditiva, reversível, sem custo) já foi executada porque não altera nenhum comportamento de `dev` enquanto o ADR não fecha — as Fases 2-4 aguardam tanto a rodada quanto a autorização explícita de Marcelo nomeada acima.

## References

`docs/project/roadmap-competitivo-2026-09-01.md` §17.3, `docs/engineering/change-risk-scale.md` (nível 6), `docs/engineering/research-protocol.md` (declaração SIM PARCIAL), `infra/variables.tf`, `.github/workflows/cd.yml`.
