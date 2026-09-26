---
status: proposta Rodada 1 (protocolo Claude↔Codex, AGENTS.md §4)
owner: Marcelo (decisão final de produto já sinalizada: suspeita que A10 não faz mais sentido)
authority: proposta, não normativa
---

# Proposta — retirada do "Rastreamento legado" (A10) + escolha de forma de entrega no momento da solicitação

Pedido de Marcelo (2026-09-25, sessão de port das telas `prototype/novasTelas`): (1) decidir se o
"Rastreamento legado" (A10, `Tracking.tsx`) ainda faz sentido no produto — ele suspeita que não; se
não fizer, retirá-lo; (2) sobrepor a preferência tenant-wide de entrega de solicitação (A22) com uma
escolha por solicitação, feita pelo operador no momento de criar a solicitação.

**Pesquisa externa considerada: NÃO** (motivo: ambas as sub-decisões são internas a este projeto —
qual dos dois mecanismos de rastreamento de conformidade deste domínio específico continua a fonte
de verdade, e como um parâmetro que o backend já aceita [`initialInviteDelivery`] é exposto num
formulário já existente. Nenhuma das duas depende de "o que produtos SaaS estabelecidos fazem aqui"
— não há um padrão de mercado de "como uma empresa modela conformidade documental de fornecedor"
comparável a RBAC/invite/sessão a pesquisar; é puramente como ESTE projeto organiza seu próprio
modelo de dados, critério de `research-protocol.md` §"Regra prática para a linha divisória").

## Nível de risco

Nível 6 (`change-risk-scale.md`) para a Decisão A — retira um domínio de dados inteiro
(`RequirementAssignment`), não é reversível sem recriar código já deletado. Nível 3-4 para a
Decisão B isoladamente (expõe um parâmetro que o backend já tem) — incluída na mesma rodada a
pedido explícito de Marcelo, por tocar a mesma superfície de tela (A14/`SubjectRequests.tsx`).

## Decisão A — retirar A10 por completo

### Estado real hoje (verificado por leitura direta do código, não por suposição)

