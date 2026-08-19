# Cost Model — Claude, Rodada 1 (Proposta Independente)

Status: proposta independente do Claude, antes de ver a do Codex.
Base: `docs/architecture/capacity-model.md` (volumes por estágio), `docs/architecture/architecture-fase3-consolidada.md` (serviços escolhidos). Seção 36 do prompt mestre. Preços de referência AWS us-east-1, ordem de grandeza (não cotação exata — sujeita a mudança).

## Metodologia
Custo por estágio = soma de (volume do `capacity-model.md` × preço unitário do serviço). Valores são **estimativas de ordem de grandeza**, não orçamento contratual — objetivo é validar COST-001 (idle≈0) e identificar os maiores drivers, não prever a fatura exata.

## Componentes de custo por serviço
| Serviço | Unidade de cobrança | Preço aproximado (us-east-1) |
|---|---|---|
| Lambda | requests + GB-s | $0,20/1M req + $0,0000166667/GB-s |
| API Gateway HTTP API | requests | $1,00/1M req |
| DynamoDB on-demand | RCU/WCU + storage | ~$0,25/1M WRU, ~$0,05/1M RRU, $0,25/GB-mês |
| S3 Standard | storage + requests | $0,023/GB-mês + $0,005/1K PUT |
| SQS | requests | $0,40/1M req |
| SES | e-mails enviados | $0,10/1K e-mails |
| Textract | páginas processadas | ~$1,50/1K páginas (forms) |
| Bedrock (modelo a definir) | tokens | variável por modelo, ordem de $0,003–0,015/1K tokens |
| Step Functions Standard | transições de estado | $0,025/1K transições |
| CloudWatch | logs/métricas | ~$0,50/GB ingestão de logs |
| GuardDuty Malware Protection | GB escaneado | ~$0,12/GB |

## Custo estimado por estágio
| Stage | Usuários | Custo mensal estimado | Principal driver |
|---|---|---|---|
| 0 (dev) | ≤5 | < $5 | Praticamente zero — free tier cobre a maior parte |
| 1 | 100 | ~$10–20 | Textract/Bedrock (poucas chamadas, mas preço unitário alto) |
| 2 | 1.000 | ~$50–100 | DynamoDB + Textract/Bedrock |
| 3 | 10.000 | ~$400–700 | Textract/Bedrock + SES/WhatsApp |
| 4 | 100.000 | ~$4.000–7.000 | WhatsApp (se BSP cobrar por conversa) + Textract/Bedrock + logs |
| 5 | 1.000.000 | ~$40.000–70.000 | WhatsApp + Bedrock + storage + logs |

**Nota de honestidade**: os números do Stage 4–5 têm incerteza alta (fator 2x+) porque dependem de duas variáveis não decididas: preço do BSP de WhatsApp (UNK-003) e modelo Bedrock exato (item aberto #7 da Fase 3). Estimativa aqui é para validar ordem de grandeza (dezenas de milhares, não milhões), não para orçamento.

## Top 5 cost drivers (identificação, seção 36 exige explicitamente)
1. **WhatsApp** (a partir do Stage 3) — se cobrado por conversa/mensagem, cresce linearmente com base de usuários ativos no canal; maior incerteza do modelo.
2. **Bedrock (LLM)** — cresce com volume de documentos que exigem fallback de LLM (60% dos uploads, `capacity-model.md`); mitigável reduzindo essa fração com parser determinístico melhor.
3. **Textract (OCR)** — cresce linearmente com uploads totais; menos otimizável (praticamente todo upload passa por OCR).
4. **Logs/CloudWatch** — cresce com volume de requests/eventos; mitigável com amostragem de logs em alta escala (já sinalizado em `capacity-model.md`).
5. **DynamoDB** — cresce com itens ativos, mas é o mais previsível/barato proporcionalmente (pay-per-request bem alinhado ao uso real).

## Custo por unidade de negócio (COST-002)
| Métrica | Estimativa (Stage 3, ordem de grandeza) |
|---|---|
| Custo/usuário/mês | ~$0,05 |
| Custo/documento processado | ~$0,003 (Textract) + ~$0,01–0,05 (Bedrock, se aplicável) |
| Custo/notificação | ~$0,0001 (e-mail/Telegram) a ~$0,01–0,05 (WhatsApp, estimado) |

## Validação de COST-001 (idle≈0)
Confirmado pela arquitetura já aprovada: nenhum componente do Stage 0–1 tem custo fixo por capacidade provisionada — Lambda, DynamoDB on-demand, S3, SQS são 100% pay-per-use. Custo do Stage 0 é dominado por free tier, validando a meta.

## Lacunas conscientes (para debate com o Codex)
1. Não pesquisei preços reais e atuais de WhatsApp Business API (BSP) — usei um placeholder qualitativo ("se cobrado por conversa"), não um número. Isso é a maior fonte de incerteza do documento inteiro.
2. Não modelei custo de transferência de dados (data transfer out) explicitamente — pode ser não-trivial em Stage 4-5 com volume alto de download de documentos.
3. Não apliquei desconto de Savings Plans/Reserved Capacity — irrelevante para serviços pay-per-use como os escolhidos, mas vale confirmar que nenhum componente da arquitetura se beneficiaria disso a ponto de mudar a decisão.
