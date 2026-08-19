# PROMPT MESTRE — ENGINEERING MATURITY REVIEW

Você está trabalhando no repositório **Expiration Tracker**.

Este trabalho é uma continuação natural do processo rigoroso utilizado anteriormente para definir e validar a arquitetura do projeto, mas **o objeto desta revisão não é mais a arquitetura**.

O objetivo agora é:

> **estabelecer, avaliar, implementar e validar um padrão geral de engenharia de software de nível profissional para todo o projeto.**

Você deverá trabalhar em conjunto com o **Codex como segundo engenheiro independente**, reproduzindo a disciplina do processo Claude ↔ Codex utilizado na fase arquitetural:

**pesquisa → critérios → proposta/análise independente → crítica → tréplica → correção → nova avaliação → nota independente → aprovação ou nova rodada.**

O processo deve ser baseado principalmente em **evidências verificáveis no repositório e na execução real de ferramentas**, e não em declarações, documentação aspiracional ou percepção subjetiva.

---

# 1. OBJETIVO PRINCIPAL

Avaliar e elevar o **Engineering Maturity** do projeto como um todo.

A pergunta central não é:

> "A arquitetura é boa?"

Essa questão pertence ao processo anterior.

A pergunta agora é:

> **"Este projeto está sendo construído, testado, versionado, protegido, entregue, observado, documentado e mantido de acordo com padrões de engenharia de software suficientemente fortes para sustentar um produto profissional?"**

A avaliação deverá cobrir, no mínimo:

- qualidade e manutenibilidade do código;
- organização do repositório;
- boundaries entre módulos;
- aderência da implementação à arquitetura;
- type safety e contratos;
- tratamento de erros;
- idempotência e concorrência;
- testes;
- qualidade dos testes;
- CI;
- CD;
- release engineering;
- reprodutibilidade;
- dependency management;
- segurança;
- secure SDLC;
- software supply chain;
- IaC;
- configuração;
- gerenciamento de secrets;
- observabilidade;
- operabilidade;
- confiabilidade;
- resiliência;
- runbooks;
- qualidade da documentação;
- Developer Experience;
- automação;
- performance;
- eficiência;
- gestão de dívida técnica;
- disciplina de mudanças;
- engenharia de dados/persistência;
- qualidade de APIs e contratos;
- governança de dependências;
- engenharia assistida por IA;
- rastreabilidade das decisões;
- capacidade de evolução do projeto.

Não se limite a essa lista.

A **Fase 0 deve pesquisar na Internet quais dimensões adicionais são necessárias**.

---

# 2. REGRA FUNDAMENTAL: NÃO REFAZER A ARQUITETURA

Antes de iniciar:

1. leia `ARCHITECTURE.md`;
2. leia os documentos relevantes de `docs/architecture/`;
3. entenda as decisões arquiteturais existentes;
4. trate essas decisões como **baseline arquitetural do projeto**.

A arquitetura já passou por processo próprio de revisão.

Portanto:

**NÃO transforme esta revisão em uma nova Architecture Review.**

O foco deve ser verificar:

- se o código respeita os boundaries definidos;
- se a implementação preserva as propriedades arquiteturais;
- se as abstrações escolhidas são bem implementadas;
- se existem violações de arquitetura;
- se existem dependências indevidas;
- se os contratos estão claros;
- se as garantias arquiteturais possuem mecanismos reais de enforcement.

Uma mudança arquitetural somente pode ser proposta quando:

1. houver evidência concreta de que uma decisão existente impede engenharia correta;
2. a questão não puder ser resolvida no nível de implementação;
3. Claude e Codex concordarem;
4. a mudança for explicitamente marcada como:

`ARCHITECTURE CHANGE REQUIRED`

5. um ADR separado for proposto.

Não modificar silenciosamente decisões arquiteturais durante uma revisão de engenharia.

---

# 3. NÃO HERDAR AS NOTAS DA ARQUITETURA

As notas obtidas anteriormente no processo arquitetural **não têm qualquer influência sobre esta avaliação**.

Um projeto pode ter:

- arquitetura 9.5;
- engenharia 5.0.

Ou o contrário.

Não use os scores anteriores como priors.

Não tente preservar coerência com as notas anteriores.

Faça uma avaliação nova e independente.

---

# 4. FASE 0 — PESQUISA EXTERNA OBRIGATÓRIA

Antes de criar a rubrica ou avaliar qualquer código, realize uma **pesquisa atualizada na Internet**.

A pesquisa deve responder:

> Quais são, atualmente, os principais critérios reconhecidos para avaliar a maturidade de engenharia de um software moderno, cloud-native/serverless e operado profissionalmente?

Use prioritariamente **fontes primárias, normativas ou mantidas pelos responsáveis pelos frameworks**.

Comece, no mínimo, investigando:

- ISO/IEC 25010;
- DORA;
- NIST Secure Software Development Framework — SSDF;
- OWASP SAMM;
- OpenSSF Scorecard;
- SLSA;
- AWS Well-Architected Framework;
- AWS Operational Excellence;
- AWS Security;
- AWS Reliability;
- Google SRE;
- práticas oficiais relacionadas a CI/CD;
- práticas oficiais relacionadas a software supply chain;
- práticas oficiais relacionadas a dependency management;
- práticas oficiais relacionadas a testing;
- práticas oficiais relacionadas a observability;
- práticas oficiais relacionadas a secure software development.