`RequirementAssignment` (`src/modules/subject/domain/requirement-assignment.ts`) é o modelo de
conformidade do **M9** (comentário do próprio `requirement-service.ts:1-7`: *"o único ciclo de vida
implementado é MISSING <-> SATISFIED, via link/unlink manual de um ExpirationItem já existente"*).
O **M10+** introduziu um segundo modelo de conformidade, completo e paralelo:
`Requirement`/`RequirementStatus` (`src/modules/document-archive/domain/requirement.ts`), com status
`MISSING | PENDING | SATISFIED | NOT_SATISFIED | NOT_APPLICABLE` **derivado automaticamente** de
`evidenceVersionId` + `validUntil` do `DocumentVersion` vinculado (`deriveRequirementStatus`,
`requirement.ts:182-208`) — não depende de ninguém marcar manualmente "satisfeito".

Três capacidades de A10 (`Tracking.tsx`), verificadas uma a uma:

1. **CRUD de `RequirementAssignment`** (assign/editar/excluir, status manual MISSING/SATISFIED) —
   modelo totalmente substituído pelo `Requirement` derivado do M10+. Nenhum consumidor externo
   depende do status manual: o único outro lugar do backend que lê `RequirementAssignment` é o
   próprio worker de chasing (`document-chasing-dispatch/dispatch.ts:135`), que só o usa para
   resolver o `DocumentRequest` associado — não para decidir nada a partir do `status` MISSING/
   SATISFIED em si.
2. **Vincular/desvincular um `ExpirationItem` existente como prova** (`requirement-service.ts:152-
   221`) — capacidade genuinamente sem equivalente na tela nova (`RequirementDetail.tsx` não
   referencia `ExpirationItem` em nenhum lugar; grep confirmado, 0 ocorrências). É a única parte de
   A10 que não é pura duplicação.
3. **Criar/revogar um `DocumentRequest`** a partir do assignment (`useCreateLegacyDocumentRequest`/
   `useRevokeLegacyDocumentRequest`, botão "Solicitar documento" em `Tracking.tsx:642`) — chama o
   **mesmo** `DocumentRequestService.createDocumentRequest()` que A14 usa (confirmado: só 1
   ocorrência de "Legacy" em `src/modules/subject/**`, nenhuma entidade backend distinta), só que
   por uma rota HTTP escopada por `assignmentId`
   (`/subjects/{subjectId}/requirements/{assignmentId}/document-requests`, comentário de cabeçalho
   de `document-request-handlers.ts:1`) em vez de subject+requirement. **Isso é 100% duplicação
   funcional de A14** — dois pontos de entrada de UI para criar a mesma linha de dado, sem nenhuma
   diferença de comportamento a não ser qual assinatura de rota chega até o service.

O guest upload legado (G01, `LegacyGuestUpload.tsx`, rota `guest/document-requests/:token`) só é
alcançado por um `DocumentRequest` criado pelo caminho (3) acima — se (3) some, G01 fica
inalcançável para solicitações novas (continua servindo qualquer `DocumentRequest` legado que já
exista em `dev`, até esses dados serem naturalmente resolvidos/expirados ou o ambiente ser resetado
— sem risco de produção real, `AGENTS.md` §1).

### Proposta concreta

Retirar por completo: tela `Tracking.tsx` (A10), seu card no `SubjectHub.tsx` ("Rastreamento
legado"), os hooks/rotas frontend dedicados (`use{Assign,Update,Delete}RequirementAssignment`,
`use{Link,Unlink}ExpirationItem`, `useCreate/RevokeLegacyDocumentRequest`,
`useLegacyDocumentRequests`), a rota HTTP `assignmentId`-scoped de criação de `DocumentRequest`
backend (`document-request-handlers.ts`, mantendo só a rota subject+requirement que A14 usa), o
serviço `RequirementService`/domínio `RequirementAssignment` inteiro (`requirement-service.ts`,
`requirement-assignment.ts`), e a rota G01/`LegacyGuestUpload.tsx` (guest upload de um passo só) —
consolidando 100% do fluxo de conformidade em `Requirement` (M10+, auto-derivado) + A14
(`SubjectRequests.tsx`, `Solicitações e recorrência`) + G02 (`GuestDocumentRequest.tsx`).

**O que se perde de fato, nomeado explicitamente (nunca escondido)**: a capacidade de vincular um
`ExpirationItem` já existente como prova de conformidade de um requisito, sem passar por upload real
de documento. Não há decisão de produto registrada em `decisions-log.md`/`ARCHITECTURE.md` que
declare essa capacidade necessária daqui em diante — é uma pergunta de produto genuína para Marcelo
decidir nesta própria rodada de protocolo (não algo que Claude/Codex decidem sozinhos): se o produto
ainda quer permitir "meu vencimento já rastreado É minha prova documental de X", isso precisa de um
desenho novo dentro do modelo `Requirement` atual (ex. um `evidenceSource` alternativo a upload), não
uma ressureição de A10. Sem esse sinal, a proposta assume que não é necessário, porque nenhum
documento de arquitetura/roadmap já revisado (`docs/architecture/README.md`,
`docs/frontend/README.md`) menciona essa capacidade como requisito vivo.

## Decisão B — escolha de entrega por solicitação

`createDocumentRequest` (`document-request-service.ts:92-105`) já aceita
`input.initialInviteDelivery?: InitialInviteDeliveryOverride` (`"DEFAULT" | "MANUAL" | "EMAIL"`,
`document-request-delivery-preference.ts:18`), resolvido via `resolveInitialInviteDeliveryMode({
override, tenantDefault })` — o backend já suporta a sobreposição por solicitação, só o frontend
nunca a expõe (`frontend/src/api/documentRequests.ts` não inclui o campo no payload de criação).

Proposta: o formulário "Solicitar documento" de `SubjectRequests.tsx` (A14) ganha um campo opcional
"Como enviar" (`RadioGroup`, mesmo padrão já usado em `RequestDeliverySettings.tsx`) com 3 opções —
"Usar padrão da organização" (equivalente a omitir o campo / `DEFAULT`), "Entrega manual", "E-mail
automático" — default selecionado = padrão da organização (lido de
`useDocumentRequestDeliveryPreference`, já buscado nesta tela hoje). A22 (`RequestDeliverySettings`)
permanece como está, sem mudança — continua sendo o valor-padrão que o operador pode sobrepor.

## Pontos de decisão de produto (Marcelo, não Claude/Codex sozinhos)

1. A capacidade de vincular um `ExpirationItem` como prova de conformidade (item único de A10 sem
   equivalente) precisa de um substituto dentro do modelo `Requirement` atual, ou pode ser
   descartada sem substituto?
2. Confirma a retirada completa (frontend+backend+G01), não só ocultar a tela do menu?

Este documento não avança para implementação até essas respostas — mesmo padrão de
`reminder-default-local-time/PROPOSAL.md`.
