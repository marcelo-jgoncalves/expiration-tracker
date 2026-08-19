# Quality Criteria — Plataforma de Controle de Vencimentos

Status: consenso Claude ↔ Codex após 3 rodadas (Fase 0). Ver histórico completo em `claude-quality-criteria-proposal.md`, `codex-quality-criteria-proposal.md`, `round2-claude-critique.md`, `round3-treplica.md`.

## Fontes
AWS Well-Architected Framework (6 pilares), AWS Serverless Applications Lens, FinOps Foundation Framework, OWASP Top 10/ASVS, NIST CSF 2.0, NIST Privacy Framework, LGPD (Lei 13.709/2018), orientações da ANPD.

## Tabela final de critérios

| Critério | Peso | Métrica / Threshold | Gate |
|---|---:|---|:---:|
| Segurança | 15% | Threat model coberto; sem finding crítico OWASP aberto; secrets em KMS/Secrets Manager; criptografia em trânsito e repouso; IAM mínimo privilégio | **SIM** — nota < 7.0 reprova |
| Privacidade / LGPD | 14% | Mapa de dados pessoais completo; base legal definida; minimização; retenção/exclusão implementáveis; direitos do titular; fornecedores/subprocessadores mapeados | **SIM** — nota < 7.0 reprova |
| Correção / Confiabilidade dos Vencimentos | 14% | Nenhum vencimento crítico perdido silenciosamente; idempotência em scheduler/filas/consumidores; reconciliação periódica; retries + DLQ com alarme e redrive; testes dos fluxos críticos ≥ 90% | **SIM** — nota < 7.0 reprova |
| Custo / FinOps | 10% | Cost model com 6 estágios; custo idle ≈ 0 no Stage 0-1; custo por tenant/documento/notificação mensurável; alarmes em 80%/100% do orçamento | Não (mas Abuso Econômico, abaixo, funciona como pré-condição obrigatória) |
| Operabilidade / Observabilidade | 8% | Logs estruturados sem conteúdo sensível; métricas; tracing quando agregar valor; correlation ID end-to-end; dashboards; alarmes por SLO; runbooks dos fluxos críticos | Não |
| Simplicidade / Anti-overengineering | 7% | Nº de serviços gerenciados justificável; fluxo principal compreensível ponta a ponta; ausência de K8s/microsserviços/event sourcing prematuros | Não |
| Manutenibilidade / Evolutividade | 7% | IaC 100%; CI/CD com plan/apply controlado; contratos versionados; ADRs com Type 1/Type 2 registrado; testes automatizados | Não |
| Escalabilidade / Elasticidade | 6% | Capacity model até 1M usuários sem redesenho estrutural; filas absorvem picos; sem gargalo único; limites AWS conhecidos e monitorados | Não |
| Governança de Confiança de IA / Qualidade OCR | 6% | **Gate de design (S/N dentro do critério):** confirmação humana obrigatória e fail-closed quando confidence < threshold antes de criar/alterar vencimento. Métrica contínua: precisão/recall por tipo documental, calibração de confiança | Gate de design condicional (não gate de nota) |
| Isolamento Multi-tenant (readiness → gate condicional) | 5% | Enquanto single-tenant: autorização/chaves/índices desenhados para isolamento futuro sem redesenho. **Vira gate pleno automaticamente** no primeiro estágio com dados de tenants distintos compartilhando infraestrutura lógica | Condicional por estágio |
| Abuso / Cost-attack Resistance | 5% | Quotas, rate limiting, limites de tamanho/concorrência, AWS Budgets + anomaly detection, kill switch — pré-condições obrigatórias independente da nota | Requisito obrigatório (não-negociável), não gate formal |
| Extensibilidade (canais, LLM, providers) | 3% | Channel Adapter e LLM Provider comprovadamente substituíveis (troca de provider não exige mudança de domínio) | Não |
| **Total** | **100%** | | |

## Regra de composição do Overall
```
Overall = Σ (peso_i × nota_i), escala 0.0–10.0
SE Segurança < 7.0 OU Privacidade < 7.0 OU Correção/Confiabilidade < 7.0
  ENTÃO status = NOT APPROVED, independente do Overall ponderado
SE requisitos obrigatórios de Abuso Econômico ausentes (quotas/budgets/kill switch)
  ENTÃO status = NOT APPROVED
SE Governança de Confiança de IA (fail-closed) ausente E IA cria/altera vencimento automaticamente
  ENTÃO status = NOT APPROVED
```

## Histórico resumido do debate (3 rodadas)
- **Rodada 1** — propostas independentes. Claude: 11 critérios, 3 gates (Security/Privacy/Cost). Codex: 12 critérios, 5 gates (Security/Privacy/Correção/Multi-tenant/Abuso).
- **Rodada 2** — réplica cruzada. Claude criticou excesso de gates do Codex e prematuridade do gate multi-tenant; Codex criticou Reliability genérico demais no Claude e diluição de OCR/IA em Extensibility.
- **Rodada 3** — tréplica e consenso. Codex recuou de 5→3 gates (trocando Cost e Multi-tenant/Abuso por Correção/Confiabilidade); Claude incorporou Correção como critério próprio, custo por unidade, e gate condicional por estágio para Multi-tenant. Convergência total nos demais pontos.

## Divergências mantidas explicitamente (nenhuma)
Todas as divergências relevantes da Rodada 1 foram resolvidas por consenso na Rodada 3 (ver `round3-treplica.md` para a tabela completa de resolução).
