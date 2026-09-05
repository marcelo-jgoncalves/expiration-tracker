# WhatsApp Operacional (Roadmap P0.3) — Rodada 3 (revisão Claude)

Rodada 2 do Codex: régua v2 quase estável (nota 8,7/10 — 2 pontos de contestação pontuais, não
uma rejeição total), design 8,1/10 contra ela (não fecha) — 3 bloqueantes reais, técnicos, não
polimento. Esta rodada corrige os 3 e ajusta a régua nos 2 pontos que o Codex contestou.

## Ajuste da régua (v3 — só os 2 pontos contestados pelo Codex mudam)

- **Critério 1 (webhook inbox)**: texto agora exige explicitamente um caminho de gravação que
  NÃO dependa de tenant já resolvido — "Atende: o inbox é gravado usando uma chave derivável
  do envelope do webhook ANTES de qualquer tentativa de correlação (conta/`wabaId`, nunca
  `tenantId`) — um evento assinado mas não-correlacionável ainda assim é gravado (idempotente)
  e marcado `UNMATCHED` depois, nunca descartado sem registro. Não atende: qualquer caminho em
  que a existência da linha de inbox dependa de a correlação já ter funcionado."
- **Critério 3 (quota)**: texto agora exige explicitamente "chave de índice time-ordered,
  consultável por range real, com custo/limite de paginação declarado — nunca só a promessa
  qualitativa de 'destinatário único em janela móvel' sem a forma física que a sustenta."

Pesos inalterados (15%/15%/15%/15%/10%/10%/10%). Codex: por favor confirme ou contra-proponha
nesta rodada se isso fecha a régua em ≥9,0/≥9,0 — sem mudança de peso, só de especificidade do
texto, não deveria reabrir os outros 5 critérios que você já considerou fechados.

## Correção 1 — Quota: chave física refeita (bloqueante #2 da Rodada 2)

**Erro real da Rodada 2, reconhecido**: `SK = RECIPIENT#<telefoneE164>#<timestampIso>` ordena
por destinatário primeiro — uma Query por range de tempo não funciona contra essa forma. Corrigido:

```text
PK = WHATSAPP#PORTFOLIO
SK = SENT#<timestampIso>#<telefoneE164>
```

Tempo primeiro na SK torna `Query(PK=WHATSAPP#PORTFOLIO, SK BETWEEN "SENT#<agora-24h>" AND
"SENT#<agora>")` uma comparação lexicográfica válida (timestamp ISO-8601 ordena corretamente
como string, mesmo padrão que toda `GSI1SK`/`GSI8SK` deste repo já usa). Contagem de
destinatário único = `Set` dos sufixos de telefone extraídos das linhas retornadas.
**Otimização real, não cosmética**: a Query pode parar de paginar assim que o `Set` atingir o
teto do tier atual — não precisa esgotar a janela inteira só para provar "já estourou".

**Confirmado: é tabela base, não GSI novo** (resolve a pergunta do Codex "GSI ou base table" —
nenhum GSI10 é criado por esta decisão). É um item físico NOVO na tabela principal, com PK fixo
`WHATSAPP#PORTFOLIO` que nunca colide com nenhum `TENANT#<t>#...` existente — cross-tenant por
natureza (o limite é do portfólio Meta inteiro), então **não** é protegido por
`tenant_facing_read_write_policy_json` (que assume `LeadingKeys` no formato `TENANT#...`).
Precisa de uma policy IAM NOVA e dedicada, escopada por `dynamodb:LeadingKeys=["WHATSAPP#PORTFOLIO"]`
— mesma disciplina de isolamento de GSI3/GSI6 (`AGENTS.md` §7), só que numa partição da tabela
base em vez de um índice, anexada SÓ ao `WhatsAppDeliveryWorker` (único Lambda que lê E escreve
esta chave). Nenhum outro Lambda ganha acesso a `WHATSAPP#PORTFOLIO`.

