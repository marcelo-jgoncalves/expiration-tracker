# Full-audit round3 — eixo Segurança — escopo + achados verificados (Claude, pré-rodada)

Contexto: Marcelo pediu (2026-09-25) uma auditoria de segurança "em todos os aspectos possíveis",
pesquisando critérios externos e subdividindo a aplicação em blocos, com o protocolo Claude↔Codex
"enquanto for possível". Antes de tratar isso como trabalho greenfield, esta sessão inventariou o
que já existe: **E-018 (`docs/engineering/reviews/full-audit-round2-seguranca-summary.md`)** já é a
segunda rodada formal completa do eixo Segurança (baseline round1), protocolo de nota cega 3 rodadas,
convergência **Claude 7,95/Codex 8,068 ≈ 8,02/10** (2026-09-12), critérios calibrados em
`docs/engineering/joint-review-criteria.md` a partir de OWASP ASVS 5.0 + Top 10:2025 + SAMM +
least-privilege IAM AWS (pesquisa original de 2026-08-19, `security-axis-criteria-round1-*`).
Refazer os critérios do zero seria duplicar esse trabalho — em vez disso, esta rodada 3:

1. Confirmou que os critérios de 2026-08-19 continuam alinhados ao ASVS 5.0 vigente (pesquisa
   nova, 2026-09-25: ASVS 5.0.0 estável desde maio/2025, 17 capítulos/~345 requisitos — V1
   Encoding/Sanitization, V2 Validation/Business Logic, V3 Web Frontend, V4 API/Web Service, V5
   File Handling, V6 Authentication, V7 Session Management, V8 Authorization, V9 Self-Contained
   Tokens, V10 OAuth/OIDC, V11 Cryptography, V12 Secure Communication, V13 Configuration, V14 Data
   Protection, V15 Secure Coding/Architecture, V16 Security Logging/Error Handling, V17 WebRTC).
   Os 10 critérios já registrados mapeiam corretamente a maioria disso; nenhuma mudança de peso ou
   critério novo foi necessária.
2. Verificou o status real dos 5 achados nomeados do round2 (SEC-R2-01..05) — 3 dos 5 já foram
   corrigidos por sessões posteriores sem que o documento do round2 fosse atualizado (drift, mesmo
   padrão do achado de retenção LGPD desta sessão):
   - **SEC-R2-02** (claim-before-send em guest credential delivery) — **CORRIGIDO** (D-233).
   - **SEC-R2-03** (2 envelopes assíncronos sem schema Ajv) — **CORRIGIDO** (D-279).
   - **SEC-R2-04** (IP bruto do guest rate limiter em texto claro) — **CORRIGIDO** (D-276).
   - **SEC-R2-01** (IAM tenant-facing com `Scan`+leitura/escrita ampla sobre a tabela base,
     47→hoje mais Lambdas) — **PARCIALMENTE corrigido** (D-234 removeu `Scan`; Query/GetItem/Update
     amplos continuam, residual **documentado e aceito** via protocolo 9,2/10 como limitação
     estrutural de Lambda HTTP genérica — `LeadingKeys` estático é impossível para uma Lambda que
     atende qualquer tenant por requisição, só workers de namespace fixo (GSI3/6/8) conseguem isso).
     D-237-240 acrescentaram depois uma camada de defesa em profundidade em tempo de compilação
     (`AuthorizedTenantId`, tipo fantasma que força todo key-builder de 4 módulos a provar que o
     tenant veio de `RequestContext` autorizado, não de string solta) — mitiga construção de chave
     errada, não abrange nem substitui uma correção de IAM em runtime. **Ainda PENDENTE — decisão
     de arquitetura/segurança do dono do projeto**: aceitar formalmente o risco residual (o nível
     ao qual D-234 já levou o problema é provavelmente o teto prático sem redesenhar o acesso a
     dados) ou investir num redesenho maior (ex.: Lambda por tenant, ou uma camada de autorização
     de dados centralizada tipo OPA/Cedar). **Não é decisão que esta sessão deva tomar sozinha.**
   - **SEC-R2-05** (assinatura SNS do tópico de alarme não confirmada) — **provavelmente ainda
     PENDENTE**, requer ação humana (confirmar e-mail) fora do alcance desta sessão — **dependência
     registrada para Marcelo**, não código.
