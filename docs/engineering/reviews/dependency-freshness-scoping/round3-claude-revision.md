# Rodada 3 — Fechamento Claude — Padrão de Frescor de Dependências/Runtime/Linguagem

Aceito as 5 correções bloqueantes e a decisão Dependabot vs. Renovate (mantém Dependabot). Achado real corrigido **fora** desta proposta antes de continuar: `package-lock.json` (bloco raiz) ainda tinha `engines.node: 20.x` mesmo depois de eu ter mudado `package.json`/`.nvmrc` para 24 no D-137 — `npm install --package-lock-only` corrigido agora, é exatamente a classe de drift que este standard existe para pegar. Prova viva de por que o item 6 da crítica é real e fica na especificação executável abaixo.

## 1. Política vinculada à linha detectada, não ao nome solto

Estrutura de entrada de política (TypeScript, formato final do manifesto):

```ts
interface FreshnessPolicyEntry {
  id: string;                    // "node" | "lambda-runtime" | "hashicorp-aws" | ...
  detectedFrom: string[];        // caminhos/chaves reais lidos, nunca reescritos aqui
  supportedLine: string;         // "24", não "24.7.0" - a LINHA a que o EOL se aplica
  supportEndsAt: string;         // ISO date, EOL/depreciação da LINHA
  officialSource: string;        // URL
  verifiedAt: string;            // ISO date - quando um humano confirmou a linha na fonte
  owner: "marcelo";              // responsável por triagem, item 7 da crítica
}
```

O checker falha se a linha efetivamente detectada (extraída do arquivo real, nunca digitada) não bater com `supportedLine` da entrada — isso pega exatamente o cenário que o Codex descreveu (`.nvmrc` muda de 24→26 e o EOL do 24 continuaria sendo aplicado silenciosamente).

## 2. Cobertura inicial corrigida — coerente com a própria taxonomia

Lista completa (não só os 3 itens que a Rodada 2 nomeou de exemplo), cada um como `FreshnessPolicyEntry`:

| id | Detectado de | Critério de criticidade (da taxonomia da Rodada 2) |
|---|---|---|
| `node` | `.nvmrc`, `package.json#engines.node`, `package-lock.json` (bloco raiz) | runtime/linguagem principal |
| `lambda-runtime` | `infra/modules/lambda-function/variables.tf` (`default`) | runtime gerenciado por provedor externo |
| `hashicorp-aws` | `infra/**/versions.tf` (recursivo), `infra/**/.terraform.lock.hcl` | controla build/deploy/infra + blast radius transversal |
| `terraform-cli` | `.github/workflows/cd.yml`'s `TERRAFORM_VERSION` env (`ci.yml` também referencia, hardcoded `"1.15.8"` — achado real: **não está centralizado**, `ci.yml` não lê a mesma env var de `cd.yml`, é uma 2ª inconsistência a corrigir na implementação, registrada aqui) | controla build/deploy/infra |
| `adot-layer` | `infra/env/*.tfvars` (ARN da layer, versão embutida no nome, ex. `aws-otel-nodejs-amd64-ver-1-30-0`) | runtime gerenciado, participa do caminho de toda Lambda instrumentada |
| `esbuild` | `package.json` (dependency version) | controla build |
| `github-actions` | `.github/workflows/*.yml` (SHAs pinados) | controla build/deploy — **descoberta delegada inteiramente ao bloco `github-actions` do Dependabot**, sem entrada de política curada (Actions não têm EOL/lifecycle no sentido deste standard, só versão — regra explícita, não omissão) |
| `aws-sdk-v3` | `package.json`/`package-lock.json` | blast radius transversal (usado por praticamente todo handler) — **só freshness/discovery via Dependabot + `npm audit`, sem entrada de política de lifecycle curada** (AWS SDK não tem um "EOL de linha" público como Node/Lambda; regra explícita, mesma lógica do `github-actions`) |
| `ajv` (schema validator) | `package.json`/`package-lock.json` | determina contrato público/formato persistido — mesma classificação de `aws-sdk-v3` (freshness via Dependabot, sem lifecycle curado) |

