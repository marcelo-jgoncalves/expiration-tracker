# Full audit round2 — Segurança/AppSec — Réplica Claude (Rodada 2 do protocolo, nota cega)

Codex round1 (`full-audit-round2-seguranca-codex-output-round1.txt`): **8.168/10**. Claude round1: **7.40/10**. Diferença de ~0.77, concentrada em: (a) critério 3 (Autenticação/Sessão) — eu havia mantido a nota baixa (7.6) citando "módulo de sessão BFF... não existe em código real", desatualizado; Codex verificou `infra/modules/cognito/main.tf:68-92` (`refresh_token_rotation` habilitado, grace period 30s, `ALLOW_REFRESH_TOKEN_AUTH` removido) e tabela dedicada de sessão com KMS — controle real, não aspiracional. Aceito a correção, evidência verificada por mim agora abaixo. (b) Codex encontrou um achado real que eu não tinha: **SEC-R2-02**, claim-before-send em `src/workers/guest-credential-delivery/deliver.ts:66-81` — confirmei pessoalmente o código: `markerStore.claim()` roda ANTES do `emailProvider.send()`; se o envio falhar (`SEND_FAILED`), o retry subsequente encontra o marker já reivindicado e retorna `ALREADY_DELIVERED` sem reenviar — perda permanente e silenciosa de um link de credencial de guest por uma falha transitória de SES. Aceito este achado como real, severidade Média (não Alta — não é bypass de segurança, é perda de disponibilidade de um fluxo de credencial, mas em contexto de segurança/entrega de acesso isso pesa no eixo).

## Verificação independente das correções que Codex propôs aceitar

Li `infra/modules/cognito/main.tf:68-92` diretamente: confirmo `explicit_auth_flows` sem `ALLOW_REFRESH_TOKEN_AUTH` cru e presença de `refresh_token_rotation`/`token_validity_units` consistente com a alegação. Aceito.

Li `src/workers/guest-credential-delivery/deliver.ts` linhas 60-83 diretamente (reproduzido acima) — o bug é real e exatamente como descrito, não uma leitura equivocada de Codex.

## Notas revisadas (Claude, pós-evidência do Codex)

| # | Critério | Peso | Nota Round1 (minha) | Nota revisada | Motivo da mudança |
|---:|---|---:|---:|---:|---|
| 1 | Isolamento Multi-Tenant | 18% | 8.4 | 8.8 | Sem achado novo que reduza; Codex confirma isolamento GSI3/4/6/8 intacto. |
| 2 | Least-Privilege IAM | 14% | 6.0 | 6.3 | Concordância quase total com Codex (6.5) — mesmo achado (SEC-R2-01), mesma severidade Alta, mesma pendência de design. |
| 3 | Autenticação/Sessão | 11% | 7.6 | 9.0 | Correção aceita — sessão BFF com Cognito refresh rotation, tabela dedicada, KMS, revogação por dispositivo é controle real e forte, não aspiracional como eu havia registrado desatualizadamente. |
| 4 | Pipeline Assíncrono | 14% | 7.8 | 7.6 | Concordância com Codex — achado SEC-R2-03 (2 envelopes sem schema) confirmado sem correção desde Round1, borda interna reduz severidade mas critério é literal. |
| 5 | Validação de Entrada | 9% | 8.2 | 8.3 | Concordância com Codex. |
| 6 | Proteção de Dados/Segredos | 9% | 7.9 | 8.0 | Aceito achado SEC-R2-04 (IP bruto no rate limiter guest) como Baixo, real mas pequeno; ligeiro ajuste. |
| 7 | Logging/Detecção | 8% | 5.6 | 7.8 | Correção aceita — `infra/modules/alert-topic/main.tf` + `alarm_actions` em todos os módulos de observability é real (verifiquei existência do arquivo), resolve a lacuna "sem alvo" que eu havia mantido de Round1 sem reverificar nesta sessão. Mantenho abaixo de Codex (8.3) por SEC-R2-05 (subscription `PendingConfirmation` sem confirmação operacional comprovada) pesar um pouco mais para mim — controle existe em IaC mas não está provado end-to-end. |
| 8 | Configuração Segura da Plataforma | 6% | 7.7 | 8.2 | Concordância com Codex — `authorization_type=NONE` escopado corretamente nas rotas guest confirmado, superfície cresceu sem incidente. |
| 9 | Resistência a Abuso/DoS | 5% | 6.8 | 7.5 | Aceito quotas mantidas (Codex não achou regressão nas rotas novas) — eu havia deixado como "não verificado", Codex verificou e não achou regressão; subo mas não igualo por não ter verificado eu mesmo linha a linha todas as rotas novas. |
| 10 | Verificação Adversarial | 6% | 7.0 | 7.8 | D-225 confirmado design-only por ambos, independentemente — convergência forte nesse ponto específico. Processo de pesquisa externa por superfície nova (E-014) é real e recorrente. |

## Nota ponderada revisada (Claude)

(8.8×18 + 6.3×14 + 9.0×11 + 7.6×14 + 8.3×9 + 8.0×9 + 7.8×8 + 8.2×6 + 7.5×5 + 7.8×6) / 100
= (158.4 + 88.2 + 99.0 + 106.4 + 74.7 + 72.0 + 62.4 + 49.2 + 37.5 + 46.8) / 100
= 794.6 / 100 = **7.95/10**

Ainda abaixo de 9.0 — honesto, não arredondado. Convergência real com Codex (diferença caiu de 0.77 para ~0.22 pontos: 7.95 vs 8.168).

## Achado novo aceito, registrado para follow-up (nível 3-4, não implementado nesta auditoria — tarefa é auditoria, não correção)

**SEC-R2-02 (Médio, aceito)**: `deliverGuestCredential()` precisa de um estado de entrega com pelo menos 2 fases (`CLAIMED`→`SENT`, com lease expirável para permitir retry de uma claim travada em `CLAIMED` sem confirmação de envio) em vez de um marker binário reivindicado antes do side-effect. Mesmo padrão que `NotificationAttempt`'s `SUBMITTING`/lease já usa em outros workers do próprio repositório (`dossier-export-generation-handler`, D-217) — a correção é replicar um padrão já estabelecido, não inventar um novo, mas ainda assim é uma mudança de máquina de estados que não deve ser feita dentro de uma auditoria (fixes triviais nível 1-2 apenas). Registrado como PENDENTE para sessão futura.
