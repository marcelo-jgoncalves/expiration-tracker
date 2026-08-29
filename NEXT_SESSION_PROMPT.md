# Expiration Tracker — Status e Próxima Sessão

> Este arquivo é estado atual + próxima ação (`AGENTS.md` §2), não histórico. Para a linha do tempo completa por sessão, ver `docs/architecture/session-log.md`; para toda decisão com nota Claude/Codex, ver `docs/architecture/decisions-log.md`. Reescrito em 2026-08-23 para remover narrativa já duplicada nesses dois arquivos (checklist `AGENTS.md` §6). Atualizado em 2026-08-24 com o Core Expiration Vertical Slice (ver abaixo) — confirmar `git log`/branch atual antes de assumir que o PR já foi mergeado, este arquivo pode ficar temporariamente atrás do estado real de `develop`.

## Engenharia de logs/tracing (2026-08-29), E-011 — padrão aprovado + auditoria + junção X-Ray implementada + 1 pendência real

Pedido explícito do Marcelo: "máxima qualidade em logs e tracing", avaliado em rodadas Claude↔Codex. Registro completo em `docs/engineering/decisions-log.md` E-011. Resumo do estado: `docs/engineering/logging-observability-standard.md` `APPROVED` (gate 9,5/10); achados reais de wiring de detecção (5 emissores sem metric filter) e propagação de `correlationId` pelo pipeline de extração (Step Functions) já corrigidos e mergeados em `main` (PRs #80/#81) — auditoria da implementação subiu de 7,9 para 8,7/10.

**Pendência 1 — decisão de produto, não implementar sem sinal do Marcelo**: `AppError.retryable` não decide comportamento real de nenhum handler SQS hoje (documentação já corrigida para não afirmar o contrário) — ver E-011 para o detalhe completo. Ainda não decidida nesta sessão (2026-08-29) — Marcelo pediu para focar primeiro na junção X-Ray (pendência 2 abaixo) e seguir autonomamente pelas demais frentes, postergando qualquer decisão só dele.

**Pendência 2 — IMPLEMENTADA nesta sessão (2026-08-29), status `IMPLEMENTED`/`UNIT TESTED`, falta só o smoke test real**: junção `correlationId` ↔ trace ADOT/X-Ray. Design + registro de implementação movidos para `docs/architecture/correlationid-xray-trace-join.md` (era `expiration-tracker-correlationid-trace-join-design-2026-08-29.md` na raiz). Checklist:

- [x] `src/shared/observability/xray-trace-header.ts` novo — `parseXrayTraceHeader`, parsing determinístico por campo, `Root` validado contra `^1-[0-9a-fA-F]{8}-[0-9a-fA-F]{24}$`, `Sampled` só `"0"`/`"1"`, fail-open garantido. **Decisão de implementação**: `Parent`/`xrayParentId` deixado FORA do v1 do código (opção de simplicidade já registrada no design, não bloqueio).
- [x] Testes do parser (`test/unit/xray-trace-header.test.ts`, 8 testes): ordem variável, ausente/vazio, `Root`/`Sampled` inválidos isoladamente, `Parent`/`Lineage`/chaves desconhecidas ignorados, nunca lança.
- [x] Precedência de `SecureLogger.write()` corrigida (`logger.ts`) — nova ordem `context` → `baseContext` → `getContext()` → `xray*` (menos para mais confiável, via helper `mergeDefined` que nunca deixa um campo `undefined` de uma camada mais confiável sobrescrever um valor já definido). Zero call site real afetado (grep confirmou: nenhum handler passa `correlationId`/`tenantId` explícito no `context` por chamada hoje).
- [x] Teste de precedência novo (`test/unit/logger.test.ts`) provando que `context` forjado nunca vence `getContext()` real, tanto para `tenantId`/`correlationId` quanto para os campos `xray*`.
- [x] `parseXrayTraceHeader(process.env["_X_AMZN_TRACE_ID"])` integrado em `SecureLogger.write()`.
- [x] Nota de cardinalidade + nota de sampling documentadas no código (`xray-trace-header.ts`) e em `logging-observability-standard.md` critério 4.
- [x] `npm run typecheck`/`lint`/`check-docs` limpos, `npm test` completo passando (20 testes novos/estendidos desta feature), zero regressão.
- [ ] **Smoke test real em `dev` — único item pendente, BLOQUEADO nesta sessão por falta de acesso AWS** (sem credenciais locais, MCP `aws-mcp` falhou ao conectar): invocar uma Lambda com tracing ativo, confirmar `correlationId`/`xrayTraceId`/`xraySampled=true` numa linha de log real, copiar o `xrayTraceId`, confirmar no console X-Ray que é o mesmo trace. Sem isso, status fica `UNIT TESTED`, nunca `E2E PROVEN` — próxima sessão com acesso AWS real (ou Marcelo via `!`) deve rodar isto antes de fechar E-011 pendência 2 de vez.
- [x] Design movido para `docs/architecture/correlationid-xray-trace-join.md`, apagado da raiz.

## Correções mecânicas independentes (2026-08-29)

Encontradas por varredura dedicada a trabalho não bloqueado por decisão do Marcelo/acesso AWS, corrigidas na mesma sessão do item acima:

- `docs/engineering/pilot-readiness-program.md:230` (doc drift): comentário em `infra/main.tf` sobre `ExtractionValidationTaskHandler` já estava atualizado no próprio Terraform ("item 7, implemented") — só a nota no programa de pilot readiness estava desatualizada, dizendo que a correção ainda era candidata futura. Corrigida a nota.
- `PolicyRef` (`src/modules/reminder/domain/reminder-policy.ts:69-72`) não carregava `tenantId` — nem no tipo, nem nos 2 pontos reais de escrita (`reminder-policy-service.ts`/`expiration-service.ts`'s cópia de renovação). Campo adicionado ao tipo + aos 2 call sites + teste de regressão em cada um (`reminder-policy-service.test.ts`, `reminder-materialization-trigger.test.ts`). Achado original registrado em `pilot-readiness-program.md:265` (W3-07), independente da decisão de orquestrador pendente abaixo.

## W3-07 — segunda rodada Codex + fechamento de B6 (2026-08-29, sessão em outra máquina), D-083, nota 9,1/10 — purge pipeline pronto para decidir orquestrador

Sessão que retomou o trabalho via `git pull` (a sessão anterior, mesma máquina de D-082, foi
interrompida no meio — commit `8b6033c "trabalho interrompido"` — depois de um self-review que
achou e corrigiu um sétimo achado, B7, sem rodar a segunda rodada Codex nem atualizar este
arquivo). Registro completo em `decisions-log.md` D-083.

Rodou a segunda rodada Codex pedida pela "próxima ação" de D-082, via MCP `codex/codex` (disponível
diretamente nesta sessão — mesmo protocolo de conteúdo do `AGENTS.md` §4, mecanismo de invocação
diferente da CLI). Confirmou B1-B5/B7 corrigidos, mas achou **B6 (vínculo S3↔tenant) não fechado de
verdade** — a asserção de D-082 só comparava dois rótulos fornecidos pelo chamador
(`target.tenantId` vs `input.tenantId`), nunca o `target.prefix` real. Levou **4 rodadas de
correção-e-reconfirmação sucessivas sobre o MESMO achado**, cada uma expondo uma variante mais
profunda que a anterior (nota 7,4 → 8,0 → 8,2 → **9,1/10, zero achados bloqueantes**), até fechar
com uma checagem ANCORADA no início do prefixo contra uma lista fechada de raízes reais
(`TENANT_PREFIX_ROOTS = ["clean/", "tenant/", "ocr/"]`, verificada por leitura direta de cada key
builder tenant-owned do codebase) — mesma filosofia de allowlist fechado que
`system-mutation.ts`'s `SystemMutationOperation`. Parecer final do Codex: "o B6 está genuinamente
fechado agora... pronto para avançar à próxima etapa". Zero regressão em toda a sequência
(1076→1084 testes de backend), typecheck/lint/check-docs limpos em cada rodada.

**2 achados NÃO-BLOQUEANTES aceitos, não corrigidos** (documentados no código, não escondidos): (a)
a validação de prefixo ainda não acopla cada raiz a um bucket específico — não reabre purga
cross-tenant, só fica marcado para o futuro composition root construir cada target de uma tabela
fechada bucket→raiz; (b) adaptadores reais (`tenant-purge-scan.ts`/`tenant-purge-s3-adapter.ts`)
continuam sem teste de integração contra AWS real — gap conhecido desde D-081, inalterado.

**Próxima ação real, em ordem de valor esperado**: (a) decidir e implementar o orquestrador/trigger
real (Step Functions vs. Lambda simples via EventBridge Scheduler — decisão de produto/arquitetura,
Type 1, `AGENTS.md` §4, ainda não decidida — Marcelo deve decidir ou delegar via protocolo
Claude↔Codex); (b) Terraform para a IAM role do futuro handler de purge; (c) teste de integração
real dos adaptadores AWS contra DynamoDB/S3 reais (achado não-bloqueante (b) acima); (d) se
desejado, fechar o achado não-bloqueante (a) acima (acoplar raiz↔bucket) quando o composition root
real for construído.

## W3-07 — primeira rodada Codex do purge pipeline (2026-08-29), D-082, nota 4,5/10 — 6 bloqueadores corrigidos, sem reconfirmação

Sessão de continuação direta de D-081 (o purge pipeline tinha sido implementado sem NENHUMA
revisão adversarial). Rodou a primeira rodada Codex real sobre esse código, seguindo o mesmo
padrão de arquivo-prompt/primeiro-plano do fence de admissão (`AGENTS.md` §4). Registro completo
em `decisions-log.md` D-082.

- **Nota do Codex: 4,5/10** — abaixo do gate de 9,0, mas no mesmo padrão de "primeira rodada real
  acha bloqueadores estruturais" que D-072 (5,0/10) já mostrou no lado do fence de admissão.
- **6 achados BLOQUEANTES, todos confirmados reais e corrigidos NESTA MESMA sessão** (sem uma
  segunda rodada Codex confirmando os fixes — orçamento):
  1. **B1 — completude do Scan**: `GuestTokenPointer`/`TextractJob` (tenant-owned, `tenantId`
     declarado, mas PK fora do prefixo `TENANT#`) nunca eram alcançados pelo Scan. Corrigido
     ampliando o `FilterExpression`/`ConditionExpression` para aceitar `tenantId = :tenantId` como
     alternativa ao prefixo `TENANT#`.
  2. **B2 — convergência não provada em retomada**: um checkpoint com `versionsDone`/`dynamoDone`/
     `sessionTableDone` fazia uma retomada pular a re-varredura inteiramente, violando o requisito
     do design aprovado de "re-scan vazio, não uma única varredura". Corrigido com 3 funções de
     verificação incondicional (`verifyTenantDynamoPurgeEmpty`/`verifyTenantSessionsEmpty`/
     `verifyS3TenantPrefixEmpty`), sempre chamadas antes de `SUCCESS`.
  3. **B3 — exclusão do tombstone dependia de metadado mutável**: `TenantLifecycleRecord` só era
     protegido pelo atributo opcional `entityType` no item escaneado. Corrigido com guarda por
     CHAVE FÍSICA CANÔNICA dentro da própria lane privilegiada (`PURGE_DELETE`). Guarda equivalente
     adicionada para `IdentityMapping` (achado próprio desta sessão: o fix de B1 teria reaberto a
     proteção dela especificamente).
  4. **B4 — rejeições de segurança ignoradas no result reporting**: `itemsRejectedBySafetyCondition`
     já existia mas `purge-tenant.ts` nunca o lia — corrigido, agora força `PARTIAL`.
  5. **B5 — TOCTOU na session table**: `deleteSession()` era incondicional após um check só do lado
     do chamador. Corrigido com `ConditionExpression` server-side no adaptador real.
  6. **B6 — S3 targets sem vínculo ao tenant**: `purgeTenant()` aceitava qualquer `{bucket,prefix}`
     sem checar contra o `tenantId` sendo purgado. Corrigido exigindo `tenantId` no
     `TenantS3Target` + asserção síncrona (`TenantPurgeTargetMismatchError`) antes de qualquer
     purga rodar.
- **2 achados NÃO-BLOQUEANTES avaliados, sem mudança de código**: `LoginAttempt` sem `tenantId`
  (aceitável como está, já documentado); bucket OCR não-versionado (Codex marcou "bloqueante em
  combinação com B2", mas com B2 corrigido o mecanismo já funciona corretamente sobre ele — a
  questão real remanescente é operacional/timing de quando a verificação roda, não um bug de
  código).
- 1082 testes de backend passando (era 1066, +16 novos), typecheck/lint/check-boundaries/
  check-docs limpos, zero regressão.

**Próxima ação real, em ordem de valor esperado**: (a) uma SEGUNDA rodada Codex confirmando
especificamente os 6 fixes B1-B6 antes de considerar D-082 fechado — mesmo padrão que o fence de
admissão precisou (D-072→D-075→D-079→D-080) para convergir; (b) decidir e implementar o
orquestrador/trigger real (Step Functions vs. Lambda simples via EventBridge Scheduler — decisão
de produto/arquitetura, Type 1, ainda não decidida); (c) Terraform para a IAM role do futuro
handler de purge; (d) teste de integração real dos adaptadores AWS (`tenant-purge-scan.ts`,
`tenant-purge-s3-adapter.ts`) contra AWS real — ainda só compilação/lint, nunca exercitados contra
DynamoDB/S3 reais.

## W3-07 — pipeline de purga durável (2026-08-29), D-081, ainda sem rodada Codex

Sessão dedicada ao purge/sweeper pós-`DELETED` (Codex, em D-080, recomendou explicitamente
redirecionar esforço para cá em vez de continuar espremendo o fence de admissão em 8,8/10).
Registro completo em `decisions-log.md` D-081.

**O que foi construído** (todos os 4 itens do escopo, IMPLEMENTED + UNIT TESTED):
1. `src/shared/tenant-lifecycle/system-mutation.ts`'s `PURGE_DELETE` — implementado de verdade
   (era `SystemMutationNotImplementedError`). `Delete` idempotente
   (`attribute_not_exists(PK) OR begins_with(PK, "TENANT#<id>#")`), sem condição de versão.
2. `src/workers/tenant-purge/dynamo-tenant-purge.ts` — Scan tenant-scoped da tabela principal +
   purge via `PURGE_DELETE`, excluindo `TenantLifecycleRecord`/`IdentityMapping` na camada de
   lógica pura.
3. `src/workers/tenant-purge/session-table-tenant-purge.ts` — purge do `bff-session-table`
   (linhas `Session` apenas — `LoginAttempt` não tem `tenantId`, gap real documentado).
4. `src/workers/tenant-purge/s3-tenant-purge.ts` — `ListObjectVersions` paginado, versões +
   delete markers, `DeleteObjects.Errors[]` com retry, `ListMultipartUploads` + abort,
   checkpoint/resume.
5. `src/workers/tenant-purge/purge-tenant.ts` — ponto de entrada composable único
   (`SUCCESS`/`PARTIAL`/`FAILED`, nunca reporta sucesso com erro S3 não resolvido).
6. Adaptadores reais AWS: `src/shared/dynamodb/tenant-purge-scan.ts` (Scan real, tabela
   principal + bff-session-table), `src/shared/s3/tenant-purge-s3-adapter.ts` (S3 real).

1066 testes de backend passando (era 1038, +28 novos), typecheck/lint/check-boundaries/
check-docs limpos, zero regressão. Commits: `4eaf593` (pipeline core + testes) e o commit desta
mensagem (adaptadores reais + docs).

**Infra real verificada, não assumida**:
- `quarantine`/`clean` (`infra/modules/document-buckets/main.tf`) e `import`
  (`infra/modules/import-bucket/main.tf`): **versionamento confirmado habilitado**
  (`aws_s3_bucket_versioning` com `status = "Enabled"`), como o design aprovado assume.
- `extraction_transient` (bucket OCR, `infra/main.tf` linha ~1702): **deliberadamente SEM
  versionamento** — comentário do próprio Terraform diz "no versioning/lifecycle safety net",
  TTL de 24h (`EXTRACTION_TRANSIENT_LIFECYCLE_HOURS`). Isto NÃO é um gap de implementação desta
  sessão — é uma decisão de design pré-existente (retenção transitória curta substitui
  versionamento). O mecanismo de purga desta sessão funciona corretamente sobre um bucket não
  versionado também (cada objeto aparece como uma "versão" `null` em `ListObjectVersions`,
  purgada do mesmo jeito) — só o argumento "versionamento cobre objeto tardio" do design
  aprovado não se aplica a este bucket especificamente; o TTL de 24h é o que efetivamente limita
  a janela de exposição ali.
- `bff-session-table` (`infra/modules/bff-session-table/main.tf`): confirmado sem GSI — a
  enumeração tenant-scoped é necessariamente um Scan, não um Query (documentado no próprio
  módulo).
- Nenhuma GSI keyed só por `tenantId` existe na tabela principal (GSI1-GSI7, cada uma serve um
  padrão de acesso por tipo de entidade específico) — confirmado por leitura de
  `infra/modules/dynamo-table/main.tf` e grep exaustivo de `GSI1PK` em `src/modules/**/domain`.
  O purge da tabela principal é portanto um Scan com `FilterExpression: begins_with(PK, ...)`,
  não um Query — aceitável porque deleção de tenant é rara/assíncrona, não um hot path.

**O que NÃO foi construído nesta sessão (explicitamente fora de escopo, ver prompt original)**:
- Orquestrador/Step Functions ou qualquer wiring real de trigger `QUIESCING`→`PURGING`→
  `VERIFIED` — `purgeTenant()` é uma primitiva real e chamável, não um Lambda handler ainda; não
  existe `src/runtime/aws/handlers/tenant-purge-handler.ts` nem composição em
  `src/runtime/aws/composition/`.
- Nenhuma mudança em Terraform (`infra/`) — nenhuma IAM role nova para um futuro handler de
  purge, nenhum EventBridge Scheduler/state machine.
- Adaptadores reais (`tenant-purge-scan.ts`, `tenant-purge-s3-adapter.ts`) NÃO foram testados
  contra AWS real nesta sessão (sem ambiente de integração disponível) — só typecheck/lint/
  compilação limpos. A lógica pura que eles envolvem tem 24 testes unitários com fakes
  in-memory/S3, mas o adaptador real em si (marshalling de `ScanCommand`/`ListObjectVersionsCommand`/
  `DeleteObjectsCommand` reais) não tem teste de integração.
- **Nenhuma rodada Codex executada sobre este código ainda** — ao contrário do fence de admissão
  (4 rodadas, 8,8/10), o purge pipeline desta sessão não teve nenhuma revisão adversarial. Maior
  valor esperado da próxima sessão: uma rodada Codex dedicada especificamente a
  partial-failure handling, checkpoint/resume correctness, isolamento de tenant, e completude do
  bucket versionado (ver `AGENTS.md` §4 para invocação).
- O gap `LoginAttempt`/`GuestRateLimitRecord` do `bff-session-table` (sem `tenantId`) permanece
  documentado, não fechado — mesma classe de pendência já registrada em D-080 para o fence de
  admissão.

**Próxima ação real, em ordem de valor esperado**: (a) rodada Codex adversarial dedicada ao
purge pipeline (maior valor, zero rodadas até agora); (b) decidir e implementar o
orquestrador/trigger real (Step Functions vs. Lambda simples invocado por EventBridge Scheduler
— decisão de produto/arquitetura, Type 1, não decidida nesta sessão); (c) Terraform para a IAM
role do futuro handler de purge (least-privilege: Scan na tabela principal + `bff-session-table`,
`ListObjectVersions`/`DeleteObjects`/`ListMultipartUploads`/`AbortMultipartUpload` nos 4 buckets).

## W3-07 — quarta rodada Codex (2026-08-29), D-080, nota 8,8/10 — melhor rodada até agora

Sessão de continuação, prompt de retomada priorizando: (1) fechar o gap residual não-`TENANT#`-
prefixed do `findTenantMismatch` na medida do possível; (2) verificar os 2 fixes BLOQUEANTES de
D-079 (reordenação import-service.ts, asserção de tipo do allowlist) por leitura própria antes de
gastar uma rodada Codex neles; (3) rodar a quarta rodada Codex que a sessão anterior não
conseguiu (orçamento esgotado). Registro completo em `decisions-log.md` D-080.

- **Item 1 (gap residual)**: re-lidos todos os tipos de domínio reais usando chaves não-`TENANT#`
  (`IdentityMapping`, `GuestTokenPointer`, `Session`, `TextractJob`, `LoginAttempt`,
  `GuestRateLimitRecord`) — 4 de 6 DECLARAM `tenantId` no item, então já são cobertos pelo check 1
  existente (`declared tenantId`) se um dia forem roteados por esta lane com um valor forjado.
  Teste adversarial novo prova isso com a FORMA REAL de `GuestTokenPointer` (`GUESTTOKEN#` +
  `tenantId` forjado, rejeitado antes de qualquer write). Só `LoginAttempt` e
  `GuestRateLimitRecord` não têm nenhum dos dois sinais — nenhum dos dois é roteado por
  `executeTenantBusinessMutation`/`tryTenantBusinessMutation` hoje (confirmado por grep, depois
  re-confirmado independentemente pelo Codex na rodada 4). Comentário/teste corrigidos para listar
  as DUAS exceções reais, não só `LoginAttempt` (o Codex pegou essa lacuna de precisão — ver
  abaixo).
- **Item 2 (verificação própria dos fixes D-079)**: lidos com cuidado antes de gastar orçamento
  Codex — `import-service.ts`'s reordenação `begin()`-antes-de-`quota.consume()` com rastreamento
  por-chamada, e `system-mutation-allowlist.test.ts`'s asserções bidirecionais — ambos pareceram
  corretos na leitura própria, sem achado a corrigir antes de invocar o Codex.
- **Item 3 — QUARTA rodada Codex executada com sucesso** (`codex exec --skip-git-repo-check`,
  primeiro plano, prompt em arquivo, sem crases inline) sobre o diff acumulado desde `c496b91`
  (os 2 fixes de D-079) mais o diff desta sessão (o narrowing do item 1). **Nota do Codex:
  8,8/10** — primeira rodada a superar 8,0, ainda abaixo do gate de 9,0 mas por margem pequena.
  **Ambos os fixes de D-079 CONFIRMADOS CORRETOS, sem achado bloqueante remanescente** —
  Codex verificou que `idempotency.begin()` não tem modo de falha que toque quota e que a
  reordenação fecha os 3 vazamentos originais; confirmou que o allowlist bidirecional prova
  fechamento real contra um `kind` novo, não só o sentinela hard-coded anterior.
  **1 achado NÃO-BLOQUEANTE real encontrado**: o narrowing do item 1 desta sessão (antes de rodar
  o Codex) estava incompleto — só listava `LoginAttempt`, mas `GuestRateLimitRecord` (PK
  `GUESTTOKEN#<selectorHash>#RATE`, sem `tenantId`, por design — rate-limit acontece antes do
  token de convidado resolver um tenant) também não tem nenhum dos dois sinais. Codex confirmou
  por grep próprio que nenhum dos dois é roteado por esta lane hoje, então o gap continua não-
  explorável, mas a alegação "a única exceção real" era imprecisa. **Corrigido na mesma sessão**
  (cabeçalho de `tenant-business-mutation.ts` + teste `KNOWN GAP` em `tenant-lifecycle.test.ts`
  agora listam as duas). **1 achado NÃO-BLOQUEANTE adicional, corrigido preventivamente**: uma
  pequena janela de liveness em `reserveImport()` entre `idempotency.begin()` (ACQUIRED) e o
  bloco `try` que já cobria compensação — `newImportJobId()`/cálculo de `jobExpiresAt`/construção
  do objeto `job` ficavam FORA do try; movido para dentro para que `idempotency.abort()` cubra
  essa janela também (nenhuma quota tocada nesse ponto, então não era um dos 3 vazamentos
  originais, mas ainda um wedge real de idempotency key). 1038 testes de backend passando (era
  1037), typecheck/lint/check-boundaries/check-docs limpos, zero regressão.

**Avaliação geral do Codex (rodada 4)**: os 8 mecanismos do fence acumulados até agora (cross-
validation tenant/entries, verificação de PK físico, fechamento do allowlist SystemMutation,
ordenação de compensação import-service, hardening de CancellationReasons, fix TOCTOU do
bootstrap, fix de resume BLOCKED/HELD, compensação de objeto órfão S3) formam "uma defesa
coerente e substancialmente testada"; nenhum achado bloqueante novo de production-readiness.
Recomendação explícita do Codex: uma rodada curta de correção-e-reconfirmação bastaria (as 2
correções que já foram feitas nesta mesma sessão) — **não pediu uma rodada ampla nova**. Notou
que rodadas adicionais sobre este gate específico têm retorno decrescente a partir daqui, a menos
que o time decida substituir o gap residual documentado (2 entidades reais, `LoginAttempt`/
`GuestRateLimitRecord`, sem `tenantId` nem `TENANT#` PK, nunca roteadas por esta lane) por um
redesign estrutural maior (metadados obrigatórios pelos builders, tipo de entrada tenant-branded).

**Estado honesto ao final desta sessão**: quatro rodadas Codex completas (D-072: 5,0; D-075: 6,0;
D-079: 6,0; D-080: 8,8). Os 2 achados não-bloqueantes desta rodada JÁ foram corrigidos (sem nova
rodada Codex confirmando especificamente ESTES 2 fixes — mudança mecânica/documental de baixo
risco, sem nova superfície de comportamento observável, coberta pela suíte existente que passou
sem alteração). Uma quinta rodada Codex especificamente re-checando estes 2 últimos fixes NÃO foi
executada (nem foi pedida pelo Codex — ele endereçou explicitamente que rodadas amplas adicionais
têm retorno decrescente aqui). **Próxima ação real, em ordem de valor esperado**: (a) se o time
quiser tentar cruzar 9,0 formalmente, uma quinta rodada curta confirmando só os 2 fixes desta
sessão é o caminho mais barato, mas o próprio Codex já sinalizou baixo valor incremental; (b) mais
proveitoso agora, por avaliação honesta desta sessão: virar a atenção para outra dimensão do W3-07
— completude dos writers ainda NOT FENCED (ver `w3-07-writer-inventory.md`) ou o sweeper
permanente pós-`DELETED` (ainda não construído) — ao invés de continuar espremendo margem na
mesma gate PK/quota/allowlist que já está em 8,8/10 com achados cada vez mais estreitos e
teóricos; (c) o gap residual de `LoginAttempt`/`GuestRateLimitRecord` fica, como sempre, como
pendência documentada — nenhum call site real o exercita, e fechar de verdade é Type 1/redesign,
não uma sessão de correção mecânica.

## W3-07 — fechamento do achado mais sério de D-075 (2026-08-29), D-076, em andamento

Sessão de continuação, prompt de retomada explícito priorizando 3 itens em ordem: (1) fechar o
gap PK/SK/TableName do `findTenantMismatch` — o achado mais sério do Codex round-2 (D-075,
6.0/10); (2) architecture test provando o allowlist `SystemMutation` fechado; (3) mitigação
barata para admissão parcial em `import-service.ts` se existir uma sem exigir a decisão de
produto. Ver `decisions-log.md` D-076 para o registro completo do item 1.

- **Item 1 FECHADO de verdade (não documentado como pendência)**: `findTenantMismatch` estendido
  com checagem de `TableName` (toda entrada deve bater com `input.tableName`) e checagem de `PK`
  físico contra o padrão universal `TENANT#<tenantId>#...` do modelo de dados — confirmado por
  grep exaustivo que essa convenção é universal para toda entidade tenant-scoped roteada por esta
  lane hoje (as exceções reais — `IDENTITY#cognitoSub#`, `GUESTTOKEN#`, `SESSION#`,
  `LOGINATTEMPT#`, `TEXTRACTJOB#` — nunca são passadas por `executeTenantBusinessMutation`/
  `tryTenantBusinessMutation`, verificado por grep de todos os call sites reais). Fecha
  especificamente o cenário do Codex: `Item.tenantId` forjado batendo com a fence enquanto o `PK`
  real aponta para outro tenant agora é rejeitado antes de qualquer `transactWrite`. **IMPLEMENTED
  + UNIT TESTED** (4 testes novos em `test/unit/tenant-lifecycle.test.ts`). 1026 testes de backend
  passando (era 1023), typecheck/lint/check-boundaries/check-docs limpos, zero regressão.
- Gap residual honesto (documentado no código, não mascarado): uma entrada sem `PK` no padrão
  `TENANT#` E sem `tenantId` declarado ainda passa sem verificação — nenhum call site real produz
  isso hoje, mas a lane não impede estruturalmente que um futuro escritor o faça.
- **Item 2 FECHADO**: `test/architecture/system-mutation-allowlist.test.ts` novo — prova por
  compilação real (`tsc -p tsconfig.json --noEmit`, mesmo comando de `npm run typecheck`) que o
  allowlist `SystemMutationOperation` está fechado: fixture com `kind` fora da união falha a
  compilação; fixture com campo `entries[]` contrabandeado numa operação por outro lado válida
  falha a compilação; controle com as 3 kinds reais compila limpo. Complementa os testes já
  existentes em `test/unit/system-mutation.test.ts` (agora com um segundo `@ts-expect-error`
  específico para `kind` fora da união, e um teste-documentação grep-ável confirmando que nenhum
  orquestrador externo real constrói uma operação hoje). **Achado real corrigido**: dois arquivos
  de teste de arquitetura rodando em paralelo (padrão do vitest) e plantando/removendo fixtures
  reais sob `src/` concorrentemente causavam uma corrida real (`TS6053: File ... not found`
  intermitente) — corrigido com `fileParallelism: false` em `vitest.config.ts`. 1032 testes de
  backend passando (era 1026), typecheck/lint/check-boundaries/check-docs limpos, zero regressão.
- **Item 3 FECHADO (mitigação, não a decisão de produto em si)**: `reserveImport()`'s catch block
  agora libera best-effort a quota (`IMPORT_COUNT`/`IMPORT_BYTES`) e aborta o idempotency record
  quando a criação fenceada do `ImportJob` falha — antes, uma rejeição (fence ou OCC comum) deixava
  a idempotency key presa em `IN_PROGRESS` para sempre e a quota vazada até expirar a janela. A
  admissão parcial em si (quota/idempotency fora da transação fenceada) continua fora da transação
  — isso é a decisão de produto real (trade-off latência-vs-atomicidade) que permanece pendente,
  não forçada. **Achado real corrigido**: `InMemoryImportStore`'s fake de `transactWrite` nunca
  avaliava a condição `#status = :expected` de `idempotency.abort()` nem aplicava seu SET (nomes
  literais, não a convenção `#setN`) — `abort()` "funcionava" sem erro mas não mudava nada,
  mascarando a mitigação nos testes. Generalizado para um parser genérico de condição/update.
  1034 testes de backend passando (era 1032), typecheck/lint/check-boundaries/check-docs limpos.
- **Terceira rodada Codex executada (D-079) — nota 6,0/10, ainda abaixo do gate de 9,0**.
  2 achados BLOQUEANTES reais confirmados: (1) a compensação de `import-service.ts` só cobria a
  criação do job, não os dois `quota.consume()` — replay cobrava quota de novo, e um chamador
  concorrente perdedor vazava quota antes de perder a corrida em `begin()`; (2) o
  architecture-test do allowlist só provava a ausência de UM `kind` sentinela específico, não que
  a união está fechada contra um `kind` genuinamente novo. **Ambos corrigidos na mesma sessão**:
  `reserveImport()` reordenado (`idempotency.begin()` antes de `quota.consume()`, compensação
  agora cobre ambas as reservas de quota com rastreamento por-chamada de qual foi realmente
  consumida); asserções de tipo bidirecionais (`AssertUnionIsSubsetOfApproved`/
  `AssertApprovedIsSubsetOfUnion`) adicionadas contra um allowlist mantido independentemente do
  módulo de implementação, sanity-checadas manualmente (allowlist quebrado de propósito, `tsc`
  falhou como esperado, revertido). Achados NÃO-BLOQUEANTES: 1 overclaim de comentário corrigido
  ("exact object shapes"); TableName confirmado sólido sem bypass; o gap residual de PK não-
  `TENANT#`-prefixed (ex. `GUESTTOKEN#`/`IDENTITY#` com `tenantId` forjado) confirmado como
  limitação real já documentada, não uma regressão — nenhum call site real produz isso hoje.
  1037 testes de backend passando (era 1034), typecheck/lint/check-boundaries/check-docs limpos.
  **UMA QUARTA RODADA CODEX RE-CHECANDO ESTES 2 FIXES NÃO FOI EXECUTADA** — orçamento esgotado
  nesta sessão. A nota 6,0/10 registrada é sobre o estado ANTES destes 2 fixes.

## Estado honesto geral do W3-07 ao final desta sessão (2026-08-29)

Três rodadas Codex completas (D-072: 5,0/10: D-075: 6,0/10; D-079: 6,0/10, mas sobre um diff que
já foi parcialmente re-corrigido na mesma sessão sem nova rodada confirmando). Nenhuma rodada
atingiu o gate de 9,0 do `AGENTS.md` §4 até agora. Padrão observado nas três rodadas: cada
fechamento resolve os achados apontados mas expõe (ou o Codex encontra) uma camada residual mais
sutil — do "tenantId declarado" para "PK físico" para "compensação parcial"/"prova de tipo
insuficiente". Isso sugere que este fence provavelmente precisa de pelo menos **mais 1-2 rodadas
Codex reais** (não só fixes sem reconfirmação) antes de plausivelmente atingir 9,0 — os achados
BLOQUEANTES até agora sempre foram concretos e corrigíveis em menos de uma sessão cada, não
sintomas de um problema estrutural maior, mas o processo de "corrigir sem reconfirmar" (como esta
sessão terminou, por orçamento) é exatamente o padrão que já produziu uma rodada extra cada vez.
**Próxima ação real, em ordem**: (a) rodar uma QUARTA rodada Codex confirmando especificamente os
2 fixes desta sessão (reordenação import-service.ts, asserção de tipo do allowlist) antes de
declarar D-072/D-075/D-079 fechados; (b) se aprovar, considerar se o gap residual de PK não-
`TENANT#`-prefixed (item 1's limitação estrutural remanescente) precisa de uma sessão de design
dedicada antes do próximo marco tocar esse código, ou se pode continuar como pendência documentada
indefinidamente dado que nenhum call site real o exercita hoje.



Sessão de continuação retomada após interrupção por rate limit. Escopo: fechar os achados
deferidos por D-072 (revisão Codex round-1), na ordem de prioridade do prompt de retomada.
Registro completo em `decisions-log.md` D-073 (item 1) e D-074 (itens 2/3/4).

- **Item 1 FECHADO — cross-validation tenant/entries em `TenantBusinessMutation`**:
  `executeTenantBusinessMutation` agora chama `findTenantMismatch(entries, tenantId)` antes de
  qualquer `transactWrite`, lendo o `tenantId` já estampado pelos builders de `occ.ts`
  (`Item.tenantId` em `Put`, `ExpressionAttributeValues[":tenantId"]` em `Update`/`Delete`) e
  rejeitando com `InternalError` se algum valor declarado divergir do `tenantId` fenceado.
  `ConditionCheck` entries (sem convenção de tenantId) são puladas — best-effort, documentado no
  próprio código como não sendo uma prova estrutural completa (só pega mismatch DECLARADO).
  Nenhum call site real precisou de mudança (todos já passavam entries corretamente escopadas).
  **IMPLEMENTED + UNIT TESTED** (3 testes adversariais novos em `test/unit/tenant-lifecycle.test.ts`).
- **Item 2 (overclaim estrutural do boundary) — verificado JÁ CORRIGIDO** na sessão anterior de
  D-072 (commit `94d27e7`, antes desta sessão): `system-mutation.ts`'s cabeçalho já tem uma seção
  "KNOWN LIMIT" precisa. O fechamento estrutural real (porta mais estreita ou architecture-test
  bloqueando `.transactWrite(` fora das lanes) foi reavaliado nesta sessão e confirmado
  desproporcional: `grep` encontra 24 arquivos chamando `.transactWrite(` fora das duas lanes, a
  maioria writers system-triggered legitimamente fora de escopo (purge, reminder workers,
  idempotency) — um architecture-test ingênuo produziria dezenas de falsos positivos. Permanece
  pendência real documentada, não forçado nesta sessão.
- **Item 3 (risco de admissão parcial em `import-service.ts`) — revisado, confirmado NÃO ser bug
  mecânico**: `idempotency.begin()` + 2 reservas de quota seguem fora da transação fenceada que
  cria o `ImportJob`, mesma classe de risco já aceita por design para
  `TenantQuotaService.release()`. Decisão Type 1 sobre unificar numa transação maior fica para o
  dono do produto. Permanece pendência real documentada.
- **Item 4 (hardening de `CancellationReasons` ausente/malformado) FECHADO**:
  `Array.isArray(rawReasons)` adicionado antes de indexar `reasons[fenceIndex]` em
  `executeTenantBusinessMutation` — um adapter hipotético quebrado que populasse
  `CancellationReasons` com um valor não-array agora cai no mesmo fallback seguro
  "trata como fence falhou" que a ausência completa já tinha, em vez de um acesso mal-comportado.
  **IMPLEMENTED + UNIT TESTED** (1 teste adversarial simulando o adapter quebrado).
- **Segunda rodada de revisão Codex executada** sobre o diff D-073/D-074 (D-075) — **nota 6,0/10**
  especificamente sobre o fechamento dos itens 1 e 4 (não uma reavaliação da nota 5,0/10 original
  de D-072 sobre a implementação inteira). Achados reais fechados na mesma sessão: comentário que
  alegava que `buildVersionedCreate`/`buildConditionalPut` "stampam" `tenantId` estava errado
  (esses builders só repassam o item do chamador, não adicionam/exigem `tenantId`) — corrigido;
  teste do "sem tenantId declarado passa" reescrito para nomear explicitamente que é um GAP
  RESIDUAL confirmado, não um default aceitável; cobertura estendida com caso `Delete`; hardening
  do item 4 estendido para validar a FORMA do elemento no índice da fence (não só que
  `CancellationReasons` seja um array) — um array presente mas com elemento malformado no índice
  da fence antes ainda podia relançar o erro original em vez do fallback seguro documentado,
  fechado com 2 testes novos.
- **Achados do Codex conscientemente NÃO corrigidos, documentados como pendência real**: item 1
  continua "bypassável by construction" para um `Put` cujo `Item.tenantId` bate mas cujo `PK`/`SK`
  físico aponta para outro tenant, ou que declara outro `TableName` — limitação estrutural real do
  design "best-effort", não uma regressão; fechar precisaria de metadados obrigatórios impostos
  PELOS PRÓPRIOS builders, validação contra PK/SK+TableName, ou um tipo de entrada tenant-branded
  (Type 1, maior que uma sessão). Sugestão do Codex de um architecture-test allowlist-based para o
  item 2 (mais barato que a redesign completa) avaliada como viável mas não implementada — candidato
  concreto para a próxima sessão dedicada ao item 2. Passos de mitigação de menor esforço sugeridos
  pelo Codex para o item 3 (ordenar idempotency antes da quota, abortar idempotency em falha de
  quota, chaves de reserva únicas por request) registrados mas não implementados — pendência real.
- 1023 testes de backend passando (era 1016), typecheck/lint/check-boundaries/check-docs limpos,
  zero regressão.

**Próxima ação real**: (a) item 2's fechamento estrutural — avaliar o architecture-test
allowlist-based sugerido pelo Codex em D-075 como próximo passo concreto (mais barato que a
redesign completa de porta); (b) item 3 — decisão do produto sobre o trade-off latência vs.
atomicidade em `import-service.ts`, com os passos de mitigação de menor esforço do Codex (D-075)
como ponto de partida; (c) item 1's limitação estrutural residual (PK/SK+TableName não validados)
fica para uma sessão dedicada de design, não uma correção mecânica.

## W3-07 — primeira revisão adversarial Codex + correções (2026-08-29), D-072

Sessão dedicada a review-and-fix, não a novo chunk de migração: rodou a primeira revisão Codex
sobre TODA a implementação acumulada de W3-07 (chunks 2/N-9/N), que nunca tinha sido revisada
apesar de ser Type 1/segurança per `AGENTS.md` §4. Registro completo em `decisions-log.md` D-072;
matriz atualizada + seção de review em `docs/architecture/w3-07-writer-inventory.md`.

- **Nota do Codex: 5,0/10** sobre o código real (o design em si continua aprovado 9,2/9,1 via
  D-066 — esta nota é sobre a fidelidade da implementação ao design, não uma reabertura do design).
- **3 achados bloqueantes reais corrigidos, com teste de regressão cada um**: (1) TOCTOU de
  ressurreição no bootstrap (`bootstrap-identity.ts`'s `ensureProfile()` agora fenced via
  `executeTenantBusinessMutation`, não mais um `putIfAbsent` solto após uma leitura de lifecycle já
  potencialmente obsoleta); (2) resume de `BLOCKED`/`HELD` podia pular estágios do cascade
  confiando no `blockedFrom` alegado pelo CHAMADOR em vez do valor realmente armazenado
  (`system-mutation.ts` agora exige, via `extraCondition` na mesma transação, que o `blockedFrom`
  armazenado bata com o alvo do resume); (3) os workers de evidência só compensavam o objeto `clean`
  órfão na rejeição do fence, nunca numa perda de corrida OCC comum nem numa falha de verificação de
  cópia — confirmado que o bucket `clean` É versionado (`infra/modules/document-buckets/main.tf`),
  então isso deixava versões órfãs reais mesmo em caminhos de sucesso eventual; corrigido para
  compensar em todo resultado não commitado, nos dois arquivos (`advance-after-evidence.ts` e
  `advance-after-submission-evidence.ts`).
- **Achado de doc-drift real corrigido**: `w3-07-writer-inventory.md` tinha 3 linhas desatualizadas
  (SES/evidence-workers/import-reservation ainda diziam NOT FENCED apesar de já migradas em sessões
  anteriores) — corrigido, com o histórico da deriva registrado na própria tabela.
- **Achados reais NÃO corrigidos, documentados como pendência** (ver a seção "Codex round-1
  adversarial review" no final de `w3-07-writer-inventory.md` para o texto completo por item, e
  D-072 para a versão com o framing de severidade do Codex preservado): vários writers já
  documentados como NOT FENCED antes desta revisão (não descobertas novas); a regra
  `no-raw-dynamodb-writes-outside-lanes` + o comentário de `system-mutation.ts` superestimavam o que
  provam (bloqueiam import direto do SDK, não provam que `store.transactWrite(entries)` genérico é
  inalcançável de código de aplicação) — comentário corrigido para não overclaim, fechamento
  estrutural real adiado; `TenantBusinessMutation` não valida que `entries[]` pertence de fato ao
  `tenantId` passado (todos os call sites reais conferem hoje, API não impede um mismatch futuro);
  `import-service.ts`'s reservas de quota/idempotência fora da transação fenced principal
  (admissão parcial possível numa falha no meio, mesma classe de risco já aceita para
  `TenantQuotaService.release()`); `tenant-business-mutation.ts`'s tratamento de `CancellationReasons`
  ausente como fence-failed é conservador mas não hardened contra um adapter hipotético quebrado
  (DynamoDB real sempre populates, risco real baixo).
- 1016 testes de backend passando (era 1011), typecheck/lint/check-boundaries/check-docs limpos,
  zero regressão. Nota do Codex NÃO foi re-solicitada após os fixes (fora do orçamento desta
  sessão) — recomendado como próximo passo antes de retomar novos chunks de migração.

**Próxima ação real**: (a) opcionalmente, uma segunda rodada Codex sobre só o que mudou nesta
sessão, para confirmar os 3 fixes e não introduziram nada novo; (b) continuar o roteiro de writers
ainda NOT FENCED (`ItemWatchService.addWatcher`/`reactivate`, `document-request-service.ts`,
`subject-service.ts`, `run-extraction-validation.ts`'s `commitOrDiscard`, import parse/commit); (c)
o fechamento estrutural real do boundary (porta mais estreita para os stores, ou um architecture
test que bloqueie `store.transactWrite` fora das duas lanes) — Type 1, provavelmente merece seu
próprio design curto antes de implementar; (d) sweeper permanente pós-`DELETED`; (e) email delivery
já fenced, mas SES em si (envio real via provider) segue fora do escopo de W3-07 por definição do
design.

## W3-07 — chunk 9/N implementado nesta sessão (2026-08-29), D-070/D-071 continuação

Alvo único desta sessão (o maior de blast-radius pendente no roteiro): **`ExpirationService.commit()`**.

- **`ExpirationService.commit()` fenced via `TenantBusinessMutation`** — `commit()` é o único
  método privado por onde as 5 mutações públicas (`createItem`/`updateItem`/`archiveItem`/
  `deleteItem`/`renewItem`) já passavam antes desta sessão; ganhou um parâmetro `tenantId` e
  roteia sua `TransactWriteItems` via `executeTenantBusinessMutation`, mesmo padrão de
  `TenantQuotaService.consume()`/`ItemWatchService.removeWatcher`. `TenantNotActiveError` é
  relançado sem alteração (nunca dobrado em `ConflictError("VERSION_CONFLICT")`), preservando a
  lógica de abort de idempotência já existente em `createItem`/`renewItem`. **IMPLEMENTED + UNIT
  TESTED** (5 testes adversariais novos em `test/unit/expiration/expiration-service.test.ts`:
  ACTIVE control case; DELETING rejeita `createItem` sem linha deixada para trás; DELETING rejeita
  `updateItem`/`archiveItem`/`deleteItem`/`renewItem` atomicamente com o estado pré-DELETING do
  item inalterado; um conflito OCC comum em `updateItem` continua `ConflictError`, não confundido
  com a fence — prova o fix de `CancellationReasons` abaixo; um retry de idempotência de
  `createItem` após DELETING ainda retorna o resultado cacheado em vez de ser bloqueado).
- **Blast radius real medido, muito menor que o temido (~600 testes)**: apenas 3 arquivos de teste
  precisaram de seed de `TenantLifecycleRecord` — `expiration-service.test.ts`,
  `reminder-materialization-trigger.test.ts` (seu fixture `MirroredExpirationStore` exigiu seed
  via `expirationStore.putIfAbsent()`, não `store.putIfAbsent()` diretamente, por ter um mapa
  interno próprio herdado além do mirror), e `expiration-lifecycle.test.ts` (mesmo padrão de
  pré-resolver usuários reais via o resolver de bootstrap, já usado no chunk 8/N para
  document/import-handlers). Helper reusável `activeLifecycleRecord(tenantId)` + seed opcional no
  construtor adicionados a `test/unit/expiration/in-memory-store.ts`, mesmo padrão já estabelecido
  em `document/in-memory-store.ts` — evita duplicar um `seedLifecycle()` async por arquivo.
- **Achado real corrigido nesta sessão**: o fake `transactWrite` de
  `test/unit/expiration/in-memory-store.ts` lançava fail-fast sem popular `CancellationReasons`
  (gap já fechado em D-070 para o fake de identity, não replicado aqui) — uma vez a fence ligada,
  isso teria classificado erroneamente QUALQUER conflito OCC comum do chamador (ex.:
  `expectedVersion` obsoleto de `updateItem`) como `TenantNotActiveError` em vez de `ConflictError`;
  corrigido populando `CancellationReasons` por entrada, mesma convenção dos outros fakes,
  provado por teste adversarial dedicado.
- 1011 testes de backend passando (era 1006), typecheck/lint/check-boundaries/check-docs limpos,
  zero regressão. `docs/architecture/w3-07-writer-inventory.md` atualizado (linha de
  `ExpirationService.commit()` + nova seção "chunk 9/N").
- Revisão adversarial Codex desta sessão — não executada, sem orçamento restante (recomendado
  antes do próximo chunk, dado ser a maior migração de blast radius do W3-07 até agora).

**Explicitamente NÃO feito nesta sessão** (pendências reais para o próximo chunk, retomando a
lista já registrada pelo chunk 7/8/N, menos o item agora fechado): sweeper permanente
pós-`DELETED` para o resíduo S3 tardio do Round G; migração de `ExtractionRunStore.putIfAbsent()`
(gap de design genuíno, não reaberto); outbox relay `OUTBOX_BOOKKEEPING`; BFF session table (fora
do alcance estrutural da fence atual); email delivery `SUBMITTING` claim (SES — D-067's política já
decidida, fence de código ainda não implementado); os 4 evidence-mutation workers + ordering fix do
objeto `clean` órfão.

**Próxima ação real**: revisão adversarial Codex sobre a migração de `ExpirationService.commit()`
(maior blast radius do W3-07 até agora); depois continuar o roteiro — email delivery `SUBMITTING`
claim (SES, D-067's política já decidida, menor esforço) ou os 4 evidence-mutation workers, ou o
sweeper permanente pós-`DELETED`.

## W3-07 — chunks 7/N e 8/N implementados nesta sessão (2026-08-29), D-070 continuação

Continuação direta do chunk 6/N (abaixo). Escopo: `GuestSubmissionService` fencing (chunk 7/N) e
presigned URL issuance fencing (chunk 8/N) — os dois itens nomeados no prompt desta sessão.
Commits `693b393` (chunk 7/N) e o commit deste chunk 8/N (ver `git log`), ambos pushed para
`develop`.

- **`GuestSubmissionService.startSubmission()` fenced** (chunk 7/N) — routes its own
  `transactWrite` (Put DocumentSubmission + Update DocumentRequest) through
  `executeTenantBusinessMutation`. Guest-token validation logic untouched. `TenantNotActiveError`
  is folded into the existing generic `GuestTokenInvalidError` (anti-enumeration — this is a
  public unauthenticated surface, a DELETING tenant must not be a distinguishable oracle from an
  invalid/expired token). **IMPLEMENTED + UNIT TESTED** (2 new adversarial tests in
  `test/unit/subject/guest-upload-flow.test.ts`: ACTIVE control case, DELETING with a
  still-VALID/non-expired guest token proving the fence — not token expiry — is what blocks the
  write, with no partial write left behind).
- **Presigned URL issuance fenced for `document-service.ts`/`import-service.ts`** (chunk 8/N) —
  **deviates from this session's literal instruction** ("read-then-check before presign, not a
  transaction") after real code inspection found both call sites already have (or were trivially
  convertible to) their own tenant-scoped DynamoDB write immediately before the presign call:
  `DocumentService.reserveUpload`'s existing Document+UploadSlot `transactWrite`, and
  `ImportService.reserveImport`'s previously-unfenced bare `putIfAbsent` ImportJob creation
  (converted to a 1-entry `TransactWriteItems` via `buildVersionedCreate`). Fencing THOSE writes
  via `executeTenantBusinessMutation` (the established pattern) is strictly more correct than a
  separate unfenced read-check bolted on right before `presignUpload()` — no separate TOCTOU
  window, and it closes a real writer-inventory gap the design doc's own row had missed (these
  writes were never fenced, only the presign-issuance QUESTION had been analyzed). Idempotent
  retries (`COMPLETED_SAME_REQUEST`, no new write) are correctly NOT re-fenced, consistent with
  the "admitted while ACTIVE may finish" contract already established for other writers. The
  residual TTL-window risk (an already-issued URL usable until its TTL after DELETING starts)
  remains accepted and UNCHANGED — this session does not attempt to revoke already-issued
  presigned URLs, per the approved design's explicit position. `GuestSubmissionService`'s presign
  is covered transitively by chunk 7/N's fence on the same transaction. **IMPLEMENTED + UNIT
  TESTED** (ACTIVE control case + DELETING adversarial test per call site, in
  `test/unit/document/document-service.test.ts` and `test/unit/import/import-service.test.ts`).
- **Real gap found in `test/unit/import/in-memory-store.ts`**: its `transactWrite` fake never
  evaluated `ConditionCheck` entries at all (only `"Put"`/`"Update"` branches existed) — a
  lifecycle fence routed through this fake would have been silently accepted unconditionally,
  meaning the new fence would have shipped with zero real test coverage. Extended to evaluate
  `ConditionCheck` with the same `CancellationReasons`-aware convention as every other module's
  fake (`subject`/`document`/`notification`).
- **Test-harness gap found and fixed**: `document-handlers.test.ts`/`import-handlers.test.ts`
  exercise the REAL `RequestContextResolver` bootstrap flow (dynamic tenantId, not hardcoded), but
  their `DocumentStore`/`ImportStore` in-memory fakes are SEPARATE Maps from the `IdentityStore`
  fake that receives the bootstrap's `TenantLifecycleRecord` write — in production these share one
  physical table, in these tests they don't. Fixed by pre-resolving the default `claims()` identity
  once in `buildDeps()` to learn the bootstrapped `tenantId`, then mirroring an ACTIVE lifecycle
  record into the module-specific store fake too.
- 1006 backend tests passing (era 1002), typecheck/lint/check-boundaries/check-docs limpos, zero
  regressão. `docs/architecture/w3-07-writer-inventory.md` atualizado (GuestSubmissionService row
  + presigned upload issuance row).
- Revisão adversarial Codex desta sessão — não executada, sem orçamento restante (recomendado
  antes do próximo chunk, especialmente sobre a fence de presign issuance dado o desvio da
  instrução literal desta sessão, e sobre `GuestSubmissionService`, o item de maior risco por ser
  superfície pública).

**Explicitamente NÃO feito nesta sessão** (pendências reais para o próximo chunk, retomando a
lista já registrada pelo chunk 6/N, menos os 2 itens fechados agora): sweeper permanente
pós-`DELETED` para o resíduo S3 tardio do Round G; migração de `ExtractionRunStore.putIfAbsent()`
(gap de design genuíno, não reaberto); `ExpirationService.commit()` (maior blast radius pendente);
outbox relay `OUTBOX_BOOKKEEPING`; BFF session table (fora do alcance estrutural da fence atual).
`ImportService.requestCommit()`'s own `transactWrite` (status `PREVIEW_READY`→`COMMITTING`) was
inventoried but NOT fenced this session — it resolves an already-admitted job, not a new
admission, same reasoning as `TenantQuotaService.release()`.

**Próxima ação real**: revisão adversarial Codex sobre a fence de presign issuance (chunk 8/N,
maior risco desta sessão por desviar da instrução literal) e/ou sobre `GuestSubmissionService`
(chunk 7/N, superfície pública); depois continuar o roteiro — `ExpirationService.commit()` com um
helper de seed compartilhado para as ~600 chamadas de teste existentes, ou o sweeper permanente
pós-`DELETED`.

## W3-07 — chunks 5/N e 6/N implementados nesta sessão (2026-08-29)

Continuação direta do chunk 4/N (abaixo). Escopo desta sessão: os 3 itens do roteiro
"Recommended next chunk" do writer inventory, na ordem recomendada — commits separados,
`develop` pushed após cada um (`f60f2f5`, `d35c4fe`, `0f14fac`).

- **SES `SUBMITTING` claim fenced** (`email-delivery-workflow.ts`, D-067's já decidida política
  Opção 1) — `tryFencedSubmittingClaim` roteia a claim SUBMITTING via `executeTenantBusinessMutation`;
  toda outra transição no arquivo (RECONCILE_UNKNOWN/NOT_SENT_STALE/status final pós-SEND) resolve
  uma admissão já feita, não fica fenced (mesmo contrato de `quota.consume()`). Novo outcome
  `SKIPPED_TENANT_NOT_ACTIVE`. `InMemoryNotificationStore` ganhou avaliação de `ConditionCheck` +
  `CancellationReasons`. **IMPLEMENTED + UNIT TESTED** (3 testes adversariais: ACTIVE control case,
  DELETING rejeitado atomicamente sem escrita parcial, admissão-enquanto-ACTIVE permitindo o send
  completar mesmo com DELETING chegando antes da chamada real ao SES).
- **4 evidence-mutation workers fenced** (`upload-finalizer`, `submission-finalizer`,
  `malware-result`, `submission-malware-result`) + `advance-after-evidence.ts`/
  `advance-after-submission-evidence.ts` (Round F: uploadEvidence/malwareEvidence/REJECT/PROMOTE
  são todos `TenantBusinessMutation`, não só o `CLEAN` final). Novo helper compartilhado
  `tryTenantBusinessMutation` (`tenant-business-mutation.ts`) — resultado discriminado
  ok/OCC_CONFLICT/TENANT_NOT_ACTIVE para chamadores com retry loop próprio. **Ordering bug do
  Round F/G fechado via compensação imediata**: a cópia S3 para `clean` acontece antes do commit
  fenced — numa rejeição `TENANT_NOT_ACTIVE` especificamente, o objeto `clean` recém-copiado é
  deletado (best-effort) em vez de ficar órfão. Isso NÃO fecha a corrida residual do Round G (uma
  operação admitida antes de DELETING que só cria seu objeto S3 depois da varredura final da
  purga) — esse resíduo continua exigindo o sweeper permanente pós-`DELETED` (design §O-6 item 1c,
  reusar padrão `DocumentPurgeWorker`/D-061), **não tentado nesta sessão, ainda pendente**.
  `InMemoryDocumentStore`/`InMemorySubjectStore` (fakes) ganharam a mesma avaliação de
  `ConditionCheck`+`CancellationReasons` — sem isso, uma corrida OCC comum entre dois workers de
  evidência era classificada erroneamente como rejeição de fence, quebrando os testes de
  regressão de corrida pré-existentes assim que o fence foi ligado. **IMPLEMENTED + UNIT TESTED**
  (13 testes adversariais novos: ACTIVE/DELETING por ponto de admissão + 2 testes explícitos de
  compensação de órfão, variante Document e DocumentSubmission).
- **Bug de determinismo da key S3 do OCR corrigido** (`s3-ocr-artifact-store.ts`) —
  `ocr/<runId>/<randomUUID()>.json` (sufixo aleatório a cada chamada, cada redelivery de
  `COMPLETE_OCR` criava um objeto órfão novo) virou `ocr/<tenantId>/<runId>.json` (determinístico,
  redelivery do mesmo run sempre sobrescreve o mesmo objeto). `OcrArtifactStore.put()` ganhou
  parâmetro `tenantId`; único call site real (`complete-ocr.ts`) atualizado. **IMPLEMENTED + UNIT
  TESTED** (`test/unit/extraction/s3-ocr-artifact-store.test.ts`, novo: determinismo, regressão de
  redelivery pós-falha-no-SendTaskSuccess landing na mesma key, não-colisão entre tenants
  diferentes com o mesmo runId).
- 1000 testes de backend passando (era 981), typecheck/lint/check-boundaries/check-docs limpos,
  zero regressão. Revisão adversarial Codex desta sessão — não executada, sem orçamento restante
  (recomendado antes do próximo chunk, especialmente sobre a fence do SES e a compensação de
  órfão do S3, os dois itens de maior risco desta sessão).

**Explicitamente NÃO feito nesta sessão** (pendências reais para o próximo chunk): sweeper
permanente pós-`DELETED` para o resíduo S3 tardio do Round G (mencionado acima); migração de
`ExtractionRunStore.putIfAbsent()` (gap de design genuíno já registrado no chunk 4/N, não
reaberto); `ExpirationService.commit()` (maior blast radius pendente); `GuestSubmissionService`;
outbox relay `OUTBOX_BOOKKEEPING`; BFF session table (fora do alcance estrutural da fence atual).

**Próxima ação real**: revisão adversarial Codex sobre SES fencing + compensação de órfão S3
(maior risco desta sessão); depois continuar o roteiro — `ExtractionRun` retry-vs-fresh-admission
como nota de design curta, ou `ExpirationService.commit()` com um helper de seed compartilhado
para as ~600 chamadas de teste existentes.

## W3-07 — chunk 4/N implementado nesta sessão (2026-08-29), D-070

Continuação direta do chunk 3/N (D-069, abaixo). Escopo desta sessão: Parte 1 (inventário real de
writers) e Parte 2 (migração dos admission points de maior valor).

- **Inventário real**: `docs/architecture/w3-07-writer-inventory.md` — matriz writer/admission
  point/transaction boundary/fence status/late-result behavior/test coverage, construída de grep
  real contra `src/**` mais o inventário já levantado nas Rodadas F/G do design aprovado. Cobre
  expiration, documents, document submissions, guest submissions, requirements, extraction/OCR/
  Bedrock, imports, upload promotion workers, SES, quota, outbox, reminders, BFF session table.
- **`TenantQuotaService.consume()` migrado para `TenantBusinessMutation`** — maior valor de
  segurança nomeado pelo roteiro (admissão real antes de todo Textract/Bedrock pago) e achado novo
  desta sessão: também é a admissão `API_REQUEST` genérica na frente de `authorize()` na maioria
  dos handlers HTTP, tornando o blast radius real desta migração o maior já visto no W3-07 (8
  arquivos de teste precisaram de seed de `TenantLifecycleRecord`, vs. 1 em D-068). Create path
  (`putIfAbsent`) e update path (`updateConditional`) viraram uma `TransactWriteItems` de 1 entrada
  via `executeTenantBusinessMutation`, usando um builder novo (`buildConditionalPut` em `occ.ts`)
  em vez de `ConditionExpression` manual — preserva exatamente a lógica de negócio/janela/reset
  existente, só muda a fronteira transacional. `release()` permanece deliberadamente NÃO fenced
  (compensa uma reserva já admitida, não é uma admissão nova — fenced ela travaria a reserva para
  sempre num tenant DELETING). **IMPLEMENTED + UNIT TESTED** (3 testes adversariais novos:
  create-path DELETING rejeitado sem linha deixada para trás, update-path DELETING rejeitado com
  `count` inalterado, ACTIVE control case).
- **Achado real corrigido nesta sessão (não pedido explicitamente, descoberto testando a
  migração)**: `executeTenantBusinessMutation` não distinguia "fence de lifecycle falhou" de "a
  própria entrada do chamador perdeu uma corrida OCC comum" — gap documentado desde D-068 no
  cabeçalho do próprio arquivo (`CancellationReasons` não lido), sem efeito observável em
  `ItemWatchService.removeWatcher` (escrita de tentativa única, sem loop de retry do chamador), mas
  quebrava silenciosamente o loop de 20 tentativas de `consume()` sob contenção real — o teste de
  concorrência pré-existente (`does not lose updates under concurrent consume()`) pegou isso na
  hora: 25 chamadas concorrentes passavam todas em vez de exatamente `limit`, porque toda corrida
  OCC virava `TenantNotActiveError` (nunca retentada) em vez de retry. Corrigido lendo
  `TransactWriteItems.CancellationReasons` real da AWS — a fence é sempre a última entrada
  (`input.entries.length`), só um `ConditionalCheckFailed` nesse índice específico vira
  `TenantNotActiveError`, qualquer outra falha relança o erro original para o chamador tratar. O
  fake `InMemoryIdentityStore` (`test/unit/identity/in-memory-store.ts`) foi estendido para popular
  `CancellationReasons` do mesmo jeito que a AWS real, então esse caminho é exercitado por teste,
  não só raciocinado — real risco de regressão silenciosa se algum writer futuro reusar a lane sem
  esse fix.
- 981 testes de backend passando (era 978), typecheck/lint/check-boundaries/check-docs limpos,
  zero regressão.

**Explicitamente NÃO feito nesta sessão** (pendências reais para o próximo chunk):
- SES (claim `SUBMITTING` em `email-delivery-workflow.ts`) — política já decidida (D-067, Opção
  1), só falta o código. Inventariado, não migrado — próximo passo de menor esforço (mesmo padrão
  de conversão de escrita condicional de item único → transação de 1 entrada que `quota.consume()`
  acabou de estabelecer).
- `ExtractionRunStore.putIfAbsent()` — tentativa real de análise nesta sessão encontrou um gap de
  design genuíno, não um gap de implementação apressada: retry de um run já admitido precisa
  continuar chamando `StartExecution` sem exigir nova admissão ACTIVE (comportamento correto hoje,
  via idempotência do nome de execução), e distinguir "isto é retry" de "isto é admissão nova"
  dentro da mesma transação fenced reintroduziria o TOCTOU que a fence existe para fechar.
  Registrado como pendência de design real, ver `docs/architecture/w3-07-writer-inventory.md`
  seção "Why ExtractionRun admission was not migrated this session".
- As 4 evidence-mutation workers (`upload-finalizer`, `submission-finalizer`, `malware-result`,
  `submission-malware-result`) + o ordering bug real da Rodada F (cópia S3 para `clean` acontece
  ANTES do commit DynamoDB fenced) — inventariados, não corrigidos.
- `ExpirationService.commit()` continua o maior blast-radius pendente (~600 testes existentes
  precisariam de seed de lifecycle) — não tentado nesta sessão.
- `GuestSubmissionService`, outbox relay (`SystemMutation` `OUTBOX_BOOKKEEPING`), BFF session
  table (estruturalmente fora do alcance da fence atual — tabela física separada) — sem progresso.
- Revisão adversarial Codex desta sessão — sem orçamento restante.

**Próxima ação real**: migrar SES (menor esforço, política já decidida) e/ou as 4 evidence-mutation
workers (achado real de Rodada F com correção já desenhada via `CancellationReasons`). Ver
`docs/architecture/w3-07-writer-inventory.md` seção "Recommended next chunk" para a ordem completa.

## W3-07 — chunk 3/N implementado nesta sessão (2026-08-29), D-069

Continuação direta do chunk 2/N (D-068, abaixo). Escopo desta sessão: roteiro `Q` item 2 (conclusão — lane `SystemMutation`) e item 3 (boundary estrutural completo).

- **Lane `SystemMutation`** — `src/shared/tenant-lifecycle/system-mutation.ts`: allowlist fechada por união discriminada (`LIFECYCLE_TRANSITION`/`PURGE_DELETE`/`OUTBOX_BOOKKEEPING`). `executeSystemMutation` NUNCA aceita um `TransactWriteEntry[]` do chamador — só a operação tipada; a função constrói o array internamente via `occ.ts`. `transitionTenantLifecycle` é o primitivo real e testado que um futuro orquestrador (Step Functions/Lambda, não construído nesta sessão) vai chamar para mover `TenantLifecycleRecord.status` (ex.: `ACTIVE→DELETING`) — OCC-fenced na versão do registro, valida via `assertValidTransition` antes de tocar o store, e ainda reafirma o status atual via `ConditionCheck` extra. `PURGE_DELETE`/`OUTBOX_BOOKKEEPING` são membros reservados do allowlist (tipados, mas lançam `SystemMutationNotImplementedError` — nenhum call site real ainda precisa deles). **IMPLEMENTED + UNIT TESTED** (8 testes em `test/unit/system-mutation.test.ts`, incluindo transição ilegal recusada em processo antes de tocar o store, conflito OCC de versão stale, BLOCKED/HELD com resume, isolamento cross-tenant, e um `@ts-expect-error` provando a contenção também em nível de tipo).
- **Boundary estrutural (roteiro `Q` item 3, pendência explícita deixada por D-068)** — regra nova `no-raw-dynamodb-writes-outside-lanes` em `.dependency-cruiser.cjs`: confina import de `PutCommand`/`UpdateCommand`/`DeleteCommand`/`TransactWriteCommand`/`BatchWriteCommand` (`@aws-sdk/lib-dynamodb`) a `src/modules/*/persistence/`, `src/modules/*/composition/` (só um arquivo real hoje, `extraction/composition/extraction.ts`, import tipo-only do `DynamoDBDocumentClient` para wiring — inventariado, não um write real), `src/shared/dynamodb/`, `src/shared/outbox/persistence/`. Qualquer outro arquivo em `src/modules/**`/`src/shared/**` que importe esse pacote falha `npm run check-boundaries` (já gatilhado no CI). **Prova real, não só declarada**: `test/architecture/tenant-fence-boundary.test.ts` (categoria nova `test/architecture/`, adicionada a `vitest.config.ts`) planta 3 fixtures reais em `src/` — `PutCommand` direto num item tenant-scoped, `TransactWriteCommand` sem `ConditionCheck` de lifecycle, `BatchWriteCommand` em `src/shared/` fora de `dynamodb/`/`outbox/persistence/` — roda o `depcruise` real (mesmo binário/config do `check-boundaries`) contra `src`, confirma a violação nomeada + caminho do arquivo no output, e remove os fixtures em `finally`/`afterEach` (mais `beforeAll` de segurança contra uma sessão anterior interrompida). ESLint não foi estendido — não há um padrão `no-restricted-imports` equivalente que acrescentasse poder de detecção aqui (dependency-cruiser já é a "AUTHORITATIVE boundary check" segundo o comentário existente em `.eslintrc.cjs`); a defesa em profundidade já citada no `AGENTS.md`/`.eslintrc.cjs` continua a mesma dupla (dependency-cruiser autoritativo + ESLint só feedback de editor para os 3 boundaries já cobertos), sem um quarto boundary duplicado ali.
- 978 testes de backend passando (111 arquivos, era 965), typecheck/lint/check-boundaries/check-docs limpos, nenhuma regressão.

**Explicitamente NÃO feito nesta sessão** (pendências reais para o próximo chunk, nenhuma mascarada):
- Migração dos demais writers tenant-scoped já listados em D-068 (`ExpirationService.commit()` e tudo que passa por ele, `GuestSubmissionService`, `TenantQuotaService.consume()`, `ExtractionRunStore.putIfAbsent()`, claim `SUBMITTING` de `email-delivery-workflow.ts`) — continua pendente, sem progresso nesta sessão.
- Nenhum orquestrador real chama `transitionTenantLifecycle` — o primitivo existe e está testado isoladamente, mas não há endpoint/worker/state machine que o invoque contra um tenant real (mesma pendência que D-068 já registrava para "transição de lifecycle real").
- `PURGE_DELETE`/`OUTBOX_BOOKKEEPING` do `SystemMutation` continuam sem implementação real — reservados no allowlist, sem call site.
- Sweeper permanente pós-`DELETED` (roteiro `Q` item 5, reusa padrão `DocumentPurgeWorker`/D-061) — não iniciado.
- Cutover em duas fases do marcador `admittedWhileActive` em `ExtractionRun` (roteiro `Q` item 4) — não iniciado.
- Inventário empírico de `ListObjectVersions`/`ListMultipartUploads` contra buckets reais, ensaio de migração em `dev` (roteiro `Q` item 6) — não iniciado.
- Revisão adversarial Codex desta sessão — sem orçamento restante; recomendado antes de dar a `SystemMutation` novos call sites reais (`PURGE_DELETE`/`OUTBOX_BOOKKEEPING` são as operações de maior privilégio do sistema, maior valor de escrutínio antes de crescerem).

**Próxima ação real**: continuar o roteiro `Q` — item 4 (cutover em duas fases do marcador `ExtractionRun`) ou retomar a migração de writers de D-068 (`ExpirationService.commit()`, maior blast radius). Considerar rodar Codex adversarial sobre `SystemMutation` antes de implementar `PURGE_DELETE`/`OUTBOX_BOOKKEEPING` de verdade.

## W3-07 — chunk 2/N implementado nesta sessão (2026-08-29), D-068

Continuação da sessão de implementação anunciada no fim da seção W3-07 abaixo (roteiro de 6 itens em `claude-analysis-active-only-fence.md` §Q). Este chunk cobriu os itens **A/B/C** do roteiro combinado nesta sessão — ver D-068 em `docs/architecture/decisions-log.md` para o registro completo:

- **A. `TenantLifecycleRecord` real em código** — `src/shared/tenant-lifecycle/tenant-lifecycle-record.ts`: máquina de estados forward-only (`ACTIVE→DELETING→QUIESCING→PURGING→VERIFIED→DELETED`, mais `BLOCKED`/`HELD`), `canTransition`/`assertValidTransition`, nunca reverte a `ACTIVE`, nunca sai de `DELETED`. **IMPLEMENTED + UNIT TESTED** (14 testes, `test/unit/tenant-lifecycle.test.ts`).
- **B. Bootstrap atômico** — `src/modules/identity/application/bootstrap-identity.ts`'s `TenantBootstrapService`: `IdentityMapping`+`TenantLifecycleRecord(ACTIVE)`+`User` numa única `TransactWriteItems`. Substitui o `findOrCreate`+`createProfileIfAbsent` sequencial de `RequestContextResolver` (o bug central confirmado em D-063 — resolver resuscitando tenant sozinho). Nunca reprovisiona `User` se o lifecycle for DELETING/DELETED (resolver agora lança `AuthenticationError`). Corrida de dois primeiros logins concorrentes, retry após perder a corrida, idempotência de login repetido, e backfill best-effort de tenants pré-migração (mapping sem lifecycle) como ACTIVE — todos cobertos. **IMPLEMENTED + UNIT TESTED** (13 testes novos em `test/unit/identity/resolver.test.ts`, mais os 5 testes pré-existentes do resolver continuam verdes).
- **C. Lane `TenantBusinessMutation`** — `src/shared/tenant-lifecycle/tenant-business-mutation.ts`'s `executeTenantBusinessMutation`: acrescenta um `ConditionCheck` (via `buildExistenceConditionCheck` de `occ.ts` — nunca `ConditionExpression` manual) contra `TenantLifecycleRecord.status = ACTIVE` na MESMA `TransactWriteItems` do chamador. Lança `TenantNotActiveError` quando a transação cancela. **Um writer real migrado como prova de ponta a ponta**: `ItemWatchService.removeWatcher` (`src/modules/expiration/application/item-watch-service.ts`) — escolhido por ter seu próprio `transactWrite` isolado, sem tocar `ExpirationService.commit()` (usado por `createItem`/`updateItem`/`renewItem`/etc., que teria quebrado ~600 testes existentes sem seed de lifecycle em cada um). Teste adversarial explícito: mutação aceita com lifecycle ACTIVE, **rejeitada atomicamente** (nenhuma escrita parcial) com lifecycle DELETING. **IMPLEMENTED + UNIT TESTED** (9 testes em `test/unit/expiration/item-watch-service.test.ts`, incluindo o par ACTIVE/DELETING; mais 6 testes gerais da lane em `test/unit/tenant-lifecycle.test.ts`, incluindo isolamento cross-tenant e rejeição de chamada com zero entries).

**Explicitamente NÃO feito nesta sessão** (pendências reais para o próximo chunk, nenhuma mascarada):
- Migração dos demais writers tenant-scoped: `ExpirationService.commit()` (usado por praticamente todo writer do módulo expiration — `createItem`, `updateItem`, `archiveItem`, `renewItem`), `ItemWatchService.addWatcher`/`reactivate`, `GuestSubmissionService`, `TenantQuotaService.consume()` (`updateConditional` de item único → `TransactWriteItems` de 2 itens, conforme D-066 Rodada E), `ExtractionRunStore.putIfAbsent()`/`StartExecution`, a claim `SUBMITTING` de `email-delivery-workflow.ts` (envio SES, política já decidida em D-067/Opção 1 — falta implementar).
- Boundary estrutural (arquitetura test/ESLint) que impeça bypass da lane chamando `store.transactWrite([...])` direto — roteiro `Q` item 3, hoje a lane é convenção, não é estruturalmente inforjável.
- Worker real de transição de lifecycle (`ACTIVE→DELETING` disparado por uma solicitação DSR real) — hoje só é possível mudar o status manualmente/via teste, não há endpoint/worker.
- Sweeper permanente pós-`DELETED` (reusar padrão `DocumentPurgeWorker`/D-061).
- Cutover em duas fases do marcador `admittedWhileActive` em `ExtractionRun`.
- Inventário empírico de `ListObjectVersions`/`ListMultipartUploads` contra buckets reais, ensaio de migração em `dev`.
- Revisão adversarial Codex desta sessão — sem orçamento restante após A/B/C+testes; recomendado como próximo passo de qualidade antes de migrar mais writers, especialmente para escrutinar a lane `TenantBusinessMutation` quanto a bypass (conforme sugerido no prompt original desta sessão).

Commits desta sessão em `develop`, `npm run typecheck`/`lint`/`check-boundaries`/`check-docs` limpos, 965 testes de backend passando (109 arquivos), zero regressão.

**Próxima ação real**: continuar o roteiro `Q` migrando `ExpirationService.commit()` (o writer de maior blast radius, portanto o de maior valor de segurança) para a lane, com o mesmo cuidado de seed de `TenantLifecycleRecord` nos testes existentes já demonstrado aqui; depois `TenantQuotaService.consume()` (admissão real antes de Textract/Bedrock, D-066 Rodada E); depois o boundary estrutural (item 3). Considerar rodar Codex adversarial sobre a lane antes de expandir sua superfície de uso.

## Estado atual

**Consolidation + Pilot Readiness Program — Waves 0/2/3/5 concluídas, Wave 4 parcial (gated), Wave 1 não iniciada (2026-08-28)**: Marcelo trouxe `expiration-tracker-next-days-master-plan-and-ai-prompt.md` (raiz, commit `4b547ab`) como handoff para um programa multi-sessão de consolidação/pilot-readiness. **Backlog canônico item-a-item: `docs/engineering/pilot-readiness-program.md`. Síntese final/recomendação GO-CONDITIONAL-NOGO: `docs/engineering/pilot-readiness-assessment.md`** (entregável do prompt mestre §42, com addendum de 2026-08-28 refletindo o fechamento da Wave 2/5) — não duplicar detalhe aqui, só apontar para os dois.

Resumo ultra-compacto (ver os dois documentos acima para tudo): Wave 0 (reconciliação) `DONE`. **Wave 2 (evidência operacional) `DONE`** (2026-08-28) — os 6 drills (W2-03 a W2-08) executados com evidência real contra `dev`: kill switch M7, pipeline de lembretes fim a fim, DLQ/replay, restore PITR real (RTO ≈3min44s, RPO não medido — item aberto), load test real (977 invocações, cota `API_REQUEST` segurando sob carga), alarme forçado com notificação SNS→e-mail real confirmada. **RPO (W2-06), dedupe pós-commit (W2-05) e o pipeline de alarme do W2-08 fechados na mesma sessão (2026-08-28)** — ver `pilot-readiness-program.md` seção Wave 2 para o detalhe completo (inclui o achado real de que "credential-compromise via HTTP" é estruturalmente inalcançável hoje, não uma lacuna). Claims específicas por drill: ver `docs/engineering/test-engineering-standard.md` §5. Wave 3 (tenant isolation + LGPD) `DONE` de ponta a ponta — zero vulnerabilidade cross-tenant real encontrada. **`W3-06-DECISION` fechada e implementada nesta sessão (2026-08-28)**: desenho do mecanismo de purga real de `USER_DOCUMENT` aprovado via protocolo Claude↔Codex completo (6 rodadas, Codex 9,2/Claude 9,1, D-061 em `decisions-log.md`) e implementado de ponta a ponta — `DocumentPurgeWorker` real (claim/lease sobre GSI6, apaga o objeto S3 real via `cleanObject`/evidência — nunca `quarantineObject` — e a linha `Document`, grava `DocumentPurgeReceipt` não sensível), agendado a cada 6h, verificado com `terraform plan`/`terraform test` reais contra `dev` (ver `docs/architecture/reviews/w3-06-user-document-purge-design/`). Wave 4 (Identity/RBAC) `PARTIAL` — confirmado que `tenantId=userId` hoje, RBAC real gated por decisão de negócio já registrada (`AGENTS.md` §1). **Wave 5 (GTR-01) `DONE`** (2026-08-28) — `UserProfile.requesterDisplayName` + `GET/PUT /profile` + guest-facing surfaces (`GuestSubmissionService.getRequestInfo`, 2 templates de e-mail) implementados de ponta a ponta, commit `7dacbac`, D-060 em `decisions-log.md`. Wave 1 (Design System) deliberadamente não iniciada, aguardando o Marcelo atualizar o Design System formal. **W2-01-DECISION**: implementado nesta sessão (2026-08-28) — auto-confirm agora escreve `dueDate` automaticamente, commit `e9f2439`, D-058.

**Test Engineering Standard — novo, APPROVED (2026-08-28)**: `docs/engineering/test-engineering-standard.md`, padrão normativo world-class para validade/qualidade de teste automatizado E drill operacional (chaos/DiRT) — gates binários (G-V1..G-V6, G-C1), critérios ponderados com fórmula de agregação, auditoria retroativa precisa da Wave 2. Protocolo Claude↔Codex de **8 rodadas** contra gate elevado a 9,5/10 (pedido explícito do Marcelo, acima do 9,0 padrão) — trajetória Codex 6.35→7.85→8.70→9.18→9.34→9.46→9.48→**9.62** (aprovado), Claude final 9.9/10. E-010 em `docs/engineering/decisions-log.md` (distinto de `docs/architecture/decisions-log.md`, que usa numeração D-0xx). Evidência completa em `docs/engineering/reviews/test-engineering-standard/`. **Este padrão vale para qualquer teste/drill novo a partir de agora** — antes de declarar um teste ou drill "concluído", checar contra os gates de §3 (nunca reversão silenciosa, nunca claim mais ampla que a evidência).

**Recomendação da síntese final** (addendum 3/2026-08-28 em `pilot-readiness-assessment.md`): os três gates reais nomeados na síntese original — guest trust (`GTR-01`/`W5-01`), evidência operacional (Wave 2), e retenção/purga real (`W3-06`) — **fecharam todos nesta sessão**, e todos os itens secundários de Wave 2 (RPO, dedupe pós-commit, pipeline de alarme de credential-compromise) também fecharam na mesma sessão. Único item não-bloqueante restante: DSR completo (W3-07, pode reusar o mesmo mecanismo GSI6 claim/lease do W3-06).

954 testes de backend (era 928, +12 do worker de purga +14 de `occ.ts`/deleção), `typecheck`/`lint`/`check-boundaries`/`check-docs`/`validate-schemas` limpos, `terraform test` real (15/15) e `terraform plan` real contra `dev` verdes, incluindo o módulo `document_purge_handler` novo. **`W3-06` fechado** (desenho + implementação real, D-061), **todos os drills remanescentes da Wave 2 fechados na mesma sessão** (W2-06 RPO, W2-05 dedupe pós-commit, W2-08 pipeline de alarme). **W3-07 (cascata DSR) tentado duas vezes nesta sessão, nenhuma aprovada**: (1) D-062, 4 rodadas Claude↔Codex, notas 3,4→5,1→4,7/10 — achado central: garantir "não ressurreição" exige um fence de `TenantStatus` em todo write path (HTTP+guest+workers assíncronos); Claude e Codex recomendaram convergentemente não implementar sem esse fence, e a sessão parou por decisão do Marcelo. (2) O Marcelo então decidiu NÃO esperar gatilho comercial ("se precisamos, temos que desenvolver") e pediu para retomar com o fence dentro do escopo desde o início — D-063, Rodada 1: nota 3,2/10, **pior** que a tentativa anterior. Achado mais grave desta rodada: o fence proposto (reusar `User.status`, já existente e já checado em `resolveRequestContext`) seria apagado pela própria cascata, e o resolver re-provisiona automaticamente um `User ACTIVE` no próximo login — o mecanismo de autenticação ressuscitaria o tenant sozinho. **Pausado por pedido explícito do Marcelo para planejamento minucioso numa sessão dedicada** (não abandonado). **W3-07 update (2026-08-28, sessão de análise/arquitetura, D-066, GATE DE 9,0 ATINGIDO em 6 rodadas)**: uma análise externa propôs abandonar o protocolo "claim+outcome" universal de D-065 (nunca convergiu, travou em 4,8/10) por um fence `ACTIVE`-only. Sessão rodou 6 rodadas reais de crítica adversarial do Codex com reconciliação de Claude entre elas, a pedido explícito do Marcelo de continuar até o gate ou até ficar demonstrável que é inatingível: **7,8 → 8,4 → 8,8 → 8,9 → 8,8 → 9,2/10** (progresso não-monótono e honesto — uma queda real na penúltima rodada quando escrutínio mais rigoroso achou 2 furos novos, nunca maquiado). **Nota final: Codex 9,2/10, Claude 9,1/10 — gate atingido sem arredondamento. Decisão: `APPROVED WITH CONDITIONS`.**

Direção arquitetural completa aprovada (substitui definitivamente "claim+outcome universal" de D-065): tombstone `TenantLifecycleRecord` fora da cascata; admissão transacional por efeito externo (Textract/Bedrock/Step Functions/S3-promoção/SES via conversão de escritas condicionais de item único para `TransactWriteItems` de 2 itens com `ConditionCheck ACTIVE`, sob o contrato "`ACTIVE→DELETING` bloqueia novas admissões, operações já admitidas podem terminar"); lanes tipadas `TenantBusinessMutation`/`SystemMutation` para o boundary estrutural; key S3 do OCR determinística `ocr/<tenantId>/<runId>.json`; fencing de toda evidence mutation intermediária no fluxo de upload; compensação de objeto S3 `clean` órfão via `TransactWriteItems.CancellationReasons`; `VERIFYING→DELETED` com 3 propriedades separadas (prevenção indefinida via fence, extinção de capabilities via cutoff conservador de 1800s, sweeper permanente pós-`DELETED` com elegibilidade de 90 dias per `privacy-lgpd.md` e alarme em todo achado — conclusão declarada honestamente como ponto-no-tempo, não prova permanente); cutover em duas fases do marcador `admittedWhileActive` em `ExtractionRun`.

**Condição única da aprovação**: decisão humana de produto/jurídica sobre a política de SES pós-`DELETING` — Opção 1 (recomendação de engenharia: bloqueio no ponto de admissão, envios já admitidos podem se resolver) vs. Opção 2 (lease/drain coordenado, mais forte, não recomendada por padrão). **Não implementar o caminho de envio SES do W3-07 sem essa decisão registrada em `decisions-log.md`**, ou atrás de uma flag cujo default não-respondido seja a Opção 2 (mais segura).

**Próxima ação real**: sessão de IMPLEMENTAÇÃO, não mais de debate arquitetural (Codex declarou textualmente "the five-round review-only track has reached what it can close"). Ler `docs/architecture/reviews/w3-07-tenant-fence-round3-active-only-design/claude-analysis-active-only-fence.md` §Q inteira para o roteiro de 6 itens de implementação (executor fenced único, boundary estrutural, cutover em 2 fases do marcador, sweeper permanente reusando o padrão do `DocumentPurgeWorker`/D-061, inventário empírico de `ListObjectVersions`/multipart contra buckets reais, ensaio de migração em `dev`). Registrar a decisão de SES antes ou em paralelo. Nenhum gate de pilot readiness depende disso — os 3 gates reais (W3-06/Wave 2/GTR-01) já fecharam.

**Visual Language + Design System Foundation** (2026-08-26, PR #61, merge `1a0d5f1` em `develop`, branch já deletada): o frontend deixou de ser propositalmente grayscale/provisório e passou a ter a primeira linguagem visual real do produto — arquitetura de tokens em duas camadas (`frontend/src/styles/tokens.css` + `base.css`, substituindo as 71 linhas de `foundation.css`), ~9 primitives acessíveis em `frontend/src/components/ui/` (Button/ButtonLink, StatusBadge, UrgencyIndicator, DataTable, InlineNotice, PageHeader/Section/Toolbar/Panel), e a direção **Operational Calm** aplicada às 5 superfícies do Core Expiration slice (Overview, Collection, Detail, Create, Renew). `APPROVED AS VISUAL LANGUAGE + DESIGN SYSTEM FOUNDATION — PROVISIONAL PENDING USER VALIDATION` — a palavra PROVISIONAL é literal: nenhuma sessão com usuário aconteceu, e as **15** hipóteses de design (hierarquia de navegação, densidade final, rótulos, colocação de ações secundárias, accent, e as duas afirmações subjetivas sobre a própria direção) estão registradas como adiamentos explícitos no §35 do documento, não como fatos. **Zero dependências novas** (nenhum framework de UI, nenhum Storybook, nenhuma biblioteca de ícones); JS de bundle inalterado, CSS 23,04 kB (4,46 kB gzip). Mudança estrutural única: a Expiration Collection deixou de ser `<ul>/<li>` e virou `<table>` semântica com urgência e situação em colunas separadas — mesmos dados/ordenação/agrupamento/filtro/rotas. A densidade real (140 itens, nomes longos e quase-idênticos, 3 grupos de urgência) foi verificada contra o código real do frontend **pela primeira vez** (antes só contra o protótipo), com asserção automatizada. Protocolo Claude↔Codex completo: Rodada B adversarial achou 5 achados reais, 2 S2 — `Button` usava `disabled ?? pending` e `RenewItem` passa `disabled={conflict}`=`false` numa renovação normal, então o botão de submit continuava clicável durante a mutação exibindo "Renovando…"; e os cabeçalhos de grupo da tabela usavam `scope="colgroup"` onde encabeçam linhas — ambos corrigidos com teste de regressão. O protocolo **não** parou na Rodada D: foram **16 rodadas e 11 reaberturas** até convergir em Codex **9,04** e Claude **9,2** (sem arredondamento, `AGENTS.md` §4) — o protocolo mais longo já executado neste repositório. Três rodadas acharam defeitos **criados pela rodada de correção anterior** (D-01, F-01, G-01), e a classe dominante de achado não foi código errado e sim **documentação afirmando prova mais ampla que a evidência nomeada**, que apareceu seis vezes: a alegação "sem armadilha de teclado" sobreviveu dez rodadas antes de ganhar uma asserção de cobertura que realmente a prova. Vale como precedente de processo para revisões futuras deste repositório. Acessibilidade virou executável em `frontend/e2e/accessibility.spec.ts` (**9 testes no projeto `chromium`, logo no CI em todo PR**), e duas falhas reais foram achadas por essas asserções e corrigidas (contraste 4,48:1 e alvo de 19px). Detalhe completo, contrastes medidos, gates `VL-G1..VL-G17`, limitações declaradas e registro de decisões: `docs/frontend/visual-language-and-design-system.md`. 124 testes unitário/componente + 24 E2E funcionais (9 deles de acessibilidade) + 10 baselines de regressão visual (era 110 + 12 + 0). CI do PR #61: 4/4 verde.

**Pendência real registrada, não bloqueante**: as baselines de regressão visual foram gravadas em `win32` e o CI roda em `ubuntu-latest`; baselines de screenshot são por plataforma, então o projeto Playwright `visual` é deliberadamente separado de `npm run test:e2e` e **não** está gatilhado no CI hoje (plugá-lo falharia por baseline ausente, não por regressão real). O caminho de adoção está escrito no §31 do documento: gravar as baselines num runner Linux, commitá-las, e adicionar `npm run test:visual` ao job `frontend` de `.github/workflows/ci.yml`. Até lá o CI cobre as mesmas superfícies funcionalmente via `frontend/e2e/expiration-density.spec.ts`. Também não executado e declarado como tal: teste com leitor de tela real (NVDA/VoiceOver indisponíveis no ambiente) — `REQUIRED` antes de Pilot.

**Core Expiration Vertical Slice** (2026-08-24, branch `feat/core-expiration-vertical-slice`): primeiro fluxo real e completo do anchor Vencimentos — Expiration Collection, Expiration Detail, Create Expiration, Renew Expiration — sobre a Frontend Production Foundation, usando contratos reais de ponta a ponta (frontend real → BFF real → API real → persistência real). Nenhuma rota nova de BFF foi necessária (todas as 6 rotas de item já allowlisted). `APPROVED AS CORE EXPIRATION PRODUCTION VERTICAL SLICE` via protocolo Claude↔Codex (Round B adversarial achou 4 bugs reais — 1 S1: corrida TOCTOU real na reaquisição de um registro de idempotência `ABORTED` [`IdempotencyStore.begin()` fazia `get()`+`update()` incondicional, permitindo duas retentativas concorrentes "vencerem" e executarem a operação guardada duas vezes]; 3 S2: `renewItem`'s `abort()` podendo disparar depois de um commit bem-sucedido [se só `idempotency.complete()` falhasse depois], hash de renovação ambíguo quando `cycle` é enviado independente de `newDueDate`, bug de fuso horário na formatação de data da `Overview` — todos corrigidos na Rodada C e reverificados sem achados novos na Rodada D). Durante a implementação também foi corrigido um bug real pré-existente de liveness de idempotência (`createItem`/`renewItem` nunca liberavam o lock de idempotência quando a escrita protegida falhava, deixando o registro `IN_PROGRESS` para sempre) — a correção adicionou um novo estado terminal `ABORTED` em `IdempotencyStore` (`src/shared/idempotency/idempotency.ts`), depois reforçado pela correção de corrida da Rodada C. Detalhe completo, achados, reconciliação e Final Status: `docs/frontend/core-expiration-vertical-slice.md`. 96 testes unitário/componente de frontend + 12 E2E Playwright (era 42+6 na fundação), 621 testes de backend — nenhuma regressão. Pendente ao fim desta sessão: push, PR para `develop`, CI, merge (ver "Próxima ação" abaixo se ainda não concluído).

**Backend**: M0-M11 implementados. M6 (documentos/malware), M9 (Subject/Requirement), M10 (guest upload + automated chasing + convite inicial), M11 (CSV import) — todos deployados em `main`/`dev`. **M7 (extração/OCR) teve implementação iniciada em 2026-08-25** (D-057, decisão direta do Marcelo — "prossiga então") — ver seção dedicada abaixo para o estado exato e o que falta. M12 (billing) **bloqueado por decisão de produto** (D-052, escolha de fornecedor de pagamento). M13 (Organization/Membership/RBAC) **gated** por gatilho comercial real (primeira venda B2B) que não disparou.

**Full BFF (autenticação de browser)**: design fechado via protocolo Claude↔Codex em duas rodadas — D-053 (Full BFF, Claude 9,2/Codex 9,3) e D-054 (amendment de uma auditoria adversarial de 16 pontos, Claude 9,2/Codex 9,4). **Implementado nesta sessão e `APPROVED AS FRONTEND PRODUCTION FOUNDATION`** (`src/modules/bff/` — 76 testes unitários; infra Terraform real em `infra/modules/bff-session-table/` e `infra/modules/bff-api-gateway/`), junto de uma fundação de frontend de produção real (`frontend/` — Vite+React+TS+React Router v7+TanStack Query v5, 42 testes unitário/componente + 6 smoke E2E via Playwright). Protocolo Claude↔Codex completo (Rodada D levou **6 passagens** até convergir — 5 achados bloqueantes reais de segurança de sessão encontrados e corrigidos, todos verificados experimentalmente contra o código pré-correção: consumo não-atômico de `LoginAttempt`; commit incondicional do refresh podendo ressuscitar sessão revogada concorrentemente; releituras pós-refresh não checando `revokedAt`; `logout`/`logoutAll` aceitando um `selector` correto com `secret` errado; `logoutAll` e `handleCallback` não checando expiração/idle-TTL antes de agir; idle-TTL da própria `Session` nunca validado contra o relógio). Registro completo e Final Status em `docs/frontend/frontend-production-foundation.md`. Debate de design original em `docs/architecture/reviews/bff-full-vs-session-design/`.

**Planejamento de interface**: 8 documentos/artefatos produzidos em sequência, todos `docs/frontend/*.md` (mais `prototype/` para o 6º-8º), cada um fechado via protocolo Claude↔Codex e `APPROVED`:
1. `interface-context-and-critical-tasks.md` — papéis, JTBD, inventário de tarefas, criticidade/readiness.
2. `interface-conceptual-model-and-information-architecture.md` — modelo conceitual, IA recomendada (dual-anchor: Vencimentos + Fornecedor/Subject).
3. `interface-critical-user-journeys.md` — 8 journeys outcome-a-outcome.
4. `interface-screen-and-state-inventory.md` — 17 Interaction Surfaces (`SURF-001` a `SURF-017`) derivadas das 8 journeys, com taxonomia de estado (loading/empty/error/persistence/visibility), Epistemic Integrity Matrix e matrizes Surface↔Journey/Concept/Transition. Revisão Codex achou 3 furos reais de mesma causa raiz — `Document.SCANNING` classificado `PERSISTED` como se fosse `REMOTE_ASYNC`/`USER_KNOWN`; corrigido para `NOT_CURRENTLY_OBSERVABLE` (o gap de leitura de `BLOCKER-A` começa em `SCANNING`, não só em `CLEAN`) — todos corrigidos, nenhum estrutural.
5. `interface-low-fidelity-wireframes.md` — wireframe ASCII das 17 `SURF-xxx` (grayscale conceitual, sem identidade visual), 8 journey walkthroughs, State Coverage Matrix. Revisão Codex achou 5 furos reais + 1 divergência factual — ação primária ambígua em 4 coleções, `BLOCKER-A` mascarado no estado inicial de Document Context, `SATISFIED` reaproximado de "compliance atual" numa variante do branch de `BLOCKER-C`, canal WhatsApp sem lastro (product creep), e `Dependencies` de Full BFF incompletas — todos corrigidos, nenhum estrutural.
6. `interface-interaction-prototype.md` + `prototype/` (código executável real, HTML/CSS/JS sem dependências) — protótipo navegável cobrindo as 17 superfícies e J-01–J-08 com 34 Prototype Scenario IDs determinísticos, verificado com testes automatizados de navegador headless. Revisão Codex achou 6 furos reais de 4 causas raiz — compressão de estados no guest upload (faltava validação de arquivo e "reserva aceita" distinto de "enviado"), uma simulação de coleta externa violando epistemic integrity (anunciava verificação de segurança concluída ao operador, que não pode observar isso), dois campos sem `<label>`, e reincidência de menção a WhatsApp — todos corrigidos e reverificados funcionalmente, nenhum estrutural.
7. `interface-heuristic-accessibility-evaluation.md` — avaliação do protótipo **executável** (não só a documentação): Nielsen H1-H10, WCAG 2.2 AA (teclado/foco/semântica/forms testados em navegador headless real, não só lidos), `axe-core` (0 violações em todos os estados testados, nas duas rodadas), re-execução de J-01–J-08, Epistemic Integrity, `BLOCKER-A/B/C`/`GTR-01`/`CREATE-IDEMPOTENCY-01`. Protocolo de **4 rodadas** Claude↔Codex (não as 2-3 rodadas típicas de etapas anteriores): Rodada A (autoavaliação, 9 achados corrigidos) concluiu aprovação — **prematuramente**, como a Rodada B mostrou. Rodada B (adversarial) achou 6 problemas-raiz reais não vistos pela autoavaliação: o mais grave, a própria guarda anti-duplo-submit adicionada na Rodada A quebrava o recovery de erro de validação em 3 formulários (S3); o segundo mais grave, `reconcileImport()` (caminho de reconciliação manual de `UNKNOWN_OUTCOME` de import) afirmava ter criado registros sem realmente materializá-los no fake-backend — uma violação epistêmica real, não cosmética. Rodada C corrigiu os 6, mas cometeu um erro de julgamento próprio ao manter um texto "SIMULATED FOR UX VALIDATION — NOT CURRENTLY SUPPORTED BY BACKEND" numa superfície pública de guest (jargão técnico visível a um usuário externo não-técnico). Rodada D (nova adversarial sobre o código já corrigido) achou essa lacuna de conteúdo e uma correção incompleta nova (`submitAlert` reabilitava o botão só na branch de erro, não na de sucesso) — ambos corrigidos e reverificados individualmente em navegador no fechamento desta etapa. Quality Score final **9.04/10** (não arredondado; calculado refletindo esse histórico de 4 rodadas, não só o estado final do código) — `APPROVED AS INPUT FOR USER VALIDATION`.
8. `interface-validation-readiness.md` — "Validation Readiness + Product Focus Hardening", 8 workstreams antes de User Validation: Participant Mode (default, sem Scenario IDs/barra de controle/tags técnicas) vs. Evaluator Mode (`?mode=evaluator`, preserva tudo, sem regressão) no protótipo; `GTR-01` simulado no guest flow ("Solicitado por: Empresa Alfa Ltda."), documentado como simulação, nunca marcado como backend-resolvido; cenário de densidade `PROTO-STRESS-DENSITY-01` (155 vencimentos/38 fornecedores/95 requisitos/21 solicitações) que achou e corrigiu uma falta real de ordenação por urgência na Overview/Collection; `CREATE-IDEMPOTENCY-01` **resolvido no backend real** (não só no protótipo) — `createItem` ganhou `idempotencyKey` opcional reusando o `IdempotencyStore` já usado por `renewItem`, 6 testes novos; tese de produto (compliance documental leve de terceiros) e métricas de validação formalizadas; `docs/frontend/interface-quality-standard.md` criado (12 eixos já em uso desde a 1ª etapa, agora formal, nenhum critério novo); matriz de gates User Validation/Pilot/Paid Pilot/Public Production para `BLOCKER-A/B/C`/`GTR-01`/`CREATE-IDEMPOTENCY-01`/Full BFF/Operational Architecture. Protocolo de 4 rodadas + 1 fechamento: Rodada B achou 4 furos reais (2 vazamentos de anotação técnica em Participant Mode, teste de idempotência sem cobrir o crash entre `commit()`/`complete()`, 2 imprecisões de documentação); Rodada C corrigiu os 4; Rodada D, ao reler o arquivo inteiro mais uma vez, achou **mais 6 vazamentos** (nenhum introduzido pela Rodada C, todos pré-existentes desde a Rodada A) — corrigidos no fechamento, zero contaminação residual confirmada por varredura completa. `APPROVED FOR USER VALIDATION PLANNING`.

Esses documentos descobriram **3 blockers técnicos reais de backend** (nenhum resolvido tecnicamente, todos citados por ID em todo lugar relevante, nunca mascarados):
- **BLOCKER-A** — **fechado nesta sessão (2026-08-25), as duas metades**:
  1. `Document` (item-attached, M6): `GET /items/{itemId}/documents` e `GET /items/{itemId}/documents/{documentId}` — `DocumentService.listDocuments`/`getDocument`, autorização `document:read` (ação já existia na matriz, nunca usada), reusa `queryByPk` na partição do item já existente (`data-model.md` linha 34), sem GSI novo.
  2. `DocumentSubmission` (guest-upload/subject module, agregado-irmão de `Document`, ancorado no `RequirementAssignment`): `GET /subjects/{subjectId}/requirements/{assignmentId}/submissions` e `.../submissions/{submissionId}` — `RequirementService.listDocumentSubmissions`/`getDocumentSubmission`, reusando a ação `requirement:read` já existente (sem action nova reservada de antemão, diferente de `document:read`), mesma leitura por partição sem GSI novo (`REQASSIGN#assignmentId#SUBMISSION#` como prefixo de SK). Achado incidental ao mexer nas rotas de `/subjects*`: as 4 rotas de `DocumentRequest` (D-037/D-049) já tinham handler pronto mas nunca tinham sido registradas no Terraform — não é desta sessão, já estava corrigido antes (comentário no próprio `main.tf`), só confirmado que segue correto.

  Ambas as metades: mudança mecânica sobre um padrão de acesso já aprovado no data model — não passaram pelo protocolo `AGENTS.md` §4 completo (não é decisão de arquitetura nova, é fechamento de gap de leitura já modelado). 14 testes novos de unit (service+handlers+domain), rotas Terraform + `terraform test` dos módulos `api-gateway` atualizados e passando, 709 testes de backend (era 695 no início da sessão), lint/typecheck/check-boundaries/validate-schemas/check-docs limpos, nenhuma regressão. **Achado real corrigido depois, na mesma sessão**: as 4 rotas novas nunca tinham sido allowlisted em `src/modules/bff/domain/proxy-allowlist.ts` — mesma classe de gap que as rotas de `DocumentRequest` já tiveram antes (comentário em `infra/modules/api-gateway/main.tf`). Corrigido, 4 testes novos, 711 testes de backend.
- **BLOCKER-B** — **implementação completa, mergeada em `develop`** (PR #50, commit `8f00160`, 2026-08-25; ver seção abaixo). Antes desta branch, a materialização automática de `ReminderOccurrence` estava desconectada do caminho normal de criação/edição de item. Pendência real restante: decisão de produto sobre `renewItem` copiar `ReminderPolicy` (ver abaixo) — não bloqueia mais nada além dessa decisão em si.
- **BLOCKER-C** — **decisão tomada pelo Marcelo em 2026-08-25: Variante B (revisão humana explícita)**, confirmando a hipótese líder já registrada nos documentos de planejamento (`interface-validation-readiness.md` §22, `interface-conceptual-model-and-information-architecture.md` §37, `interface-critical-user-journeys.md` §37 — esses documentos continuam como registro histórico do debate, não reescritos, per `AGENTS.md` regra de precedência de `history/`/artefatos aprovados). Investigação confirmou que Variante A (fechamento automático) não é viável hoje: `DocumentSubmission` não guarda nenhum dado estruturado (data de validade, tipo) que permitiria inferir com segurança a qual `ExpirationItem` uma submissão pertence — decidir automaticamente seria adivinhar, não resolver. **Mecanismo de backend para a Variante B já existe, nenhum código novo necessário**: visibilidade do operador sobre submissões pendentes vem das rotas `GET /subjects/{subjectId}/requirements/{assignmentId}/submissions`/`.../submissions/{submissionId}` (fechadas nesta mesma sessão como segunda metade de BLOCKER-A) combinadas com `GET /subjects/{subjectId}/requirements` (lista assignments `MISSING`) e o mecanismo de satisfação já existente (`POST .../link`, pré-existente). **Frontend implementado na mesma sessão (2026-08-25)**: primeira fatia real do anchor Fornecedor/Subject — `frontend/src/routes/subjects/{SubjectsCollection,SubjectDetail}.tsx` (rotas `/subjects`, `/subjects/:subjectId`, já ligadas no nav do `AppShell`), API layer (`api/subjects.ts`), 6 hooks novos (`useSubjectsDashboard`, `useSubject`, `useRequirementAssignments`, `useDocumentSubmissions`, `useLinkExpirationItem`/`useUnlinkExpirationItem` via `useOccMutation`, primeiro consumidor real desse hook). Fluxo: lista de fornecedores → detalhe com requisitos → "Revisar" expande evidência enviada (`DocumentSubmission`) → operador informa o `itemId` de um vencimento já existente e vincula (`POST .../link`), OCC-protegido (`If-Match`), com `Desvincular` para reverter. Deliberadamente sem criação de subject nem sugestão automática de item (a mesma lacuna de dado estruturado que descartou a Variante A). Rótulos seguem a mesma disciplina de Epistemic Integrity já estabelecida no planejamento de interface (`SATISFIED`="Vinculado", nunca "Em dia"; `CLEAN`="Verificado (segurança) — conteúdo não conferido", nunca "Aprovado"). 11 testes novos, 110 testes de frontend (era 99), typecheck/lint/build limpos. **BLOCKER-C agora fechado de ponta a ponta** (backend + frontend).

Dois achados menores viraram gates formais nesta última etapa: **`GTR-01`** (identidade do solicitante não exposta ao guest) agora **simulada** no protótipo para User Validation, mas ainda não resolvida no backend — `REQUIRED` a partir de Pilot. **`CREATE-IDEMPOTENCY-01`** (`POST /items` sem idempotência) foi **resolvido no backend real** — `createItem` ganhou `idempotencyKey` opcional — e, na sessão do Full BFF/frontend, o `requestHash` de detecção de payload divergente foi migrado de concatenação por delimitador (colisão real possível) para JSON canônico + SHA-256, e o frontend real (`frontend/src/hooks/useIdempotentMutation.ts`) passou a efetivamente enviar o header `Idempotency-Key` — a lacuna "nenhum frontend/BFF real envia o header" está fechada para o caminho de criação de item.

**Próxima etapa natural do design** (ainda não iniciada): **User Validation** — usando o protótipo já com Participant Mode isolado em `prototype/` (ver `prototype/README.md` para como rodar; Participant Mode é o default, `?mode=evaluator` ativa o modo de engenharia) e `interface-validation-readiness.md` §15-18/§23-24 (tese de produto, métricas de validação, tarefas candidatas derivadas de outcomes, limitações conhecidas do protótipo a comunicar ao facilitador) como input; o roteiro formal de entrevista fica para `User Validation Planning`, deliberadamente não produzido ainda. Não obriga início imediato de Visual Design/Design System.

## BLOCKER-B — implementação completa e mergeada em `develop` (PR #50, commit `8f00160`)

Sessão de 2026-08-24/25 (continuação após a sessão anterior ter sido abortada por limite de tokens só com reconhecimento parcial — handoff original em `docs/architecture/blocker-b-recon-handoff.md`, agora histórico) completou o pipeline real de entrega de lembretes de ponta a ponta. Arquitetura decidida e aprovada via protocolo Claude↔Codex completo (rodadas B a H, nota final 9,2/10) em `docs/architecture/reminder-delivery-pipeline.md` — esse documento é a fonte de verdade do desenho (event taxonomy, pointer lifecycle, fencing, backfill). Implementação real (não só design) também revisada via protocolo Claude↔Codex (2 rodadas, nota final 9,2/10, `APPROVED` — achados reais corrigidos: reclassificação de exceção em dois métodos novos do materializer, ConditionCheck de integridade de item pulado numa edição same-item, schema da fila nunca registrado no `defaultSchemaRegistry` de produção).

O que existe agora, real e testado (695 testes, lint/typecheck/check-boundaries/validate-schemas limpos): três novos métodos de reconciliação em `ReminderMaterializer` (fenced por versão da policy); lifecycle do ponteiro `POLICYREF#` em `ReminderPolicyService` (create/move/remove atômico); dois eventos novos (`expiration.item-deactivated.v1`, `reminder.policy-changed.v1`) mais `createItem` passando a emitir `expiration.item-due-date-changed.v1` (antes não emitia nada); o worker `reminder-materialization-trigger` (a peça que realmente fecha o BLOCKER-B); mecanismo de entrega real via `DispatchOutboxRelay`/`OutboxSweeper` (achado real durante a implementação: o "caminho genérico via EventBridge" que o desenho original presumia nunca foi de fato implementado neste código — `router_queue` não tem consumidor Lambda nenhum); Terraform completo (fila+DLQ+Lambda+IAM, 13 `terraform test` passando); script de backfill (`scripts/backfill-reminder-policies.ts`, nunca roda automaticamente no deploy).

**Decisão do Marcelo (2026-08-25)**: `renewItem` deve copiar automaticamente a `ReminderPolicy` do item de origem para o novo, com um aviso ao usuário (resposta/UI) de que a policy copiada pode precisar de ajuste. Substitui o default de engenharia "não copiar" antes proposto (`docs/architecture/reminder-delivery-pipeline.md` §8). **Implementado nesta sessão (2026-08-25), backend e frontend**: `completeRenewal` copia a(s) `ReminderPolicy` ITEM-scoped do item de origem para o novo, dentro da MESMA transação da criação do item (sem `ConditionCheck` de existência — o item novo é garantido pela própria transação); `renewItem` passou a retornar `{ item, copiedReminderPolicyIds }` em vez de só `ExpirationItem` (mudança de contrato, ~13 call sites de teste atualizados); `handleRenewItem` inclui `copiedReminderPolicyIds` no corpo da resposta HTTP. No frontend, `RenewItemResponse` (novo tipo), `renewItem()`/`useRenewItem` propagam o campo, `RenewItem.tsx` passa `copiedReminderPolicyIds` via `navigate(...).state`, e `ItemDetail.tsx` exibe um aviso ("Os lembretes do ciclo anterior foram copiados... Revise...") quando `justRenewed && copiedReminderPolicyIds.length > 0`. 4 testes novos/reescritos no backend (incluindo `reminder-materialization-trigger.test.ts`, que antes afirmava explicitamente "policies are NOT auto-copied" — reescrito para o comportamento novo) + 3 novos no frontend. 710 testes de backend + 99 de frontend (era 96), lint/typecheck/check-boundaries/validate-schemas/build limpos nos dois projetos. `frontend/node_modules` não estava instalado no início desta sessão (`npm ci` rodado para poder validar) — ambiente, não código.

**Próxima ação**: **M7 (extração/OCR) — todos os 9 itens numerados originais da lista estão CONCLUÍDOS (2026-08-26)**, código+infra reais para itens 1-9, não só camada pura — ver as seções dedicadas "Item N — CONCLUÍDO" na seção M7 abaixo para o detalhe de cada um. Resumo: itens 1-2 aplicados/gated em `dev`; itens 4-7 (`TextractTaskHandler`/`PdfParserTaskHandler`/`BedrockExtractionTaskHandler`/`ExtractionValidationTaskHandler`) reais de ponta a ponta; item 3 (`aws_sfn_state_machine` real via `infra/modules/extraction-workflow/`, wireado em `infra/main.tf`); item 8 (rotas HTTP `confirm`/`reject`, §1.7) implementado; item 9 (quota `AI_CALL`) verificado a fundo, nada faltando. **PR #60 (itens 5-8) mergeado em `main` em 2026-08-27** (commit `aeed7b8`). **O CD (`Deploy (CD)`) que rodou automaticamente após esse merge FALHOU** no step `Terraform apply (dev)` (run `33036794831`) — causa raiz real: `infra/state-machines/document-extraction.asl.json`'s `RunTextract` Catch misturava nomes de erro específicos com `States.ALL` num único `ErrorEquals`, o que o Step Functions rejeita (`SCHEMA_VALIDATION_FAILED: States.ALL must appear alone and at end of list`; `terraform plan` não pega esse erro, só a chamada real de criação do recurso em `apply`). **Corrigido, mergeado (PR #62, commit `a6faac6`) e CD reverificado verde (run `33041060474`)** — o Catch foi dividido em dois Catchers com o mesmo `Next`, sem mudança de comportamento. Verificado com `npx asl-validator` localmente e, pós-deploy, com leitura real via `aws stepfunctions describe-state-machine --profile claude-dev` contra `dev`: a definição publicada tem o fix (dois Catchers, `States.ALL` sozinho no segundo) e as 4 `FunctionName` já resolvidas para ARNs reais (`:live`). **`claude-dev` (perfil AWS CLI local) resolve para a conta `dev` (`975707451904`) certa** — a nota de uma sessão anterior dizendo "nenhum profile corresponde à conta dev" estava desatualizada/errada. Em 2026-08-27 o Marcelo concedeu a esse perfil as permissões de escrita necessárias e a **verificação E2E real foi executada** (ver `## M7 — verificação end-to-end real em `dev` (2026-08-27)` abaixo). Nenhuma mudança de Terraform foi cogitada para isso — a flag `extraction_pipeline_enabled` nem precisa ser tocada, já que o state machine sempre existe e pode ser iniciado manualmente independente dela (só o gatilho automático via EventBridge é que é gated). **Recorrência fechada na mesma sessão**: `ci.yml`/`cd.yml` ganharam um passo novo (`Validate Step Functions ASL definitions`, logo após "Configure AWS credentials" nos dois) que chama `aws stepfunctions validate-state-machine-definition` contra todo `infra/state-machines/*.asl.json` — a mesma API que rejeitou o `States.ALL` antes, agora rodando em todo PR (`ci.yml`, antes do merge) e de novo no deploy (`cd.yml`, belt-and-suspenders), nunca mais só descoberto no meio de um `terraform apply` real. Não requer credencial de escrita (é uma chamada de validação sem efeito colateral, testada com sucesso via o profile `claude-dev` read-only). SLSA/provenance de artefato **explicitamente adiado a pedido do Marcelo**. User Validation **em suspenso, aguardando segunda ordem do Marcelo** (não retomar sem sinal explícito). Infra de hospedagem do SPA (etapas 1-5) fechada de ponta a ponta desde 2026-08-25, ver `## Infra de hospedagem do SPA — etapas 1-5 fechadas` abaixo se precisar do detalhe.

## Infra de hospedagem do SPA — etapas 1-5 fechadas (2026-08-25)

Arquitetura já aprovada em nível conceitual (`docs/architecture/architecture-fase3-consolidada.md` §3: S3 privado + CloudFront, Origin Access Control, deploy imutável por hash; `implementation-blueprint.md` §12/§23: CSP com hashes estáticos calculados no build, sem nonce dinâmico — Day 0 não tem compute de borda). O que falta é o desenho de implementação real e o código — nenhuma decisão de produto pendente, mas há **uma decisão de arquitetura real ainda em aberto** que a próxima sessão precisa resolver antes de implementar (Type 1, nível 5-6 da escala de risco — protocolo `AGENTS.md` §4 aplicável):

1. **Decisão de arquitetura a fechar primeiro — FECHADA nesta sessão (2026-08-25)**: como CloudFront e o BFF coexistem. **Alternativa (a) aprovada via protocolo Claude↔Codex completo, 6 rodadas, nota final 9,2 (Claude)/9,3 (Codex) sobre 10** — `docs/architecture/adr/ADR-0011-cloudfront-bff-coexistence.md` é a fonte de verdade do desenho; debate completo com cada achado real (erros de origin request policy, precedência de behaviors, mascaramento de erros do BFF via `custom_error_response`, header `Idempotency-Key` nunca encaminhado pelo proxy, etc.) em `docs/architecture/reviews/spa-hosting-cloudfront-bff/`. Resumo: uma única distribution, behaviors `/bff` e `/bff/*` → origem custom HTTPS do API Gateway do BFF (`AllViewerExceptHostHeader`, `CachingDisabled`), default behavior → S3 com OAC + CloudFront Function de SPA routing (só nesse behavior, nunca no do BFF). Zero mudança em `client.ts`/`cookies.ts`/`csrf.ts`. Inclui dois fixes pré-existentes descobertos pela revisão, a aplicar na implementação: `proxy-service.ts` não encaminha `Idempotency-Key` ao backend (`FORWARDED_REQUEST_HEADERS`), e o CORS de fallback de `bff-api-gateway` não inclui `idempotency-key`/`if-match`/`PATCH`. Gate registrado (não implementado): acesso direto ao `execute-api` público precisa de mitigação (header estático + WAF) antes de produção pública real.
2. **Módulo Terraform `infra/modules/spa-hosting` — IMPLEMENTADO (2026-08-25)**: bucket S3 privado (OAC, bloqueio de acesso público total, versionado), CloudFront com 3 `ordered_cache_behavior`/`default_cache_behavior` (`/bff` e `/bff/*` explícitos → origem custom HTTPS do API Gateway do BFF, `AllViewerExceptHostHeader`, `CachingDisabled`; default → S3+OAC), CloudFront Function de SPA routing (`spa-routing.js`, `RESERVED_PREFIXES = ["/bff", "/.well-known/"]`, guarda de método GET/HEAD, associada SÓ ao default behavior — nunca aos behaviors do BFF), duas Response Headers Policy distintas (`spa` com CSP própria, `bff_edge_floor` com `override=false` e os mesmos valores literais de `bff-handler.ts`). 13 `terraform test` (mock_provider + `override_data` para o bucket policy) + 8 testes unitários Vitest da function (`test/unit/infra/spa-routing.test.ts`, via `vm`). Os 2 fixes pré-existentes do ADR-0011 também aplicados: `proxy-service.ts` agora encaminha `idempotency-key` (1 teste novo), CORS de `bff-api-gateway` ganhou `Idempotency-Key`/`If-Match`/`PATCH` (1 `terraform test` novo). **Achado real ao implementar a etapa 3** (corrige uma suposição errada do próprio ADR-0011): `var.spa_content_security_policy` não precisa de hashes calculados por build — verificado contra o `frontend/dist/index.html` real, o build do Vite não emite nenhum `<script>`/`<style>` inline, todo asset é carregado por URL externa já hasheada, então `script-src 'self'`/`style-src 'self'` (mesmos valores do `<meta>` CSP interino que já existe em `frontend/index.html`) bastam sem hash nenhum — a variável ganhou um default determinístico (mesma CSP do meta tag + `frame-ancestors 'none'`, que um `<meta>` não consegue expressar). **Módulo wireado no `infra/main.tf` root** (`module "spa_hosting"`, usa `module.bff_api.api_endpoint`) e outputs novos em `infra/outputs.tf` (`spa_bucket_name`/`spa_distribution_id`/`spa_distribution_domain_name`). `var.app_origin` continua placeholder por enquanto (mesma disciplina de `ses_from_address`/`bff_cognito_domain_prefix`) — corrigir via `-var app_origin=https://<spa_distribution_domain_name>` depois que a distribution real existir (não bloqueia o primeiro apply, só o domínio final do Cognito/CORS). **Verificado com `terraform plan` real contra a conta `dev`** (perfil `claude-dev`, `-target=module.spa_hosting`): 11 recursos a criar, zero erro — confirma que os nomes de managed policy (`Managed-CachingDisabled`/`Managed-CachingOptimized`/`Managed-AllViewerExceptHostHeader`) resolvem de verdade contra a API real do CloudFront, não só contra mocks.
3. **Deploy imutável por hash — IMPLEMENTADO (2026-08-25)**: Vite já hasheia todo asset (`index-<hash>.js`/`.css`); nenhum prefixo versionado extra é necessário (o hash no nome do arquivo já é o mecanismo de imutabilidade). `index.html` é tratado à parte (não hasheado, `Cache-Control: no-cache`, upload por último).
4. **Integração com `cd.yml` — IMPLEMENTADA (2026-08-25)**: novos passos no job `deploy-dev` existente (não um job novo) — `npm ci`+`npm run build` em `frontend/`, `scripts/check-spa-build-artifacts.mjs` (segundo call site, junto com o de `ci.yml`), `aws s3 sync` dos assets hasheados (`--exclude index.html`, `Cache-Control: public, max-age=31536000, immutable`, **sem `--delete`** — assets antigos nunca são removidos, é isso que mantém um rollback de `index.html` funcional, já que as referências antigas continuam servíveis), upload de `index.html` por último, `aws cloudfront create-invalidation` para `/index.html` e `/`. Outputs novos (`spa_bucket`/`spa_distribution_id`/`spa_distribution_domain`) lidos do mesmo passo `Get Terraform outputs` já existente. **Pendência real registrada, não implementada**: o manifesto de deploy (`pointers/current-healthy.json`) ainda só cobre Lambdas — não guarda qual `index.html`/conjunto de assets estava ativo, então `rollback.yml` (mecanismo existente) não cobre a SPA ainda; um rollback do SPA hoje seria manual (reenviar um `index.html` antigo, cujos assets referenciados continuam em S3 por causa do `--delete` nunca usado). Candidato a follow-up, não bloqueia o deploy normal.
5. **Verificação real (Camada 3) — CONCLUÍDA (2026-08-25), achou e corrigiu um bug real de produção**: primeiro `apply` real via CD (PR #54, 11 recursos criados: bucket `exptrk-dev-spa`, distribution `E2XPYCT6NSP8R1`, domínio `d1mbs2t047qo9d.cloudfront.net`). Primeira rodada de `curl` devolveu **403 AccessDenied em tudo** — isolado (via `aws s3api get-bucket-encryption` depois de confirmar bucket policy/OAC corretos) como SSE-KMS com a chave gerenciada `alias/aws/s3`, cuja política fixa não pode conceder `kms:Decrypt` a `cloudfront.amazonaws.com`. **Corrigido** (PR #55, SSE-S3/AES256) e **reaplicado com sucesso via CD**. Segunda rodada de verificação, tudo confirmado contra a distribution real:
   - `GET /` → 200, `text/html`.
   - `GET /assets/index-*.js` → 200, `Cache-Control: public, max-age=31536000, immutable`.
   - `GET /items` (rota SPA sem extensão, V6 do ADR-0011) → 200, corpo = `index.html` (fallback da CloudFront Function funcionando).
   - `GET /bff` e `GET /bff/` (V1/V2) → 404 `application/json` (`{"message":"Not Found"}`, resposta real do API Gateway) — nunca HTML, confirma que o namespace `/bff` nunca cai no fallback da SPA.
   - `GET /bff/session` (V3, rota real do BFF) → 200 `application/json` (`{"authenticated":false}`).
   - `GET /bff/api/items` sem sessão (V4) → 401 `application/json` (`AUTH_REQUIRED`) — nunca HTML.
   - `GET /bff/api/rota-inexistente` sem sessão (V5-404) → 401 `AUTH_REQUIRED` (a checagem de auth roda antes do allowlist match, esperado — o caso 404-por-allowlist com sessão válida e o caso 403-por-CSRF, que exigem um login real via Cognito Hosted UI, não foram exercitados por não serem automatizáveis via `curl` sozinho; a propriedade crítica de segurança — nenhum erro do BFF vira HTML da SPA — já está confirmada pelos casos acima).
   - Headers de segurança confirmados chegando ao browser real e DIFERENTES por behavior: SPA (`/`) tem a CSP própria (`script-src 'self'` etc.) + HSTS + `X-Frame-Options: DENY` + `nosniff` + `Referrer-Policy`; BFF (`/bff/session`) tem `default-src 'none'; frame-ancestors 'none'` + os mesmos HSTS/nosniff/Referrer-Policy — exatamente o desenho de duas Response Headers Policy distintas do ADR-0011, verificado real, não só via `terraform plan`.
   **Pendência real registrada**: `document-buckets`/`deploy-manifest-bucket` usam a mesma chave `alias/aws/s3` mas nunca são lidos via CloudFront/OAC (só por IAM de role de Lambda), então não têm este bug — mas se algum desses buckets algum dia ganhar uma origem CloudFront, o mesmo problema se repetiria. Não corrigido preventivamente nesta sessão (fora do escopo desta decisão, nenhum uso real hoje), só registrado como conhecimento para o futuro. **A infra de hospedagem do SPA (etapas 1-5) está fechada de ponta a ponta e ativa em `dev` real.**

## M7 (extração/OCR) — implementação iniciada (2026-08-25, D-057)

Design já aprovado em `docs/architecture/reviews/m7-extraction-design/claude-reconciliation-final-design.md` (D-035, 7 rodadas, 9,2/9,3) — esta seção é sobre a IMPLEMENTAÇÃO, o design não muda. **Escopo é grande** (Step Functions, Textract assíncrono, sandbox de parser isolado, Bedrock condicional, AppConfig, rotas HTTP de confirmação) — vai continuar por múltiplas sessões, não é razoável fechar num único slice. Estado exato ao fim desta sessão:

**Feito**:
1. `docs/architecture/privacy-lgpd.md` §4 ganhou a classe `EXTRACTION_TRANSIENT` — pré-requisito de design que o próprio D-035 exige estar registrado antes de qualquer implementação (não é pendência pós-produção).
2. Módulo novo `src/modules/extraction/domain/` (só domínio puro, zero infra/Lambda/HTTP ainda):
   - `extraction-run.ts` — `ExtractionRun` (chave `TENANT#t#DOC#d`/`RUN#<runId>`, `data-model.md` linha 105) + `deriveExtractionRunId()` determinístico (SHA-256 de `tenantId|documentId|documentVersion|pipelineVersion`, a própria chave de idempotência da execução).
   - `extracted-field.ts` — `ExtractedField` (mesma PK do run, SK `FIELD#<fieldName>#<runId>`, `data-model.md` linha 107), com `ExtractionSource`/`ExtractionAgreement`/`ExtractedFieldState` fechados conforme o exemplo de `implementation-blueprint.md` §12.5.
   - `field-schema.ts` — schema v1 com só `expirationDate` (único campo que o design aprovado nomeia concretamente — deliberadamente não inventei outros campos de produto), `DETERMINISTIC_CONFIDENCE_THRESHOLD = 0.75`, `pipelineVersion`/`thresholdVersion` versionados juntos.
   - `decide-bedrock.ts` — `needsBedrock()` implementando o contrato exato da rodada 4 do design (regras a/b/c, incluindo a regra (c) de ambiguidade real de OCR nunca baseada em confidence isolada de reconhecimento de caractere).
   - `retention.ts` — helper de safety net de 24h para o artefato transitório (a exclusão real é explícita por `ExtractionValidationTaskHandler`, este helper é só a rede de segurança do lifecycle S3).
3. 15 testes novos (740 totais), zero regressão. Commitado direto em `develop` (`docs: ...`/`feat(extraction): ...` — **ainda sem PR/merge para `main`**, dado que não há nenhuma infra/runtime ativável ainda, nada a fazer deploy).

**Item 1 — CONCLUÍDO nesta sessão (2026-08-25/26)**: `infra/modules/feature-flags` (AppConfig real, aplicação/environment/configuration-profile `AWS.Freeform`/deployment instantâneo) entregando os kill switches `AI_EXTRACTION`/`OCR`/`WHATSAPP` (nome do módulo corrigido pelo design — transversal, não `extraction-appconfig`, já que o schema inclui `WHATSAPP`, feature de Notification). Os três defaults `false` (fail-closed, pré-condições externas de M7 não fechadas). Output `feature_flags_read_policy_json` pronto para os workers futuros (item 2+) anexarem. Root `variables.tf` ganhou `extraction_pipeline_enabled` (D-035 §1.6, default `false`) — gate Terraform separado do pipeline inteiro, ainda não referenciado por nenhum recurso (só os workers futuros vão condicionar-se a ele). 2 `terraform test` do módulo + as 13 do `stack.tftest.hcl` passando, `terraform fmt`/`validate` limpos, `terraform plan -target=module.feature_flags` real contra `dev` (perfil `claude-dev`) confirmou 6 recursos a criar sem erro. **PR #57 mergeado, CI verde, CD aplicou com sucesso em `dev` real** (AppConfig application/environment/configuration-profile/deployment reais existem agora na conta `dev`).

**Item 3 (ASL) e item 4 (`TextractTaskHandler`) — CAMADA PURA CONCLUÍDA nesta sessão (2026-08-26), sem runtime/infra real ainda** (mesmo padrão que o item 0 seguiu: domínio+aplicação primeiro, depois handler Lambda/infra numa fatia posterior — deliberado, não um corte de escopo silencioso):

- Taxonomia de erro nova em `src/shared/errors/app-error.ts`: `UnsupportedDocumentTypeError`/`OcrDisabledError`/`TextractUnsupportedDocumentError`/`TextractPartialFailureError`/`TextractJobPersistenceFailedError` — cada `code` casa literalmente com o `ErrorEquals` correspondente no ASL (ex.: `code: "UnsupportedDocumentType"`), nunca renomear um sem o outro.
- `src/modules/extraction/domain/textract-job.ts` — entidade `TextractJob` (chave própria `TEXTRACTJOB#<jobId>`/`TEXTRACTJOB#<jobId>`, deliberadamente não tenant-scoped — `COMPLETE_OCR` só tem `jobId` disponível da notificação SNS/SQS), `deriveTextractClientRequestToken()` determinístico, `computeTextractJobTtl()`. Documentado em `docs/architecture/data-model.md` (nova seção "TextractJob").
- `src/modules/extraction/domain/document-classifier.ts` — classificador heurístico puro (magic bytes > extensão > contentType), `classifyDocumentType()` retorna `null` (nunca lança) quando nenhum sinal é conclusivo — quem decide que isso é `UnsupportedDocumentTypeError` é o caller.
- Portas novas em `src/modules/extraction/ports/`: `feature-flags-reader.ts` (fail-closed é responsabilidade do caller, não do adapter), `textract-job-store.ts`, `textract-client.ts`, `ocr-artifact-store.ts` (sem método de delete — a exclusão do artefato é exclusivamente de `ExtractionValidationTaskHandler`, item 7, nunca deste handler), `task-token-encryptor.ts` (mesmo contrato de `src/modules/bff/ports/token-encryptor.ts`, declarado localmente por disciplina de fronteira de módulo), `task-token-sender.ts` (`SendTaskOutcome` distingue `SENT`/`TERMINAL_QUIET`/`TERMINAL_WARN_INVALID_TOKEN`; qualquer outro erro de `SendTask*` deve ser relançado pelo adapter, nunca capturado).
- `src/modules/extraction/application/start-ocr.ts` (`startOcr()`) — orquestra classificação → kill switch `OCR` (fail-closed) → reserva `AI_CALL` idempotente (`TenantQuotaService.consume` com `window: "<runId>|TEXTRACT"`, `limit: 1` — um retry do mesmo run encontra `QuotaExceededError` contra a própria reserva anterior e trata como "já reservado", não como falha real) → `StartDocumentTextDetection` (com `ClientRequestToken` determinístico) → persiste `TextractJob` com retry local (`jobPersistAttempts`, default 2) antes de propagar `TextractJobPersistenceFailedError`. Nunca chama `SendTaskSuccess` — retorna void, a execução do Step Functions fica parada no `taskToken` até `completeOcr` resolver depois. Compensa a quota via `TenantQuotaService.release()` quando o próprio `StartDocumentTextDetection` falha.
- `src/modules/extraction/application/complete-ocr.ts` (`completeOcr()`) — busca `TextractJob` por `jobId`; caso órfão (nenhum job encontrado) faz UMA chamada de confirmação a `GetDocumentTextDetection`, descarta o resultado, nunca trata como erro; pagina os resultados; `SUCCEEDED`/`PARTIAL_SUCCESS` persistem o artefato e chamam `SendTaskSuccess` (com warning `PARTIAL_OCR` no caso parcial); `FAILED` chama `SendTaskFailure(TextractPartialFailure)`; **nunca apaga o artefato transitório em nenhum caminho** (o port `OcrArtifactStore` nem expõe um método de delete); `taskTokenCiphertext` é limpo em qualquer desfecho terminal do `SendTask*` (sucesso, `TERMINAL_QUIET`, `TERMINAL_WARN_INVALID_TOKEN`) e preservado (erro relançado, sem tocar no registro) em qualquer outro erro — a mensagem SQS reentrega normalmente.
- Schema novo `schemas/queues/textract-completion.v1.json` (envelope SNS bruto — `Type`/`MessageId`/`TopicArn`/`Message`, o `Message` interno não é revalidado como JSON aninhado, mesma convenção de `notification-ses-callback.v1.json`) + 4 casos novos em `test/contract/schemas.test.ts`.
- `infra/state-machines/document-extraction.asl.json` — `RunTextract` é o único Task state real (aponta para `textract-task:live`, `waitForTaskToken`, `Catch` cobrindo os 5 códigos de erro novos + timeouts, tudo indo para `RunDeterministicParser`, nunca direto para `MarkPendingConfirmation`). Os demais ~9 estados (`RunDeterministicParser`/`NeedsBedrock`/`CheckAiKillSwitch`/`RunBedrock`/`ValidateSchema`/`CompareExtractors`/`PersistExtractedFields`/`MarkPendingConfirmation`/`CompleteRun`) são stubs documentados referenciando Lambdas dos itens 5-7 (`pdf-parser-task:live`/`bedrock-extraction-task:live`/`extraction-validation-task:live`), que ainda não existem.
- `infra/modules/extraction-workflow/` — módulo Terraform novo (`variables.tf`/`main.tf`/`outputs.tf`/`versions.tf`), parametrizado pelas 4 ARNs de função + role de execução, usa `templatefile`-like `replace()` encadeado para substituir os placeholders `"textract-task:live"` etc. pelas ARNs reais no `definition` do `aws_sfn_state_machine`. **Deliberadamente NÃO chamado em `infra/main.tf`** — um `aws_sfn_state_machine` cujo `definition` referencia uma Lambda inexistente falha o `apply` real (não só em runtime), e os 3 handlers dos itens 5-7 não existem. Verificado standalone: `terraform fmt`/`init -backend=false`/`validate` limpos dentro do próprio diretório do módulo. Nenhum `terraform test` (`.tftest.hcl`) escrito ainda para este módulo especificamente — pendência explícita abaixo.
- 35 testes novos (783 totais no backend, era 748): `test/unit/extraction/{document-classifier,textract-job,start-ocr,complete-ocr}.test.ts`, todos com fakes escritos à mão (sem `vi.mock`), cobrindo: classificação por magic-bytes/extensão/contentType/prioridade; determinismo do `ClientRequestToken`; caminho feliz de `startOcr`; `UnsupportedDocumentTypeError` antes de tocar flags/quota/Textract; `OcrDisabledError` (kill switch off e leitura de flags falhando, fail-closed); compensação de quota + `TextractUnsupportedDocumentError` quando o Textract falha; idempotência da reserva de quota sob retry do mesmo run; retry local de persistência do `TextractJob` (sucesso após 1 falha, esgotamento após N); `completeOcr`: job órfão (com e sem falha na confirmação), já-finalizado (ciphertext ausente), `SUCCEEDED`/`PARTIAL_SUCCESS`/`FAILED`, paginação multi-página, os 3 desfechos terminais limpando o ciphertext, erro transitório de `SendTask*` relançado sem tocar no ciphertext, e a invariante "nunca apaga o artefato" (o port não expõe delete). `npm run typecheck`/`lint`/`test`/`validate-schemas`/`check-docs` limpos; `terraform fmt -check -recursive` limpo na árvore inteira de `infra/`.

**Item 4 — CONCLUÍDO nesta sessão (2026-08-26), real runtime + infra, ainda sem PR/merge**: as três decisões pendentes acima foram todas tomadas e implementadas (não deixadas como pendência):
- **AppConfig no Lambda: `@aws-sdk/client-appconfigdata` direto, decisão final** (não a extensão via layer) — `src/modules/extraction/persistence/appconfig-feature-flags-reader.ts`, `StartConfigurationSession`+`GetLatestConfiguration` com cache de `nextToken`/últimos flags conhecidos em memória do processo. Motivo: a extensão via Lambda Layer precisaria de uma ARN de layer gerenciada pela AWS wireada em `infra/modules/lambda-function` — não existe nenhum precedente disso no repo (só `adot_layer_arn`, uma layer diferente), e este handler só lê os flags uma vez por invocação de `START_OCR` (não por página/bloco), então o custo/latência de uma chamada de API direta por invocação é equivalente ao que a extensão teria numa invocação fria de qualquer forma. Revisitar só se o volume tornar isso um custo real (a extensão amortiza entre invocações warm via cache local, este adapter só amortiza dentro de uma sessão de token de um processo longo).
- **`TaskTokenEncryptor` real: CMK nova dedicada** (`aws_kms_key.task_token` em `infra/main.tf`), não reuso da CMK do BFF — mesma disciplina D-054: um token de callback do Step Functions é uma credencial viva tão sensível quanto o refresh token do BFF, e compartilhar uma CMK entre dois módulos independentemente deployáveis acoplaria rotação/key-policy dos dois. `src/modules/extraction/persistence/kms-task-token-encryptor.ts` (`KmsTaskTokenEncryptor`, estruturalmente idêntico a `bff`'s `KmsTokenEncryptor`, mas declarado localmente por disciplina de fronteira de módulo, mesma razão do port).
- **Tópico SNS de conclusão do Textract: criado** (`aws_sns_topic.textract_completion`) + role IAM dedicada (`aws_iam_role.textract_sns_publisher`, `sts:AssumeRole` escopado a `textract.amazonaws.com`) que o Textract assume para publicar — distinta da role de execução do próprio Lambda.

Real (código + infra, não só camada pura):
- Adapters: `DynamoDbTextractJobStore`, `TextractSdkClient` (`@aws-sdk/client-textract`), `S3OcrArtifactStore`, `KmsTaskTokenEncryptor`, `SfnTaskTokenSender` (`@aws-sdk/client-sfn`, classificação real `TaskTimedOut`/`TaskDoesNotExist`→`TERMINAL_QUIET`, `InvalidToken`→`TERMINAL_WARN_INVALID_TOKEN`, qualquer outro erro relançado), `AppConfigFeatureFlagsReader` — todos em `src/modules/extraction/persistence/`.
- Composition root `src/modules/extraction/composition/extraction.ts` (`buildTextractTaskWorkerDeps`).
- Handler real `src/runtime/aws/handlers/textract-task-handler.ts` — um único deployable dispatando por shape de evento: `START_OCR` (invocação direta do Step Functions via `lambda:invoke.waitForTaskToken`, evento `{ operation, taskToken, input }`) vs `COMPLETE_OCR` (`SQSEvent`, mesmo padrão `batchItemFailures` de `extraction-starter-handler.ts`, envelope SNS bruto per `schemas/queues/textract-completion.v1.json`). `SecureLogger`/`runWithContext` em todo lugar, nunca loga task token/texto OCR.
- Infra real em `infra/main.tf`: Lambda+role IAM (Textract Start/Get, `states:SendTaskSuccess/Failure/Heartbeat`, KMS na CMK nova, S3 leitura no bucket clean + leitura/escrita no bucket `EXTRACTION_TRANSIENT` novo, `feature_flags_read_policy_json`), bucket `EXTRACTION_TRANSIENT` (SSE-S3 deliberadamente, não SSE-KMS — evita a MESMA classe de bug do incidente OAC/KMS do spa-hosting, aqui sem necessidade real porque só a role deste Lambda toca o bucket; lifecycle 24h = `EXTRACTION_TRANSIENT_LIFECYCLE_HOURS`), fila+DLQ (`sqs-worker-queue`) assinando o tópico SNS, permissão `lambda:InvokeFunction` para `states.amazonaws.com` já escopada à ARN determinística da state machine futura (`local.extraction_state_machine_arn`, já existia desde o item 2). **Nenhum recurso condicionado a `var.extraction_pipeline_enabled`** — mesma lógica do item 2: todo recurso aqui é inerte sozinho, porque `StartDocumentTextDetection` (a única chamada paga) só roda se o Step Functions invocar este Lambda via `waitForTaskToken`, e a state machine (item 3) ainda não existe.
- Novo output `textract_task_handler_function_arn` (ponto de wiring para o módulo `extraction-workflow` do item 3, ainda uninstantiated). `scripts/build-lambdas.ts` ganhou `"textract-task-handler"`. `infra/tests/stack.tftest.hcl` atualizado de 27→28 funções (2 asserts).
- 11 testes novos (794 totais no backend) — só para os dois adapters com lógica real de branching (`SfnTaskTokenSender`'s classificação de erro, `AppConfigFeatureFlagsReader`'s cache de sessão); os wrappers puramente pass-through (`DynamoDbTextractJobStore`, `TextractSdkClient`, `S3OcrArtifactStore`, `KmsTaskTokenEncryptor`) não ganharam teste unitário dedicado, seguindo o MESMO precedente já existente no repo (`DynamoDbExtractionRunStore`, `KmsTokenEncryptor`, `SfnExtractionExecutionStarter` também não têm) — verificados via `terraform plan` real contra `dev`, não via mock unitário.
- `typecheck`/`lint`/`check-boundaries`/`test`/`validate-schemas`/`check-docs` limpos. `terraform fmt -check -recursive` limpo, `terraform validate` limpo, `terraform test` 13/13 passando, `terraform plan` real contra `dev` (perfil `claude-dev`) tanto `-target=` nos 30 recursos novos quanto full-stack sem target — 0 erros, 0 destroys inesperados (só o próprio slice + o ruído de republish de versão já pré-existente em todas as outras Lambdas). **Nunca `terraform apply` local** (`AGENTS.md` §3).
- Commits em `develop`: `853ac01` (camada de runtime real) e `fc20dd5` (infra real) — **ainda sem PR/merge para `main`** no momento em que este parágrafo foi escrito (abrir o PR é o próximo passo imediato desta mesma sessão, ver "Próxima ação" no topo do arquivo).

**Item 5 (`PdfParserTaskHandler`) — CONCLUÍDO nesta sessão (2026-08-26), real de ponta a ponta**: bem mais estreito que o item 4 — a ASL's `RunDeterministicParser` é `arn:aws:states:::lambda:invoke` **sem** `waitForTaskToken` (não há task token nenhum neste handler), então é uma única invocação síncrona, sem SQS, sem `SendTaskSuccess/Failure`, sem DynamoDB/Textract/KMS/Step Functions client.

- Domínio novo `src/modules/extraction/domain/deterministic-field-parser.ts` — `extractExpirationDateCandidates()`, regex determinístico (dd/mm/yyyy, dd-mm-yyyy, yyyy-mm-dd, pivot de ano de 2 dígitos 80/00) sobre o texto OCR (linhas `LINE` do Textract já concatenadas), nunca sobre bytes de PDF crus e nunca chamando IA. Confiança alta (0.9, acima do `DETERMINISTIC_CONFIDENCE_THRESHOLD`) quando a data está a até 40 caracteres de uma palavra-chave de vencimento (pt-BR/en); confiança fraca (0.5, abaixo do threshold) quando não há palavra-chave próxima. Reaproveita `MAX_DECOMPRESSED_BYTES` de `workers/parser-sandbox/parser.ts` (M6) como o limite numérico que trunca o texto processado — a única reutilização real de M6 possível aqui, já que o parser estrutural de M6 (`parsePdfStructure`) opera sobre bytes de PDF, não sobre texto OCR, e nunca extrai campos/datas (só valida estrutura). `DeterministicParserFailedError` novo em `app-error.ts` (código `DeterministicParserFailed`) — não precisa casar literalmente com nenhum `ErrorEquals` porque o `Catch` deste estado no ASL já é o genérico `States.ALL`.
- Aplicação nova `src/modules/extraction/application/run-deterministic-parser.ts` — `runDeterministicParser()`: lê o artefato OCR (quando presente) → extrai candidatos de `expirationDate` via `getFieldSchema()` → chama `needsBedrock()` (item 0) → lê o kill switch `AI_EXTRACTION` (fail-closed) → retorna `{..., extractedFields, needsBedrock, aiExtractionEnabled}`. Caminho degradado (Textract falhou, sem artefato): **nunca fabrica um candidato** — retorna `extractedFields` vazio, deixando `needsBedrock()` decidir (regra (a), "sem candidato" já implica `true`) e a decisão real cair pra Bedrock/`PENDING_CONFIRMATION` a jusante, nunca inventando aqui.
- Porta estendida (não duplicada) `OcrArtifactStore` ganhou `get()` — o item 4 só tinha `put()` (quem escreve o artefato); o item 5 é o primeiro leitor real. `S3OcrArtifactStore.get()` implementado. Continua sem `delete()` (invariante do item 4 preservada — só `ExtractionValidationTaskHandler`, item 7, apaga).
- **Achado real corrigido durante a implementação, não uma decisão de produto nova**: `completeOcr`'s `SendTaskSuccess` (item 4) não tinha `ResultPath` na transição de sucesso do ASL, então seu payload (`{ocrAvailable, artifact, warnings}`) **substituía inteiramente** o `$` do Step Functions — todo o contexto original da execução (`tenantId`/`itemId`/`documentId`/`documentVersion`/`runId`/`pipelineVersion`) seria perdido para `RunDeterministicParser` no caminho feliz (no caminho degradado, o `Catch`'s `ResultPath: "$.ocrFailure"` preserva o `$` original normalmente, então só o caminho de sucesso tinha o problema). Corrigido: `TextractJob` ganhou o campo `pipelineVersion` (gravado por `startOcr`), e `completeOcr` reanexa `tenantId`/`itemId`/`documentId`/`documentVersion`/`runId`/`pipelineVersion` (lidos do próprio `job`) ao payload de sucesso. Mudança aditiva/reversível sem migração de dado real (o registro tem TTL de 24h, nunca houve dado histórico real).
- **DECISÃO PENDENTE (registrada aqui, default conservador aplicado)**: o design (§1.3) menciona "parser tries file-metadata-only heuristics" para o caminho degradado (sem OCR). Não implementado — nenhum campo de metadado de PDF (data de criação, autor, etc.) corresponde semanticamente a `expirationDate`; inventar esse mapeamento seria uma decisão de produto não revisada, não um default de engenharia. Ficou como fallback conservador (zero candidatos, nunca um valor fabricado). Revisitar só se um campo futuro do schema realmente mapear para metadado real de arquivo.
- **Achado de correção na própria ASL, sem alterar topologia/Next states**: o retorno real de uma `arn:aws:states:::lambda:invoke` (sem `waitForTaskToken`) vem embrulhado em `{ExecutedVersion, Payload, StatusCode}` — os `Choice` states `NeedsBedrock`/`CheckAiKillSwitch` (stubs dos itens 6/7, ainda não implementados) referenciavam `$.needsBedrock`/`$.aiExtractionEnabled` diretamente, o que nunca teria batido com o payload real do handler. Corrigido para `$.Payload.needsBedrock`/`$.Payload.aiExtractionEnabled` — não muda nenhum `Next`/fluxo, só corrige o path de leitura para bater com a semântica real do `lambda:invoke`. Um `ResultSelector` mais limpo fica para quando os itens 6/7 forem implementados de verdade e o formato completo puder ser redesenhado junto.
- Composição `buildPdfParserTaskWorkerDeps`/`createRealPdfParserTaskWorkerClients` em `src/modules/extraction/composition/extraction.ts` — só S3 + AppConfig como clientes reais (nada de DynamoDB/Textract/KMS/SFN).
- Handler real `src/runtime/aws/handlers/pdf-parser-task-handler.ts` — invocação síncrona única (`handler(event) -> output`), `SecureLogger`/`runWithContext`, nunca loga texto OCR.
- Infra real em `infra/main.tf`: Lambda+role IAM (só `s3:GetObject` no bucket `EXTRACTION_TRANSIENT` + `feature_flags_read_policy_json` — sem tabela DynamoDB, sem KMS, sem SNS/SQS), `aws_lambda_permission` para `states.amazonaws.com` já escopado à ARN determinística da state machine futura (mesmo padrão do item 4). Novo output `pdf_parser_task_handler_function_arn`. `scripts/build-lambdas.ts` ganhou `"pdf-parser-task-handler"`. `infra/tests/stack.tftest.hcl` atualizado de 28→29 funções (3 asserts: nomes, distinção, `lambda_published_versions`).
- 18 testes novos (812 totais no backend, era 794): `test/unit/extraction/deterministic-field-parser.test.ts` (10, incluindo dedup por valor, ambiguidade de 2+ candidatos, truncamento no limite de M6, combinações dia/mês impossíveis) e `test/unit/extraction/run-deterministic-parser.test.ts` (8, incluindo caminho feliz, caminho degradado nunca fabricando candidato, fail-closed do `AI_EXTRACTION`, falha de leitura/parse do artefato levantando `DeterministicParserFailedError`).
- `typecheck`/`lint`/`check-boundaries`/`test`/`validate-schemas`/`check-docs` limpos. `terraform fmt -check -recursive` limpo, `terraform validate` limpo, `terraform test` 13/13 passando, `terraform plan` real contra `dev` (perfil `claude-dev`) tanto `-target=` nos 8 recursos novos (0 erros) quanto full-stack sem target (9 a criar, 56 a mudar — só republish de versão pré-existente em todas as Lambdas, mesmo ruído que o item 4 já documentou; 1 destroy-and-recreate em `aws_lambda_permission.textract_task_from_state_machine` — drift **pré-existente do item 4**, não introduzido nesta sessão, causado por uma normalização de `function_name` com/sem qualificador `:live` que o provider AWS já detectava antes desta sessão começar; não corrigido aqui por estar fora do escopo do item 5, registrado para quem tocar o item 3/ASL wiring depois). **Nunca `terraform apply` local**.

**O que faltava depois do item 6 — ambos concluídos em sessões subsequentes**:
1. ~~Item 3 (ASL) precisa ser instantiado de verdade~~ — **CONCLUÍDO 2026-08-26**, ver "Item 3 — CONCLUÍDO nesta sessão" abaixo.
2. ~~Item 7 (`ExtractionValidationTaskHandler`)~~ — **CONCLUÍDO 2026-08-26**, ver seção dedicada abaixo.

## Item 6 (`BedrockExtractionTaskHandler`) — CONCLUÍDO nesta sessão (2026-08-26), real de ponta a ponta

Mesmo padrão do item 5 (`arn:aws:states:::lambda:invoke` plano, sem `waitForTaskToken` — sem task token, sem SQS, sem `SendTaskSuccess/Failure`), mas com DynamoDB (quota) e o cliente Bedrock Runtime a mais.

**Achado real corrigido durante a implementação, na própria ASL** (não uma decisão de produto nova): o retorno de `RunDeterministicParser` (item 5, também um `lambda:invoke` simples) nunca tinha `OutputPath`/`ResultSelector`, então `$` depois desse Task virava o wrapper bruto `{ExecutedVersion, Payload, StatusCode}` — os `Choice` states `NeedsBedrock`/`CheckAiKillSwitch` já liam `$.Payload.needsBedrock`/`$.Payload.aiExtractionEnabled` corretamente (fix do item 5), mas o próprio `RunBedrock` (`Payload.$: "$"`) enviaria esse wrapper INTEIRO para `BedrockExtractionTaskHandler`, não o `RunDeterministicParserOutput` limpo. Corrigido: `RunDeterministicParser` ganhou `ResultSelector: {"Payload.$": "$.Payload"}` + `OutputPath: "$.Payload"`, que descarta o wrapper `lambda:invoke` — `NeedsBedrock`/`CheckAiKillSwitch` foram atualizados para ler `$.needsBedrock`/`$.aiExtractionEnabled` diretamente (não mais `$.Payload.*`), e `RunBedrock`'s `Payload.$: "$"` agora envia exatamente `RunBedrockExtractionInput` (que espelha `RunDeterministicParserOutput`). `ValidateSchema` (item 7, ainda stub) vai precisar do mesmo tratamento quando for implementado de verdade.

**Segundo achado real, mesma causa raiz**: `RunDeterministicParserOutput` nunca carregava o `artifact: ExtractionArtifactRef` de volta — sem isso, `BedrockExtractionTaskHandler` não teria como saber onde ler o texto OCR (o design §1.9 exige `textArtifact` no request, nunca uma segunda leitura via Textract). Corrigido: `runDeterministicParser()` agora reanexa `input.artifact` no output quando `ocrAvailable`, mesma disciplina de reanexação de contexto que `completeOcr` (item 4/5) já tinha estabelecido para `tenantId`/`itemId`/etc.

**Real (código + infra, não só camada pura)**:
- Domínio novo `src/modules/extraction/domain/bedrock-extraction.ts` — `BEDROCK_SYSTEM_PROMPT_V1`/`BEDROCK_SYSTEM_PROMPT_VERSION` (constante versionada e imutável, nunca concatenada com input do usuário), `buildSubmitExtractionToolSchema()` (schema fechado, `additionalProperties: false`, gerado a partir de `FIELD_SCHEMA_V1` — nunca hardcoded separadamente do schema real), `buildUserMessageText()` (bloco `<untrusted_document_text>` com truncamento em `BEDROCK_MAX_ARTIFACT_CHARS`), `BedrockExtractionRequest` (só `textArtifact` — tipo local `BedrockTextArtifactRef`, estruturalmente idêntico a `ExtractionArtifactRef` do port mas declarado localmente porque `dependency-cruiser` proíbe domínio importar de `ports/`).
- Porta nova `src/modules/extraction/ports/bedrock-client.ts` (`BedrockClient.extract()`) — nenhum import do SDK Bedrock fora do adapter.
- Aplicação nova `src/modules/extraction/application/run-bedrock-extraction.ts` (`runBedrockExtraction()`) — re-checa `AI_EXTRACTION` fail-closed (defesa em profundidade, o `Choice` da ASL já filtra isso mas a chamada paga nunca confia só nisso), reserva `AI_CALL` idempotente (`runId|BEDROCK`, mesmo padrão de `runId|TEXTRACT` do item 4), chama `BedrockClient.extract()`, compensa a quota (`release()`) se a chamada falhar, nunca fabrica candidato quando não há artefato (caminho totalmente degradado retorna `bedrockFields: []`). Consome exatamente o que `runDeterministicParser()` produz — nunca reimplementa `needsBedrock()`.
- Adapter real `src/modules/extraction/persistence/bedrock-runtime-client.ts` (`BedrockRuntimeConverseClient`) — Converse API real (`@aws-sdk/client-bedrock-runtime@3.1114.0`, adicionado ao `package.json`), `toolChoice` forçado a `submit_extraction`, `temperature: 0`, `maxTokens: BEDROCK_MAX_OUTPUT_TOKENS`, valida a resposta do tool-call contra o schema fechado derivado de `getFieldSchema()` (rejeita chave extra, campo obrigatório ausente, tipo errado, confidence fora de `[0,1]`, ausência de tool-call, tool errado) — qualquer falha vira `BedrockExtractionFailedError`, nunca um resultado parcial silencioso.
- Taxonomia de erro nova em `app-error.ts`: `AiExtractionDisabledError`/`BedrockExtractionFailedError`.
- Composição `buildBedrockExtractionTaskWorkerDeps`/`createRealBedrockExtractionTaskWorkerClients` em `extraction.ts` — DynamoDB (quota) + S3 (artefato) + AppConfig + `BedrockRuntimeClient` (região configurável via `bedrock_region`, distinta da região do stack).
- Handler real `src/runtime/aws/handlers/bedrock-extraction-task-handler.ts` — invocação síncrona única, `SecureLogger`/`runWithContext`, nunca loga texto de documento/prompt/resposta do modelo.
- **Modelo/região Bedrock: configuráveis, com default obviamente placeholder** (`var.bedrock_model_id = "PLACEHOLDER_BEDROCK_MODEL_ID_NOT_SELECTED"`, `var.bedrock_region = "us-east-1"`) — design §4 bloqueia só a escolha/validação real para produção, nunca a testabilidade em `dev`; a permissão IAM já é escopada ao ARN pattern do placeholder (`bedrock:InvokeModel`/`bedrock:Converse` em `arn:aws:bedrock:<region>::foundation-model/<model_id>`), nunca `"*"`.
- Infra real em `infra/main.tf`: Lambda+role IAM (`module.table.tenant_facing_read_write_policy_json` para a quota — mesmo padrão do item 4 —, `feature_flags_read_policy_json`, `s3:GetObject` só leitura no bucket `EXTRACTION_TRANSIENT` — nunca escrita, mesma disciplina de blast-radius do item 5 —, `bedrock:InvokeModel`/`bedrock:Converse` escopados), sem VPC, sem acesso a Textract/outros serviços. `aws_lambda_permission` para `states.amazonaws.com` já escopado à ARN determinística da state machine futura. Novo output `bedrock_extraction_task_handler_function_arn`. `scripts/build-lambdas.ts` ganhou `"bedrock-extraction-task-handler"`. `infra/tests/stack.tftest.hcl` atualizado de 29→30 funções (3 asserts) + `infra/outputs.tf`.
- 18 testes novos (830 totais no backend, era 812): `test/unit/extraction/run-bedrock-extraction.test.ts` (6 — caminho feliz, fail-closed do kill switch em duas variantes, caminho degradado sem artefato, compensação de quota em falha, **14º caso adversarial de custo-abuso**: execução retentada/duplicada do mesmo `runId` reserva contra a própria janela `runId|BEDROCK` anterior, nunca dobra chamadas reais por retry) e `test/unit/extraction/bedrock-runtime-client.test.ts` (12 — corpus adversarial do adapter: sem tool-call, tool errado, chave extra no schema fechado, campo obrigatório ausente, tipo errado, confidence fora de faixa, falha da própria chamada Converse, falha de leitura do artefato antes de gastar a chamada, texto do documento (incluindo uma tag de fechamento falsificada tentando "escapar" do bloco untrusted) nunca aparece fora do bloco `user`/nunca influencia o parsing além do que o tool-call estruturado diz, `system` sempre a constante fixa, `toolChoice` sempre forçado, `temperature`/`maxTokens` sempre as constantes de design). Um corpus adversarial "de 13 casos do Codex" citado no design (§1.11) não foi encontrado verbatim em nenhum arquivo sob `docs/architecture/reviews/m7-extraction-design/` (procurado antes de escrever os testes) — o corpus construído cobre as mesmas classes de ameaça descritas ali (injeção via conteúdo do documento, tool errado/nenhum tool, estouro de schema/token, resposta malformada, mais o 14º caso de custo-abuso) a partir de princípios, documentado no comentário de topo de cada arquivo de teste.
- `typecheck`/`lint`/`check-boundaries`/`test`/`validate-schemas`/`check-docs` limpos. `terraform fmt -check -recursive` limpo, `terraform validate` limpo, `terraform test` 13/13 passando, `terraform plan` real contra `dev` (perfil `claude-dev`) tanto `-target=` nos 10 recursos novos do handler (0 erros) quanto full-stack sem target (19 a criar — os do item 5 ainda não aplicado + os do item 6 —, 56 a mudar — mesmo ruído de republish de versão já documentado nos itens 4/5 —, 1 destroy-and-recreate — o MESMO drift pré-existente do item 4/5 em `aws_lambda_permission.textract_task_from_state_machine`, não introduzido nesta sessão). **Nunca `terraform apply` local**.
- **Decisão pendente registrada, não bloqueante**: nenhum campo do design nomeia hoje um segundo campo além de `expirationDate`, então o schema fechado do tool `submit_extraction` só tem essa uma propriedade — `buildSubmitExtractionToolSchema()` já é genérico sobre `FIELD_SCHEMA_V1`, então um campo novo no schema não precisa de mudança de código aqui, só uma nova versão de `pipelineVersion`/`thresholdVersion` (mesma disciplina de `field-schema.ts`).

## Item 7 (`ExtractionValidationTaskHandler`) — CONCLUÍDO nesta sessão (2026-08-26), real de ponta a ponta

Fecha as ASL states 8-12 (`ValidateSchema`/`CompareExtractors`/`PersistExtractedFields`/`MarkPendingConfirmation`/`CompleteRun`) — todas as cinco invocam o MESMO Lambda com um `operation` distinto no payload (mantidas como Task states separados no ASL para auditoria/`Catch` por estágio, design §2, nunca colapsadas). Consumidor real dos outputs dos itens 5/6 (`RunDeterministicParserOutput`/`RunBedrockExtractionOutput`).

**A decisão mais importante desta sessão — a limpeza do artefato transitório (design §3, "achado mais sério")**: `OcrArtifactStore.delete()` é chamado em EXATAMENTE dois lugares: `completeRunStage()` (caminho normal, depois que `PersistExtractedFields` já commitou o resultado no banco) e `markPendingConfirmationStage()` (caminho de falha catastrófica do parser determinístico, que nunca passa por `PersistExtractedFields`/`CompleteRun` — design cita esse estado explicitamente como ponto de deleção "em caminho FAILED"). `validateSchema()`/`compareExtractorsStage()`/`persistExtractedFieldsStage()` NUNCA tocam `delete()` — rodam antes do run alcançar um estado terminal, e uma retentativa de qualquer uma delas precisa poder reler o artefato. Teste dedicado (`run-extraction-validation.test.ts`, describe "governing invariant") prova isso rodando a sequência completa via `runExtractionValidation()` e contando chamadas de `delete()` depois de cada estado — zero até `CompleteRun`/`MarkPendingConfirmation`, exatamente uma ali.

**Domínio novo** (`src/modules/extraction/domain/`):
- `validate-field-value.ts` — `isValidFieldValue(valueType, value)`: `DATE` exige `yyyy-mm-dd` E que a data seja calendarmente válida (rejeita `2027-13-40`), `NUMBER` exige `Number.isFinite`, `STRING` exige não-vazio. Um candidato inválido nunca é descartado silenciosamente — é marcado `valid: false` e tratado como "essa fonte não produziu nada" na comparação.
- `compare-extractors.ts` — `compareExtractors(candidates)`: 0 candidatos usáveis → `SINGLE_SOURCE` sem `candidateValue` (caso degenerado que `ExtractionAgreement` — já fechado no item 0 como `SINGLE_SOURCE\|MATCH\|MISMATCH` — não representa separadamente; decisão registrada aqui em vez de alargar o tipo já commitado). 1 candidato → `SINGLE_SOURCE` com valor. 2+ concordando → `MATCH` (confiança = a maior das duas). 2+ discordando → `MISMATCH` (nunca resolve automaticamente escolhendo um "vencedor" — `candidateValue` carrega só o de maior confiança, para exibição, mas é `agreement` que decide o roteamento).
- `decide-field-outcome.ts` — `decideFieldOutcome(comparison)`: sem `candidateValue` → `PENDING_CONFIRMATION`; `MISMATCH` → `PENDING_CONFIRMATION` sempre; `SINGLE_SOURCE` com confiança indefinida ou abaixo de `DETERMINISTIC_CONFIDENCE_THRESHOLD` (0.75) → `PENDING_CONFIRMATION`; senão (`MATCH`, ou `SINGLE_SOURCE` confiante) → `CONFIRMED` com `confirmedValue` = o candidato. **Nunca retorna `REJECTED`** — esse estado só é alcançável pela rota HTTP de rejeição humana (item 8, ainda não implementada).

**Decisão de arquitetura tomada nesta sessão (não estava no design, resolvida por inferência direta do enum já commitado)**: `ExtractionRunStatus` (`RUNNING\|COMPLETED\|FAILED\|DISCARDED`) não tem um estado "aguardando confirmação" separado — então a distinção "run completa vs. precisa de revisão humana" vive inteiramente no nível de CADA `ExtractedField` (campo `state`), nunca no `ExtractionRun` em si. Isso resolve a pergunta "o run chega a `COMPLETED` imediatamente, ou vai para `MarkPendingConfirmation`" da seguinte forma: no caminho normal (schema válido → comparação → persistência), o run SEMPRE termina em `CompleteRun`/`status: COMPLETED`, mesmo que um ou mais campos individuais fiquem `PENDING_CONFIRMATION` (sinalizado por `requiresReview: true` no contexto de saída, hoje só para log/observabilidade — nenhuma rota HTTP consome esse campo ainda, ver item 8). `MarkPendingConfirmation`/`status: FAILED` é reservado exclusivamente para quando `RunDeterministicParser` falha catastroficamente ANTES de qualquer candidato existir (nenhum `ValidateSchema`/`CompareExtractors`/`PersistExtractedFields` chega a rodar nesse caminho — o próprio `MarkPendingConfirmation` monta e persiste os `ExtractedField` do schema, todos `PENDING_CONFIRMATION` sem candidato, E apaga o artefato, tudo numa única operação, porque é o único passo que esse ramo do ASL executa). Se essa leitura divergir do que o Marcelo pretendia ao aprovar o design original, é uma decisão de produto pequena e reversível (mudar só a decisão de estado, não a mecânica de comparação/persistência) — registrado aqui para reabrir se necessário.

**Descarte por exclusão concorrente (design §3)**: implementado via `DocumentReader.get()` (leitura fresca do `Document` logo antes de persistir) + um `ConditionCheck` (`buildVersionConditionCheck`) dentro do MESMO `TransactWriteItems` que grava os `ExtractedField`/atualiza o `ExtractionRun`, reasserindo que a versão do `Document` lida não mudou entre a leitura e o commit (fecha o TOCTOU real, não só um "ler status DELETED e torcer"). Se o `Document` já estava `DELETED` no momento da leitura, nem chega a montar a transação — chama `ExtractionRunStore.updateStatus(..., "DISCARDED", ...)` direto, sem persistir nenhum `ExtractedField`. Se a condição falhar dentro da transação (mudança concorrente entre a leitura e o commit), `commitRunOutcome()` retorna `"DOCUMENT_DISCARDED"` (tratamento uniforme de qualquer cancelamento da transação como descarte — decisão conservadora documentada no comentário do adapter, já que distinguir a causa exata do cancelamento por código de erro do SDK seria frágil entre versões).

**Ports/persistência**:
- `ports/extracted-field-store.ts` (`ExtractedFieldStore`, novo) — expõe SÓ `commitRunOutcome()`, nunca um `put`/`batchPut` avulso: grava todos os `ExtractedField` do run + atualiza `ExtractionRun.status` + o `ConditionCheck` do `Document` num único `TransactWriteItems` (tudo ou nada). `DynamoDbExtractedFieldStore` é o adapter real, usando `buildVersionedCreate`/`buildVersionedUpdate`/`buildVersionConditionCheck` de `occ.ts` (nunca `PutItem`/`UpdateItem` cru).
- `ports/extraction-run-store.ts` ganhou `updateStatus(key, tenantId, expectedVersion, "DISCARDED", completedAt)` — método standalone, usado SÓ no caminho de descarte (onde não há nenhum `ExtractedField` para persistir junto). `DynamoDbExtractionRunStore` implementado com `UpdateCommand`+`buildVersionedUpdate`.
- `ports/ocr-artifact-store.ts` ganhou `delete()` — **mudança de contrato deliberada**: o item 4 tinha deixado esse método deliberadamente FORA do port ("a exclusão do artefato é exclusivamente de `ExtractionValidationTaskHandler`, item 7, nunca deste handler" — tornava a exclusão acidental do chamador errado estruturalmente impossível). Agora adicionado porque este É o chamador certo — `S3OcrArtifactStore.delete()` usa `DeleteObjectCommand` (idempotente na própria API do S3, deletar uma key ausente não lança). Os testes que antes afirmavam "o port nem expõe delete" (`complete-ocr.test.ts`) foram reescritos para provar a invariante de outra forma (espiona `artifacts.delete` e conta chamadas, já que o método agora existe no tipo mas `completeOcr` nunca deve chamá-lo).

**Aplicação** (`src/modules/extraction/application/run-extraction-validation.ts`): um dispatcher `runExtractionValidation(deps, operation, input)` sobre cinco funções (`validateSchema`/`compareExtractorsStage`/`persistExtractedFieldsStage`/`markPendingConfirmationStage`/`completeRunStage`), todas operando sobre um único `ValidationContext` que evolui através dos cinco `operation`s. `persistExtractedFieldsStage`/`markPendingConfirmationStage` compartilham um helper `commitOrDiscard()` (não exportado) que encapsula a leitura do `Document`+decisão discard-ou-commit. Um erro genuíno de commit (não um descarte) vira `ExtractionCommitFailedError` (novo em `app-error.ts`, `retryable: true` — o `Catch`/`Retry` da ASL trata como transitório).

**Achado real corrigido nesta sessão, em código do item 6 já commitado**: `RunBedrockExtractionOutput` nunca reanexava `extractedFields`/`artifact`/`needsBedrock`/`aiExtractionEnabled` — a MESMA classe de bug que o item 5 já tinha corrigido uma vez para `completeOcr`'s success payload (design §3's "achado mais sério" é sobre limpeza de artefato, mas essa categoria de "output não reanexa o contexto anterior" já apareceu 3 vezes agora: item 4→5, item 5→6, e este item 6→7). Corrigido de forma aditiva (campos novos só ecoam o que já vinha em `input`, sem recomputar nada) — os testes existentes de `run-bedrock-extraction.test.ts` continuam passando sem alteração (não fazem `toEqual` no objeto inteiro). **Padrão a vigiar em qualquer implementação futura de um novo Task state que consome o output de outro**: sempre conferir se o output reanexa TUDO que o próximo estado vai precisar, nunca assumir que "só preciso retornar o que eu calculei".

**ASL atualizada** (`infra/state-machines/document-extraction.asl.json`): os cinco estados-stub agora são Task states reais com `ResultSelector: {"Payload.$": "$.Payload"}` + `OutputPath: "$.Payload"` (mesmo padrão de desembrulho de `RunDeterministicParser`/`RunBedrock`) e blocos `Retry` (`Lambda.ServiceException`/`Lambda.AWSLambdaException`/`Lambda.SdkClientException`, mais `ExtractionCommitFailed` em `PersistExtractedFields`/`MarkPendingConfirmation`). `RunBedrock` também ganhou `ResultSelector`/`OutputPath` (não tinha nenhum antes — outro sintoma do mesmo achado acima).

**Infra real** (`infra/main.tf`): `module.extraction_validation_task_handler` — o footprint mais estreito dos quatro Lambdas de extração: `module.table.tenant_facing_read_write_policy_json` (leitura de `Document`, escrita de `ExtractedField`/`ExtractionRun`) + uma policy NOVA e estritamente `s3:DeleteObject` (nunca `GetObject`/`PutObject`) no bucket `EXTRACTION_TRANSIENT` — este é o único Lambda do pipeline inteiro com permissão de deletar lá. Sem Textract/Bedrock/VPC/KMS/SNS/SQS/Step Functions client/AppConfig. Uma única `aws_lambda_permission` cobre as cinco invocações (todas vêm do mesmo `states.amazonaws.com`/mesma state machine ARN). Novo output `extraction_validation_task_handler_function_arn`. `scripts/build-lambdas.ts` ganhou `"extraction-validation-task-handler"`. `infra/tests/stack.tftest.hcl` atualizado de 30→31 funções (3 asserts).

**Verificação real**: `typecheck`/`lint`/`check-boundaries`/`validate-schemas`/`check-docs` limpos. 53 testes novos (867 totais no backend, era 830 no início da sessão — não os "920" mencionados por engano na mensagem do primeiro commit desta sessão, número incorreto de digitação, corrigido aqui): `validate-field-value.test.ts` (8), `compare-extractors.test.ts` (6), `decide-field-outcome.test.ts` (7), `run-extraction-validation.test.ts` (16, incluindo o teste de invariante de deleção do artefato descrito acima), mais 16 testes pré-existentes ajustados (fakes que precisaram ganhar `delete()`/`updateStatus()` para continuar implementando as interfaces estendidas). `terraform fmt -check -recursive` limpo, `terraform validate` limpo, `terraform test` 13/13 passando, `terraform plan -target=` real contra `dev` (perfil `claude-dev`) para os 8 recursos novos: 8 a criar, 0 a mudar, 0 a destruir. Plano full-stack sem target: 27 a criar/56 a mudar/1 a destruir — o único destroy é o MESMO drift pré-existente do item 4 em `aws_lambda_permission.textract_task_from_state_machine` (documentado nas sessões dos itens 5/6, não introduzido aqui). **Nunca `terraform apply` local**.

**Decisão de produto pendente registrada, não bloqueante**: nenhuma rota HTTP hoje consome `requiresReview`/`ExtractedField.state === PENDING_CONFIRMATION` — isso é o item 8 (rotas de confirmação/rejeição, §1.7), ainda não implementado. Até lá, um `ExtractedField` `PENDING_CONFIRMATION` existe no banco mas não há nenhuma forma de um operador vê-lo ou agir sobre ele pela API.

**Item 3 — CONCLUÍDO nesta sessão (2026-08-26): a state machine real foi instanciada, plan-verificada contra `dev`**: `module "extraction_workflow"` agora é chamado de `infra/main.tf`, passando as 4 ARNs `local.*_function_arn` já existentes (items 4-7) e uma role de execução dedicada (`aws_iam_role.extraction_workflow_state_machine`). O nome do state machine resolve exatamente para `exptrk-dev-document-extraction` — o mesmo nome que `local.extraction_state_machine_arn` já esperava desde o item 2, verificado por `terraform test` (não confiado só à leitura do código).

- **IAM da role de execução do próprio state machine** (`infra/main.tf`, `data.aws_iam_policy_document.extraction_workflow_invoke_lambdas`, 3 statements): `lambda:InvokeFunction` escopado às 4 ARNs exatas (nunca wildcard); `logs:CreateLogDelivery`/`GetLogDelivery`/`UpdateLogDelivery`/`DeleteLogDelivery`/`ListLogDeliveries`/`PutResourcePolicy`/`DescribeResourcePolicies`/`DescribeLogGroups` em `"*"` (exigência documentada da própria AWS para `logging_configuration` de state machine — opera no subsistema de log delivery a nível de conta, não num log group específico); `xray:PutTraceSegments`/`PutTelemetryRecords`/`GetSamplingRules`/`GetSamplingTargets` em `"*"` (mesmas ações que `AWSXRayDaemonWriteAccess`, que o módulo `lambda-function` já anexa a toda função com tracing ativo). O lado inverso (cada handler autorizando `states.amazonaws.com` a invocá-lo, escopado à ARN determinística do state machine) já estava pronto desde os itens 4-7 — não precisou de nenhum ajuste.
- **CloudWatch Logs + X-Ray** (`infra/modules/extraction-workflow/main.tf`): `aws_cloudwatch_log_group.document_extraction` (`/aws/vendedlogs/states/exptrk-dev-document-extraction`, retenção 30 dias, mesmo padrão de `document-observability`/`import-observability`) + `logging_configuration` no nível `ERROR` (não `ALL`) com `include_execution_data = false` — decisão deliberada espelhando a disciplina de privacidade do próprio `EXTRACTION_TRANSIENT` (o input/output de uma execução pode carregar texto OCR/valores de campo extraídos; nunca devem cair num log group com retenção/acesso mais frouxos que o bucket do artefato). `tracing_configuration { enabled = true }` — todo Lambda do repo já roda com ADOT/X-Ray ativo (AGENTS.md §7, M5); o state machine que os orquestra agora participa do mesmo trace.
- **Disciplina de gate (D-035 §1.6)**: NADA nesta camada foi condicionado a `var.extraction_pipeline_enabled` — o state machine, sua role e as 4 permissões de invocação sempre existem (inspecionáveis/deployáveis). Raciocínio registrado no comentário do próprio `main.tf`: um segundo gate aqui seria redundante, porque o item 2 já gateia o ÚNICO ponto de entrada real (a regra EventBridge que liga o bucket limpo do M6 a `ExtractionStarterWorker`, que é quem chama `StartExecution`) — com esse gate em `false` (default), o state machine pode existir/ser inspecionado/até ser iniciado manualmente para uma execução de teste, mas nunca recebe tráfego real.
- **`terraform test`**: `infra/tests/stack.tftest.hcl` ganhou 2 `run` novos (nomes plan-time-known do state machine batendo com `local.extraction_state_machine_arn`, IAM da role com exatamente 3 statements nunca wildcard) — 13→15 passando. Módulo `infra/modules/extraction-workflow/tests/extraction_workflow.tftest.hcl` **criado do zero** (pendência explícita registrada pelo item 7) — 5 `run` via `mock_provider`+`apply` (substituição dos 4 placeholders ASL pelas ARNs reais, nunca deixando um placeholder para trás; `type = STANDARD`; role passada através sem modificação; tracing/logging configurados) — 5/5 passando.
- **`terraform plan` real contra `dev`** (perfil `claude-dev`, conta `975707451904`) — **a verificação crítica**: `-target=module.extraction_workflow -target=aws_iam_role.extraction_workflow_state_machine -target=aws_iam_role_policy.extraction_workflow_state_machine` → **27 a criar, 2 a mudar, 0 erros** (nenhum "invalid ARN"/"resource not found" — a definição do state machine, que embute as 4 ARNs Lambda reais via `replace()` encadeado do módulo, resolveu sem erro contra a API real da AWS, prova de que o item 3 finalmente funciona). Plano full-stack sem target: **31 a criar / 56 a mudar / 1 a destruir** — o único destroy é o MESMO drift pré-existente do item 4 (`aws_lambda_permission.textract_task_from_state_machine`, normalização de `function_name` com/sem qualificador `:live`), já documentado nas sessões dos itens 5/6/7, não introduzido aqui. Nenhuma issue de integração nova apareceu (os placeholders `"textract-task:live"` etc. substituíram corretamente — não foi necessário nenhum fix no `replace()` do módulo). **Nunca `terraform apply` local.**
- **Backend**: `typecheck`/`lint`/`validate-schemas`/`check-docs` limpos, 867/867 testes de backend passando (nenhuma regressão — sessão não tocou código de aplicação, só infra). `terraform fmt -check -recursive` limpo em toda a árvore `infra/`.
- Novos outputs em `infra/outputs.tf`: `extraction_state_machine_arn` (deve ser igual a `local.extraction_state_machine_arn`) e `extraction_state_machine_name` (plan-time-known, usado pelos testes para não precisar de `command = apply` contra o provider real). Novo output no módulo: `log_group_arn`, `state_machine_name`.
- Commits nesta sessão (branch `develop`, PR #60 `develop→main` ainda aberto — push deve atualizá-lo automaticamente): instanciação do módulo + IAM + logging/tracing + testes + docs.

**Item 2 — CONCLUÍDO nesta sessão (2026-08-26)**: `ExtractionStarterWorker` completo — domínio/aplicação/persistência/handler real, não só camada pura. `src/modules/extraction/{ports,application,persistence}/` (`DocumentReader`/`ExtractionRunStore`/`ExtractionExecutionStarter` — portas próprias, não reusa `DocumentStore` do módulo document; `startExtractionRun()` idempotente: cria `ExtractionRun` via `putIfAbsent`, mas chama `startExecution` do Step Functions SEMPRE, mesmo quando o registro já existia — gated só no registro criaria um run órfão se `startExecution` falhasse depois de `putIfAbsent` suceder, a dedup real é a idempotência nativa do `StartExecution` por nome de execução determinístico = `runId`), `src/runtime/aws/handlers/extraction-starter-handler.ts` (SQS, mesmo padrão S3→EventBridge→SQS do `upload-finalizer-handler`). **Achado real corrigido durante a implementação**: a key do bucket limpo (`advance-after-evidence.ts`) só tinha `clean/<tenantId>/<documentId>`, sem `itemId` — insuficiente para montar a PK de `Document` (`TENANT#t#ITEM#i`) a partir só do evento S3. Corrigido estendendo o formato para `clean/<tenantId>/<itemId>/<documentId>` (mesma forma item-anchored da key de quarentena, `parseCleanKey()` novo espelhando `parseQuarantineKey()`) — mudança na M6 (já em produção), mas segura: `cleanObject` é sempre um valor opaco armazenado na entidade, nunca reconstruído/reparsed em nenhum outro lugar do código. Infra real em `infra/main.tf`: fila+DLQ+Lambda+IAM sempre existem (deployáveis/inspecionáveis), mas a regra EventBridge que liga o bucket limpo à fila é o ÚNICO recurso condicionado a `var.extraction_pipeline_enabled` — com o gate `false` (default), nenhum evento real do fluxo M6 (que já roda continuamente em `dev`) chega ao worker. `local.extraction_state_machine_arn` é determinístico a partir do nome que o item 3 DEVE usar (`${local.name_prefix}-document-extraction`) — já correto quando a state machine real for criada, sem placeholder para trocar depois. 8 testes novos (748 totais no backend), `terraform test` (13 do stack) passando, `terraform plan` real contra `dev` confirmou 12 recursos a criar com o gate `false` (zero regra EventBridge) e mais 5 com o gate `true` (a regra + dependências) — comportamento condicional verificado, não só lido no código. **Ainda sem PR/merge** (mesma lógica do item 1: mergeável isoladamente, mas ainda aguardando decisão de "quando" — ver abaixo).
3. ASL — camada pura (o arquivo `.asl.json` e o módulo `extraction-workflow` uninstantiated) segue como estava, ver acima.
4. `TextractTaskHandler` — **CONCLUÍDO nesta sessão (2026-08-26), real de ponta a ponta** (código+infra, não só camada pura) — ver a seção dedicada acima ("Item 4 — CONCLUÍDO nesta sessão") para o estado exato, arquivos tocados, decisões tomadas (AppConfig direto via SDK, CMK nova dedicada, tópico SNS novo) e o que falta (item 3 instantiation + itens 5-7).
5. `PdfParserTaskHandler` — **CONCLUÍDO nesta sessão (2026-08-26), real de ponta a ponta** — ver a seção dedicada acima ("Item 5 — CONCLUÍDO nesta sessão") para o estado exato, arquivos tocados, decisões tomadas (reanexação de contexto ao payload de sucesso de `completeOcr`, correção do path `$.Payload.*` nas Choice states) e a decisão pendente registrada (sem heurística de metadado de arquivo no caminho degradado).
6. `BedrockExtractionTaskHandler` — **CONCLUÍDO nesta sessão (2026-08-26), real de ponta a ponta** — ver a seção dedicada acima ("Item 6 — CONCLUÍDO nesta sessão") para o estado exato, decisões tomadas (modelo/região placeholder configuráveis, correção de `ResultSelector`/`OutputPath` na ASL, reanexação do `artifact` ao output do item 5) e o corpus adversarial construído.
7. `ExtractionValidationTaskHandler` — **CONCLUÍDO nesta sessão (2026-08-26), real de ponta a ponta** — ver a seção dedicada acima ("Item 7 — CONCLUÍDO nesta sessão") para o estado exato, decisões tomadas (mapeamento COMPLETED/FAILED/DISCARDED do `ExtractionRunStatus` já commitado, invariante de deleção do artefato) e o que falta (item 8 ainda não consome `PENDING_CONFIRMATION`).
8. **Rotas HTTP de confirmação — CONCLUÍDO nesta sessão (2026-08-26), real de ponta a ponta**: ver seção dedicada "Item 8" logo abaixo.
9. Quota `AI_CALL` — **CONCLUÍDO nesta sessão (2026-08-26), verificado a fundo, nada faltando**: ver seção dedicada "Item 9" logo abaixo.

**Item 3 (instanciar o `aws_sfn_state_machine` real) — CONCLUÍDO nesta sessão (2026-08-26)**: ver "Item 3 — CONCLUÍDO nesta sessão" na seção M7 acima (topo do arquivo) para o detalhe completo — `infra/main.tf` wireando `module "extraction_workflow"` com as 4 ARNs reais + role de execução dedicada (`lambda:InvokeFunction` escopado + CloudWatch Logs delivery + X-Ray), `infra/modules/extraction-workflow/tests/extraction_workflow.tftest.hcl` novo (5 testes), `infra/tests/stack.tftest.hcl` +2 testes, `terraform plan` real contra `dev` limpo. Item 3 da seção "pendências explícitas" do design (job Textract "preso") fica como runbook a calibrar com volume real — não bloqueia implementação, só produção real fora de `dev`.

## Item 8 (rotas HTTP de confirmação/rejeição, §1.7) — CONCLUÍDO nesta sessão (2026-08-26), real de ponta a ponta

`POST /items/{itemId}/documents/{documentId}/extractions/{runId}/fields/{fieldName}/confirm`\|`reject` — o único trecho do M7 original que ainda faltava para o pipeline ficar code-complete em `dev`. Mesmo padrão idempotente+transacional de `ExpirationService.renewItem` (item-handlers.ts), adaptado para um caso de 4 entidades.

- **Application** `src/modules/extraction/application/confirm-reject-field.ts` (`confirmField`/`rejectField`) — idempotente via `IdempotencyStore` (mesmo `begin`/`complete`/`abort` de sempre, replay lê o `ExtractedField` já commitado em vez de guardar um `responseRef` estruturado). `confirm` é um OCC de 4 vias (`ExtractedField`/`ExtractionRun`/`Document`/`ExpirationItem`) — lê os quatro, valida as 4 versões (`ConflictError`/409 em qualquer uma), valida `field.state === "PENDING_CONFIRMATION"` e `isValidFieldValue()` (item 7's função, reaproveitada) contra o `confirmedValue` recebido, ambos `BusinessRuleError`/422 (categoria `BUSINESS_RULE` **nova** em `app-error.ts` — primeiro 422 do projeto). `reject` é OCC de 3 vias (nunca lê/toca `ExpirationItem` — nem o path o pede). 404 (`NotFoundError`) em qualquer uma das 4 entidades ausente.
- **Mapeamento campo→atributo do item**: `ITEM_ATTRIBUTE_BY_FIELD_NAME` (só `expirationDate` -> `dueDate` no schema v1) — quando o campo confirmado mapeia para um atributo conhecido de `ExpirationItem`, a transação faz um `Update` real (recalculando `gsi1Keys()` com o `dueDate` novo); quando não mapeia (nenhum campo do schema v1 cai nesse caso hoje, mas o design exige `expectedItemVersion` em TODO confirm, mesmo sem efeito colateral no item), a transação faz um `ConditionCheck`-only no item em vez de inventar um `Update` sem `set`.
- **Ports estendidos** (não recriados): `ExtractedFieldStore` (item 7) ganhou `get()`/`confirmField()`/`rejectField()` — `confirmField`/`rejectField` retornam `"VERSION_CONFLICT"` (nunca lançam) quando qualquer `ConditionCheck`/`Update` condicional falha dentro do `TransactWriteItems`, igual ao `commitRunOutcome` já existente trata `TransactionCanceledException` de forma uniforme. `ExtractionRunStore` (item 2) ganhou `get()` — um plain read eventualmente consistente, nunca usado pelos OCC writes já existentes. Port novo `ports/entity-reader.ts` (`EntityReader`, mesma forma exata de `DocumentReader` já existente) reaproveitado por `documents`/`items` na composition root — `DynamoDbDocumentStore`/`DynamoDbExpirationStore` já satisfazem a interface estruturalmente, nenhum adapter novo.
- **Adapter real** `DynamoDbExtractedFieldStore.confirmField`/`.rejectField` — `TransactWriteCommand` usando os builders de sempre (`buildVersionedUpdate`/`buildVersionConditionCheck` de `occ.ts`), nunca `UpdateItem`/`ConditionCheck` cru.
- **HTTP** `src/modules/extraction/http/extraction-handlers.ts` (`handleConfirmField`/`handleRejectField`) — mesma pipeline exata de `document-handlers.ts`/`item-handlers.ts` (`resolver.resolve` → `authorize()` internamente via a application function → `TenantQuotaService` `API_REQUEST` 100/60s → schema Ajv → chamada). Autorização: `extraction:confirm` (ação **já existia** na matriz desde uma sessão anterior — cobre os dois verbos HTTP, exatamente como o design pede). `STATUS_BY_CATEGORY` local ganhou `BUSINESS_RULE: 422` (as outras cópias desse mapa nos outros módulos não precisam, deixadas como estão).
- **Sem Lambda nova**: as duas rotas ficam sob o MESMO grupo `/items/{itemId}/documents*` e o MESMO Lambda `documents_handler` de sempre (que já tem `tenant_facing_read_write_policy_json` completo na tabela — zero IAM novo). `src/runtime/aws/handlers/documents-handler.ts` ganhou 2 `case` novos no dispatcher + `buildFieldConfirmationDeps()` (composition root novo em `src/runtime/aws/composition/extraction.ts`, reaproveitando o mesmo padrão de adapter `DynamoLike` que `ExpirationService` já usa para sua própria `IdempotencyStore`, ao invés de reinventar).
- **Terraform**: `infra/modules/api-gateway/main.tf`'s `documents_routes` ganhou `confirm_field`/`reject_field` — o `source_arn` do `aws_lambda_permission.documents` já é um wildcard (`/items/*/documents*`), cobre as rotas novas automaticamente. `terraform plan -target=module.api` real contra `dev` (perfil `claude-dev`, conta `975707451904`, `-var-file=env/dev.tfvars -var="aws_account_id=975707451904"`): **2 a criar** (exatamente as 2 rotas novas, confirmado por nome no plan) **16 a mudar** (mesmo ruído de republish de `source_code_hash` já documentado em toda sessão anterior deste milestone — o próprio `documents-handler` bundle mudou porque o código mudou, os outros 15 são o mesmo drift de sempre), **0 a destruir**.
- **BFF allowlist**: `src/modules/bff/domain/proxy-allowlist.ts` ganhou as 2 rotas — não repetido o gap histórico de `DocumentRequest`/BLOCKER-A.
- **Schemas** `schemas/api/{confirm,reject}-extracted-field-request.v1.json` — `confirm` exige as 4 `expected*Version` + `confirmedValue`, `additionalProperties: false` (nunca aceita atributo de item nem JSON Patch, por design). `reject` exige só `expectedDocumentVersion`/`expectedRunVersion`/`expectedFieldVersion` (sem `expectedItemVersion` — reject nunca toca o item), `correctionReason` opcional. 7 casos novos em `test/contract/schemas.test.ts` (válido/inválido dos dois, incluindo rejeitar `expectedItemVersion` no corpo de reject).
- **Testes**: `test/unit/extraction/confirm-reject-field.test.ts` (19 testes, fakes escritos à mão sobre uma tabela DynamoDB em memória com OCC real — `InMemoryTable.write()` só aplica se a versão bate) — feliz confirm (item atualizado + versões incrementadas), feliz reject (item intocado), idempotência de replay dos dois (sem re-executar a transação), 409 individual para cada uma das 4/3 versões esperadas, 422 de estado errado (confirm e reject) sem tocar o item, 422 de `confirmedValue` inválido, 404 para cada uma das 4 entidades ausente, negação de autorização sem membership. 2 fakes pré-existentes (`run-extraction-validation.test.ts`, `start-extraction-run.test.ts`) precisaram só de um `get()` stub para continuar implementando as interfaces estendidas.
- **Verificação real**: 25 testes novos (**892 totais no backend**, era 867 no início da sessão). `typecheck`/`lint`/`check-boundaries`/`validate-schemas`/`check-docs` limpos. `terraform fmt -check -recursive` limpo, `terraform validate` limpo, `terraform test` 15/15 passando, `terraform plan -target=module.api` real contra `dev` confirmado (2 criar/16 mudar/0 destruir, ver acima). **Nunca `terraform apply` local.**

## Item 9 (quota `AI_CALL`) — CONCLUÍDO nesta sessão (2026-08-26), verificado a fundo

Auditados TODOS os caminhos de falha de `startOcr()` (item 4) e `runBedrockExtraction()` (item 6) depois de `quota.consume({ quotaType: "AI_CALL", ... })`:

- `startOcr`: `StartDocumentTextDetection` falhando (a chamada paga nunca aconteceu) -> `quota.release()` chamado antes de propagar `TextractUnsupportedDocumentError` (linha já existente, confirmado). `TextractJobPersistenceFailedError` (a chamada paga JÁ aconteceu, só a persistência local do `TextractJob` falhou depois) -> **deliberadamente NÃO libera a quota** — investigado nesta sessão e confirmado correto, não uma lacuna: como a reserva é por-execução (`window: "${runId}|TEXTRACT"`, `limit: 1`), uma retentativa da ASL para o MESMO run sempre bate em `QuotaExceededError` contra a própria reserva anterior, que `startOcr` já trata genericamente como "já reservado, não é exaustão real" (linhas 86-90) — **independente de a reserva ter sido liberada ou não**. Liberar aqui não destravaria nada que já não estivesse destravado, e liberar incorretamente sinalizaria "nenhuma chamada paga aconteceu ainda" quando uma já aconteceu.
- `runBedrockExtraction`: mesmo padrão exato — falha da chamada Bedrock em si (após esgotar `callAttempts` locais) -> `quota.release()` chamado antes de propagar `BedrockExtractionFailedError` (linha já existente, confirmado). Não há nenhum caminho de falha PÓS-chamada-bem-sucedida neste handler (ao contrário do Textract, o resultado do Bedrock é só re-anexado ao payload de saída, nunca persistido localmente por este handler) — não há uma segunda categoria de falha a auditar aqui.

**Conclusão**: a cobertura de `AI_CALL` via `TenantQuotaService.consume()`/`.release()` nos itens 4/6 está completa e correta — nenhum código novo necessário, nenhuma lacuna real encontrada. Não existe (nem o design exige) uma rota HTTP de consulta de uso/limite de `AI_CALL` para o operador — fora de escopo do design aprovado, não registrado como pendência.

## M7 — estado final desta sessão: código-completo para `dev`

Com os itens 1-9 concluídos (1/2/4/5/6/7/8/9 de ponta a ponta real, item 3 instanciando a state machine real), **M7 está code-complete para testar em `dev`** — não falta nenhum item da lista original de 10 (o item 10, "Infra Terraform completa", já estava dobrado dentro dos itens 4-7/3, confirmado nesta sessão: não há nenhum módulo/recurso do pipeline de extração pendente de instanciação). O único gate real que falta antes de considerar M7 encerrado:

- ~~Uma verificação end-to-end real~~ — **FEITA em 2026-08-27**, ver a seção `## M7 — verificação end-to-end real em `dev` (2026-08-27)` logo abaixo. Encontrou **3 bugs reais bloqueantes** (2 corrigidos nesta sessão, 1 documentado como decisão pendente).
- Runbook de calibração para job Textract "preso" (mencionado no item 3) — não bloqueia, é operacional.

## M7 — verificação end-to-end real em `dev` (2026-08-27)

**O que foi exercitado, e por qual caminho.** Cadeia de eventos real, não `StartExecution` na mão: PDF real (1075 bytes, texto `Validade: 31/12/2027`, gerado com `pdf-lib`) enviado ao bucket real `exptrk-dev-documents-clean` sob a chave de produção `clean/<tenantId>/<itemId>/<documentId>` (SSE-KMS obrigatória pela bucket policy), e uma mensagem no formato EventBridge "Object Created" publicada na fila real `exptrk-dev-extraction-starter` → `exptrk-dev-extraction-starter-handler:live` → `startExtractionRun` real (leu o `Document` CLEAN, criou o `ExtractionRun` idempotente, chamou `StartExecution` com `name = runId`). O único elo originado à mão foi a mensagem SQS, porque a regra EventBridge que a produziria é o único recurso condicionado a `var.extraction_pipeline_enabled` (hoje `false`) e criá-la exigiria `terraform apply` — proibido pelo §3 do `AGENTS.md`. Nada além disso foi simulado: Lambdas, state machine, Textract, S3, DynamoDB, KMS e AppConfig foram todos os recursos reais de `dev`.

Escafalho mínimo escrito direto no DynamoDB real (`IdentityMapping`, `User` OWNER, `ExpirationItem`, 3 `Document` CLEAN) porque login via Cognito Hosted UI não é automatizável por CLI. **Nenhum resultado de extração foi falsificado** — todo `ExtractionRun`/`ExtractedField`/`TextractJob` desta seção foi produzido pelo pipeline real.

**As 3 execuções reais** (state machine `exptrk-dev-document-extraction`):

| Execução | Flags AppConfig servidas | Estados que rodaram | Resultado |
|---|---|---|---|
| `run_9a0adc8271f936cdfd93163a7bcfd21c` | v1 Terraform (`{"features":{OCR:false,…}}`) | RunTextract(falhou) → RunDeterministicParser → NeedsBedrock → CheckAiKillSwitch → ValidateSchema → CompareExtractors → PersistExtractedFields → CompleteRun | SUCCEEDED, caminho degradado (`ocrAvailable:false`), campo `PENDING_CONFIRMATION` sem candidato |
| `run_a22df0565a3c9f96e80e69e8138e97e7` | v2 temporária, envelope canônico com `OCR:true` | idênticos ao anterior | SUCCEEDED, **ainda degradado** — evidência do bug 1 abaixo |
| `run_c1aef1a7c3f1272b9f9ff78cc963ab98` | v3 temporária, envelope canônico **+ cópia top-level** dos 3 booleanos | RunTextract → RunDeterministicParser → NeedsBedrock → ValidateSchema → CompareExtractors → PersistExtractedFields → CompleteRun | SUCCEEDED, **caminho feliz completo com Textract real** |

Evidência do caminho feliz (`output` real da execução `run_c1aef…`): `ocrAvailable:true`, artefato OCR real em `s3://exptrk-dev-extraction-transient/ocr/run_c1aef…/42d064cf-….json`, `extractedFields[0] = {fieldName:"expirationDate", candidateValue:"2027-12-31", confidence:0.9, source:"DETERMINISTIC_PARSER", valid:true}`, `needsBedrock:false`, `agreement:"SINGLE_SOURCE"`, `runOutcome:"COMPLETED"`. Ou seja: **Textract real leu o PDF real e o parser determinístico extraiu a data correta**. `RunBedrock` NÃO foi exercitado (`needsBedrock:false` — o candidato determinístico já passou do limiar 0,75; `AI_EXTRACTION` foi mantido `false` de propósito). `CompleteRun` apagou o artefato transitório (verificado: `ocr/` ficou com 0 objetos).

**As 2 rotas HTTP novas, exercitadas de verdade** (bundle esbuild real de `documents-handler`, evento API Gateway HTTP API v2 forjado apenas para pular o login Cognito; resolver/matriz de autorização/quota/idempotência/`TransactWriteItems` todos reais contra `exptrk-dev-table`):

- `confirm` no campo `PENDING_CONFIRMATION` de `run_9a0adc…` → **200**, campo `PENDING_CONFIRMATION` → `CONFIRMED` (`version` 1→2, `confirmedValue:"2027-12-31"`).
- **`ExpirationItem.dueDate` antes: `2030-01-01` (version 1) → depois: `2027-12-31` (version 2)**, com `GSI1SK` re-chaveado para `DUE#2027-12-31#ITEM#itm_m7verify` na mesma transação. Este era o objetivo final do gate.
- Replay do mesmo `Idempotency-Key` → 200 com o mesmo campo e **`ExpirationItem.version` continuou 2** (não reaplicou).
- `reject` no campo de `run_a22df…` → **200**, `PENDING_CONFIRMATION` → `REJECTED` com `correctionReason` gravado, sem tocar no `ExpirationItem`.
- `confirm` no campo auto-`CONFIRMED` de `run_c1aef…` → **422 BUSINESS_RULE** (`"ExtractedField is not pending confirmation (state=CONFIRMED)"`) — ver bug 3.

### Bugs reais encontrados

1. **`AppConfigFeatureFlagsReader` lia os kill switches do lugar errado — pipeline permanentemente fail-closed em `dev`. CORRIGIDO nesta sessão.** `infra/modules/feature-flags/main.tf` publica (e `implementation-blueprint.md` §17.3 especifica) `{"features":{"AI_EXTRACTION":…,"OCR":…,"WHATSAPP":…}}`, mas o adapter lia `parsed.OCR` no nível raiz — logo toda flag resolvia `false` independentemente do valor implantado, e todo `START_OCR` morria em `OcrDisabledError`. Evidência isolada: a execução `run_a22df…` rodou com a versão AppConfig 2 (`OCR:true` dentro do envelope canônico) e **ainda assim** falhou com `OcrDisabledError`; a `run_c1aef…`, cuja única diferença era a cópia top-level dos mesmos booleanos, chamou Textract normalmente. Os testes unitários do adapter afirmavam a forma errada, e por isso nunca pegaram. Corrigido lendo o envelope `features` (com fallback tolerante para o nível raiz) + teste de regressão.
2. **As duas rotas de `confirm`/`reject` estavam 100% quebradas contra o DynamoDB real (dois defeitos independentes). CORRIGIDOS nesta sessão.**
   - **500 `Unknown schema $id`**: `schemas/api/confirm-extracted-field-request.v1.json` e `reject-extracted-field-request.v1.json` nunca foram adicionados à lista de imports estáticos de `defaultSchemaRegistry` (`src/shared/contracts/schema-validator.ts`), cuja própria doc-string manda "add both the file AND a static import line". Toda chamada às duas rotas retornava 500 antes de qualquer lógica de negócio.
   - **409 permanente**: `confirm-reject-field.ts` passava a **entidade `ExtractedField` inteira** como `fieldKey` para `confirmField`/`rejectField`; `buildVersionedUpdate` repassa isso como `Key` do `Update`, e o DynamoDB real rejeita com `ValidationError: The provided key element does not match the schema` dentro do `TransactWriteItems` — o que a store interpreta como `VERSION_CONFLICT` e o HTTP mapeia para 409. Capturado com `CancellationReasons` reais: `[{"Code":"ValidationError","Message":"The provided key element does not match the schema"},{"Code":"None"},{"Code":"None"},{"Code":"None"}]`. Os fakes em memória dos testes unitários ignoram atributos extras na chave, por isso a suíte passava. Corrigido passando `extractedFieldKey(...)` nas duas rotas. Só depois dessa correção o `confirm` real devolveu 200 e atualizou o `dueDate`.
3. **Campo auto-`CONFIRMED` pelo pipeline nunca chega ao `ExpirationItem` — GAP REAL, NÃO CORRIGIDO (decisão do Marcelo).** `decideFieldOutcome` auto-aceita (`state: "CONFIRMED"`) um candidato `SINGLE_SOURCE` acima do limiar de confiança — foi exatamente o que aconteceu com `run_c1aef…`, o caso de sucesso do pipeline. Mas o **único** código que escreve `ExpirationItem.dueDate` é a rota HTTP de `confirm`, que exige `state === "PENDING_CONFIRMATION"` e devolve 422 para um campo já `CONFIRMED` (verificado, ver acima). Consequência: no caminho de maior sucesso do pipeline, o `dueDate` do item **nunca** é atualizado e não existe rota que o atualize. Não corrigido de propósito: escolher entre "o pipeline passa a escrever o `dueDate` na transação de `PersistExtractedFields`" e "`decideFieldOutcome` nunca auto-confirma, sempre exige humano" é decisão de produto/design (Type 1, §4 do `AGENTS.md`), não conserto mecânico.

### Achado menor (não corrigido, sem impacto observado nesta verificação)

Os `ErrorEquals` do ASL usam os valores de `code` das `AppError` (`OcrDisabled`, `ExtractionCommitFailed`, …), mas o Step Functions casa contra o `errorType` do Lambda, que é o `name` da classe (`OcrDisabledError`, `ExtractionCommitFailedError`, …). Confirmado no histórico real: o `TaskFailed` de `RunTextract` trouxe `"error": "OcrDisabledError"` e o Catcher nomeado **não** casou — quem pegou foi o `States.ALL` seguinte, que tem o mesmo `Next`, então o comportamento observado ficou correto por acidente. O mesmo descasamento torna morto o `Retry` de `PersistExtractedFields`/`MarkPendingConfirmation` em `ExtractionCommitFailed`, e aí **há** perda de comportamento (uma falha transitória de commit não seria retentada como desenhado). Corrigir exige mexer no ASL e portanto um `terraform apply` via CD — deixado para uma sessão de infra.

### Estado do ambiente após a sessão

Flags AppConfig **revertidas**: versão hospedada 1 (a do Terraform) reimplantada (deployment 4), e as versões temporárias 2/3 deletadas — `list-hosted-configuration-versions` volta `[1]`, exatamente como antes. Nenhum `terraform apply`. `terraform plan` posterior contra `dev` não mostra **nenhum** recurso AppConfig/S3/DynamoDB no diff (só o ruído já conhecido de republicação de versão de Lambda, ampliado por um `npm run build:lambdas` local). Todo dado de teste removido: `scan` filtrando `m7verify` volta `Count: 0`, o prefixo S3 `clean/usr_m7verify20260827/` volta 0 objetos (todas as versões deletadas), `ocr/` no bucket transitório volta 0. Os históricos das 3 execuções do Step Functions ficam (artefato normal da AWS, não é dado de teste a limpar).

**As correções dos bugs 1 e 2 estão apenas em `develop`, ainda NÃO implantadas em `dev`** (o CD só aplica em push para `main`). A verificação do `confirm` real rodou contra o bundle esbuild já corrigido, executado localmente contra o DynamoDB real; o `documents-handler` implantado em `dev` continua com os dois defeitos até o próximo merge para `main`.

**Bloqueado só para produção real** (não bloqueia implementar/testar em `dev`, exatamente como o toggle foi desenhado): escolha/validação de modelo Bedrock + região, RIPD formal (`privacy-lgpd.md` §6, gatilho já registrado).

## Decisões pendentes do Marcelo

1. **M7 (extração/OCR)**: design já aprovado (D-035), zero decisão de produto pendente — só falta decidir *quando* começar, depois da infra de hospedagem ou em paralelo.
2. **User Validation**: **em suspenso a pedido do Marcelo** (2026-08-25) — não retomar sem sinal explícito dele.
3. **Estado real de `git`/deploy no início da próxima sessão não deve ser presumido** — confirmar `git status`/`git log`/branch atual antes de qualquer trabalho novo, em vez de reconstruir a partir deste resumo.

## Pendências residuais não bloqueantes (registradas, não bloqueiam nada)

- ~~`npm audit --omit=dev` no job `guardrails` segue com achado pré-existente não batendo exatamente com `docs/engineering/exceptions.md` EX-001~~ — **reavaliado em 2026-08-25**: EX-001 estava desatualizado em números (9 vulnerabilidades reais, não 5) e prazo (expirado desde M4, nunca reavaliado); corrigido com uma segunda cadeia transitiva real e não documentada (`testcontainers`→`dockerode`→`tar-fs`/`undici`, usada por `test:dynamodb` em CI real). `npm audit --omit=dev` continua em 0 nas duas raízes (`/` e `frontend/`). Novo prazo: 2026-09-24. Upgrade do Vitest ainda bloqueado pelo bug upstream `npm/cli#4828` (status não reverificado nesta sessão).
- Observabilidade por função (alarmes CloudWatch) para `ImportParseWorker`/`ImportCommitWorker`: deixada como residual documentado em D-050 (a DLQ-age alarm genérica já cobre "está falhando").
- ~~Camada 3 de M6 (teste real de reconciliação de upload slot expirado) nunca exercitada contra AWS real~~ — **executada em 2026-08-25, achou um bug real de produção**: `reserveUpload` nunca escrevia `GSI6PK`/`GSI6SK` no `UploadSlot` criado — confirmado empiricamente contra a conta `dev` real (perfil `claude-dev`, mesma conta do `AWS_ROLE_ARN_DEV`): um slot expirado fabricado sem esses campos ficou invisível ao worker real (`resultCount: 0`); o MESMO item, com os campos adicionados manualmente, foi corretamente descoberto e reconciliado (`slotsExpired: 1`, documento associado passou a `TIMEOUT`). Confirmou também que `GSI6PK`/`GSI6SK` nunca eram removidos após a transição (ponteiro órfão) e que nenhum caminho jamais marcava o slot como `CONSUMED` num upload bem-sucedido (a mesma lacuna estrutural, do lado oposto). **Corrigido**: `reserveUpload` agora escreve os campos GSI6 (`document-store.ts`'s `buildUploadSlotGsi6Sk`, mesma convenção `<timestamp>#TENANT#<t>#<ENTIDADE>#<id>` do módulo `reminder`); `reconciliation.ts` remove os campos ao marcar `EXPIRED`; `advance-after-evidence.ts` marca o slot `CONSUMED` + remove os campos quando o Document atinge um resultado terminal (`CLEAN` ou `REJECTED`/`UNSUPPORTED`). 5 testes novos, 716 testes de backend, nenhuma regressão. Itens de teste fabricados na tabela `dev` real foram limpos ao final (confirmado `Count: 0`). **Deployado** — commit `2fab80f`, já mergeado em `main` (PR #55) e presente em `develop`; nota anterior dizendo "ainda não deployado" estava desatualizada (verificado nesta sessão via `git merge-base --is-ancestor`).
- **Achado real, severidade baixa, não corrigido** (2026-08-25, mesma auditoria que achou o bug do `upload-slot` acima): `reminder-occurrence.ts`/`document-chasing.ts` documentam que `GSI3PK`/`GSI3SK` devem ser removidos em `TRIGGERED`/`CANCELLED` ("mesmo invariante" entre os dois tipos de occurrence), mas nem `reminder-dispatch/dispatch.ts` nem `document-chasing-dispatch/dispatch.ts` fazem isso — só removem `GSI6PK`/`GSI6SK`. Investigado antes de decidir: `GSI3` é particionada por bucket de minuto (`DUE#<minuto>#<shard>`) e só é lida pelo producer dentro de uma janela de lookback de 5 minutos, sempre com re-validação defensiva do status real da occurrence antes de agir — um ponteiro órfão nunca é revisitado fora dessa janela, e mesmo se fosse, é ignorado com segurança. Diferente do bug do `upload-slot` (falha total — nada funcionava), este é um descompasso comentário-vs-código de baixa severidade (linhas extras nunca lidas de novo) num caminho já revisado 9,2/10 pelo protocolo Claude↔Codex e ativo em produção real — não corrigido nesta sessão deliberadamente, para não mexer num trecho crítico já extensivamente revisado sem uma rodada de revisão dedicada. Candidato a um follow-up de baixa prioridade, nunca urgente.
- `expiration-tracker-bff-frontend-quality-standard.md` (raiz) contém uma rubrica candidata mais ampla (BFF/performance/testes de frontend de produção real, §13-30) que, se adotada como padrão oficial, deveria passar pela mesma convergência independente Claude↔Codex que os 9 eixos de `docs/engineering/joint-review-criteria.md` já usaram — não decidido ainda. (`docs/frontend/interface-quality-standard.md`, o padrão de 12 eixos específico do planejamento de interface, já existe como arquivo formal desde `interface-validation-readiness.md`.)

## Referências (não reler por padrão — só sob demanda)

- `docs/architecture/session-log.md` — linha do tempo compacta, uma entrada por sessão.
- `docs/architecture/decisions-log.md` — todas as decisões (D-000 a D-054) com nota Claude/Codex e status.
- `docs/frontend/` — os 8 documentos de planejamento de interface aprovados (mais `interface-quality-standard.md`); `prototype/` — o protótipo interativo executável (ver `prototype/README.md`).
- `docs/architecture/reviews/bff-full-vs-session-design/` — debate completo do Full BFF (design).
- `docs/frontend/frontend-production-foundation.md` — implementação real do Full BFF + fundação de frontend de produção, achados do protocolo Claude↔Codex sobre o código, Final Status.
