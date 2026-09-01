# Dependency Freshness Standard — Linguagem, Runtime e Dependências Críticas

**Status: `APPROVED` (design) via protocolo Claude↔Codex, 5 rodadas, Claude 9,4/Codex 9,6 (sem arredondamento), 2026-08-31.** Gatilho: D-137/D-138 encontraram o Lambda runtime pinado em `nodejs20.x` meses depois do fim de suporte da AWS, e um bloqueio em cascata (provider Terraform `~5.0` incompatível com `nodejs24.x`) — nenhum mecanismo do projeto teria pego isso sem uma auditoria de performance ad-hoc tropeçar no achado. Histórico completo do protocolo: `docs/engineering/reviews/dependency-freshness-scoping/` (round1 a round5).

Relação com `01-engineering-quality-criteria.md`: este documento aprofunda uma fatia específica do **Domínio G — Software Supply Chain (6%)** ("pinning, lockfile, SBOM, provenance") — não o reabre nem duplica. O Domínio G avalia se dependências estão pinadas e rastreáveis; este standard avalia **frescor**: há quanto tempo um pin ficou parado, se está perto de EOL, se existe um mecanismo que force revisão periódica. Mesma relação que `test-engineering-standard.md` tem com o Domínio C, ou `logging-observability-standard.md` com o Domínio J.

**Nunca duplica versão pinada.** A regra central deste standard: o checker e a política curada leem versões dos manifests/lockfiles reais (`.nvmrc`, `package.json`, `package-lock.json`, `infra/**/versions.tf`, `.terraform.lock.hcl`, `infra/modules/lambda-function/variables.tf`, `.github/workflows/*.yml`) — nunca as redigitam numa tabela paralela, que criaria uma nova fonte de drift.

---

## 1. Relação entre 3 mecanismos distintos (nunca fundidos)

- **Dependabot version updates** — descobre versão nova publicada (npm, GitHub Actions, Terraform providers/módulos), abre PR. Não avalia segurança.
- **Dependabot security updates / dependency graph** — advisories conhecidos, mecanismo independente do anterior.
- **`npm audit`** (já no CI, `ci.yml` linhas 81/170) — gate local determinístico de advisories conhecidos no momento do build, não descobre nada novo sozinho.

Este standard referencia os 3 como complementares. Nenhum "cobre" o outro.

**Limite real e nomeado do Dependabot** (não uma alegação de cobertura universal): ele descobre versão nova de *pacote* — não sabe que Node.js lançou uma nova linha LTS, que a AWS depreciou um runtime Lambda, ou que uma layer ADOT referenciada por ARN mudou de versão. Esses 3 casos dependem de `manual-release-review` (§3).

## 2. Regra de lifecycle

> O runtime/linguagem principal e qualquer runtime gerenciado por provedor externo (AWS Lambda, camada ADOT) devem estar numa linha com suporte ativo do mantenedor/provedor **e** com pelo menos **6 meses** restantes até o primeiro EOL/depreciação aplicável (o que vier primeiro entre EOL upstream da linguagem e depreciação do runtime gerenciado). Releases Current/preview nunca contam como alvo estável (ex.: uma linha Node em preview não é o "alvo" só por ser numericamente mais recente que a LTS ativa).

Janelas:

| Distância até EOL/depreciação | Ação |
|---|---|
| < 6 meses | **Gate — falha, bloqueia** (mesmo padrão dos gates G1-G11 de `01-engineering-quality-criteria.md`) |
| 6–12 meses | Aviso + item rastreável obrigatório (`decisions-log.md` ou `exceptions.md` com prazo nomeado) |
| > 12 meses | Sem ação exigida |

Exceção só com owner + justificativa + compensação + prazo em `exceptions.md`, nunca permanente sem revisão.

Para itens **sem** EOL oficial datado (ver `CriticalDependencyEntry.lifecycle` opcional no §3), a janela se aplica sobre `reviewedAt` (revisão de governança), não sobre uma data de expiração inventada — nunca fabricar `supportEndsAt` para satisfazer o schema.

## 3. Modelo de dados — inventário crítico

```ts
interface CriticalDependencyEntry {
  id: string;                    // "node" | "lambda-runtime" | "hashicorp-aws" | ...
  detectedFrom: string[];        // caminhos/chaves reais lidos, NUNCA reescritos aqui
  owner: "marcelo";
  officialSource: string;        // URL da fonte oficial
  discoveryMechanism:
    | "dependabot-version-updates"   // npm, github-actions, terraform providers/módulos
    | "curated-lifecycle-review"     // tem EOL datado, revisado manualmente
    | "manual-release-review";       // sem EOL datado formal e/ou sem cobertura Dependabot direta
  reviewedAt: string;             // ISO date — toda entrada tem isso, prova supervisão periódica
  lifecycle?: {
    supportedLine: string;        // a LINHA ("24"), nunca a versão exata ("24.7.0")
    supportEndsAt: string;        // só existe quando a fonte oficial publica uma data real
    verifiedAt: string;           // ISO date — confirmação específica do EOL/suporte na fonte
  };
}
```

`reviewedAt` (nível superior, sempre presente) e `lifecycle.verifiedAt` (só quando `lifecycle` existe) respondem perguntas diferentes e não são redundantes: o primeiro prova que um humano revisou owner/fonte/mecanismo recentemente; o segundo prova especificamente quando o EOL/suporte oficial foi confirmado.

