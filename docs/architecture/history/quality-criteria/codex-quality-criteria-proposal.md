> **Status: histórico/supersedido.** Artefato de rodada do processo Claude↔Codex; não é normativo. Documento sucessor: `../../quality-criteria.md`.

# CODEX PROPOSAL — Quality Criteria (Fase 0, Rodada 1)

Pesquisa independente produzida pelo Codex (CLI local, `codex exec`), sem acesso prévio à proposta do Claude — regra anti-anchoring aplicada.

## Tabela consolidada (pesos somam 100%)

| Critério | Peso % | Métrica/Threshold | Gate eliminatório |
|---|---:|---|:---:|
| Segurança | 14% | Gate A: criptografia em trânsito/repouso; IAM mínimo privilégio; gestão de segredos; sem vulnerabilidade crítica aberta | S |
| Privacidade/LGPD | 12% | Gate B: base legal, minimização, retenção/exclusão, direitos do titular, rastreabilidade e fornecedores mapeados | S |
| Correção/confiabilidade | 14% | Gate C: nenhum vencimento crítico perdido; idempotência; retries/DLQ; testes dos fluxos críticos ≥ 90% | S |
| Isolamento multi-tenant | 8% | Gate D: testes negativos de acesso cruzado aprovados; tenant obrigatório em autorização, dados e logs | S |
| Resistência a abuso econômico | 5% | Gate E: quotas, rate limits, limites de arquivo/OCR/IA e alertas de orçamento ativos | S |
| Custo | 10% | Custo unitário previsível; orçamento mensal respeitado; alarmes em 80%/100%; custo por tenant mensurável | N |
| Operabilidade/observabilidade | 8% | Logs estruturados, métricas, tracing, correlação, dashboards, alarmes, runbooks | N |
| Simplicidade | 7% | Menor número justificável de serviços/integrações; fluxo principal compreensível ponta a ponta | N |
| Manutenibilidade | 7% | IaC, CI/CD, testes automatizados, módulos coesos, contratos versionados, documentação operacional | N |
| Escalabilidade | 6% | Escala horizontal; filas absorvem picos; sem gargalo único; limites AWS conhecidos e monitorados | N |
| Qualidade OCR/IA | 7% | Precisão/recall por tipo documental; confiança calibrada; revisão humana abaixo do limiar; dataset de avaliação versionado | N |
| Disponibilidade/DR | 2% | RTO/RPO definidos; backup e restore testados; DLQ/reprocessamento; degradação controlada por canal | N |

Nota: Codex trata **5 critérios como gates simultâneos** (Segurança, Privacidade, Correção, Isolamento Multi-tenant, Abuso Econômico) — mais rigoroso que a proposta inicial do Claude, que só elegeu 3 gates (Security, Privacy, Cost).

## Pontos-chave da análise em prosa (resumo dos achados originais)
- **Gate C (Correção/confiabilidade)** é tratado como igualmente crítico a Segurança — argumento central: "o valor central do produto é evitar vencimentos; uma notificação silenciosamente perdida é pior que indisponibilidade momentânea do painel."
- **Gate D (Isolamento multi-tenant)** pode ficar "não aplicável" enquanto o produto for single-tenant, mas vira gate obrigatório assim que houver o primeiro ambiente compartilhado — sugestão de ativação condicional do gate por estágio.
- **Gate E (abuso econômico)** — serverless converte abuso diretamente em fatura; a ausência de quotas/rate limiting reprova a arquitetura mesmo com overall alto.
- Custo não é gate isolado (Codex diverge do Claude aqui) — argumento: custo é decisivo para sobrevivência, mas não deve superar segurança/confiabilidade na hierarquia, e um "gate" faria sentido apenas em conjunto com abuso econômico (que já é gate).
- Trade-offs relevantes levantados: serverless-first vs. previsibilidade de custo em escala; DynamoDB vs. Postgres gerenciado (decidir por access patterns, não por dogma "serverless-first"); "exactly-once" é promessa enganosa — objetivo correto é at-least-once + idempotência + reconciliação; confirmação humana no OCR deve ser assistida no onboarding e reduzida progressivamente com dados reais; isolamento lógico multi-tenant aceitável no início se autorização/chaves/testes forem sistemáticos; logs não devem conter conteúdo integral de documentos (custo + LGPD); multi-região ativo-ativo é excesso na fase inicial — backup verificável + IaC recriável é a prioridade real.
- Lacunas que a arquitetura sozinha não resolve: garantia de entrega dos canais (depende de políticas Meta/Telegram/reputação de domínio), definição jurídica de controlador/operador, qualidade real de documentos brasileiros (dataset), SLO por tipo de obrigação, política de retenção por categoria documental, plano de on-call, dependência de fornecedor (Textract/LLM/canais).
- Conclusão do Codex: reprovaria uma arquitetura com muitos serviços AWS "sofisticados" que não demonstrasse idempotência+reconciliação, isolamento verificável, retenção/exclusão LGPD, limites de gasto, rastreabilidade de OCR/IA, restore testado, custo unitário, e operabilidade por alguém além do autor. Espera uma arquitetura **menos distribuída** do que uma leitura superficial de "serverless-first" sugeriria.
