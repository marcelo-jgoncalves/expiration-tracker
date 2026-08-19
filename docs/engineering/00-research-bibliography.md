# Research Bibliography — Engineering Maturity Standards

Fase 0 do processo (`Prompt Mestre — Engineering Maturity Review`, §4-5). Pesquisa realizada em 2026-08-19 via busca na Internet. Não copia texto extenso das fontes — extrai princípios e critérios aplicáveis a este repositório (micro-SaaS serverless AWS, estágio pré-produção, equipe pequena, forte uso de agentes de IA).

Cada entrada: organização/documento, versão, status, data de consulta, URL, critérios derivados, limitações, natureza (normativa/recomendação/pesquisa empírica/ferramenta).

---

## 1. ISO/IEC 25010:2023 — Product Quality Model (SQuaRE)

- **Versão/status**: 2023, substitui a edição de 2011. Normativa (ISO).
- **URL**: https://www.iso.org/standard/78176.html
- **Consultado em**: 2026-08-19.
- **Natureza**: normativa (mas o texto completo é pago; usamos o índice de características publicamente descrito, não o texto integral).
- **Critérios derivados**: nove características de qualidade de produto — *functional suitability, performance efficiency, compatibility, interaction capability, reliability, security, maintainability, flexibility, safety*. Mudança relevante vs. 2011: *usability*→*interaction capability*, *portability*→*flexibility*, nova característica *safety*. Usamos isto para garantir que a rubrica de Code Quality/Maintainability (domínio A) e Reliability (domínio J) não sejam auto-inventadas, mas ancoradas em um vocabulário padronizado de subcaracterísticas (ex.: maintainability se subdivide em modularidade, reusabilidade, analisabilidade, modificabilidade, testabilidade — mapeia diretamente aos itens do Prompt Mestre §7.A).
- **Limitações**: texto integral não acessado (paywall ISO); usamos o modelo de características de fontes secundárias que citam a norma. Não usar para reivindicar conformidade certificada, apenas como vocabulário/estrutura.

## 2. NIST SP 800-218 — Secure Software Development Framework (SSDF)

- **Versão/status**: v1.1 (fevereiro 2022) é a versão publicada e vigente. v1.2 (SP 800-218r1) está em **draft público** com comentários até 30/01/2026 — **não é normativa ainda**, tratada apenas como sinal de direção futura, não como base de exigência atual. SP 800-218A (jul/2024) é overlay específico para IA generativa — fora do escopo deste repositório (não construímos modelos de IA, apenas usamos IA como ferramenta de engenharia via CLI de agentes).
- **URL**: https://www.cisa.gov/resources-tools/resources/nist-sp-800-218-secure-software-development-framework-v11-recommendations-mitigating-risk-software ; draft: https://www.nist.gov/news-events/news/2025/12/secure-software-development-framework-ssdf-version-12-available-public
- **Consultado em**: 2026-08-19.
- **Natureza**: normativa (referência federal dos EUA, adotada amplamente na indústria como framework de práticas, não certificação obrigatória para este projeto).
- **Critérios derivados**: as 4 categorias de práticas do SSDF v1.1 — *Prepare the Organization (PO)*, *Protect the Software (PS)*, *Produce Well-Secured Software (PW)*, *Respond to Vulnerabilities (RV)* — usadas para estruturar o domínio F (Secure Software Engineering) do Prompt Mestre: PS mapeia a supply-chain/artefatos/secrets; PW mapeia a threat-informed development/input validation/SAST; RV mapeia a vulnerability triage/response process.
- **Limitações**: framework é abrangente e voltado a organizações maiores; aplicamos com proporcionalidade (Prompt Mestre §39) — não exigir processo formal de RV com SLA se o projeto não tem usuários em produção ainda.

## 3. OWASP SAMM v2

- **Versão/status**: v2 é a versão atual e vigente (release definitiva, não beta), publicada e mantida via owaspsamm.org (conteúdo em YAML, iterativo).
- **URL**: https://owaspsamm.org/model/ ; https://owaspsamm.org/release-notes-v2/
- **Consultado em**: 2026-08-19.
- **Natureza**: modelo de maturidade (não normativo, framework de autoavaliação da OWASP Foundation).
- **Critérios derivados**: 5 business functions (*Governance, Design, Implementation, Verification, Operations*), cada uma com 3 security practices avaliadas em maturidade 0-3 tanto por *coverage* quanto por *quality*. Usado para o domínio F e para calibrar que maturidade de segurança não é binária — há níveis, e nível 1 (higiene básica) já é aceitável para um projeto neste estágio, não exigimos nível 3 em tudo (proporcionalidade).
- **Limitações**: autoavaliação, sujeita a viés se aplicada sem revisão independente — por isso o processo Claude↔Codex é ainda mais necessário aqui.

## 4. OpenSSF Scorecard

