# WhatsApp Operacional (Roadmap P0.3) — Rodada 1 (proposta Claude)

Escopo: item 3 de `docs/project/roadmap-competitivo-2026-09-01.md` ("WhatsApp operacional").
**Marcelo decidiu o fornecedor nesta sessão (2026-09-04): Meta Cloud API direto, não BSP**
(Twilio/360dialog) — resolve o bloqueio de produto que impedia este design de começar; a
decisão de fornecedor em si NÃO passa pelo protocolo (reservada a ele, `AGENTS.md` §1), mas
tudo que decorre dela (modelo de dados, mecanismo de entrega, credencial, custo, contrato de
erro) sim. Nível 6 de `change-risk-scale.md` ("novo domínio de risco — novo terceiro com
acesso a PII", primeiro secret de vendor externo não-AWS do repo) — protocolo `AGENTS.md` §4
completo + ADR formal quando fechar.

## Pesquisa externa considerada

`SIM` (fontes abaixo, todas consultadas 2026-09-04). Diferente de decisões anteriores (RBAC,
convite, RequirementTemplate) onde a pesquisa compara MÚLTIPLOS produtos convergentes, aqui a
"fonte de mercado" é primariamente a própria documentação oficial da Meta — porque a Cloud API
é uma plataforma proprietária de terceiro com regras não-negociáveis (formato de webhook,
categorias de template, janela de 24h, tiers de limite), não um padrão que cada vendor
implementa à sua maneira. Isso ainda conta como pesquisa externa exigida por
`research-protocol.md` (documentação oficial/normas de um sistema externo estabelecido é
citada explicitamente como fonte válida, ao lado de RFCs). Representatividade: fonte primária
(`developers.facebook.com`, a documentação normativa do próprio provedor) cruzada com 3 fontes
práticas independentes para checar consistência/atualidade 2026 — reduz o risco de uma
alegação desatualizada sem depender só da síntese de terceiros.

- Meta for Developers — "Messaging Limits" (https://developers.facebook.com/docs/whatsapp/messaging-limits/,
  fonte primária, consultada 2026-09-04): 4 tiers (250/2.000/10.000/100.000/Unlimited),
  medidos em números de telefone ÚNICOS alcançados por mensagens business-initiated (fora da
  janela de 24h) numa janela móvel de 24h; mensagens de resposta DENTRO da janela de serviço
  não contam para o limite; progressão além de 2.000 é automática por qualidade+volume, sem
  ação manual.
- Meta for Developers — Webhooks getting-started
  (https://developers.facebook.com/docs/graph-api/webhooks/getting-started/, fonte primária,
  consultada 2026-09-04): assinatura `X-Hub-Signature-256` (HMAC-SHA256 com o App Secret, sobre
  o corpo bruto) em todo POST de notificação; handshake de subscrição via GET com
  `hub.mode`/`hub.challenge`/`hub.verify_token` no setup inicial.
- Meta for Developers — "Get opt-in for WhatsApp"
  (https://developers.facebook.com/documentation/business-messaging/whatsapp/getting-opt-in,
  fonte primária, consultada 2026-09-04): opt-in obrigatório antes de enviar qualquer mensagem
  business-initiated; o MÉTODO de opt-in é flexível (não precisa ser específico para WhatsApp,
  pode ser um opt-in geral de comunicação), desde que cumpra a lei local aplicável e nomeie a
  empresa.
- Blueticks — "WhatsApp Business API Pricing in 2026: Conversation Categories, Costs, and What
  Changed" (https://blueticks.co/blog/whatsapp-business-api-pricing-2026, consultada
  2026-09-04, cruzada com a alegação equivalente em 2 outras fontes de prática de mercado
  durante a busca): mudança real de precificação a partir de 1º de outubro de 2026 — respostas
  livres dentro da janela de 24h, hoje grátis, passam a ser cobradas; categorias de template
  (Marketing/Utility/Authentication) continuam sendo a unidade de cobrança fora da janela.
- `docs/architecture/cost-model.md` (interno, já `APPROVED`, D-024): já identificava WhatsApp
  como ~90% do custo total projetado no Stage 5 (~US$40k/mês, faixa plausível
  US$16k–80k/mês), sob a premissa então aberta de BSP (`UNK-003`). **A decisão de Marcelo desta
  sessão resolve `UNK-003` para "direto" — o markup de BSP sai da equação, mas a categoria de
  cobrança da Meta (Marketing/Utility/Authentication/Service, ver acima) permanece a variável
  dominante**; o cost-model precisa de uma emenda pontual quando este design fechar (fora do
  escopo desta rodada, registrado como pendência).

