# Wave B2B-10 — Round 2 Proposal (correções sobre os 2 achados bloqueantes, nota Codex 8,1/10)

## Correção 1 — a corrida real pós-`selectOrganization()` (achado bloqueante correto do Codex)

Aceito o achado: `organizationId` não é uma variável que o `queryFn` realmente usa (o browser nunca
a envia — `ApiClient` não manda `organizationId`, o BFF injeta `X-Organization-Id` a partir da
sessão server-side, `proxy-service.ts:52`). A garantia "TanStack Query refaz fetch automaticamente
quando a variável da chave muda" só vale quando essa variável É o input real do fetch — aqui o
input real é o COOKIE de sessão, que muda no servidor no momento do `POST /select`, ANTES do
cliente saber disso via `useActiveOrganization()`. Corrigido com um gate explícito, não mais
"a chave resolve sozinha":

```ts
// frontend/src/api/queryKeys.ts — inalterado da Rodada 1
// frontend/src/auth/useActiveOrganization.ts (novo)
export function useActiveOrganization() {
  const queryClient = useQueryClient();
  const sessionQuery = useQuery({ queryKey: ["session"], queryFn: fetchSessionInfo, staleTime: 0 });
  const [switching, setSwitching] = useState(false);

  const selectMutation = useMutation({
    mutationFn: (organizationId: string) => selectOrganization(organizationId),
    onMutate: async (newOrgId) => {
      setSwitching(true);
      const currentOrgId = sessionQuery.data?.activeOrganizationId;
      // Cancela QUALQUER fetch em voo escopado à organização atual — fecha exatamente a janela
      // que o Codex apontou: uma resposta que chegaria DEPOIS do servidor já ter trocado de
      // sessão, mas escrita sob a chave da organização ANTIGA.
      if (currentOrgId) await queryClient.cancelQueries({ queryKey: ["org", currentOrgId], exact: false });
    },
    onSettled: async () => {
      // Só volta a permitir fetch org-scoped depois que a PRÓPRIA sessão confirmar a troca —
      // nunca assume sucesso do POST como prova de que activeOrganizationId já mudou do lado
      // do cliente.
      await queryClient.invalidateQueries({ queryKey: ["session"] });
      setSwitching(false);
    },
  });

  return {
    organizationId: sessionQuery.data?.activeOrganizationId,
    switching,
    select: selectMutation.mutate,
  };
}
```

Todo hook org-scoped (`useItemsDashboard` etc., lista completa na Correção 2) ganha
`enabled: Boolean(organizationId) && !switching` — nenhuma query org-scoped roda enquanto
`switching` for verdadeiro, e qualquer uma que já estava em voo no momento da troca é cancelada
explicitamente (`cancelQueries`), não deixada para resolver sozinha. Fecha as 2 metades do achado:
nada NOVO é disparado durante a janela, e nada JÁ EM VOO sobrevive para gravar sob a chave errada.

## Correção 2 — inventário completo de query keys/invalidações (achado bloqueante correto do Codex)

Grep exaustivo (não confiar na lista parcial da Rodada 1) — `frontend/src` inteiro, 2 padrões
(`queryKey:\s*\[` e `invalidateQueries`):

**7 `useQuery` reais** (todas ganham `["org", organizationId, ...]` como prefixo via a factory):
`useItem.ts` (`["items","detail",itemId]`), `useItemsDashboard.ts` (`["items","dashboard",status]`),
`useSubject.ts` (`["subjects","detail",subjectId]`), `useSubjectsDashboard.ts`
(`["subjects","dashboard",status]`), `useRequirementAssignments.ts`
(`["subjects","requirements",subjectId]`), `useDocumentSubmissions.ts`
(`["subjects","submissions",subjectId,assignmentId]`), e `Overview.tsx`'s uso INLINE de
`["items","dashboard","ACTIVE"]` (achado extra da Rodada 2, não listado nem pelo Codex explicitamente
por nome de arquivo mas coberto pela mesma varredura — `Overview.tsx` não usa o hook
`useItemsDashboard`, duplica a chave à mão, por isso escapou da Rodada 1).

**5 `invalidateQueries` reais** (todas precisam do MESMO prefixo `["org", organizationId, ...]` para
invalidar a entrada certa — hoje invalidam uma chave sem organização, que deixará de existir):
`useCreateItem.ts`, `useRenewItem.ts` (2 chamadas), `useLinkExpirationItem.ts`,
`useUnlinkExpirationItem.ts`.

Todos os 12 call sites (7 leitura + 5 invalidação) precisam de `organizationId` — obtido de
`useActiveOrganization()` em cada hook, nunca lido de um contexto implícito/global mutável (mesmo
raciocínio de `organizationIdHint` obrigatório em B2B-6: tornar `organizationId` um parâmetro
explícito de cada hook, não uma variável de módulo, para que o TypeScript force cada call site a
declará-lo).

## Sem mudanças

Achado #1 (regressão `AuthContext`) e achado #2 (settings sem writer) confirmados pelo Codex,
mantidos como na Rodada 1. Separação `AuthContext`/`useActiveOrganization()` confirmada correta.
Ausência de escrita otimista confirmada correta (o Codex só pediu que o bloqueio de tráfego seja
explícito além disso, já incorporado na Correção 1). Classificação de risco por subitem mantida,
com o ajuste sugerido pelo Codex: B2B-10.5 (settings backend) sobe de nível 3 para **nível 4**
(writer novo real, não puro CRUD sobre padrão já idêntico) — não Type 1, protocolo completo
continua não aplicável a esse subitem.