Pesquise também outras referências relevantes caso encontre frameworks ou evidências melhores.

Não assuma que uma versão lembrada pelo modelo ainda é a atual.

Verifique:

- versão;
- status;
- data;
- se é final, draft ou deprecated;
- escopo;
- aplicabilidade ao projeto.

Prefira documentos atuais e oficiais.

Drafts podem complementar a análise, mas não devem substituir silenciosamente uma versão normativa/final.

---

# 5. DOCUMENTO DE PESQUISA

Crie:

`docs/engineering/00-research-bibliography.md`

Para cada fonte utilizada registre:

- organização;
- documento/framework;
- versão, quando aplicável;
- data;
- URL;
- data da consulta;
- quais critérios de engenharia foram derivados dela;
- limitações;
- se é normativa, recomendação, pesquisa empírica ou ferramenta de avaliação.

Não copie extensivamente os textos das fontes.

Extraia princípios e critérios.

---

# 6. CRITÉRIOS DEVEM SER DEFINIDOS ANTES DA AVALIAÇÃO

Esta regra é obrigatória.

Primeiro:

1. pesquisar;
2. definir critérios;
3. definir pesos;
4. definir gates;
5. Claude revisar;
6. Codex revisar independentemente;
7. resolver divergências;
8. congelar a rubrica.

**Somente depois disso o repositório pode receber uma nota.**

Isso existe para evitar moving goalposts.

Depois da primeira avaliação, os pesos não podem ser modificados simplesmente porque determinado resultado ficou baixo.

Se a rubrica precisar ser alterada posteriormente, documente:

- motivo;
- evidência nova;
- impacto;
- aprovação de Claude;
- aprovação de Codex.

---

# 7. RUBRICA DE ENGENHARIA

Crie:

`docs/engineering/01-engineering-quality-criteria.md`

A rubrica deverá totalizar exatamente:

**100%**

Claude e Codex deverão discutir e aprovar os pesos.

Não prescrevo os pesos finais, mas a rubrica deverá cobrir materialmente pelo menos os seguintes domínios.

## A. Code Quality & Maintainability

Avaliar, entre outros:

- modularidade;
- coesão;
- acoplamento;
- clareza;
- naming;
- tamanho e responsabilidade das unidades;
- abstrações;
- duplicação;
- complexidade;
- dead code;
- organização;
- testabilidade;
- estabilidade dos boundaries;
- manejo de dependências;
- facilidade de alteração;
- presença de hacks ou soluções temporárias;
- dívida técnica explícita versus implícita.

Não confundir "código elegante" com engenharia correta.

---

## B. Type Safety, Contracts & Correctness

Avaliar:

- uso adequado do sistema de tipos;
- propagação de `any`, casts ou equivalentes;
- validação de entrada;
- contratos externos;
- schemas;
- serialização;
- parsing;
- validação runtime;
- invariantes;
- estados impossíveis;
- erros esperados;
- erros inesperados;
- concorrência;
- idempotência;
- controle de versão de contratos.

Para caminhos críticos, verificar se invariantes existem apenas na documentação ou se são realmente enforceados.

---

## C. Testing Engineering

Não avaliar apenas "coverage".

Avaliar:

- unit tests;
- integration tests;
- contract tests;
- API tests;
- infrastructure tests;
- end-to-end tests;
- smoke tests;
- testes negativos;
- testes de autorização;
- isolamento entre tenants;
- idempotência;
- concorrência;
- retry;
- timeout;
- falhas parciais;
- DLQ;
- race conditions;
- property-based testing quando apropriado;
- performance tests;
- load tests;
- restore tests;
- disaster recovery tests;
- testes de migrations quando aplicável.

Avaliar também:

- qualidade das assertions;
- brittleness;
- excesso de mocks;
- falsos positivos;
- flaky tests;
- velocidade;
- determinismo;
- capacidade de localizar regressões.

**Coverage alto não deve compensar testes ruins.**

---

## D. Continuous Integration

Avaliar:

- build automático;
- lint;
- format;
- type checking;
- testes;
- security scanning;
- IaC validation;
- dependency scanning;
- secret scanning;
- feedback rápido;
- comportamento em falhas;
- branch checks;
- proteção contra merge quebrado;
- cache;
- paralelização;
- reproducibilidade;
- permissões do CI;
- pinning das Actions;
- uso de OIDC quando aplicável.

Verifique o que realmente roda em cada PR.

Não dar pontos por scripts que existem mas não são executados.

---

## E. Continuous Delivery & Release Engineering

Avaliar:

- capacidade real de deploy;
- automação;
- ambientes;
- promoção;
- rollback;
- roll-forward;
- versionamento;
- artefatos;
- proveniência;
- atomicidade;
- migrations;
- deployment safety;
- approvals;
- deployment verification;
- smoke tests;
- release notes quando apropriado;
- rastreabilidade commit → build → deploy.

---

## F. Secure Software Engineering

Derivar principalmente de SSDF/SAMM e outras fontes oficiais.

Avaliar:

- secure by default;
- threat-informed development;
- secrets;
- IAM;
- least privilege;
- authorization;
- input validation;
- dependency vulnerabilities;
- SAST;
- SCA;
- secret scanning;
- security tests;
- triagem de vulnerabilidades;
- segurança do CI;
- segurança de artefatos;
- response process;
- security policy;
- logs sensíveis;
- PII;
- criptografia;
- abuse cases;
- webhook validation;
- replay;
- SSRF;
- injection;
- supply-chain attacks.

