---
status: active
owner: engineering
authority: normative
---

# Critérios de revisão conjunta Claude↔Codex, por eixo

Fonte única dos critérios de avaliação (nome, peso, definição) usados nas revisões conjuntas Claude↔Codex (`AGENTS.md` §4). Achados/rodadas de uma execução específica do protocolo (ex. `docs/architecture/reviews/m3.5-runtime-design/`) registram evidência de uma revisão pontual — nunca redefinem ou duplicam a tabela de pesos; apenas linkam para a seção correspondente aqui.

Adaptado (não copiado) do padrão equivalente do projeto irmão `event-discovery-platform` (mesmo usuário) — mesmas fontes normativas e mesmos nomes/definições de critério (são padrões de indústria: ISO/IEC 25010, AWS Well-Architected, ATAM, DORA/Core-4, mais a literatura de context engineering para dev assistido por IA), mas com **pesos recalibrados por convergência independente Claude↔Codex especificamente para este repositório** — nunca herdados sem revisão. Rodada de convergência completa (2 propostas independentes + reconciliação) em `docs/engineering/reviews/joint-review-criteria-round1-{claude,codex-prompt,codex-output}.*`; ambas as partes ≥9.0 de confiança na proposta própria, sem necessidade de rodada formal de desacordo (mesma condição de convergência rápida que o projeto irmão documenta para o eixo de contexto).

Cada eixo evolui apenas se o próprio critério se mostrar mal calibrado em uso real — registrar por que, junto com a mudança, e não reabrir a cada nova revisão sobre o mesmo eixo.

**Eixos formalizados (9)**: Arquitetura, Qualidade de Engenharia, Engenharia de Contexto, Segurança da Informação e AppSec, Privacidade e Governança de Dados, Operações/SRE e Continuidade de Negócio, Governança de IA e Controles Internos, Governança Jurídica/Contratual/Terceiros, Governança de Produto e Serviço Multi-tenant. **FinOps fica como 10º eixo, aprovado por decisão do usuário mas ainda sem critérios definidos** — não usar até ganhar seção própria aqui; economia unitária hoje é só um critério dentro de Produto/Serviço Multi-tenant, não um substituto do eixo.

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

## Eixo: Privacidade e Governança de Dados

Convergido em 2026-08-19 (fontes: LGPD/orientações ANPD sobre RIPD/direitos/incidentes/transferências, DAMA-DMBOK). Rodada completa em `docs/engineering/reviews/remaining-axes-round1-{claude,codex-prompt,codex-output}.*`. Avalia licitude, finalidade, governança e ciclo de vida dos dados — não controles técnicos de acesso (isolamento multi-tenant/IAM já pertencem ao eixo de Segurança, não duplicado aqui). Maior peso do eixo em Retenção/Exclusão porque é o workflow mais greenfield e envolve múltiplos stores (DynamoDB, S3, filas, backups, providers).

| # | Critério | Peso | Definição |
|---:|---|---:|---|
| 1 | Inventário, Classificação, Ownership & Linhagem de Dados | 15% | Inventário versionado de dados pessoais, sensíveis, documentos, metadados, logs, eventos e backups; finalidade, origem, destino, responsável e `retentionClass` rastreáveis. Nova entidade/campo/integração não entra sem classificação. |
| 2 | Base Legal, Finalidade & Minimização | 16% | Base legal e finalidade definidas por tratamento, com teste de necessidade/proporcionalidade. Uso secundário exige reavaliação, não reutilização implícita. |
| 3 | Direitos do Titular & Portabilidade Efetiva | 16% | Confirmação/acesso/correção/exportação/oposição/exclusão com fluxo autenticado, prazos, estados e evidência de conclusão. |
| 4 | Retenção, Legal Hold, Exclusão Verificável & Backups | 17% | Prazo por classe com evento inicial, prazo final e mecanismo executável. Exclusão alcança DynamoDB/S3/índices/filas/providers/restores; testes provam que dado excluído não ressurge após restore. |
| 5 | Localização, Transferência Internacional & Subprocessamento | 14% | Região de produção, países de tratamento, subprocessadores e mecanismos jurídicos de transferência decididos antes de produção — decisão hoje pendente por LGPD, não drift silencioso. |
| 6 | RIPD, Risco aos Titulares & Privacy by Design | 10% | Critérios objetivos de quando elaborar/atualizar RIPD; tratamento de alto risco exige decisão humana registrada. |
| 7 | Qualidade, Correção & Proveniência dos Dados | 7% | Dados exatos/completos/atuais vinculados à origem/versão; inferência de IA distinguível de dado confirmado pelo usuário. |
| 8 | Accountability, Evidência & Monitoramento de Privacidade | 5% | Responsáveis, aprovações, DSRs, holds e exceções produzem evidência auditável, sem virar telemetria excessiva de dado pessoal. |

## Eixo: Operações, SRE e Continuidade de Negócio

