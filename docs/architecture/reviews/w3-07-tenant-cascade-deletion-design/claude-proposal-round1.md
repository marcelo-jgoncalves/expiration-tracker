# W3-07 — Mecanismo de cascata de exclusão física por tenant — Round 1 (Claude proposal)

> Type 1 (`change-risk-scale.md` nível 5-6), protocolo `AGENTS.md` §4, gate padrão 9.0/10.
> **Escopo explicitamente reduzido** (decisão do Marcelo, 2026-08-28): só o **mecanismo físico
> de descoberta+exclusão em cascata por `tenantId`**, reusando/generalizando o
> `DocumentPurgeWorker` (W3-06/D-061). **Fora de escopo aqui** (feature de produto maior,
> `pilot-readiness-program.md` já classifica assim): confirmação (≤15 dias), exportação
> (≤30 dias, JSON/CSV+documentos+manifesto), a state machine `DataSubjectRequest` completa,
> rotas HTTP, e o efeito de "bloqueio imediato" durante `HELD/PURGING` (exigiria um estado
> `HELD` reconhecido por toda rota de leitura de todo módulo — trabalho de produto real, não
> mecanismo). Este documento entrega só a capacidade: dado um `tenantId`, apagar fisicamente
> todos os seus dados de forma idempotente e auditável.

## 1. Problema

`pilot-readiness-program.md` (auditoria W3-07): a exclusão hoje é só um flip de status
independente por entidade (`deleteSubject`/`deleteItem`/`deleteDocument`/
`deleteRequirementAssignment`) — nenhum encadeia para entidades relacionadas. Não existe
mecanismo de descoberta tenant-wide nenhum. `privacy-lgpd.md` §3 exige, para o passo de
exclusão do DSR: "Inventário por tenantId em DynamoDB, S3, índices e provedores... purge
idempotente via GSI6".

## 2. Descoberta tenant-wide — por que Scan é a escolha certa aqui (diferente do W3-06)

Confirmado por leitura de `data-model.md` §1/§2: **toda entidade carrega `tenantId` como
atributo próprio** (não só embutido na PK) — convenção "atributos comuns a toda entidade" já
documentada. As únicas 3 exceções de chave tenantless (`IdentityMapping`,
`GuestTokenPointer`/`GuestTokenRateLimit`) também carregam `tenantId` como atributo "para
reconstrução de contexto pós-lookup" — confirmado em `data-model.md` linha 59. Logo, um único
`Scan` da tabela com `FilterExpression tenantId = :t` (paginado) descobre **toda** a superfície
de dados de um tenant, sem precisar enumerar tipos de entidade nem suas chaves físicas
distintas (`TENANT#t#ITEM#i`, `TENANT#t#SUBJECT#s`, `TENANT#t#IMPORTJOB#j`, `GUESTTOKEN#...`,
`IDENTITY#...`) uma por uma.

**Por que isso não repete o erro que W3-06 rejeitou** ("Scan geral... rejeitado" no design
anterior): lá o Scan seria um mecanismo de **polling contínuo** (rodando a cada N minutos para
sempre) — caro e desnecessário quando GSI6 já resolve o caso de uso recorrente. Aqui a
descoberta tenant-wide é um evento **raro e deliberado** (uma exclusão de conta é, na melhor das
hipóteses, um evento por tenant na vida do tenant, nunca um job recorrente) — o custo de um
Scan completo da tabela, pago uma vez por exclusão real, é aceitável e nenhum GSI plausível
evitaria essa característica (um GSI por `tenantId` sozinho teria a MESMA cardinalidade de
partição que o Scan já visita, sem ganho real, e criaria um índice novo cujo único propósito é
um evento raro — desproporcional).

## 3. Mecanismo proposto