Considere o threat model arquitetural existente quando ele existir.

---

# 8. SOFTWARE SUPPLY CHAIN

Avaliar explicitamente:

- dependency pinning;
- lockfiles;
- atualização automatizada;
- dependências abandonadas;
- vulnerabilidades;
- origem dos packages;
- artefatos binários;
- GitHub Actions pinning;
- permissões de workflows;
- branch protection;
- code review;
- provenance;
- SBOM quando justificável;
- assinaturas;
- release provenance;
- reprodutibilidade;
- OpenSSF Scorecard;
- conceitos relevantes do SLSA.

Não exija mecanismos avançados apenas para gerar uma nota alta.

O objetivo é **proporcionalidade de risco**.

---

# 9. INFRASTRUCTURE ENGINEERING / IaC

Avaliar:

- qualidade do CDK/Terraform/IaC utilizado;
- organização;
- reutilização;
- boundaries;
- naming;
- environments;
- config;
- secrets;
- IAM;
- drift;
- synth/plan;
- deploy;
- rollback;
- state;
- lifecycle;
- destruição acidental;
- observabilidade dos recursos;
- segurança;
- tagging;
- budgets;
- testabilidade;
- validação no CI.

A infraestrutura deve ser avaliada como **software**, não apenas como configuração.

---

# 10. RELIABILITY ENGINEERING

Verificar se as propriedades descritas na arquitetura realmente existem na implementação.

No contexto deste projeto, dê atenção especial a:

- idempotência;
- retries;
- backoff;
- poison messages;
- DLQs;
- reconciliation;
- sweeper;
- OCC;
- outbox;
- duplicate delivery;
- partial failure;
- eventual consistency;
- timeouts;
- unavailable dependencies;
- rate limiting;
- provider failures;
- clock/timezone handling;
- reminder correctness;
- recovery.

Para cada garantia importante, tente responder:

> Qual mecanismo concreto impede que esta garantia seja violada?

---

# 11. OBSERVABILITY & OPERABILITY

Avaliar:

- logs;
- structured logging;
- correlation IDs;
- traces;
- métricas;
- alarmes;
- dashboards;
- SLOs;
- alertas acionáveis;
- cardinalidade;
- PII nos logs;
- troubleshooting;
- runbooks;
- incident response;
- DLQ handling;
- debugging;
- health information;
- capacidade de identificar falhas silenciosas.

Não pontuar observabilidade apenas porque o código chama uma biblioteca de logging.

---

# 12. DEVELOPER EXPERIENCE

Avaliar a experiência de um engenheiro novo entrando no projeto.

Pergunta prática:

> Um engenheiro competente consegue clonar este repositório e trabalhar com segurança sem depender de conhecimento tribal?

Avaliar:

- README;
- bootstrap;
- setup;
- requisitos;
- desenvolvimento local;
- comandos;
- seeds/fixtures;
- mocks;
- testes;
- debug;
- workflows;
- Makefile/task runner/package scripts;
- mensagens de erro;
- documentação;
- descoberta de componentes;
- facilidade de localizar código;
- velocidade de feedback;
- paridade razoável entre local e CI.

Faça o teste quando possível.

---

# 13. DOCUMENTATION ENGINEERING

Avaliar:

- README;
- arquitetura;
- ADRs;
- engineering docs;
- runbooks;
- APIs;
- schemas;
- procedimentos operacionais;
- onboarding;
- comentários de código;
- decisões;
- documentação de trade-offs;
- links quebrados;
- divergência docs ↔ código;
- documentação obsoleta;
- excesso de documentação inútil.

Documentação deve ser:

- correta;
- encontrável;
- atual;
- proporcional;
- orientada a tarefas;
- útil tanto a humanos quanto a agentes de IA.

---

# 14. DATA & STATE ENGINEERING

Como o projeto possui estado e usa DynamoDB, analisar também:

- access patterns;
- invariantes;
- key construction;
- isolamento;
- conditional writes;
- OCC;
- idempotency keys;
- transaction boundaries;
- pagination;
- consistency assumptions;
- GSI behavior;
- hot partitions;
- schema evolution;
- backward compatibility;
- TTL;
- retention;
- deletion;
- recovery;
- test fixtures;
- auditability.

Não refazer o data model arquitetural.

Avaliar a **qualidade de sua implementação**.

---

# 15. PERFORMANCE & EFFICIENCY ENGINEERING

Avaliar proporcionalmente ao estágio do produto:

- hot paths;
- N+1;
- chamadas desnecessárias;
- tamanho de payload;
- memória;
- cold starts;
- batching;
- concurrency;
- caching;
- Lambda configuration;
- DynamoDB access;
- SQS usage;
- network calls;
- timeout budgets;
- custo acidental;
- testes de performance.

Não criar premature optimization.

Também não aceitar ausência total de mecanismos para detectar regressões importantes.

---

# 16. ENGINEERING GOVERNANCE

Avaliar:

- branch protection;
- pull requests;
- code review;
- CODEOWNERS;
- commit hygiene;
- issue templates quando úteis;
- PR templates;
- change discipline;
- releases;
- semantic versioning quando aplicável;
- ownership;
- exceções;
- technical debt registry;
- critérios de pronto;
- políticas de segurança;
- dependências;
- processo de melhoria contínua.

Considere o tamanho atual do projeto.

Não copie processos de uma empresa de 10.000 pessoas para um projeto pequeno.

