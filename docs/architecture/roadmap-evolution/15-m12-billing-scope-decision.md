---
status: approved
owner: Marcelo
authority: decisão de arquitetura via protocolo Claude↔Codex completo (AGENTS.md §4) — decide se/o que implementar de M12 (Commercial Monetization/Billing) agora, nível 5-6 da escala de risco (arquitetura/modelo de dados/segurança de integração externa)
---

# D-052 — M12 (Commercial Monetization/Billing): bloqueado por decisão de produto, zero código novo agora

Com M9+M10+M11 implementados e deployados (`main`/`dev`, D-044 a D-051), o candidato natural
seguinte no roadmap (`10-phase3-scoring-and-roadmap.md` §M12) é Commercial Monetization/Billing:
agregados `Plan`/`Subscription`/`BillingWebhookInbox`, expansão de `Entitlement`/`UsageQuota`,
integração com provider de pagamento externo. O desenho de alto nível já havia sido fechado no
cluster 3 (`05-domain-model-organization-billing.md`, D-038, 9,2/9,2), mas esse documento é
declaradamente de alto nível — não fecha campo-a-campo nem resolve o fato de que a escolha do
próprio provider de pagamento é, por decisão explícita do prompt estratégico original, "fora
deste roadmap" (decisão de produto do Marcelo, não técnica).

Protocolo Claude↔Codex completo via MCP, sandbox read-only, 2 rodadas reais (convergência forte
já na rodada 1, independente).

**Nota final: Claude 9,3 / Codex 9,4 — gate ≥9,0 atingido por ambos os lados, sem arredondar.**

## Processo

- **Rodada 1**: pergunta aberta a ambos os lados, sem posição prévia revelada: dado que
  `Subscription`/`BillingWebhookInbox`/qualquer verificador de webhook não têm nenhum uso real
  possível até o vendor ser escolhido (não há checkout, não há evento para receber), faz sentido
  implementar esses agregados agora como código morto à espera do provider? Claude e Codex
  convergiram de forma independente: **não** — o risco de errar a abstração (assinatura, replay,
  shape de evento, status lifecycle variam por vendor) supera qualquer valor de "adiantar
  trabalho". Codex propôs uma alternativa mais estreita: expandir `TenantEntitlement` (já existe,
  `src/modules/subject/domain/entitlement.ts:21-31`, `planId`/`activeTrackedSubjectsLimit`/
  `activeTrackedSubjectsCount`) com uma operação administrativa manual (`setTenantEntitlementPlan`)
  para servir um caso de early-adopter negociado diretamente, sem depender de nenhum provider.
- **Rodada 2**: Claude checou `src/modules/identity/domain/authorization.ts` inteiro antes de
  aceitar essa fatia e achou um problema real: o projeto não tem NENHUM conceito de "platform
  staff" cross-tenant na matriz de autorização — toda `Action` hoje é escopada dentro do próprio
  tenant (`OWNER|MEMBER|VIEWER`, `tenantId=userId`, MVP single-owner, `authorization.ts:63-68`).
  Uma action administrativa para alterar `planId`/limite exigiria ou (a) inventar um role
  cross-tenant novo — superfície de arquitetura/segurança real para um caso hoje inexistente
  (zero clientes pagantes reais confirmados), ou (b) uma action `ADMIN_ROLES` tenant-scoped que
  deixaria o próprio `OWNER` do tenant aumentar seu limite sozinho — exatamente a classe de
  bypass de quota self-service que o projeto trata como vetor de abuso a evitar (mesmo cuidado já
  registrado com `GuestRateLimiter`/anti-enumeração em D-045). Codex concordou integralmente e
  reduziu sua própria proposta: nem a "fatia manual" vale virar código agora.

## Decisão final

**M12 inteiro fica bloqueado — zero código novo nesta sessão.** Bloqueadores reais, explícitos,
que só Marcelo pode resolver (decisão de produto/fornecedor, fora da autoridade do protocolo):
fornecedor de pagamento (Stripe ou similar); modelo de preço e `priceId`; duração de trial/grace;
política de downgrade ao expirar/cancelar assinatura; conjunto mínimo de eventos de webhook
aceitos; estratégia de verificação de assinatura/replay (depende do vendor escolhido).

Caminho operacional aceito para o caso hipotético "early adopter negocia limite maior antes de
existir billing automatizado real": operação manual pontual — `UpdateItem` direto no DynamoDB
usando os builders OCC-safe já existentes (`buildVersionedUpdate`, `src/shared/dynamodb/occ.ts:45`,
que já impõe versão e `tenantId`), executada por Marcelo quando/se o caso realmente aparecer.
Deliberadamente **não** vira script dedicado nem endpoint administrativo hoje — não há demanda
real ainda, e construir qualquer um dos dois agora seria exatamente a abstração prematura que o
projeto evita (`AGENTS.md`, `docs/engineering/principles.md`). Resíduo aceito, registrado por
Codex na nota final: falta formalizar, quando o caso aparecer, qual trilha de auditoria/aprovação
humana acompanha essa escrita manual fora do app — não bloqueia hoje, só quando o caso for real.

## Próxima ação

Nenhuma implementação de M12 autorizada até Marcelo decidir o fornecedor de pagamento (ou
confirmar demanda real de early-adopter que justifique a operação manual pontual acima). Próxima
ação de engenharia real desta sessão: débito técnico não-bloqueante já registrado (alarmes
CloudWatch por função dos workers de import, `NEXT_SESSION_PROMPT.md`) e/ou pendência de Camada 3
de M6 (teste real de reconciliação de upload slot expirado) — ver `NEXT_SESSION_PROMPT.md` para o
estado vigente.