1. **`TenantCascadeDeletionService.requestDeletion(tenantId)`** (novo, módulo novo
   `src/modules/tenant-deletion/` — deliberadamente não dentro de `document/` ou `expiration/`,
   já que atravessa todos os módulos): inicia um `Scan` paginado (`Limit` por página, cursor
   `ExclusiveStartKey`) filtrando `tenantId = :t`. Para cada página, `TransactWriteItems` em
   lotes de até 25 (limite real do DynamoDB) marcando cada linha com o mesmo par
   `GSI6PK/GSI6SK = WORKSTATE#PURGE_PENDING/<purgeAfter>#TENANT#<t>#<entityType>#<sk-derivado>`
   — **generalização direta do par já criado para `Document`/`DocumentPurgeReceipt`** em
   `document-store.ts`, movida para um local compartilhado (`src/shared/dynamodb/purge-gsi6.ts`)
   já que passa a ser usada por múltiplos módulos, não só `document`.
   - `purgeAfter` aqui é **imediato** (`now`, não os 30 dias do soft-delete individual) — uma
     exclusão de tenant já é a decisão final (LGPD art. 18, direito de eliminação), não reabre
     uma janela de arrependimento por entidade. Este é o ÚNICO ponto onde este mecanismo diverge
     do padrão "soft-delete + purgeAfter futuro" do resto do sistema — decisão explícita, não
     descuido.
   - `legalHold` (campo hoje só em `Document`, W3-06) precisa existir em qualquer entidade que
     este mecanismo tocar, OU o mecanismo verifica hold só no que já o tem (`Document`) e aceita
     que outras entidades não têm hold hoje (nenhuma tem, é um campo novo do W3-06) — **decisão
     proposta**: manter a condição `attribute_not_exists(legalHold) OR legalHold = :false` em
     TODAS as escritas deste mecanismo (não só `Document`), então qualquer entidade que ganhar
     `legalHold` no futuro já é respeitada por este mecanismo sem mudança nenhuma nele.
2. **Generalização do `DocumentPurgeWorker` → `EntityPurgeWorker`** (renomeado, ou mantido como
   está mas com um terceiro branch): candidatos com `entityType` fora de
   `{Document, DocumentPurgeReceipt}` seguem um caminho **genérico, sem S3**: claim (mesma
   `extraCondition` de fence) → `Delete` direto, sem chamada a `DocumentObjectStore`. Documentos
   (`entityType === "Document"`) continuam pelo caminho já existente (apaga o objeto S3 real
   antes do `Delete`). **Nenhuma mudança no branch `Document` existente.**
3. **Sem novo estado terminal `STUCK` genérico ainda** — reusa o já existente (`purgeAttempts`/
   `purgeStatus: "STUCK"`), mas como campo genérico gravado por este mecanismo em qualquer
   entidade (não exige que o tipo já tivesse esses campos — são atributos DynamoDB soltos,
   schemaless por natureza, presentes só nas linhas que passaram por este mecanismo).
4. **Idempotência do próprio `requestDeletion`**: um `TenantDeletionRequest` (novo, pequeno)
   registra `tenantId`/`requestedAt`/`status: "DISCOVERING"|"COMPLETED"`/`lastScanCursor` —
   permite retomar um Scan interrompido (Lambda timeout, crash) do cursor exato em vez de
   recomeçar do zero, e serve de tombstone auditável de que a exclusão foi solicitada e
   concluída (sem reter nenhum dado do tenant em si).

## 4. Fora de escopo, explicitamente

- Bloqueio imediato de uso (exigiria checar um estado `HELD` em toda `authorize()`/leitura de
  todo módulo — produto, não mecanismo).
- Revogação de canais/links externos (WhatsApp/e-mail/tokens de guest ainda válidos) — precisa
  de lógica por canal, não genérica.
- Provedores externos (SES/Textract/Bedrock não retêm dado nosso por design — confirmar isso é
  tarefa de auditoria de subprocessadores, `privacy-lgpd.md` §5, não deste mecanismo).
- Rota HTTP / autorização de quem pode chamar `requestDeletion` — este documento entrega a
  capacidade programática; quem a invoca (admin interno, futura rota DSR) é decisão de W3-07
  completo, não deste mecanismo.

## 5. Pergunta para Rodada B (Codex)

(a) O Scan tenant-wide como evento raro é uma escolha defensável, ou existe um argumento real
contra mesmo nesse regime de uso? (b) A generalização do worker para um terceiro branch
"genérico sem S3" introduz algum risco que o branch `Document` não tem? (c) `purgeAfter`
imediato (sem os 30 dias) para exclusão de tenant é coerente com `privacy-lgpd.md`, ou falta
alguma salvaguarda (ex.: um período de confirmação antes do Scan sequer começar)?
