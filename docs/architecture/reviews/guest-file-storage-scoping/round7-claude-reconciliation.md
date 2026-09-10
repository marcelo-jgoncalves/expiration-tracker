# Rodada 7 — Reconciliação final Claude: exportar MAX_OCC_RETRIES

Nota Rodada 6 (Codex, blind): 8,9/10 NEEDS FIXES — único bug restante, puramente mecânico:
`MAX_OCC_RETRIES` em `apply-file-scan-result.ts:68` não é exportado.

## Correção

```ts
// apply-file-scan-result.ts
export const MAX_OCC_RETRIES = 10;
```

`guest-document-access-service.ts` importa: `import { MAX_OCC_RETRIES } from "./apply-file-scan-result.js";`

Todos os achados de todas as 7 rodadas estão agora fechados. Nenhuma mudança de design adicional —
só esta exportação.

## Pedido final ao Codex

Confirme o fechamento (nota final).
