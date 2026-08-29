# Junção correlationId ↔ trace ADOT/X-Ray — Design (APPROVED, ainda não implementado)

> **Status**: `APPROVED` via protocolo Claude↔Codex (`AGENTS.md` §4), 3 rodadas — nota final Claude 9,3/10, Codex 9,4/10 (nota cega, independente), ambas ≥9,0. **Nenhum código foi implementado nesta sessão** — este documento é só o design aprovado, para o Marcelo decidir se/quando implementar. Se aprovado para implementação, mover para `docs/architecture/` (ou anexar como emenda a `m5-observability-design.md`) e apagar da raiz — este arquivo na raiz é deliberadamente temporário, mesmo padrão de outros `.md` de handoff/análise já usados nesta sessão.

## 1. Origem: um achado real, não um esquecimento

Uma auditoria formal do subsistema de logging/observabilidade (`docs/engineering/logging-observability-standard.md`, já `APPROVED`, gate 9,5/10) encontrou o critério "Tracing distribuído & junção log-trace" (10% do peso) abaixo do gate de auditoria (9,0/10) — falta uma forma de ir de um `correlationId` de log para o trace ADOT/X-Ray correspondente, ou vice-versa.

Investigando, isso não é um esquecimento: `docs/architecture/m5-observability-design.md` §3 (D-022, protocolo Claude↔Codex já concluído, nota final 9,1/10) já havia decidido, conscientemente, **não construir** essa junção — tratando `correlationId` (log) e trace ID (X-Ray) como conceitos deliberadamente paralelos:

> "O único código de propagação manual que este design mantém é o `correlationId` de negócio via envelope outbox (§2) — que é um conceito de log/correlação de aplicação, deliberadamente distinto e não substituível pelo trace ID do X-Ray (o `correlationId` sobrevive em texto legível nos logs CloudWatch mesmo sem abrir o console X-Ray)."

**Reconciliação entre as duas decisões (Rodada 2 desta sessão)**: D-022 não *proibiu* uma futura junção — só não a construiu, por não ser necessária para o objetivo daquele milestone. O achado do padrão de logging é uma lacuna operacional real e compatível com M5, não uma contradição a resolver "corrigindo o critério para baixo". Este documento propõe fechar essa lacuna de forma proporcional, sem reabrir a mecânica de instrumentação que M5 já decidiu (ADOT Lambda layer, sem `aws-xray-sdk-core`/`captureAWSv3Client`).

## 2. Opções consideradas

### Opção A — Recalibrar o critério do padrão de logging, não mexer em código

Rejeitada: trataria como "correção de critério" um achado que na verdade é uma lacuna real e barata de fechar — não proporcional deixar passar um ganho de baixo risco só porque a versão mais completa (Opção B) é mais arriscada.

### Opção B — `correlationId` como atributo de span OpenTelemetry (aditivo a M5, não escolhida agora)

Adicionar `@opentelemetry/api` (só a API, não um SDK/exporter — o exporter continua sendo inteiramente a ADOT layer) e, em `context.ts`'s `runWithContext`, chamar `trace.getActiveSpan()?.setAttribute("app.correlationId", ...)`.

Tecnicamente não contradiz M5 (a mecânica rejeitada por M5 foi especificamente instrumentar manualmente clientes AWS SDK via `captureAWSv3Client`; anotar um atributo de negócio no span que a ADOT layer já cria é aditivo, não uma reversão). Mas carrega risco técnico não verificado (depende de `trace.getActiveSpan()` capturar o span raiz da ADOT layer no ponto certo) e uma decisão adicional não resolvida (X-Ray/ADOT trata atributos como metadata por padrão — buscar por `correlationId` no console X-Ray exigiria configurá-lo como *annotation* pesquisável, não só metadata).

**Registrada como candidata futura**, condicionada a 3 pré-requisitos nomeados, nenhum satisfeito hoje:
1. Teste local com `@opentelemetry/sdk-trace-node` + exporter em memória, provando que `trace.getActiveSpan()` no ponto de `runWithContext` captura o span esperado (verificável sem deploy real).
2. Verificação real contra `dev` (deploy + inspeção do console X-Ray) confirmando que o atributo realmente aparece no span exportado.
3. Decisão explícita sobre configurar `app.correlationId` como X-Ray *annotation* (pesquisável) em vez de metadata simples (não pesquisável) — sem isso, a Opção B não entrega a busca "comecei pelo correlationId, quero achar o trace" que seria seu principal valor sobre a Opção D abaixo.

