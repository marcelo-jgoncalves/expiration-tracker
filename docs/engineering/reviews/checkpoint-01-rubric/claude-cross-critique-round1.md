---
status: historical
owner: claude
authority: evidence-round (not normative — produced 01-engineering-quality-criteria.md, CONGELADA)
---

# Checkpoint 1 — Cross-Critique (Claude resposta à crítica do Codex)

Referência: `_codex-output-checkpoint1-final.txt` (íntegra preservada). Este documento é a Passo D (Cross Critique) do protocolo — Claude responde às objeções do Codex.

## Aceito integralmente

- **Granularidade excessiva / pesos "decorativos" (K, N, P ≤2%)**: aceito. Domínios com peso tão baixo não mudam conclusão nenhuma — ou ganham critérios com peso que importa, ou são absorvidos. Adoto a redistribuição do Codex.
- **O.AI-Assisted Engineering favorecia artificialmente o projeto**: aceito sem reserva. Meu peso de 3% media a existência do processo Claude↔Codex em si, que é precisamente o processo que estou executando — isso é auto-referência, não avaliação. O ponto do Codex é correto: o que importa (revisão, rastreabilidade, testes, autoria responsável) já está coberto em A/C/F/N. Reduzo para 1%, e a nota "nunca pontuar 'uso de IA' em si" vira regra explícita do domínio.
- **G6 estava conceitualmente errado**: aceito. Eu tinha colapsado "tenant isolation" (autorização por dado, no caminho de acesso) com "least privilege de índice" (isolamento estrutural do GSI3 entre componentes/roles) como se fossem o mesmo mecanismo, só porque o bug real de M3 tocou os dois ao mesmo tempo. São propriedades distintas com testes distintos (`cross-tenant.test.ts` prova a primeira; `stack.test.ts`/isolamento de GSI3 prova a segunda). Divido em G6 (autorização/isolamento cross-tenant no caminho de dados) e G7 (least privilege de infraestrutura/índices) na numeração final.
- **G7 original ("nenhuma falha silenciosa conhecida") não é verificável**: aceito — é uma afirmação negativa sobre desconhecimento, não uma propriedade testável. Substituo pela formulação do Codex orientada a comportamento observável (DLQ/telemetria/correlação/replay testado).
- **G3 acoplado a nomes de funcionalidade**: aceito. "cross-tenant, GSI3, lifecycle, reminder engine" são instâncias de hoje, não a regra geral. Reformulo por risco (autorização negativa, integridade transacional, idempotência/replay, entrega assíncrona) e cito os testes atuais como *exemplo*, não como definição do gate.
- **N/A vs. NOT ENOUGH EVIDENCE não estavam distinguidos**: aceito, é uma lacuna real do meu draft — eu tratava os dois quase como sinônimos. Adoto a distinção do Codex: N/A é ausência estrutural de aplicabilidade (decidida por concordância prévia); NEE é ausência de evidência sobre algo que É aplicável, e não pode sair do denominador silenciosamente. Adoto também o requisito de publicar cobertura de evidência (peso comprovado / N/A / NEE) e a nota máxima possível dado o que é avaliável agora.
- **Gates faltantes** (integridade transacional, schemas no CI, política de migração incompatível, proteção de branch): aceito todos os quatro como gates novos.
- **G1/G2/G5/G8/G9 precisam de definição operacional mais precisa**: aceito as reformulações — evitam tanto "passa porque o YAML existe" quanto exigências desproporcionais (ex.: build byte-a-byte idêntico).

## Aceito com uma ressalva

- **Overlap M vs. B vs. I — regra "anti-double-counting"**: aceito a divisão de escopo proposta (M = semântica de persistência/chaves/evolução; B = correção local/contratos; I = comportamento sob falha) e a regra de que a mesma evidência não pode render nota cheia nos três domínios. Ressalva: isso exige que, ao pontuar cada domínio no Checkpoint 9 (Data/Performance), eu documente explicitamente *qual propriedade específica* está sendo testada em cada um, não apenas "ver `occ.ts`" repetido três vezes — vou tratar isso como regra de evidência obrigatória no `evidence-matrix.md`, não apenas como princípio abstrato.
- **Bibliografia complementar** (AWS Serverless Lens/Security Pillar, Builders' Library, DynamoDB Developer Guide, IAM Best Practices/Access Analyzer, OWASP ASVS, OWASP Serverless Top 10, NIST SP 800-218A condicional, CycloneDX/SPDX, OpenSSF Security Baseline, SemVer/schema evolution): aceito adicionar todas ao `00-research-bibliography.md` como adendo — são mais acionáveis que os frameworks-guarda-chuva já citados. Ressalva sobre **OWASP SAMM**: o Codex sugere que pode ser "pesado demais" — não removo SAMM da bibliografia (a pesquisa em si permanece válida como vocabulário de níveis de maturidade de segurança), mas concordo em não usá-lo para exigir cobertura das 15 security practices completas; ASVS entra como critério mais verificável para o domínio F.

## Não aceito / diverge

Nenhum ponto do Codex é rejeitado nesta rodada — a crítica é bem fundamentada e as correções propostas tornam a rubrica mais defensável sem desproporcionalidade. Não há divergência material a registrar em `disagreement-log.md` para o Checkpoint 1; ambos convergem para a versão revisada abaixo.

## Pesos finais congelados (adoto a proposta do Codex integralmente)

| # | Domínio | Peso |
|---|---|---:|
| A | Code Quality & Maintainability | 10% |
| B | Type Safety, Contracts & Correctness | 11% |
| C | Testing Engineering | 14% |
| D | Continuous Integration | 8% |
| E | CD & Release Engineering | 4% |
| F | Secure Software Engineering | 12% |
| G | Software Supply Chain | 6% |
| H | Infrastructure Engineering / IaC | 7% |
| I | Reliability Engineering | 8% |
| J | Observability & Operability | 6% |
| K | Developer Experience | 2% |
| L | Documentation Engineering | 3% |
| M | Data & State Engineering | 5% |
| N | Engineering Governance | 2% |
| O | AI-Assisted Engineering | 1% |
| P | Performance & Efficiency | 1% |
| — | **Total** | **100%** |

Gates finais: ver `01-engineering-quality-criteria.md` (versão congelada, G1-G11, incorporando a reformulação do Codex ponto a ponto).
