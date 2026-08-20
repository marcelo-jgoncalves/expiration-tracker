# Disaster Recovery — Expiration Tracker (Consolidado)

Status: **APPROVED** (Design Maturity) — Claude ~9.10 / Codex 9.1 (exato 9.051), ambos ≥9.0, nenhum gate violado.

## Resultado da avaliação
Rodada 1: propostas independentes convergentes; proposta do Codex mais rigorosa (fontes oficiais, prazo LGPD correto de 3 dias úteis conforme ANPD) adotada como base. Rodada 2: Codex concordou com os 2 pontos abertos do Claude e propôs mecanismos concretos — reparo seletivo por tenant/entidade para corrupção tardia (em vez de rollback total da tabela), e matriz `retentionClass`/`legalHold` para decidir backup cross-region de S3 por classe de documento (não herdando automaticamente a política do DynamoDB). Ambos incorporados. Nota: **Codex 9.1 (exato 9.051) / Claude ~9.10**. **STATUS: APPROVED.**
Base: `docs/architecture/history/disaster-recovery/disaster-recovery-claude-round1.md`, `docs/architecture/history/disaster-recovery/disaster-recovery-codex-round1.md`, `docs/architecture/architecture-fase3-consolidada.md`, `docs/architecture/slo.md`, `docs/architecture/data-model.md`. Seção 43 do prompt mestre.

## Histórico do debate
- **Rodada 1** — propostas independentes. Convergência forte em princípio (RPO≤5min/RTO≤4h já fixados, risco de região aceito conscientemente) e nos itens que precisavam ser fechados (teste de restore real, runbook de credencial comprometida, critério de saída Stage 5). A proposta do Codex era substancialmente mais rigorosa — adotada como base: RTO decomposto por componente (não um único número agregado), procedimento de restore com passos concretos e validação de invariantes específicas do domínio (outbox/inbox/idempotência), tratamento explícito de órfãos entre buckets `quarantine`/`clean`, estrutura de incident response com papéis nomeados (Incident Commander/Segurança/DPO), e **prazo correto de notificação à ANPD (3 dias úteis, conforme orientação oficial)** — o Claude havia proposto "2 dias úteis" sem fonte, corrigido pela pesquisa do Codex.

---

## 1. Escopo e premissas
Para Stage 0–2: **RPO ≤5min e RTO ≤4h para falhas recuperáveis dentro da região**. Falha total de região **não é coberta** — risco conscientemente aceito até Stage 3 ou até existir cliente com SLA contratual, o que ocorrer primeiro (Red Team cenário 17). Multi-region só após esse gatilho e análise de custo/complexidade/consistência — **nunca por prestígio** (seção 43, explícito).

## 2. Objetivos por componente
| Componente | RPO | RTO | Recuperação |
|---|---:|---:|---|
| DynamoDB | ≤5min | ≤2h | PITR contínuo; restore para tabela nova |
| S3 quarantine/clean | ≤5min | ≤3h | Versioning + AWS Backup contínuo/PITR |
| IaC (Terraform, ADR-0009), Lambdas, API, filas, alarmes | último commit aprovado em `main` | ≤2h | `terraform apply` via pipeline CD (`.github/workflows/cd.yml`) a partir da tag/commit aprovado — nunca `apply` local (regra da pipeline) |
| SQS/EventBridge/Streams | reconstruível | ≤4h | Terraform (via pipeline) + replay de outbox/reconciliação |
| Cognito | config: zero; credenciais: sem garantia | ≤4h | Recriar configuração; reset/reconvite se necessário |
| Providers externos | estado local ≤5min | ≤4h degradado | Kill-switch, retenção de trabalho, rotação de credenciais |

Backup Vault, KMS, políticas e role de restore são IaC — a aplicação não pode excluir recovery points. Alarmes detectam PITR/Versioning/integração EventBridge desabilitados, backup sem recovery point saudável, estado STOPPED.

