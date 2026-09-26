# Full-audit round3 — eixo Segurança — reconciliação (Claude + Codex, nota cega)

Ver `claude-scope-and-findings.md` (análise do Claude, escrita ANTES de ler a saída do Codex) e
`codex-round1-{prompt,output}.txt` (rodada única, nota cega). Escopo: só superfície criada/
reescrita depois de 2026-09-12 (corte do round2/E-018) — não uma nova auditoria do zero.

## Achados novos, reconciliados

| ID | Severidade | Critério | Bloco | Status |
|---|---|---|---|---|
| R3-01 | Médio | 4 (Integridade Pipeline Assíncrono) | Reminder Producer Control Plane | **PENDENTE** — `reminder-claim-consumer-handler.ts` nunca lê/valida `rolloutEpoch`; Lambda não recebe `SCAN_MODE_EPOCH`. Confirmado por leitura direta (`claimReminderOccurrence()` não tem parâmetro de epoch). Toca a máquina de estados distribuída de D-299-304 — correção precisa de sessão dedicada relendo `DECISION.md`/`AMENDMENT-001.md` por inteiro, não um patch às pressas. |
| R3-02 | Médio | 5 (Validação de Entrada/Fail-Closed) | Reminder Producer Control Plane | **PENDENTE** — `dynamodb-reminder-due-work-store.ts`/`scan-page.ts` fazem cast sem validar shape da linha; contraria D-302 §6 (linha inválida deveria bloquear checkpoint). Mesma razão de R3-01 para não corrigir agora sem sessão dedicada. |
| R3-03 | Médio | 4 (Integridade Pipeline Assíncrono) | Reminder Producer Control Plane | **CORRIGIDO nesta sessão** — `reminder-scan-control-relay-handler.ts` reportava `eventID` como `itemIdentifier` de `batchItemFailures` (contrato AWS exige `SequenceNumber` — confirmado contra `docs.aws.amazon.com/lambda/.../services-ddb-batchfailurereporting.html`). `correlationId`/log separado do `itemIdentifier`, que agora só usa `SequenceNumber` real. |
| R3-04 | Médio | 9 (Resistência a Abuso/DoS) | CSV Bulk Import | **CORRIGIDO nesta sessão** — `mapCsvRowsToNamedFields` materializava 1 propriedade por coluna do cabeçalho × toda linha, sem teto de colunas (byte/row limits existentes não protegem contra cabeçalho patológico). Achado verificado experimentalmente pelo Codex (29.090 bytes → 500 mil propriedades → ~25 MB heap extra). `MAX_IMPORT_HEADER_COLUMNS=50` adicionado, checado logo após o parse, antes do mapeamento. Teste novo cobrindo o cenário. |

## Confirmações (sem achado novo)

- Login/Signup/Reset (D-329): rate-limiting dedicado por conta/IP **confirmado ainda ausente**
  (não foi corrigido silenciosamente) — já registrado como obrigatório pré-usuário-real junto com
  E-019, não é pendência nova. Enumeração de signup (409) confirmada como risco conscientemente
  mantido, não achado novo. CSRF (`requireSameSiteFetch`) e política de senha Cognito (12
  caracteres + maiúscula/minúscula/número/símbolo) confirmadas presentes e corretas.
- CSV Bulk Import: nenhum achado novo de formula injection (mitigação já vive na exportação,
  D-217), SSRF ou path traversal (chaves de S3 construídas pelo servidor, nunca por entrada bruta).
- Nenhum dos dois lados reabriu SEC-R2-01 a 05 (round2) — status desses 5 permanece o já registrado
  em `decisions-log.md` D-336 (3 corrigidos, 1 residual aceito via protocolo/D-234 pendente de
  decisão do dono do projeto, 1 pendente de ação humana/confirmação de e-mail SNS).

## Blocos ainda não cobertos por esta rodada 3 (pendência explícita, não esquecimento)

- Bloco 4: WhatsApp phone confirmation (item 26) — bloqueado por trabalho não commitado de outra
  sessão nos mesmos arquivos.
- Bloco 5: Notification Entitlements/D-332 (endpoint agregado de urgência) — revisado
  informalmente nesta sessão (é só um enriquecimento de 3 campos aditivos num endpoint JÁ
  existente/autorizado, `GET /dashboard/summary`, não superfície nova) — sem achado, não precisa de
  rodada dedicada.