### Opção D (escolhida) — Logar o `_X_AMZN_TRACE_ID` de forma estruturada e validada, sem nova dependência

Ler a variável de ambiente reservada `_X_AMZN_TRACE_ID` — documentada pela AWS, atualizada a cada invocação real (não só cold start), leitura local sem IAM e sem side-effect — e incluir campos estruturados e validados em toda linha de log, nunca o header bruto.

**Por que esta, e não a C original (bruta)**: a proposta original desta sessão (Opção C) sugeria logar o header inteiro; o Codex, na Rodada 1, apontou corretamente que isso acopla operadores ao parsing manual de `Root=...;Parent=...;Sampled=...` e mistura um campo (`Lineage`) que a própria AWS recomenda não usar diretamente. A Opção D extrai e valida antes de logar.

## 3. Design técnico (para implementação futura)

1. **Novo arquivo `src/shared/observability/xray-trace-header.ts`** (não misturado com `runWithContext` em `context.ts`, por clareza conceitual) exportando:

   ```ts
   export interface XrayTraceHeaderFields {
     xrayTraceId?: string;
     xraySampled?: boolean;
     xrayParentId?: string;
   }

   export function parseXrayTraceHeader(raw: string | undefined): XrayTraceHeaderFields | undefined
   ```

   Regras de parsing (determinísticas, nunca lançam):
   - Split por `;`, depois por `=` — **não depende de ordem fixa dos campos** (o header não garante ordem).
   - `Root` → `xrayTraceId`, aceito se presente (o campo será preservado como recebido quando presente — não validado rigidamente contra um formato específico, decisão proporcional).
   - `Sampled` → `xraySampled: boolean`, só aceita literalmente `"0"` ou `"1"` — qualquer outro valor faz o campo (só este) ficar ausente.
   - `Parent` → `xrayParentId`, só se passar validação de hex de 16 caracteres — caso contrário omitido (campo secundário, reduz superfície).
   - `Lineage` — explicitamente ignorado (comentário no código citando que a AWS recomenda não usá-lo diretamente).
   - Input ausente/vazio/sem nenhum campo reconhecível → retorna `undefined` inteiro.

2. **`SecureLogger.write()`** (`logger.ts`) chama `parseXrayTraceHeader(process.env["_X_AMZN_TRACE_ID"])` a cada linha (não cacheado — o valor muda por invocação real) e inclui os campos presentes no objeto logado.

3. **Nota explicativa em `logging-observability-standard.md`'s critério 4** (não recalibração): "a junção existe quando há header válido; rastreabilidade real no console X-Ray depende de sampling — `xraySampled: false` é uma lacuna de amostragem aceita e esperada, não uma falha da integração."

4. **Teste**: `parseXrayTraceHeader` é função pura, testável com valores sintéticos — formato válido com ordem variável de campos, ausente, malformado, `Sampled` com valor inesperado, `Parent` inválido (não-hex ou tamanho errado), `Lineage` presente e confirmado ignorado. Determinístico, sem necessidade de deploy real.

## 4. Fora de escopo desta decisão

- Opção B (span attribute) — candidata futura, não decidida agora, 3 pré-requisitos listados acima.
- Qualquer mudança à mecânica de instrumentação ADOT/X-Ray já decidida em M5/D-022.
- Qualquer alarme/dashboard novo sobre estes campos — este design só cobre a emissão do dado, não consumo/alertas adicionais.

## 5. Registro de convergência

| Rodada | Nota Claude | Nota Codex | Achado principal |
|---|---:|---:|---|
| 1 | (proposta inicial) | 8,8/10 | D-022 superinterpretada como proibição explícita; corrigido para "não construiu, não proibiu" |
| 2 | (reconciliação) | 9,2/10 | Opção D formalizada com validação por campo, ordem variável, `Parent` como hex de 16 chars |
| 3 | 9,3/10 | 9,4/10 | Confirmação final, um ajuste editorial (não overclaim sobre formato de `Root`) |

Ambas ≥9,0 — `APPROVED`.
