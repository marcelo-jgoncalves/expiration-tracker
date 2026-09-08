# Full audit round2 — Eixo Segurança da Informação e AppSec — Resumo

Protocolo Claude↔Codex (`AGENTS.md` §4), nota cega, 3 rodadas. Segunda rodada formal completa deste eixo (a primeira: `docs/engineering/reviews/full-audit-round1-seguranca-summary.md`, fechou sub-9.0 em 2026-08-2x). Entre as duas rodadas o sistema cresceu substancialmente: domínio documental inteiro (`document-archive`, guest access, requirements, recorrência, dossier export), activity log, canal WhatsApp operacional (webhook + Secrets Manager), migração de infra CDK→Terraform (ADR-0009), e o design (ainda não implementado) de `ExternalShareLink` (D-225).

## Rounds (nota cega)

**Round1**:
- Claude: **7.40/10** (`full-audit-round2-seguranca-claude.md`)
- Codex: **8.168/10** (`full-audit-round2-seguranca-codex-output-round1.txt`)

Divergência de ~0.77, concentrada no critério 3 (Autenticação/Sessão) — Claude havia mantido uma nota baixa citando um comentário de código desatualizado ("módulo de sessão BFF... não existe"); Codex verificou `infra/modules/cognito/main.tf:68-92` (refresh token rotation real, grace period, `ALLOW_REFRESH_TOKEN_AUTH` removido) e encontrou um achado real que Claude não tinha: **SEC-R2-02**, bug de claim-before-send em `src/workers/guest-credential-delivery/deliver.ts:66-81`.

**Round2** (reconciliação, nota cega mantida até ambos registrarem):
- Claude: **7.95/10** (`full-audit-round2-seguranca-claude-round2.md`) — aceitou SEC-R2-02 após verificação direta do código, corrigiu critério 3 para 9.0.
- Codex: **8.068/10** (`full-audit-round2-seguranca-codex-output-round2.txt`) — revisou o próprio critério 3 de 9.2→9.0 (conservador, falta prova adversarial completa do ciclo de reuse-detection), manteve severidade Baixa para SEC-R2-05 mas reconheceu impacto real no critério 7.

**Round3** (tréplica final, `full-audit-round2-seguranca-claude-round3.md`): convergência forte, diferença caiu para **0.12 pontos**. Parado aqui deliberadamente — mesmo critério do Round1: retorno decrescente sobre os mesmos critérios não corrigíveis nesta sessão (2, 4, 6, 7, 9, 10), todos já com achado nomeado e evidência precisa, sem novidade a extrair de uma 4ª rodada.

## Nota final do eixo (consenso, Rodada 3)

**Claude: 7.95/10 — Codex: 8.068/10 — nota ponderada de consenso ≈ 8.02/10. Ambos abaixo de 9.0, sem arredondar.**

Eixo **não aprovado nesta rodada** (mesmo veredito honesto do Round1), mas com melhoria real e mensurável: Round1 fechou em 7.895/7.315 (média ~7.6), Round2 fecha em 7.95/8.068 (média ~8.02) — ~0.4 ponto de melhoria líquida mesmo com a superfície do sistema tendo mais que dobrado.

## O que corrigiu desde Round1 (verificado por ambos os lados, não só alegado)

1. **Autenticação/Sessão (critério 3)**: deixou de ser aspiração documentada em comentário — Cognito com `refresh_token_rotation` real, grace period de 30s, `ALLOW_REFRESH_TOKEN_AUTH` removido (`infra/modules/cognito/main.tf:68-92`), tabela BFF dedicada com KMS, TTL absoluto/idle, revogação por dispositivo (D-136/D-140/D-141).
2. **Logging/Detecção (critério 7)**: alarmes ganharam destino de notificação real em IaC (`infra/modules/alert-topic/main.tf`, tópico SNS + subscription; `alarm_actions` conectado em todos os módulos de observability) — a lacuna "alarme sem alvo" nomeada no Round1 foi fechada em código, ainda que a confirmação operacional da subscription (SEC-R2-05) não esteja comprovada.
3. **Webhook externo (nova superfície, D-231)**: `verifyMetaSignature()` (HMAC-SHA256 sobre raw body, `timingSafeEqual`, `whatsapp-webhook-processor.ts:33-37`) verificado ANTES de qualquer parse/persistência (`whatsapp-webhook-handler.ts:91-99`); segredo em Secrets Manager com policy escopada ao ARN exato, nunca wildcard.
4. **Guest access (D-146) e injeção de fórmula (D-217)**: disciplina replicada corretamente em toda superfície nova — pepper isolado por módulo, anti-enumeração, rate limit multidimensional, mitigação de fórmula aplicada tanto a XLSX quanto retroativamente ao CSV existente.

## O que permanece abaixo de 9.0 e por quê (mesmo formato do Round1: escopo maior, não impedimento externo, exceto onde indicado)