O checker (`scripts/check-dependency-freshness.ts`, futuro, ver §6) falha quando: a linha detectada não bate com `supportedLine`; `lifecycle.verifiedAt`/`supportEndsAt` indicam janela < 6 meses (gate) ou 6-12 meses sem item rastreável (aviso); `reviewedAt` de qualquer entrada (com ou sem `lifecycle`) está fora da janela de revisão (6 meses); um item crítico descoberto no repo não tem `CriticalDependencyEntry` correspondente; uma entrada ficou órfã (item removido do código, entrada não removida da política).

## 4. Inventário crítico inicial (nomeado nesta rodada, populado na implementação)

| id | `detectedFrom` | `discoveryMechanism` | `lifecycle`? |
|---|---|---|---|
| `node` | `.nvmrc`, `package.json#engines.node`, `package-lock.json` (bloco raiz) | `manual-release-review` | Sim — nodejs.org publica EOL por linha |
| `lambda-runtime` | `infra/modules/lambda-function/variables.tf` (`default`) | `manual-release-review` | Sim — AWS Lambda runtimes doc publica data |
| `hashicorp-aws` | `infra/providers.tf` + `infra/modules/*/versions.tf` (recursivo) + `.terraform.lock.hcl` correspondentes | `dependabot-version-updates` | Não — HashiCorp não publica EOL por linha de provider |
| `terraform-cli` | `.github/workflows/cd.yml` (`TERRAFORM_VERSION` env) — **achado real**: `ci.yml` hardcoda `"1.15.8"` separadamente em vez de ler a mesma fonte; corrigir isso faz parte da implementação deste item | `manual-release-review` | Não |
| `adot-layer` | `infra/env/*.tfvars` (ARN da layer, versão embutida no nome) | `manual-release-review` | Não — sem EOL formal, mas tem changelog de CVE (achado real de D-136: atualização de segurança 1-30-0→1-30-2) |
| `github-actions` | `.github/workflows/*.yml` (SHAs pinados) | `dependabot-version-updates` | Não aplicável |
| `aws-sdk-v3` | `package.json`/`package-lock.json` | `dependabot-version-updates` | Não |
| `ajv` | `package.json`/`package-lock.json` | `dependabot-version-updates` | Não |
| `esbuild` | `package.json` | `dependabot-version-updates` | Não |

Critério de criticidade (objetivo, decidível por matcher de código — nunca inferência semântica sobre "parece importante"): roda na fronteira de segurança/entrada não confiável; participa de autenticação/autorização/criptografia; é runtime/linguagem principal ou runtime gerenciado por provedor externo; determina formato persistido/contrato público; controla build/deploy/infra; tem blast radius transversal. Frescor (existe versão nova) ≠ suporte (versão atual ainda recebe patch) ≠ vulnerabilidade (advisory aplicável — `npm audit`, não duplicado aqui) ≠ compatibilidade (uma versão exige outra, ex. `hashicorp/aws >= 6.19.0` para `nodejs24.x`) ≠ proveniência/integridade (Domínio G, não duplicado). Este standard cobre frescor + suporte + compatibilidade.

## 5. Sub-rubrica (5 critérios, gate ≥9,0 quando avaliado via protocolo Claude↔Codex para mudanças no próprio standard)

| # | Critério | Peso |
|---|---|---:|
| 1 | Cobertura e fonte de verdade — inventário crítico definido por regra objetiva; versões lidas dos manifests/lockfiles reais, nunca duplicadas; fontes oficiais com data de acesso | 25% |
| 2 | Lifecycle e horizonte operacional — gate de suporte vigente, janelas 6/12 meses, distinção upstream vs. provedor gerenciado, exceção formal | 25% |
| 3 | Descoberta independente — automação agendada (Dependabot) detecta novas versões/advisories sem depender de auditoria oportunista | 25% |
| 4 | Resposta proporcional por risco — urgência determinada por EOL/explorabilidade/severidade/exposição, não por "direta vs. transitiva" | 15% |
| 5 | Verificabilidade e drift control — CI prova consistência entre runtime, build, manifests, lockfiles e política; falha reproduzível | 10% |

Gates binários (falha bloqueia, independente do score): nenhum runtime/linguagem EOL ou runtime gerenciado depreciado; nenhum item crítico sem `CriticalDependencyEntry`; nenhuma exceção vencida em `exceptions.md`; nenhuma incompatibilidade conhecida entre runtime e provider/build-target (ex.: `.nvmrc` diz Node 24 mas o esbuild target ou o runtime Lambda dizem outra coisa).

## 6. Mecanismo de enforcement (design; implementação é trabalho futuro)

- `.github/dependabot.yml` — blocos `npm` (`directories: ["/", "/frontend"]`), `terraform` (`directories` cobrindo `/infra` e `/infra/modules/*`, agrupamento por `dependency-name` entre módulos), `github-actions` (`directory: "/"`). Sem auto-merge. Ressalva operacional: o GitHub pode pausar version updates quando PRs ficam sem interação — revisão periódica inclui checar isso, não presumir "configuração presente" como evidência perpétua.
- `scripts/check-dependency-freshness.ts` — matchers de código reais por `id` (nunca heurística textual), mesmo padrão de `scripts/check-doc-drift.ts`: falha o CI segundo as regras do §3. Roda em todo PR/push, não só quando uma auditoria já está tocando o código (fechando exatamente o padrão ad-hoc que permitiu D-137 passar despercebido).

## 7. Registro de decisão

`docs/architecture/decisions-log.md` D-139. **Design-only**, mesmo padrão de D-121/D-127/D-136 — implementação real (`dependabot.yml`, `check-dependency-freshness.ts`, popular as `CriticalDependencyEntry` reais com `reviewedAt`/`verifiedAt` de hoje, corrigir a inconsistência `ci.yml`/`cd.yml` do item `terraform-cli`) fica para sessão futura dedicada.
