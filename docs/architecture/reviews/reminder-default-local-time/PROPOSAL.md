---
status: implementado (2026-09-20) — backend+frontend, testes verdes; ver decisions-log.md
owner: Marcelo (decisão final)
authority: proposta, não normativa
---

## Decisão de Marcelo (2026-09-20)

1. Nível do default: **por tenant** (`Organization`).
2. Escopo temporal: **só triggers novos** — nenhum backfill/migração de trigger existente.
3. Onde ajustar: **nova seção em `Settings.tsx`**, nível organização.

# Proposta — horário padrão de envio de lembretes (item 3, sessão 2026-09-20)

Pedido de Marcelo: horário padrão sorteado aleatoriamente na entrada do cliente no sistema
(onboarding), restrito a horas cheias/meias BRT entre 10:00 e 17:00 (10:00, 10:30, ..., 17:00 —
nunca minuto quebrado), ajustável depois pelo próprio cliente.

## Estado real hoje (nenhum destes mecanismos mudou nesta proposta)

- `ReminderPolicy.localTime` (`src/modules/reminder/domain/reminder-policy.ts:16`) já é um campo
  `HH:mm` por `ReminderTrigger`, totalmente editável — não precisa de schema novo.
- `DEFAULT_LOCAL_TIME = "09:00"` (`frontend/src/routes/items/ItemReminderPolicy.tsx:33`) é o valor
  que a UI propõe ao criar um trigger novo — hardcoded, igual para todo tenant, nunca ciente do
  fuso ou de aleatoriedade.
- `Organization.timezone` (`src/modules/organization/domain/organization.ts:24`) já existe e é
  setado no onboarding (`POST /bff/organizations`) — gancho natural para o sorteio, já que o
  intervalo 10:00-17:00 é BRT (hora local do tenant, não UTC fixo).
- `QuietHours` (`reminder-policy.ts:27`) é conceito DIFERENTE: janela de supressão que empurra um
  horário já definido para fora dela — não confundir com o horário PREFERIDO em si.
- O pipeline de disparo (`reminder-producer`, `infra/modules/reminder-schedule/main.tf`) roda
  `rate(1 minute)` 24/7 sem geofencing de horário comercial — o que estiver due dispara na hora, o
  pipeline não precisa mudar, só o valor de `localTime` que os triggers recebem.

## Esboço técnico (mecanismo, não decisão de produto)

Sortear um valor do conjunto `{10:00, 10:30, 11:00, ..., 17:00}` (15 valores) no momento da
criação da organização (`CreateOrganizationService`, mesmo lugar que já seta `timezone`), gravar
como um novo campo (candidato: `Organization.defaultReminderLocalTime`), e o frontend passa a usar
esse valor em vez de `DEFAULT_LOCAL_TIME` fixo ao propor um trigger novo. Baixo risco técnico —
campo novo em uma entidade existente, sem chave/GSI/contrato externo (nível 3-4 de
`change-risk-scale.md`, não 5-6).

## Os 3 pontos de decisão de produto (não decido sozinho — ver `AGENTS.md` §1)

1. **Nível do default**: por tenant (`Organization`, um valor para toda a organização) ou por
   usuário individual dentro do tenant (cada membro vê/ajusta o seu)?
2. **Escopo temporal**: aplica só a triggers NOVOS criados a partir de agora, ou também
   retroativamente aos triggers já existentes com `"09:00"` hardcoded?
3. **Onde o cliente ajusta depois**: uma seção nova em `frontend/src/routes/Settings.tsx` (nível
   organização, ao lado de Armazenamento/Sair da organização) ou em preferências pessoais do
   usuário (se/quando essa superfície existir)?

Este documento não avança para desenho final até essas três respostas.

## Implementação real (2026-09-20)

- `Organization.defaultReminderLocalTime?: string` (`src/modules/organization/domain/organization.ts`)
  + `REMINDER_LOCAL_TIME_CANDIDATES`/`pickDefaultReminderLocalTime`/`isValidLocalTime`.
- `CreateOrganizationService` sorteia o valor no onboarding (picker injetável, testável
  deterministicamente).
- `UpdateOrganizationSettingsService`/`PATCH /organizations/settings` aceitam
  `defaultReminderLocalTime` (validado, OWNER-only, mesmo padrão OCC dos outros campos).
- `GET /bff/organizations` (`listUsableOrganizations`) expõe o valor atual.
- Frontend: `Settings.tsx` ganhou um `SelectField` novo (nível organização); `ItemReminderPolicy.tsx`
  usa o valor da organização ativa em vez do `"09:00"` fixo ao propor um trigger novo, caindo para
  `"09:00"` só quando a organização não tem o campo (criada antes desta feature).
- Testes novos: `test/unit/organization/organization-domain.test.ts`,
  `create-organization.test.ts`, `update-organization-settings.test.ts`,
  `frontend/test/routes/Settings.test.tsx` (achado real do próprio teste: `<select>` caía
  silenciosamente para a primeira opção quando o valor corrente não estava na lista de 15
  candidatos — corrigido incluindo `"09:00"` como opção seleccionável em
  `frontend/src/lib/reminderDefaults.ts`).
