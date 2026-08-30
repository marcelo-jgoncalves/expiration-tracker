# Wave B2B-10 — Round 3 Proposal (2 achados bloqueantes reais da Rodada 2, nota Codex 8,7/10)

## Correção 1 — `AbortSignal` real precisa ser propagado, não só aceito pelo `ApiClient`

Confirmado por leitura: `ApiClient.request()` já encadeia `options.signal` no `AbortController`
interno (`client.ts:81`), mas os wrappers de leitura (`api/items.ts`'s `fetchDashboard`/`fetchItem`,
e o equivalente em `api/subjects.ts`) não aceitam nem repassam `signal` nenhum hoje — `cancelQueries()`
sozinho não aborta um `fetch()` que nunca recebeu o sinal. Corrigido especificando o contrato
ponta-a-ponta, não só a camada de baixo:

```ts
// api/items.ts — TODA função de leitura ganha um 2º parâmetro opcional
export function fetchDashboard(status: ExpirationItemStatus, options?: { signal?: AbortSignal }): Promise<DashboardResponse> {
  return apiClient.get<DashboardResponse>(`/items/dashboard?status=${encodeURIComponent(status)}`, { signal: options?.signal });
}
```

```ts
// hooks/useItemsDashboard.ts — queryFn recebe o QueryFunctionContext do próprio TanStack,
// nunca ignora o `signal` que ele já fornece de graça
export function useItemsDashboard(status: ExpirationItemStatus) {
  const { organizationId, switching } = useActiveOrganization();
  return useQuery<DashboardResponse, unknown>({
    queryKey: queryKeys.items.dashboard(organizationId!, status),
    queryFn: ({ signal }) => fetchDashboard(status, { signal }),
    enabled: Boolean(organizationId) && !switching,
    retry: retryPolicyFor("safe-read"),
  });
}
```

Mesma mudança nos 7 call sites de leitura do inventário da Rodada 2 (`api/items.ts`'s 2 funções,
`api/subjects.ts`'s equivalentes) — `queryFn` sempre desestrutura `{ signal }` do primeiro argumento
que o próprio `useQuery` já passa, nunca uma arrow function de aridade zero que descarta essa
informação (o bug real: `queryFn: () => fetchDashboard(status)` de hoje joga fora o `signal` antes
mesmo de `fetchDashboard` poder usá-lo). Com isso, `cancelQueries()` na Correção 1 da Rodada 2 aborta
o `fetch()` real de verdade, fechando a lacuna que o Codex apontou.

## Correção 2 — `ActiveOrganizationProvider` único (Context), não múltiplas instâncias de hook

Aceito o achado: `useActiveOrganization()` como um hook chamado independentemente por cada tela
criaria N cópias do `useState("switching")`, desincronizadas entre si — o switcher marcaria
`switching=true` na SUA instância, mas os hooks de dashboard/detail em outras árvores de componente
nunca veriam essa mudança. Corrigido especificando o Provider explicitamente no design, não deixando
para uma decisão de implementação:

```tsx
// auth/ActiveOrganizationContext.tsx (novo)
const ActiveOrganizationContext = createContext<ActiveOrganizationValue | undefined>(undefined);

export function ActiveOrganizationProvider({ children }: { children: ReactNode }) {
  // TODA a lógica da Rodada 2 (sessionQuery, selectMutation com onMutate/onSettled) mora AQUI,
  // uma única vez — nunca dentro do hook consumidor.
  const value = useActiveOrganizationInternal();
  return <ActiveOrganizationContext.Provider value={value}>{children}</ActiveOrganizationContext.Provider>;
}

export function useActiveOrganization(): ActiveOrganizationValue {
  const ctx = useContext(ActiveOrganizationContext);
  if (!ctx) throw new Error("useActiveOrganization must be used within an ActiveOrganizationProvider.");
  return ctx;
}
```

Montado em `App.tsx` DENTRO de `AuthProvider` mas FORA/acima de `AppShell`/`Routes` (mesmo nível
estrutural de `AuthProvider`, já que toda tela protegida precisa dele) — `ProtectedRoute` continua
decidindo só autenticação; a organização ativa é uma segunda camada de contexto abaixo dela, nunca
misturada com `AuthState` (decisão já confirmada correta pelo Codex na Rodada 1, mantida).

## Sem mudanças

Achados #1/#2 (regressão `AuthContext`, settings sem writer), inventário de 7+5 call sites, e o
mecanismo de cancelamento em si (`onMutate`/`onSettled`) permanecem como fechados na Rodada 2 — as
2 correções desta rodada são precisão de especificação (garantir que os mecanismos já corretos em
princípio são realmente ponta-a-ponta), não mudança de direção.