## Achados de escopo real (leitura direta do código, não presumidos)

- `NotificationChannel`/`NotificationChannelKind` (`reminder/domain/notification-intent.ts`,
  `reminder/domain/reminder-policy.ts`) **já incluem `"WHATSAPP"`** como variante — o type
  system foi desenhado esperando este canal desde M4, nunca implementado.
- `notification-router.ts:84`: `SUPPORTED_CHANNELS = ["EMAIL"]` com comentário explícito
  `// WhatsApp is a later submilestone (kill switch AppConfig WHATSAPP)` — o ponto de extensão
  já está marcado no código.
- `NotificationEntitlements.whatsapp: { enabled: boolean }` (`notification-entitlements.ts`)
  já existe no schema da entidade mas é **campo morto** — nenhum call site o lê hoje.
- `FeatureFlagsReader`/`AppConfigFeatureFlagsReader` já expõem `WHATSAPP: boolean` (mesmo
  parsing fail-closed `=== true` de `AI_EXTRACTION`/`OCR`), mas **sem consumidor** — o mesmo
  padrão de "flag existe, ninguém checa" que D-193 slice 8 corrigiu para o pipeline de OCR
  (`isDocumentArchivePromotionEnabled()`, gate de ordem-por-construção) é o precedente direto
  a espelhar aqui.
- `NotificationAttempt.channel: "EMAIL"` e `.provider: "SES"` (`notification-attempt.ts`) são
  **literais fixos, não a união `NotificationChannel`** — precisam alargar para acomodar um
  segundo canal/provider sem quebrar nenhum registro `EMAIL`/`SES` já persistido (nenhuma
  migração de dado, `AGENTS.md` §1 — só o TYPE alarga, o valor gravado em linhas existentes
  não muda).
- `EmailProviderAdapter`/`EmailSendFailureKind` (`notification/ports/email-provider.ts`) e
  `decideSendAction`/`nextStatusAfterSendAttempt` (`notification/application/email-delivery.ts`)
  já formalizam exatamente o problema que a Cloud API também tem (sem idempotency key
  client-controlled, confirmação só após aceite, falha CONCLUSIVE vs. AMBIGUOUS, lease
  `SUBMITTING`/`UNKNOWN`) — ADR-0008 ("envelope comum + payload específico por canal") já
  antecipa este desenho multi-canal; um `WhatsAppProviderAdapter` mirrorando a MESMA forma de
  porta (nunca reimplementando o state machine de `NotificationAttempt`) é reuso direto de
  padrão interno já convergido, não um mecanismo novo.
- `QuotaType` (`identity/application/quota.ts`) já tem `"NOTIFICATION_EMAIL"` como um tipo — o
  precedente de quota por canal/tenant já existe, só falta o par `"NOTIFICATION_WHATSAPP"`.
- Nenhum campo de telefone (E.164 ou qualquer formato) existe hoje em `GlobalUser`/`Membership`/
  `UserProfile` — precisa ser modelado do zero (achado real, não presumido: grep amplo por
  `phone`/`telefone`/`e164` em `src/modules/identity/**`/`src/modules/organization/**` não
  retornou nenhum campo persistido).
- Nenhum precedente de secret de vendor externo (não-AWS) existe no repo — `GUEST_TOKEN_PEPPER`/
  `SESSION_TOKEN_PEPPER` são valores gerados internamente (`random_password`, Terraform), nunca
  uma credencial de terceiro; o access token da Cloud API é o primeiro caso real desta classe.

## Checklist de critérios pesados (sub-rubrica desta decisão, subordinada a `joint-review-criteria.md`)

1. **(20%) Toda mensagem business-initiated usa template pré-aprovado, nunca free-form.**
   Atende: o router NUNCA tenta enviar texto livre para um lembrete/notificação (o produto é
   inerentemente business-initiated — o usuário não abre conversa com o tenant primeiro); a
   janela de 24h de serviço é tratada como inexistente para este fluxo, não como uma otimização
   futura. Não atende: qualquer caminho que assuma uma janela de serviço aberta por padrão.
2. **(20%) Metragem de tier/limite é agregada por PORTFÓLIO da plataforma, nunca por tenant
   isolado.** Atende: o mecanismo de quota reconhece que o limite de mensagens (250→Unlimited)
   é uma característica de UM número/portfólio Meta compartilhado por todos os tenants deste
   SaaS, não uma quota per-tenant independente — existe um teto agregado real que pode ser
   atingido mesmo com tenants individualmente bem abaixo de qualquer cota própria. Não atende:
   tratar o limite da Meta como se fosse só mais um `TenantQuotaRecord` por tenant.
