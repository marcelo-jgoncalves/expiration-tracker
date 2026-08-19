# CLAUDE PROPOSAL — Quality Criteria (Fase 0, Rodada 1)

Pesquisa independente, produzida ANTES de consultar a proposta do Codex.

## Fontes primárias consultadas
- AWS Well-Architected Framework — 6 pilares oficiais: Operational Excellence, Security, Reliability, Performance Efficiency, Cost Optimization, Sustainability. (docs.aws.amazon.com/wellarchitected)
- AWS Well-Architected Serverless Applications Lens (docs.aws.amazon.com/wellarchitected/latest/serverless-applications-lens)
- FinOps Foundation Framework — 6 princípios (colaboração, ownership descentralizado, time central, relatórios acessíveis/tempo real, decisões orientadas a valor de negócio, aproveitar custo variável da nuvem). (finops.org / flexera.com summary)
- OWASP Top 10 / OWASP ASVS (conhecimento consolidado — injection, broken access control, cryptographic failures, SSRF, supply chain).
- NIST SP 800-53 / NIST Privacy Framework (conhecimento consolidado — controles de segurança e privacidade por design).
- LGPD (Lei 13.709/2018) — princípios: finalidade, adequação, necessidade, livre acesso, qualidade dos dados, transparência, segurança, prevenção, não discriminação, responsabilização.

## Lista de critérios, pesos e métricas (proposta Claude)

| # | Critério | Peso | Métrica / Threshold | Gate eliminatório? |
|---|----------|------|----------------------|---------------------|
| 1 | Security | 15% | Threat model coberto; nenhum finding crítico OWASP aberto; secrets em KMS/Secrets Manager | SIM — Security < 7.0 rejeita |
| 2 | Privacy / LGPD | 15% | Mapa de dados pessoais completo; base legal definida; retenção/exclusão implementável | SIM — Privacy < 7.0 rejeita |
| 3 | Cost Efficiency | 12% | Cost model com 6 estágios; custo idle ≈ 0 no Stage 0-1; sem serviço always-on injustificado | SIM — Cost < 6.5 rejeita |
| 4 | Simplicity / No overengineering | 10% | Nº de serviços gerenciados no MVP; ausência de K8s/microsserviços prematuros | não |
| 5 | Reliability / Resilience | 10% | RPO/RTO definidos; retry+DLQ em toda fila; nenhum SPOF não documentado | não |
| 6 | Scalability / Elasticity | 8% | Capacity model até 1M usuários sem redesenho estrutural | não |
| 7 | Observability | 8% | Métricas, logs estruturados, correlation ID end-to-end, alertas por SLO | não |
| 8 | Maintainability / Evolutivity | 8% | Domínios desacoplados; contratos versionados; ADRs para decisões relevantes | não |
| 9 | Operability / DevEx | 6% | CI/CD com plan/apply controlado; IaC 100%; rollback definido | não |
| 10 | Extensibility (canais, LLM, tenancy futura) | 5% | Abstrações de Channel Adapter e LLM Provider comprovadamente substituíveis | não |
| 11 | Abuse / Cost-attack resistance | 3% | Rate limiting, budgets, anomaly detection definidos | não |

**Overall** = soma ponderada, escala 0–10. Gates críticos (Security, Privacy, Cost) funcionam como piso absoluto — nota baixa em qualquer um deles zera a aprovação independentemente do overall ponderado.

## Justificativa de pesos
Security e Privacy empatados no topo porque o produto lida com documentos sensíveis (certidões, dados fiscais, dados de terceiros) e canais como WhatsApp/e-mail — vazamento tem custo reputacional e legal desproporcional ao estágio do produto. Cost Efficiency logo em seguida porque é um micro-SaaS early-stage: uma arquitetura correta mas cara no Stage 0-1 mata o produto antes de validar mercado. Simplicity ganha peso deliberado para conter a tendência a overengineering que o próprio prompt mestre adverte. Scalability/Extensibility pesam menos que Security/Cost porque o prompt explicitamente pede não implementar hoje o que só é necessário no Stage 5 — devem ser avaliadas como *readiness*, não como implementação presente.

## Lacunas percebidas (a validar com Codex)
- Falta critério explícito de **Reversibilidade de decisão** (Type 1 vs Type 2) como dimensão própria, não só um proxy de Maintainability.
- **Vendor lock-in consciente** pode merecer critério próprio em vez de estar embutido em Extensibility.
- Não pesquisei ainda pricing atual de WhatsApp Business API / SES — necessário antes do cost-model.md.
