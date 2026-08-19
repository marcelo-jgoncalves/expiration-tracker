---
status: active
owner: engineering
authority: normative
---

# Critérios de revisão conjunta Claude↔Codex, por eixo

Fonte única dos critérios de avaliação (nome, peso, definição) usados nas revisões conjuntas Claude↔Codex (`AGENTS.md` §4). Achados/rodadas de uma execução específica do protocolo (ex. `docs/architecture/reviews/m3.5-runtime-design/`) registram evidência de uma revisão pontual — nunca redefinem ou duplicam a tabela de pesos; apenas linkam para a seção correspondente aqui.

Adaptado (não copiado) do padrão equivalente do projeto irmão `event-discovery-platform` (mesmo usuário) — mesmas fontes normativas e mesmos nomes/definições de critério (são padrões de indústria: ISO/IEC 25010, AWS Well-Architected, ATAM, DORA/Core-4, mais a literatura de context engineering para dev assistido por IA), mas com **pesos recalibrados por convergência independente Claude↔Codex especificamente para este repositório** — nunca herdados sem revisão. Rodada de convergência completa (2 propostas independentes + reconciliação) em `docs/engineering/reviews/joint-review-criteria-round1-{claude,codex-prompt,codex-output}.*`; ambas as partes ≥9.0 de confiança na proposta própria, sem necessidade de rodada formal de desacordo (mesma condição de convergência rápida que o projeto irmão documenta para o eixo de contexto).

Cada eixo evolui apenas se o próprio critério se mostrar mal calibrado em uso real — registrar por que, junto com a mudança, e não reabrir a cada nova revisão sobre o mesmo eixo.

**Eixos existentes**: Arquitetura, Qualidade de Engenharia, Engenharia de Contexto, Segurança da Informação e AppSec. **Consenso sobre quais eixos formais este projeto deveria ter** (2026-08-19, pesquisa independente Claude+Codex + rodada de convergência — `docs/engineering/reviews/audit-areas-research-*` e `audit-areas-convergence-*`): 9 eixos totais — os 4 acima, mais Privacidade e Governança de Dados, Operações/SRE e Continuidade de Negócio, Governança de IA e Controles Internos, Governança Jurídica/Contratual/Terceiros, Governança de Produto e Serviço Multi-tenant (com FinOps como eixo próprio, decidido pelo usuário, mas **não formalizado ainda** — sem critérios definidos, não usar até existir uma seção própria aqui). Os 5 eixos aprovados mas não formalizados ficam como trabalho futuro, não implícitos no protocolo até ganharem seção própria.

---

## Eixo: Arquitetura

Convergido em 2026-08-19. Pesos puxados para cima em Reliability & Fault Recovery e Data Model & Consistency — refletem que G8 (recuperação real de falha assíncrona) é o gate de engenharia mais caro e mais recentemente testado deste projeto, e que o single-table DynamoDB com 6 GSIs e duas exceções de particionamento (GSI3/GSI6, chaves globais) já produziu bugs reais (inconsultabilidade de PK, ponteiro removido incorretamente) — risco concreto, não hipotético.

| # | Critério | Peso |
|---:|---|---:|
| 1 | Domain Fit & Simplicity | 8% |
| 2 | Reliability & Fault Recovery | 16% |
| 3 | Event & Integration Correctness | 11% |
| 4 | Data Model & Consistency | 13% |
| 5 | Security & Privacy | 13% |
| 6 | Modifiability & Evolvability | 7% |
| 7 | Observability & Operability | 8% |
| 8 | Testability & Delivery Safety | 8% |
| 9 | Cost & Resource Governance | 5% |
| 10 | Performance & Scalability Fitness | 4% |
| 11 | Architecture Governance & Traceability | 7% |

## Eixo: Qualidade de engenharia

