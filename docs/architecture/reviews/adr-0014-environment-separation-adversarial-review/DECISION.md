# ADR-0014 — Separação de ambientes AWS — Revisão Adversarial (D-331)

## Status

**APROVADO** (direção arquitetural) via protocolo Claude↔Codex (`AGENTS.md` §4), 3 rodadas.
Notas cegas: **Claude 8,7/9,1/9,3, Codex 8,0/9,1/9,1** — convergência a partir da Rodada 2 (ambos
≥9,0), confirmada na Rodada 3.

**Importante — o que esta aprovação cobre e o que não cobre**: aprova a DECISÃO ARQUITETURAL
(AWS Organizations, conta-por-ambiente, nunca `terraform workspace`) e a Fase 1 + Emenda 1/D-306 já
implementadas em código real. **NÃO autoriza a execução das Fases 2-4** (criação de contas AWS
reais) — isso continua exigindo autorização explícita e separada de Marcelo (fronteira de
billing/identidade real), e exige primeiro a elaboração da Emenda 3 (abaixo).

## Trajetória de convergência (notas cegas, sem arredondar)

| Rodada | Claude | Codex | Achado principal fechado nessa rodada |
|---|---|---|---|
| R1 | 8,7/10 | 8,0/10 | Achado trazido proativamente pelo Claude: ambiguidade na Fase 2 sobre qual conta vira management account, resolvida ANTES da rodada com pesquisa externa (AWS Organizations docs: SCPs nunca restringem a management account) — `975707451904` (que já hospeda `dev`) NUNCA deve virar management account. Codex confirmou a escolha central (Organizations, conta-por-ambiente) correta, mas achou um bug real de implementação (commitSha errado no manifesto de deploy sob `workflow_run`) e 4 peças reais de arquitetura ainda não definidas (baseline de SCPs/trust, bootstrap de conta nova, contrato de promoção de artefato, DR/budget por conta) |
| R2 | 9,1/10 | 9,1/10 | Bug do commitSha corrigido (mesma expressão condicional já usada no checkout); as 4 peças de arquitetura registradas como Emenda 3 (elaboração exigida antes de Fase 2/3, não implementadas agora — decisão de proporcionalidade); comparação com AWS Control Tower adicionada e descartada por desproporção ao estágio — **CONVERGIDO** |
| R3 | 9,3/10 | 9,1/10 | Consolidação textual do ADR (8 resíduos documentais da Rodada 2 + 3 residuais adicionais encontrados na própria Rodada 3) — nenhuma mudança arquitetural, confirmação final |

## Achado trazido proativamente pelo Claude (Rodada 1, antes de qualquer crítica do Codex)

A Fase 2 original apresentava como equivalentes duas opções: transformar `975707451904` (que já
hospeda `dev`) na management account, OU criar uma nova. Pesquisa externa (AWS Organizations docs)
mostra que SCPs nunca restringem a management account — a primeira opção deixaria `dev`
estruturalmente fora do alcance desse mecanismo de governança. Corrigido no ADR (Emenda 2): a Fase
2 sempre cria uma management account nova e vazia.

## Bug real corrigido (achado do Codex, Rodada 1)

`cd.yml`'s manifesto de deploy gravava `commitSha: github.sha` — em `workflow_run`, esse valor
resolve para o commit mais recente do branch PADRÃO (`main`), nunca o commit de `develop`
realmente deployado (`head_sha`, já usado corretamente no `ref:` do checkout). Corrigido usando a
mesma expressão condicional em ambos os pontos que registravam o commit.

## Peças de arquitetura registradas como elaboração exigida (Emenda 3), não implementadas nesta revisão

1. Baseline de SCPs e isolamento de trust (roles de deploy independentes, OIDC restrito por
   ambiente, GitHub Environments, acesso administrativo de emergência para a management account).
2. Sequência de bootstrap de backend/OIDC para cada conta nova + entrada controlada de `dev` na
   Organization (políticas herdadas, `OrganizationAccountAccessRole`).
3. Contrato de promoção de artefato entre ambientes (empacotamento imutável, digest, retenção,
   leitura cross-account).
4. DR para comprometimento/perda de acesso a uma CONTA inteira (distinto de falha regional) +
   budget/alertas financeiros por conta nova (`budget_notification_emails` vazio hoje em
   `dev.tfvars` — "herdar guardrails de dev" não está comprovado para alertas financeiros).

Nenhum destes é implementado agora — são decisões de desenho da Fase 2/3, que ainda não tem
autorização de execução. Registrados como exigência EXPLÍCITA antes de qualquer execução real,
nunca "resolver quando chegar lá" vago.

## Escopo desta decisão

Cobre a arquitetura-alvo do ADR-0014 e a Fase 1 + Emenda 1/D-306 (já implementadas). Não cobre a
execução das Fases 2-4 nem a elaboração completa da Emenda 3 — ambas ficam como trabalho futuro,
condicionado a autorização explícita de Marcelo.