**Risco de hot-partition, nomeado explicitamente (não escondido)**: toda mensagem de TODOS os
tenants grava na MESMA partição física — em escala alta, isso pode esbarrar no teto de
throughput de uma partição DynamoDB. Proporcional ao estágio atual (`AGENTS.md` §1, sem
usuários reais, e o próprio teto de tier da Meta em 250-2.000 mensagens/24h no início é
ordens de grandeza abaixo de qualquer limite de partição real). Gatilho de revisão nomeado,
mesmo padrão de `evolution.md`: se o tier do portfólio subir para 10.000+ E o volume real
aproximar-se do teto de throughput de partição, shard por bucket de hora
(`WHATSAPP#PORTFOLIO#<YYYYMMDDHH>`) com Query fan-out nas últimas 24-25 partições — não
construído agora, sem access pattern real que o justifique hoje (`principles.md` #1).

## Correção 2 — WebhookInbox: caminho tenantless para signed-but-unmatched (bloqueante #1)

**Achado real que a correção revela, registrado explicitamente**: o precedente que a Rodada 1/2
citou (`ses-callback-workflow.ts`) na verdade **NÃO** grava `WebhookInbox` quando as tags
faltam — retorna `UNMATCHED` direto, ANTES de sequer construir a chave do inbox
(`if (!attemptId || !intentId || !tenantId) return { kind: "UNMATCHED" }`, linha 62-64,
antes de `webhookInboxKey` ser chamada). Ou seja, a alegação da Rodada 2 ("SES sempre grava
inbox antes de processar") estava certa para o caminho feliz mas **errada** para o caminho sem
tags — o SES real tem exatamente a mesma lacuna que o Codex encontrou aqui, só que ninguém
tinha notado até agora. Isso não é retrabalho desta decisão (SES já está em produção,
fora de escopo mudar retroativamente aqui) — registrado como pendência nomeada e independente
em "Pendências" abaixo.

Para WhatsApp, a correção é possível porque a arquitetura original (`architecture-fase3-
consolidada.md`, cenário 15) já previu isto: a chave composta é **"provider + tenant/ACCOUNT +
providerEventId"** — a barra é "ou", não "e". `wabaId` (WhatsApp Business Account ID) está
disponível no ENVELOPE do webhook, antes de qualquer tentativa de correlação por
`biz_opaque_callback_data`:

```text
PK = WEBHOOK#WHATSAPP#<wabaId>      // account-scoped, NUNCA tenant-scoped
SK = EVENT#<wamid>#<statusType>
```

Fluxo corrigido: (1) verificar `X-Hub-Signature-256` — se inválida, descartar sem gravar nada
(a assinatura prova que o payload nem veio da Meta, não há evento real a idempotizar); (2) se
válida, `putIfAbsent` no inbox JÁ com esta chave account-scoped, `processingStatus: "RECEIVED"`
— isto acontece **antes** de qualquer tentativa de ler `biz_opaque_callback_data`; (3) só então
tentar extrair/parsear as tags e correlacionar via `NotificationAttemptLookup`; (4) se a
correlação falhar (tag ausente/inválida/não resolve), atualizar a MESMA linha de inbox já
criada para `processingStatus: "UNMATCHED"` (reaproveitando `markInboxUnmatched`, já existe em
`ses-callback-workflow.ts`, sem mudar sua forma) — nunca um segundo caminho que pula o inbox.
Isto fecha o bloqueante do Codex ("onde grava o inbox se a correlação falhar") sem inventar
mecanismo novo — só reordena os passos 2 e 3 (grava ANTES de tentar correlacionar, não depois).

GSI8 (transient-purge) e retenção seguem exatamente iguais ao já aprovado para `WebhookInbox`
de SES (`deriveWebhookInboxMaintenanceDue`), só a chave física de idempotência muda de
tenant-scoped para account-scoped.

## Correção 3 — `biz_opaque_callback_data` formalizado como requisito de implementação

Já direcionado corretamente na Rodada 2 segundo o Codex; formalizado aqui como decisão, não só
intenção: a PRIMEIRA fatia de implementação (worker de entrega) inclui, antes de habilitar
qualquer envio real (mesmo atrás do kill switch OFF), uma chamada de sandbox real contra a
Cloud API confirmando que o campo retorna intacto no callback de status — se não confirmar,
a decisão de correlação desta rodada é revisitada antes de qualquer produção, registrado como
gate de implementação, não como suposição aceita silenciosamente.

## Pendência nova, fora de escopo desta decisão, registrada para não se perder

`ses-callback-workflow.ts`'s caminho `UNMATCHED` por tags ausentes não grava `WebhookInbox`
antes de retornar — inconsistente com o próprio cenário 15 de `architecture-fase3-
consolidada.md` ("todo webhook grava inbox antes de processar"), achado incidental desta
rodada, não corrigido aqui (SES já está em produção, é uma decisão própria e separada, nível
3-4, fix mecânico — mesma disciplina D-177→D-178 de não misturar um achado adjacente dentro de
uma fatia não relacionada).