- **Versão/status**: v5.5.0 (abr/2026), ativo, mantido pela OpenSSF (Linux Foundation).
- **URL**: https://github.com/ossf/scorecard/blob/main/docs/checks.md ; https://scorecard.dev/
- **Consultado em**: 2026-08-19.
- **Natureza**: ferramenta de avaliação automatizada (18 checks), não normativa — evidência auxiliar per Prompt Mestre §53.
- **Critérios derivados**: checks relevantes ao domínio de supply-chain (§8 do Prompt Mestre) — Branch-Protection, Dependency-Update-Tool, Pinned-Dependencies, SAST, Security-Policy, Token-Permissions, Vulnerabilities, Maintained, Dangerous-Workflow, Signed-Releases.
- **Limitações**: **repositório é privado** (`marcelo-jgoncalves/expiration-tracker`) — Scorecard requer repo público ou execução local/autenticada; disponibilidade real de execução a confirmar no Checkpoint 6. Se não for tecnicamente executável, registrar honestamente como `NOT ENOUGH EVIDENCE` / bloqueio técnico, e mapear os checks manualmente por inspeção onde possível (ex.: branch protection é verificável via `gh api`, pinning de actions é verificável por leitura do workflow).

## 5. SLSA (Supply-chain Levels for Software Artifacts)

- **Versão/status**: v1.0 é o texto especificado estável referenciado publicamente; buscas indicam v1.1 (abr/2025) e v1.2 com Source Track (nov/2025) como evoluções recentes — tratar v1.2 como a mais atual, mas verificar o texto exato da spec (`slsa.dev/spec/v1.0/` é o link estável canônico encontrado; versões incrementais podem não ter mudado a estrutura de níveis).
- **URL**: https://slsa.dev/spec/v1.0/ ; https://openssf.org/projects/slsa/
- **Consultado em**: 2026-08-19.
- **Natureza**: normativa/framework de níveis (OpenSSF), foco em Build Track.
- **Critérios derivados**: Build L1 (provenance existe) → L2 (build em plataforma hospedada, provenance assinada automaticamente, ex. GitHub Actions) → L3 (isolamento de plataforma). O CI deste projeto já roda em GitHub Actions hospedado — **L1/L2 são potencialmente atingíveis a baixo custo** (provenance/attestation via `actions/attest-build-provenance`); L3 é desproporcional ao estágio atual. Usado no domínio §8 (supply chain) com proporcionalidade explícita — `AGENTS.md` §6 já registra que assinatura/provenance ficou para "quando existir alvo de deploy real", o que é uma leitura razoável mas a ser re-julgada.
- **Limitações**: v1.2/Source Track é recente e pode não ter ferramentas maduras no ecossistema Node/GitHub Actions ainda — verificar antes de exigir.

## 6. AWS Well-Architected Framework

- **Versão/status**: vigente, 6 pilares (Operational Excellence, Security, Reliability, Performance Efficiency, Cost Optimization, Sustainability — Sustainability adicionado em 2021), guidance atualizada continuamente (100% dos best practices revisados desde out/2022 per AWS, confirmado nov/2024).
- **URL**: https://docs.aws.amazon.com/wellarchitected/latest/framework/welcome.html (índice oficial; páginas específicas de pilar consultadas via busca)
- **Consultado em**: 2026-08-19.
- **Natureza**: normativa/framework de práticas (AWS, fonte primária do provedor de nuvem usado pelo projeto).
- **Critérios derivados**: usado principalmente nos domínios G (IaC), J (Reliability), K (Observability/Operability) — o projeto já usa este framework na fase de arquitetura (`docs/architecture/` referencia AWS Well-Architected). Aqui a diferença é verificar **enforcement real na implementação**, não a intenção documentada.
- **Limitações**: nenhuma crítica — é a fonte primária mais diretamente aplicável dado que o projeto é 100% AWS.

## 7. Google SRE Book / Workbook — SLO, SLI, Error Budgets

- **Versão/status**: livros vivos, mantidos por Google, sem versionamento formal — tratado como corpus de práticas consolidadas, não uma spec versionada.
- **URL**: https://sre.google/sre-book/embracing-risk/ ; https://sre.google/workbook/implementing-slos/ ; https://sre.google/workbook/error-budget-policy/
- **Consultado em**: 2026-08-19.
- **Natureza**: prática empírica documentada por uma organização (não normativa formal, mas amplamente adotada como referência de fato da indústria).
- **Critérios derivados**: SLI = medida quantitativa de nível de serviço; SLO = alvo sobre o SLI; error budget = 1 − SLO, orienta o trade-off velocidade×confiabilidade. Usado no domínio K (Observability/Operability) — o projeto já tem `slo.md` na fase de arquitetura; aqui avaliamos se os SLOs têm SLIs realmente instrumentados/mensuráveis no código (dashboards/métricas), não apenas documentados.
- **Limitações**: projeto pré-produção — não há dados reais de error budget consumido; isso é esperado e não penaliza a fundação (Prompt Mestre §63), mas limita o eixo Operational Evidence (§40.B) a `NOT APPROVED`/`NOT ENOUGH EVIDENCE` por padrão até haver operação real.

