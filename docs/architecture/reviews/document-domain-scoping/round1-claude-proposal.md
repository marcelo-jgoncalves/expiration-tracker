# Document Domain — Rodada 1 (Proposta Claude)

Base: `docs/frontend/document-domain-{functional-planning,functional-decisions,functional-specification-v0.1,journeys-and-acceptance-criteria-v0.2,wireframes,wireframes-validation-plan}.md` (todos lidos/analisados nesta sessão) + pesquisa externa registrada abaixo. Escopo desta rodada: arquitetura técnica/modelo de dados que implementa D1–D10 e C1–C6 já `APROVADO` como direção funcional — não reabre decisão de produto.

## E-014 — Declaração de pesquisa externa

**SIM** para as decisões 2 (versionamento current/superseded) e 4 (guest access/magic link); **SIM PARCIAL** para 1, 3, 5, 7, 8; **NÃO** para 6 e 9 (específicas deste domínio/produto, sem padrão externo direto). Fontes com URL/data: MongoDB Document Versioning Pattern (mongodb.com, 2026-08-31), Azure Cosmos DB design patterns pt.5 (devblogs.microsoft.com, 2026-08-31), Ironclad Contract Version Control (ironcladapp.com, 2026-08-31), CalHFA MAS Status Codes PDF (calhfa.ca.gov, 2026-08-31), Superdocu/Intake KYC document checklist (superdocu.com/intakerequest.com, 2026-08-31), magic-link security deep dive (guptadeepak.com, 2026-08-31) + SuperTokens (supertokens.com, 2026-08-31), V-Comply compliance tracking guide (v-comply.com, 2026-08-31), M-Files/DocuXplorer folderless DMS (m-files.com/docuxplorer.com, 2026-08-31).

## Decisão 1 — Formato dos state machines (Document/Version/Requirement/Request) e resolução da ambiguidade J1×J8

**Proposta**: adotar o conjunto de estados exatamente como `functional-specification-v0.1.md` §6–§11 define, com uma correção: upload interno **sempre** passa por `RECEIVED` (mesmo que efêmero, no mesmo request/transação), nunca pula direto para `ACCEPTED`. A UI pode comprimir a experiência ("Enviar e aceitar" como uma única ação do usuário, per C3 já aprovado), mas o dado percorre `RECEIVED→UNDER_REVIEW→ACCEPTED` em uma única chamada quando o ator tem permissão de auto-aceitar (Owner/Admin/Member responsável pelo Document; nunca Guest). Isso resolve a contradição J1×J8 sem violar C3 (que já permite a UX comprimida) nem D5 (Received≠Accepted continua sendo verdade no dado, só não visível como passo separado para upload interno).

**Checklist E-014 (pesado por Part 3.A/B do research):**
1. (30%) Exatamente um ponteiro "current" por Document, atualizado atomicamente com o flip superseded.
2. (25%) Histórico append-only, nunca deletado fisicamente no supersede.
3. (25%) Toda transição de estado é auditável (ator/quando/de-que-estado).
4. (20%) Upload interno nunca pula estruturalmente `RECEIVED`, mesmo quando a UX comprime os passos.

## Decisão 2 — Arquitetura de armazenamento current-vs-superseded

**Proposta**: seguir o DynamoDB single-table já usado no resto do projeto. `Document` e cada `DocumentVersion` são itens na mesma partição lógica (`PK=TENANT#<id>#DOCUMENT#<documentId>`), com `Document` carregando um atributo desnormalizado `currentVersionId` atualizado via `TransactWriteItems` (o mesmo padrão OCC de `src/shared/dynamodb/occ.ts`) no mesmo write que marca a versão anterior `SUPERSEDED` e a nova `ACCEPTED` — nunca dois writes separados. GSI1 existente (`GSI1PK=TENANT#..#ITEMSTATUS#<status>`) ganha um análogo para Document/Requirement por validade (`DOCSTATUS#<validity>`), reaproveitando o padrão de paginação cursor já implementado em D-142/D-E.

## Decisão 3 — Document Review como entidade própria

**Proposta**: entidade própria (`DocumentReview`), não campos soltos em Version. Motivo: J9 (rejeitar→re-solicitar) e a possibilidade de múltiplas tentativas de revisão sobre a mesma Version (ex.: revisão inicial rejeitada, nova versão aceita depois) exigem histórico de M revisões por Version, que campos singulares em Version não representam sem perda. `DocumentReview` referencia `versionId`, `reviewerId`, `decision`, `reason` (taxonomia fechada §12), `comment?`, `decidedAt`.

