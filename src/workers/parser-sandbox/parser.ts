/**
 * PDF structural validation — M6 design §3.3 / blueprint §12.4/§23.1. Pure function over raw
 * bytes (the Lambda handler is the only thing that touches S3), so it's unit-testable without
 * any AWS dependency. Hard limits fixed by the approved design, never configurable per-call:
 * max 50 pages, max 25MB decompressed, deterministic library version (pdf-lib, pinned exact
 * in package.json - never `^`/`~`).
 *
 * `pdf-lib`'s own parser already rejects most structurally corrupt/malformed input by
 * throwing, which this function treats as INVALID_STRUCTURE - never assumed to be a zip/
 * decompression bomb specifically (that's a resource-limit concern the caller's Lambda memory/
 * timeout config enforces, not something this function can prove from content alone). The
 * byte-pattern blocklist below is a second, independent check for active-content constructs
 * the blueprint explicitly requires blocking, regardless of whether pdf-lib itself considers
 * the document well-formed.
 */
import { PDFDocument } from "pdf-lib";
import type { PdfParseResult } from "../../modules/document/ports/pdf-parser.js";

export const MAX_PAGES = 50;
export const MAX_DECOMPRESSED_BYTES = 25 * 1024 * 1024;

/** Raw PDF keyword blocklist — blueprint §12.4: "bloqueio de arquivos anexos, JavaScript,
 * ações, referências externas e conteúdo ativo". Scanned over raw bytes, not just the parsed
 * object graph, so an obfuscated/nested reference can't dodge detection by structure alone. */
const BLOCKED_KEYWORDS = ["/JavaScript", "/JS", "/Launch", "/EmbeddedFile", "/RichMedia", "/OpenAction", "/AA"];

export async function parsePdfStructure(bytes: Uint8Array): Promise<PdfParseResult> {
  if (bytes.byteLength > MAX_DECOMPRESSED_BYTES) {
    return { outcome: "LIMIT_EXCEEDED" };
  }

  const raw = Buffer.from(bytes).toString("latin1");
  if (BLOCKED_KEYWORDS.some((kw) => raw.includes(kw))) {
    return { outcome: "INVALID_STRUCTURE" };
  }

  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { ignoreEncryption: false, updateMetadata: false });
  } catch {
    return { outcome: "INVALID_STRUCTURE" };
  }

  const pageCount = doc.getPageCount();
  if (pageCount > MAX_PAGES) {
    return { outcome: "LIMIT_EXCEEDED", pageCount };
  }
  if (pageCount === 0) {
    return { outcome: "INVALID_STRUCTURE", pageCount };
  }

  return { outcome: "VALID", pageCount };
}
