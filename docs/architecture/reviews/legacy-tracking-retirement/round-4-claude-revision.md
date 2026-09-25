---
status: proposta Rodada 4 (emenda focada) do protocolo Claude↔Codex
owner: Marcelo (decisão final)
authority: proposta, não normativa
---

# Rodada 4 — emenda focada (Codex R3: 8,8/10, 3 blocos nomeados para fechar em 9,0)

Aceito os 3 blocos de `round-3-codex-output.txt` §6 integralmente. Fechamento de cada um:

## 1. Idempotência — algoritmo e comparação após corrida (achado 4a)

Fingerprint calculado sobre o input **como submetido**, nunca pós-resolução:
`initialInviteDelivery: input.initialInviteDelivery ?? "DEFAULT"` entra no hash **antes** de
qualquer consulta a A22 — nunca resolvido primeiro. Fluxo:

1. Lookup por `idempotencyKey`. **Encontrado** → comparar fingerprint (input normalizado, não modo
   resolvido). Igual → devolve `resultSnapshot` tal como persistido (o modo efetivo já gravado ali,
   estável por definição — nunca reavaliado contra A22 atual). Diferente → `ConflictError`.
2. **Não encontrado** → resolve modo efetivo (override explícito → preferência A22 → `MANUAL`),
   valida (EMAIL exige destinatário válido), persiste `resolvedInitialInviteDelivery` +
   `idempotencyRecord` (com o fingerprint do input normalizado, não do modo resolvido) na MESMA
   transação de hoje.
3. **Corrida perdida** (`document-archive-service.ts:1233-1237` hoje): em vez de reler e devolver
   `resultSnapshot` sem checar nada, aplicar a MESMA comparação de fingerprint do passo 1 contra o
   registro que venceu a corrida. Fecha o bug pré-existente que o Codex identificou (duas chamadas
   concorrentes `K+EMAIL`/`K+MANUAL` podiam ambas "suceder" hoje) — está no caminho exato que esta
   decisão promete corrigir, não é auditoria lateral.

Critérios de aceitação (para o ADR/ficha de saída, não implementados nesta rodada): replay
`DEFAULT` após A22 mudar preserva o snapshot original; `EMAIL` explícito vs. `MANUAL` explícito na
mesma chave conflita tanto sequencial quanto sob corrida real; replay legítimo nunca falha por
revalidar contra o default novo.

## 2. Copy de séries + A22 (achado 3)

`SubjectRequests.tsx:502` ("E-mail que receberá o link de convidado a cada ciclo") também é
corrigido, não só o formulário avulso: passa a condicionar a promessa ao modo efetivo ("usado
quando a organização estiver configurada para enviar automaticamente; caso contrário, a solicitação
é criada sem envio automático"). `RequestDeliverySettings.tsx`: `PageHeader` deixa de referenciar
"fluxo de rastreamento legado"; rótulo/descrição de "Entrega manual" passa a descrever supressão de
envio automático (não mais promessa de link compartilhado por fora); nota explícita de que mudar
esta preferência **só afeta solicitações/materializações novas**, nunca reenvia uma já suprimida.

## 3. Inventário — correções factuais (achado 1)

Substituições/adições aceitas literalmente: `src/modules/subject/application/{document-chasing-
producer,document-chasing-materializer}.ts` (não "dispatch/producer/materializer.ts" — só
`dispatch.ts` existe nesse diretório) + `application/advance-after-submission-evidence.ts` +
`domain/document-chasing.ts`, todos exclusivos. G01: `scripts/build-lambdas.ts:65-66`,
`infra/main.tf` (~2202+ `guest_documents_handler`, `:2261-2263` event source de chasing),
`infra/modules/api-gateway/main.tf:559-589` (rotas/integração/permissão G01 real — `:443-471` da
Rodada 3 estava errado, são rotas autenticadas de `subjects`). `random_password.guest_token_pepper`
é **compartilhado** com outros handlers (`infra/main.tf:230,282,310,1205`) — remover só grants/envs
exclusivos de G01, nunca o recurso do pepper em si. Composição: `buildSubjectDeps` sobrevive
parcialmente (perde `RequirementService`/`itemLookup`); `buildDocumentRequestDeps`,
`buildGuestSubmissionDeps`, `buildSubjectWorkerDeps`, `buildDocumentChasingDispatchDeps` saem por
completo. BFF/schemas/testes explicitamente no escopo: `proxy-allowlist.ts:80-100`,
`schema-validator.ts:35,60-61` e contratos associados — distinguindo o schema de A22
(preservado/migrado) dos schemas exclusivos do legado (removidos).

**A22 GET, precisão aceita**: hoje GET e PUT são ambos `tenant:configure-document-request-delivery`
(`OWNER_ROLES`, `authorization.ts:316`) — a proposta preserva isso **literalmente** para o endpoint
público (GET administrativo continua OWNER-only, sem mudança de autorização HTTP). A leitura
**interna** usada durante criação/materialização é um método separado do `DocumentArchiveService`,
nunca exposto por rota/`authorize()` própria, escopado ao tenant já autorizado no contexto da
chamada (nunca a um tenant arbitrário do body) — não vira endpoint público novo.

**Séries, precisão de encaixe técnico aceita**: `buildMaterializeAttemptEntries` continua puro/
síncrono, sem I/O. A resolução do modo via A22 acontece nos DOIS chamadores —
`DocumentRequestRecurrenceService.materializeAttempt` (:324-331) E o worker
`runDocumentRequestRecurrenceMaterializer` (`src/workers/document-request-recurrence/
materializer.ts:69`) — cada um chama o método interno de leitura acima e passa o modo já resolvido
como parâmetro do builder, preservando a mesma transação OCC (série+pedido+outbox) de hoje.

## Sem mudança nesta rodada

Nível de risco (A=6, B=5), pesquisa externa (NÃO no escopo atual), as 3 pendências de produto de
Marcelo, e os pontos já fechados nas Rodadas 2-3 (ownership de A22, consequência funcional de
MANUAL, persistência vitalícia do modo, EMAIL sem destinatário) — mantidos como estão.
