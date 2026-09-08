# Full audit round2 — Segurança/AppSec — Tréplica Claude (Rodada 3, final)

Convergência real e forte entre as duas notas independentes:

- Claude round2 (revisada pós-evidência): **7.95/10**
- Codex round2 (reconciliada): **8.068/10**

Diferença final: **0.12 pontos** (era 0.77 na Rodada 1). Aceito a nota reconciliada do Codex quase integralmente — a única divergência residual real é o peso do critério 7 (eu havia ficado em 7.8, Codex fechou em 7.9; diferença desprezível, mesma leitura de fato: SEC-R2-05 é wiring real sem confirmação operacional comprovada).

## Nota final do eixo (Rodada 3, última nota cega registrada por ambos os lados)

**Claude: 7.95/10 — Codex: 8.068/10 — ambos abaixo de 9.0, sem arredondamento.**

Adoto a tabela final do Codex round2 como registro de consenso (diferença de 0.12 não justifica uma 4ª rodada — mesmo critério de parada usado no Round1 original deste eixo: retorno decrescente sobre os mesmos critérios não corrigíveis nesta sessão).

| # | Critério | Peso | Nota consenso | Situação |
|---:|---|---:|---:|---|
| 1 | Isolamento Multi-Tenant & Autorização por Objeto | 18% | 9.2 | Forte, sem achado bloqueador |
| 2 | Least-Privilege IAM & Contenção de Blast Radius | 14% | ~6.4 | **PENDENTE nível 5-6** — mesma lacuna do Round1, blast radius maior |
| 3 | Autenticação, Sessão & Gestão de Identidade | 11% | 9.0 | Corrigido substancialmente desde Round1 (Cognito refresh rotation real) |
| 4 | Integridade do Pipeline Assíncrono | 14% | 7.6 | 2 achados reais: SEC-R2-02 (novo, médio) + SEC-R2-03 (herdado do Round1) |
| 5 | Validação de Entrada, Injection & Fail-Closed | 9% | 8.3 | Mantido/expandido desde Round1 |
| 6 | Proteção de Dados Sensíveis/Segredos | 9% | 8.0 | SEC-R2-04 (baixo, IP bruto) único achado novo |
| 7 | Logging Seguro/Detecção | 8% | ~7.85 | Corrigido em IaC (alarmes com destino); SEC-R2-05 (confirmação operacional pendente) impede nota alta |
| 8 | Configuração Segura da Plataforma | 6% | 8.3 | Sem achado bloqueador |
| 9 | Resistência a Abuso/DoS | 5% | 7.7 | Cobertura de quota nas rotas novas não totalmente verificada |
| 10 | Verificação Adversarial & Gestão Contínua | 6% | 8.0 | Processo real (E-014 por superfície nova); falta prova adversarial AWS real (Camada 3) |

**Nota ponderada de consenso: ~8.02/10** (média simples das duas notas ponderadas finais 7.95/8.068). Eixo **não aprovado nesta rodada** — sub-9 honesto, mesma disciplina de registro do Round1.

## Resumo do que mudou desde Round1 (Claude 7.895 / Codex 7.315 → Claude 7.95 / Codex 8.068)

Melhoria real e mensurável, não cosmética: sessão/refresh token deixou de ser aspiração e virou controle Cognito real testado; alarmes ganharam destino de notificação em IaC; toda superfície nova (guest access, webhook WhatsApp, dossier export, activity log) manteve a disciplina de validação Ajv, RBAC explícito e research-before-implementation (E-014) já estabelecida. A lacuna estrutural mais grave (IAM least-privilege, critério de maior peso não resolvido) permanece idêntica ao Round1, apenas com blast radius maior por causa do crescimento do sistema — não é uma regressão, é a mesma dívida nunca paga crescendo de escopo.

## Achados finais consolidados desta rodada (ver `-summary.md` para a lista definitiva com severidade e evidência)

1. SEC-R2-01 (Alto, PENDENTE nível 5-6) — IAM tenant-facing com acesso de leitura/escrita à tabela base inteira, sem condição por tenant.
2. SEC-R2-02 (Médio, PENDENTE nível 3-4, achado NOVO desta rodada) — claim-before-send em `deliverGuestCredential()` causa perda permanente de link de credencial de guest numa falha transitória de SES.
3. SEC-R2-03 (Médio, PENDENTE, herdado do Round1) — 2 envelopes assíncronos internos (`dispatch-outbox-relay-processor.ts`, `reminder-reconciliation-handler.ts`) sem validação de schema Ajv, só cast TypeScript.
4. SEC-R2-04 (Baixo, PENDENTE nível 3+) — IP bruto do guest rate limiter persistido em texto claro na chave, sem hash/HMAC.
5. SEC-R2-05 (Baixo/operacional, PENDENTE ação humana) — subscription SNS de alarmes em `PendingConfirmation`, sem confirmação/teste de entrega comprovado.
6. Achado mecânico corrigido nesta sessão (nível 1-2): drift de `exceptions.md` EX-001 (contagem desatualizada) + EX-003 nova (cadeia de produção `exceljs→uuid@8.3.2`, moderate, triada e registrada).

Nenhum bypass direto de RBAC/tenant, segredo hardcoded, falha de timing real, ou CVE crítico de produção foi encontrado por nenhum dos dois lados nesta rodada.
