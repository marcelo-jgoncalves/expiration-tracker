# Engineering Fitness Functions

Verificações executáveis derivadas da rubrica congelada (`01-engineering-quality-criteria.md`). Cada uma bloqueia PR e/ou deploy conforme indicado.

| # | Nome | Objetivo | Risco mitigado | Comando | Quando roda | Comportamento esperado | Consequência na falha | Bloqueia PR | Bloqueia deploy |
|---|---|---|---|---|---|---|---|---|---|
| FF1 | Build/typecheck | Reprodutibilidade de build | Código que não compila chegar a produção | `npm ci && npm run typecheck` | CI, todo push/PR | Exit 0 | Job falha | Sim | Sim (não há deploy ainda) |
| FF2 | Lint (incl. boundary) | Padrão de código + boundaries arquiteturais (G10) | Duplicação, `console.*` fora de observability, domain importando infra/aws-sdk | `npm run lint` | CI, todo push/PR | Exit 0, zero warnings | Job falha | Sim | N/A |
| FF3 | Testes (unit+contract+integration+infra) | Correção funcional, isolamento cross-tenant, GSI3, lifecycle, reminder engine | Regressão em caminho crítico | `npm test` | CI, todo push/PR | Exit 0 | Job falha | Sim | Sim |
| FF4 | Validação de schema | Contratos JSON Schema íntegros (G11) | `$ref` quebrado, evento sem schema | `npm run validate-schemas` | CI, todo push/PR | Exit 0 | Job falha | Sim | Sim |
| FF5 | Dependency audit — produção | Vulnerabilidade real em dependência de produção (G5) | Vulnerabilidade explorável em runtime | `npm audit --omit=dev --audit-level=high` | CI, todo push/PR | Exit 0 | Job falha (real, desde 2026-08-19 — antes era `\|\| echo`, nunca bloqueava) | Sim | Sim |
| FF6 | Dependency audit — dev | Visibilidade de vulnerabilidade em toolchain de dev | Vulnerabilidade em dev-server não descoberta | `npm audit --audit-level=high` | CI, todo push/PR | Warning se houver achado; cruzar contra `exceptions.md` | Warning apenas — não bloqueia (achado atual = EX-001, revisão em 30 dias) | Não | Não |
| FF7 | SBOM | Rastreabilidade de dependências (supply chain) | Incapacidade de auditar componentes em caso de CVE futuro | `npx @cyclonedx/cyclonedx-npm` | CI, todo push/PR | Artefato gerado e anexado | Job falha se geração falhar | Sim | Não (informacional) |
| FF8 | IaC synth + assertions | Infraestrutura sintetizável e políticas IAM corretas (G7, G9) | Deploy de infra inválida; vazamento de least-privilege (regressão do bug real de M3) | `npm test` (inclui `test/infra/stack.test.ts`) | CI, todo push/PR | Exit 0 | Job falha | Sim | Sim |
| FF9 | Secret scan | G4 | Secret commitado | Manual nesta revisão (grep dirigido); scanner automatizado ainda não integrado ao CI | Sob demanda / a cada Checkpoint | Zero achados reais | — | Não ainda | Não ainda |

## Lacunas conhecidas de fitness function (não implementadas nesta sessão)

- **FF9 sem automação no CI** — hoje é verificação manual dirigida (grep de padrões conhecidos), não um scanner dedicado (ex.: gitleaks/trufflehog) rodando em todo push. Proporcional ao estágio, mas é uma lacuna real, não um "PASS" pleno.
- **G8 (falhas assíncronas observáveis/recuperáveis) não tem fitness function própria** — não há DLQ real, telemetria de falha terminal, ou teste de replay/redrive ainda, porque não há Lambda/fila real deployada (mesmo estágio de M0-M3, lógica pura testável mas sem runtime real). Fica como P0 de remediação futura, não como fitness function fictícia.
