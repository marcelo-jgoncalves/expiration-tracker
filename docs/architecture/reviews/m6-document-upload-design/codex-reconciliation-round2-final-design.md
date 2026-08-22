---
status: approved
owner: engineering
authority: design
---

# Reconciliação Codex — rodada 2 (desenho final) — M6 runtime design (Document upload e malware boundary)

Convergência Claude↔Codex sobre o runtime real de M6 (renumerado do M5 original do blueprint,
D-032). Claude propôs a tradução Terraform/Lambda do design já aprovado em
`implementation-blueprint.md` §12 (round1); Codex propôs o mesmo com achados reais adicionais —
race condition real entre `UploadFinalizerWorker`/GuardDuty não explicitada no blueprint,
idempotência por `bucket/key/versionId` (não só `objectKey`), risco real de versão do provider
Terraform para `aws_guardduty_malware_protection_plan`, e a mesma classe de bug de log group já
encontrada nesta sessão (round1, nota cega). Claude aceitou como base (round2 crítica, 9.4/10),
pedindo 1 ajuste: variável `malware_protection_enabled` (decisão real do usuário — custo
recorrente do GuardDuty em produção, ~US$250/mês estimado em Stage 5, quer poder testar e
desligar em `dev`). Codex concordou e produziu este desenho final reconciliado — **9.6/10**,
Claude concorda que atinge o gate.

## Escopo (M6 = blueprint M5 original: upload+quarentena+malware, não extração/M7)

Ver `implementation-blueprint.md` §12.1-12.4/12.6-12.7 para o design conceitual já aprovado
(não reaberto aqui). Este documento define como implementar isso de verdade.

## Decisões-chave do runtime

1. **Identidade imutável de objeto**: sempre `bucket + key + versionId`, nunca `objectKey`
   sozinho (bug real do meu round1 corrigido pelo Codex).
2. **Evidências independentes + `advanceAfterEvidence()`**: `UploadFinalizerWorker` e
   `MalwareResultWorker` persistem evidência própria (upload válido / resultado de malware) sem
   presumir ordem de chegada; uma função pura decide a transição só quando ambas existirem.
   Fecha uma race condition real não explicitada no blueprint original.
3. **5 handlers Lambda** (não 4 — o parser PDF é uma fronteira própria): `documents-handler`
   (HTTP), `upload-finalizer-handler` (S3 event→SQS), `malware-result-handler`
   (GuardDuty→EventBridge→SQS), `upload-slot-reconciliation-handler` (EventBridge Scheduler),
   `parser-sandbox-handler` (invocado pelo finalizer, sem VPC/DynamoDB/bucket limpo).
4. **3 módulos Terraform novos**: `document-buckets` (2 buckets, SSE-KMS, versionamento,
   lifecycle 24h de quarentena), `document-malware-protection` (GuardDuty plan + EventBridge +
   fila, com o toggle), `document-observability` (alarmes reais no `alert-topic` existente).
5. **Toggle `malware_protection_enabled`** (bool, default `true`): recursos exclusivos do
   GuardDuty usam `count = var.malware_protection_enabled ? 1 : 0`; validação raiz **fail-closed
   força `true` em produção** (`var.environment != "prod" || var.malware_protection_enabled`).
   Com `false`: upload/quarentena/parsing continuam funcionando, mas nenhuma evidência de
   malware é gerada — documentos ficam permanentemente em `SCANNING`, nunca promovidos a
   `CLEAN` organicamente. Sem bypass, sem timeout que promova sozinho. Aceitável só em ambiente
   sem uso real de upload (hoje, `dev`).
6. **Achado estrutural real, corrigido de brinde**: `infra/modules/lambda-function` passa a criar
   `aws_cloudwatch_log_group` explicitamente para toda função (não só as novas) — mesma classe
   de bug real já encontrada no deploy da trilha de auditoria de segurança
   (`items-handler`/`reminders-handler` sem log group na primeira vez que um metric filter
   tentou anexar).
7. **Limite de upload fechado**: 10 MiB (a `capacity-model.md` marcava isso como ASSUMPTION
   nunca formalmente decidida — fechado nesta rodada).
8. **Retenção nas entidades**: `Document`/`UploadSlot` nascem com `retentionClass`/`purgeAfter`
   desde o início, conectando `privacy-lgpd.md` §4 ao schema real.

## Arquivos (lista completa — ver texto integral da reconciliação para os ~35 arquivos TS + 15
## módulos/arquivos Terraform + ~17 arquivos de teste)

Resumo por camada: `src/modules/document/{domain,application,ports,persistence,http}` (~16
arquivos), `src/workers/{upload-finalizer,malware-result,upload-slot-reconciliation,
parser-sandbox}` (4), `src/runtime/aws/{composition,handlers}` (6), 3 módulos Terraform novos
(15 arquivos incl. testes), schemas novos (6-8 arquivos), suíte de testes (~15 arquivos novos +
extensões em `schemas.test.ts`/`build-lambdas-export-shape.test.ts`).

## Critérios de aceitação (28 itens — resumo)

Atomicidade/idempotência da reserva; upload só na quarentena; keys sem PII; limites de tamanho
(10MB)/PDF (50 páginas/25MB/512MB/30s) respeitados; identidade por versionId em todo evento;
as duas ordens de corrida (upload→malware, malware→upload) convergem ao mesmo resultado;
ausência/falha de scan nunca produz CLEAN; cópia confirmada antes da transição; redelivery não
duplica nada; exclusão idempotente e tenant-safe; buckets privados/versionados/KMS; nenhum
handler de negócio lê quarentena/limpo; log groups existem antes de qualquer metric filter;
toggle remove só o ingresso GuardDuty sem quebrar plan/apply; produção rejeita toggle=false;
com toggle=false documentos ficam em SCANNING sem bypass; provider Terraform fixado em versão
compatível confirmada; suíte completa (unit/contrato/integração/DynamoDB/Terraform) verde;
exercício real de Camada 3 com arquivo limpo E EICAR real contra GuardDuty real, limpeza
comprovada ao final.

## Notas finais

Codex: **9.6/10**, atinge o gate. Claude: concorda, **9.4/10** (nenhum gap real restante após o
ajuste do toggle). Convergido, aprovado para implementação.
