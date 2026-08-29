# Junção correlationId ↔ trace ADOT/X-Ray — Design (APPROVED) + implementação (2026-08-29)

> **Status**: `APPROVED` via protocolo Claude↔Codex (`AGENTS.md` §4). **v1** (Rodadas 1-3): nota final Claude 9,3/10, Codex 9,4/10 (nota cega, independente), ambas ≥9,0. **v2** (Rodada 4, 2026-08-29): Marcelo revisou a v1 e propôs 4 melhorias complementares; Codex avaliou cada uma e recomendou incorporar todas — ver §6 (documento de melhorias já consumido/apagado após incorporação). **Implementado nesta sessão** (2026-08-29, sinal explícito do Marcelo): `src/shared/observability/xray-trace-header.ts` novo, precedência de `SecureLogger.write()` corrigida (`logger.ts`), 20 testes novos/estendidos (`test/unit/xray-trace-header.test.ts`, `test/unit/logger.test.ts`), `typecheck`/`lint`/`check-docs`/`npm test` limpos — decisão de implementação: `xrayParentId` (campo `Parent`) deliberadamente **fora do v1 do código**, conforme a opção de simplicidade já registrada em §3 (regra do `Parent`). Status real: **`IMPLEMENTED`/`UNIT TESTED`**, ainda **não `E2E PROVEN`** — falta o smoke test real em `dev` (§3.5), bloqueado nesta sessão por ausência de acesso AWS (sem credenciais locais, MCP `aws-mcp` falhou ao conectar); ver `NEXT_SESSION_PROMPT.md` para o registro do pendente. Movido de `expiration-tracker-correlationid-trace-join-design-2026-08-29.md` (raiz) para cá após a implementação, conforme a própria nota original deste documento.

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
   - `Root` → `xrayTraceId`, **só se passar validação rígida do formato documentado do X-Ray** (v2, Rodada 4): `^1-[0-9a-fA-F]{8}-[0-9a-fA-F]{24}$` (versão + 8 hex + 24 hex). Um valor que não bate esse formato NÃO vira `xrayTraceId` — um caller externo/upstream não confiável não deve conseguir colocar um valor arbitrário nos logs estruturados sob um nome que implica ser um trace ID confiável (achado do Marcelo, confirmado pelo Codex: minha cautela original de "preservar como recebido, sem validação rígida" era conservadora demais).
   - `Sampled` → `xraySampled: boolean`, só aceita literalmente `"0"` ou `"1"` — qualquer outro valor faz o campo (só este) ficar ausente.
   - `Parent` → `xrayParentId`, só se passar validação de hex de 16 caracteres — caso contrário omitido. **v2 (Rodada 4): campo OPCIONAL na primeira implementação, candidato a ficar de fora da v1 do código** — `xrayTraceId`+`xraySampled` já fecham o caso de uso real (join operacional); `Parent` é fácil de interpretar errado como "o span desta linha de log" (não é — é o contexto parent recebido no header) e adiciona ruído sem valor essencial. Decisão de simplicidade, não bloqueio.
   - `Lineage` — explicitamente ignorado (comentário no código citando que a AWS recomenda não usá-lo diretamente).
   - Input ausente/vazio/sem nenhum campo reconhecível → retorna `undefined` inteiro.

2. **`SecureLogger.write()`** (`logger.ts`) chama `parseXrayTraceHeader(process.env["_X_AMZN_TRACE_ID"])` a cada linha (não cacheado — o valor muda por invocação real) e inclui os campos presentes no objeto logado.

3. **Correção de precedência no logger — v2 (Rodada 4), achado real e JÁ EXISTENTE hoje, independente desta feature**: `SecureLogger.write()` hoje faz `{ ...getContext(), ...this.baseContext, ...context }` — o argumento `context` de CADA chamada (`logger.info(event, context)`) vem por ÚLTIMO no spread, então **hoje** um call site que passe `{ tenantId: "outro" }` como contexto sobrescreve silenciosamente o `tenantId`/`correlationId` reais do `AsyncLocalStorage`. Isto deixa de ser só uma precaução para os campos xray futuros — é hardening de confiabilidade do logger que vale a pena fazer independentemente de quando esta feature de tracing for implementada. Ordem de precedência corrigida (menos para mais confiável, campos `undefined` nunca sobrescrevem um valor já definido por uma camada mais confiável): `context` (metadata por chamada, menos confiável) → `this.baseContext` → `getContext()` (AsyncLocalStorage) → campos `xray*` derivados de runtime (mais confiáveis, nunca vêm de fora). Precisa de teste de regressão dedicado (§3.5).

