/** Unit tests for `AppConfigFeatureFlagsReader`'s session-token caching/polling behavior — the
 * real logic in this adapter (a bare AppConfigData pass-through wouldn't need a test, per this
 * repo's convention). Hand-written fake client, no `vi.mock`. */
import { describe, it, expect } from "vitest";
import { AppConfigFeatureFlagsReader } from "../../../src/modules/extraction/persistence/appconfig-feature-flags-reader.js";

interface Call {
  commandName: string;
}

function makeClient(script: { start?: () => unknown; latest: (token: string | undefined) => unknown }) {
  const calls: Call[] = [];
  return {
    calls,
    send: async (cmd: { constructor: { name: string } } & Record<string, unknown>) => {
      const name = cmd.constructor.name;
      calls.push({ commandName: name });
      if (name === "StartConfigurationSessionCommand") {
        return script.start ? script.start() : { InitialConfigurationToken: "initial-token" };
      }
      if (name === "GetLatestConfigurationCommand") {
        const input = (cmd as unknown as { input: { ConfigurationToken: string } }).input;
        return script.latest(input.ConfigurationToken);
      }
      throw new Error(`unexpected command ${name}`);
    },
  };
}

const CONFIG = { applicationId: "app", environmentId: "env", configurationProfileId: "profile" };

