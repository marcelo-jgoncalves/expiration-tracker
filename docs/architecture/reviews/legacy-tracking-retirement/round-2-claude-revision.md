---
status: proposta Rodada 2 (tréplica) do protocolo Claude↔Codex
owner: Marcelo (decisão final)
authority: proposta, não normativa
---

# Rodada 2 — correção da proposta após crítica do Codex (5,8/10 NEEDS FIXES)

A Rodada 1 (`round-1-claude-proposal.md`) tinha duas premissas falsas, ambas confirmadas erradas
pela crítica do Codex (`round-1-codex-output.txt`, Pontos 3 e 5) por leitura direta do código:

1. O caminho legado (`DocumentRequestService`, módulo `subject`) e o caminho de A14
   (`DocumentArchiveService`, módulo `document-archive`) **não são o mesmo serviço nem a mesma
   entidade persistida** — chaves diferentes (`REQASSIGN#{assignmentId}#DOCREQ#{id}` vs.
   `DOCREQUEST#{id}`), handlers diferentes, comportamento diferente (legado tenta e-mail
   síncrono na criação e retorna `guestToken`; A14 é assíncrono via outbox, nunca retorna token).
2. `initialInviteDelivery` só existe no serviço legado. O schema HTTP de A14
   (`docarchive-request-create-request.v1.json`) não tem esse campo, o serviço de A14
   (`document-archive-service.ts:1184`) não tem esse parâmetro, e **confirmei agora, por leitura
   direta, que o worker assíncrono que A14 realmente usa
   (`src/workers/guest-credential-delivery/deliver.ts:98-108`) não tem NENHUM conceito de
   `DeliveryMode` — ele só verifica `recipientEmail` presente/ausente e tenta e-mail
   incondicionalmente se presente.** Achado novo, não estava na Rodada 1: **a preferência
   tenant-wide de A22 (`RequestDeliverySettings.tsx`) hoje não tem NENHUM efeito sobre A14** — só
   afeta o caminho legado. A22 está desconectada do único fluxo que continuaria existindo se A10
   for retirado hoje, sem nenhuma mudança de código.

Isso muda a Decisão B de "expor um campo que já existe" para "desenhar e implementar a capacidade
de verdade no pipeline que A14 realmente usa" — concordo com o mínimo Nível 5 do Codex, não 3-4.

## Decisão A — inventário corrigido (F2 do Codex)

Aceito o inventário do Codex como a lista real de escopo, verificada:

**Retirar junto (vertical completa do módulo `subject` ligada a A10/DocumentRequest legado)**:
`RequirementService` + `requirement-assignment.ts`; `DocumentRequestService` (módulo `subject`,
distinto do de `document-archive`) + `document-request.ts`; `GuestSubmissionService` +
`document-submission.ts`; a família de chasing ligada a `assignmentId` (`document-chasing.ts`,
workers `submission-finalizer`, `submission-malware-result`); rotas de
`subjects-handler.ts:120-136` que roteiam essas famílias; composição em
`runtime/aws/composition/subject.ts:46,72,94`; telas `Tracking.tsx` (A10) e `LegacyGuestUpload.tsx`
(G01); os hooks/rotas frontend já listados na Rodada 1.

**Precisa de destino explícito, não desaparece com o resto**: `RequestDeliverySettings.tsx` (A22) —
seus handlers hoje só existem em `document-request-handlers.ts:58-74`, que pertence ao
`DocumentRequestService` sendo retirado. Como o achado acima já mostra que A22 não afeta A14 hoje
de qualquer forma, a proposta é: **a preferência tenant-wide migra de dono** — sai de
`DocumentRequestService`/módulo `subject` e passa a viver no módulo `document-archive` (nova rota
`GET/PUT /document-archive/requirement-delivery-preference` ou equivalente), como parte do mesmo
trabalho da Decisão B abaixo (as duas decisões convergem no mesmo pipeline de qualquer forma).
`TrackedSubject`/`ExpirationItem` continuam intocados — nenhuma mudança ali.

**Preservado, não retirado**: `Requirement`/`DocumentArchiveService`/A14/A22(migrada)/G02 — o
modelo M10+ inteiro.

## Decisão B — redesenho sobre o pipeline real

Proposta revisada, escopada para ser honesta sobre o que cada modo exige:

1. `docarchive-request-create-request.v1.json` ganha `initialInviteDelivery?: "DEFAULT" |
   "MANUAL" | "EMAIL"` (mesmo domínio de `document-request-delivery-preference.ts`, que é lógica
   pura sem I/O — reaproveitável pelo módulo `document-archive` sem violar fronteira de módulo,
   a confirmar contra `dependency-cruiser` na implementação real, não assumido aqui).
