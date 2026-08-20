# Threat Model — Expiration Tracker (Consolidado)

Status: **APPROVED** (Design Maturity) — Claude ~9.05 / Codex 9.0 (exato 9.002), ambos ≥9.0, nenhum gate violado.

## Resultado da avaliação
Rodada 1: propostas independentes com forte convergência (17 de 19 ameaças em comum); proposta do Codex mais rigorosa (STRIDE explícito, 6 ameaças Alta bem justificadas) adotada como base, com 2 achados do Claude incorporados sem conflito (SSRF condicionado a FUT-002; decisão consciente sobre criptografia de contato). Codex confirmou a incorporação com uma correção pontual (tag STRIDE de SSRF: I/D/E, não S/I — spoofing não é a categoria principal desse ataque) e deu nota final **9.0 (exato 9.002)**. Claude: **~9.05**. **STATUS: APPROVED.**
Base: `docs/architecture/history/threat-model/threat-model-claude-round1.md`, `docs/architecture/history/threat-model/threat-model-codex-round1.md`, `ARCHITECTURE.md`, `architecture-fase3-consolidada.md`, `data-model.md`, `disaster-recovery.md`. Seção 33 do prompt mestre.

**Escopo:** arquitetura projetada — texto original da rodada 1 mantido como registro histórico da decisão, ver "Status de implementação (atualizado)" abaixo para o que já existe em código real (M0-M3.5). Severidade representa o risco **residual após os controles já definidos**, não o impacto sem controles. Categorias STRIDE: **S**poofing, **T**ampering, **R**epudiation, **I**nformation Disclosure, **D**enial of Service, **E**levation of Privilege.

## Status de implementação (atualizado — full-audit round1/Segurança, 2026-08-20)

O texto abaixo (linha 16+) descreve o modelo como concebido na rodada de design; parte dele já tem controle real em código, não apenas planejado. Atualização honesta das "Lacunas novas" (linhas 50-56) frente ao estado atual do repositório:

- **Lacuna 3** (matriz de autorização + resolução central de `tenantId`) — **fechada**: `src/modules/identity/domain/authorization.ts` (matriz `ACTION_ROLES`) + `src/modules/identity/application/resolve-request-context.ts` (único resolver, nunca aceita tenantId do cliente); coberta por `test/integration/cross-tenant.test.ts` (10 casos negativos).
- **Lacuna 5** (redactor central testado contra logs/traces/DLQs/eventos) — **fechada**: `src/shared/observability/redactor.ts`, cobertura em `test/unit/redactor.test.ts` (redação de erro, string, objeto aninhado, formato de payload de DLQ).
- **Lacuna 1** (sessão: TTL/rotação/logout/CSP) — **parcial**: revogação global/por dispositivo implementada (`resolve-request-context.ts:71-87`), tokens de 15min (`infra/lib/cognito.ts`); rotação de refresh token e CSP (frontend, M4+) continuam pendentes — não há módulo de sessão BFF real no código hoje apesar de comentários que o referenciam.
- **Lacunas 2, 4, 6, 7** (sandbox de PDF, egress allowlist, supply-chain digest-pin/SBOM, gestão de dependências) — **ainda não aplicável/pendente**: nenhuma dessas superfícies (upload/OCR, webhooks de saída) existe em código até M3.5; SBOM/CycloneDX já roda no CI (`AGENTS.md` §7) mas pin por digest de todas as actions é follow-up registrado, não fechado.

Isso não é uma nova rodada de convergência do threat model (fora de escopo deste axis) — é uma correção de deriva de documentação identificada pelo axis de Segurança do full-audit round1 (Codex round1: "o threat model ainda se descreve como arquitetura 'ainda não implementada' apesar da implementação M0-M3.5").

## Histórico do debate
- **Rodada 1** — propostas independentes. Convergência forte em estrutura e na maioria das 17 ameaças em comum. A proposta do Codex é adotada como base — mais rigorosa: tagueamento STRIDE explícito por ameaça, calibração de severidade consistentemente mais alta e melhor justificada (6 ameaças "Alta" vs. nenhuma na proposta do Claude, incluindo achados reais que o Claude não tinha visto: session theft/CSP não definida, PDF processado sem sandbox de parser dedicado, supply-chain sem pin por digest/SBOM, dependency compromise sem política de atualização formal). A proposta do Claude cobre 2 pontos que a do Codex não menciona: SSRF associado especificamente a FUT-002 (webhooks de saída futuros) e o vazamento de números/e-mails tratado como decisão consciente de não criptografar em nível de aplicação (vs. apenas listado como ameaça a mitigar).

---

## Análise por ameaça

