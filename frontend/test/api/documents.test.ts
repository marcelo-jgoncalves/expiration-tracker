import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { computeChecksumSha256 } from "../../src/api/documents.js";

describe("computeChecksumSha256", () => {
  it("computes a real SHA-256 hex digest from a File's bytes, matching node:crypto's independent computation over the same content", async () => {
    const content = "hello world";
    const file = new File([content], "hello.txt", { type: "text/plain" });
    const digest = await computeChecksumSha256(file);
    const expected = createHash("sha256").update(content).digest("hex");
    expect(digest).toBe(expected);
    expect(digest).toHaveLength(64);
  });

  it("a different file produces a different digest", async () => {
    const a = await computeChecksumSha256(new File(["one"], "a.txt"));
    const b = await computeChecksumSha256(new File(["two"], "b.txt"));
    expect(a).not.toBe(b);
  });
});