Regra geral que resolve a ambiguidade da Rodada 2: **todo item crítico tem descoberta (Dependabot cobre 100% deles); só um subconjunto — runtime/linguagem e runtimes gerenciados por provedor externo com EOL público conhecido — também tem entrada de `FreshnessPolicyEntry` com lifecycle curado.** A âncora de gate "nenhum item crítico sem owner/fonte/descoberta" se aplica à descoberta (sempre via Dependabot) — não exige que todo item crítico tenha uma política de EOL curada, porque nem todo item crítico tem um EOL público que faça sentido curar (AWS SDK v3, Ajv, esbuild não publicam uma "data de fim de suporte de linha" da mesma forma que Node/AWS Lambda/Terraform provider fazem).

## 3. Mecanismo decidível de classificação

O manifesto de matchers vive no próprio script, não como heurística textual:

```ts
const CRITICAL_MATCHERS: Record<string, () => Promise<DetectedVersion>> = {
  node: () => readNvmrcAndPackageJsonAndLockfile(),
  "lambda-runtime": () => readLambdaFunctionDefaultRuntime(),
  "hashicorp-aws": () => readAllVersionsTfRecursive("hashicorp/aws"),
  "terraform-cli": () => readTerraformVersionFromWorkflows(),
  "adot-layer": () => readAdotLayerArnFromTfvars(),
  // ...
};
```

Cada matcher é código real, testável, que sabe exatamente onde procurar — nunca inferência semântica sobre "o que parece crítico". A lista de matchers É a definição operacional de "item crítico com política curada"; itens cobertos só por Dependabot (Actions, AWS SDK, Ajv, esbuild) não precisam de matcher aqui, só de bloco correspondente em `dependabot.yml`.

## 4. Descoberta recursiva real dos arquivos Terraform

Corrigido: `infra/versions.tf` não existe (confirmado); a raiz tem `infra/providers.tf` com o `required_providers` do módulo raiz, e cada `infra/modules/*/versions.tf` tem o seu. O matcher `hashicorp-aws` varre `infra/providers.tf` + `infra/modules/*/versions.tf` + os `.terraform.lock.hcl` correspondentes, e falha se alguma constraint divergir do que os outros módulos declaram (a mesma disciplina que eu apliquei manualmente e à mão em D-138 — este script existe para nunca depender de novo de um humano lembrar de todos os ~22 arquivos).

## 5. Terminologia corrigida: 3 mecanismos distintos, nunca fundidos

- **Dependabot version updates**: descobre versão nova publicada, abre PR. Não avalia se é segura.
- **Dependabot security updates / dependency graph**: advisories conhecidos — mecanismo independente, pode ficar ativo mesmo com version updates desligado.
- **`npm audit`** (já no CI, `ci.yml` linha 81/170): gate local determinístico de advisories conhecidos no momento do build — não descobre nada novo sozinho, valida o que já está instalado.

O standard referencia os 3 como complementares, nunca diz que um "cobre" o outro.

## 6. Invariante cruzada do Node — a prova viva

`node`'s `detectedFrom` inclui explicitamente `package-lock.json` (bloco raiz `engines`), não só `.nvmrc`/`package.json` — corrige a omissão da Rodada 2 que deixou passar o drift real que eu mesmo tinha no repositório agora mesmo.

## 7. Owner verificável + Dependabot pausado

Aceito a ressalva: `owner: "marcelo"` em cada `FreshnessPolicyEntry` (campo já presente no formato do item 1) mais uma linha explícita no standard: revisão periódica inclui checar `Settings → Advanced Security → Dependabot` no GitHub por "version updates paused" (GitHub pausa automaticamente quando PRs ficam sem interação) — gatilho de reavaliação, mesmo padrão dos demais gatilhos já registrados em `ai-governance.md`/`exceptions.md` deste projeto.

## Registro final (se esta rodada atingir o gate)

`docs/engineering/dependency-freshness-standard.md` (rubrica 5 critérios 25/25/25/15/10 + 4 gates binários + a tabela de cobertura acima), `.github/dependabot.yml` (npm raiz+`frontend/`, terraform `/infra`+`/infra/modules/*` com `directories`/agrupamento, github-actions, sem auto-merge), `scripts/check-dependency-freshness.ts` (os matchers acima). **Design-only nesta rodada** — implementação real (o script, o `dependabot.yml`, popular as `FreshnessPolicyEntry` reais com `verifiedAt` de hoje) fica para sessão futura dedicada, mesmo padrão D-121/D-127/D-136. Corrigir também, na implementação, a inconsistência real encontrada nesta rodada: `ci.yml` hardcoda `"1.15.8"` em vez de ler a mesma `TERRAFORM_VERSION` env que `cd.yml` usa — nomeado aqui, não corrigido nesta sessão de design.