3. **(15%) Opt-in é um registro verificável, não inferido.** Atende: existe um campo/registro
   persistido e datado provando que o titular consentiu (reaproveitando o toggle de
   `NotificationPreferences` já existente como MÉTODO de opt-in válido, per a flexibilidade que
   a própria Meta permite - mas com timestamp e contexto suficientes para auditoria, não um
   booleano solto). Não atende: enviar por WhatsApp sem nenhum rastro de quando/como o opt-in
   aconteceu.
4. **(15%) Reuso do state machine de `NotificationAttempt`/`EmailProviderAdapter`, sem
   duplicar o mecanismo.** Atende: `WhatsAppProviderAdapter` implementa a MESMA forma de porta
   (`send`→`SendResult`/`SendError{kind}`), `channel`/`provider` alargam para união sem
   reescrever `decideSendAction`/lease/`SUBMITTING`; contrato de erro
   CONCLUSIVE_RETRYABLE/CONCLUSIVE_TERMINAL/AMBIGUOUS é honrado com o mapeamento real dos
   códigos de erro da Cloud API. Não atende: um segundo pipeline de entrega paralelo específico
   para WhatsApp.
5. **(10%) Kill switch de 2 flags em ordem, mesmo padrão de D-193 slice 8.** Atende: `WHATSAPP`
   (AppConfig, já existe) gates tanto o router (nunca roteia para o canal) quanto o worker de
   entrega (nunca chama a Cloud API), com gate de ORDEM por construção de código (nunca uma
   janela "habilitado no router mas o worker ainda processa mensagem antiga sem o flag"). Não
   atende: um único flag checado só num dos dois lados.
6. **(10%) Credencial de terceiro nunca vira env var em texto puro.** Atende: access
   token/app secret/phone number ID via AWS Secrets Manager, IAM-escopado só ao(s) Lambda(s)
   que precisam (worker de entrega + handler de webhook), rotação manual documentada (a Cloud
   API não tem rotação automática nativa via AWS). Não atende: repetir o padrão
   `random_password`/env var plano que serve bem para peppers gerados internamente, mas nunca
   foi pensado para um secret de terceiro real.
7. **(10%) Guardrail de custo real, não só o feature flag.** Atende: `TenantQuotaService`
   ganha `"NOTIFICATION_WHATSAPP"` (mesma forma de `"NOTIFICATION_EMAIL"`) E existe um teto
   AGREGADO (não só por tenant) alimentando o AWS Budget/Cost Anomaly Detection já decididos em
   `architecture-fase3-consolidada.md` §14 — coerente com o próprio cost-model.md já ter
   sinalizado WhatsApp como o maior risco financeiro do produto. Não atende: só o kill switch
   binário sem nenhuma medição de consumo real.

## Decisões propostas

### D-1. Extensão de tipo, não migração de dado

`NotificationChannel`/`NotificationAttempt.channel`/`.provider` alargam de literal para união
(`"EMAIL" | "WHATSAPP"` e `"SES" | "META_CLOUD_API"` respectivamente). Nenhuma linha
`NotificationAttempt` existente muda de valor — só o TYPE amplia o que é aceito daqui em
diante, mesmo padrão de D-176 (rename de tipo sem migração, `AGENTS.md` §1/D-093).

### D-2. `WhatsAppProviderAdapter` — mesma porta de `EmailProviderAdapter`

```ts
export interface WhatsAppSendInput {
  to: string; // E.164
  templateName: string; // nome do template PRÉ-APROVADO no Business Manager, nunca dinâmico
  templateLanguage: string; // ex. "pt_BR"
  templateComponents: WhatsAppTemplateComponent[]; // variáveis posicionais, nunca texto livre
  tags: { attemptId: string; intentId: string; tenantId: string; correlationId: string };
}
export type WhatsAppSendFailureKind = "CONCLUSIVE_RETRYABLE" | "CONCLUSIVE_TERMINAL" | "AMBIGUOUS";
```

Mapeamento de erro real da Cloud API (a definir em rodada seguinte com o código de erro exato
de cada família — `131026`/`131047` etc. — mas a FORMA já é 3-vias, nunca binária).

### D-3. Templates são catálogo pré-provisionado, referenciado por nome — nunca criado em runtime

Mesma disciplina de `email-templates.ts` (registro estático, não um CMS de template):
templates do WhatsApp são criados/aprovados manualmente no Meta Business Manager (fora deste
repo, processo operacional, não código) e só REFERENCIADOS por nome+idioma no código. Nenhum
mecanismo de criação/submissão de template via API nesta fatia — reduz superfície e cai fora
do "domínio de risco novo" imediato (aprovação de conteúdo por humano da Meta continua sendo o
gate).

