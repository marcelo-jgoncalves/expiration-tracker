# Synthetic Persona Evaluation Framework
## Research & Quality Baseline v1

**Projeto:** Expiration Tracker  
**Objetivo desta etapa:** estabelecer os fundamentos metodológicos, arquiteturais e de qualidade para a futura construção de um framework de testes com personas sintéticas, antes da análise específica da aplicação.

---

## 1. Definição proposta

> **Synthetic Persona Evaluation Framework:** infraestrutura reproduzível para executar agentes condicionados por personas contra uma aplicação real, em ambientes controlados, registrar suas interações, verificar objetivamente os estados resultantes, identificar possíveis problemas funcionais e de usabilidade e produzir evidências auditáveis antes da validação com usuários humanos.

O framework deve ser tratado como **infraestrutura de avaliação**, e não como um simples conjunto de prompts.

Princípio central:

> Personas sintéticas servem para produzir hipóteses, explorar fluxos, detectar problemas precocemente e aumentar a cobertura de QA, mas **não substituem validação com usuários humanos**.

---

## 2. Limites epistemológicos do framework

O framework poderá fornecer evidência sobre:

- fluxos difíceis de completar;
- possíveis problemas de navegação;
- regressões de UX;
- ambiguidades de interface;
- problemas de recuperação de erro;
- robustez de workflows;
- diferenças entre versões da interface;
- edge cases;
- estabilidade de tarefas;
- variações de comportamento entre agentes e trials.

O framework **não poderá afirmar sozinho**:

- que usuários reais não entenderão determinada interface;
- satisfação real dos usuários;
- preferências reais de mercado;
- taxa real de abandono;
- conversão real;
- comportamento estatístico da população;
- que uma persona representa fielmente um segmento;
- que testes humanos são desnecessários.

Essa fronteira deverá ser um **hard gate** do framework.

---

## 3. Modelo metodológico

A unidade fundamental de avaliação será:

```text
Persona
   +
Contexto
   +
Dataset
   +
Cenário
   +
Objetivo
   =
Trial
```

Isso é superior a personas puramente narrativas, como:

```text
"Você é João, 45 anos."
```

O contexto de uso deverá ser explicitamente modelado.

---

## 4. Arquitetura conceitual

O framework não deverá ser apenas:

```text
Prompt da persona
       ↓
LLM
       ↓
Playwright
       ↓
"Consegui / não consegui"
```

O modelo proposto é:

```text
              Persona Registry
                     │
              Scenario Registry
                     │
              Dataset Registry
                     │
                     ▼
             Trial Resolver
            seed / contexto /
          comportamento concreto
                     │
                     ▼
               Agent Adapter
        Claude / Codex / outro modelo
                     │
                     ▼
             Browser Executor
          Playwright / Computer Use
                     │
            ┌────────┴────────┐
            │                 │
            ▼                 ▼
       Telemetry          Application
        Collector         under test
            │                 │
            └────────┬────────┘
                     ▼
              Outcome State
                     │
          ┌──────────┼──────────┐
          ▼          ▼          ▼
       Oracle     Graders     Analysis
    deterministic   LLM       metrics
          │          │          │
          └──────────┼──────────┘
                     ▼
                Run Report
```

A separação entre **tarefa, ambiente, tentativa, trajetória, estado final e grader** será obrigatória.

---

## 5. Personas não serão apenas histórias

Uma persona deverá ser um **modelo comportamental estruturado**.

Exemplo conceitual:

```yaml
persona:
  id: small-business-owner-low-tech
  version: 1.0

  evidence:
    status: hypothesis

  role:
    occupation: business_owner
    organization_size: small

  goals:
    - avoid_expired_documents
    - delegate_renewals

  domain_knowledge:
    expiration_management: medium

  digital_skill:
    level: low

  behavior:
    attention: low
    exploration: low
    persistence: medium
    organization: low
    error_recovery: low

  knowledge_boundary:
    knows:
      - own_company_documents
    does_not_know:
      - internal_system_terminology

  constraints:
    time_pressure: high
    notification_overload: high

  interaction_preferences:
    prefers_simple_language: true
    avoids_advanced_filters: true

  confusion_triggers:
    - ambiguous_labels
    - technical_language
    - too_many_options

  provenance:
    source_type: hypothesis
```

---

## 6. Provenance e nível de evidência das personas

Cada persona deverá possuir um status explícito de evidência:

```text
hypothesis
    ↓
research-grounded
    ↓
human-observed
    ↓
production-observed
```

