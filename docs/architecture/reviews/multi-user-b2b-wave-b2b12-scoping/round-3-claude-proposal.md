# Wave B2B-12 — Round 3 Proposal (3 achados reais, nota Codex 8,3/10)

Todos os 3 achados aceitos como reais, nenhum contestado.

## Correção 1 — snapshot nunca em Git; manifest redigido, sim

Aceito, achado grave corretamente identificado: `session.ts:28`'s `csrfSecret`/`encryptedRefreshToken`/
`accessToken`, `global-user-repository.ts:27`'s `emailNormalized`, `user-repository.ts:21`'s
`identitySubject`/`emailNormalized` são segredo/PII reais — um JSONL bruto commitado em
`docs/architecture/reviews/` os colocaria no histórico do Git permanentemente, mesmo que a tabela
esteja vazia hoje (o script é reaproveitável, uma execução futura pode não estar). Corrigido: o
snapshot bruto (fase A) grava em `.local-artifacts/dev-reset/<ISO timestamp>/` — path novo,
adicionado ao `.gitignore` como parte desta wave (`.gitignore` hoje não tem nenhuma entrada para
artefato local de script, esta é a primeira). Nunca commitado. O que VAI para
`docs/architecture/reviews/multi-user-b2b-wave-b2b12-scoping/` é só um **manifest redigido**: por
tabela/fila/bucket, contagem de itens, lista de `entityType`s distintos encontrados, e um hash SHA-256
de cada item serializado (prova de que o snapshot existiu e é reproduzível/auditável) — nunca o valor
de nenhum campo sensível. Path local do snapshot bruto referenciado no manifest para quem tiver acesso
à máquina/sessão que rodou o script, não para quem só lê o repositório.

## Correção 2 — remove a referência a função inexistente; backoff local no script

Aceito o achado factual: `occ.ts` não exporta nenhuma função de backoff (só
`isTransactionCanceled()`/`getCancellationReasonCodes()`/builders de update condicional,
`occ.ts:332-387`) — verificado agora, a Rodada 2 citou uma reutilização que não existe. Busca adicional
confirmou que **nenhum lugar do projeto tem um helper de backoff exponencial reaproveitável**
(`dispatch-outbox-relay/relay.ts:135-138` documenta explicitamente "nenhum backoff próprio" como
decisão de design daquele worker — o padrão oposto do que eu precisava). Corrigido: `reset-dev-data.ts`
define seu próprio helper local (`retryWithBackoff()`, arquivo do próprio script, não um novo módulo em
`shared/`) — backoff exponencial simples com jitter, 5 tentativas, usado só para retentar
`UnprocessedItems` de `BatchWriteItem`; não introduz abstração nova compartilhada porque nenhum outro
call site real precisa dela hoje (`principles.md` #1).

## Correção 3 — quiescência de filas: verificação final fail-loud, não pausar schedules

Aceito a classe de risco (schedules/event source mappings reais continuam ativos durante o reset:
`reminder_producer`/`reminder_reconciliation`/`outbox_sweeper` via EventBridge Scheduler,
`infra/main.tf:715+`; `aws_lambda_event_source_mapping` reais para cada fila, ex.
`infra/main.tf:703`/`infra/main.tf:456`). Decisão proporcional (não construir automação de
pausar/retomar schedules, desproporcional para uma operação manual one-off contra dado sintético,
`principles.md` #1): o script não tenta impedir uma corrida, mas nunca DECLARA sucesso sem provar o
estado final. Fase B termina com uma segunda leitura completa (Scan total das 2 tabelas +
`get-queue-attributes` das 24 filas) — se QUALQUER contagem for diferente de zero, o script sai com
código de erro explícito e lista exatamente o que sobrou (nunca "sucesso parcial" silencioso). Runbook
(passo manual, documentado no próprio script `--help`/comentário de topo, mesmo padrão de
`backfill-reminder-policies.ts`) recomenda rodar numa janela sem tráfego de teste manual conhecido —
dado que esta wave já confirmou (Achado #1 da Rodada 1) que não há cliente/usuário real gerando
tráfego em `dev` hoje, o único produtor residual são os próprios schedules internos (cadência de
minutos, não segundos) — uma corrida real exigiria coincidência de timing rara, e o fail-loud da
verificação final a torna visível (o script falha e o operador re-roda) em vez de mascarada.

## Sem mudanças

Classificação de risco (nível 5), E-014 (`NÃO`), e as 7 correções da Rodada 2 (snapshot-antes-de-delete,
25-item batching, allowlist de tabela+conta, inventário Cognito gated por `--include-cognito`,
`bff-session` incondicional, purge das 24 filas, escopo estendido de remoção de
`LEGACY_TENANT_ONLY`) — o Codex concordou explicitamente com todos na Rodada 2, sem achado que os
conteste.