| Ameaça / STRIDE | Vetor | Mitigação existente | Risco residual / severidade |
|---|---|---|---|
| **Account takeover — S/E** | Credential stuffing, reset de conta, comprometimento do e-mail. | Cognito; rate limit e proteção contra credential stuffing; MFA ao menos opcional (`requirements.md` SEC-001); revogação de sessões no runbook (`disaster-recovery.md` §7). | MFA obrigatório permanece indefinido (UNK-006); recuperação de conta não foi detalhada. **Média**. |
| **Password abuse — S/D** | Brute force, senhas reutilizadas ou fracas, enumeração de usuários. | Cognito e rate limiting de login; WAF antes de produção pública (`architecture-fase3-consolidada.md` §14). | Política de senha, respostas anti-enumeração e proteção adaptativa não especificadas. **Média**. |
| **Session theft — S/E** | Roubo de JWT/refresh token via XSS, dispositivo comprometido ou armazenamento inseguro. | JWT validado pelo API Gateway; autorização fina no domínio; procedimento de revogação (`architecture-fase3-consolidada.md` §4; `disaster-recovery.md` §7). | Armazenamento do token, duração, rotação, **CSP** e revogação por dispositivo ausentes. **Alta**. |
| **Document malware — T/D** | Upload de executável, arquivo infectado ou formato disfarçado. | Magic bytes, GuardDuty Malware Protection, dois buckets, estados fail-closed, promoção apenas de `CLEAN` (`architecture-fase3-consolidada.md` §7). | Falsos negativos e formatos não cobertos; fallback ainda condicional. **Média**. |
| **Malicious PDF — T/D/E** | Parser exploit, PDF poliglota, zip/decompression bomb, consumo extremo de CPU/memória. | Quarentena, tamanho máximo e GuardDuty; somente arquivos limpos seguem para OCR (Red Team). | Antimalware **não substitui sandbox de parser**; limites de páginas, complexidade e recursos não definidos. **Alta**. |
| **Prompt injection — T/E** | Texto no documento tenta comandar o LLM ou adulterar campos extraídos. | Conteúdo tratado como dado; schema validation, comparação de extratores, `PENDING_CONFIRMATION` fail-closed (`architecture-fase3-consolidada.md` §10; `data-model.md` §2). | Testes adversariais e isolamento explícito do prompt continuam pendentes; alteração automática já é bloqueada, reduzindo impacto. **Média**. |
| **SSRF — I/D/E** | URL/referência embutida induz backend a acessar rede interna/metadados; hoje não há superfície, mas **FUT-002 (webhooks de saída) a introduzirá diretamente** se implementado sem controle. | Pipeline trabalha sobre objeto S3 conhecido; nenhuma funcionalidade de fetch arbitrário hoje. | Egress allowlist e bloqueio de redirects/URLs internas não definidos — **registrar como pré-requisito de design de FUT-002, não deixar para descobrir na implementação**. **Baixa hoje / condicionalmente relevante**. |
| **Injection — T/E** | NoSQL expression, command, template, header ou log injection. | DynamoDB elimina SQL; schemas versionados, WAF, validação de payload de IA. | Codificação contextual, construção segura de expressions e fuzzing não especificados. **Média**. |
| **Privilege escalation — E** | Manipular IDs, claims ou papéis para executar operação fora do escopo. | Autorização fina no domínio, IAM por função, testes negativos (`architecture-fase3-consolidada.md` §§4,14). | Matriz de autorização por operação ainda não existe; RBAC futuro amplia a superfície. **Média**. |
| **Tenant escape — I/E/T** | IDOR, chave sem tenant, evento/worker processando tenant errado. | `tenantId` obrigatório em chaves/GSIs/S3/mensagens/eventos/idempotência; testes negativos inclusive em restore (`architecture-fase3-consolidada.md` §6; `disaster-recovery.md` §6). | Um erro de implementação no middleware/repositório ainda pode atravessar tenants; enforcement estrutural em código não definido. **Média**. |
| **Webhook spoofing — S/T/R** | Callback forjado, replay ou colisão de event ID. | Assinatura em tempo constante, timestamp/nonce, chave composta, inbox idempotente/reconciliável (Red Team; `data-model.md` §§2,4). | Rotação de segredos e peculiaridades por provedor dependem da implementação. **Média**. |
| **Leaked WhatsApp numbers / e-mails — I** | Número/e-mail exposto em payload, DynamoDB, logs, DLQ ou suporte. | KMS/criptografia at-rest do serviço gerenciado, logs sem PII, isolamento por tenant, retenção/purge, adapter por canal. **Decisão consciente**: sem criptografia adicional em nível de aplicação para esses campos — confia na criptografia at-rest do DynamoDB, não é lacuna, é trade-off registrado. | Redação específica de payloads/DLQs/consoles de suporte e mascaramento em interfaces administrativas não definidos. **Média**. |
| **Leaked documents — I** | Acesso indevido pelo app, credencial AWS, backup, URL ou bucket. | Dois buckets privados, SSE-KMS, IAM separado, tenant no object key, versionamento, testes negativos de restore. | Autorização de download e acesso operacional (suporte/admin) ainda não detalhados. **Alta**. |
| **Compromised provider — S/I/T** | SES/BSP/Textract/Bedrock ou credencial do fornecedor comprometida. | Adapters substituíveis, filas isoladas, Secrets Manager, kill switch, retenção local do trabalho, rotação (`disaster-recovery.md` §§5,7). | Provedor pode exfiltrar conteúdo já recebido; critérios de minimização/detecção/failover não definidos. **Alta**. |
| **Exposed presigned URLs — I/T** | URL vazada permite upload/download por terceiro durante sua validade. | Expiração em minutos, objeto/operação únicos, slot atômico, `content-length-range` (Red Team; `data-model.md` §4). | URL continua sendo bearer credential; TTL exato, download policy e resposta a vazamento não definidos. **Média**. |
| **S3 misconfiguration — I/T** | Bucket público, policy/KMS/OAC incorretos, promoção indevida. | Block Public Access, OAC, SSE-KMS, papéis separados, CDK, scans IaC, restore fail-closed. | Drift/configuração manual precisa ser detectado operacionalmente; desenho é forte. **Baixa**. |
| **Logging sensitive content — I/R** | PII/tokens/documentos/payloads completos em logs/traces. | Logs JSON sem PII, auditoria redigida, `tenantId` nunca dimensão de métrica. | Lista de campos proibidos, redactor central e testes automatizados não definidos. **Média**. |
| **Secrets leakage — I/E** | Segredo em Git, variável, log, artefato ou role excessiva. | Secrets Manager, GitHub Actions via OIDC, IAM least privilege, scans, runbook de rotação. | TTL/rotação por segredo, secret scanning pré-commit, contenção automatizada ausentes. **Média**. |
| **Supply-chain attack — T/E** | Workflow, action, registry, build runner ou artefato adulterado. | SAST/dependency/IaC scans, aprovação manual, deploy canário, tag imutável. | **Sem pin por digest, proveniência assinada, SBOM ou verificação de artefato.** **Alta**. |
| **Dependency compromise — T/E/D** | Pacote npm malicioso, typosquatting, atualização comprometida. | Dependency scan e pipeline de testes. | Lockfile não basta; política de atualização, allowlist, análise de scripts, SLA de CVE não definidas. **Alta**. |
| **Cost abuse — D** | Flood de API/uploads, reprocessamento OCR/IA, webhook storm, disparos WhatsApp. | `TenantQuota`, slot de upload, reserved concurrency, quotas por canal, Budgets 80/100%, anomaly detection, kill switches (gate G6). | Ataque distribuído entre contas e custo antes do alarme disparar permanecem; WAF só entra na exposição pública. **Média**. |

