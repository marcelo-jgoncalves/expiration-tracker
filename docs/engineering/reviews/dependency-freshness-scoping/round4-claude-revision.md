# Rodada 4 — Fechamento Claude — Padrão de Frescor de Dependências/Runtime/Linguagem

Aceito a correção. Separo inventário crítico (sempre presente, sempre com owner/fonte/mecanismo de descoberta) de política de lifecycle (só quando existe EOL oficial datado — nunca fabricado).

## Estrutura final corrigida

```ts
interface CriticalDependencyEntry {
  id: string;
  detectedFrom: string[];
  owner: "marcelo";
  officialSource: string;
  discoveryMechanism:
    | "dependabot-version-updates"   // npm, github-actions, terraform providers/modules
    | "curated-lifecycle-review"     // tem EOL datado, revisado manualmente no checker
    | "manual-release-review";       // sem EOL datado formal, sem cobertura Dependabot direta (ex. ADOT ARN, Terraform CLI version string) - revisão manual periódica é o próprio mecanismo
  lifecycle?: {
    supportedLine: string;
    supportEndsAt: string;   // só existe quando a fonte oficial publica uma data real
    verifiedAt: string;
  };
}
```

Regras adotadas exatamente como propostas: (1) todo item crítico tem `CriticalDependencyEntry`; (2) `lifecycle` só existe com EOL oficial datado, nunca fabricado; (3) o checker só valida linha-vs-lifecycle quando `lifecycle` existir; (4) itens sem EOL datado registram e o checker valida que `verifiedAt`/revisão periódica aconteceu dentro de uma janela (ex. 6 meses), não que uma data de expiração específica seja respeitada; (5) o documento final declara exatamente o que o Dependabot cobre, sem alegação de cobertura universal.

## Inventário crítico final, com `discoveryMechanism` correto por item

| id | `discoveryMechanism` | `lifecycle`? |
|---|---|---|
| `node` | `manual-release-review` (Dependabot não descobre novas linhas major de Node — ele atualiza `devDependencies`/`dependencies` do tipo npm, não o runtime host) | Sim — nodejs.org publica EOL por linha |
| `lambda-runtime` | `manual-release-review` (idem — depreciação de runtime é um anúncio AWS, não uma dependência npm/terraform que o Dependabot rastreia) | Sim — AWS Lambda runtimes doc publica data |
| `hashicorp-aws` | `dependabot-version-updates` (bloco `terraform` do Dependabot cobre provider version bumps) | Não — HashiCorp não publica EOL por linha de provider, só changelog/releases; `lifecycle` fica ausente por regra, revisão manual periódica é o mecanismo de segurança residual |
| `terraform-cli` | `manual-release-review` (a versão é uma string em `env:` do workflow, não um manifest que Dependabot entende) | Não — HashiCorp não publica EOL formal de versão de CLI |
| `adot-layer` | `manual-release-review` (ARN com versão embutida em `.tfvars`, fora do alcance de qualquer ecossistema Dependabot) | Não — sem EOL formal publicado, mas tem changelog de CVE (já referenciado no achado de D-136 sobre a atualização de segurança 1-30-0→1-30-2) — revisão periódica cobre isso |
| `github-actions` | `dependabot-version-updates` | Não aplicável |
| `aws-sdk-v3` | `dependabot-version-updates` | Não |
| `ajv` | `dependabot-version-updates` | Não |
| `esbuild` | `dependabot-version-updates` | Não |

Isso fecha a lacuna: **nenhum item crítico fica sem entrada**, mas só `node`/`lambda-runtime` carregam `lifecycle` real, porque são os únicos com EOL oficial datado por linha — exatamente a distinção que a Rodada 3 pediu.

## Documentação final sobre cobertura do Dependabot (correção do item 5)

O standard declara explicitamente: **Dependabot descobre versão nova para dependências de pacote (npm, GitHub Actions, Terraform providers/módulos) — ele NÃO sabe que Node.js lançou uma nova linha LTS, que a AWS depreciou um runtime Lambda, ou que uma layer ADOT referenciada por ARN mudou de versão.** Esses 3 (`node`, `lambda-runtime`, `adot-layer`) dependem de `manual-release-review` — revisão humana periódica contra a fonte oficial, o próprio checker só valida que `verifiedAt` não está mais velho que a janela definida (ex. 6 meses), não que a descoberta seja automática para esses itens. Isso é uma limitação real e nomeada do modelo híbrido, não uma alegação de cobertura universal.

## Registro final (sem mudança do restante já fechado nas Rodadas 2-3)

`docs/engineering/dependency-freshness-standard.md`, `.github/dependabot.yml`, `scripts/check-dependency-freshness.ts` — design-only, implementação fica para sessão futura dedicada. Inclui corrigir a inconsistência real `ci.yml`/`cd.yml` (`terraform_version` hardcoded em 2 lugares em vez de uma fonte única) como parte da implementação do item `terraform-cli`.