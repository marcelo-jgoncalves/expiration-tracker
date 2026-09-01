# Rodada 2 — Revisão Claude — Padrão de Frescor de Dependências/Runtime/Linguagem

Aceito integralmente a crítica. Adoto a sub-rubrica reconciliada de 5 critérios (25/25/25/15/10) como régua desta rodada em diante, e corrijo os 6 pontos.

## 1. Régua adotada sem alteração

Cobertura e fonte de verdade (25%) / Lifecycle e horizonte operacional (25%) / Descoberta independente (25%) / Resposta proporcional por risco (15%) / Verificabilidade e drift control (10%), com as 4 âncoras de gate binário listadas pelo Codex (nenhum EOL/depreciado; nenhum item crítico sem owner/fonte/descoberta; nenhuma exceção vencida; nenhuma incompatibilidade runtime↔provider↔build-target).

## 2. Regra de lifecycle corrigida

Substituo "1 major atrás" por:

> O runtime/linguagem principal e qualquer runtime gerenciado por provedor externo (AWS Lambda, camada ADOT) devem estar numa linha com suporte ativo do mantenedor/provedor E com pelo menos **6 meses** restantes até o primeiro EOL/depreciação aplicável (o que vier primeiro entre EOL upstream da linguagem e depreciação do runtime gerenciado). Releases Current/preview nunca contam como alvo estável (ex.: Node 26 em preview hoje não é o "alvo" só por ser numericamente mais recente que o Node 24 LTS).

Janelas: **< 6 meses até EOL → falha de gate** (bloqueia, mesmo padrão G1-G11); **6-12 meses → aviso + item rastreável obrigatório** (entrada em `decisions-log.md` ou `exceptions.md` nomeando prazo); **> 12 meses → sem ação exigida**. Exceção só com owner + justificativa + compensação + prazo em `exceptions.md`, nunca permanente sem revisão.

## 3. Checker sem duplicar fonte de verdade

O script (`scripts/check-dependency-freshness.ts`) **lê** as versões reais de `.nvmrc`, `package.json` (`engines`), `package-lock.json`, `infra/**/versions.tf` + `.terraform.lock.hcl`, `infra/modules/lambda-function/variables.tf` (runtime default) — nunca as re-digita numa tabela paralela. A única coisa mantida manualmente é a **política que não existe em nenhum arquivo do repo**: por item crítico, `{classe de criticidade, data de EOL/depreciação conhecida, URL da fonte oficial, data de verificação da política}`. O checker:

- extrai a versão real de cada fonte acima;
- cruza com a entrada de política correspondente (por nome do item, não por número de versão — a versão é lida, não copiada);
- falha se um item crítico descoberto no repo não tem entrada de política (cobertura obrigatória, sem exceção silenciosa);
- falha se uma entrada de política ficou órfã (item removido do repo, mas política não limpa — mesmo espírito do `check-doc-drift.ts` contra documentos órfãos);
- falha se `.nvmrc`/build target esbuild/runtime Lambda divergem entre si (a mesma classe de inconsistência que quase aconteceu nesta sessão: eu mudei `.nvmrc` para Node 24 e quase deixei o runtime Lambda em Node 22 até notar);
- falha por janela de EOL (regra do item 2) e por exceção vencida.

## 4. Modelo híbrido: Dependabot/Renovate + checker determinístico

Aceito que checker sozinho não resolve o incidente-raiz de D-137 (nada detectaria uma nova versão publicada). **Gap real confirmado**: `.github/dependabot.yml` não existe hoje neste repositório. Proposta:

- Dependabot (não Renovate — já é nativo do GitHub, sem app de terceiros a autorizar, proporcional ao estágio do projeto) configurado para 3 ecossistemas: `npm` (raiz + `frontend/`), `github-actions`, `terraform` (`infra/` e cada `infra/modules/*`) — descoberta periódica, abre PR quando existe versão nova, nunca auto-merge.
- O checker determinístico continua existindo como **backstop offline + invariantes cruzadas** que Dependabot não cobre (consistência `.nvmrc`↔build-target↔runtime Lambda; janela de EOL calculada contra a política curada; exceções vencidas) — os dois papéis são complementares, não substitutos, exatamente como o Codex nomeou.
- `npm audit`/GitHub Security Advisories continuam sendo o mecanismo de vulnerabilidade conhecida (já existe no CI, `full-audit round1` cita isso) — este novo standard não o duplica, só referencia.

