# Rodada 1 — Proposta Claude — Padrão de Frescor de Dependências/Runtime/Linguagem

## Contexto e gatilho real

Nesta mesma sessão, uma auditoria de performance encontrou o Lambda runtime do projeto pinado em `nodejs20.x`, **já depreciado pela AWS desde 30/04/2026** — achado que só apareceu porque uma auditoria ad-hoc de performance tropeçou nele, não porque algum mecanismo do projeto o detectou. Corrigir isso (D-137) revelou um segundo problema em cascata: `nodejs24.x` exige `hashicorp/aws >= 6.19.0`, e o provider estava pinado em `~> 5.0` em ~22 módulos Terraform (D-138). Marcelo perguntou, corretamente: o projeto já tem padrões de qualidade ponderados com nota/gate para engenharia (`01-engineering-quality-criteria.md`), teste (`test-engineering-standard.md`), observabilidade (`logging-observability-standard.md`) — por que não para versão de linguagem/runtime/dependência?

## Relação com o que já existe (evitar duplicação)

`01-engineering-quality-criteria.md` já tem o **Domínio G — Software Supply Chain (6%)**: "Pinning, lockfile, SBOM, provenance proporcional (SLSA L1-L2)". Este domínio avalia se dependências estão pinadas e rastreáveis — não avalia **frescor** (há quanto tempo um pin ficou parado, se está perto de EOL, se há um mecanismo que force revisão periódica). Mesma relação que `test-engineering-standard.md` tem com o Domínio C (`Testing Engineering`) ou `logging-observability-standard.md` com o Domínio J: um documento dedicado aprofunda uma fatia específica do domínio mais amplo, sem reabri-lo nem duplicá-lo. Proponho `docs/engineering/dependency-freshness-standard.md` na mesma relação com o Domínio G.

## Declaração E-014 (pesquisa externa)

**SIM.** Política de frescor de dependência/runtime é um padrão já resolvido externamente, não uma escolha de projeto isolada.

Fontes:
- GOV.UK Service Manual, "Keeping software current" — https://docs.publishing.service.gov.uk/manual/keeping-software-current.html — regra concreta: "nunca rodar software EOL"; ficar "a no máximo duas major releases da atual"; vulnerabilidade de segurança explorável é urgente (derruba outras prioridades), atualização de rotina segue processo normal.
- Achado de mercado 2026 (earezki.com/ai-news, aiopsschool.com) — "2026 marca um ciclo massivo de EOL para 50 produtos importantes incluindo Node.js 20" (a própria dependência que este projeto tinha desatualizada é citada como exemplo do setor); o anti-padrão nomeado é "tratar status EOL como se fosse só uma questão de CVE, esperando um relatório de vulnerabilidade antes de agir" — exatamente o modo como este achado poderia ter continuado invisível se a auditoria de performance não tivesse tropeçado nele.

Checklist de critérios pesados derivado da pesquisa:

1. **Nunca rodar runtime/linguagem EOL** — gate binário, não pontuação (GOV.UK, convergência com a prática já usada nos gates G1-G11 do domínio de engenharia).
2. **Distância máxima de major version** — "não mais que 2 majors atrás" é a âncora externa (GOV.UK); adaptar a um número que faça sentido para o ritmo real deste projeto (runtime Lambda/Node muda de major a cada ~1 ano, Terraform provider AWS não tem cadência pública formal).
3. **Enforcement automatizado, não só documento** — mesmo achado já registrado no próprio critério 11 do eixo de Engenharia de Contexto deste projeto ("Documentation-Implementation Drift Control"): um padrão sem verificação automatizada tende a virar prosa que ninguém relê.
4. **Tiers de urgência diferentes por classe de risco** — patch de segurança urgente vs. atualização de rotina agendada (GOV.UK), não uma única prioridade para tudo.

## Proposta de escopo do novo documento

### Estrutura (mesmo padrão dos demais standards do projeto)

- **Domínios e pesos** cobrindo: (a) Runtime/linguagem principal (Node.js do projeto); (b) Runtimes gerenciados por infra (Lambda runtime, camadas ADOT); (c) Provedores Terraform (`hashicorp/aws`, `hashicorp/archive`, `hashicorp/random`); (d) Dependências npm críticas (framework HTTP, SDK AWS, TanStack Query, React) vs. transitivas (peso bem menor, já coberto por `npm audit`/Dependabot se existir); (e) Automação de detecção (existe um script/CI check que falha quando algo entra em janela de risco?).
- **Gate binário**: nenhum runtime/linguagem gerenciado por provedor externo (AWS Lambda, Node.js) pode estar em status EOL publicado pelo próprio fornecedor — falha bloqueia, não é pontuação ponderada (mesmo padrão dos gates G1-G11 já existentes).
- **Regra de distância**: runtime/linguagem principal não deve ficar mais que 1 major release atrás da mais recente com suporte ativo (mais rígido que os "2 majors" do GOV.UK, calibrado para o ritmo de release de Node.js — LTS a cada 2 anos, degradação rápida); dependências de infra (Terraform providers) não têm cadência pública formal — critério aqui é "constraint não force uma versão já sem correção de segurança conhecida publicada", verificável via `npm audit`/GitHub Security Advisories equivalente para providers.
- **Mecanismo de enforcement obrigatório**: um script (`scripts/check-dependency-freshness.ts`, mesmo padrão de `check-doc-drift.ts`) com uma tabela pequena e explícita de {runtime/dependência, versão pinada atual, data de EOL conhecida, fonte} — falha o CI quando uma entrada está a menos de N meses do EOL documentado (N a definir, ex. 3 meses) ou já passou do EOL. Não tenta auto-descobrir EOL de toda a árvore de dependências (isso é escopo de uma ferramenta SCA dedicada, fora de proporção para este projeto agora) — só as entradas que o próprio projeto lista manualmente como "runtime/dependência crítica", mesmo espírito de curadoria manual do `third-party-inventory.md`.
- **Revisão periódica**: gatilho de reavaliação explícito (mesmo padrão de `ai-governance.md` §4/exceptions.md) — não uma cadência de calendário arbitrária, mas "toda vez que uma dependência da tabela publicar uma nova LTS/major, ou a cada auditoria de performance/segurança que já esteja tocando o código, o que vier primeiro".

## Pergunta para a Rodada de crítica

A regra de "1 major atrás" para Node.js é mais rígida que o "2 majors" do GOV.UK — está calibrada certo para este projeto (sem produção real, sem SLA de disponibilidade formal ainda) ou é rigor desproporcional ao estágio (mission `docs/engineering/principles.md` #1, "sem sofisticação antecipada")? E o mecanismo de enforcement (tabela curada manualmente + script) é suficientemente robusto, ou deveria exigir uma ferramenta real de SCA (ex. Dependabot/Renovate configurado) em vez de uma tabela mantida à mão que pode ela mesma ficar desatualizada?