describe("AppConfigFeatureFlagsReader", () => {
  it("starts a session then returns the parsed flags on first poll", async () => {
    const client = makeClient({
      latest: () => ({
        Configuration: Buffer.from(JSON.stringify({ features: { AI_EXTRACTION: false, OCR: true, WHATSAPP: false, EXTRACTION_DOCUMENT_ARCHIVE_TRIGGER_ENABLED: false, DOCUMENT_ARCHIVE_PROMOTION_ENABLED: false } })),
        NextPollConfigurationToken: "next-1",
      }),
    });
    const reader = new AppConfigFeatureFlagsReader(client as never, CONFIG);
    await expect(reader.getFlags()).resolves.toEqual({ AI_EXTRACTION: false, OCR: true, WHATSAPP: false, EXTRACTION_DOCUMENT_ARCHIVE_TRIGGER_ENABLED: false, DOCUMENT_ARCHIVE_PROMOTION_ENABLED: false });
    expect(client.calls.map((c) => c.commandName)).toEqual(["StartConfigurationSessionCommand", "GetLatestConfigurationCommand"]);
  });

  it("reuses the cached session token across calls (no repeated StartConfigurationSession)", async () => {
    const client = makeClient({
      latest: () => ({
        Configuration: Buffer.from(JSON.stringify({ features: { AI_EXTRACTION: false, OCR: true, WHATSAPP: false, EXTRACTION_DOCUMENT_ARCHIVE_TRIGGER_ENABLED: false, DOCUMENT_ARCHIVE_PROMOTION_ENABLED: false } })),
        NextPollConfigurationToken: "next-1",
      }),
    });
    const reader = new AppConfigFeatureFlagsReader(client as never, CONFIG);
    await reader.getFlags();
    await reader.getFlags();
    expect(client.calls.filter((c) => c.commandName === "StartConfigurationSessionCommand")).toHaveLength(1);
  });

  it("returns the cached flags when a later poll returns an empty Configuration (no change)", async () => {
    let first = true;
    const client = makeClient({
      latest: () => {
        if (first) {
          first = false;
          return { Configuration: Buffer.from(JSON.stringify({ features: { AI_EXTRACTION: true, OCR: true, WHATSAPP: true, EXTRACTION_DOCUMENT_ARCHIVE_TRIGGER_ENABLED: false, DOCUMENT_ARCHIVE_PROMOTION_ENABLED: false } })), NextPollConfigurationToken: "next-1" };
        }
        return { Configuration: Buffer.alloc(0), NextPollConfigurationToken: "next-2" };
      },
    });
    const reader = new AppConfigFeatureFlagsReader(client as never, CONFIG);
    await reader.getFlags();
    await expect(reader.getFlags()).resolves.toEqual({ AI_EXTRACTION: true, OCR: true, WHATSAPP: true, EXTRACTION_DOCUMENT_ARCHIVE_TRIGGER_ENABLED: false, DOCUMENT_ARCHIVE_PROMOTION_ENABLED: false });
  });

  /** Regression for the 2026-08-27 M7 E2E verification finding: this adapter read the three
   * booleans from the TOP level while `infra/modules/feature-flags` publishes them (and
   * `implementation-blueprint.md` §17.3 specifies them) inside a `features` envelope — so
   * every flag resolved to `false` no matter what was deployed, and the whole extraction
   * pipeline was permanently fail-closed in `dev`. The old tests asserted the wrong shape,
   * which is why the suite never caught it. */
  it("reads the flags from the `features` envelope that AppConfig actually serves", async () => {
    const client = makeClient({
      latest: () => ({
        Configuration: Buffer.from(JSON.stringify({ features: { AI_EXTRACTION: false, OCR: true, WHATSAPP: false, EXTRACTION_DOCUMENT_ARCHIVE_TRIGGER_ENABLED: false, DOCUMENT_ARCHIVE_PROMOTION_ENABLED: false } })),
        NextPollConfigurationToken: "next-1",
      }),
    });
    const reader = new AppConfigFeatureFlagsReader(client as never, CONFIG);
    await expect(reader.getFlags()).resolves.toEqual({ AI_EXTRACTION: false, OCR: true, WHATSAPP: false, EXTRACTION_DOCUMENT_ARCHIVE_TRIGGER_ENABLED: false, DOCUMENT_ARCHIVE_PROMOTION_ENABLED: false });
  });

  it("throws (never resolves 'unknown, proceed') when the session cannot be started", async () => {
    const client = makeClient({ start: () => ({}), latest: () => ({}) });
    const reader = new AppConfigFeatureFlagsReader(client as never, CONFIG);
    await expect(reader.getFlags()).rejects.toThrow();
  });

  it("throws when the first poll ever returns an empty configuration (no cache to fall back to)", async () => {
    const client = makeClient({ latest: () => ({ Configuration: Buffer.alloc(0), NextPollConfigurationToken: "next-1" }) });
    const reader = new AppConfigFeatureFlagsReader(client as never, CONFIG);
    await expect(reader.getFlags()).rejects.toThrow();
  });

  /** D-193 item 8/9: the two new flags parse with the SAME "=== true" fail-closed discipline
   * as AI_EXTRACTION/OCR/WHATSAPP - an absent key (a config published before this slice
   * existed) resolves to `false`, and an explicit `true` parses through correctly. */
  it("parses EXTRACTION_DOCUMENT_ARCHIVE_TRIGGER_ENABLED/DOCUMENT_ARCHIVE_PROMOTION_ENABLED when both are explicitly true", async () => {
    const client = makeClient({
      latest: () => ({
        Configuration: Buffer.from(
          JSON.stringify({ features: { AI_EXTRACTION: false, OCR: false, WHATSAPP: false, EXTRACTION_DOCUMENT_ARCHIVE_TRIGGER_ENABLED: true, DOCUMENT_ARCHIVE_PROMOTION_ENABLED: true } }),
        ),
        NextPollConfigurationToken: "next-1",
      }),
    });
    const reader = new AppConfigFeatureFlagsReader(client as never, CONFIG);
    await expect(reader.getFlags()).resolves.toEqual({
      AI_EXTRACTION: false,
      OCR: false,
      WHATSAPP: false,
      EXTRACTION_DOCUMENT_ARCHIVE_TRIGGER_ENABLED: true,
      DOCUMENT_ARCHIVE_PROMOTION_ENABLED: true,
    });
  });

  it("defaults both new flags to false when a config published before D-193 item 8/9 omits them entirely", async () => {
    const client = makeClient({
      latest: () => ({
        Configuration: Buffer.from(JSON.stringify({ features: { AI_EXTRACTION: true, OCR: true, WHATSAPP: true } })),
        NextPollConfigurationToken: "next-1",
      }),
    });
    const reader = new AppConfigFeatureFlagsReader(client as never, CONFIG);
    await expect(reader.getFlags()).resolves.toEqual({
      AI_EXTRACTION: true,
      OCR: true,
      WHATSAPP: true,
      EXTRACTION_DOCUMENT_ARCHIVE_TRIGGER_ENABLED: false,
      DOCUMENT_ARCHIVE_PROMOTION_ENABLED: false,
    });
  });
});