4. **Cardinalidade correlationId↔xrayTraceId — v2 (Rodada 4), nota de documentação**: os dois **não têm relação 1:1**. Um único fluxo lógico de negócio (mesmo `correlationId`) atravessa múltiplas invocações Lambda reais (HTTP→SQS→Step Functions→...), cada uma com seu próprio trace X-Ray. A junção é uma **relação observacional** entre contexto de aplicação e contexto de tracing, nunca uma identidade equivalente — documentar isso explicitamente onde o mecanismo for descrito (comentário de código + `logging-observability-standard.md`), para não criar uma expectativa operacional errada ("um correlationId sempre aponta para exatamente um trace").

5. **Sampling, nota que já valia na v1, reforçada**: `xraySampled: false` pode aparecer legitimamente ao lado de um `xrayTraceId` válido — significa que aquela invocação específica não tem necessariamente um trace persistido/consultável no X-Ray (comportamento normal de sampling, não falha da integração). A alegação correta é "quando há contexto X-Ray válido, o logger registra a identidade do trace; a disponibilidade posterior do trace depende da política de sampling" — nunca "todo correlationId sempre terá trace consultável".

### 3.5. Testes (ampliado na v2, Rodada 4)

**Testes do parser** (função pura, determinística, sem deploy): formato válido com ordem variável de campos; ausente/vazio; `Root` inválido (tamanho errado, caracteres não-hex, sem o prefixo `1-`) → `xrayTraceId` omitido especificamente; `Sampled` com valor inesperado → só esse campo omitido; `Parent` inválido → só esse campo omitido; `Lineage` presente → confirmado ignorado; campos desconhecidos → ignorados; nunca lança para nenhuma entrada malformada (fail-open).

**Teste de precedência (novo, v2, Rodada 4)** — cobre o achado #3 acima: um caller que passe `{ xrayTraceId: "fake", xraySampled: false }` (ou `{ tenantId: "outro", correlationId: "forjado" }`) como `context` de uma chamada de log, com `getContext()`/`_X_AMZN_TRACE_ID` reais presentes no ambiente, deve produzir uma linha de log com os valores REAIS de runtime, nunca os valores forjados pelo caller.

**Smoke test real em `dev` (novo, v2, Rodada 4) — distinto de e adicional aos testes unitários acima**: testes unitários provam o parser e a precedência, mas não provam a junção operacional em si (que o Lambda realmente atualiza `_X_AMZN_TRACE_ID` como esperado neste ambiente, e que o `xrayTraceId` logado realmente abre o trace certo no console X-Ray). Procedimento: deploy real → invocar uma Lambda com tracing ativo → localizar uma linha de log real → confirmar `correlationId`/`xrayTraceId`/`xraySampled=true` presentes → copiar o `xrayTraceId` → consultar o trace correspondente no console X-Ray → confirmar que representa a mesma invocação → registrar a evidência. Sem isso, o status correto a declarar é `IMPLEMENTED`/`UNIT TESTED`, nunca `E2E PROVEN`/`OPERATIONALLY PROVEN` — distinção que deve ficar explícita em qualquer registro futuro deste trabalho (mesmo padrão de honestidade epistêmica já usado em `test-engineering-standard.md`'s gate G-C1).

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

Ambas ≥9,0 — `APPROVED` (v1).

## 6. Rodada 4 (v1 → v2) — melhorias complementares propostas pelo Marcelo

Depois da v1 aprovada, o Marcelo revisou o documento e escreveu 4 melhorias complementares (`expiration-tracker-correlationid-xray-trace-design-improvements-2026-08-29.md`). Discutidas com o Codex (mesma thread, nota cega não estritamente aplicável aqui — é uma extensão de uma decisão já convergida, não uma nova proposta do zero):

1. Validar `Root` rigidamente — **incorporado** (§3, regra do `Root`).
2. Documentar que `correlationId`↔`xrayTraceId` não é 1:1 — **incorporado** (§3, item 4).
3. Proteger campos de runtime contra sobrescrita por metadata do caller — **incorporado** (§3, item 3) — Codex confirmou que isto é um achado real e JÁ EXISTENTE no `logger.ts` de hoje, não hipotético, e recomendou tratá-lo com prioridade própria, independente desta feature de tracing.
4. Smoke test real em `dev` distinguindo `UNIT TESTED` de `E2E PROVEN` — **incorporado** (§3.5).
5. (Sugestão adicional do Marcelo, aceita pelo Codex) `xrayParentId` opcional/removível da v1 do código — **incorporado** (§3, regra do `Parent`).

Parecer do Codex: "eu incorporaria quase tudo... as melhorias são pequenas, reduzem ambiguidade operacional e não mudam a decisão central... não vejo over-engineering aqui." Nenhuma das 5 sugestões foi rejeitada.