## 3. DynamoDB
PITR habilitado, retenção 35 dias (`infra-terraform/modules/dynamo-table/main.tf`, ver comentário do módulo). Incident Commander fixa `T0` (último instante sabidamente íntegro), interrompe writers/consumidores. Restore cria tabela nova (comportamento nativo do DynamoDB); a pipeline Terraform (ADR-0009, `.github/workflows/cd.yml` — nunca `apply` local) reaplica TTL/Streams/alarmes/tags/integrações (não restaurados como dados). Antes do corte: validar contagens por `entityType`, amostras com hash, GSIs ativos, TTL, isolamento por `tenantId` (`data-model.md`); verificar invariantes de outbox/inbox/idempotência/ocorrências; apontar parâmetro versionado para a nova tabela; smoke test + reabertura em canário; reconciliar registros `PENDING` e o intervalo `T0`–retomada com idempotência. Tabela anterior fica somente-leitura até o encerramento do incidente.

**Nota de ferramenta (achado corrigido em `full-audit-round1-operacoes-*`, 2026-08-20)**: este documento foi escrito quando a infraestrutura era CDK (`infra/lib/*.ts`); a partir de ADR-0009 o único caminho real de `apply` é a pipeline Terraform (`.github/workflows/cd.yml`) — `infra/lib/*.ts` permanece no repo apenas como referência histórica (`AGENTS.md` §4 do prompt do auditor a trata como "CDK antigo, ainda presente"). Qualquer redeploy/reconstrução deste runbook usa Terraform via pipeline, nunca CDK local nem `terraform apply` manual.

## 4. S3
Versioning cobre exclusão/sobrescrita pontual (já decidido, `architecture-fase3-consolidada.md` §7). Para corrupção ampla: AWS Backup contínuo/PITR, restaurar `quarantine` e `clean` em buckets novos, versionados e criptografados. **Nunca restaurar objetos de `quarantine` diretamente em `clean`** — viola o próprio propósito da quarentena de 2 buckets. Validar quantidade, bytes, checksums, leitura SSE-KMS, correspondência com `Document.objectKey/versionId/status`. Objetos sem registro DynamoDB tornam-se órfãos em quarentena (não promovidos); registros sem objeto correspondente ficam indisponíveis e geram reparo — **nunca marcados `CLEAN`** por omissão (mesma política fail-closed da decisão original de quarentena).

## 5. IaC e providers
Reconstruir de commit aprovado em `main` via `terraform plan`/`apply` **executado exclusivamente pela pipeline CD** (`.github/workflows/cd.yml`, ADR-0009) — nunca `apply` local, mesma regra que rege operação normal. Secrets nunca no Git — recriados/rotacionados no Secrets Manager. DNS/config só mudam após validação. Falha de provider aciona o kill-switch do canal correspondente (já decidido, ver `infra-terraform/modules/reminder-schedule/variables.tf` para o kill switch de schedule), mantém mensagens recuperáveis, encaminha para operação degradada/revisão humana. **SQS não é backup** — todo trabalho em fila deve ser reconstruível a partir do DynamoDB/outbox, nunca a fila como única fonte de verdade.

## 6. Teste real de restore — gate de produção
Executar antes do primeiro usuário externo, trimestralmente, e após mudanças relevantes de schema/backup/KMS/CDK:
1. Dataset sentinela multi-tenant em ambiente isolado (documentos nos 2 buckets, outbox `PENDING`, inbox, ocorrências) — registrar timestamp/hashes/contagens.
2. Alterar/excluir dados deliberadamente; escolher `T0` anterior à corrupção simulada.
3. Restaurar DynamoDB e ambos os buckets para nomes novos, usando apenas a role e o runbook de DR (não acesso administrativo genérico).
4. Reconstruir a infraestrutura a partir da tag aprovada.
5. Testes automatizados: hashes, GSIs, KMS, **isolamento negativo entre tenants** (SCALE-004), estados de documento, replay idempotente, reconciliação.
6. Publicar em canário sem providers reais primeiro; depois testar com providers em sandbox.
7. Medir RPO/RTO **observados** (não assumidos) e comparar contra as metas da seção 2.

**Critério de aprovação**: RPO≤5min, RTO≤4h, zero exposição cross-tenant, zero objeto de quarentena exposto, 100% das divergências classificadas (não apenas contadas). Falha em qualquer critério bloqueia produção e exige repetição integral do teste — não uma correção pontual seguida de aprovação condicional.

