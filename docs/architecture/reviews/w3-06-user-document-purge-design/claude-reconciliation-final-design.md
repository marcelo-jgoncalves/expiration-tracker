# W3-06 — Desenho final do mecanismo de purga real de `USER_DOCUMENT` (Document)

> Protocolo Claude↔Codex completo, 6 rodadas, gate padrão 9.0/10. Codex final: **9,2/10,
> APROVADO**. Claude final: **9,1/10** (nenhum achado bloqueante residual identificado
> independentemente; only a implementação real, não mais este desenho, poderá revelar detalhe
> novo — mesma disciplina de "nota não é garantia de zero achado na implementação" já registrada
> em outras decisões deste repositório). Histórico completo rodada-a-rodada:
> `claude-proposal-round{1..6}.md` / `codex-round{1..5}-critique-full.txt` (Rodada 6 sem arquivo
> de crítica solto — aprovação está na cauda de `codex-round6-out.txt` referenciado aqui).

## Resumo executivo do mecanismo aprovado

1. **Fila primária — claim por lease sobre GSI6** (reuso do idioma `WORKSTATE#PENDING/CLAIMED`
   já provado por `ReminderReconciliation`): `Document` ganha `GSI6PK`/`GSI6SK` escritos na MESMA
   transação do soft-delete (`document-deletion-service.ts`), valor inicial
   `GSI6PK = "WORKSTATE#PURGE_PENDING"`, `GSI6SK = <purgeAfter>#TENANT#<t>#DOCUMENT#<d>`.
2. **`DocumentPurgeWorker`** (agendado via `aws_scheduler_schedule`, cadência 6h, mesmo padrão de
   `upload_slot_reconciliation`): a cada execução, sem cursor entre invocações (até 25
   candidatos/consulta):
   - Query A: `WORKSTATE#PURGE_PENDING`, `GSI6SK < now` → tenta **claim** de cada candidato via
     `TransactWriteItems` condicionado (`buildVersionedUpdate` + `extraConditions` novas, ver
     abaixo) movendo para `WORKSTATE#PURGE_CLAIMED` com lease de 15min.
   - Query B (reconciliação de lease): `WORKSTATE#PURGE_CLAIMED`, `GSI6SK < now` → devolve a
     `PENDING` (se `purgeAttempts < 5`) ou marca `purgeStatus: "STUCK"` e remove de ambas as filas
     (se `purgeAttempts >= 5`), sempre condicionado à mesma versão/GSI6SK lidos.
   - Após claim bem-sucedido de um `Document`: deleta o objeto S3 real —
     `doc.cleanObject` se existir; senão `doc.uploadEvidence?.object ?? doc.malwareEvidence?.object`
     se existir; senão nenhuma chamada S3 (nunca usar `doc.quarantineObject` diretamente — seu
     `versionId` é sempre `""`, confirmado em código real). Depois, `TransactWriteItems` final:
     `Delete` da linha `Document` + `Put DocumentPurgeReceipt` (mesma transação).
   - Após claim de um `DocumentPurgeReceipt` (`entityType` discrimina o branch): sem chamada S3,
     só `Delete` da própria linha.
3. **`legalHold?: boolean`** novo campo em `Document`. Claim do purge condiciona
   `attribute_not_exists(legalHold) OR legalHold = :false`. **Regra normativa vinculante desta
   decisão** para qualquer escritor futuro de `legalHold = true`: deve incluir a condição
   `attribute_not_exists(GSI6PK) OR GSI6PK <> :purgeClaimed` na própria escrita OCC — torna as
   duas transações mutuamente exclusivas por construção (prova completa nas Rodadas 5-6).
4. **Sem lifecycle S3 incondicional** (removido após achado real da Rodada 1 — um
   `expiration.days` de bucket inteiro destruiria documentos ativos, já que o prazo de negócio é
   variável desde um evento posterior à criação, não a própria criação). Rede de segurança:
   alarme CloudWatch sobre idade do candidato mais antigo em `PENDING`/`CLAIMED` (duas séries) +
   alarme dedicado `document_purge_stuck_total`.
5. **`purgeAfterTtl`** (TTL nativo já habilitado na tabela) **nunca é populado por `Document`**
   nesta decisão — colidiria com o próprio mecanismo primário (achado real da Rodada 2).
6. **`DocumentPurgeReceipt`** novo, não sensível: `retentionClass: "DELIVERY_RECORD"`,
   `purgeAfter = purgedAt + 180 dias`, ganha seu próprio ponteiro GSI6 na mesma transação que o
   cria — autopurgado pelo mesmíssimo worker (branch por `entityType`).
7. **`buildVersionedUpdate` (`occ.ts`) ganha `extraConditions?: Array<{ expression, names?, values? }>`**
   — extensão aditiva, com checagem de colisão de placeholder (nunca reusar `:now`/`#version`/etc,
   lançar erro descritivo se colidir).
8. **IAM**: `DocumentPurgeWorker` é a **quarta** role com `gsi6_read_policy_json` (atualizar todos
   os comentários "EXACTLY THREE" para "EXACTLY FOUR" em `main.tf`/`dynamo-table/main.tf`);
   `dynamodb:TransactWriteItems` na tabela base (nunca no índice); `s3:DeleteObjectVersion`
   (nunca `DeleteObject`/`GetObject`) nos buckets `clean`+`quarantine`, escopado só a esta role.

## Escopo explicitamente fora desta decisão (W3-07 e além)

- Cascata de deleção DSR completa (`DataSubjectRequest` state machine, export, rotas HTTP) —
  W3-07 é feature de produto maior, fora de escopo aqui (D-059 já registrava isso).
- Generalização do par GSI6/worker para `entityType` arbitrário além de
  `Document`/`DocumentPurgeReceipt` — W3-07 decide isso quando tiver requisitos reais.
- Workflow completo de aprovação/`reviewAt` de `legalHold` (`privacy-lgpd.md` §3) — só o campo
  booleano e a condição de exclusão mútua nascem aqui; setter real é trabalho futuro.
- Rota HTTP de reversão manual de `purgeStatus: "STUCK"` — reversão inicial é operação manual
  direta na tabela (break-glass), mesma disciplina de qualquer intervenção administrativa hoje.

## Próximo passo

Implementação seguindo o mesmo rigor de evidência real (Camada 3 quando aplicável) usado na
Wave 2 — ver checklist de implementação no handoff da sessão.
