# Document Domain — Rodada 2 (Revisão Claude)

Resposta ponto-a-ponto à crítica da Rodada 1 (`round1-codex-critique.md`, nota 4,6/10, REABRIR). Nenhuma decisão de produto é reaberta — D1–D10/C1–C6 continuam `APROVADO`; esta rodada só refaz o desenho técnico.

## E-014 — régua reconciliada

Fontes primárias com URL/data, substituindo os domínios soltos da Rodada 1:

| Fonte | URL | Data de consulta | Uso |
|---|---|---|---|
| NIST SP 800-63B §5.1.9 (Look-up Secrets) | https://pages.nist.gov/800-63-3/sp800-63b.html | 2026-09-01 | Decisão 4 — padrão selector+secret |
| OWASP Forgot Password Cheat Sheet | https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html | 2026-09-01 | Decisão 4 — geração/uso de token de coleta |
| OWASP Session Management Cheat Sheet | https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html | 2026-09-01 | Decisão 4 — vazamento de token em URL/Referer/logs (achado do próprio Codex, incorporado) |
| OWASP Access Control Cheat Sheet | https://cheatsheetseries.owasp.org/cheatsheets/Access_Control_Cheat_Sheet.html | 2026-09-01 | Decisão 4/9 — enforcement server-side, nunca só UI |
| AWS DynamoDB — Sparse Indexes | https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-indexes-sparse-indexes.html | 2026-09-01 | Decisão 2 — GSI3 (review queue) como índice esparso |
| MongoDB Document Versioning Pattern | https://www.mongodb.com/company/blog/building-with-patterns-the-document-versioning-pattern | 2026-08-31 | Decisão 2 — só para o princípio "separar leitura corrente de histórico", não para o schema físico (escopo reduzido conforme achado do Codex) |

Declaração revisada por decisão, sem "SIM PARCIAL" genérico:

- **Decisão 2** (armazenamento): SIM PARCIAL — o princípio current/history é externo (Mongo/Cosmos); o desenho físico de chaves/GSI é interno (reaproveita convenções já `APPROVED` deste projeto: single-table, GSI1 por status, cursor pagination de D-142), então não pede pesquisa de mercado adicional.
- **Decisão 4** (guest/magic link): SIM — quase inteiramente um padrão de segurança já resolvido fora do projeto (NIST/OWASP). Checklist abaixo, na própria Decisão 4.
- **Decisões 1, 3, 6, 7, 8, 9**: NÃO — são composição de padrões já `APPROVED` internamente ao projeto (state machine explícita, outbox/audit existente, RBAC existente, retenção D-127, idempotency key existente), não um padrão de mercado não resolvido. Declarar "SIM PARCIAL" nelas na Rodada 1 foi impreciso — corrigido para NÃO com a fonte interna citada em cada uma.
- **Decisão 5** (Requirement): NÃO — a função de derivação reaproveita o padrão já implementado e aprovado de `ExpirationItem`/`presentItemUrgency` (status indexado estável + urgência computada em leitura), não uma pesquisa de mercado nova. A citação de V-Comply/Drata na Rodada 1 é removida por não sustentar a decisão real tomada aqui.

## Decisão 1 — State machines como grafos reais

### `Document.status`

`ACTIVE ⇄ ARCHIVED` (comando `archive`/`unarchive`, ator WRITE_ROLES, sem precondição bloqueante). **Arquivar nunca afeta o cálculo de status de Requirement** (ver Decisão 5) — resolve A10 por construção, não por checagem: o status do Requirement deriva de `DocumentVersion`, nunca de `Document.status`.

### `DocumentVersion.state` — grafo completo