Convergido em 2026-08-19 (fontes: Google SRE Book — SLO/error budget dirige decisão operacional, não só relatório —, AWS Well-Architected SaaS Lens §Operate). Avalia capacidade de operar/detectar/responder/recuperar o serviço real — o desenho de SLO/DR já existe (`slo.md`/`disaster-recovery.md`) mas nunca foi operacionalizado com dado de produção real. Maior peso em Backup/Restore porque "documentado mas nunca testado" é o padrão de risco mais repetido observado neste projeto (G8 só fechou depois de testar de verdade).

| # | Critério | Peso | Definição |
|---:|---|---:|---|
| 1 | SLIs, SLOs & Error Budgets Acionáveis | 16% | SLIs representam resultado percebido (API, reminder freshness, backlog, reconciliação); consumo de error budget condiciona release/priorização, não só relatório. |
| 2 | Observabilidade Operacional & Visão por Tenant | 11% | Detecta impacto agregado e noisy neighbor entre tenants — `SecureLogger` maduro não basta sem dashboard/sinal real. |
| 3 | Detecção, Resposta & Comunicação de Incidentes | 15% | Alertas com threshold acionável/dono/escalonamento/runbook; comunicação a tenants/titulares/ANPD quando aplicável; exercícios comprovam funcionamento sob pressão. |
| 4 | Saúde do Pipeline Assíncrono & Recuperação de Backlog | 14% | Idade/profundidade de fila, DLQ, outbox, claims, sweeper monitorados; redrive/replay idempotentes e limitados. Peso alto pela criticidade do produto + Camada 3 ainda pendente. |
| 5 | Backup, Restore, RTO/RPO & Continuidade | 18% | PITR/backup configurado não basta — nota depende de restore real periódico com RTO/RPO observado. Falha regional é risco aceito explicitamente (região única, Stage 0-2), não ignorado. |
| 6 | Prontidão de Deploy, Rollback & Mudança Operacional | 10% | Deploy com artefato identificável, checks pré/pós, rollback/roll-forward; mudança de schema/GSI/KMS/provider aciona validação proporcional. |
| 7 | Capacidade, Dependências & Degradação Controlada | 9% | Limites AWS/providers/concorrência/custo conhecidos e testados; kill switches preservam trabalho recuperável. |
| 8 | Post-mortem, Exercícios & Melhoria Contínua | 7% | Post-mortem sem culpa com ação/dono/prazo; falha recorrente ou ação vencida reduz nota. |

## Eixo: Governança de IA e Controles Internos

Convergido em 2026-08-19 (fontes: NIST AI RMF — ciclo Govern/Map/Measure/Manage —, ISO/IEC 42001). Abrange Claude/Codex construindo e operando o projeto, e futuros componentes de IA/OCR do produto. Avalia autoridade, supervisão, independência, proveniência e gestão de risco — não a qualidade genérica do código gerado (eixo de Engenharia). Maior peso em Independência da Revisão porque é o controle interno central deste projeto (protocolo `AGENTS.md` §4).

| # | Critério | Peso | Definição |
|---:|---|---:|---|
| 1 | Limites de Autoridade, Permissões & Supervisão Humana | 18% | Ações permitidas/proibidas/sujeitas a aprovação humana por agente; deploy/merge/exclusão/produção/Type-1/comunicação externa seguem least authority e fail-closed. |
| 2 | Atribuição, Proveniência & Reprodutibilidade das Ações | 15% | Toda mudança relevante atribuível a agente/modelo/sessão/diff/teste/aprovador — reconstruível sem exigir armazenamento indiscriminado de prompt sensível. |
| 3 | Independência da Revisão & Segregação de Funções | 15% | Nota cega, mínimo de rodadas, mesmo agente nunca simula aprovação independente de si mesmo. Controle interno central do projeto — sem ele, "revisão Claude↔Codex" viraria teatro. |
| 4 | Inventário de Casos de Uso & Gestão do Risco de IA | 13% | Usos de IA inventariados por finalidade/impacto/dado/autonomia/reversibilidade; mudança relevante reabre avaliação (Govern-Map-Measure-Manage). |
| 5 | Avaliação de Correção, Limitações & Impacto | 12% | Nota alta sem evidência de arquivo:linha concreta não fecha revisão (já é a prática deste projeto — formalizado aqui como critério). |
| 6 | Proteção de Contexto, Dados & Segredos no Uso de IA | 10% | Apenas contexto necessário enviado a modelo/ferramenta; segredos/dado pessoal/documento de tenant obedecem classificação e retenção. |
| 7 | Gestão de Modelos, Ferramentas, Fornecedores & Mudanças | 9% | Versão/capacidade de modelo/CLI conhecida; upgrade tem avaliação de regressão e impacto — comportamento de fornecedor não é controle interno garantido. |
| 8 | Incidentes de IA, Exceções & Melhoria Contínua | 8% | Mecanismo de suspender uso/reverter/registrar falha; bypass/exceção com fundamento, prazo e aprovação. |

## Eixo: Governança Jurídica, Contratual e de Terceiros

