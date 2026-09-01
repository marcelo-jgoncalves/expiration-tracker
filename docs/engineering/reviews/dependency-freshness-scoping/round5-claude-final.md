# Rodada 5 — Fechamento Claude — Padrão de Frescor de Dependências/Runtime/Linguagem

Aceito a emenda mínima exatamente como proposta — adiciono `reviewedAt: string` de nível superior, presente em TODA `CriticalDependencyEntry` independente de ter `lifecycle` ou não:

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
  reviewedAt: string;              // ISO date - última vez que um humano confirmou owner/fonte/mecanismo ainda válidos, TODA entrada tem isso
  lifecycle?: {
    supportedLine: string;
    supportEndsAt: string;
    verifiedAt: string;            // ISO date - especificamente quando o EOL/suporte oficial foi confirmado na fonte, só existe com lifecycle
  };
}
```

Isso resolve exatamente o que foi apontado: `reviewedAt` prova revisão periódica para QUALQUER entrada (inclusive `hashicorp-aws`/`terraform-cli`/`adot-layer`, que não têm `lifecycle`), e `lifecycle.verifiedAt` continua provando especificamente a confirmação de EOL/suporte quando aplicável — os dois campos respondem perguntas diferentes e nenhum é redundante com o outro. O checker aplica a janela de 6/12 meses sobre `reviewedAt` para todo item, e adicionalmente sobre `lifecycle.verifiedAt`/`supportEndsAt` só para os itens que têm `lifecycle`.

`hashicorp-aws` mantém `discoveryMechanism: "dependabot-version-updates"` como mecanismo primário — `reviewedAt` é a supervisão residual (confirma que Dependabot continua ativo e que o item ainda faz sentido classificado assim), não um segundo mecanismo de descoberta, exatamente como o parecer descreveu.

Nenhuma outra mudança em relação à Rodada 4 — inventário crítico, distinção Dependabot-cobre-vs-não-cobre, e o restante fechado nas Rodadas 2-3 permanecem intactos.