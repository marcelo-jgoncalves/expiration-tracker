/** Narrow port over Bedrock's Converse API - no `@aws-sdk/client-bedrock-runtime` import
 * outside the adapter (same discipline as `TextractClient`/`OcrArtifactStore`). The adapter
 * owns: resolving `textArtifact` to bytes via `OcrArtifactStore.get()`, assembling the
 * `system`/`user`/tool-choice Converse request per `bedrock-extraction.ts`, and parsing the
 * tool-call response - none of that crosses this port boundary as raw text or raw SDK types. */
import type { BedrockExtractionRequest, BedrockExtractionResult } from "../domain/bedrock-extraction.js";

export interface BedrockClient {
  /** Throws `BedrockExtractionFailedError` (never returns a partial/best-effort result) when:
   * the Converse call itself fails, the model does not call `submit_extraction` at all, the
   * model calls any other tool, the tool-call arguments fail to parse as JSON, or the parsed
   * arguments don't validate against the closed schema (extra/missing/wrong-typed fields). */
  extract(request: BedrockExtractionRequest): Promise<BedrockExtractionResult>;
}