O framework nunca deverá apresentar uma persona hipotética como representação comprovada de usuários reais.

---

## 7. Demografia como fator secundário

Atributos como:

- idade;
- sexo;
- renda;
- cidade;
- profissão;

não deverão automaticamente gerar comportamentos.

Deverão ser priorizados atributos diretamente relacionados ao comportamento na aplicação:

- experiência digital;
- conhecimento do domínio;
- atenção;
- pressa;
- organização;
- persistência;
- aversão a risco;
- propensão a abandonar;
- comportamento diante de erro;
- confiança em tecnologia;
- frequência de uso;
- volume de documentos;
- sobrecarga de notificações.

Regra:

> Atributos demográficos só deverão influenciar comportamento quando houver justificativa baseada em evidência.

---

## 8. Variabilidade fora do LLM

A variabilidade comportamental não deverá ficar sob responsabilidade do próprio modelo.

Evitar:

```text
Você tem 30% de chance de abandonar quando encontrar um erro.
```

Preferir:

```yaml
persistence:
  distribution:
    low: 0.30
    medium: 0.50
    high: 0.20
```

O framework resolve isso antes da execução.

Exemplo:

```text
seed = 983271
```

pode gerar:

```yaml
persistence: low
time_pressure: high
attention: medium
max_recovery_attempts: 2
```

Arquitetura:

```text
Persona Template
      +
Seed
      ↓
Resolved Persona
      ↓
LLM
```

Isso melhora significativamente a reprodutibilidade.

---

## 9. O agente não poderá conhecer o teste

O agente poderá receber:

> Você precisa descobrir quais documentos necessitam de atenção nas próximas semanas.

Mas nunca:

> Abra Documents → Filters → Expiration → 30 days.

Também não poderá receber:

- `expectedResult`;
- grader;
- database state;
- acceptance criteria;
- IDs internos;
- oracle;
- reference solution.

Princípio:

```text
Actor knows:
persona + context + goal + visible application state

Actor does NOT know:
oracle + expected state + implementation + grading logic
```

---

## 10. Modos de percepção

Resultados de agentes não deverão ser misturados sem distinguir o modo de interação.

Categorias propostas:

| Modo | Objetivo |
|---|---|
| Deterministic Playwright | Testar funcionalidade |
| Visual persona | Aproximar interação visual normal |
| Accessibility persona | Avaliar fluxos por árvore de acessibilidade |
| Behavioral persona | Explorar comportamento condicionado |
| Adversarial persona | Forçar erros e situações incomuns |

Uma falha deverá poder ser classificada como:

```text
PRODUCT_FUNCTIONAL
PRODUCT_UX
PRODUCT_ACCESSIBILITY

AGENT_PERCEPTION
AGENT_REASONING

HARNESS_FAILURE
ENVIRONMENT_FAILURE
DATA_FAILURE
GRADER_FAILURE

UNKNOWN
```

---

## 11. Control tasks

Antes de confiar em um agente, deverão existir tarefas simples de controle.

Exemplo:

```text
CONTROL-001

Existe um botão claramente identificado "Continuar".
Peça ao agente para continuar.
```

Se o agente falhar em controles simples, os resultados de tarefas mais complexas deverão ser tratados como suspeitos.

Isso ajuda a distinguir:

- problema do produto;
- problema de percepção;
- problema do modelo;
- problema do harness.

---

## 12. Especificação formal de cenários

Exemplo:

```yaml
scenario:
  id: expiring-document-delegation

  preconditions:
    - organization_exists
    - documents_exist
    - multiple_responsibles_exist

  trigger:
    type: upcoming_expiration

  context:
    user_is_busy: true

  goal:
    description: >
      Identify the documents requiring attention
      and make sure someone is responsible for them.

  success_state:
    type: deterministic

  forbidden_information:
    - navigation_path
    - database_ids
    - acceptance_criteria

  cleanup:
    strategy: reset_fixture
```

Um bom cenário deverá:

1. possuir objetivo claro;
2. possuir estado inicial conhecido;
3. possuir uma solução conhecida;
4. permitir avaliação objetiva;
5. não revelar o caminho de solução;
6. ser repetível;
7. possuir estratégia de cleanup/reset.

---

## 13. Reference solution obrigatória

Cada cenário importante deverá possuir:

```text
Task
 ├── objective
 ├── reference solution
 ├── oracle
 └── alternative valid outcomes
```

A reference solution:

- não é mostrada ao agente;
- prova que a tarefa é solucionável;
- valida o ambiente;
- valida o oracle;
- evita graders exigindo resultados impossíveis.

---

## 14. Estado real do sistema como fonte de verdade

O framework nunca deverá aceitar a declaração do agente como prova de sucesso.

Exemplo:

> "Pronto, atribuí o documento ao responsável."

Isso não é evidência suficiente.

A verificação deverá usar:

```text
database / API / event / state
```

Hierarquia de oracles:

| Prioridade | Evidência |
|---:|---|
| 1 | Estado interno determinístico |
| 2 | Banco/API/eventos |
| 3 | Estado observável da aplicação |
| 4 | Grader baseado em regras |
| 5 | LLM grader |
| 6 | Autoavaliação da persona |

A autoavaliação da persona **nunca será fonte de verdade funcional**.

---

## 15. Uso de LLM-as-judge

LLM graders deverão ser usados apenas como complemento.

Estratégia:

```text
Functional correctness
        ↓
deterministic oracle

UX nuance
        ↓
LLM rubric

Human UX truth
        ↓
human user
```

Nunca:

```text
Claude acha que foi ruim
        =
a UX é ruim
```

LLM graders deverão ser calibrados posteriormente contra julgamento humano.

---

## 16. Actor e Judge independentes

Quando possível:

```text
Claude Actor
     ↓
Codex Judge
```

e:

```text
Codex Actor
     ↓
Claude Judge
```

Para resultados funcionais objetivos, o oracle determinístico continua tendo prioridade.

Regra:

> O modelo que executou uma sessão não poderá ser o único juiz daquela sessão.

Para critérios subjetivos importantes poderá existir:

```text
Claude judgement
       +
Codex judgement
       +
deterministic evidence
```

Divergências deverão ser investigadas.

---

## 17. Não depender de chain-of-thought

O framework não dependerá de raciocínio privado dos modelos.

Será suficiente registrar:

```text
observation
chosen action
optional concise rationale
browser action
visible result
application state
```

O funcionamento do framework deverá ser independente de acesso a chain-of-thought.

---

## 18. Observabilidade como requisito de primeira classe

Cada trial deverá produzir um pacote semelhante a:

```text
run/
  manifest.json
  persona-resolved.json
  scenario.json
  dataset-version.json

  actions.jsonl
  observations.jsonl

  browser-trace.zip
  screenshots/
  network/
  console/

  application-state-before.json
  application-state-after.json
  state-diff.json

  grader-results.json

  metrics.json
  report.md
```

Objetivo:

- auditoria;
- reprodução;
- debugging;
- comparação entre versões;
- comparação entre agentes;
- análise de regressões.

---

## 19. Run Manifest obrigatório

Todo run deverá identificar precisamente o que o produziu.

Exemplo:

```yaml
application:
  commit: abc123
  build: 2026.08.30.4

framework:
  version: 0.7.0

persona:
  id: admin-low-tech
  version: 1.3

scenario:
  id: delegation-004
  version: 2.1

dataset:
  version: 14

agent:
  provider: anthropic
  model: ...
  prompt_version: 18

browser:
  engine: chromium
  version: ...

trial:
  seed: 921881
  attempt: 3

clock:
  value: 2027-02-01T10:00:00-03:00
```

Sem manifest completo, resultados históricos não serão considerados plenamente auditáveis.

---

## 20. Controle de tempo

No Expiration Tracker, controle de relógio será requisito estrutural.

Testes sobre vencimentos não deverão depender diretamente de:

```text
Date.now()
```

real.

O framework deverá permitir simulações como:

```text
2026-12-31
     ↓
2027-01-01
```

Posteriormente será necessário avaliar como controlar tempo em:

- frontend;
- backend;
- workers;
- agendadores;
- filas;
- notificações.

Essa avaliação pertence à etapa 2.

---

## 21. Non-determinism deve ser medido

Uma execução isolada não deverá formar um benchmark.

Conceitos relevantes:

```text
pass@k
```

Pelo menos uma das `k` tentativas funcionou.

```text
pass^k
```

Todas as `k` tentativas funcionaram.

Proposta inicial:

| Execução | Trials |
|---|---:|
| PR | testes determinísticos + synthetic smoke |
| Nightly | 3 por combinação selecionada |
| Release candidate | 5 |
| Benchmark aprofundado | ≥10 |

Esses valores deverão medir **estabilidade sintética**, não inferência estatística sobre humanos.

---

## 22. Níveis de confiança para achados

