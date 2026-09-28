/**
 * Real-time automation cost budget (D-347 §3.7, `docs/project/planos-precos-2026-09-27.md`) -
 * Bedrock's per-call cost debited against a per-tenant monthly budget via the SAME
 * `TenantQuotaService`/`quota.consume()` primitive `start-ocr.ts` already uses, just with a
 * cost-in-cents amount instead of a fixed 1-per-event reservation. Never a pre-computed
 * quota derived from an AVERAGE cost (the Round 8 arithmetic bug this design replaced:
 * average != maximum) - only real, per-operation spend.
 *
 * `budgetCentsPerCycle` is NOT yet plan-derived: `TenantEntitlement` (subject/domain/
 * entitlement.ts) has no price field - billing/plan pricing is M12, not yet built. Every
 * tenant today is on the only plan that exists in code (`free`), so this uses the Free
 * tier's fixed subsidized allowance (§3.7: "~R$1/mês... subsidiado conscientemente") for
 * everyone until M12 wires a real per-plan value in here.
 */
/** Codex R1 finding (ALTO): a single constant window key ("CYCLE") rolled over IN PLACE on
 * `TenantQuotaService`'s own fixed-window primitive, which can let a `release()` compensating
 * a PREVIOUS cycle's reservation land on the row after it has already rolled into the NEXT
 * cycle (its `resetAt`/`count` belong to a different tenant-cycle generation by the time the
 * compensating write's OCC check runs, but the check only guards against a change AFTER its own
 * read, not a stale caller intent). Keying the window itself by calendar month makes every
 * cycle a structurally DIFFERENT row - a release() racing a rollover simply finds no record for
 * its own (now past) month and no-ops, exactly like the pre-existing "window already reset
 * naturally" case already handles, rather than ever touching the new month's row. */
export function automationBudgetWindow(nowIso: string): string {
  return `CYCLE#${nowIso.slice(0, 7)}`;
}
/** Comfortably wider than one calendar month so this row is never treated as naturally expired
 * mid-cycle by the underlying fixed-window primitive - the calendar-month KEY above, not this
 * value, is what actually delimits the cycle. */
export const AUTOMATION_BUDGET_WINDOW_SECONDS = 40 * 24 * 60 * 60;

/**
 * VALOR DE REFERÊNCIA (não usado como teto real sem confirmação explícita - ver
 * `bedrockCostCentsPerCall` abaixo), derivado dos limites REAIS já configurados no adapter
 * (`bedrock-extraction.ts`: `BEDROCK_MAX_ARTIFACT_CHARS = 20_000`, `BEDROCK_MAX_OUTPUT_TOKENS =
 * 1024`):
 *   - input: ~6.000 tokens (20.000 chars / ~4 chars-por-token, aproximação usual para texto em
 *     português/inglês, + margem para o system prompt/schema da tool call) x US$6,00/1M = US$0,036
 *   - output: 1.024 tokens (o teto real configurado, não aproximado) x US$30,00/1M = US$0,03072
 *   - total ≈ US$0,067 x R$5,30/US$ (mesma taxa usada em todo planos-precos-2026-09-27.md) ≈
 *     R$0,355 → arredondado para CIMA a 36 centavos, usando o preço on-demand de Claude 3.5
 *     Sonnet (AWS, consultado 2026-09-27) como referência.
 *
 * Codex R3 finding (ALTO, corrigido por redesenho): "o mais caro entre os modelos Claude
 * disponíveis" se mostrou uma premissa falsa na PRÓXIMA consulta à documentação da própria
 * Anthropic (mesma sessão) - Opus 4 custava mais na tabela da AWS, e a nova geração (Opus
 * 5.5) custa MENOS que o "3.5 Sonnet" usado aqui como referência. Preço de modelo em Bedrock
 * muda rápido demais para qualquer constante única ser uma garantia - por isso este valor NÃO
 * é mais usado como teto autoritativo por padrão (ver `bedrockCostCentsPerCall` abaixo, que
 * falha fechado sem confirmação explícita amarrada ao modelo realmente configurado). Mantido
 * só como exemplo do cálculo/metodologia e valor de fallback nos testes deste módulo. */
export const BEDROCK_COST_CENTS = 36;

/**
 * Resolve o teto de centavos por chamada Bedrock REAL, falhando fechado (retorna `undefined`)
 * quando não há confirmação explícita amarrada ao modelo configurado - nunca assume o valor de
 * referência acima silenciosamente. `undefined` aqui é o sinal que `runBedrockExtraction()` usa
 * para pular Bedrock inteiramente e degradar (mesmo caminho de orçamento esgotado), exatamente
 * a exigência do Codex R3: "configuração sem cobertura deve impedir a chamada ou degradar com
 * segurança". `envValue` é lido pelo handler/composition root de `BEDROCK_COST_CENTS_PER_CALL`
 * - a MESMA disciplina de placeholder que `BEDROCK_MODEL_ID` já usa (bedrock-extraction-task-
 * handler.ts): quem escolhe o modelo real, antes de ativar `AI_EXTRACTION` fora de `dev`, deve
 * recalcular este valor para ESSE modelo (metodologia documentada acima) e configurar ambos
 * juntos - nunca só o modelo. */
export function resolveBedrockCostCentsPerCall(envValue: string | undefined): number | undefined {
  if (envValue === undefined || envValue.trim() === "") return undefined;
  const parsed = Number(envValue);
  // Codex R4 finding (MÉDIO): must match `TenantQuotaService`'s own `validatedAmount()`
  // contract (positive INTEGER, no fractional cents) exactly - a value this function accepted
  // but quota.consume() rejected (e.g. "35.5") would reserve AI_CALL, then throw a raw,
  // uncaught Error mid-run instead of degrading gracefully, leaving the reservation dangling.
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

/** R$0,0159/verificação (2 páginas x US$1,50/1000 x R$5,30), arredondado a centavos inteiros -
 * não debitado ainda nesta implementação (start-ocr.ts): a válvula secundária de Textract
 * (adiar mesmo o OCR base em extremos genuínos) exige mudança no contrato da Step Function
 * (waitForTaskToken/ASL) que não foi revisada nesta fatia - pendência registrada, não um
 * esquecimento silencioso. */
export const TEXTRACT_COST_CENTS = 2;

/** R$1,00/mês (~100 centavos), a alocação fixa e pequena do Free citada em §3.7. */
export const FREE_TIER_AUTOMATION_BUDGET_CENTS_PER_CYCLE = 100;
