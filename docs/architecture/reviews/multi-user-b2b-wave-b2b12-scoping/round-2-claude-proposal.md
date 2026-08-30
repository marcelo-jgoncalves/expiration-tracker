# Wave B2B-12 — Round 2 Proposal (7 achados reais, nota Codex 7,4/10)

Todos os 7 achados da Rodada 1 são aceitos como reais — nenhum contestado. Correções abaixo, na
mesma numeração da crítica do Codex.

## Correção 1 — snapshot/export antes do delete destrutivo

Aceito: a proposta original ia direto Scan→delete sem artefato reversível. `scripts/reset-dev-data.ts`
passa a ter 2 fases sequenciais, nunca combinadas: **fase A (sempre)** — Scan completo e paginado de
`exptrk-dev-table`/`exptrk-dev-bff-session`, grava um JSONL com todos os itens (snapshot completo,
não amostra) em `docs/architecture/reviews/multi-user-b2b-wave-b2b12-scoping/dev-reset-snapshot-<ISO
timestamp>.jsonl` (repositório, não S3 — 47 itens são triviais em tamanho, ~17KB, e ficar no repo dá
histórico via git em vez de depender de mais um bucket); **fase B (só com `--confirm`)** — delete real,
só executa se a fase A já produziu o snapshot com sucesso na mesma invocação (fail-closed: sem
snapshot gravado, sem delete). S3 (`extraction-transient`, 21 objetos): `aws s3 ls --recursive` para o
mesmo snapshot (lista de chaves, não os bytes — são artefatos de OCR transiente, já classificados
"não migrar cegamente" por §66, não vale persistir o conteúdo) antes do delete real.

## Correção 2 — `BatchWriteItem` corretamente especificado + correção factual

Aceito o achado técnico E a correção factual: `backfill-reminder-policies.ts:62`
(`dryRun: argv.includes("--dry-run")`) **não** tem dry-run como default — é uma flag opt-in, o
oposto do que a Rodada 1 desta proposta afirmou. Corrigido na descrição; e **deliberadamente diferente**
no script novo (justificativa, não um erro a repetir): `backfill` é aditivo (materializar um pointer
que já deveria existir, seguro re-rodar), `reset-dev-data.ts` é destrutivo (delete real) — a assimetria
de risco justifica a assimetria de default (dry-run default aqui é uma escolha deliberadamente mais
conservadora, não uma cópia do precedente).

Especificação do delete, corrigida: lotes de no máximo 25 itens por `BatchWriteItem` (limite real do
serviço); `UnprocessedItems` da resposta retentado com backoff exponencial (mesmo padrão de retry que
`occ.ts` já usa para `TransactionCanceledException`, reaproveitar a função de backoff existente em vez
de escrever uma nova) até a lista ficar vazia antes de avançar; checkpoint via `LastEvaluatedKey` do
Scan **só avança depois que TODOS os lotes de delete daquela página tiverem `UnprocessedItems` vazio**
(mesmo invariante de "avança só depois que a página inteira suceder" que `backfill-reminder-policies.ts`
já usa para leitura, aplicado aqui à escrita); verificação final — um segundo Scan completo (sem
`FilterExpression`) confirma contagem zero antes do script reportar sucesso, nunca confiar só no
"todos os deletes retornaram OK".

## Correção 3 — allowlist de ambiente, não só `--table` nomeado

Aceito: `--table` nomeado sozinho não protege contra erro de operador. Esta conta AWS
(`975707451904`, `claude-dev`) hospeda recursos de outros projetos não relacionados (confirmado por
`aws dynamodb list-tables`: `financial-intelligence-tfstate-lock`,
`marcelo-goncalves-blog-dev-*`, `terraform-lock-stocks-ranking`) — um erro de digitação em `--table`
poderia, em tese, apontar para um nome real de outro projeto. Corrigido: o script recusa qualquer
valor de `--table`/`--session-table` fora de uma allowlist hardcoded de exatamente 2 strings
(`exptrk-dev-table`, `exptrk-dev-bff-session`) — não um parâmetro livre, uma validação antes de
qualquer chamada AWS. Adicional: `sts:GetCallerIdentity` no início confirma `Account: 975707451904`
(a própria conta `claude-dev`) antes de prosseguir, mesma disciplina de "confirmar antes de assumir"
já usada neste projeto para outras verificações via `aws --profile claude-dev`.

## Correção 4 — inventário de Cognito incorporado (não deixado de fora)