3. Verificou por leitura direta (não apenas alegação) 2 pontos que o round2 tinha deixado como
   "não verificado": **ambos fecham sem achado novo**:
   - Critério 9 (cobertura de `TenantQuotaService` nas rotas novas de `document-archive`/`activity`
     desde round1): o helper compartilhado `resolve()` em `document-archive-handlers.ts:203-212`
     já embute `consumeApiRequestQuota()` para TODO handler que o chama — os poucos handlers que
     chamam a função diretamente (as 5 rotas de `RequirementTemplate`) usam um caminho de resolução
     de contexto diferente, não um gap. Confirmado por leitura completa do arquivo (55 handlers).
   - `ExternalShareLink` (D-225 design, D-241 slice 1, **D-273 slice 2/3 — implementado e
     deployado em `dev` desde 2026-09-12**, ou seja, DEPOIS do corte do round2, que só confirmou a
     versão design-only): revisado agora por leitura direta de
     `external-share-link-service.ts`/`external-share-handlers.ts` — rate limit dimensional
     (selectorHash + IP) na rota anônima, pepper de auditoria de IP SEPARADO do pepper do token
     (achado da própria D-273, já corrigido antes desta sessão), comparação dummy-safe do secret,
     revalidação de status/expiry/tenant-ativo/frescor de arquivo no momento da resolução (nunca
     confia em estado lido na emissão), headers `Cache-Control: no-store`+`Referrer-Policy:
     no-referrer` na rota anônima, IAM mínima (`s3:GetObject`/`GetObjectVersion`+`kms:Decrypt` só
     no bucket CLEAN). **Nenhum achado novo nesta leitura.**
4. Buscou por classes de vulnerabilidade genéricas no frontend redesenhado (items 31-33,
   2026-09-25): `grep -rn "dangerouslySetInnerHTML|innerHTML" frontend/src` — **zero ocorrências**.
   CSP real (`frontend/index.html` meta tag + `aws_cloudfront_response_headers_policy.spa`/
   `bff_edge_floor` em `infra/modules/spa-hosting/main.tf`, produto do protocolo de 6 rodadas do
   ADR-0011) já cobre HSTS/nosniff/referrer-policy/frame-options DENY/CSP — nenhum achado novo.

## Blocos da rodada 3 (subdivisão da aplicação, não do zero — cobertura incremental sobre o que
o round2 já avaliou)

Critério de corte: **superfície criada ou reescrita DEPOIS de 2026-09-12** (data de fechamento do
round2) nunca passou pela lente de segurança dedicada. Ordem de prioridade por raio de exposição:

1. **Reminder Producer / Control Plane dedicado** (D-299 a D-304, tabela/stream/relay/filas SQS
   NOVAS e dedicadas, mensagens de sistema com sentinela `tenantId: "SYSTEM"`) — maior superfície
   nova, maior complexidade de isolamento (mensagens tenantless coexistindo com o pipeline
   tenant-scoped). **Ainda não revisado sob a lente de segurança — candidato à Rodada 1 do
   protocolo real.**
2. **CSV Bulk Import para `Item`** (D-330, aprovado via protocolo mas focado em correção de
   dedupe/idempotência, não em segurança adversarial de upload/parsing em massa).
3. **Login/Signup/Reset de senha via UI própria** (D-329) — superfície de autenticação nova
   (antes só Cognito Hosted UI), maior raio de exposição por natureza (qualquer bug aqui é
   pré-autenticação). Achado já registrado e não bloqueante: falta rate-limiting dedicado por
   conta/IP (nomeado no próprio D-329, "obrigatório antes de usuário real, junto com E-019").
4. **WhatsApp phone confirmation** (item 26 do backlog, D-328 implementado mas
   `PENDING_PROTOCOL_REVIEW`) — **BLOQUEADO nesta sessão**: existe trabalho não commitado de outra
   sessão em paralelo tocando exatamente esses arquivos (`src/modules/{bff,identity,notification}`,
   `schemas/api/whatsapp-*`) — não immiscuir sem coordenar primeiro (AGENTS.md, risco de corrida de
   git). Registrado como dependência, não pulado.
5. **Notification Entitlements + endpoint de urgência** (D-332) — já teve revisão adversarial
   própria (não é greenfield), mas focada em correção funcional, não em security-adversarial
   dedicada (IDOR/rate-limit/vazamento entre tenants no endpoint agregado).

Blocos 1-3 são o escopo desta rodada 3 (o que cabe no orçamento desta sessão). Blocos 4-5 ficam
registrados como pendência explícita para a próxima sessão de segurança, não esquecimento.
