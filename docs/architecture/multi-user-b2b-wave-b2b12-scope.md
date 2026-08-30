# Multi-User B2B — Wave B2B-12 (Cutover de dev), escopo final

**Status: `APPROVED`** via protocolo Claude↔Codex (`AGENTS.md` §4, nível 5 de `change-risk-scale.md`),
3 rodadas, nota cega cada rodada: Rodada 1 Claude 8,3/Codex 7,4 (7 achados reais); Rodada 2 Claude
9,0/Codex 8,3 (3 achados remanescentes reais); Rodada 3 Claude 9,2/Codex 9,1 (fechamento, ambos ≥9,0,
sem arredondar). Registrado como `docs/architecture/decisions-log.md` D-110. Evidência completa das 3
rodadas: `docs/architecture/reviews/multi-user-b2b-wave-b2b12-scoping/`.

Escopo per `roadmap-evolution/17` §62-65 (regra de migração) e §117 (texto integral): "Se dados
sintéticos: snapshot, reset/reseed. Se necessário preservar: one-off migration. Nenhum compatibility
fallback permanente."

## Achados reais (verificados por leitura de código E por inventário real `aws --profile claude-dev`,
não hipotéticos)

1. **Inventário real de `dev` confirma dado 100% sintético/descartável, zero `Organization`/
   `Membership`.** `exptrk-dev-table` (47 itens): `TenantQuota` (23), `TextractJob` (21),
   `IdentityMapping` (1), `NotificationPreferences` (1), `User`/`UserProfile` (1) — só 3 valores
   distintos de `tenantId`, nenhum tenant B2B real (2 são drills de carga do W2, 1 é smoke-test
   pré-cutover). `exptrk-dev-bff-session`: 0 itens. Cognito (`us-east-1_NZlvr5IIn`): 0 usuários
   reais. S3: só `extraction-transient` tem conteúdo (21 objetos, artefato de OCR efêmero). SQS: das
   24 filas reais (12 + DLQs), 22 vazias — `exptrk-dev-upload-finalizer-dlq` tem 3 mensagens reais,
   `exptrk-dev-malware-result-dlq` tem 1 not-visible.
2. **Prova concreta de que `dev` nunca foi resetado desde antes do cutover B2B-5**: a linha
   `IdentityMapping` real ainda carrega o atributo `tenantId` (removido do TYPE desde B2B-5/D-095,
   mas DynamoDB não impõe schema — o atributo antigo sobra, inerte).
3. **Um remanescente real de código produtivo que ainda "entende" `tenantId=userId`**:
   `OnboardingStateResolver.resolve()` (`onboarding-state.ts:50-53`) classifica como
   `LEGACY_TENANT_ONLY` quando encontra uma `TenantLifecycleRecord(userId)` legada — estado terminal
   sem conversão para `RequestContext` usável, wired via `resolve-request-context.ts:101-104`
   (bloqueia login) e `bff-auth-service.ts:563-568` (`GET /bff/session`). Inalcançável contra o dado
   real de `dev` hoje (zero `TenantLifecycleRecord`), mas ainda existe no código.
4. **Nenhum código produtivo grava registro novo no formato legado** — confirmado: fallback
   `assigneeUserId ?? tenantId` removido inteiramente por B2B-11; `tenantId` removido do TYPE de
   `IdentityMapping` por B2B-5; `bootstrapUser()` grava só `GlobalUser`+`IdentityMapping`.
5. **Nenhuma ferramenta de reset/migração existe ainda** — `scripts/backfill-reminder-policies.ts` é
   o único precedente de script one-off deste projeto (Scan paginado, `--table` nomeado, dry-run
   opt-in, checkpoint/resume via `LastEvaluatedKey`, invocação manual).

## Declaração E-014: NÃO