- **Critério 2 (IAM Least-Privilege, 14%, ~6.4)** — **idêntico ao Round1, agora com blast radius maior.** `infra/modules/dynamo-table/main.tf:266-296` concede `Scan`+leitura/escrita completas sobre a tabela base inteira + GSI1/GSI2/GSI4/GSI5 a qualquer Lambda tenant-facing, sem `dynamodb:LeadingKeys`. A migração CDK→Terraform (ADR-0009) preservou o padrão sem resolvê-lo. Hoje esse grant é compartilhado por muito mais handlers (47 Lambdas) que no Round1. **PENDENTE — decisão de arquitetura/segurança explícita do dono do projeto**, não uma correção de sessão.
- **Critério 4 (Pipeline Assíncrono, 14%, ~7.6)** — dois achados: **SEC-R2-02 (NOVO, Médio)** — `deliverGuestCredential()` (`src/workers/guest-credential-delivery/deliver.ts:66-81`) reivindica o marker de entrega (`markerStore.claim()`) ANTES de chamar `emailProvider.send()`; se o envio falhar transitoriamente, o retry encontra o marker já reivindicado e retorna `ALREADY_DELIVERED` sem reenviar — perda permanente e silenciosa de um link de credencial de guest. Precisa de uma máquina de estados com lease (`CLAIMED`→`SENT`, expirável), mesmo padrão que `NotificationAttempt`/`dossier-export` já usam em outros workers deste repositório — não é invenção de padrão novo, mas é mudança de comportamento (nível 3-4), fora do escopo de correção mecânica de uma auditoria. **SEC-R2-03 (herdado do Round1, Médio)** — `dispatch-outbox-relay-processor.ts:25-27` e `reminder-reconciliation-handler.ts:31-88` continuam sem schema Ajv do envelope interno, só cast TypeScript e checagem de `entityType`.
- **Critério 6 (~8.0)** — **SEC-R2-04 (novo, Baixo)**: `document-archive-guest-rate-limiter.ts:42-44` persiste o IP de origem em texto claro na chave (`DOCARCHIVEGUESTIP#${ip}#RATE`) — vem de `sourceIp` do API Gateway (não de header controlável pelo cliente, então não é bypassável), mas ainda é dado pessoal em texto claro, alcançável pela mesma policy IAM ampla do achado do critério 2. Hash/HMAC com pepper reduziria a exposição.
- **Critério 7 (~7.85)** — **SEC-R2-05**: `infra/modules/alert-topic/main.tf` implementa o tópico SNS + subscription de e-mail corretamente, mas a subscription permanece `PendingConfirmation` — sem confirmação/teste de entrega real comprovado nesta sessão. Não exige decisão de design, mas exige ação do operador (confirmar e-mail + disparar alarme controlado) fora do escopo desta auditoria.
- **Critério 9 (~7.7)** — cobertura de `TenantQuotaService` nas rotas de negócio adicionadas desde Round1 (`/document-archive/*`, `/activity`, `/document-archive/series*`, dossier export) não foi verificada linha a linha por nenhum dos dois lados nesta rodada — nem confirmada corrigida nem confirmada regredida, fica como verificação pendente para a próxima rodada.
- **Critério 10 (~8.0)** — processo real e recorrente de pesquisa externa (E-014) antes de toda superfície nova é o ponto mais forte deste critério; mas segue sem prova adversarial real contra AWS (nenhum `AccessDenied` real testado, nenhum redrive de DLQ real) — mesma limitação de Camada 3 do Round1, não reavaliada nesta sessão (sem acesso a ambiente para testar).

**Confirmação positiva relevante**: `ExternalShareLink` (D-225) foi verificado por AMBOS os lados, independentemente, como **design-only** — nenhum código/schema/infra em `src/`, `schemas/` ou `infra/` o implementa. Nenhuma falsa atribuição de controle implementado foi encontrada nesta rodada em nenhum módulo.

## Achados de segurança reais desta rodada (destacados, com severidade)

1. **[Médio, NOVO]** SEC-R2-02 — claim-before-send causa perda permanente de link de credencial de guest numa falha transitória de e-mail (disponibilidade de um fluxo de acesso, não bypass de autorização).
2. **[Alto, HERDADO sem correção]** SEC-R2-01 — IAM tenant-facing com privilégio de tabela inteira, blast radius maior que no Round1.
3. **[Médio, HERDADO sem correção]** SEC-R2-03 — 2 envelopes assíncronos internos sem schema runtime.
4. **[Baixo, NOVO]** SEC-R2-04 — IP bruto em texto claro na chave do rate limiter guest.
5. **[Baixo/operacional, NOVO]** SEC-R2-05 — alarmes com destino em IaC, mas subscription não confirmada.
6. **[Mecânico, corrigido nesta sessão]** Drift de `docs/engineering/exceptions.md` — contagem de `npm audit` desatualizada (9→11 vulnerabilidades) e cadeia de PRODUÇÃO `exceljs→uuid@8.3.2` (moderate) nunca registrada — corrigida com EX-003 nova + recontagem de EX-001.

152+ referências de evidência verificadas por leitura direta de código/infra em ambos os lados (não apenas alegação); `npm run check-boundaries` limpo (630 módulos, 2400 dependências, zero violação); `npm audit --omit=dev` (raiz) 2 moderate (agora triadas em EX-003), 0 high/critical em produção.
