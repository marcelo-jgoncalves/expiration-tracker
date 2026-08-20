---
status: superseded
owner: claude
authority: evidence-round (not normative — converged into docs/engineering/joint-review-criteria.md)
---

# Eixo 4 — Segurança da Informação e AppSec — Proposta Claude (Rodada 1)

Fontes: OWASP ASVS 5.0 (17 capítulos, ~350 requisitos — estrutura de verificação de app), OWASP Top 10:2025 (categorias concretas de vulnerabilidade, A01 Broken Access Control no topo, A03 Software Supply Chain Failures e A10 Mishandling of Exceptional Conditions novas), OWASP SAMM (5 funções de negócio: Governance/Design/Implementation/Verification/Operations — maturidade de processo, não só código), práticas de least-privilege AWS Lambda/DynamoDB (papel por função, sem wildcard, permission boundaries).

Não copio os 17 capítulos do ASVS 1:1 — a maioria trata de superfícies que este projeto não tem ainda (upload de arquivo, WebSocket, GraphQL, client-side storage). Adapto para o que realmente existe: API HTTP + Cognito + Lambda + DynamoDB + SQS/EventBridge, multi-tenant.

| # | Critério | Peso | Fonte/justificativa |
|---:|---|---:|---|
| 1 | Autenticação & Gestão de Sessão | 12% | ASVS cap. 6-8, Cognito JWT, `globalLogoutAfter`/`DeviceSession`, BFF de sessão ainda incompleto (gap conhecido, `NEXT_SESSION_PROMPT.md` histórico) |
| 2 | Controle de Acesso & Isolamento Multi-tenant | 18% | OWASP Top 10 A01 (topo da lista) + A06 Broken Object Level Authorization. Maior peso do eixo: `authorize()` matriz de M1, isolamento GSI3/GSI6 já produziu bugs reais nesta sessão (blast radius cross-tenant é o risco mais concreto e testado deste projeto) |
| 3 | Least-Privilege IAM & Configuração de Infra | 14% | `ScopedLambdaFunction` como único ponto de criação de Lambda, `gsi3Read()`/`gsi6Read()` como capabilities exclusivas — já é prática documentada, mas nunca testada contra IAM real (Camada 3 pendente) |
| 4 | Validação de Entrada & Prevenção de Injeção | 8% | OWASP Top 10 A04 Injection; schemas JSON via Ajv em toda borda externa (`schema-validator.ts`) |
| 5 | Criptografia & Proteção de Dado em Repouso/Trânsito | 8% | ASVS cap. 9-11; DynamoDB `AWS_MANAGED` encryption (CMK upgrade documentado como follow-up), TLS em todas as bordas |
| 6 | Segurança de Log & Observabilidade (vazamento de dado sensível) | 10% | OWASP Top 10 A07; `SecureLogger`/`Redactor` já maduro desde M0 com corpus de teste de canário — força real deste projeto, não lacuna |
| 7 | Cadeia de Suprimento & Integridade de Build | 9% | OWASP Top 10 A03 (novo em 2025) + A08 Software/Data Integrity; SBOM CycloneDX, actions pinadas por SHA já existem — mas SLSA/assinatura de artefato ainda pendente |
| 8 | Tratamento de Erro & Condição Excepcional | 6% | OWASP Top 10 A10 (novo em 2025) — taxonomia `AppError`/retryable já existe, mas nunca testada sob falha real de dependência AWS |
| 9 | Segurança do Pipeline Assíncrono (SQS/EventBridge/Streams) | 10% | Não é um capítulo padrão do ASVS (foco web app), mas é risco real deste projeto: poison message, redrive, replay, DLQ — G8 é literalmente sobre isso |
| 10 | Maturidade de Processo de Segurança (SAMM) | 5% | Função Governance/Verification do SAMM — existe processo de revisão (Claude↔Codex) mas nenhuma auditoria de segurança dedicada rodou ainda; este próprio eixo nasce para preencher isso |

Soma: 100%.

## Pergunta aberta para a crítica

Critério 9 (segurança do pipeline assíncrono) é redundante com "Event & Integration Correctness" do eixo Arquitetura e "Reliability & Fault Recovery"? Ou é uma lente diferente o suficiente (segurança — poison message malicioso, replay attack, DLQ como vetor de exfiltração de dado sensível — vs. arquitetura — correção funcional) para justificar critério próprio aqui? Levo essa tensão para a crítica cruzada.