A decisão central (reset vs. migração de dado descartável de `dev` antes de um cutover de schema) não
é um padrão que sistemas externos resolvem de forma convergente do jeito que RBAC/invite/sessão
multi-tenant são — é julgamento de proporcionalidade interno (`principles.md` #1) sobre o dado real
deste projeto. A política em si ("preferir reset/reseed quando o dado é sintético") já foi decidida e
aprovada via protocolo completo dentro do próprio `roadmap-evolution/17` §62-63 (Claude 9,2/Codex
9,2) — esta wave aplica essa política já aprovada contra uma classificação real e agora verificada,
não a redecide a partir de pesquisa de mercado. O Codex confirmou esta declaração como defensável na
Rodada 1, com a ressalva (incorporada ao escopo) de que isso não dispensa rigor de engenharia básico
(snapshot, allowlist de ambiente, retry, inventário completo, verificação final).

## Rodadas de correção

**Rodada 1 → 2** (7 achados reais do Codex, nenhum contestado): faltava snapshot/export antes do
delete destrutivo; `BatchWriteItem` subespecificado (limite de 25, retry de `UnprocessedItems`,
checkpoint só após lote confirmado) + correção factual (`backfill-reminder-policies.ts` não tem
dry-run default, é opt-in); `--table` nomeado sozinho não protege contra erro de operador nesta conta
AWS compartilhada com outros projetos; Cognito ficou fora do inventário original; tratamento de
`exptrk-dev-bff-session` como "0 itens, sem ação" era fraco demais (deveria ser Scan+delete
incondicional); filas/DLQs não inventariadas (achado confirmado com dado real: 2 filas com mensagens
reais); remoção de `LEGACY_TENANT_ONLY` subestimava o contrato frontend (`frontend/src/api/session.ts`
declara o mesmo union type).

**Rodada 2 → 3** (3 achados reais do Codex, nenhum contestado): snapshot bruto em
`docs/architecture/reviews/` arriscava commitar PII/segredo real (`csrfSecret`/`encryptedRefreshToken`/
`accessToken` de `Session`, `emailNormalized`/`identitySubject` de `GlobalUser`/`UserProfile`) — corrigido
para `.local-artifacts/dev-reset/` (`.gitignore`ado, nunca commitado), só um manifest redigido
(contagem + `entityType`s + hash SHA-256 por item, nunca valor sensível) entra no repositório; a
proposta citava reutilizar uma função de backoff em `occ.ts` que não existe — corrigido, backoff local
ao próprio script (`retryWithBackoff()`), confirmado que nenhum lugar do projeto tem um helper
reaproveitável (`dispatch-outbox-relay/relay.ts` documenta "nenhum backoff próprio" como decisão
deliberada daquele worker); purge de filas sem quiescência explícita contra schedules/consumers reais
ativos — decisão proporcional de não construir automação de pausar/retomar (desproporcional para
operação manual one-off contra dado sintético), substituída por verificação final fail-loud (segunda
leitura completa após a fase de delete; qualquer contagem não-zero é erro explícito, nunca sucesso
silencioso).

## Escopo final aprovado

### 1. `scripts/reset-dev-data.ts` — reset/reseed de `dev`, não migração one-shot

Duas fases sequenciais, nunca combinadas:

- **Fase A (sempre)** — inventário completo e read-only: Scan paginado de `exptrk-dev-table` e
  `exptrk-dev-bff-session`; `list-objects-v2` de `exptrk-dev-extraction-transient`;
  `cognito-idp list-users` do user pool (nome resolvido via output do Terraform); `get-queue-attributes`
  das 24 filas reais (12 + DLQs). Grava snapshot bruto completo em
  `.local-artifacts/dev-reset/<ISO timestamp>/` (novo, `.gitignore`ado — primeira entrada desse tipo
  no arquivo) e um manifest redigido (contagens, `entityType`s distintos, hash SHA-256 por item
  serializado, nunca valor de campo sensível) em
  `docs/architecture/reviews/multi-user-b2b-wave-b2b12-scoping/`.
- **Fase B (só com `--confirm`, e só se a fase A já tiver gravado o snapshot com sucesso na mesma
  invocação — fail-closed)** — delete real: lotes de 25 itens por `BatchWriteItem` via
  `retryWithBackoff()` local (backoff exponencial + jitter, 5 tentativas, retentando
  `UnprocessedItems` até vazio), checkpoint via `LastEvaluatedKey` só avança após o lote inteiro
  confirmado vazio; `PurgeQueue` nativo nas 24 filas; delete de usuários Cognito só com flag adicional
  `--include-cognito` (nunca efeito colateral silencioso do reset de DynamoDB); `aws s3 rm --recursive`
  do bucket `extraction-transient`. Termina com verificação final (segundo Scan completo + segunda
  leitura de queue attributes) — qualquer contagem não-zero é erro explícito, nunca sucesso parcial
  silencioso.
- **Allowlist de ambiente**: recusa qualquer `--table`/`--session-table` fora de 2 strings hardcoded
  (`exptrk-dev-table`, `exptrk-dev-bff-session`); confirma `sts:GetCallerIdentity` = conta
  `975707451904` antes de prosseguir (esta conta hospeda outros projetos não relacionados —
  `marcelo-goncalves-blog-dev-*`, `terraform-lock-stocks-ranking`, `financial-intelligence-tfstate-lock`).

### 2. Remoção de `LEGACY_TENANT_ONLY`

`OnboardingState`/`OnboardingStateResolver.resolve()` (`onboarding-state.ts`) — remove o union member e
o passo 4 do procedimento sequencial (colapsa direto no passo 5/`NO_TENANT_NO_MEMBERSHIP`), comentário
desatualizado (linha 16-17, "the real state of every user today") removido; `frontend/src/api/session.ts`
(mesmo union type); `test/unit/organization/onboarding-state.test.ts` (caso de teste do estado
removido). Confirmado seguro por leitura: os 2 call sites reais (`resolve-request-context.ts:101`,
`bff-auth-service.ts:563-568`) comparam só contra `"HAS_USABLE_MEMBERSHIP"`, nunca switch exaustivo —
remover um valor "ruim" do union não quebra nenhuma branch existente.

## Gate de execução — separado da aprovação de design

Este documento fecha o **design/escopo** via protocolo Claude↔Codex, sem esperar confirmação prévia do
Marcelo (`AGENTS.md` §1/§3) — implementação (escrever o script, testá-lo contra fakes em memória,
rodar `--dry-run` real contra `dev` via `aws --profile claude-dev`, que é só leitura) pode prosseguir
imediatamente. **Executar de verdade** qualquer comando destrutivo contra a conta AWS real
(`--confirm`, `--include-cognito` real, `aws s3 rm --recursive` real) **para e pede confirmação
explícita do Marcelo antes de rodar** — exceção registrada no início desta sessão, não dispensada por
este fechamento de design.

## Decomposição (per `definition-of-done.md`)

| Subitem | Camada | Risco |
|---|---|---|
| B2B-12.1 | `scripts/reset-dev-data.ts` (fase A + fase B + allowlist + `retryWithBackoff()` local) + `.gitignore` (`.local-artifacts/`) | 5 |
| B2B-12.2 | Remoção de `LEGACY_TENANT_ONLY` (backend + frontend + teste) | 5 |
| B2B-12.3 | Testes — G-V3 desde a escrita (mutação nomeada verificada); suíte completa backend (`npm test`) + frontend (`vitest`+`test:e2e`) | 2-3 |
| B2B-12.4 | Execução real gated — `--dry-run` real contra `dev` (leitura, sem confirmação prévia necessária); `--confirm`/`--include-cognito`/`s3 rm` reais **aguardam sinal explícito do Marcelo**, registrado como pendente, não bloqueia esta wave nem as seguintes | — |

## Fora de escopo

Migração one-shot de dado tenant-scoped (§65) — não necessária, nada de valor a preservar. Fix do
achado lateral de `tenant-purge-scan.ts` ainda filtrar por `tenantId` enquanto `Session` não tem mais
esse campo — pertence ao pipeline de purga W3-07, já rastreado separadamente. Limpeza do padrão
literal `tenantId=userId` em ~10 fixtures de teste (cosmético, não produtivo). Automação de
pausar/retomar EventBridge Scheduler durante o reset (desproporcional — verificação final fail-loud é
a resposta proporcional).
