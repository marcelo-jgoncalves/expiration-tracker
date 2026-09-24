# ADR-0014 — Rodada 2 (endereçando os 9 achados da Rodada 1, nota Codex 8,0/10)

## Achado 5 — bug real de implementação: manifesto grava o commit errado — CORRIGIDO

Achado concreto e correto: `cd.yml`'s step de manifesto usava `github.sha` para `commitSha` — em
`workflow_run`, esse valor resolve para o último commit do branch PADRÃO (`main`), nunca o commit
de `develop` que o job realmente fez checkout (`head_sha`, já usado corretamente no `ref:` do
checkout, linha 88). Corrigido usando a MESMA expressão condicional em ambos os pontos que
registravam o commit (manifesto S3 `commitSha` e resumo do job `Commit:`).

## Achado 2 — SCPs como "origem exclusiva" do isolamento — CORRIGIDO (precisão)

Aceito: SCPs são uma camada ADICIONAL de governança, não a origem exclusiva do isolamento entre
contas — a separação por conta já entrega fronteiras reais de identidade/recursos/billing mesmo
sem SCPs. Texto da Emenda 2 corrigido para refletir isso; a conclusão (management account nova e
vazia) continua correta pelo motivo mais restrito real: não desperdiçar a capacidade de aplicar
SCPs a `dev` no futuro.

## Achados 1 — confirmado, nenhuma ação necessária

Codex confirmou a escolha central correta, sem alternativa claramente superior (Control Tower
mencionado como comparação opcional, não obrigatória).

## Achados 3, 4, 7, 8 — peças reais da arquitetura-alvo, registradas como elaboração exigida (Emenda 3), não implementadas agora

Todos os 4 achados são reais e concordo com a classificação do Codex ("peça faltante relevante",
não "decisão incorreta"): baseline de SCPs/isolamento de trust/roles de deploy independentes
(achado 3); sequência de bootstrap de backend/OIDC + entrada de `dev` na Organization (achado 4);
contrato de promoção de artefato entre ambientes (achado 7); DR para comprometimento de CONTA
(distinto de falha regional) + budget por conta nova (achado real: `budget_notification_emails`
está vazio em `dev.tfvars` hoje, "herdar guardrails" não está comprovado para alertas financeiros).

**Decisão de proporcionalidade**: nenhum destes é implementado nesta rodada — são decisões de
DESENHO da Fase 2/3 (que ainda não tem autorização de execução de Marcelo), não retrofits da Fase 1
(aditiva, já feita). Registrados como Emenda 3 no ADR — elaboração EXIGIDA antes de qualquer
execução real da Fase 2/3, nunca "resolver quando chegar lá" de forma vaga. Isto seria proporcional
mesmo se o protocolo já tivesse convergido: são exatamente o tipo de detalhe que só faz sentido
fixar quando a Fase 2 for de fato autorizada (podem mudar dependendo de decisões que só Marcelo
toma, ex. orçamento aceitável por conta).

## Achado 9 (parcial) — coerência textual do documento — CORRIGIDO onde era uma afirmação falsa, mantido onde é histórico legítimo

Corrigido: "Final Decision" ainda dizia "`cd.yml` continua auto-deployando `dev` a cada merge em
`main`" — FALSO desde a Emenda 1/D-306 (agora dispara via CI verde em `develop`, nunca mais
`main`). Corrigido para refletir o estado real, com referência cruzada à Emenda 1. Mantido
intencionalmente: "Options Considered" descreve as opções como eram entendidas em 2026-09-20 (o
registro histórico da decisão original, nunca reescrito para parecer que sempre soubemos o que
sabemos hoje) — não é uma inconsistência, é o registro correto de uma decisão passada.

## Testes/evidência desta rodada

`cd.yml`: mudança sintática mínima (mesma expressão condicional já usada 3 linhas acima, replicada
em 2 pontos) — validação real só possível observando o próximo deploy real disparado por este
commit (mesma disciplina "não presumir funciona sem observar ao vivo" que a Fase 1 já documentava).
`npm run check-docs` limpo após as edições do ADR.

## Auto-nota cega (Claude), Rodada 2

Ver `round-2-claude-selfgrade.md` (arquivo separado).