Um achado nunca deverá ser simplesmente rotulado como "problema de UX".

Níveis propostos:

```text
S0 — hypothesis
Uma ocorrência sintética.

S1 — repeated synthetic
Problema reproduzido em múltiplos trials.

S2 — cross-agent corroborated
Claude e Codex reproduziram.

S3 — system corroborated
Existe evidência funcional/telemetria corroborando.

S4 — human validated
Observado posteriormente em usuários reais.
```

---

## 23. Métricas propostas

### Outcome

- Task completion
- Partial completion
- Correct end state

### Behavior

- Steps to completion
- Error count
- Recovery attempts
- Loops/repeated actions
- Abandonment

### Navigation

- Unexpected paths
- Path diversity

### UI

- Misclicks / unsuccessful actions
- Validation errors

### Reliability

- Trial success variance
- Cross-model divergence

### Harness

- Environment failure rate
- Flake rate

### Persona

- Persona adherence

### Performance

- Trial latency

### Economics

- Tokens / cost per trial

### Observability

- Trace completeness

Após testes humanos, poderão ser comparados:

```text
synthetic paths
vs
human paths
```

---

## 24. Accessibility

Personas sintéticas poderão representar diferentes modos de interação:

```text
keyboard-only
screen reader
low digital literacy
high zoom
cognitive load
```

Porém:

> Automação e agentes sintéticos não substituem avaliação humana de acessibilidade.

A camada sintética servirá como preflight e ampliação de cobertura.

---

## 25. Segurança do framework

Como agentes terão controle de browser, a execução deverá ser considerada não confiável.

Requisitos:

```text
isolated test environment
synthetic PII only
test credentials only
network restrictions
no production access
fake email
fake SMS
fake WhatsApp
fake payment providers
restricted file storage
secrets separated from agent context
```

O framework poderá exercitar fluxos de segurança, mas não substituirá ferramentas especializadas de security testing.

---

## 26. Cobertura não é número de personas

Mais personas não significam automaticamente melhor qualidade.

O objetivo será cobrir dimensões comportamentais e riscos.

Coverage matrix inicial:

| Dimensão | Valores cobertos |
|---|---|
| Digital skill | low / medium / high |
| Domain knowledge | low / medium / high |
| Attention | distracted / normal / focused |
| Persistence | low / normal / high |
| Workload | low / medium / high |
| Data quality | clean / messy / corrupted |
| Document volume | small / medium / large |
| User frequency | daily / occasional / rare |
| Notification behavior | responsive / delayed / fatigued |
| Error behavior | careful / error-prone |
| Device/context | desktop / mobile/etc. |
| Accessibility | selected modes |

No futuro, pairwise/combinatorial generation poderá gerar combinações úteis sem explosão combinatória.

---

# 27. Quality Scorecard

Pontuação total: **100 pontos**.

| Dimensão | Peso |
|---|---:|
| Measurement validity | **15** |
| Persona model quality | **10** |
| Scenario/task quality | **10** |
| Oracle & grader quality | **12** |
| Reproducibility & isolation | **10** |
| Coverage & diversity | **8** |
| Observability & auditability | **8** |
| Maintainability & extensibility | **7** |
| Security & privacy | **7** |
| CI efficiency / cost | **5** |
| Accessibility & inclusion | **4** |
| Human calibration strategy | **4** |
| **Total** | **100** |

Cada dimensão:

```text
0 = inexistente
1 = inadequado
2 = parcial
3 = production-grade
4 = exemplar
```

Fórmula:

```text
weighted score =
rating / 4 × weight
```

Thresholds iniciais:

```text
< 70     FAIL

70–84    NEEDS WORK

85–91    PASS

92–100   EXCELLENT
```

Regra:

> Uma boa pontuação total nunca compensa a violação de um Hard Gate.

---

# 28. Hard Gates Claude–Codex