Convergido em 2026-08-19 (fontes: SOC 2 Trust Services Criteria — gestão de fornecedor, não certificação prematura —, licenciamento OSS). Avalia obrigação/licença/contrato/responsabilidade/risco de dependência externa — SBOM, pinning e integridade técnica de build continuam nos eixos de Engenharia/Segurança, não duplicados aqui.

| # | Critério | Peso | Definição |
|---:|---|---:|---|
| 1 | Papéis Jurídicos, Responsabilidades & Modelo Contratual | 16% | Define quando o serviço é controlador/operador/ambos; decisão pendente recebe dono e gate antes do lançamento. |
| 2 | Inventário, Due Diligence & Monitoramento de Terceiros | 16% | Registro de AWS/modelos de IA/OCR/mensageria/CI com serviço, dados, criticidade, região, certificação, lock-in e responsável. |
| 3 | Licenciamento OSS, Propriedade Intelectual & Uso de Conteúdo | 14% | Dependências/código gerado com licença/proveniência compatível com operação comercial; autoria por IA não presume ausência de risco de licença. |
| 4 | Termos de Uso, Aviso de Privacidade & Consentimentos | 14% | Termos/avisos compatíveis com comportamento real do produto — não existem ainda, pré-requisito antes do primeiro usuário real. |
| 5 | DPAs, Transferências, Incidentes & Obrigações de Fornecedor | 13% | Contrato com operador/suboperador cobre instruções, segurança, localização, exclusão e comunicação tempestiva de incidente (LGPD art. 39). |
| 6 | Compromissos Comerciais, SLA & Proteção do Consumidor | 13% | Não prometer entrega de mensagem quando só há tentativa do provider, nem disponibilidade sem arquitetura correspondente. |
| 7 | Aprovação, Evidência, Exceções & Mudança Regulatória | 7% | Gatilho de reavaliação em mudança regulatória/produto/região/provider; aprovação sem dono não pontua como controle. |
| 8 | Continuidade, Portabilidade & Saída de Fornecedor | 7% | Dependência crítica tem estratégia proporcional de substituição/exportação — dado não fica irrecuperavelmente preso sem risco aceito e documentado. |

## Eixo: Governança de Produto e Serviço Multi-tenant

Convergido em 2026-08-19 (fontes: AWS Well-Architected SaaS Lens — onboarding automatizado no control plane, crypto-shredding no offboarding, tenant como conceito de primeira classe). Avalia o serviço percebido/administrado pelo tenant ao longo do ciclo de vida — não reavalia isolamento/IAM técnico (eixo de Segurança). **FinOps fica como eixo próprio por decisão do usuário, não formalizado ainda** — economia unitária aqui é só um critério de produto, não compete em peso com esse eixo futuro.

| # | Critério | Peso | Definição |
|---:|---|---:|---|
| 1 | Lifecycle Automatizado de Tenant | 18% | Onboarding/ativação/convite/mudança de plano/suspensão/offboarding como estados explícitos, idempotentes, auditáveis — hoje o tenant nasce implicitamente no primeiro login (MVP `tenantId=userId`), sem control plane dedicado. |
| 2 | Offboarding, Exportação & Destruição Criptográfica | 16% | "Não conseguimos deletar um tenant" é falha de compliance, não só técnica; crypto-shredding coordenado com retenção/backup/legal hold. |
| 3 | Planos, Entitlements, Quotas & Fairness | 13% | Capacidades/limites como política centralizada e versionada; `TenantQuota` já existe (M1), falta plano de billing real. Não duplica rate-limiting de segurança — mede correção da oferta do produto. |
| 4 | Correção do Serviço de Lembretes & Proteção do Usuário | 15% | Timezone/DST/opt-out/quiet hours/renovação corrigíveis; lembrete perdido/duplicado/obsoleto tem detecção e reparo — é a falha mais grave possível do produto. |
| 5 | Transparência, Usabilidade & Acessibilidade | 10% | Estado/erro/atraso comunicado em linguagem clara; ainda não se aplica plenamente (sem frontend), mas entra no radar em M4+. |
| 6 | Administração, Suporte & Operação sob a Ótica do Tenant | 10% | Suporte autorizado diagnostica saúde/uso/config por tenant com trilha de auditoria, sem acesso informal a conteúdo. |
| 7 | Métricas de Valor, Consumo & Economia Unitária | 10% | Adoção/sucesso de lembrete/consumo atribuível por tenant de forma privacy-safe — germe do futuro eixo FinOps, não o eixo em si. |
| 8 | Evolução Unificada & Controle de Customização | 8% | Nenhuma feature cria "fork" por tenant; variação por plano usa mecanismo governado (mesmo princípio já aplicado ao reshard versionado do GSI3). |

## Como adicionar um novo eixo

Não criar a tabela de critérios dentro do primeiro doc de auditoria do eixo novo. Seguir o mesmo procedimento de convergência independente (`AGENTS.md` §4) e, ao final, adicionar aqui uma seção nova nesse mesmo formato — o registro de auditoria referencia a seção, não a duplica.