| Estado atual | Comando | Ator | Precondição | Próximo estado | Efeito transacional |
|---|---|---|---|---|---|
| (inexistente) | `reserveUpload` | WRITE_ROLES ou Guest com `GuestSession` válida (Decisão 4) | Document existe (ou criado junto) | `DRAFT` | Put `DocumentVersion(DRAFT)`; URL presignada emitida fora da transação |
| `DRAFT` | `commitUpload` | mesmo ator da reserva (match de sessão) | ≥1 `DocumentFile` com `role=PRINCIPAL`; scan de malware limpo (reaproveita `quarantine-key.ts`/`clean-key.ts` já implementados) | `RECEIVED` | Update condicional `state=DRAFT AND version=X` → `state=RECEIVED, receivedAt=now`; Put `DocumentVersionEvent(RECEIVED)` na mesma transação |
| `DRAFT` | `abandonUpload` | mesmo ator, ou sweeper por TTL | — | `WITHDRAWN` | Update condicional `state=DRAFT` → `WITHDRAWN`; único estado cujo S3 object pode ser fisicamente removido (nunca virou evidência) |
| `RECEIVED` | `claimReview` | qualquer WRITE_ROLES (tenant-wide — sem ACL por responsável, ver correção abaixo) | `state=RECEIVED` | `UNDER_REVIEW` | Update condicional `state=RECEIVED AND version=X` → `state=UNDER_REVIEW, reviewerId=ator`; Put Event(CLAIMED). Um segundo revisor concorrente falha na condição (409) — serialização real, não otimista-e-torça |
| `RECEIVED` ou `UNDER_REVIEW` | `acceptVersion` | WRITE_ROLES (claim não é obrigatória — otimização de UX, não trava a decisão) | ver transação da Decisão 2 | `ACCEPTED` | transação de até 6 itens (Decisão 2) |
| `RECEIVED` ou `UNDER_REVIEW` | `rejectVersion` | WRITE_ROLES | motivo obrigatório (taxonomia fechada §12 do spec) | `REJECTED` | Update condicional `state IN (RECEIVED,UNDER_REVIEW) AND version=X` → `state=REJECTED, rejectionReason, decidedAt`; Put Event(REJECTED). **Nunca removível depois** (fecha a contradição da Decisão 7) |
| `ACCEPTED` (o anterior) | efeito colateral do `acceptVersion` de outra Version do mesmo Document | sistema | — | `SUPERSEDED` | passo da mesma transação de accept |
| `UNDER_REVIEW` (claim expirada) | sweeper de TTL de claim (24h, mesmo padrão do sweeper de outbox já existente) | sistema | `state=UNDER_REVIEW AND reviewClaimedAt < now-24h` | `RECEIVED` | Update condicional, libera a claim morta |
| qualquer terminal (`ACCEPTED`/`REJECTED`/`SUPERSEDED`/`WITHDRAWN`) | comando repetido com mesmo `clientRequestToken` | — | idempotência: retorna o estado atual sem reescrever | — | nenhum write — resolve WF18 (resultado desconhecido): o cliente reenvia a mesma chamada e recebe o estado real, mesmo padrão de idempotency-key já usado em `CreateItem`/`RenewItem` |

**Fluxo interno comprimido (C3, "enviar e aceitar")**: a rota client-facing executa `commitUpload→claimReview→acceptVersion` como 3 escritas condicionais reais e sequenciais na mesma invocação Lambda (não 3 chamadas HTTP do cliente) — `RECEIVED` e `UNDER_REVIEW` **são persistidos e observáveis** (ainda que por frações de segundo) antes do próximo write, nunca simulados. Isso responde ao achado #2 do Codex sem contradizer C3 (achado #3): nada estrutural obriga revisão separada, é a MESMA state machine, só decidida pela rota a chamar os 3 passos de uma vez quando o ator tem permissão.

**Correção ao achado #4 (ACL por responsável)**: removida. `authorize()` real (`src/modules/identity/domain/authorization.ts`) é tenant-wide; `ownerUserId`/`assigneeUserId` só se aplicam quando ambos populados simultaneamente, padrão hoje não exercido por nenhum call site real. Nenhum comando desta state machine presume ACL por responsável — todos usam `WRITE_ROLES` tenant-wide, igual a toda outra mutação de negócio do projeto.

## Decisão 2 — Armazenamento: access patterns completos + transação de accept

### Access patterns cobertos (todos os enumerados no spec §25–31 e journeys)