| Gate | Requisito |
|---|---|
| HG-01 | O framework declara explicitamente que synthetic users não substituem humanos. |
| HG-02 | Toda persona possui provenance/evidence status. |
| HG-03 | Atributos demográficos não podem gerar comportamento arbitrariamente sem justificativa. |
| HG-04 | O agente não recebe oracle, resultado esperado ou caminho de navegação. |
| HG-05 | Resultados críticos são avaliados por estado determinístico. |
| HG-06 | Cada cenário importante possui reference solution. |
| HG-07 | Cada trial parte de estado isolado e resetável. |
| HG-08 | Todo run possui manifest reproduzível. |
| HG-09 | Variações estocásticas são seedadas fora do LLM. |
| HG-10 | Cenários temporais usam relógio controlável. |
| HG-11 | Resultados estocásticos importantes usam múltiplos trials. |
| HG-12 | Actor não pode ser o único judge. |
| HG-13 | LLM grader não é autoridade única para functional correctness. |
| HG-14 | Não existem efeitos reais em produção, notificações ou dados pessoais. |
| HG-15 | Toda falha importante possui trace suficiente para auditoria. |
| HG-16 | Falhas de agent/harness/environment são distinguíveis de falhas da aplicação. |
| HG-17 | O framework é model-provider-agnostic. |
| HG-18 | Existe estratégia explícita de futura calibração com usuários humanos. |

---

# 29. Targets quantitativos iniciais

| Métrica do framework | Target inicial |
|---|---:|
| Reference solutions aprovadas | 100% |
| Run manifest completeness | 100% |
| Persona schema validation | 100% |
| Scenario schema validation | 100% |
| Critical oracle deterministic coverage | 100% |
| State reset failures | 0 |
| Production side effects | 0 |
| Trace availability para falhas | 100% |
| Flakiness dos controles determinísticos | <1% |
| Unclassified framework failures | <2% |
| Persona adherence a regras explícitas | ≥90% |
| LLM grader × human agreement antes de virar gate | meta ≥90% |
| LLM grader Cohen's κ | meta ≥0,80 |

Os dois últimos só poderão ser avaliados adequadamente após amostras humanas.

---

# 30. Protocolo Claude–Codex

Modelo sugerido:

```text
             Specification
                  │
        ┌─────────┴─────────┐
        ▼                   ▼
     Claude               Codex
 independent review   independent review
        │                   │
        └─────────┬─────────┘
                  ▼
             Scorecards
                  │
          compare findings
                  │
            disagreement
              analysis
                  │
                  ▼
         deterministic evidence
                  │
                  ▼
            final decision
```

Idealmente, cada modelo faz a primeira avaliação sem ver a avaliação do outro.

Cada critério deverá registrar:

```text
status
score
evidence
file/location
reasoning summary
risk
required remediation
```

Exemplo:

```yaml
criterion: ORACLE-003
requirement: >
  Critical scenario success must be verified
  against application state.

claude:
  score: 4
  evidence:
    - ...

codex:
  score: 2
  evidence:
    - ...

status: disagreement
```

Divergências obrigam investigação.

---

## 31. Evidência técnica obrigatória

Afirmações como:

```text
"parece bem arquitetado"
```

não serão consideradas evidência suficiente.

O protocolo deverá apontar algo verificável:

```text
Criterion:
Every run must contain its model version.

Evidence:
src/run/manifest.ts:41-55
tests/run-manifest.spec.ts
artifacts/run-984/manifest.json
```

A avaliação precisa ser auditável.

---

## 32. Testes do próprio framework

O framework também deverá possuir testes.

Exemplos:

```text
framework unit tests
schema tests
oracle tests
grader tests
dataset integrity tests
fixture reset tests
agent adapter contract tests
telemetry tests
manifest tests
report tests
```

Também será útil criar aplicações/fixtures deliberadamente defeituosas:

```text
fixture app A
botão invisível

fixture app B
form não salva

fixture app C
API salva responsável errado

fixture app D
UI diz sucesso mas DB falhou
```

O framework deverá detectar corretamente esses problemas.

---

## 33. Agent Qualification Suite

Cada combinação agente + adapter deverá poder ser qualificada.

Exemplos:

```text
perception
clicking
typing
navigation
form submission
modal handling
error recognition
basic recovery
```

Somente agentes que passam nessa suíte deverão participar de benchmarks relevantes.

---

## 34. Stack tecnológica — decisão ainda não fechada

BrowserGym, AgentLab, WebArena e UXAgent são excelentes referências arquiteturais e metodológicas.

Entretanto, a hipótese inicial para o Expiration Tracker é:

```text
thin custom framework
       +
Playwright
       +
LLM adapters
       +
our schemas
       +
our oracles
```

Essa decisão **não está fechada**.

Ela deverá ser tomada somente após análise real da arquitetura do Expiration Tracker na etapa 2.

---

## 35. Playwright como principal candidato

Playwright é atualmente o candidato natural para browser execution por fornecer:

- testes baseados em comportamento visível;
- isolamento;
- tracing;
- retries;
- manipulação de relógio;
- integração com CI.

A decisão final deverá considerar a arquitetura real da aplicação.

