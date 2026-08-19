# Engineering Quality Criteria — Rubrica (CONGELADA)

**Status: CONGELADA.** Convergência Claude↔Codex em 2026-08-19 (Checkpoint 1, uma rodada — Codex não aprovou o draft inicial, todas as objeções foram incorporadas na correção; ver `reviews/checkpoint-01-rubric/` para o histórico completo: crítica original do Codex em `_codex-output-checkpoint1-final.txt`, tréplica em `claude-cross-critique-round1.md`). Alterações posteriores exigem motivo + evidência nova + impacto + aprovação de ambos (Prompt Mestre §6).

Ancorada em `00-research-bibliography.md`. Proporcional ao estágio: micro-SaaS pré-produção, equipe pequena, serverless AWS (Prompt Mestre §39).

## Domínios e pesos (somam 100%)

| # | Domínio | Peso | Escopo |
|---|---|---:|---|
| A | Code Quality & Maintainability | 10% | Modularidade, coesão, acoplamento, clareza, duplicação, complexidade, dead code, dívida técnica |
| B | Type Safety, Contracts & Correctness | 11% | Correção **local e de interfaces**: tipos, validação/parsing, schemas, invariantes, estados impossíveis, versionamento de contrato |
| C | Testing Engineering | 14% | Qualidade dos testes em todas as camadas, não apenas coverage |
| D | Continuous Integration | 8% | O que realmente roda em PR/push, não o que existe no YAML |
| E | CD & Release Engineering | 4% | Peso reduzido — sem ambiente real de deploy, maior parte será NEE |
| F | Secure Software Engineering | 12% | SSDF PO/PS/PW/RV, OWASP ASVS como critério verificável |
| G | Software Supply Chain | 6% | Pinning, lockfile, SBOM, provenance proporcional (SLSA L1-L2) |
| H | Infrastructure Engineering / IaC | 7% | CDK como software: organização, testabilidade, segurança |
| I | Reliability Engineering | 8% | Comportamento **sob falha**: retries, backoff, DLQ, replay, reconciliação, duplicatas |
| J | Observability & Operability | 6% | Instrumentação, correlação, alarmes-como-código, PII em logs — avaliável mesmo pré-produção |
| K | Developer Experience | 2% | Onboarding, comandos, paridade local↔CI |
| L | Documentation Engineering | 3% | Runbooks, contratos, decisões, correção e atualidade |
| M | Data & State Engineering | 5% | Semântica de **persistência e evolução de estado**: key design, access patterns, atomicidade, retenção, recuperação |
| N | Engineering Governance | 2% | Branch protection, PR discipline, technical debt registry — proporcional ao tamanho do time |
| O | AI-Assisted Engineering | 1% | Só controles verificáveis (rastreabilidade, revisão independente, proteção de boundary) — **nunca pontuar "uso de IA" em si** |
| P | Performance & Efficiency | 1% | Limites, paginação, batch size, bounded concurrency, custo de GSI — load test real é NEE |
| — | **Total** | **100%** | |

### Regra anti-double-counting (M vs. B vs. I)

As três avaliam propriedades **distintas** do mesmo mecanismo (ex.: OCC em DynamoDB), nunca a mesma propriedade três vezes:

- **B** avalia correção local/de interface: "uma atualização concorrente não perde dados silenciosamente" (o tipo/contrato impede o estado inválido).
- **M** avalia a semântica de persistência: desenho de chave, o builder de OCC em si, atomicidade da transação, retenção/recuperação.
- **I** avalia o comportamento após a falha: o que acontece no conflito/timeout/retry, se há backoff, se duplicatas são toleradas.

Ao pontuar, `evidence-matrix.md` deve nomear a propriedade específica testada em cada domínio — não repetir a mesma referência de arquivo como prova nos três.

## Gates eliminatórios (G1-G11)

Falha em qualquer gate bloqueia `ENGINEERING FOUNDATION STATUS: APPROVED`, independentemente do score ponderado. Gate não pode ser removido posteriormente por ter falhado (Prompt Mestre §19).

