# Dependency Freshness Standard — Estado Final Consolidado

**Status: `APPROVED` (design) via protocolo Claude↔Codex, 5 rodadas, Claude 9,4/Codex 9,6 (sem arredondamento).** Documento normativo final: `docs/engineering/dependency-freshness-standard.md`.

Histórico: `round1-claude-proposal.md` → `round1-codex-critique.md` (5,8/10 régua, 7,4/10 design — REABRIR) → `round2-claude-revision.md` → `round2-codex-critique.md` (8,8/10 — NÃO APROVADO) → `round3-claude-revision.md` → `round3-codex-critique.md` (8,8/10 — NÃO APROVADO) → `round4-claude-revision.md` → `round4-codex-critique.md` (8,8/10 — NÃO APROVADO) → `round5-claude-final.md` → `round5-codex-critique.md` (9,6/10 — **APPROVED**).

## Achado real que motivou a rodada

D-137 (migração de runtime Lambda) encontrou o projeto pinado em `nodejs20.x`, já depreciado pela AWS desde 30/04/2026, e a correção revelou um bloqueio em cascata (D-138): `nodejs24.x` exige `hashicorp/aws >= 6.19.0`, provider estava em `~5.0` em 22 módulos Terraform. Nenhum dos dois teria sido detectado sem uma auditoria de performance ad-hoc tropeçar neles.

## Achado real produzido pelo próprio protocolo (não hipotético)

Durante a Rodada 2, o Codex apontou que o checker proposto deveria incluir `package-lock.json` na verificação cruzada de versão do Node — e essa verificação, feita imediatamente, encontrou um drift real: `package-lock.json` (bloco raiz `engines.node`) ainda dizia `"20.x"` mesmo depois de `package.json`/`.nvmrc` terem sido atualizados para `24` em D-137. Corrigido ao vivo (`npm install --package-lock-only`) durante a Rodada 3 — prova viva do valor do standard antes mesmo dele estar implementado.

Também confirmado: `.github/workflows/ci.yml` hardcoda `terraform_version: "1.15.8"` separadamente de `cd.yml`'s `TERRAFORM_VERSION` env — duas fontes da mesma versão, inconsistência real nomeada para correção na implementação (item `terraform-cli` do inventário).

## Evolução do design pelas 5 rodadas (resumo)

1. **Rodada 1→2**: régua sem pesos/âncoras rejeitada; regra "1 major atrás" rejeitada por instabilidade semântica (substituída por "LTS suportada + horizonte mínimo de 6 meses até EOL"); tabela de versão pinada manual rejeitada (duplicaria fonte de verdade); SCA (Dependabot) e checker determinístico eram tratados como alternativas — corrigido para modelo híbrido.
2. **Rodada 2→3**: política precisa vincular-se à LINHA detectada (não ao nome solto, para não aplicar EOL errado se a linha mudar); cobertura inicial incompleta (só 3 de ~9 itens críticos reais); mecanismo de classificação precisa ser matcher de código, não heurística; descoberta Terraform precisa ser recursiva (`infra/versions.tf` não existe, são 22 arquivos distribuídos); terminologia Dependabot version-updates vs. security-updates vs. `npm audit` precisa ficar exata.
3. **Rodada 3→4**: alegação "Dependabot cobre 100% dos itens críticos" era falsa — Node/Lambda runtime/ADOT/Terraform CLI não são descobertos por Dependabot; `lifecycle` (EOL datado) não pode ser fabricado para itens sem data oficial — separado inventário crítico (sempre presente) de política de lifecycle (só quando EOL real existe).
4. **Rodada 4→5**: itens sem `lifecycle` (ex. `hashicorp-aws`, `terraform-cli`, `adot-layer`) não tinham campo para registrar revisão periódica — adicionado `reviewedAt` de nível superior em toda entrada, distinto de `lifecycle.verifiedAt`.

## Decisão final (ver documento normativo para o desenho completo)

- Sub-rubrica de 5 critérios ponderados (25/25/25/15/10) + 4 gates binários, mesma relação com o Domínio G de `01-engineering-quality-criteria.md` que `test-engineering-standard.md` tem com o Domínio C.
- Modelo híbrido: Dependabot (descoberta agendada para npm/github-actions/terraform) + checker determinístico (`scripts/check-dependency-freshness.ts`, invariantes cruzadas e lifecycle de itens que Dependabot não descobre).
- Inventário crítico inicial de 9 itens (`node`, `lambda-runtime`, `hashicorp-aws`, `terraform-cli`, `adot-layer`, `github-actions`, `aws-sdk-v3`, `ajv`, `esbuild`), cada um com `CriticalDependencyEntry` tipada.
- Janelas de ação: <6 meses até EOL = gate; 6-12 meses = aviso + item rastreável; >12 meses = sem ação.

## Implementação

**Design-only**, mesmo padrão de D-121/D-127/D-136. Fica para sessão futura dedicada: `.github/dependabot.yml`, `scripts/check-dependency-freshness.ts`, popular as `CriticalDependencyEntry` reais, corrigir a inconsistência `ci.yml`/`cd.yml` do item `terraform-cli`.