Aceito o achado como classe de risco real, mesmo já tendo verificado o estado atual: `aws
cognito-idp list-users --user-pool-id us-east-1_NZlvr5IIn --profile claude-dev` retorna `[]` agora —
**zero usuários reais no pool hoje**, então não há identidade órfã que reataria a `dev` no momento em
que este documento é escrito. Mas o Codex está certo que o SCRIPT (não só esta rodada de análise)
precisa verificar isso a cada execução futura, não confiar num estado observado uma vez. Corrigido:
fase A do script sempre inclui `list-users` do user pool (nome resolvido via output do Terraform, não
hardcoded) no snapshot; se a contagem for > 0 na hora de rodar, o script recusa prosseguir para a fase
B sem uma flag explícita adicional (`--include-cognito`) que também apaga esses usuários — nunca
apaga Cognito silenciamente como efeito colateral do reset de DynamoDB.

## Correção 5 — `exptrk-dev-bff-session` sempre no fluxo, nunca condicional

Aceito: "0 itens, nenhuma ação" era a resposta errada — o mecanismo deve prová-lo, não assumi-lo, e
deve ser o MESMO Scan+delete incondicional das duas tabelas, não um caso especial. Corrigido: fase
A/B do item 1 acima já cobrem `exptrk-dev-bff-session` sem tratamento diferenciado — o script nunca
pula uma tabela por já esperar que ela esteja vazia, sempre Scan real. (O achado lateral do Codex
sobre `tenant-purge-scan.ts` ainda filtrar por `tenantId` enquanto `Session` não tem mais esse campo é
uma observação correta, mas sobre o pipeline de purga W3-07 — já registrado como pendência separada,
não-bloqueante, em `multi-user-b2b-wave-tracker.md`; fora do escopo desta wave, que é reset de dado
`dev`, não fix do purge pipeline.)

## Correção 6 — filas SQS/DLQ inventariadas, achado real novo confirmado

Aceito, e o inventário real (rodado agora, não hipotético) confirma o risco: das 24 filas reais
(`aws sqs list-queues --queue-name-prefix exptrk`, 12 filas + 12 DLQs), 22 estão vazias, mas
**`exptrk-dev-upload-finalizer-dlq` tem 3 mensagens reais** e `exptrk-dev-malware-result-dlq` tem 1
mensagem "not visible" (provavelmente em voo por outro processo/redrive, não confirmado). Isso é
exatamente a classe de risco que o Codex apontou, não hipotética: uma mensagem parada numa DLQ pode
referenciar um `tenantId`/`organizationId` pré-cutover, e se algum dia uma redrive policy a reenviar
para a fila principal, um worker processaria dado obsoleto contra o schema novo. Corrigido: fase A
inclui `get-queue-attributes` (contagens) das 24 filas no snapshot; fase B, com `--confirm`, chama
`PurgeQueue` (ação nativa SQS, idempotente, sem precisar Scan+delete manual) em todas as 24 — as 3
mensagens reais da `upload-finalizer-dlq` e a 1 da `malware-result-dlq` incluídas, nenhum tratamento
especial por já estarem "quase vazias".

## Correção 7 — remoção de `LEGACY_TENANT_ONLY` estendida ao frontend + teste, confirmado seguro

Aceito o escopo estendido. Verificado por leitura direta (não só grep): `frontend/src/api/session.ts:12`
declara o mesmo union type (`OnboardingState`) com `"LEGACY_TENANT_ONLY"` como um dos 4 membros;
`test/unit/organization/onboarding-state.test.ts` testa o estado diretamente. Verificado também que a
remoção é mecanicamente segura nos 2 call sites backend que consultam o resultado:
`resolve-request-context.ts:101` (`if (onboardingState !== "HAS_USABLE_MEMBERSHIP") throw
OnboardingRequiredError(...)`) e `bff-auth-service.ts:563-568` (mesmo padrão, comparação contra
`"HAS_USABLE_MEMBERSHIP"`) — **nenhum dos dois usa switch exaustivo sobre o union**, ambos comparam só
contra o único valor "bom", então remover um dos valores "ruins" não quebra nenhuma branch existente.
Escopo final da remoção: `onboarding-state.ts` (union type + passo 4 do procedimento sequencial, que
colapsa no passo 5/`NO_TENANT_NO_MEMBERSHIP` sem o legacy check) + `frontend/src/api/session.ts`
(union type) + `test/unit/organization/onboarding-state.test.ts` (caso de teste do estado removido) +
comentário desatualizado (linha 16-17 do arquivo, "the real state of every user today" — já falso
desde B2B-11).

## Sem mudanças

Classificação de risco (nível 5), declaração E-014 (`NÃO`), e a escolha de mecanismo geral (script de
aplicação em vez de `terraform destroy`/recriação de tabela) — o Codex concordou explicitamente com
ambos na Rodada 1, sem achado que os conteste.