Convergido em 2026-08-19. Eixo distinto do de Arquitetura — craft de código, disciplina de testes, rigor de CI, tooling, disciplina de documentação/processo, gestão de dívida técnica; não redecide design de sistema. Ajuste principal: **Delivery, Release & Recovery Discipline** subiu de forma expressiva (padrão de origem tinha 8%) — não porque a entrega já seja madura, mas justamente o oposto: nenhum deploy real foi validado ainda neste projeto, e o único bloqueador restante para fechar G8 é exatamente executar deploy real + IAM negativo + DLQ/redrive + EventBridge Scheduler em sandbox AWS. Uma lacuna real de evidência pesa mais, não menos — mesmo raciocínio aplicado ao eixo de contexto abaixo.

| # | Critério | Peso | Definição |
|---:|---|---:|---|
| 1 | Code Correctness & Defensive Design | 11% | Preservação de invariantes via validação explícita, tratamento de falha, transições de estado seguras, ausência de corrupção silenciosa. |
| 2 | Test Effectiveness & Coverage Discipline | 15% | Evidência crível de unit/integration/contract/negative/failure/regression focada em risco real, não apenas contagem/cobertura de linha. Suíte extensa baseada só em fakes não pontua alto — precisa provar propriedades reais (DynamoDB/IAM/SQS/EventBridge) quando o risco é real. |
| 3 | CI Quality Gates & Merge Safety | 11% | Enforcement determinístico de checks obrigatórios em toda mudança, sem bypass informal, exceções formalmente governadas. |
| 4 | Type Safety, Static Analysis & Automated Enforcement | 9% | Uso efetivo de tipagem estrita, lint, dependency-cruiser (grafo real de imports) e fitness functions customizadas para prevenir classes de defeito automaticamente. |
| 5 | Readability, Consistency & Implementation Maintainability | 8% | Código coeso, nomeado claramente, estilo consistente, DRY/KISS/YAGNI aplicado com julgamento, barato de modificar. |
| 6 | Delivery, Release & Recovery Discipline | 11% | Artefatos/ambientes reproduzíveis, promoção segura, evidência de deploy, rollback, validação de recuperação — critério de saída real de G8, não secundário neste estágio. |
| 7 | Dependency & Supply-Chain Hygiene | 7% | Dependências controladas, lockfiles, actions/tools pinados, triagem de vulnerabilidade com `expiresAt` formal (`docs/engineering/exceptions.md`), SBOM. |
| 8 | Debuggability & Operational Feedback | 7% | Diagnósticos estruturados e privacy-safe (`SecureLogger`/`Redactor`), correlation context, erros acionáveis, suficientes para investigar falhas assíncronas. |
| 9 | Developer Experience & Reproducibility | 5% | Instalar/validar/testar/rodar o repositório a partir de checkout limpo, com comandos pinados e documentados, de baixo atrito. |
| 10 | Documentation Quality & Process Discipline | 5% | Specs, standards, decisões e registros de mudança claros e autoritativos, com rigor de processo proporcional a projeto solo. |
| 11 | Documentation–Implementation Drift Control | 6% | Checks determinísticos ou executados regularmente que detectam divergência entre documentação, código, infra, config de CI e realidade implantada. |
| 12 | Technical-Debt & Continuous-Improvement Practice | 5% | Registro honesto de atalhos e controles falhos, com dono, trigger, expiry quando aplicável, e follow-through baseado em evidência. |

## Eixo: Engenharia de contexto

Convergido em 2026-08-19. Avalia a qualidade do próprio sistema de documentação/contexto do projeto — não código, não arquitetura de sistema, não craft de engenharia (eixos distintos, já cobertos acima). Ajuste principal: **Context Routing & Progressive Disclosure** subiu de forma expressiva (padrão de origem tinha 13%) pelo mesmo raciocínio do eixo anterior — este projeto não tem um "context router" dedicado equivalente ao `system-overview.md` do projeto irmão (`AGENTS.md` §2 cumpre parcialmente esse papel, mas é mais fraco), e o volume de documentos normativos/históricos/handoffs já torna caro escolher o read-set mínimo correto. Uma lacuna estrutural real pesa mais no critério que ela mede, nunca menos.

