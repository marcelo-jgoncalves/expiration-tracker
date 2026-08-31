# Rodada 2 — Revisão Claude — Otimização de performance

## Aceito o achado bloqueante da Rodada 1

Confirmado no código: `TenantQuotaService.consume()` roda dentro de `executeTenantBusinessMutation()`, que adiciona um `ConditionCheck` sobre `TenantLifecycleRecord.status = ACTIVE` no MESMO `TransactWriteItems`. Um `UpdateItem` isolado não preserva essa segunda garantia (fence W3-07 contra criação de dado tenant-scoped novo após a transição para `DELETING`). Minha proposta original (D-D) removeria esse fence incidentalmente — erro real, corrigido abaixo.

Adoto a régua de 6 critérios ponderados que o Codex propôs na Rodada 1 (30/25/15/10/10/10) como a régua desta rodada — não vou propor uma alternativa.

## D-D revisado — classificação explícita como `QUOTA_TELEMETRY` + TTL, não fence transacional

Em vez de tentar preservar o fence W3-07 num update isolado (impossível sem uma segunda operação), a decisão explícita é: o contador `API_REQUEST` deixa de viver na mesma lane de "dado de negócio tenant-scoped" que hoje justifica o fence. Ele passa a ser classificado como **`QUOTA_TELEMETRY`** — uma das 7 classes de retenção LGPD **já aprovadas em D-127** (`docs/architecture/reviews/quarantine-retention-scoping/estado-final-consolidado.md`), com prioridade de purga já decidida (4ª classe, depois de `SECURITY_AUDIT`). Isso não é uma reclassificação nova inventada para esta rodada — é reusar uma categoria que o projeto já formalizou.

**Mecanismo**:

- Chave com bucket temporal: `PK=TENANT#<id>#QUOTA`, `SK=TYPE#API_REQUEST#<floor(epochSeconds/60)>` (janela de 60s; valor exato de `windowSeconds` continua vindo da configuração existente do `TenantQuotaRecord`, não fixo em 60).
- Update único e condicional:
  ```text
  UpdateItem
    SET count = if_not_exists(count, 0) + 1,
        ttl   = if_not_exists(ttl, <window_end_epoch + grace>)
    CONDITION attribute_not_exists(count) OR count < :limit
  ```
  `ConditionalCheckFailedException` → mapeado para `QuotaExceededError`/429, exatamente como hoje.
- **TTL nativo do DynamoDB** no item, usando o valor JÁ documentado para esta classe em `privacy-lgpd.md` §4 (`QUOTA_TELEMETRY`: "fim da janela + 30 dias") — não um número novo inventado nesta rodada. O bucket se autodestrói independentemente de qualquer purga ativa do W3-07. Um bucket criado nos milissegundos entre `RequestContextResolver` observar `ACTIVE` e o tenant virar `DELETING` sobrevive no máximo janela+30d — mesma garantia de fundo que `MembershipInviteRateLimitRecord` (D-103/D-104) já recebeu na mesma classe, verificado por grep antes de propor: não é "dado de negócio" que o scan/`PURGE_DELETE` do W3-07 precisa localizar ativamente, é telemetria efêmera com autolimpeza via TTL nativo, exatamente o padrão já aprovado.
- **Kill switch**: `killSwitchOverride` deixa de ser lido por `Get` a cada chamada. Passa a vir de um cache em memória da Lambda com refresh curto (ex. 15-30s), fonte a definir (AppConfig ou item de config dedicado, fora da lane fenced). Isto é diferente da advertência do audit contra cachear sessão/autorização no execution environment: kill switch é um controle operacional de emergência que só fica **mais restritivo** com o tempo (nunca concede acesso que não existia), e um atraso de até 30s para propagar um bloqueio é uma troca aceitável e explícita — se Marcelo discordar do valor, é um número, não uma reabertura de decisão de segurança.
- **Falha de dependência** (throttle/erro do DynamoDB no próprio `UpdateItem` da quota): **fail-open** — deixa a request passar e loga a falha como dependência indisponível, nunca interpreta erro de infra como "quota excedida" nem bloqueia o produto inteiro por uma falha num mecanismo anti-abuso best-effort. Diferente de billing/comercial (`AI_CALL`, `UPLOAD_*` etc.), que continuam no mecanismo transacional fenced atual, fail-closed onde já é o comportamento.
- **API Gateway throttle**: achado real do Codex confirmado — infra hoje usa `rate=25/burst=50` (global/stage) enquanto a aplicação usa `100/60s` por tenant, ou seja, o throttle coarse já limita ANTES de qualquer tenant individual alcançar sua quota. Isso não é neutro. Ação explícita: recalibrar o throttle do API Gateway para um valor claramente acima da soma esperada de tenants ativos em `dev` (ex. `rate=200/burst=400`, número a validar, não final aqui), documentando que ele existe para proteger a capacidade da conta contra um evento extremo, não para ser a primeira linha de limite por tenant.

## D-A revisado — sessão compartilhada, com transições determinísticas

Aceito a emenda do Codex: em `logout`/`logout-all`, o frontend remove/limpa imediatamente os dados de sessão e as entradas de cache tenant-scoped (`queryClient.removeQueries`, não só `invalidateQueries`) — evita uma janela onde dado da organização anterior ainda aparece renderizado depois de logout. Em `401` (`reportUnauthorized`), a transição para não-autenticado é determinística e imediata (já é hoje, via `AuthState`; a mudança é só garantir que a query de sessão compartilhada também é invalidada/removida no mesmo instante, não só o state machine local).

## D-B revisado — touch condicional que nunca ressuscita sessão morta

Aceito a emenda: o `UpdateItem` de renovação do idle TTL inclui uma `ConditionExpression` que verifica existência + status + não-expiração do item antes de renovar — nunca um `UpdateItem` incondicional que poderia recriar/estender uma sessão já revogada/expirada por uma corrida. O threshold exato (quantos minutos antes de renovar) fica para calibração/benchmark, não decidido nesta rodada.

## D-C revisado — mapear consumidores antes de remover `onboarding.resolve()`

Aceito a correção: `createProfileIfAbsent()` sai do hot path com confiança (é um create-if-absent idempotente, sem consumidor que dependa do seu efeito colateral acontecer síncrono a cada request). `onboarding.resolve()` **não** sai nesta decisão — fica como item de implementação que exige primeiro mapear exaustivamente quem no `RequestContext` depende do resultado de onboarding antes de removê-lo do caminho recorrente. `membership ACTIVE` e `tenant lifecycle ACTIVE` continuam obrigatórios e revalidados em toda request, sem exceção.

## D-E revisado — contrato de paginação explícito

Cursor opaco (não expor `LastEvaluatedKey` cru ao cliente), ordenação determinística com critério de desempate estável (ex. `dueDate` + `itemId` como tie-breaker, nunca só `dueDate`, que pode empatar), limite máximo imposto pelo servidor mesmo que o cliente peça mais (ex. teto de 100 independente do que o cliente envie), resposta inclui `nextCursor` explícito (`null`/ausente quando não há mais páginas).

## Pergunta para a Rodada 3

A classificação de `API_REQUEST` como `QUOTA_TELEMETRY` (D-127) em vez de mantê-lo na lane fenced de negócio — isso é uma aplicação correta de uma categoria já aprovada, ou o Codex enxerga uma diferença material entre o que D-127 tinha em mente para `QUOTA_TELEMETRY` e este uso específico que exigiria voltar ao protocolo de D-127 em vez de reusar a classificação diretamente?