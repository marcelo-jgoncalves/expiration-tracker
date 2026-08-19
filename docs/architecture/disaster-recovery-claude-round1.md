# Disaster Recovery — Claude, Rodada 1 (Proposta Independente)

Status: proposta independente do Claude, antes de ver a do Codex.
Base: `docs/architecture/architecture-fase3-consolidada.md` (RTO≤4h/RPO≤5min já fixados, Rodada 4; risco de falha de região aceito conscientemente, Red Team cenário 17), `docs/architecture/slo.md`, `docs/architecture/data-model.md`. Seção 43 do prompt mestre.

## Princípio
Não adotar multi-region por prestígio (seção 43, explícito). Formalizar o que já foi decidido implicitamente nas fases anteriores, fechar as lacunas registradas (teste de restore real, runbook de credencial comprometida, critério de saída de reconciliação Stage 5 apontado pelo Codex em `slo.md`), sem inflar escopo.

## 1. RPO/RTO — consolidação e formalização
| Componente | RPO | RTO | Origem |
|---|---|---|---|
| DynamoDB (dados transacionais) | ≤5min | ≤4h (Stage 0–2) | Já fixado, Fase 3 Rodada 4 |
| S3 (documentos) | ≤24h | ≤4h (Stage 0–2) | Já fixado, Fase 3 Rodada 4 |
| Falha de região inteira | **Sem RPO/RTO formal — risco aceito** | — | Red Team cenário 17; RPO/RTO acima cobrem falha *dentro* da região, não a região inteira |
| Gatilho de revisão | Primeiro cliente pagante com SLA contratual, ou entrada no Stage 3+ | | Já registrado no Red Team, formalizado aqui como parte do DR |

## 2. Backup e restore — mecanismo por componente
- **DynamoDB**: Point-in-Time Recovery (PITR) contínuo, retenção padrão de 35 dias. Restore cria uma **nova tabela** (comportamento nativo do DynamoDB) — implica troca de referência na aplicação (endpoint/nome da tabela), não um "restore in-place".
- **S3**: versionamento habilitado (já decidido, §7 da arquitetura) cobre recuperação de objeto individual corrompido/sobrescrito; não cobre exclusão do bucket inteiro — Object Lock não habilitado no MVP (decisão consciente já registrada, sem requisito legal de imutabilidade comprovado).
- **Configuração/infraestrutura**: 100% reproduzível via CDK (IaC, §12) — a "recuperação de infraestrutura" é, na prática, `cdk deploy` num ambiente novo a partir do repositório versionado, não um processo de backup separado.

## 3. Teste de restore (fecha o item aberto mais antigo do processo — desde a Fase 3)
**Decisão**: teste de restore de DynamoDB é um **gate obrigatório antes do primeiro deploy em produção** (não uma atividade contínua nesta fase de design) — trimestral a partir de então. Procedimento:
1. Restaurar PITR para uma tabela de teste num timestamp conhecido.
2. Validar integridade: contagem de itens por `entityType`, checksum de uma amostra de `ExpirationItem`/`Document` contra o estado esperado.
3. Validar reconciliação pós-restore: rodar o job de reconciliação (`slo.md` §5) contra a tabela restaurada e confirmar que não gera falsos positivos de "ocorrência ausente" (a lógica de reconciliação precisa saber que está rodando pós-restore, não em operação normal — flag explícita).
4. Documentar tempo real decorrido (para validar o RTO≤4h contra medição real, não suposição).

## 4. Runbook — credencial comprometida (Red Team cenário 16, lacuna registrada)
1. **Detecção**: CloudTrail + Cost Anomaly Detection + alarme de uso anômalo de IAM role (chamadas fora do padrão esperado da função).
2. **Contenção imediata**: revogar/rotacionar a credencial específica via Secrets Manager; se for uma IAM role (não um secret externo), anexar policy de deny explícito temporária.
3. **Escopo do dano**: consultar CloudTrail para todas as ações realizadas com a credencial no período suspeito.
4. **Kill switch**: se o comprometimento envolve capacidade de gerar custo (ex.: role com acesso a Bedrock/WhatsApp), acionar o kill switch correspondente (AppConfig, já decidido) imediatamente, antes mesmo de terminar a investigação.
5. **Notificação LGPD** (se dados pessoais expostos): avaliar em até 2 dias úteis se houve acesso/exfiltração de dados pessoais; se sim, processo de notificação à ANPD/titulares segue `privacy-lgpd.md` (a produzir) — este runbook aciona aquele processo, não o substitui.
6. **Pós-incidente**: rotação de credenciais adjacentes por precaução, revisão de por que a credencial vazou (commit acidental, log exposto, etc.), registrado como `AuditEvent` de tipo `SECURITY_INCIDENT`.

## 5. Critério de saída da reconciliação Stage 5 (fecha a objeção do Codex em `slo.md`)
Antes de o produto operar em Stage 5 (8M itens) em produção real, a janela de reconciliação de ≤12h deve ser validada por teste de carga contra volume equivalente, incluindo throttling e retries realistas — **não pode permanecer apenas estimativa** nesse ponto. Se o teste não demonstrar margem operacional, a alternativa é paralelismo maior no job de reconciliação (particionar por faixa de `tenantId` ou `dueDate`) — decisão de implementação, não de design conceitual, mas o **gate** (não avançar para Stage 5 sem essa validação) é registrado aqui.

## Lacunas conscientes (para debate com o Codex)
1. Não modelei um cenário de "corrupção de dados detectada tardiamente" (ex.: bug introduzido há semanas, só percebido agora) — PITR de 35 dias cobre isso até certo ponto, mas restaurar 35 dias atrás descartaria semanas de dados legítimos. Trade-off não resolvido aqui.
2. Backup cross-region para S3 não habilitado no MVP — consistente com o risco de região aceito, mas vale confirmar se o Codex concorda que isso é a mesma decisão ou se deveria ser tratado separadamente (documentos podem ter requisito legal diferente de dados transacionais).