---

# 17. AI-ASSISTED ENGINEERING

Este projeto é desenvolvido com uso relevante de Claude e Codex.

Isso deve ser considerado explicitamente.

Avalie:

- `CLAUDE.md`;
- `AGENTS.md`;
- arquivos de contexto;
- instruções aos agentes;
- consistência entre instruções e código;
- proteção contra agentes modificarem áreas erradas;
- qualidade dos critérios de aceite;
- validação automática das mudanças geradas por IA;
- capacidade de um humano compreender mudanças produzidas por IA;
- revisão independente;
- risco de dois agentes confirmarem o mesmo erro;
- proveniência das decisões;
- excesso de documentação feita para agentes e ruim para humanos;
- mecanismos que impedem "AI slop".

Princípio:

> **Código gerado por IA deve cumprir exatamente os mesmos gates que código humano.**

Nunca aceitar:

> "Claude analisou e achou correto"

como evidência de engenharia.

---

# 18. FITNESS FUNCTIONS

Crie:

`docs/engineering/02-engineering-fitness-functions.md`

Transforme os critérios importantes em verificações executáveis sempre que possível.

Exemplos de categorias:

- build;
- typecheck;
- lint;
- format;
- unit tests;
- integration tests;
- contract tests;
- architecture boundary tests;
- IaC synth;
- IaC validation;
- secret scanning;
- SAST;
- dependency scanning;
- security checks;
- license policy quando relevante;
- lockfile validation;
- API schema validation;
- dependency direction;
- duplicate dependency versions;
- flaky tests;
- performance budgets;
- bundle/package size quando aplicável;
- documentation validation;
- smoke tests;
- deployment validation.

Cada fitness function deve indicar:

- objetivo;
- risco mitigado;
- comando;
- quando roda;
- comportamento esperado;
- consequência em caso de falha;
- se bloqueia PR;
- se bloqueia deploy.

---

# 19. GATES ELIMINATÓRIOS

Defina Engineering Gates antes da avaliação.

Os gates finais devem ser discutidos por Claude e Codex.

No mínimo, avalie se devem existir gates relacionados a:

- build reproduzível;
- CI obrigatório;
- testes críticos;
- ausência de secrets conhecidos no repositório;
- vulnerabilidades críticas não tratadas;
- dependências reproduzíveis;
- autorização/isolamento;
- segurança de workflows;
- rollback/recovery;
- integridade de dados;
- tenant isolation;
- arquitetura crítica sendo enforceada;
- paths críticos possuindo testes;
- infraestrutura validável;
- nenhuma falha silenciosa conhecida em reminder processing.

Um gate não pode ser removido posteriormente para aumentar a nota.

---

# 20. EVIDENCE-FIRST

Esta é uma das regras mais importantes de todo o processo.

Hierarquia de evidência:

1. execução real;
2. testes executáveis;
3. código/configuração;
4. histórico CI/CD verificável;
5. artefatos;
6. documentação;
7. declaração.

Documentação que diz:

> "Todos os endpoints possuem autorização"

não é prova.

Procure:

- middleware;
- guards;
- IAM;
- testes;
- políticas;
- execução.

Documentação que diz:

> "Possuímos restore test"

não recebe crédito se nenhum restore tiver sido executado.

---

# 21. AUSÊNCIA DE EVIDÊNCIA

**Evidence unavailable ≠ neutral score.**

Se um critério exige evidência e ela não existe:

- não inventar;
- não presumir;
- não dar nota neutra;
- marcar `NOT PROVEN`;
- aplicar a consequência prevista na rubrica.

"Nunca tivemos incidente" não significa:

> incident response = 10.

"Nunca tivemos carga alta" não significa:

> scalability = 10.

---

# 22. N/A

`N/A` só é permitido quando o critério realmente não se aplica ao projeto.

Cada N/A deve conter:

- justificativa;
- impacto;
- concordância de Claude;
- concordância de Codex.

N/A não pode ser usado para esconder uma deficiência.

Se um peso precisar ser redistribuído, a regra de redistribuição deve estar definida **antes da primeira avaliação**.

---

# 23. BASELINE CONGELADO

Antes de analisar:

registre:

- commit SHA;
- branch;
- timestamp;
- `git status`;
- stack identificada;
- package managers;
- lockfiles;
- workflows;
- IaC;
- testes;
- ferramentas.

Crie:

`docs/engineering/03-repository-baseline.md`

A avaliação inicial deve se referir exatamente a esse estado.

Se forem feitas correções posteriormente, registre o novo SHA.

Assim será possível mostrar:

`BEFORE → AFTER`

---

# 24. NÃO MODIFICAR DURANTE A PRIMEIRA AVALIAÇÃO

Primeiro produza um diagnóstico **as-is**.

Não corrija imediatamente o que encontrar.

Caso contrário perdemos a baseline.

Fluxo:

1. Freeze baseline.
2. Evaluate.
3. Score.
4. Identify gaps.
5. Prioritize.
6. Propose remediation.
7. Peer review.
8. Implement.
9. Re-test.
10. Re-score.

---

# 25. PROCESSO CLAUDE ↔ CODEX

O Codex deve atuar como **engenheiro independente**, não como assistente subordinado.

Use o mesmo mecanismo real de integração Claude ↔ Codex disponível no ambiente/repositório.

**Não simule respostas do Codex.**

Se o Codex estiver indisponível:

`CODEX REVIEW BLOCKED`

e não invente uma segunda avaliação.

---

# 26. INDEPENDÊNCIA ENTRE OS REVISORES

Para cada checkpoint relevante:

### Passo A — Claude

Claude analisa a evidência e registra sua conclusão.

### Passo B — Codex Blind Review

Envie ao Codex:

- critérios congelados;
- artefato analisado;
- arquivos relevantes;
- evidências.

Não forneça:

- a nota de Claude;
- conclusão final de Claude;
- expectativa de nota;
- instrução para "confirmar".

Pergunte ao Codex:

> Faça uma avaliação independente. Procure ativamente falhas, inconsistências, riscos e pontos superavaliados.

### Passo C — Divergence Analysis

Compare os resultados.

Crie:

- pontos de acordo;
- pontos de desacordo;
- evidências conflitantes;
- gaps encontrados apenas por um revisor.

### Passo D — Cross Critique

Claude deve responder às objeções do Codex.

Codex deve poder contestar a tréplica.

### Passo E — Corrected Artifact

Produza a versão corrigida.

### Passo F — Independent Score

Claude e Codex avaliam novamente **independentemente**.

---

# 27. ANTI-CONFIRMATION-BIAS

Durante a revisão, os dois engenheiros devem procurar explicitamente razões para **reduzir** a nota.

Perguntas obrigatórias:

- O que estamos assumindo sem evidência?
- Que falha só apareceria em produção?
- Que teste está ausente?
- Que comportamento parece correto apenas no happy path?
- Há abstrações excessivas?
- Há abstrações insuficientes?
- Há código difícil de remover?
- Há dependência desnecessária?
- Existe algo que funciona apenas porque os testes mockam demais?
- Existe segurança apenas no edge e não no domínio?
- Existem claims documentais sem enforcement?
- O CI realmente impediria esta regressão?
- Um novo engenheiro conseguiria alterar isto com segurança?
- Um agente de IA conseguiria quebrar um boundary sem CI perceber?
- Estamos premiando complexidade em vez de simplicidade?

---

# 28. RED TEAM DE ENGENHARIA

Depois das revisões por domínio, faça uma fase específica de Red Team.

Claude e Codex devem executar rodadas independentes buscando:

- bypass de validação;
- bypass de autorização;
- tenant escape;
- missing idempotency;
- double delivery;
- race conditions;
- stale state;
- partial writes;
- orphan records;
- inconsistência docs ↔ código;
- CI bypass;
- supply-chain weaknesses;
- workflow permissions excessivas;
- unpinned dependencies;
- secret leakage;
- logging de dados sensíveis;
- retry storms;
- poison messages;
- DLQ sem tratamento;
- silent failures;
- paths sem teste;
- código morto;
- complexidade acidental;
- abstrações prematuras;
- pontos únicos de manutenção difícil;
- false-green CI.

Crie:

`docs/engineering/red-team/`

e mantenha as avaliações Claude e Codex separadas antes da consolidação.

---

# 29. FERRAMENTAS

Use as ferramentas adequadas à stack encontrada.

Não prescreva uma ferramenta apenas porque ela é popular.

Antes de adicionar algo:

1. identificar necessidade;
2. comparar alternativas;
3. avaliar custo de manutenção;
4. justificar escolha.

Pode utilizar, quando aplicável:

- ferramentas nativas do ecossistema;
- linters;
- type checkers;
- test frameworks;
- security scanners;
- dependency scanners;
- secret scanners;
- IaC scanners;
- OpenSSF Scorecard;
- ferramentas de coverage;
- ferramentas de complexity;
- ferramentas de mutation testing;
- ferramentas de dependency graph;
- ferramentas de architecture testing.

Mas:

> **mais ferramentas ≠ melhor engenharia.**

Prefira o conjunto mínimo que cria feedback forte.

---

# 30. COBERTURA DE TESTES

Não defina arbitrariamente:

`coverage >= 90%`

e conclua que isso representa qualidade.

Coverage é apenas evidência auxiliar.

Faça análises específicas de:

- critical paths;
- branch coverage;
- mutation resistance quando razoável;
- fault scenarios;
- invariants;
- negative paths.

Uma linha de código extremamente crítica pode merecer muito mais atenção que centenas de linhas triviais.

---

# 31. CODE REVIEW DO REPOSITÓRIO INTEIRO

Não examine apenas os arquivos principais.

Faça inventário por áreas:

- application;
- domain;
- infrastructure;
- adapters;
- API;
- persistence;
- notification;
- document pipeline;
- AI/OCR;
- authentication;
- authorization;
- IaC;
- workflows;
- scripts;
- tests;
- config;
- docs.

Use amostragem somente quando o volume tornar revisão integral impraticável.

Se usar amostragem, documente claramente:

- método;
- arquivos;
- razão;
- limitações.

---

# 32. DEPENDENCY GRAPH

Construa ou derive o dependency graph interno.

Procure:

- ciclos;
- imports atravessando boundaries;
- domínio dependendo de infraestrutura;
- adapters contaminando regras de negócio;
- abstrações vazando;
- dependências "god module";
- utilitários globais;
- shared code excessivo.

Compare com o monólito modular definido arquiteturalmente.

Se possível, transforme os boundaries importantes em **fitness functions automatizadas**.

---

# 33. ERROR HANDLING REVIEW

Faça revisão explícita de:

- exception handling;
- swallowed errors;
- generic catch;
- retryability;
- user-facing errors;
- logging;
- correlation;
- taxonomy;
- provider errors;
- timeout;
- cancellation;
- dead-letter behavior.

Procure especialmente códigos do tipo:

```text
catch {
  return;
}
```

ou equivalentes semanticamente silenciosos.

---

# 34. CONFIGURATION REVIEW

Mapeie:

- environment variables;
- defaults;
- feature flags;
- secrets;
- stage-specific configuration;
- AppConfig;
- runtime configuration;
- deploy-time configuration.

Verifique:

- tipos;
- validação;
- comportamento ausente;
- fail-open versus fail-closed;
- documentação;
- secrets fora de logs;
- secrets fora do Git.

---

# 35. REMEDIATION ROADMAP

Depois da baseline, produza:

`docs/engineering/remediation-roadmap.md`

Classifique cada gap:

- P0 — bloqueador;
- P1 — alto;
- P2 — médio;
- P3 — melhoria.

Para cada item:

- problema;
- evidência;
- risco;
- dimensão da rubrica;
- source/reference;
- correção;
- complexidade;
- dependências;
- critério de aceite;
- teste necessário;
- fitness function necessária;
- risco de regressão.

---

# 36. IMPLEMENTAÇÃO DAS CORREÇÕES

Depois que Claude e Codex concordarem sobre o remediation roadmap, implemente as melhorias de engenharia.

Não implementar novas funcionalidades de produto simplesmente para aumentar a nota.

Prioridade:

1. correctness;
2. security;
3. reliability;
4. testability;
5. CI enforcement;
6. maintainability;
7. DevEx;
8. refinements.

Para cada mudança:

- manter escopo pequeno;
- adicionar teste correspondente;
- atualizar documentação relevante;
- executar validações;
- registrar evidência.

---

# 37. NÃO FAZER "QUALITY THEATER"

Exemplos proibidos:

- criar 50 documentos que ninguém usa;
- adicionar ferramentas apenas para ganhar checklist;
- adicionar abstrações sem necessidade;
- exigir 100% coverage;
- criar microsserviços;
- criar processos empresariais desproporcionais;
- adicionar Kubernetes;
- adicionar scanners redundantes;
- usar dashboards como substitutos de confiabilidade;
- considerar badge como substituto de evidência.

Cada melhoria deve responder:

> Qual risco real isto reduz?

---

# 38. CRITÉRIO DE SIMPLICIDADE

Simplicidade é parte da nota.

Penalize:

- overengineering;
- abstraction factories;
- wrapper sobre wrapper;
- configuração excessiva;
- padrões utilizados sem necessidade;
- frameworks internos prematuros;
- dependências evitáveis;
- generalização antes de existir segundo caso de uso.

Pergunta obrigatória:

> Esta solução é a mais simples que mantém as garantias necessárias?

---

# 39. PROPORCIONALIDADE

Avalie o projeto como:

- micro-SaaS;
- equipe pequena;
- serverless-first;
- AWS;
- produto em estágio inicial;
- potencial de crescimento.

Não compare sua governança com:

- banco global;
- hyperscaler;
- sistema militar.

Por outro lado:

**estágio inicial não justifica falhas básicas de engenharia.**

Secrets no Git, testes críticos ausentes, CI falso, falta de isolamento ou ausência de idempotência continuam sendo graves.

---

# 40. DOIS EIXOS DE MATURIDADE

A avaliação final deve separar explicitamente:

## A. ENGINEERING FOUNDATION

Pode ser avaliada através de:

- código;
- testes;
- estrutura;
- workflows;
- IaC;
- documentação;
- automação;
- segurança;
- tooling.

## B. OPERATIONAL ENGINEERING EVIDENCE

Exige evidência como:

- builds reais;
- pipelines reais;
- deploys;
- load tests;
- recovery tests;
- restore tests;
- rollback;
- incident response;
- observabilidade em execução;
- métricas reais;
- behaviour under failure.

Uma fundação excelente não autoriza inventar evidência operacional.

---

# 41. STATUS

Utilize:

```text
ENGINEERING FOUNDATION STATUS: APPROVED | NOT APPROVED
OPERATIONAL ENGINEERING STATUS: APPROVED | NOT APPROVED
```

O segundo pode legitimamente permanecer:

`NOT APPROVED`

enquanto o produto não possuir evidência operacional suficiente.

Isso **não reduz artificialmente a nota da fundação**.

---

# 42. SCORING

Cada critério recebe nota:

`0.00 – 10.00`

Calcule:

- score Claude;
- score Codex;
- weighted score;
- divergência.

Não arredondar um score insuficiente para aprovação.

Exemplo:

`8.996`

continua menor que:

`9.000`

Mesmo que seja exibido como `9.00`.

Use precisão interna suficiente.

---

# 43. REGRA DE APROVAÇÃO POR CHECKPOINT

Um checkpoint somente é aprovado quando:

```text
Claude >= 9.0
AND
Codex >= 9.0
AND
all applicable gates PASS
AND
no unresolved P0
```

Não use média dos dois para esconder divergência.

Se:

```text
Claude = 9.4
Codex = 8.7
```

resultado:

`NOT APPROVED`

Faça nova rodada.

---

# 44. NOTA CONSERVADORA

Além das duas notas, calcule:

`CONSERVATIVE SCORE = min(Claude, Codex)`

Essa será a principal nota resumida do checkpoint.

Não use apenas média.

---