2. `DocumentArchiveService.createDocumentRequest` resolve o modo (override → preferência
   tenant-wide já migrada → `MANUAL`) e grava o resultado no próprio `DocumentRequest` (novo campo
   persistido, não só um parâmetro transiente) — o outbox/worker de entrega
   (`guest-credential-delivery/deliver.ts`) passa a checar esse campo: `EMAIL` tenta o envio como
   hoje; `MANUAL` pula o envio deliberadamente (novo `kind: "SKIPPED_MANUAL_DELIVERY"`, distinto do
   atual `SKIPPED_NO_RECIPIENT_EMAIL` — a causa é diferente e não deve ser confundida na
   observabilidade).
3. **Pergunta em aberto que a Rodada 1 escondeu (F1 do Codex) e que não resolvo sozinho nesta
   rodada**: com `MANUAL`, como o operador obtém o link de verdade? Hoje só A10 sabe montar/mostrar
   esse link (`Tracking.tsx:515-516,555-557`), porque só o caminho legado retorna `guestToken` na
   criação. A14/`document-archive-handlers.ts` nunca retorna token — e o cabeçalho de
   `RequestDeliverySettings.tsx:19-25` documenta que isso é deliberado (D-146, estado de entrega
   isolado do lado tenant). Duas opções, nenhuma decidida aqui: (a) `MANUAL` em A14 devolve o
   `guestToken`/link na resposta de criação, mesma exceção pontual que D-267 já abriu para o
   legado — precisa de revisão de segurança própria, porque expande a fronteira que D-146
   estabeleceu; (b) `MANUAL` não devolve link nenhum nesta primeira versão — só suprime o envio
   automático, e obter o link fica como gap nomeado (mesmo gap que já existe hoje para A14, não
   criado por esta mudança), até uma decisão de produto/segurança dedicada. **Recomendo (b)** para
   esta rodada — não abrir uma exceção de segurança nova (D-146) dentro de uma tréplica que já está
   corrigindo duas premissas erradas; abrir isso como pendência nomeada para um protocolo próprio,
   se Marcelo confirmar que quer a opção (a).

## Nível de risco (revisado)

Decisão A: Nível 6, mantido — concordo com a razão do Codex (recomposição de domínio e
integrações, não "irreversibilidade" per se, já que git recupera código). Segue exigindo protocolo
completo + ADR formal (`docs/architecture/adr/`) + atualização de `decisions-log.md`.

Decisão B: Nível 5 (mudança de contrato HTTP + novo campo persistido + novo branch no worker de
entrega), não 3-4. Se a opção (a) acima (retornar link em `MANUAL`) for confirmada por Marcelo no
futuro, essa sub-decisão especificamente sobe a Nível 6 e precisa de rodada própria — não incluída
no escopo desta.

**Pesquisa externa considerada: NÃO**, mantido para o escopo revisado (B com a opção (b) — suprimir
envio automático, sem expor link). Se a opção (a) for adotada depois, reavaliar como `SIM PARCIAL`
nessa rodada futura (emissão de link/token acessível ao operador é adjacente a padrões de
magic-link que valeria checar OWASP/NN-g antes de desenhar, concordando com o alerta do Codex em
"Segurança/AppSec").

## Respostas às perguntas de produto (não decido por Marcelo, só registro minha posição)

Concordo com as duas recomendações técnicas do Codex: (1) descartar o vínculo com `ExpirationItem`
sem substituto por antecipação, condicionado à confirmação de Marcelo de que "evidência sem
documento" não é caso necessário — o vínculo antigo só provava existência do item no tenant, nunca
validade documental; (2) retirada completa (não ocultar), incluindo G01, com o inventário corrigido
acima e destino explícito para A22.

## Pendências nomeadas explicitamente (F3/F4 do Codex, não resolvidas nesta rodada)

Capacidades de A10 sem decisão ainda: link manual imediato com fallback de e-mail; revogação
individual de uma solicitação (A14 não tem equivalente); timeline de chasing por solicitação
avulsa (A14 tem recorrência de série, não é a mesma coisa). Proposta: matriz explícita
manter/abandonar/adiar por item, a ser fechada com Marcelo antes da implementação — não assumido
aqui como "recorrência resolve tudo".

Critérios de saída (F4): nomeados para a implementação futura, não repetidos aqui — ficam no ADR
formal exigido pelo Nível 6 quando a decisão fechar.
