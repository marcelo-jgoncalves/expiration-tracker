import { describe, expect, it } from "vitest";
import { CopyObjectCommand } from "@aws-sdk/client-s3";
import { S3DocumentObjectStore } from "../../../src/modules/document/persistence/s3-document-object-store.js";

describe("S3DocumentObjectStore.copyObject", () => {
  it("real bug found via Camada 3 (2026-08-22): CopySource preserves the key's literal '/' segment separators instead of percent-encoding them to %2F (which produced a CopySource matching no real object, failing every real promotion with an opaque S3 'UnknownError')", async () => {
    let capturedCommand: CopyObjectCommand | undefined;
    const fakeClient = {
      send: async (command: CopyObjectCommand) => {
        capturedCommand = command;
        return { VersionId: "clean-v1" };
      },
    };
    const store = new S3DocumentObjectStore(fakeClient as unknown as ConstructorParameters<typeof S3DocumentObjectStore>[0]);

    const source = {
      bucket: "quarantine-bucket",
      key: "tenant/t1/item/item1/document/doc1/slot/slot1/e797dd89-9ef8-4445-9d5b-ec3d12170499",
      versionId: "YMSGyw0tg8hxClONKdpNQfLoD7Azu0MY",
    };
    await store.copyObject(source, "clean-bucket", "clean/t1/doc1");

    expect(capturedCommand?.input.CopySource).toBe(
      "quarantine-bucket/tenant/t1/item/item1/document/doc1/slot/slot1/e797dd89-9ef8-4445-9d5b-ec3d12170499?versionId=YMSGyw0tg8hxClONKdpNQfLoD7Azu0MY",
    );
  });
});
