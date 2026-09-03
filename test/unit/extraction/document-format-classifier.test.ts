import { describe, expect, it } from "vitest";
import { classifyDocumentType } from "../../../src/modules/extraction/domain/document-format-classifier.js";

describe("classifyDocumentType", () => {
  it("classifies a PDF by magic bytes", () => {
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
    expect(classifyDocumentType({ fileName: "whatever.bin", magicBytes: bytes })).toBe("PDF");
  });

  it("classifies a JPEG by magic bytes", () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
    expect(classifyDocumentType({ fileName: "whatever.bin", magicBytes: bytes })).toBe("IMAGE_JPEG");
  });

  it("classifies a PNG by magic bytes", () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(classifyDocumentType({ fileName: "whatever.bin", magicBytes: bytes })).toBe("IMAGE_PNG");
  });

  it("classifies TIFF (little-endian and big-endian) by magic bytes", () => {
    expect(classifyDocumentType({ fileName: "x", magicBytes: new Uint8Array([0x49, 0x49, 0x2a, 0x00]) })).toBe("IMAGE_TIFF");
    expect(classifyDocumentType({ fileName: "x", magicBytes: new Uint8Array([0x4d, 0x4d, 0x00, 0x2a]) })).toBe("IMAGE_TIFF");
  });

  it("falls back to file extension when magic bytes are absent", () => {
    expect(classifyDocumentType({ fileName: "cert.pdf" })).toBe("PDF");
    expect(classifyDocumentType({ fileName: "photo.jpeg" })).toBe("IMAGE_JPEG");
  });

  it("falls back to contentType when extension is unhelpful", () => {
    expect(classifyDocumentType({ fileName: "cert.download", contentType: "application/pdf; charset=binary" })).toBe("PDF");
  });

  it("prefers magic bytes over a mismatched extension (an attacker/mislabeled upload)", () => {
    const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
    expect(classifyDocumentType({ fileName: "photo.png", magicBytes: pdfBytes })).toBe("PDF");
  });

  it("returns null when no signal is conclusive", () => {
    expect(classifyDocumentType({ fileName: "cert.docx", contentType: "application/msword" })).toBeNull();
  });

  it("returns null for empty/short magicBytes buffers rather than throwing", () => {
    expect(classifyDocumentType({ fileName: "unknown", magicBytes: new Uint8Array([]) })).toBeNull();
  });

  // D-193 item 3/9 slice 3: `DocumentFile` (document-archive) carries no `fileName` field at
  // all - `start-extraction-run-for-document-archive.ts` passes `""` rather than fabricate one,
  // relying on this exact fallback (empty extension never matches -> contentType decides) using
  // `DocumentFile.mediaType` as `contentType`. All 4 Textract-supported formats covered.
  it("classifies correctly from an empty fileName + real contentType alone (the document-archive path, which has no fileName concept)", () => {
    expect(classifyDocumentType({ fileName: "", contentType: "application/pdf" })).toBe("PDF");
    expect(classifyDocumentType({ fileName: "", contentType: "image/jpeg" })).toBe("IMAGE_JPEG");
    expect(classifyDocumentType({ fileName: "", contentType: "image/png" })).toBe("IMAGE_PNG");
    expect(classifyDocumentType({ fileName: "", contentType: "image/tiff" })).toBe("IMAGE_TIFF");
  });
});
