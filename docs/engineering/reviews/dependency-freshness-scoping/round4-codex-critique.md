codex
A correção fecha a distinção conceitual central, mas ainda resta uma inconsistência estrutural bloqueante:

- `verifiedAt` existe apenas dentro de `lifecycle`.
- A regra 4 exige validar a revisão periódica de itens sem `lifecycle`.
- Portanto, `hashicorp-aws`, `terraform-cli` e `adot-layer` não têm campo no qual registrar essa revisão. O checker proposto não conseguiria aplicar a própria regra.

Além disso, `hashicorp-aws` possui um único `discoveryMechanism: "dependabot-version-updates"`, enquanto o texto atribui a ele também uma revisão manual residual. O modelo atual não representa essa segunda garantia.

Emenda mínima necessária:

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
  reviewedAt: string;
  lifecycle?: {
    supportedLine: string;
    supportEndsAt: string;
    verifiedAt: string;
  };
}
```

Com isso:

- `reviewedAt` prova a revisão periódica de qualquer entrada crítica;
- `lifecycle.verifiedAt` prova especificamente quando a informação oficial de suporte/EOL foi verificada;
- o checker pode cobrar a janela de seis meses sem inventar EOL;
- Dependabot continua sendo o mecanismo primário de descoberta onde aplicável, enquanto `reviewedAt` registra a supervisão residual sem exigir um segundo valor em `discoveryMechanism`.

O inventário e a descrição dos limites do Dependabot estão corretos. Não identifico outro problema material, mas a proposta ainda não pode ser considerada fechada enquanto a regra de revisão dos itens sem lifecycle for impossível de representar no schema.