| AP | Padrão | Chave |
|---|---|---|
| AP1 | Document por ID | `PK=TENANT#<t>#DOCUMENT#<id>, SK=METADATA` (Get) |
| AP2 | Versions de um Document, ordenadas | `SK=VERSION#<seq 6 dígitos zero-padded>` — Query único no `PK` do Document, sem GSI |
| AP3 | Documents por Subject | GSI2: `GSI2PK=TENANT#<t>#SUBJECT#<subjectId>#DOCTYPE, GSI2SK=DOCUMENT#<id>` |
| AP4 | Documents por Organization + status (coleção) | GSI1: `GSI1PK=TENANT#<t>#DOCSTATUS#<ACTIVE\|ARCHIVED>, GSI1SK=SUBJECT#<subjectId>#DOCUMENT#<id>` — cursor pagination igual D-142 |
| AP5 | Review Queue tenant-wide | GSI3 (**esparso**, AWS DynamoDB Sparse Indexes): `GSI3PK=TENANT#<t>#REVIEWQUEUE, GSI3SK=RECEIVED#<receivedAt>#VERSION#<id>` — atributo só existe enquanto `state IN (RECEIVED,UNDER_REVIEW)`; removido (não setado) em `ACCEPTED`/`REJECTED`, então o item desaparece do índice sem escrita extra de "limpeza" |
| AP6 | Requirements por Subject | `PK=TENANT#<t>#SUBJECT#<subjectId>, SK=REQUIREMENT#<id>` (item do próprio Subject, sem GSI) |
| AP7 | Requirements por Organization + status | GSI1 namespace compartilhado, discriminado por prefixo: `GSI1PK=TENANT#<t>#REQSTATUS#<status>` (mesmo índice físico de AP4, discriminado por prefixo — igual ao projeto já discrimina `ITEMSTATUS` de outros módulos no GSI1 existente) |
| AP8 | Requests por status/responsável | GSI4: `GSI4PK=TENANT#<t>#REQUESTSTATUS#<status>, GSI4SK=DUE#<dueDate ou "~">#REQUEST#<id>` — mesma mecânica de cursor opaco de D-142, generalizada como helper `queryIndexPage(indexName, ...)` em vez de duplicar `queryGsi1Page` |
| AP9 | Files de uma Version | `SK=VERSION#<seq>#FILE#<fileId>` — Query com `begins_with` no `PK` do Document |
| AP10 | Eventos de auditoria de uma Version | `SK=VERSION#<seq>#EVENT#<ULID>` — ULID ordena cronologicamente, mesmo Query `begins_with` |

Nenhum GSI novo além dos 4 листados (GSI1 reaproveitado/discriminado por prefixo, GSI2/3/4 novos) — dentro do padrão de isolamento de índice já exigido pelo `AGENTS.md` §7 (política escopada, nunca leitura geral de tabela).

### Transação de `acceptVersion` (TransactWriteItems, ≤6 itens — bem abaixo do limite de 100)

1. Update `Document`: condição `version=:docVer` → `currentVersionId=:newVersionId, version+=1`
2. Update Version anterior (se existir `currentVersionId` prévio): condição `state=ACCEPTED AND version=:oldVer` → `state=SUPERSEDED, version+=1` (remove chaves GSI3 — já não estava na review queue)
3. Update Version nova: condição `state IN (RECEIVED,UNDER_REVIEW) AND version=:newVer` → `state=ACCEPTED, decidedAt=now, reviewerId=ator, version+=1`, remove chaves GSI3
4. Put `DocumentVersionEvent(ACCEPTED)` — condição `attribute_not_exists(PK)` chaveada por `clientRequestToken`, garante idempotência
5. Update `Requirement` (se esta Version satisfaz um): condição `version=:reqVer` → `satisfiedByVersionId=newVersionId, applicabilityStatus=SATISFIED` (ver Decisão 5), `version+=1`
6. Update `DocumentRequest` (se originado de uma solicitação): condição `state=SUBMITTED AND version=:reqVer` → `state=COMPLETED, version+=1`

Todos os 6 itens têm `PK` dentro do mesmo tenant (requisito de `TransactWriteItems` do projeto já seguido em outros módulos, ex. accept de Renewal). Item 5/6 são condicionais/opcionais — a transação tem de 4 a 6 itens dependendo do contexto, nunca mais.

## Decisão 3 — Substituída: `DocumentVersionEvent` (log append-only), não uma entidade "Review" mutável

A Rodada 1 propôs `DocumentReview` como entidade própria, mas não resolveu qual campo é a fonte de verdade (`Version.state` vs `Review.decision`). Correção: **não existe entidade `DocumentReview` mutável.** Existe:

- `DocumentVersion.state` — **única** fonte de verdade do estado atual (mutável, uma linha, OCC).
- `DocumentVersionEvent` — log append-only, uma linha por transição real (`RECEIVED`/`CLAIMED`/`ACCEPTED`/`REJECTED`/`SUPERSEDED`/`WITHDRAWN`), nunca mutado, escrito na MESMA transação da mudança de estado (reaproveita `src/shared/outbox/outbox.ts`, mesmo padrão de evento crítico já usado no projeto). Cada evento carrega `actor`, `timestamp`, `fromState`, `toState`, `reason?`.

Isso elimina a duplicação de fonte de verdade que o Codex apontou (achado #4) e não exige inventar cardinalidade de "quantas reviews por Version" — a resposta é "quantas transições reais aconteceram", que o log já representa sem ambiguidade.

## Decisão 4 — Redesenho completo do acesso Guest (bloqueio crítico da Rodada 1)

Três camadas, não um token único:

1. **`RequestAccessCredential`** (longa duração, revogável) — criada ao enviar um `DocumentRequest`. TTL = `dueDate` do Request + margem, ou 90 dias-padrão se sem prazo (nunca 15–30min — essa faixa é para a troca de sessão, item 2, corrigindo a aplicação errada da Rodada 1 apontada pelo Codex). Chave de busca: **selector público + secret hash** (NIST SP 800-63B §5.1.9), nunca hash-só (resolve achado #4 — sem isso, lookup exigiria scan). Link = `.../guest/{selector}.{secret}` (path, nunca query string — evita vazamento por `Referer`/logs, OWASP Session Management Cheat Sheet).
2. **`GuestSession`** (curta, 30min deslizante — mesmo padrão de renovação de D-141) — trocada a partir de um `RequestAccessCredential` válido e não revogado. É essa troca, não o `GET` da página, que marca `DocumentRequest.state: SENT→OPENED` (condicional, uma vez só) — resolve o falso positivo de scanner de e-mail (achado #9): um scanner que só busca a URL crua tipicamente não executa o JS da SPA que faz a troca; risco residual nomeado explicitamente (não eliminado) como item futuro de mitigação (página interstitial "clique para confirmar") se dados reais de `dev`/piloto mostrarem falsos positivos.
3. **Escopo do Guest**: toda ação (listar o que foi pedido, enviar arquivo) autorizada no backend contra `GuestSession.requestId` — nunca só ocultado na UI (OWASP Access Control Cheat Sheet). `GuestSession` vive em cookie httpOnly escopado à rota de guest, nunca retransmitido na URL após a primeira troca (mesmo padrão do cookie de sessão do BFF, `cookies.ts`).

**Consumo/replay** (achado #6): o `RequestAccessCredential` **não é de uso único** (precisa ser reutilizável ao longo de dias) — o que É atomicamente consumido é o `submitVersion` final, via `clientRequestToken` + write condicional (`attribute_not_exists`), mesmo padrão de idempotência já usado em `CreateItem`/`RenewItem`. Isso separa corretamente "credencial reutilizável" de "submissão de uso único", resolvendo a contradição TTL-vs-prazo (achado #2) e o TOCTOU (achado #6) na raiz.

**Rate limiting** (achado #7): reaproveita o limitador já implementado para Invitations (`initial-invite-rate-limiter.ts`, D-099) — uma instância chaveada por `requestId` para tentativas de troca de credencial, outra chaveada por `requestId` para tentativas de submit (e-mail não é identidade verificada aqui, então não é a chave certa).

**Auditoria** (achado #10, correção factual aceita): **não** reaproveita `security-audit.ts` (taxonomia fechada, incompatível — aceito o achado do Codex). Em vez disso, `DocumentRequestEvent` segue o MESMO padrão de log append-only da Decisão 3, como evento de negócio (não de segurança).

**Revogação**: cancelar o Request marca `RequestAccessCredential.revokedAt` — checado a cada tentativa de nova troca; sessões `GuestSession` já emitidas expiram naturalmente em até 30min (mesma janela de exposição residual que o projeto já aceita para revogação de sessão comum, D-141/D-136).

### Checklist E-014 — Decisão 4 (a que faltava na Rodada 1)

1. (25%) Credencial de duas camadas (longa/revogável + curta/sessão) — NIST SP 800-63B §5.1.9, OWASP Forgot Password Cheat Sheet.
2. (20%) Padrão selector+secret para lookup, nunca hash-só — mesmas fontes.
3. (20%) Enforcement de escopo 100% server-side — OWASP Access Control Cheat Sheet.
4. (15%) Rate limiting reaproveitando mecanismo já aprovado (D-099), chaveado por `requestId`.
5. (10%) Token nunca em query string após a primeira troca; sem recurso de terceiro na página guest — OWASP Session Management Cheat Sheet.
6. (10%) Submit idempotente/condicional como guarda real de replay, independente da reutilização da credencial.

## Decisão 5 — Requirement: derivação determinística, reaproveitando o padrão já aprovado de `ExpirationItem`

**Correção estrutural** (achado #4 do Codex): nem tudo é derivado. `Requirement.applicability: APPLICABLE | NOT_APPLICABLE` é um **fato persistido** (setado explicitamente por um usuário), não calculável — exatamente como o Codex exigiu.

Função de derivação de `Requirement.status` (determinística, nesta ordem):

```
se applicability = NOT_APPLICABLE           → NOT_APPLICABLE (terminal, ignora o resto)
senão se satisfiedByVersionId é nulo:
  se existe DocumentRequest aberto (state ∈ {SENT,OPENED,SUBMITTED,UNDER_REVIEW}) para este Requirement → PENDING
  senão                                       → MISSING
senão (satisfiedByVersionId aponta para uma Version que FOI ACCEPTED no momento da atribuição — nunca aponta para outra coisa, ver transação da Decisão 2):
  se Document.hasValidity = false            → SATISFIED (permanente)
  senão, comparando validUntil da Version contra agora:
    se agora >= validUntil                   → NOT_SATISFIED (evidência venceu)
    senão                                     → SATISFIED
```

**`EXPIRING` não é um 6º bucket indexado** — é uma subdivisão de `SATISFIED` computada em tempo de leitura a partir de `validUntil` vs. agora, exatamente como `presentItemUrgency()` já faz para `ExpirationItem` (D-136/mission §29: status indexado estável nas GSIs, urgência/"vence em breve" calculada ao ler, nunca reindexada por passagem de tempo). Isso resolve diretamente o achado #3 do Codex (`VALID→EXPIRING→EXPIRED` mudando sem mutação do item): o índice (GSI1/AP7) só guarda `{MISSING,PENDING,SATISFIED,NOT_SATISFIED,NOT_APPLICABLE}` — todos mudam apenas em evento discreto (atribuição, rejeição, expiração cruzando o próprio `acceptVersion`/job de expiração que já existe para `ExpirationItem`, reaproveitado aqui em vez de criado do zero) — nunca por relógio sozinho.

**Cardinalidade** (achado #1): `satisfiedByVersionId` é singular por decisão explícita desta rodada — um Requirement é satisfeito por UMA versão-evidência corrente por vez; se um Requirement legitimamente precisar de múltiplas evidências simultâneas no futuro (não evidenciado pelos docs funcionais hoje), isso vira um novo Requirement por evidência, não uma lista dentro de um Requirement — decisão nomeada explicitamente, não escondida.

**Relink em nova aceitação** (achado #2): quando uma nova Version do mesmo Document é aceita (item 5 da transação da Decisão 2), o Requirement é atualizado automaticamente para a nova `versionId` **somente se já apontava para uma version do MESMO Document** — sem confirmação humana extra (é a continuação natural do mesmo ciclo de renovação, D2 já aprovado).

## Decisão 6 — Lifecycle de arquivo por Version

- Principal existe desde a saída de `DRAFT` (`commitUpload` falha com 400 se não houver exatamente um `role=PRINCIPAL`).
- **Imutabilidade pós-`ACCEPTED`** (resolve achado #2 — contradição com "append-only"): nenhum arquivo pode ser adicionado/trocado/removido de uma Version depois de `ACCEPTED`. Um "aditivo" chegado depois é sempre uma **nova `DocumentVersion`** (reaproveita o fluxo de renovação já existente, D2), nunca uma mutação da version aceita.
- Enquanto em `DRAFT`/`RECEIVED`/`UNDER_REVIEW`: complementares podem ser adicionados/removidos livremente; troca de qual arquivo é `PRINCIPAL` também é permitida só nessa janela.
- Concorrência: cada escrita de arquivo incrementa `DocumentVersion.version` (OCC), mesma convenção do resto do projeto.
- Scan de malware e ciclo de vida do S3 object: reaproveita literalmente `quarantine-key.ts`/`clean-key.ts`/`parser-sandbox.ts` já implementados em `src/modules/document/` — nenhum mecanismo novo.

## Decisão 7 — Archive/Remove/Delete sem contradição com J9

- **`REJECTED` nunca é removível** — correção direta do achado #1 (contradição com J9). Sem exceção.
- O único estado removível é `DRAFT` (nunca virou evidência) — resolve J19 ("o sistema explica quando uma version não pode simplesmente ser removida": a resposta é "sempre que sair de `DRAFT`").
- `Archive Document`: flip de status apenas (Decisão 1), seguro por construção quanto a Requirement (Decisão 5) — resolve A10.
- Por construção, nenhuma `Version`/`Review event` referenciada por `Request`/`Requirement` pode ser fisicamente removida (só `DRAFT` é removível, e `DRAFT` nunca é referenciado por nada) — resolve achado #6 (quebra de referência) por eliminação estrutural, não por checagem em tempo de execução.
- Exclusão conforme retenção: mapeamento explícito, não "reaproveitado" genericamente — `Document`, `DocumentVersion` (`SUPERSEDED`/`REJECTED`), `DocumentFile`, `DocumentRequest` entram como novas linhas no inventário de classes já `APPROVED` em D-127 (`docs/architecture/reviews/quarantine-retention-scoping/estado-final-consolidado.md`), reaproveitando `HELD_FOR_RECOVERY` verbatim — implementação real fica para sessão futura dedicada, mesmo padrão de D-127.

## Decisão 8 — Recorrência preservando identidade de ciclo

Adotado o formato sugerido pelo Codex: `DocumentRequest` carrega `seriesId?`, `occurrenceIndex?`, `parentRequestId?`, `kind: SCHEDULED | CORRECTION | AD_HOC`. Uma correção pós-rejeição (J9) recebe o **mesmo** `seriesId`/`occurrenceIndex` do request rejeitado, mais `parentRequestId` apontando para ele e `kind=CORRECTION` — preserva causalidade E identidade de ciclo simultaneamente (nenhuma informação perdida, ao contrário da Rodada 1). Rejeitar uma ocorrência marca **aquela ocorrência** como terminal `REJECTED`; a série continua — a correção é logicamente "ainda a ocorrência N", nunca contada como N+1. Materialização de nova ocorrência: put condicional chaveado por `seriesId#occurrenceIndex` (idempotente contra reexecução do scheduler), mesmo padrão do sweeper de purga de tenant já implementado (D-124/EventBridge Scheduler). **Por que fechar a forma agora mesmo sendo 4º núcleo/Premium futuro**: o cálculo de `Requirement.status=PENDING` (Decisão 5) já precisa saber "existe Request aberto" desde o Núcleo 2 — fixar o formato completo agora evita migração quebrando o relacionamento Request↔Requirement quando a recorrência realmente for implementada.

## Decisão 9 — Permissões: reaproveitar RBAC existente, não decidir produto

- Confirmar sugestão de IA no domínio documental reaproveita a **mesma action já existente** `extraction:confirm` (`WRITE_ROLES`) — é o mesmo mecanismo funcional já aprovado para `ExpirationItem`/M7, sem nova action.
- Removida a menção a "Member responsável" (mesma correção da Decisão 1) — tenant-wide, sem ACL por responsável.
- **Download por Viewer permanece aberto** (A1) — arquitetura não decide isso. Nova action `document:download` adicionada à matriz, default `WRITE_ROLES` (mesmo tier de tudo que Viewer hoje não faz) até Marcelo decidir explicitamente o contrário; `document:read` (já existente, `READ_ONLY_ROLES`) cobre preview. Nenhuma flag booleana inventada — corrige achado #3.

---

**Itens ainda fora desta rodada** (inalterado da Rodada 1): limites de plano/GB, portal de cliente completo, autoaceitação por IA sem revisão, assinatura eletrônica, pastas.
