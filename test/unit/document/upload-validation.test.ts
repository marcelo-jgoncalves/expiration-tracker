import { describe, expect, it } from "vitest";
import { validateObservedUpload, MAX_UPLOAD_BYTES } from "../../../src/modules/document/application/upload-validation.js";

const declared = { mediaType: "application/pdf", contentLength: 1000, checksumSha256: "a".repeat(64) };

describe("validateObservedUpload", () => {
  it("accepts an exact match", () => {
    expect(validateObservedUpload(declared, { ...declared })).toBe("VALID");
  });

  it("accepts a match without checksum available from HeadObject metadata", () => {
    expect(validateObservedUpload(declared, { mediaType: "application/pdf", contentLength: 1000 })).toBe("VALID");
  });

  it("rejects size exceeding the 10MiB limit even if it matches what was declared", () => {
    const big = { mediaType: "application/pdf", contentLength: MAX_UPLOAD_BYTES + 1, checksumSha256: "a".repeat(64) };
    expect(validateObservedUpload(big, { ...big })).toBe("SIZE_EXCEEDS_LIMIT");
  });

  it("rejects size mismatch between declared and observed", () => {
    expect(validateObservedUpload(declared, { ...declared, contentLength: 999 })).toBe("SIZE_MISMATCH");
  });

  it("rejects media type mismatch", () => {
    expect(validateObservedUpload(declared, { ...declared, mediaType: "image/png" })).toBe("MEDIA_TYPE_MISMATCH");
  });

  it("rejects checksum mismatch", () => {
    expect(validateObservedUpload(declared, { ...declared, checksumSha256: "b".repeat(64) })).toBe("CHECKSUM_MISMATCH");
  });
});