---

## 36. Evolução das personas

Fase inicial:

```text
Hypothesis Personas
```

Depois dos primeiros testes humanos:

```text
Hypothesis Persona
       ↓
compare
       ↓
Human observation
       ↓
update behavior model
       ↓
Research-grounded Persona
```

Depois da produção:

```text
analytics
support tickets
actual navigation
abandonments
notification behavior
user research
       ↓
Persona calibration
```

Princípio:

> O framework deve aprender com usuários humanos e dados reais, e não tentar provar que não precisa deles.

---

# 37. Estratégia geral de camadas de QA

```text
L0 — Unit / integration / API tests
              │
L1 — Deterministic Playwright E2E
              │
L2 — Synthetic persona functional journeys
              │
L3 — Synthetic behavioral / messy-user testing
              │
L4 — Synthetic heuristic / UX evaluation
              │
L5 — Accessibility automation + synthetic exploration
              │
L6 — Human usability testing
              │
L7 — Production telemetry / feedback
              │
              └──────► recalibrate synthetic framework
```

As personas sintéticas serão uma nova camada de QA, não substitutas das demais.

---

# 38. Princípio filosófico central

> **O framework deve ser muito bom em produzir hipóteses sobre comportamento humano e evidências sobre o comportamento da aplicação, mas extremamente cuidadoso em não confundir as duas coisas.**

Essa distinção deverá orientar toda a arquitetura, implementação, métricas e interpretação dos resultados.

---

# 39. Baseline consolidada

A etapa de fundação estabelece os seguintes blocos:

```text
Synthetic Persona Framework
│
├── Quality Model
│   └── 100-point Claude–Codex scorecard
│
├── Quality Gates
│   └── HG-01 ... HG-18
│
├── Evaluation Model
│   ├── Persona
│   ├── Context
│   ├── Dataset
│   ├── Scenario
│   ├── Goal
│   ├── Trial
│   ├── Trace
│   ├── Outcome
│   └── Grader
│
└── Evidence Model
    ├── hypothesis
    ├── repeated synthetic
    ├── cross-agent corroborated
    ├── system corroborated
    └── human validated
```

---

# 40. Próxima etapa

A segunda etapa deverá analisar profundamente o Expiration Tracker para transformar esta baseline genérica em uma arquitetura específica da aplicação.

A análise deverá cobrir, entre outros:

- arquitetura;
- frontend;
- backend;
- autenticação;
- papéis e permissões;
- modelos de dados;
- documentos;
- vencimentos;
- responsáveis;
- notificações;
- uploads;
- extração por IA;
- APIs;
- banco de dados;
- workers;
- agendamentos;
- CI;
- infraestrutura de testes;
- ambientes;
- observabilidade;
- mecanismos de reset;
- controle de tempo;
- mocks de email/SMS/WhatsApp.

A partir disso serão definidos:

```text
personas reais do domínio
datasets
scenarios
goals
oracles
journeys
coverage matrix
CI strategy
framework architecture
```

A ordem metodológica será:

> **primeiro definir o método e o padrão de qualidade; depois deixar a aplicação informar as personas e os testes.**

---

# Referências principais utilizadas na pesquisa

- ISO 9241-11 — Ergonomics of human-system interaction: Usability.
- ISO/IEC 25010:2023 — Systems and software Quality Requirements and Evaluation (SQuaRE): Product quality model.
- ISO/IEC 25019:2023 — Quality-in-use model.
- NIST AI Risk Management Framework / AI Resource Center.
- W3C Web Accessibility Initiative — avaliação e ferramentas de acessibilidade.
- OWASP Web Security Testing Guide.
- Playwright documentation — best practices, tracing, test isolation, clock control.
- WebArena — benchmark de agentes web.
- VisualWebArena — avaliação de agentes em interfaces visuais.
- BrowserGym — ambientes para pesquisa e avaliação de agentes web.
- AgentLab — framework para desenvolvimento e avaliação de agentes web.
- UXAgent — uso de LLM agents como synthetic users antes de estudos humanos.
- Anthropic — agent evaluation methodology, deterministic graders, task design e multiple trials.
- OpenAI — práticas de evals e calibração de graders.
- Estudos recentes sobre limitações de synthetic users e exagero de relações demográficas em LLMs.

---

**Status:** Research & Quality Baseline v1  
**Uso pretendido:** fundamento metodológico e de qualidade para a futura implementação do Synthetic Persona Evaluation Framework do Expiration Tracker.
