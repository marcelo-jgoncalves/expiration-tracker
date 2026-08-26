/** Real `BedrockClient` adapter over `@aws-sdk/client-bedrock-runtime`'s Converse API (M7 item
 * 6, D-035 §1.9/§1.11). Owns the ONLY two things the port promises never leak past it: reading
 * the OCR artifact bytes (via `OcrArtifactStore.get()`) and the Converse request/response shape
 * itself - neither the raw document text nor the raw Converse payload is ever returned to the
 * caller; only the parsed, schema-validated `BedrockExtractionResult`.
 *
 * Model ID and region are deliberately configurable, with an obviously-placeholder default
 * (`BedrockRuntimeClient`'s own region comes from the client passed in at composition time, same
 * as every other AWS SDK client in this repo) - design §4 explicitly defers "escolha/validação
 * de modelo Bedrock" to a pre-production decision, so this adapter must never hardcode a real
 * model ARN. `dev` testability is unaffected by the placeholder per §4's own carve-out - nothing
 * calls this adapter until `AI_EXTRACTION`/`extraction_pipeline_enabled` are both turned on,
 * which is not this session's decision either.
 */
import { BedrockRuntimeClient, ConverseCommand, type Tool } from "@aws-sdk/client-bedrock-runtime";
import type { BedrockClient } from "../ports/bedrock-client.js";
import type { OcrArtifactStore } from "../ports/ocr-artifact-store.js";
import type { BedrockExtractionRequest, BedrockExtractionResult, BedrockFieldCandidate } from "../domain/bedrock-extraction.js";
import {
  BEDROCK_MAX_OUTPUT_TOKENS,
  BEDROCK_SYSTEM_PROMPT_V1,
  BEDROCK_TEMPERATURE,
  buildSubmitExtractionToolSchema,
  buildUserMessageText,
} from "../domain/bedrock-extraction.js";
import { FIELD_SCHEMA_V1, getFieldSchema } from "../domain/field-schema.js";
import { BedrockExtractionFailedError } from "../../../shared/errors/app-error.js";

interface ToolUseBlock {
  toolUse?: { name?: string; input?: unknown };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Validates the model's `submit_extraction` tool call input against the CLOSED schema built
 * from the same field list the request was built for - never trusts the model's shape, always
 * re-derives the expected key set independently (design §1.11's "validação externa ao modelo"). */
function parseSubmitExtractionInput(raw: unknown, pipelineVersion: string): BedrockFieldCandidate[] {
  if (!isPlainRecord(raw)) {
    throw new BedrockExtractionFailedError("submit_extraction tool input is not an object.");
  }
  const schema = getFieldSchema(pipelineVersion);
  const allowedNames = new Set(schema.map((f) => f.fieldName));
  const extraKeys = Object.keys(raw).filter((k) => !allowedNames.has(k));
  if (extraKeys.length > 0) {
    throw new BedrockExtractionFailedError("submit_extraction tool input has unexpected fields.", { extraKeys });
  }

  const fields: BedrockFieldCandidate[] = [];
  for (const field of schema) {
    const entry = raw[field.fieldName];
    if (entry === undefined) {
      if (field.required) {
        throw new BedrockExtractionFailedError(`submit_extraction tool input is missing required field ${field.fieldName}.`);
      }
      continue;
    }
    if (!isPlainRecord(entry) || typeof entry["value"] !== "string" || typeof entry["confidence"] !== "number") {
      throw new BedrockExtractionFailedError(`submit_extraction tool input for ${field.fieldName} has the wrong shape.`);
    }
    const confidence = entry["confidence"];
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      throw new BedrockExtractionFailedError(`submit_extraction tool input for ${field.fieldName} has an out-of-range confidence.`);
    }
    fields.push({ fieldName: field.fieldName, value: entry["value"], confidence });
  }
  return fields;
}

export class BedrockRuntimeConverseClient implements BedrockClient {
  constructor(
    private readonly client: BedrockRuntimeClient,
    private readonly artifacts: OcrArtifactStore,
    private readonly modelId: string,
  ) {}

  async extract(request: BedrockExtractionRequest): Promise<BedrockExtractionResult> {
    let documentText: string;
    try {
      const blocksJson = await this.artifacts.get(request.textArtifact);
      const blocks = JSON.parse(blocksJson) as Array<{ BlockType?: string; Text?: string }>;
      documentText = Array.isArray(blocks)
        ? blocks
            .filter((b) => b.BlockType === "LINE" && typeof b.Text === "string")
            .map((b) => b.Text as string)
            .join("\n")
        : "";
    } catch (err) {
      throw new BedrockExtractionFailedError("Failed to read/parse the OCR artifact for Bedrock extraction.", {
        cause: err instanceof Error ? err.message : String(err),
      });
    }

    const tool = buildSubmitExtractionToolSchema(FIELD_SCHEMA_V1);

    let response;
    try {
      response = await this.client.send(
        new ConverseCommand({
          modelId: this.modelId,
          system: [{ text: BEDROCK_SYSTEM_PROMPT_V1 }],
          messages: [{ role: "user", content: [{ text: buildUserMessageText(documentText) }] }],
          toolConfig: {
            // Cast: the SDK models `inputSchema` as a tagged union with a `$unknown` member for
            // forward-compat, which our closed, hand-built JSON Schema object doesn't need to
            // satisfy structurally - the runtime wire format is exactly `{ json: <schema> }`.
            tools: [{ toolSpec: tool as unknown as Tool.ToolSpecMember["toolSpec"] }],
            // Forced tool choice (§1.11) - the model has no path that avoids calling
            // submit_extraction, and no other tool is ever in the tools list to call instead.
            toolChoice: { tool: { name: tool.name } },
          },
          inferenceConfig: { temperature: BEDROCK_TEMPERATURE, maxTokens: BEDROCK_MAX_OUTPUT_TOKENS },
        }),
      );
    } catch (err) {
      throw new BedrockExtractionFailedError("Bedrock Converse call failed.", { cause: err instanceof Error ? err.message : String(err) });
    }

    const content = response.output?.message?.content ?? [];
    const toolUseBlock = (content as ToolUseBlock[]).find((b) => b.toolUse?.name === tool.name);
    if (!toolUseBlock?.toolUse) {
      throw new BedrockExtractionFailedError("Model response did not include a submit_extraction tool call.", {
        stopReason: response.stopReason,
      });
    }

    const fields = parseSubmitExtractionInput(toolUseBlock.toolUse.input, request.pipelineVersion);
    return { fields };
  }
}