- **G1 — Toolchain fixado e build reproduzível**: runtime/versões fixadas (`.nvmrc`, lockfile), `npm ci` imutável, `build`/`typecheck` reproduzíveis em ambiente limpo. Não exige igualdade byte-a-byte de artefatos com metadados variáveis (ex.: CDK synth).
- **G2 — CI enforced de fato**: workflow executa automaticamente em PR e na branch protegida; **required checks reais e branch protection efetiva precisam de evidência do GitHub** (não presumidos a partir do YAML) — se indisponível, resultado é NEE, não PASS automático.
- **G3 — Controles críticos orientados a risco testados**: autorização negativa (cross-tenant ou equivalente), integridade transacional, concorrência/OCC, idempotência/replay, falhas do pipeline assíncrono. Os testes atuais (`cross-tenant.test.ts`, isolamento de GSI3, lifecycle, reminder engine) são **exemplos correntes**, não a definição do gate — o gate deve ser reavaliável se os módulos mudarem de nome.
- **G4 — Sem secret ativo no repositório**: varredura automatizada do estado atual e, quando acessível, do histórico; prevenção no CI; qualquer achado real tem processo de revogação definido.
- **G5 — Sem vulnerabilidade crítica não tratada**: "tratada" = corrigida, mitigada, ou aceita formalmente com owner + justificativa + prazo em `exceptions.md`. Exceção permanente sem prazo não libera o gate.
- **G6 — Autorização/isolamento cross-tenant enforced no caminho real de dados**, com testes negativos (distinto de G7).
- **G7 — Least privilege de infraestrutura**, incluindo recursos/índices explicitamente permitidos nas políticas IAM sintetizadas (distinto de G6 — ver histórico do bug real de M3 onde `grantReadWriteData` vazava `/index/*`).
- **G8 — Falhas assíncronas terminais são observáveis e recuperáveis**: toda falha terminal segue para DLQ/estado de erro, emite telemetria correlacionável, e tem mecanismo de replay/reconciliação testado (substitui a formulação não-verificável "nenhuma falha silenciosa conhecida").
- **G9 — Infraestrutura sintetiza e passa por assertions de segurança/configuração crítica** (não apenas "synth sem erro"). Deploy real permanece NEE.
- **G10 — Boundaries arquiteturais enforced automaticamente no CI**, com teste negativo do próprio mecanismo de enforcement (não apenas convenção).
- **G11 — Contratos/schemas válidos verificados no CI**, com exemplos positivos e negativos; mudanças incompatíveis exigem estratégia explícita de versionamento/migração.

## Fitness functions

Esqueleto (detalhamento completo em `02-engineering-fitness-functions.md`): build, typecheck, lint, test (unit/contract/integration/infra), validate-schemas, npm audit, secret-scan, IaC synth + assertions de segurança, dependency-direction/architecture-boundary check, schema/contract CI check.

## Regra de N/A vs. NOT ENOUGH EVIDENCE (distintas — não são a mesma coisa)

- **N/A**: o critério é **estruturalmente inaplicável** ao sistema/estágio. Exige: justificativa identificando qual característica elimina o risco, confirmação do revisor independente, registro antes da pontuação final. Peso redistribuído proporcionalmente entre os domínios restantes do mesmo eixo.
- **NOT ENOUGH EVIDENCE (NEE)**: o critério **é aplicável**, mas não há evidência suficiente agora (tipicamente: Operational Evidence pré-produção). NEE **não vira N/A** e **não sai do denominador** — permanece contado, mas sem nota atribuída, reduzindo a nota máxima possível sob a evidência disponível. A avaliação final deve publicar: nota da Foundation, nota da Operational Evidence (ou "não avaliável"), cobertura de evidência (peso comprovado / N/A / NEE), e a nota máxima possível dado o que é avaliável agora. Critérios NEE ligados a operação futura não reprovam a Foundation, mas bloqueiam qualquer afirmação de "production-ready"/"operationally mature".

## Precedente para próximos checkpoints

Domínio-alvo por checkpoint (Prompt Mestre §48) usa os pesos acima; um checkpoint específico pode cobrir mais de um domínio da tabela.
