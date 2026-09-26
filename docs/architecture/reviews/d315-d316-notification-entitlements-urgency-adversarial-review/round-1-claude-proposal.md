# D-315/D-316 — Revisão adversarial Claude↔Codex (Rodada 1)

## Escopo

Duas decisões relacionadas (item 20 da fila de protocolo), ambas implementadas sem o protocolo
formal (suspenso, pedido explícito de Marcelo em 2026-09-21), ambas classificadas como nível 3-4
no `decisions-log.md` (não nível 5-6, mas registradas `PENDING_PROTOCOL_REVIEW` e colocadas na
fila mesmo assim):

- **D-315**: `NotificationEntitlements` nunca provisionado para nenhum tenant — seedado agora
  atomicamente na criação da `Organization` (`CreateOrganizationService.buildCreateEntries()`, 5º
  entry da mesma `TransactWriteItems`). `email.enabled: true` sem `monthlyLimit`, `whatsapp.enabled:
  false` sempre (independente do plano, por causa do E-019 jurídico).
- **D-316**: endpoint agregado de contagem por urgência (`DashboardService.getSummary()`) ganha 3
  campos aditivos (`itemsOverdueCount`/`itemsExpiringSoonCount`/`activeItemsCount`), reaproveitando
  dado já buscado (`activeItems`), sem novo endpoint/leitura/GSI. Substitui números placeholder
  hardcoded em `Overview.tsx`.

Arquivos-chave lidos para esta rodada: `src/modules/notification/domain/notification-entitlements.ts`,
`src/modules/organization/application/create-organization.ts`,
`src/modules/notification/application/{notification-router.ts,notification-router-workflow.ts}`,
`src/modules/dashboard/application/dashboard-service.ts`,
`test/unit/organization/create-organization.test.ts`, `decisions-log.md` D-315/D-316.

## Achados

### 1. (Média) `monthlyLimit` é um campo morto no tipo, sem nenhum enforcement em lugar nenhum

`NotificationEntitlements.email.monthlyLimit?: number` existe no tipo desde antes de D-315
(M4 design), mas `grep` confirma que NENHUM código lê esse campo — nem o router, nem o worker de
entrega, nem nenhum outro lugar. D-315 documentou isso explicitamente como decisão consciente ("o
campo já existe no tipo mas nunca é lido/enforced em lugar nenhum — nenhum teto inventado aqui"),
mas o campo continua ali, opcional, sem nenhum comentário no PRÓPRIO tipo (`notification-entitlements.ts`)
apontando isso — só o comentário de `defaultNotificationEntitlements()` menciona. Um engenheiro
futuro lendo só a interface pode assumir que setar `monthlyLimit` já teria efeito. Achado de
documentação, não de comportamento (nenhum tenant real é afetado hoje).

**Proposta**: mover o comentário "declarado mas não enforced" para ao lado do próprio campo
`monthlyLimit` na interface, não só na função de default.

### 2. (Baixa) Gap de backfill nomeado em D-315 — verificar se ainda é preciso e infinito, não só "aceitável hoje"

D-315 registra: tenants `dev`/sintéticos criados ANTES desta mudança continuam sem o registro, sem
backfill, "aceitável porque não há usuário real e `dev` é resetável via `scripts/reset-dev-data.ts`".
Confirmado por leitura de `reset-dev-data.ts`: o script deliberadamente não cria
`Organization`/`Membership` (zero real Organization/Membership, por design) — então ele não é o
mecanismo que resolveria o gap sozinho; qualquer tenant `dev` que já existia antes de D-315 e cujo
dado NÃO seja recriado via um fluxo real de `CreateOrganizationService` (ex.: signup end-to-end)
continua permanentemente em `RETRY` infinito para notificações, sem qualquer sinal de alarme
visível a não ser os logs do router. Isso é consistente com a decisão registrada, mas o
`decisions-log.md` não documenta COMO confirmar que um tenant específico já tem o registro (nenhum
comando/script de diagnóstico). Achado operacional, não de código.

**Proposta**: nenhuma mudança de código — só registrar no D-315 (ou aqui) um comando de
diagnóstico rápido (`aws dynamodb get-item` na chave `notificationEntitlementsKey(tenantId)`) para
quando alguém precisar depurar um tenant preso em RETRY.

### 3. (Baixa) `DashboardSummary.approximate` é um único booleano compartilhado entre 5 sub-contagens heterogêneas

O flag `approximate` vira `true` se QUALQUER uma das 5 buscas paginadas (`notSatisfied`, `missing`,
`pending`, `satisfied`, `activeItems`) bateu o teto de 5 páginas/125 itens. Isso é correto e
documentado ("nunca silenciosamente subestima"), mas tem uma consequência não nomeada: se
`notSatisfied` (que não afeta `itemsOverdueCount`) bater o teto, os 3 campos NOVOS de D-316
(`itemsOverdueCount`/`itemsExpiringSoonCount`/`activeItemsCount`, que dependem só de `activeItems`)
ficam marcados como `approximate: true` mesmo que `activeItems` tenha sido lido por completo — um
falso positivo de imprecisão especificamente para os 3 cards da Visão Geral que D-316 existe para
alimentar. Não é ao contrário (nunca esconde imprecisão real), então é conservador, mas pode gerar
um aviso de "contagem aproximada" na tela sem necessidade quando o tenant tem muitos Requirements
mas poucos Items.

**Proposta**: nenhuma mudança agora — registrar como gap de precisão aceitável (fail-safe na
direção certa), candidato a um `approximate` por-sub-contagem se algum dia incomodar de verdade.
Não vale a complexidade para o estágio atual (nenhum tenant real, `AGENTS.md` §1).

### 4. (Verificação, não achado) Mapeamento `NotificationEntitlements` → `RouterEntitlementState` está correto

Verifiquei `notification-router-workflow.ts:105-108`: `entitlements.email.enabled` →
`emailEnabled`, `entitlements.whatsapp.enabled` → `whatsappEnabled`, ambos com fallback `undefined`
quando o registro não existe (fail-closed do router, preservado). Nenhuma regressão de D-315 aqui.

### 5. (Verificação, não achado) Teste de mutação já existe para o 5º entry da transação

`test/unit/organization/create-organization.test.ts` já tem um teste dedicado (linha 57) com
comentário explícito de mutação: "remover o 5º entry faria este registro ficar `undefined`".
Cobertura adequada para a atomicidade do seed.

## Pesquisa externa (E-014)

Declarado **NÃO** — nenhuma das duas decisões corresponde a um padrão externo (AWS/DynamoDB/etc)
já resolvido/documentado; são decisões de política de produto interna (o que o plano free cobre) e
composição de dado já lido (agregação local).

## Nota cega (Claude), Rodada 1

Ver `round-1-claude-selfgrade.md` (arquivo separado, não lido pelo Codex).
