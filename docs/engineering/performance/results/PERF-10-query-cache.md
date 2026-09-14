# PERF-10 — Cache/freshness TanStack Query

Ciclo B do programa de performance (`docs/engineering/performance/TODO.md`). Objetivo: inventariar
todos os `useQuery`/`useInfiniteQuery` do frontend, classificá-los em 4 classes de freshness, aplicar
um `staleTime` consistente por classe, e revisar as invalidações de `useMutation` (broad demais /
faltando).

## Estado anterior

Quase nenhum hook tinha `staleTime` (default do TanStack Query = 0 → refetch a cada mount/foco).
Duas exceções deliberadas e já documentadas: `ActiveOrganizationContext.tsx` e `AuthContext.tsx`
compartilham `sessionQueryKey` com `staleTime: 30_000` (evita 2 chamadas a `/bff/session` quando os
dois providers montam poucos ms um do outro) — **mantidas como estão**, não fazem parte deste
inventário porque já eram uma decisão de cache deliberada e revisada.

## Classes e valores

Constantes centralizadas em `frontend/src/lib/queryConfig.ts` (`STALE_TIME`):

| Classe | Valor | Critério |
|---|---|---|
| `STATICISH` | 10 min | Catálogos que um OWNER/ADMIN edita raramente |
| `REFERENCE` | 2 min | Muda com atividade organizacional, não instante a instante |
| `OPERATIONAL` | 30 s | Dashboards/filas/busca — trabalho do dia a dia |
| `NEAR_REALTIME` | 0 | Tela que o usuário está ativamente observando mudar |

## Inventário completo

| Hook | Dado | Classe | staleTime |
|---|---|---|---|
| `useDocumentTypes` | Catálogo de tipos de documento | STATICISH | 10 min |
| `useDocumentType` | Detalhe de um tipo de documento | STATICISH | 10 min |
| `useRequirementTemplates` | Catálogo de templates | STATICISH | 10 min |
| `useRequirementTemplate` | Detalhe de um template | STATICISH | 10 min |
| `useOrganizationsList` | Organizações do usuário | STATICISH | 10 min |
| `useInvitations` | Convites pendentes | REFERENCE | 2 min |
| `useMembers` | Membros da organização | REFERENCE | 2 min |
| `useSubject` | Detalhe do fornecedor/subject | REFERENCE | 2 min |
| `useRequirementAssignment` | Detalhe de 1 vínculo (Snapshot) | REFERENCE | 2 min |
| `useDocumentRequestSeries` | Séries recorrentes | REFERENCE | 2 min |
| `useLegacyDocumentRequests` | Histórico de solicitações legadas | REFERENCE | 2 min |
| `useDocumentRequestDeliveryPreference` | Preferência de entrega (tenant-wide) | REFERENCE | 2 min |
| `useReportSubscriptions` | Assinaturas de relatório | REFERENCE | 2 min |
| `useStorageQuota` | Uso de armazenamento | REFERENCE | 2 min |
| `useSubjectsDashboard` | Dashboard de fornecedores | OPERATIONAL | 30 s |
| `useItemsDashboardBounded` | Overview de itens (bounded) | OPERATIONAL | 30 s |
| `useItemsDashboardPage` | Coleção de itens (paginada) | OPERATIONAL | 30 s |
| `useItem` | Detalhe de um item | OPERATIONAL | 30 s |
| `useDocuments` | Anexos de um item | OPERATIONAL | 30 s |
| `useDocumentSubmissions` | Submissões de evidência | OPERATIONAL | 30 s |
| `useDocumentChasingOccurrences` | Lembretes automáticos (timeline) | OPERATIONAL | 30 s |
| `useReviewQueue` | Fila de revisão (por estado) | OPERATIONAL | 30 s |
| `useRequirementsSearch` | Busca de requisitos (A11) | OPERATIONAL | 30 s |
| `useRequirementsForSubject` | Contagem de requisitos (A09) | OPERATIONAL | 30 s |
| `useRequirementAssignments` | Lista de vínculos de um subject | OPERATIONAL | 30 s |
| `useDocumentRequestsForSubject` | Solicitações avulsas/materializadas | OPERATIONAL | 30 s |
| `useSubjectCompliance` | Painel de compliance (A09) | OPERATIONAL | 30 s |
| `useActivity` | Feed de atividade | OPERATIONAL | 30 s |
| `useDocument` / `useDocumentVersions` | Detalhe/versões de documento | OPERATIONAL | 30 s |
| `useReminderPolicy` | Política de lembrete de um item | OPERATIONAL | 30 s |
| `useReportSubscriptionRuns` | Histórico de execuções (drill-down) | OPERATIONAL | 30 s |
| `useNotificationPreferences` | Preferências de notificação (próprias) | NEAR_REALTIME | 0 |
| `useImportJobSchema` | Schema inferido do import (wizard ativo) | NEAR_REALTIME | 0 |
| `useImportRowResults` | Drill-down por linha (wizard ativo) | NEAR_REALTIME | 0 |
| `useImportJob` | Progresso do job de import | NEAR_REALTIME | já usava `refetchInterval` (2s enquanto status transiente) — não alterado |
| `DossierExport.tsx` (`pollQuery`) | Status da geração do dossiê | NEAR_REALTIME | já usava `refetchInterval` (3s) — não alterado |

