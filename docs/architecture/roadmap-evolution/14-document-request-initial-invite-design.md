---
status: approved
owner: Marcelo
authority: decisão de arquitetura via protocolo Claude↔Codex completo (AGENTS.md §4) — fecha a "Decisão B" deixada pendente em D-048/13-guest-link-delivery-design.md, delegada explicitamente ao protocolo por Marcelo ("acione o protocolo Claude-Codex, pode seguir pelo caminho decidido com isso")
---

# Fecha "Decisão B" de D-048 — automatizar o e-mail de convite inicial do guest upload

`13-guest-link-delivery-design.md` fechou a rotação de token para chasing (Decisão A) mas deixou
explicitamente **não aprovada** a automação do convite inicial (Decisão B) — mudança de
comportamento de produto/comunicação externa, exigindo decisão explícita do Marcelo antes de
implementar. Marcelo delegou essa decisão ao protocolo Claude↔Codex. Protocolo completo via MCP,
sandbox read-only, 3 rodadas reais.

**Nota final: Claude 9,2 / Codex 9,4 — gate ≥9,0 atingido por ambos os lados, sem arredondar.**

## Processo

- **Rodada 1**: Codex propôs "SIM, com ressalva forte" — opt-in explícito por chamada
  (`deliveryMode`), nunca comportamento implícito. Desenho técnico completo: envio best-effort
  fora da transação do DynamoDB (falha de SES nunca desfaz a criação do `DocumentRequest` —
  token continua disponível para fallback manual), comando/agregado novo (nunca reaproveita
  `NotificationIntent`, que exige `itemId`/`ExpirationItem`), rate limits concretos (20/h e
  100/dia por tenant, 3/24h por tenant+destinatário), kill switch global `default=false` via
  env/Terraform (AppConfig real só existe no design do M7, ainda não implementado), gate
  operacional antes de produção (spike SES real em sandbox, alarme de bounce/complaint,
  runbook).
- **Rodada 2**: Claude convergiu com quase todo o desenho, mas criticou o mecanismo de opt-in
  por chamada, propondo opt-in por preferência de TENANT (reaproveitando
  `NotificationPreferencesService`, já existente). Codex encontrou um problema real nessa
  sugestão: `NotificationPreferences` é por USUÁRIO e pode ser desligada por bounce/complaint do
  próprio usuário interno — misturar isso com uma política de envio externo a terceiro arbitrário
  em nome do tenant seria acoplamento ruim. Codex propôs uma entidade nova e separada, com opt-in
  por tenant como default MAIS override por chamada (com 4 casos de uso reais para o override:
  criação em lote/importação, canal próprio de comunicação, e-mail ainda não validado, registrar
  antes de avisar).
- **Rodada 3**: Claude aceitou a correção e fechou dois últimos pontos em aberto — nome da
  entidade nova (`DocumentRequestDeliveryPreference`, não um hub genérico
  `TenantCommunicationSettings` que convidaria a escopo maior que o necessário) e a action de
  autorização para alterá-la (`tenant:configure-document-request-delivery`, `ADMIN_ROLES` — não
  `WRITE_ROLES`, por ser uma política de comunicação externa de todo o tenant com risco
  reputacional, distinta de uma ação por request individual). Codex concordou com ambos.

## Decisão final

**Automatizar o convite inicial — APROVADO**, com o seguinte desenho:

- **Preferência de tenant** (`DocumentRequestDeliveryPreference`, `TENANT#t#SETTINGS` /
  `DOCUMENT_REQUEST_DELIVERY`): `initialInviteDeliveryDefault: "MANUAL" | "EMAIL"`, default
  `MANUAL`. Alterável só via `tenant:configure-document-request-delivery` (`ADMIN_ROLES`) — nova
  action na matriz de autorização.
- **Override por chamada** em `createDocumentRequest`: campo opcional
  `initialInviteDelivery?: "DEFAULT" | "EMAIL" | "MANUAL"` — `DEFAULT` (ou ausente) usa a
  preferência do tenant; `EMAIL`/`MANUAL` sobrescrevem para aquela chamada específica.
- **Kill switch global** `document_request_initial_invite_email_enabled`, default `false` em
  todos os ambientes — via variável Terraform/env (mesmo padrão de `enable_reserved_concurrency`
  já usado no projeto), não AppConfig (esse mecanismo só existe no design do M7, não implementado
  ainda). Envio nunca acontece se o kill switch estiver desligado, independente da preferência de
  tenant/override.
- **Envio best-effort, fora da transação DynamoDB**: `DocumentRequest`+`GuestTokenPointer` são
  criados exatamente como hoje, na mesma transação; só depois disso (se aplicável) o e-mail é
  enviado via SES. Falha de SES **nunca desfaz** a criação do request — o token continua
  disponível na resposta da API para fallback manual, e a falha é auditada.
- **Rate limit concreto, verificado ANTES da criação quando envio foi solicitado** (falha aqui
  bloqueia a criação com `429` — mesma disciplina fail-closed de `TenantEntitlement`, diferente
  de falha de SES pós-criação): 20 convites/hora por tenant, 100/dia por tenant, 3/24h por
  tenant+`recipientEmailHash`.
- **Agregado/comando novo**, nunca reaproveita `NotificationIntent` (incompatível
  estruturalmente — exige `itemId`/`ExpirationItem`) — mesmo princípio de agregados-irmãos já
  usado em D-039/D-040.
- **Template versionado** (`document-request-initial-invite` v1), reaproveitando
  `email-templates.ts`/`SesEmailAdapter` existentes — nunca motor de template novo. Corpo mínimo:
  identificação do solicitante, nome do requisito, deadline (se houver), link de upload, aviso de
  segurança (não reenviar o link, prazo de expiração), fallback em texto. Sanitização obrigatória
  de todo campo fornecido pelo tenant antes de interpolar (`recipientDisplayName`: trim, colapsar
  espaços, limite de 80 caracteres, escapar HTML, remover caracteres de controle/CRLF — se vazio
  após sanitização, omitir saudação personalizada). `recipientEmail` nunca aparece em log/auditoria
  além do envelope de envio — só hash.
- **Auditoria** (sem e-mail bruto, só hash): eventos `..._REQUESTED`/`_SENT`/`_FAILED`/
  `_RATE_LIMITED`/`_DISABLED_BY_KILL_SWITCH` por tenant.

**Gate antes de habilitar o kill switch em produção (não bloqueia implementar/testar em `dev`)**:
spike de validação SES real em sandbox (tags, configuration set, bounce/complaint callbacks —
mesma pendência já registrada para M4), alarme de bounce/complaint rate por template/categoria,
runbook de desligamento do kill switch, teste de contrato do template + teste cobrindo falha SES
sem perder o token/fallback manual.

## Próxima ação

Implementar junto com o restante do cluster 4 (automated chasing, D-039+D-048) — os dois
reaproveitam a mesma infraestrutura de e-mail/templates. Kill switch continua `false` até o gate
de produção acima ser satisfeito.
