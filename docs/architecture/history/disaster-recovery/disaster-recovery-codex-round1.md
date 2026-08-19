> **Status: histórico/supersedido.** Artefato de rodada do processo Claude↔Codex; não é normativo. Documento sucessor: `../../disaster-recovery.md`.

# Disaster Recovery — Codex, Rodada 1 (Proposta Independente)

Status: proposta independente do Codex, sem acesso à proposta do Claude.
Base: `docs/architecture/architecture-fase3-consolidada.md`, `docs/architecture/slo.md`, `docs/architecture/data-model.md`.

## Escopo e premissas
Para Stage 0–2: **RPO ≤5min e RTO ≤4h para falhas recuperáveis dentro da região**. Falha total de região não é coberta — risco conscientemente aceito até Stage 3 ou até existir cliente com SLA contratual, o que ocorrer primeiro. Multi-region só após esse gatilho e análise de custo/complexidade/consistência — não por prestígio (seção 43).

## Objetivos por componente
| Componente | RPO | RTO | Recuperação |
|---|---:|---:|---|
| DynamoDB | ≤5min | ≤2h | PITR contínuo; restore para tabela nova |
| S3 quarantine/clean | ≤5min | ≤3h | Versioning + AWS Backup contínuo/PITR |
| CDK, Lambdas, API, Step Functions, filas, alarmes | último commit aprovado | ≤2h | Redeploy de tag imutável |
| SQS/EventBridge/Streams | reconstruível | ≤4h | CDK + replay de outbox/reconciliação |
| Cognito | config: zero; credenciais: sem garantia | ≤4h | Recriar configuração; reset/reconvite se necessário |
| Providers externos | estado local ≤5min | ≤4h degradado | Kill-switch, retenção de trabalho, rotação de credenciais |

Backup Vault, KMS, políticas e role de restore são IaC. Aplicação não pode excluir recovery points. Alarmes detectam PITR/Versioning/integração EventBridge desabilitados, backup sem recovery point saudável, estado STOPPED.

## DynamoDB
PITR habilitado, retenção 35 dias. Incident Commander fixa `T0` (último instante íntegro), interrompe writers/consumidores. Restore cria tabela nova (comportamento nativo); CDK reaplica TTL/Streams/alarmes/tags/integrações (não restaurados como dados). Antes do corte: validar contagens por tipo, amostras com hash, GSIs ativos, TTL, isolamento por tenantId; verificar invariantes de outbox/inbox/idempotência/ocorrências; apontar parâmetro versionado para nova tabela; smoke test + canário; reconciliar registros PENDING e o intervalo T0–retomada com idempotência. Tabela anterior fica somente-leitura até encerramento.

## S3
Versioning cobre exclusão/sobrescrita pontual. Para corrupção ampla: AWS Backup contínuo/PITR, restaurar quarantine e clean em buckets novos versionados/criptografados. **Nunca restaurar objetos de quarantine diretamente em clean.** Validar quantidade, bytes, checksums, leitura SSE-KMS, correspondência com `Document.objectKey/versionId/status`. Objetos sem registro DynamoDB tornam-se órfãos em quarentena; registros sem objeto ficam indisponíveis e geram reparo (nunca marcados CLEAN).

## IaC e providers
Reconstruir de tag aprovada via `cdk synth/diff/deploy`. Secrets não ficam no Git — recriados/rotacionados no Secrets Manager. DNS/config só mudam após validação. Falha de provider aciona kill-switch do canal, mantém mensagens recuperáveis, encaminha a operação degradada/revisão humana. SQS não é backup — trabalho deve ser reconstruível do DynamoDB/outbox.

## Teste real de restore — gate de produção
Antes do 1º usuário externo, trimestralmente, e após mudanças relevantes de schema/backup/KMS/CDK:
1. Dataset sentinela multi-tenant em ambiente isolado (documentos nos 2 buckets, outbox PENDING, inbox, ocorrências); registrar timestamp/hashes/contagens.
2. Alterar/excluir dados; escolher T0 anterior à corrupção.
3. Restaurar DynamoDB e ambos buckets para nomes novos, só com role e runbook de DR.
4. Reconstruir infraestrutura da tag aprovada.
5. Testes automatizados: hashes, GSIs, KMS, isolamento negativo entre tenants, estados de documento, replay idempotente, reconciliação.
6. Canário sem providers reais, depois sandbox.
7. Medir RPO/RTO observados.
Critério de aprovação: RPO≤5min, RTO≤4h, zero exposição cross-tenant, zero objeto de quarentena exposto, 100% das divergências classificadas. Falha bloqueia produção, exige repetição integral.

## Credencial comprometida e LGPD
1. Declarar SEV-1, registrar horário de ciência, preservar CloudTrail/logs, nomear Incident Commander/Segurança/DPO.
2. Desabilitar credencial, revogar sessões, bloquear principal/policy, pausar deploys, acionar kill-switch. Não apagar evidências.
3. Rotacionar segredo e dependências; revisar IAM/OIDC/KMS grants/presigned URLs/credenciais de providers.
4. Delimitar período, tenants, dados pessoais, titulares, evidência de acesso/exfiltração.
5. Avisar clientes controladores conforme contrato.
6. Se possível risco/dano relevante: comunicar ANPD e titulares em até **3 dias úteis da ciência** (orientação oficial ANPD), admitindo comunicação preliminar + complementação. Registrar decisão fundamentada caso opte por não comunicar.
7. Encerrar após revogação comprovada, ausência de persistência, SLOs restaurados, post-mortem.

## Critério de saída da reconciliação Stage 5
Testar com ≥8M itens, distribuição representativa de tenants/GSIs, carga online normal. Exigir 3 execuções consecutivas com: p95≤12h; ≥99,9% de ocorrências ausentes recriadas na mesma execução; zero violação de isolamento; nenhum throttling sustentado; nenhum SLO online degradado; custo dentro do orçamento aprovado. Falha impede entrada no Stage 5 — otimizar segmentação/paralelismo ou revisar formalmente SLO/capacity model; não promover com base só em estimativa.