## Decisão 4 — Modelo de segurança de acesso Guest (magic link)

**Proposta**: token opaco de uso único, ≥128 bits de entropia, hash armazenado (nunca o token cru), TTL de autenticação de 20 minutos (dentro da faixa 15–30min do research) — **distinto** do "prazo" de negócio do Request (que pode ser dias/semanas, campo separado `dueDate` opcional). Rate limit por e-mail e por IP na emissão e no submit. Escopo do Guest é reforçado no backend (policy check no handler, nunca só ocultação de UI) — nunca lista/visualiza documentos fora do Request específico que abriu. Todo evento (link aberto, arquivo enviado) grava no `DocumentRequest` como estado (`OPENED`/`SUBMITTED`) com timestamp, reaproveitando o padrão de `security-audit.ts` já existente para eventos sensíveis.

## Decisão 5 — Vínculo Requirement→evidência e derivação de status

**Proposta**: `Requirement.satisfiedByVersionId` aponta para uma `DocumentVersion` específica (não para o `Document` genérico) — necessário para que expirar aquela versão específica rebaixe o Requirement para `EXPIRING`/`NOT_SATISFIED` corretamente (J13). O status do Requirement (`MISSING/PENDING/SATISFIED/EXPIRING/NOT_SATISFIED/NOT_APPLICABLE`) é **derivado**, computado a partir do estado da versão vinculada + validade, nunca um campo editável diretamente — mesmo padrão que compliance-tracking SaaS real (V-Comply/Drata) usa (status = função de evidência+data, não valor solto).

## Decisão 6 — Cardinalidade arquivo↔Version

**Proposta**: uma `DocumentVersion` pode ter N `DocumentFile`, com um marcado `role=PRINCIPAL` (exatamente um) e os demais `role=COMPLEMENTARY`. Resolve C4 (já aprovado) formalmente — fecha a pergunta aberta Q6/Q7 do spec v0.1: complementos pertencem à MESMA Version, nunca criam uma subversão.

## Decisão 7 — Archive vs delete/remoção

**Proposta**: três operações distintas, nunca confundidas: (a) **Archive Document** — muda `Document.status: ACTIVE→ARCHIVED`, preserva tudo, reversível; (b) **Remove Version** — permitido só quando a Version NUNCA foi `ACCEPTED` (ainda `RECEIVED`/`UNDER_REVIEW`/`REJECTED` e não é a `currentVersionId`) — corrige upload incorreto sem apagar evidência aceita; (c) **Exclusão de registro conforme retenção** — fora do escopo desta rodada, cai sob a mesma política de retenção/quarentena já `APPROVED` em D-127 (`HELD_FOR_RECOVERY`), reaproveitada, não reinventada.

## Decisão 8 — Recorrência de Request + rejeição

**Proposta**: `DocumentRequest` recorrente é representado por um `RequestSeries` (cadência, ativo/pausado) que gera uma nova instância de `DocumentRequest` a cada ciclo. Uma instância rejeitada (via J9) gera um novo `DocumentRequest` **fora da série** (`parentRequestId` apontando para a instância rejeitada, `seriesId=null`) — assim uma falha em um ciclo nunca deleta nem substitui os demais ciclos da série (satisfaz J21 AC), e o fluxo de re-solicitação (J9) continua simples sem acoplar às regras de cadência.

## Decisão 9 — Fronteiras de permissão (confirmação de sugestão IA, Viewer)

**Proposta**: reaproveitar a matriz RBAC já existente (Owner/Admin/Member/Viewer, `docs/architecture` B2B). Confirmar sugestão de IA requer ao menos `Member` — nunca `Viewer` (papel somente-leitura por definição já estabelecida no projeto). Download por Viewer fica **aberto** nesta rodada (A1 do spec) — não é bloqueador de arquitetura, é parâmetro de política configurável por Organization (flag booleana), resolvendo sem forçar uma resposta binária prematura de produto.

---

**Itens explicitamente fora desta rodada** (permanecem como perguntas abertas do produto, não de arquitetura): limites de plano/GB (A6), portal de cliente completo (A3), autoaceitação por IA (A2), assinatura eletrônica (A5), pastas (A4) — todos já `NÃO agora` no doc de decisões funcionais.