## 8. DORA / Accelerate (Four Keys)

- **Versão/status**: pesquisa contínua (DORA State of DevOps reports anuais); métricas de 2018 (livro *Accelerate*) seguem sendo as 4 principais: Deployment Frequency, Lead Time for Changes, Change Failure Rate, MTTR. Nota de 2026: geração de código por IA está mudando a interpretabilidade de Deployment Frequency/Lead Time (sinal, não ruído a ignorar) — relevante dado que este projeto é fortemente assistido por IA.
- **URL**: (relatórios/artigos agregadores consultados; fonte primária é dora.dev / Google Cloud DORA)
- **Consultado em**: 2026-08-19.
- **Natureza**: pesquisa empírica (não normativa).
- **Critérios derivados**: usado no domínio E (CD/Release Engineering) apenas como vocabulário — per Prompt Mestre §54, **sem dados reais de deploy em produção, não inventar números**; o achado aqui será `NOT ENOUGH EVIDENCE` para os 4 keys reais, mas avaliamos se o pipeline está estruturalmente capaz de produzi-los quando houver deploys (rastreabilidade commit→build→deploy, rollback).
- **Limitações**: não aplicável para medir hoje; usado só para orientar instrumentação futura.

---

## Fontes não pesquisadas nesta rodada (justificativa)

O Prompt Mestre também cita AWS Operational Excellence/Security/Reliability como pilares — já cobertos como parte do Well-Architected Framework (item 6), não são documentos separados. CI/CD, dependency management, testing, observability "práticas oficiais" genéricas não têm uma fonte primária única — tratadas via os frameworks acima (SSDF/SAMM para segurança de processo, Well-Architected para operação, DORA/SRE para confiabilidade e delivery) em vez de buscas adicionais redundantes, evitando pesquisa dispersiva sem fonte primária clara.

## Adendo — fontes acrescentadas após crítica do Codex (Checkpoint 1)

Mais acionáveis que os frameworks-guarda-chuva acima; incorporadas à rubrica congelada (`01-engineering-quality-criteria.md`):

- **AWS Serverless Applications Lens / AWS Security Pillar** — mais específicos que o Well-Architected genérico para os domínios H (IaC) e F (Security).
- **AWS Builders' Library** — retries, timeouts, backoff, jitter, idempotência em sistemas distribuídos; usado no domínio I (Reliability).
- **DynamoDB Developer Guide** — transações, consistência, modelagem de chaves, throttling, hot partitions; usado no domínio M (Data & State).
- **AWS IAM Security Best Practices / IAM Access Analyzer** — least privilege e validação de política; usado no domínio F e no gate G7.
- **OWASP ASVS** — critérios de segurança de aplicação verificáveis (mais concreto que SAMM para este porte); usado no domínio F junto com SAMM v2 (SAMM mantido só como vocabulário de níveis de maturidade, não exigindo cobertura completa das 15 security practices).
- **OWASP Serverless Top 10** — complemento contextual ao domínio F, não tratado como padrão normativo.
- **NIST SP 800-218A** — condicional: só relevante se AI-Assisted Engineering (domínio O) permanecer como domínio explícito avaliando o processo de desenvolvimento assistido por IA.
- **CycloneDX / SPDX** — formato e qualidade de SBOM no domínio G (SLSA não substitui isso).
- **OpenSSF Security Baseline** — controles esperados de segurança de projeto, independente de o Scorecard ser executável no repo privado.
- **SemVer + política de compatibilidade/evolução de JSON Schema** — usado no gate G11 (contratos/schemas versionados).

Nota de cautela reforçada pelo Codex: DORA e Google SRE devem ser usados com cuidado — sem tráfego/deploys reais, dashboards vazios ou métricas sintéticas não valem como evidência operacional (reforça a distinção N/A vs. NOT ENOUGH EVIDENCE da rubrica congelada).

## Aplicabilidade consolidada ao projeto

Dado o estágio (pré-produção, micro-SaaS, single-table DynamoDB, serverless AWS, Node/TypeScript, uso intensivo de agentes Claude/Codex), a rubrica do Checkpoint 1 vai ponderar mais pesadamente: correctness/type-safety/testing (ISO 25010 + evidence-first do próprio Prompt Mestre), secure-by-default e supply-chain proporcional (SSDF+SAMM+Scorecard+SLSA, nível 1-2, não nível máximo), e reliability/data engineering específico do domínio (idempotência, OCC, outbox — já são decisões arquiteturais existentes, aqui avaliamos enforcement). Operational Evidence (DORA real, error budgets reais, SLSA L3, restore/rollback exercitados) será necessariamente `NOT ENOUGH EVIDENCE`/`NOT APPROVED` neste momento por ausência de produção — isso é esperado, não uma falha da fundação (Prompt Mestre §40, §63).