### Hooks deixados sem alteração (deliberado)

- `ActiveOrganizationContext.tsx` / `AuthContext.tsx` (`sessionQueryKey`, staleTime 30s) — decisão
  de cache já revisada e documentada nos próprios arquivos; mexer aqui estaria fora do escopo de
  "aplicar uma política" e entraria em um trade-off de auth já resolvido.
- `GuestDocumentRequest.tsx` (`sessionQuery`, `typesQuery`) e `LegacyGuestUpload.tsx`
  (`infoQuery`) — fluxos de convidado de página única, token de uso único; um `staleTime`
  não muda a experiência real (a página é visitada uma vez) e a query key nem inclui `organizationId`
  (não é tenant-scoped). Deixados no default (0) por serem ambíguos/fora do padrão do resto do app.
- `useCurrentMembershipRole` — não é um call site de `useQuery` próprio, deriva de
  `useOrganizationsList()` (já classificado STATICISH).

## Mutations — invalidação corrigida

A grande maioria das mutations já usava `queryClient.setQueryData` + invalidação precisa por
`queryKeys` (revisões Codex anteriores documentadas inline, ex.: `useDeprecateDocumentType`,
`useCreateMetadataField`, `useUpdateNotificationPreferences`). O sweep encontrou um problema real
de **invalidação faltando**, mascarado até agora porque `staleTime` era 0 em todo lugar (qualquer
remount refazia o fetch de qualquer forma) — com PERF-10 aplicando `staleTime` de minutos, esse
gap vira um bug de dado desatualizado visível de verdade:

- **`useCreateRequirement`, `useUpdateRequirement`, `useDeleteRequirement`** (`frontend/src/hooks/`)
  criam/editam/excluem um `Requirement` (A11) escopado a um `subjectId`, mas só invalidavam o
  índice de busca tenant-wide (`documentArchive/requirements/search`). O painel de Compliance do
  Subject (`useSubjectCompliance`) e o card "Requisitos documentais" (`useRequirementsForSubject`)
  leem o MESMO Requirement, por `subjectId` — nunca eram invalidados. **Antes**: criar/editar/excluir
  um requisito e voltar para o Hub do fornecedor podia mostrar compliance/contagem desatualizados
  até uma invalidação não relacionada acontecer. **Depois**: as 3 mutations agora também invalidam
  `queryKeys.documentArchive.subjectCompliance(orgId, subjectId)` e a query key de
  `useRequirementsForSubject`.
- **`useApplyTemplate`** já invalidava `subjects.requirements` e `subjectCompliance`, mas não o
  card de contagem (`useRequirementsForSubject`) — mesma correção aplicada (aplicar um template
  cria requisitos em lote, o card ficaria com a contagem antiga).

Nenhuma outra invalidação "broad demais" foi encontrada nas mutations revisadas (as mutations dos
módulos de DocumentType/RequirementTemplate/NotificationPreferences/Members/Series/DocumentRequests
já eram deliberadamente precisas, com comentários inline explicando por que evitam invalidar
prefixos compartilhados — ver `useDeprecateDocumentType.ts`/`useCreateMetadataField.ts` por
exemplo). `linkEvidence`/`unlinkEvidence` (`api/requirements.ts`) não têm hook algum consumindo-os
hoje — fora de escopo (não é um call site real).

## Verificação

- `npm run typecheck` — OK.
- `npm run lint` — OK (0 warnings).
- `npm test -- --run` — 407/407 testes unitários passando (50 arquivos).
- `npm run test:e2e` — 157/158 passando. A falha (`E2E-B9-03`, "VIEWER... read-only status only",
  `block9-csv-import.spec.ts:104`) é um `strict mode violation` do Playwright (o locator
  `getByText("Pré-visualizar e deduplicar")` casa com 3 elementos: o badge da etapa, o heading, e
  um `role="status"` escondido para leitor de tela) — **confirmado pré-existente**: reproduz
  identicamente com `git stash` (código sem as mudanças deste PERF-10). Não é uma regressão de
  cache/timing; é um seletor frágil já quebrado antes deste trabalho. Não corrigido aqui (fora do
  escopo de "cache/freshness").

## Arquivos alterados

- Novo: `frontend/src/lib/queryConfig.ts` (constantes `STALE_TIME`).
- 33 hooks em `frontend/src/hooks/` receberam `staleTime` (import de `STALE_TIME` + campo na
  chamada de `useQuery`/`useInfiniteQuery`).
- 4 hooks de mutation corrigidos por invalidação faltando: `useCreateRequirement.ts`,
  `useUpdateRequirement.ts`, `useDeleteRequirement.ts`, `useApplyTemplate.ts`.