# 45. DISAGREEMENT LOG

Crie:

`docs/engineering/disagreement-log.md`

Para toda divergência material registre:

- ID;
- tema;
- Claude;
- Codex;
- evidência;
- resolução;
- mudança resultante;
- status.

Não esconda divergências na versão final.

Elas são evidência de revisão real.

---

# 46. ENGINEERING DECISION LOG

Crie:

`docs/engineering/decisions-log.md`

IDs:

`E-000`

`E-001`

`E-002`

...

Registre decisões como:

- ferramenta de lint;
- estratégia de testes;
- dependency policy;
- coverage philosophy;
- CI gates;
- supply-chain policy;
- release strategy;
- exception policy.

---

# 47. EXCEPTION REGISTRY

Crie:

`docs/engineering/exceptions.md`

Uma regra pode ser conscientemente violada quando houver razão forte.

Registre:

- regra;
- justificativa;
- risco;
- owner;
- data;
- expiry/review date;
- compensating control.

Evite exceções permanentes silenciosas.

---

# 48. CHECKPOINTS

Execute, no mínimo, os seguintes checkpoints:

### Checkpoint 0
Research + Evaluation Method

### Checkpoint 1
Engineering Quality Criteria + Gates + Fitness Functions

### Checkpoint 2
Repository Baseline + Engineering Structure

### Checkpoint 3
Code Quality + Maintainability + Architecture Fidelity

### Checkpoint 4
Testing & Correctness

### Checkpoint 5
CI/CD + Release Engineering + Reproducibility

### Checkpoint 6
Security + Secure SDLC + Software Supply Chain

### Checkpoint 7
Infrastructure Engineering + Configuration

### Checkpoint 8
Reliability + Observability + Operability

### Checkpoint 9
Data/State Correctness + Performance/Efficiency

### Checkpoint 10
Developer Experience + Documentation + Governance

### Checkpoint 11
AI-Assisted Engineering

### Checkpoint 12
Engineering Red Team

### Checkpoint 13
Remediation Implementation

### Checkpoint 14
Final Engineering Assessment

Cada checkpoint relevante deve passar pelo processo Claude ↔ Codex.

---

# 49. FORMATO DAS REVIEWS

Salve reviews em:

```text
docs/engineering/reviews/
```

Exemplo:

```text
checkpoint-04-testing/
  claude-round1.md
  codex-round1.md
  divergence-round1.md
  corrected-round1.md
  claude-score-round1.md
  codex-score-round1.md
```

Se houver segunda rodada:

```text
  claude-round2.md
  codex-round2.md
  ...
```

Isso torna o processo auditável.

---

# 50. EVIDENCE MATRIX

Crie:

`docs/engineering/evidence-matrix.md`

Formato aproximado:

| ID | Critério | Peso | Evidência | Arquivo/linha/comando | Claude | Codex | Status |
|---|---:|---:|---|---|---:|---:|---|

Nenhum score alto deve existir sem evidência correspondente.

---

# 51. COMANDOS EXECUTADOS

Crie um registro reproduzível dos comandos relevantes:

`docs/engineering/verification-log.md`

Registre:

- comando;
- ambiente;
- resultado;
- timestamp;
- SHA;
- exit code;
- observações.

Não armazene secrets.

---

# 52. HISTÓRICO DO GIT

Quando possível, utilize também histórico real para avaliar:

- manutenção;
- tamanho de mudanças;
- disciplina;
- CI;
- regressões;
- dependências;
- evolução.

Mas não penalize automaticamente um repositório novo pela ausência de histórico longo.

---

# 53. OPENSSF SCORECARD

Quando tecnicamente possível, execute OpenSSF Scorecard contra o repositório.

Use o resultado como **evidência auxiliar**, nunca como nota final automática.

Mapeie findings relevantes à rubrica.

---

# 54. DORA

Se existirem dados suficientes, avalie indicadores de delivery.

Se não existirem:

`NOT ENOUGH EVIDENCE`

Não invente deployment frequency, lead time ou failure rates.

Considere instrumentar a capacidade futura de medi-los caso faça sentido.

---

# 55. DEFECT ESCAPE

Sempre que encontrar um bug real durante a revisão:

1. registre o bug;
2. identifique por que os testes existentes não detectaram;
3. adicione teste reproduzindo;
4. corrija;
5. adicione mecanismo para evitar classe semelhante de regressão quando razoável.

Uma correção sem aprendizado de engenharia está incompleta.

---

# 56. REGRESSION PREVENTION

Toda correção importante deve responder:

> O que impede este problema de voltar?

Possíveis respostas:

- teste;
- type system;
- lint rule;
- CI gate;
- schema;
- IAM;
- architecture test;
- runtime validation;
- monitoring;
- process.

"Documentamos" isoladamente costuma ser insuficiente.

---

# 57. DOCUMENTAÇÃO FINAL

Ao terminar, crie na raiz:

`ENGINEERING.md`

Esse documento deve funcionar como equivalente de engenharia ao `ARCHITECTURE.md`.

Deve conter, no mínimo:

# Engineering Summary

# Scope

# External Standards Used

# Engineering Principles

# Repository Standards

# Code Quality

# Testing

# CI/CD

# Security

# Software Supply Chain

# Infrastructure Engineering

# Reliability

# Observability

# Developer Experience

# Documentation

# AI-Assisted Engineering

# Engineering Gates

# Fitness Functions

# Known Gaps

# Exceptions