## 5. Taxonomia objetiva de criticidade (substitui a lista informal)

Um item é **crítico** (entra na tabela de política, pesa no gate) quando atende a pelo menos um destes critérios objetivos (adaptados dos propostos pelo Codex ao vocabulário real do projeto):

- roda na fronteira de segurança ou processa entrada não confiável diretamente (ex.: parsers de upload, validação de webhook);
- participa de autenticação/autorização/criptografia (Cognito SDK, JWT, KMS);
- é o runtime/linguagem principal ou um runtime gerenciado por provedor externo (Node.js, `nodejs*.x` Lambda, camada ADOT);
- determina formato persistido ou contrato público (schema validator/Ajv, cliente DynamoDB);
- controla build/deploy/infra (esbuild, Terraform providers, GitHub Actions usadas em `ci.yml`/`cd.yml`);
- tem blast radius transversal (AWS SDK v3 — usado por praticamente todo handler).

**Urgência não é automática por "direta vs. transitiva"** (correção aceita) — uma transitiva que atenda a um dos critérios acima E tenha advisory aplicável tem a mesma urgência de uma direta; a distinção direta/transitiva só afeta OS MECANISMOS de descoberta (Dependabot cobre ambas via `npm audit`; a tabela de política curada só precisa de entrada explícita para as que também carregam risco de EOL/lifecycle, que normalmente são diretas, mas não por regra fixa).

Distingo explicitamente (correção aceita): **frescor** (existe versão mais nova) ≠ **suporte** (a versão atual ainda recebe patch) ≠ **vulnerabilidade** (advisory aplicável, já coberto por `npm audit`, não duplicado aqui) ≠ **compatibilidade** (uma versão é exigida por outro componente, ex. `hashicorp/aws >= 6.19.0` para `nodejs24.x`) ≠ **proveniência/integridade** (já é o Domínio G existente, não duplicado). Este standard cobre frescor + suporte + compatibilidade; vulnerabilidade e proveniência permanecem no domínio G/mecanismos já existentes, só referenciados aqui.

## 6. Descoberta agendada, não oportunista

Aceito a correção — Dependabot já resolve isso nativamente (roda na cadência configurada, ex. semanal, independente de qualquer humano tocar o código). O checker determinístico roda em todo PR/push (mesmo padrão de `check-doc-drift.ts`), não apenas quando uma auditoria já está em andamento. Isso fecha o loop: Dependabot garante que "uma nova LTS/advisory existe" vira um PR visível sem depender de descoberta humana; o checker garante que a política/invariantes internas continuam consistentes a cada mudança de código.

## Registro se esta rodada atingir o gate

`docs/engineering/dependency-freshness-standard.md` (novo, mesma relação com o Domínio G de `01-engineering-quality-criteria.md` que `test-engineering-standard.md` tem com o Domínio C), `.github/dependabot.yml` (novo), `scripts/check-dependency-freshness.ts` (novo, invocado por um script npm e por um step de CI). Implementação real (o script propriamente dito, o `dependabot.yml`, popular a tabela de política inicial com os itens críticos já identificados nesta sessão — Node.js, `nodejs*.x` Lambda, `hashicorp/aws`) fica para sessão futura dedicada, mesmo padrão de design-only já usado no projeto (D-121, D-127, D-136).

## Pergunta para a Rodada 3 (se necessária)

A escolha de Dependabot em vez de Renovate — puramente por já ser nativo do GitHub sem app de terceiros, proporcional ao estágio "sem produção real" do projeto — está correta, ou há uma limitação real do Dependabot (ex. suporte a múltiplos diretórios Terraform, agrupamento de PRs) que tornaria Renovate a escolha tecnicamente superior mesmo com o custo de onboarding de uma ferramenta terceira?