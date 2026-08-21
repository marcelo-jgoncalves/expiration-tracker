# M4 — Decisões de produto/engenharia resolvidas antes da rodada 2 (2026-08-20)

## 1. Consentimento default (produto/compliance) — decisão de Marcelo

**Opt-in por default**: e-mail de lembrete de vencimento é tratado como transacional/essencial ao produto (não marketing) — enviado por default até o usuário desativar explicitamente. `NotificationPreferences.consentSource = "ONBOARDING"` quando criado automaticamente no onboarding do usuário (M1), não deixado para ser criado só quando o usuário abrir configurações — caso contrário nenhum usuário novo receberia lembrete algum, o que quebraria o propósito do produto. Nenhuma implicação de custo (não adiciona recurso AWS).

## 2. Destinatário do e-mail no MVP — protocolo Claude↔Codex (sem custo envolvido)

Pergunta: `recipientUserId = item.assigneeUserId ?? tenantId` (proposta original do Codex) é suficiente para M4?

- **Posição cega de Claude**: aceitar sem ajuste — MVP é single-user por tenant (`tenantId=userId`), regra isolada atrás de porta (`NotificationRecipientResolver`), `assigneeUserId` já existe e é populado em código real (`expiration-item.ts:27`, `expiration-service.ts:94`).
- **Posição cega de Codex**: aceitar a *precedência*, mas **não a fórmula como suficiente**. `assigneeUserId` é uma string mutável sem validação — sua mera presença não prova que o usuário existe, está ativo, ou **pertence ao mesmo tenant**. Sem checagem de posse tenant-scoped, um `assigneeUserId` corrompido ou apontando para usuário de outro tenant permitiria vazamento cross-tenant de conteúdo de notificação (mesma classe de risco que a suíte cross-tenant de M1 existe para prevenir).
- **Convergência (sem necessidade de tréplica — Claude aceita a correção como estritamente superior, achado real de segurança que a posição de Claude não cobriu)**:

```text
candidateUserId = item.assigneeUserId ?? tenantId
resolver = NotificationRecipientResolver.resolve({ tenantId, candidateUserId })
```

  1. Resolver exige perfil ativo **e pertencimento ao mesmo tenant** (mesma disciplina de `authorization.ts`).
  2. Se `assigneeUserId` explícito for inválido/cross-tenant, **não cai silenciosamente para o dono** — cancela o canal/intent com razão determinística nova (`RECIPIENT_NOT_FOUND` / `RECIPIENT_NOT_ELIGIBLE`), auditável.
  3. Entrada vazia (`""`) é rejeitada antes do fallback (evita `"" ?? tenantId` degenerar silenciosamente).

Esta regra entra no design final de rodada 2 substituindo a versão simplificada original.

## 3. Política de complaint (SES) — decisão de Marcelo

**Suprimir e-mail automaticamente e permanentemente** quando SES reporta `COMPLAINT` para um destinatário — padrão de mercado (deliverability/reputação de envio) e reduz risco de compliance. Implementado como já desenhado na proposta convergente (§11.4 do `codex-proposal-round1.md`): complaint gera supressão local durável antes de qualquer envio futuro, sem exigir revisão manual para o bloqueio inicial (reativação, se algum dia necessária, é ação manual separada, fora do escopo de M4). Nenhuma implicação de custo (supressão é um campo local em `NotificationPreferences`/`NotificationEntitlements`, não um serviço externo).

## Nenhuma das 3 envolve custo de infraestrutura novo — não escalada para decisão de custo do usuário além do que já foi decidido acima diretamente por ele.
