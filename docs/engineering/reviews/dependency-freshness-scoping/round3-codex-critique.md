## Parecer Codex — Rodada 3

**Nota: 8,8/10 — ainda não atinge o gate de 9,0.**

As cinco correções anteriores foram incorporadas adequadamente. Também confirmei no repositório:

- Node 24 alinhado em `.nvmrc`, `package.json` e no bloco raiz de `package-lock.json:48`.
- Lambda em `nodejs24.x` em `infra/modules/lambda-function/variables.tf:40`.
- 22 módulos com `versions.tf` e lockfiles correspondentes.
- A inconsistência real entre `.github/workflows/ci.yml:221` e `.github/workflows/cd.yml:47`.

### Bloqueante remanescente

A afirmação **“Dependabot cobre 100% dos itens críticos”** não é verdadeira para a cobertura apresentada.

Dependabot cobre os ecossistemas npm, GitHub Actions e Terraform providers/modules. Ele não descobre diretamente:

- nova linha do Node;
- depreciação do runtime Lambda;
- versão do Terraform CLI passada como `terraform_version`;
- versão ADOT embutida em ARN de `tfvars`.

Além disso, os itens sem `FreshnessPolicyEntry` — GitHub Actions, AWS SDK, Ajv e esbuild — não possuem no formato proposto um lugar verificável para `owner`, `officialSource` e `discoveryMechanism`. Portanto, o gate “nenhum item crítico sem owner/fonte/descoberta” ainda não é executável para todos os itens.

Há uma segunda incompatibilidade: `supportEndsAt` obrigatório pressupõe uma data ISO oficial. Node e Lambda acomodam isso; Terraform CLI, `hashicorp/aws` e possivelmente ADOT não necessariamente publicam EOL por linha no mesmo formato. Não se deve inventar uma data para satisfazer o schema.

### Correção necessária para a Rodada 4

Separar inventário crítico de política de lifecycle:

```ts
interface CriticalDependencyEntry {
  id: string;
  detectedFrom: string[];
  owner: "marcelo";
  officialSource: string;
  discoveryMechanism:
    | "dependabot-version-updates"
    | "curated-lifecycle-review"
    | "manual-release-review";
  lifecycle?: {
    supportedLine: string;
    supportEndsAt: string;
    verifiedAt: string;
  };
}
```

Regras:

1. Todo item crítico possui `CriticalDependencyEntry`.
2. `lifecycle` existe somente quando há EOL oficial e datado.
3. O checker valida linha versus lifecycle quando `lifecycle` existir.
4. Para itens sem EOL datado, registra e valida mecanismo de revisão — sem fabricar `supportEndsAt`.
5. A documentação declara precisamente quais itens o Dependabot cobre, em vez de alegar cobertura universal.

Com essa separação, a proposta preserva toda a solução da Rodada 3 e fecha o último problema estrutural. Nenhuma implementação foi realizada, respeitando o escopo design-only.