| # | Critério | Peso | Definição |
|---:|---|---:|---|
| 1 | Canonicalidade, Autoridade & Não-Duplicação | 15% | Cada fato normativo tem exatamente uma fonte de verdade; derivados (índices, mapas, resumos) são explicitamente não autoritativos e referenciam a fonte em vez de copiá-la. Ver `docs/architecture/README.md` §"Precedência de fontes". |
| 2 | Clareza de Papéis & Proporcionalidade | 9% | Cada documento tem propósito, escopo e autoridade inequívocos, sem sobreposição semântica relevante. Estrutura proporcional ao tamanho real do projeto — sem sofisticação antecipada (`docs/engineering/principles.md` #1). |
| 3 | Context Routing & Progressive Disclosure | 15% | Humanos e agentes conseguem identificar e carregar o menor conjunto suficiente de contexto para cada tipo de tarefa. Lacuna reconhecida: sem context router dedicado hoje — `AGENTS.md` §2 é o candidato mais próximo, mais fraco que o padrão do projeto irmão. |
| 4 | Correspondência com a Realidade & Controle de Drift | 16% | O sistema distingue intenção documentada, implementação declarada e estado efetivamente observado, reconciliando divergências explicitamente. `ARCHITECTURE STATUS`/gates G1-G8 só mudam com evidência operacional real (`docs/engineering/principles.md` #6). |
| 5 | Lifecycle, Proveniência & Evolução do Conhecimento | 12% | Arquitetura vigente vs. histórica, ADR aceito imutável e supersedido por ADR novo, metadata de status/autoridade, lifecycle de evidências (`docs/architecture/history/`). |
| 6 | Rastreabilidade de Decisões, Trabalho & Triggers | 10% | Decisões caras, trabalho adiado, dívida técnica e evidências permanecem conectados; gatilhos de reavaliação concretos e verificáveis (`docs/engineering/exceptions.md`, `decisions-log.md`). |
| 7 | Higiene de Contexto & Sinal-Ruído | 8% | Só conhecimento durável é promovido a destinos canônicos; ausência de versões concorrentes ou documentos órfãos. |
| 8 | Portabilidade Agnóstica entre Agentes de IA | 6% | Regras essenciais utilizáveis por diferentes agentes/ferramentas — `AGENTS.md`/`CLAUDE.md` já seguem essa separação. |
| 9 | Auditabilidade & Enforcement do Sistema de Contexto | 9% | Afirmações sobre a saúde do contexto verificáveis por evidência datada e revisões reproduzíveis; achados com lifecycle claro (aberto/corrigido/adiado/arquivado). |

## Eixo: Segurança da Informação e AppSec

Convergido em 2026-08-19 (fontes: OWASP ASVS 5.0, OWASP Top 10:2025, OWASP SAMM, práticas de least-privilege IAM AWS Lambda/DynamoDB). Rodada de convergência completa em `docs/engineering/reviews/security-axis-criteria-round1-{claude,codex-prompt,codex-output}.*` — convergência forte: os dois critérios de maior peso (isolamento multi-tenant, least-privilege IAM) saíram com pesos **idênticos** nas duas propostas independentes, sem precisar de reconciliação. Eixo avalia confidencialidade/integridade/disponibilidade/isolamento diante de abuso intencional e falhas de fronteira de confiança — não reavalia craft de código, arquitetura funcional ou disciplina de teste geral (eixos distintos); só quando esses elementos são controle ou evidência especificamente de segurança.

Pesos calibrados pelo risco real já observado neste projeto: GSI3/GSI6 são exceções de particionamento com blast radius cross-tenant deliberado que já produziram bug real nesta sessão (não risco hipotético); o pipeline assíncrono (M3.5/G8) passou por 3 rodadas reais de revisão que encontraram bugs de contrato, race condition e limpeza de índice.

| # | Critério | Peso | Definição |
|---:|---|---:|---|
| 1 | Isolamento Multi-Tenant & Autorização por Objeto | 18% | `tenantId` derivado exclusivamente da identidade validada e propagado por chaves, queries, eventos, idempotência e auditoria; proteção contra IDOR e acesso cross-tenant em toda rota/worker. Maior peso do eixo — risco mais concreto e já testado deste projeto (GSI3/GSI6). |
| 2 | Least-Privilege IAM & Contenção de Blast Radius | 14% | Capability/role específica por Lambda (`ScopedLambdaFunction`), sem grants implícitos/curinga. `gsi3Read()`/`gsi6Read()` como capabilities exclusivas de lista fechada de workers — permissões tenant-facing devem produzir `AccessDenied` real (Camada 3, ainda pendente). |
| 3 | Autenticação, Sessão & Gestão de Identidade | 11% | Validação completa de JWT Cognito (assinatura/issuer/audience/expiração/claims), revogação global/por dispositivo, TTL/rotação, MFA proporcional. Nenhuma autorização confia em identidade/tenant fornecido pelo cliente. |
| 4 | Integridade do Pipeline Assíncrono & Fronteiras de Mensagem | 14% | Eventos EventBridge/SQS/Streams/outbox autenticados pela infra, validados por schema, vinculados ao tenant, protegidos contra replay/duplicação/roteamento cruzado. Claim/estado/outbox preservam atomicidade; retry/DLQ/redrive/sweeper não contornam autorização. Peso alto: é onde G8 já encontrou bugs reais. |
| 5 | Validação de Entrada, Injection & Fail-Closed | 9% | Validação server-side por contrato (Ajv) em toda borda — HTTP, filas, dados persistidos. Entrada inválida/estado impossível/erro de autorização falha de modo fechado, sem mutação parcial nem detalhe interno vazado. |
| 6 | Proteção de Dados Sensíveis, Segredos & Criptografia | 9% | Minimização/classificação de PII e tokens, criptografia em trânsito/repouso, segredos fora de código/log/artefato. `SecureLogger`/`Redactor` deve valer também em exceções, traces, eventos e DLQ — não só no caminho feliz. |
| 7 | Logging Seguro, Detecção & Resposta a Incidentes | 8% | Eventos de autenticação/autorização negada/alteração privilegiada/acesso a GSI global produzem trilha íntegra, correlacionável, privacy-safe (OWASP A09:2025). Alarmes com threshold acionável e runbook de contenção/revogação/investigação. |
| 8 | Configuração Segura da Plataforma & Superfície Exposta | 6% | API Gateway/Cognito/Lambda/DynamoDB/SQS/EventBridge/Streams com defaults seguros, exposição mínima, retenção adequada. Mudanças de CDK devem ser capazes de detectar regressão (wildcard de índice, grant excessivo, handler placeholder — já aconteceu nesta sessão). |
| 9 | Resistência a Abuso, DoS & Exaustão de Custo | 5% | Rate limits, quotas por tenant, concorrência reservada, limites de batch/paginação impedem que um tenant, poison message ou evento amplificado degrade outros tenants ou gere custo descontrolado; retries/reconciliação não podem virar multiplicador de ataque. |
| 10 | Verificação Adversarial & Gestão Contínua de Risco | 6% | Evidência específica de segurança (threat model vivo, testes de abuso/cross-tenant/replay, assertions de IAM/IaC) — inclusive teste em AWS real quando emulação não prova o controle (Camada 3). Achados com severidade/dono/prazo; nova superfície (upload, provedor externo, frontend, webhook) reabre a análise antes da implementação. |

## Como adicionar um novo eixo

Não criar a tabela de critérios dentro do primeiro doc de auditoria do eixo novo. Seguir o mesmo procedimento de convergência independente (`AGENTS.md` §4) e, ao final, adicionar aqui uma seção nova nesse mesmo formato — o registro de auditoria referencia a seção, não a duplica.