### D-4. Toda mensagem é `Utility` (nunca `Marketing`), consistente com o produto

O produto envia lembretes de vencimento/renovação — categoria `Utility` da Meta (transacional),
nunca `Marketing`. Isso é uma decisão de PRODUTO com implicação técnica direta (o template
submetido à aprovação da Meta declara a categoria) — registrado aqui como constraint de
design, não redecidido a cada template.

### D-5. Opt-in reaproveita `NotificationPreferences`, com timestamp

`NotificationPreferences.whatsappEnabled: boolean` (novo campo, mesmo objeto de
`emailEnabled` já existente) + `whatsappOptInAt?: string` — o ato de habilitar o toggle já É
o opt-in (método flexível, per a pesquisa acima), mas o timestamp datado é o registro
auditável que a Meta exige poder provar caso challenge. Sem entidade nova.

### D-6. Campo de telefone novo, com validação E.164, no nível de `GlobalUser`

Telefone é do INDIVÍDUO (mesma fronteira User-level de D-103/D-104's `privacy-lgpd.md` §4.1),
não do tenant/Membership — `GlobalUser.phoneE164?: string`, validado no formato antes de
persistir, nunca assumido.

### D-7. Webhook handler novo, dedicado, não-autenticado por JWT — autenticado por HMAC

Novo Lambda (`whatsapp-webhook-handler`), rota pública (`GET`+`POST /whatsapp/webhook`, fora do
JWT authorizer, mesma classe de exceção que as 2 rotas `/guest/*` já documentadas em
`api-gateway/main.tf`'s `route_settings` com throttling dedicado). `GET` responde o handshake
`hub.challenge`; `POST` verifica `X-Hub-Signature-256` (HMAC-SHA256, app secret via Secrets
Manager) ANTES de processar qualquer callback de status (`sent`/`delivered`/`read`/`failed`),
atualizando `NotificationAttempt` pelo mesmo `NotificationAttemptLookup` que o callback SES já
usa (`attemptId` como correlação, nunca o `intentId` sozinho).

### D-8. Quota agregada por portfólio, camada nova acima de `TenantQuotaService`

Além de `"NOTIFICATION_WHATSAPP"` como `QuotaType` per-tenant (paridade com `EMAIL`), um
contador AGREGADO cross-tenant (chave própria, não `TENANT#<t>#...`) mede o consumo contra o
tier real do portfólio Meta — o worker de entrega verifica AMBOS antes de enviar (tenant não
excedeu seu próprio teto E o portfólio inteiro não excedeu o tier). Mecanismo exato (contador
único vs. múltiplos, janela de 24h corrida) fica para a próxima rodada — este documento só
fixa que a dupla checagem é obrigatória, não a forma física exata do contador agregado.

### D-9. Credencial via Secrets Manager, não env var

Primeiro secret de vendor externo do repo: access token de longa duração, app secret
(verificação de webhook), phone number ID, WABA ID — todos em AWS Secrets Manager, IAM
`secretsmanager:GetSecretValue` escopado só aos 2 Lambdas que precisam (worker de entrega,
webhook handler), nunca em `environment_variables` do módulo `lambda-function` em texto puro.

### D-10. Kill switch de ordem, mesmo mecanismo de D-193 slice 8

`WHATSAPP` (AppConfig, já existe) vira o master switch; um segundo flag interno de
"delivery worker habilitado" seguindo o MESMO padrão de dois flags em ordem obrigatória (nunca
um sozinho) fecha a janela "router roteia, worker ainda não sabe processar" pela MESMA forma
de `isDocumentArchivePromotionEnabled()`.

## Pendências explicitamente fora desta rodada (nomeadas, não escondidas)

- Mapeamento exato dos códigos de erro reais da Cloud API para
  `CONCLUSIVE_RETRYABLE`/`CONCLUSIVE_TERMINAL`/`AMBIGUOUS` (D-2) — fica para uma rodada com
  a tabela completa de error codes da Meta citada.
- Mecanismo exato do contador agregado de portfólio (D-8) — fixado o REQUISITO, não a forma
  física (DynamoDB item único com lock otimista? Contador aproximado?).
- Emenda pontual a `cost-model.md` refletindo a resolução de `UNK-003` (fornecedor direto) e o
  novo regime de cobrança 2026 (utility/service passam a ser cobrados a partir de 1º de
  outubro) — trabalho de documentação, não de design, feito quando este protocolo fechar.
- ADR formal (nível 6 exige) — escrito quando o design converge, não nesta rodada.
