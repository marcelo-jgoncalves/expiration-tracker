/**
 * Heuristic document-type classifier — the first internal step of `RunTextract`'s `START_OCR`
 * operation (`claude-reconciliation-final-design.md` §1.2, correction of round 3: classification
 * is NOT a separate ASL Task state, it happens inside the same handler invocation before the
 * Textract call). Textract itself never classifies document type — this is pure heuristic
 * (extension, magic bytes, `Document` metadata already persisted by M6), no external call.
 *
 * Failure to classify -> `UnsupportedDocumentTypeError` (`../../../shared/errors/app-error.js`),
 * whose `code` string literally matches the ASL Catch's `UnsupportedDocumentType` ErrorEquals
 * entry — never change one without the other.
 */

/** Textract's own supported input formats for StartDocumentTextDetection. */
export type ClassifiedDocumentType = "PDF" | "IMAGE_JPEG" | "IMAGE_PNG" | "IMAGE_TIFF";

export interface DocumentClassificationInput {
  fileName: string;
  contentType?: string;
  /** First bytes of the object, best-effort — when available, magic bytes take precedence
   * over extension/contentType (both of which are attacker/user-controlled metadata). */
  magicBytes?: Uint8Array;
}

function classifyByMagicBytes(bytes: Uint8Array): ClassifiedDocumentType | null {
  if (bytes.length >= 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
    return "PDF"; // "%PDF"
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "IMAGE_JPEG";
  }
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return "IMAGE_PNG";
  }
  if (bytes.length >= 4 && ((bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0x00) ||
    (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0x00 && bytes[3] === 0x2a))) {
    return "IMAGE_TIFF";
  }
  return null;
}

function classifyByExtension(fileName: string): ClassifiedDocumentType | null {
  const ext = fileName.toLowerCase().split(".").pop();
  switch (ext) {
    case "pdf":
      return "PDF";
    case "jpg":
    case "jpeg":
      return "IMAGE_JPEG";
    case "png":
      return "IMAGE_PNG";
    case "tif":
    case "tiff":
      return "IMAGE_TIFF";
    default:
      return null;
  }
}

function classifyByContentType(contentType: string): ClassifiedDocumentType | null {
  const normalized = contentType.toLowerCase().split(";")[0]?.trim();
  switch (normalized) {
    case "application/pdf":
      return "PDF";
    case "image/jpeg":
      return "IMAGE_JPEG";
    case "image/png":
      return "IMAGE_PNG";
    case "image/tiff":
      return "IMAGE_TIFF";
    default:
      return null;
  }
}

/** Returns null (never throws) when no signal is conclusive — the caller (`startOcr`) decides
 * whether that's `UnsupportedDocumentType`, keeping this function a pure classifier. */
export function classifyDocumentType(input: DocumentClassificationInput): ClassifiedDocumentType | null {
  if (input.magicBytes) {
    const byMagic = classifyByMagicBytes(input.magicBytes);
    if (byMagic) return byMagic;
  }
  const byExtension = classifyByExtension(input.fileName);
  if (byExtension) return byExtension;
  if (input.contentType) {
    return classifyByContentType(input.contentType);
  }
  return null;
}
