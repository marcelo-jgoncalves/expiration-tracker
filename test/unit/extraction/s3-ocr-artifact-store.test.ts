import { describe, expect, it } from "vitest";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { S3OcrArtifactStore } from "../../../src/modules/extraction/persistence/s3-ocr-artifact-store.js";

/**
 * W3-07 (D-070 chunk 6/N): the OCR artifact key used to be `ocr/<runId>/<randomUUID()>.json` -
 * a fresh random suffix on every `put()` call, so a redelivered COMPLETE_OCR completion
 * notification for the SAME run (e.g. PutObject succeeded but the downstream SendTaskSuccess
 * failed, so the SQS message redelivers and completeOcr() runs again) wrote a SECOND, orphaned
 * S3 object with no way to ever be discovered/cleaned by `runId` alone. Fixed to a deterministic
 * key `ocr/<tenantId>/<runId>.json`, matching the approved design's key convention - idempotent
 * physical writes, so redelivery of the same run always lands on the same logical object.
 */
describe("S3OcrArtifactStore.put", () => {
  function captureClient() {
    const commands: PutObjectCommand[] = [];
    const fakeClient = {
      send: async (command: PutObjectCommand) => {
        commands.push(command);
        return {};
      },
    };
    return { fakeClient, commands };
  }

  it("writes to a deterministic key derived from tenantId+runId, not a random suffix", async () => {
    const { fakeClient, commands } = captureClient();
    const store = new S3OcrArtifactStore(fakeClient as unknown as ConstructorParameters<typeof S3OcrArtifactStore>[0], "extraction-transient");

    const ref = await store.put("tenant-a", "run-1", JSON.stringify([{ block: 1 }]));

    expect(ref).toEqual({ bucket: "extraction-transient", key: "ocr/tenant-a/run-1.json" });
    expect(commands[0]?.input.Key).toBe("ocr/tenant-a/run-1.json");
  });

  it("regression: PutObject succeeds, the downstream step (SendTaskSuccess) fails, redelivery happens - the redelivered write lands on the SAME key, never a second/duplicate object", async () => {
    const { fakeClient, commands } = captureClient();
    const store = new S3OcrArtifactStore(fakeClient as unknown as ConstructorParameters<typeof S3OcrArtifactStore>[0], "extraction-transient");

    // First attempt: PutObject succeeds (this fake always "succeeds"), but in the real system
    // the caller's subsequent SendTaskSuccess would fail here - the SQS message is NOT deleted
    // and redelivers, so completeOcr() (and therefore this put()) runs again for the same job.
    const first = await store.put("tenant-a", "run-1", JSON.stringify([{ block: 1 }]));
    const second = await store.put("tenant-a", "run-1", JSON.stringify([{ block: 1 }]));

    expect(first.key).toBe(second.key);
    expect(commands).toHaveLength(2);
    expect(commands[0]?.input.Key).toBe(commands[1]?.input.Key);
    // Only one logical S3 object ever exists at this key regardless of how many times the
    // redelivered write lands - a real S3 PutObject to the same key overwrites in place, it
    // never creates a second object, which is exactly the idempotent-physical-write property
    // this deterministic key was introduced to guarantee.
  });

  it("different tenants for the same runId never collide on the same key (tenant-scoped prefix, not just runId)", async () => {
    const { fakeClient, commands } = captureClient();
    const store = new S3OcrArtifactStore(fakeClient as unknown as ConstructorParameters<typeof S3OcrArtifactStore>[0], "extraction-transient");

    await store.put("tenant-a", "run-1", "{}");
    await store.put("tenant-b", "run-1", "{}");

    expect(commands[0]?.input.Key).toBe("ocr/tenant-a/run-1.json");
    expect(commands[1]?.input.Key).toBe("ocr/tenant-b/run-1.json");
    expect(commands[0]?.input.Key).not.toBe(commands[1]?.input.Key);
  });
});