## 7. Runbook — credencial comprometida (Red Team cenário 16) + notificação LGPD
1. Declarar SEV-1; registrar horário de ciência; preservar CloudTrail e logs (nunca apagar evidências); nomear Incident Commander, responsável de Segurança e DPO.
2. Desabilitar a credencial, revogar sessões, bloquear principal/policy, pausar deploys, acionar o kill-switch correspondente se houver exposição de capacidade cara.
3. Rotacionar o segredo e dependências adjacentes; revisar IAM/OIDC/KMS grants/URLs presigned/credenciais de providers.
4. Delimitar período afetado, tenants impactados, dados pessoais envolvidos, titulares, evidência concreta de acesso ou exfiltração (não apenas possibilidade teórica).
5. Avisar clientes que sejam controladores de dados, conforme contrato (quando Organizations/B2B existir — FUT-001).
6. **Se houver risco ou dano relevante**: comunicar ANPD e titulares em até **3 dias úteis da ciência** (orientação oficial da ANPD), admitindo comunicação preliminar seguida de complementação. Se a decisão for não comunicar, registrar a justificativa formalmente (não silêncio).
7. Encerrar apenas após revogação comprovada, ausência de persistência do acesso indevido, SLOs restaurados, e post-mortem publicado como `AuditEvent` tipo `SECURITY_INCIDENT`.

## 8. Critério de saída da reconciliação Stage 5 (resposta à objeção do Codex em `slo.md`)
Antes de operar em Stage 5 (≥8M itens) em produção real: testar com volume equivalente, distribuição representativa de tenants/GSIs, sob carga online normal simultânea. Exigir **3 execuções consecutivas** (não uma única, para descartar sorte/variância) com: p95≤12h; ≥99,9% de ocorrências ausentes recriadas na mesma execução; zero violação de isolamento; nenhum throttling sustentado; nenhum SLO online degradado durante o teste; custo dentro do orçamento aprovado. Falha em qualquer critério **impede a entrada no Stage 5** — a resposta é otimizar segmentação/paralelismo do job ou revisar formalmente o SLO/capacity model, nunca promover com base apenas na estimativa original.

## Rodada 2 — resolução dos pontos abertos (reação do Codex)

**Corrupção detectada tardiamente**: PITR da tabela inteira é mecanismo de **extração**, não de rollback direto. Procedimento: restaurar `T0` em tabela temporária isolada; identificar o escopo afetado por `tenantId`, entidade, versão e intervalo de tempo; calcular diff contra a tabela ativa; aplicar reparação **seletiva** via job idempotente, com dry-run obrigatório, manifesto imutável do que será alterado, aprovação humana explícita, e trilha de auditoria completa. Escritas legítimas posteriores ao `T0` prevalecem, salvo campos comprovadamente corrompidos (identificados pelo diff). Cutover total da tabela fica reservado exclusivamente a corrupção sistêmica (não a corrupção localizada por tenant/entidade). **Pré-requisito de dados** (já satisfeito por `data-model.md`): `updatedAt`, `version` (optimistic concurrency), e `AuditEvent` suficiente para reconstrução do estado correto são o que torna esse reparo seletivo viável — não é um requisito novo de schema. O teste trimestral de restore (seção 6) passa a incluir esse cenário, verificando explicitamente **zero alteração em tenants-controle** (não afetados pela corrupção simulada).

**Backup cross-region de S3 por classe de documento**: a política **não herda automaticamente** a decisão do DynamoDB (risco de região aceito) — segue a classe do documento. Adicionada classificação `retentionClass`/`legalHold` (já existe como atributo comum em `data-model.md`, agora com uso concreto aqui): matriz baseada em obrigação legal, contrato e finalidade LGPD. Documentos de valor probatório (ex.: certidões, contratos com força legal) podem receber replicação cross-region ou AWS Backup copy, Object Lock em modo apropriado, retenção imutável e chave KMS independente — decisão de implementação por classe, pendente de mapeamento formal em `privacy-lgpd.md`. **Não habilitar indiscriminadamente**: metadados transacionais e a maioria dos documentos continuam sob o risco regional já aceito conscientemente; apenas classes com obrigação legal confirmada antecipam proteção cross-region. Ausência de requisito legal confirmado para um tipo de documento implica política padrão (sem cross-region), nunca retenção eterna por precaução.

Ambos os pontos são registrados como **lacunas materialmente relevantes mas fecháveis**, não bloqueantes para a aprovação deste checkpoint — a implementação concreta (o job de reparo seletivo, a matriz de `retentionClass`) é trabalho de fase de implementação, mas a política e o mecanismo já estão desenhados.
