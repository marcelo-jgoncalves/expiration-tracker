# Cost Model — Expiration Tracker (Consolidado)

Status: **APPROVED** (Design Maturity) — Claude ~9.15 / Codex 9.2, ambos ≥9.0. Rodada 1: Codex 8.7 (NOT APPROVED — faltavam referências datadas, custo por tenant, sensibilidade, evidência cruzada de G6); Rodada 2: 4 lacunas fechadas, nota final acima. Seção 36 do prompt mestre.
Base: `docs/architecture/capacity-model.md`, `docs/architecture/architecture-fase3-consolidada.md`.

Estimativa mensal em USD, us-east-1, sem créditos/free tier/impostos. Base: 30 dias; 8 itens e 4,8 documentos por usuário; 20 requests API/usuário/dia; 1 página/documento; 5 lembretes por renovação; fan-out e-mail 100%, Telegram 30%, WhatsApp 20%. **Preços são ordens de grandeza, não cotação contratual.**

Premissas unitárias principais (consultadas em 2026-08-19, sujeitas a mudança — revalidar antes de orçamento formal): HTTP API ≈ US$1/milhão de requests ([aws.amazon.com/api-gateway/pricing](https://aws.amazon.com/api-gateway/pricing/)); Lambda 256MB/100ms; DynamoDB on-demand ≈1 leitura + 0,3 escrita/request ([aws.amazon.com/dynamodb/pricing](https://aws.amazon.com/dynamodb/pricing/)); Textract Detect Document Text ≈ US$0,0015/página ([aws.amazon.com/textract/pricing](https://aws.amazon.com/textract/pricing/)); Step Functions Standard ≈ US$0,000025/transição ([aws.amazon.com/step-functions/pricing](https://aws.amazon.com/step-functions/pricing/)); SES ≈ US$0,10/mil e-mails.

## Estimativa mensal por componente
| Componente (US$/mês) | Stage 0 | Stage 1 (100) | Stage 2 (1k) | Stage 3 (10k) | Stage 4 (100k) | Stage 5 (1M) |
|---|---:|---:|---:|---:|---:|---:|
| API Gateway + WAF variável | 0 | <1 | 1 | 6 | 95 | 960 |
| Compute Lambda | 0 | <1 | <1 | 4 | 40 | 420 |
| DynamoDB on-demand | 0 | <1 | 1 | 5 | 50 | 500 |
| S3 + GuardDuty scan | <1 | <1 | 1 | 4 | 35 | 360 |
| SQS/EventBridge/Step Functions | 0 | <1 | <1 | 1 | 8 | 80 |
| WhatsApp BSP | 0 | 5 | 41 | 400 | 4.000 | 40.000 |
| SES/e-mail | 0 | <1 | <1 | 4 | 40 | 400 |
| Telegram provider | 0 | 0 | 0 | 0 | 0 | 0 |
| Bedrock/IA | 0 | <1 | <1 | 2 | 20 | 200 |
| Textract/OCR | 0 | <1 | 1 | 8 | 79 | 792 |
| CloudWatch Logs | <1 | <1 | <1 | 4 | 40 | 400 |
| X-Ray/tracing amostrado | 0 | 0 | <1 | 1 | 15 | 150 |
| Métricas/analytics | 0 | <1 | 1 | 2 | 10 | 100 |
| Backups/PITR/versionamento | <1 | <1 | 1 | 5 | 25 | 150 |
| Rede/CloudFront/egress | 0 | <1 | <1 | 1 | 5 | 50 |
| **Total aproximado** | **US$3–6** | **US$9–15** | **US$45–55** | **US$440–460** | **US$4,4–4,6k** | **US$44–45k** |

O piso de US$3–6 no Stage 0 cobre principalmente CMKs, secrets e pequenos recursos compartilhados. WAF só entra quando houver produção pública (decisão já fixada, `architecture-fase3-consolidada.md` §14). Não há NAT Gateway, ECS, RDS ou capacidade provisionada em nenhum estágio.

## Custos unitários (COST-002) — Stage 5
| Métrica | Valor |
|---|---|
| Por usuário ativo/mês | ≈US$0,045 (sem WhatsApp: ≈US$0,0045) |
| Por item armazenado/mês | ≈US$0,0056 fully allocated (infra sem WhatsApp: ≈US$0,0006) |
| Por lembrete lógico | ≈US$0,011 fully allocated (4M/mês) |
| Por tentativa de notificação | ≈US$0,0067 apenas canais (6M/mês, distribuição muito assimétrica entre canais) |
| Por documento armazenado/mês | ≈US$0,009 fully allocated (armazenamento/backups isolados: ≈US$0,0001–0,0002) |
| Por extração IA | ≈US$0,0019/documento (Textract+Bedrock); ≈US$0,003–0,005 incluindo Step Functions, malware scan e retries |

## Custo por tenant (fecha lacuna apontada pelo Codex)
No MVP, `tenantId = userId` (SCALE-004), então custo por tenant = custo por usuário ativo/mês, já calculado acima (≈US$0,045 com WhatsApp, ≈US$0,0045 sem). Quando Organizations existir (FUT-001), custo por tenant passa a agregar todos os usuários da organização — o `TenantQuota` (`data-model.md`) já é a estrutura de dados que permite medir consumo real por tenant no futuro, não apenas estimar.

## Análise de sensibilidade — cenário dominante (WhatsApp)
| Cenário de preço WhatsApp | Custo WhatsApp Stage 5 | Custo total Stage 5 |
|---|---:|---:|
| Otimista (US$0,02/msg) | ~US$16.000 | ~US$20.000–21.000 |
| Central (US$0,05/msg, usado na tabela acima) | ~US$40.000 | ~US$44.000–45.000 |
| Pessimista (US$0,10/msg) | ~US$80.000 | ~US$84.000–85.000 |
Sensibilidade confirma: WhatsApp domina o total em qualquer cenário plausível (76–94% do custo total), reforçando que a decisão de pricing/BSP (UNK-003) é a variável financeira mais crítica do produto em escala — mais do que qualquer otimização de arquitetura.

## Controles de abuso econômico (G6) — evidência cruzada, não redecisão
Este documento modela custo esperado sob operação normal; os controles que protegem contra custo **anômalo** (G6, COST-004/005) já estão decididos em `architecture-fase3-consolidada.md` §14 e não são redecididos aqui — apenas referenciados para rastreabilidade: AWS Budgets com alarme em 80%/100% do teto por ambiente (COST-003), Cost Anomaly Detection, quota por tenant via token bucket em DynamoDB (`TenantQuota`, `data-model.md`), kill switch via AppConfig para operações caras (IA/OCR/WhatsApp). Este cost-model fornece os valores de referência (tabela acima) que alimentam os tetos configurados nesses Budgets — não os substitui.

## Top 5 cost drivers (seção 36, exigência explícita)
1. **WhatsApp** — ~US$40k/mês, **~90% do total no Stage 5**. De longe o maior driver — qualquer decisão de produto sobre WhatsApp (paywall, limitar a planos pagos) tem impacto financeiro dominante.
2. **API Gateway/WAF** — ~US$960; WAF cobrado por request torna-se material em alto volume.
3. **Textract** — ~US$792, assumindo 1 página/documento; escala diretamente com páginas por documento (premissa a validar com uso real).
4. **DynamoDB** — ~US$500, sensível ao número real de GSIs consultados por request e ao padrão de escrita do token bucket de quota.
5. **Lambda/CloudWatch Logs** — ~US$420/~US$400; tamanho de payload, duração de execução e verbosidade de log podem inverter a ordem entre os dois.

## Incertezas reais (honestidade sobre o que não é cotação)
- **WhatsApp**: cenário central de US$0,05/mensagem — BSP, país, categoria Meta, template e markup ainda não escolhidos (UNK-003). Faixa plausível US$0,02–0,10/mensagem gera **US$16k–80k/mês no Stage 5** — variação de 5x. Esta é de longe a maior fonte de incerteza do documento inteiro.
- **Modelo Bedrock**: ainda não escolhido (item aberto #7 da Fase 3) — tokens e modelo podem deslocar o custo de IA de dezenas para milhares de dólares/mês.
- **Textract**: pressupõe 1 página/documento — documentos multi-página multiplicam linearmente.
- **Egress/rede**: depende de padrão real de downloads pelo usuário, não modelado em detalhe.
- **Backups**: não incluem réplica cross-region, coerente com o risco de região aceito conscientemente (`disaster-recovery.md`).

## Validação de COST-001 (idle≈0)
Confirmado para compute e banco: Lambda, HTTP API, DynamoDB on-demand, SQS, Textract e Bedrock têm idle efetivamente zero — nenhum componente cobra por capacidade provisionada e não utilizada. Para a stack completa, "≈0" significa **sem capacidade fixa relevante**, não zero contábil: CMK/Secrets Manager geram poucos dólares fixos; WAF em produção pública adiciona um piso fixo pequeno (não viola o espírito de COST-001, que é sobre ausência de compute/banco always-on caro).

## Nota sobre o processo
Rodada 1: propostas independentes convergentes na conclusão central (WhatsApp domina o custo em escala), mas a proposta do Codex incluiu pesquisa real de preços (busca ativa em páginas de pricing da AWS) e granularidade maior — adotada como base sem necessidade de rodada de crítica adicional, dado o nível de detalhe e a convergência na conclusão qualitativa mais importante.