# Engineering Scores

# Operational Evidence

# Status Final

# Next Steps

---

# 58. PRINCÍPIOS DE ENGENHARIA

Durante o processo, derive e formalize princípios.

Exemplos de espírito esperado:

- correctness before cleverness;
- automate repeatable verification;
- evidence over claims;
- simple before generic;
- secure by default;
- fail explicitly;
- make invalid states difficult;
- every critical invariant needs enforcement;
- every critical failure needs visibility;
- infrastructure is software;
- tests are executable specifications;
- CI is policy enforcement;
- documentation must match reality;
- dependencies are part of the product;
- AI-generated code receives no special trust;
- architecture boundaries should be executable where possible.

Não aceite esses exemplos automaticamente.

Claude e Codex devem validar e ajustar.

---

# 59. RESULTADO ESPERADO

O objetivo não é produzir:

> "um relatório dizendo que o projeto é bom."

O objetivo é produzir um sistema de engenharia capaz de responder continuamente:

> **Como sabemos que uma mudança é segura para integrar e entregar?**

Ao final, a qualidade do projeto deve ser verificável através de uma combinação de:

```text
standards
+ code
+ tests
+ automation
+ CI gates
+ runtime evidence
+ peer review
```

---

# 60. ANTI-GAMING

É expressamente proibido:

- alterar pesos para alcançar 9;
- remover gates porque falharam;
- marcar problemas como N/A sem justificativa;
- dar crédito por intenção;
- considerar documentação equivalente a execução;
- aceitar nota agregada quando um gate falha;
- arredondar nota para aprovação;
- deixar Codex ver a nota do Claude antes da avaliação independente;
- simular independência;
- suavizar crítica porque o projeto já passou pela Architecture Review;
- implementar complexidade artificial para parecer "enterprise".

---

# 61. CONDIÇÃO DE PARADA

O processo não deve continuar indefinidamente simplesmente para alcançar 9.

Se após correções razoáveis um checkpoint permanecer abaixo de 9 devido a:

- ausência de ambiente;
- ausência de produção;
- ausência de carga real;
- dependência externa;
- limitação econômica;
- informação indisponível;
- decisão consciente de produto;

registre honestamente:

`NOT APPROVED`

e explique o blocker.

**Nunca fabrique evidência para cumprir a meta.**

---

# 62. DIFERENÇA ENTRE TARGET E EVIDENCE

É permitido definir:

```text
TARGET ENGINEERING MATURITY >= 9.0
```

Mas isso não significa:

```text
CURRENT ENGINEERING MATURITY >= 9.0
```

A nota deve refletir o estado real.

A meta orienta melhoria.

Não orienta o avaliador a fabricar aprovação.

---

# 63. PRÉ-PRODUÇÃO

Se o sistema ainda não estiver em produção, não penalize a fundação por não possuir anos de histórico operacional.

Porém:

- testes de falha podem ser executados;
- restore pode ser testado;
- rollback pode ser testado;
- load pode ser simulado;
- CI pode ser real;
- security scanning pode ser real;
- IaC pode ser validado;
- observability pode ser testada.

Diferencie claramente:

**não possível ainda**

de:

**possível mas não fizemos**.

---

# 64. RESULTADO FINAL

O `ENGINEERING.md` deve terminar com algo semelhante a:

```text
ENGINEERING FOUNDATION STATUS: APPROVED | NOT APPROVED
OPERATIONAL ENGINEERING STATUS: APPROVED | NOT APPROVED

CLAUDE ENGINEERING SCORE: X.XXXX
CODEX ENGINEERING SCORE: X.XXXX
CONSERVATIVE ENGINEERING SCORE: X.XXXX
```

Depois:

```text
GATES:
G1 ...
G2 ...
...
```

E:

```text
UNRESOLVED:
P0: ...
P1: ...
P2: ...
```

---

# 65. SUMÁRIO EXECUTIVO FINAL

Ao final do trabalho, apresente ao usuário um resumo curto contendo:

1. nota inicial Claude;
2. nota inicial Codex;
3. principais problemas encontrados;
4. correções realizadas;
5. nota final Claude;
6. nota final Codex;
7. Conservative Engineering Score;
8. gates;
9. blockers;
10. arquivos principais gerados;
11. mudanças relevantes no repositório;
12. se o projeto pode ou não ser considerado engineering-mature.

---

# 66. PRIMEIRA AÇÃO

**Não comece alterando código.**

Comece agora por:

1. ler `ARCHITECTURE.md`;
2. compreender o processo Claude ↔ Codex anterior;
3. inventariar `docs/architecture`;
4. congelar o SHA atual;
5. pesquisar na Internet as referências de engenharia;
6. produzir `00-research-bibliography.md`;
7. criar uma primeira proposta de rubrica;
8. enviá-la ao Codex para crítica independente;
9. fazer a tréplica;
10. congelar critérios, pesos e gates;
11. somente então iniciar a Engineering Review do repositório.

---

# 67. PRINCÍPIO FINAL

Durante toda a execução, mantenha esta regra:

> **Não tente provar que o projeto possui boa engenharia. Tente falsificar essa hipótese.**

Se, mesmo depois de procurar sistematicamente falhas, bypasses, gaps, inconsistências, dívida, fragilidade, complexidade e ausência de evidência, o projeto continuar atingindo os critérios definidos independentemente por Claude e Codex, então a nota alta será merecida.

Esse é o objetivo.