## Resumo residual
| Severidade | Quantidade | Ameaças |
|---|---:|---|
| **Alta** | 6 | session theft, malicious PDF, leaked documents, compromised provider, supply-chain, dependency compromise |
| **Média** | 13 | takeover, password abuse, malware, prompt injection, injection, privilege escalation, tenant escape, webhook spoofing, números/e-mails, presigned URLs, logs, secrets, cost abuse |
| **Baixa** | 2 | SSRF, S3 misconfiguration |

## Lacunas novas (a fechar antes/durante a implementação)
1. **Arquitetura de sessão**: armazenamento no browser, TTL, refresh rotation, logout global/por dispositivo, **CSP**.
2. **Sandbox de parsing de PDF**: sem rede, com limites de páginas/memória/CPU/expansão — antimalware genérico não substitui isso.
3. **Matriz explícita de autorização por ação/recurso** + um único componente que deriva `tenantId` da identidade validada, nunca do request.
4. **Política de egress**: nenhum fetch arbitrário, bloqueio de metadata/private ranges, allowlist — pré-requisito de design antes de FUT-002 (webhooks de saída) ser implementado.
5. **Redactor central de logs** com schema de campos sensíveis, testado contra logs/traces/DLQs/eventos.
6. **Supply-chain hardening**: actions/imagens fixadas por digest, SBOM, assinatura/proveniência de artefato, verificação no deploy.
7. **Gestão formal de dependências**: lockfile obrigatório, scripts de instalação restritos, allowlist de pacotes críticos, SLA de resposta a CVE.

## Pontos abertos (Claude, Rodada 1 — aguardando reação do Codex)
Nenhum ponto de discordância — a proposta do Codex foi adotada integralmente como base, com os 2 achados do Claude (SSRF condicionado a FUT-002, decisão consciente sobre criptografia de contato) incorporados sem conflito. Enviado ao Codex apenas para confirmação e nota final, não para nova rodada de divergência.
