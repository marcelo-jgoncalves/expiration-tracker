import { describe, expect, it } from "vitest";
import { chasingGsi3Keys, parseChasingGsi3Sk, buildChasingClaimGsi6Sk, documentChasingOccurrenceKey, documentChasingIntentKey } from "../../../src/modules/subject/domain/document-chasing.js";
import { parseGsi3Sk } from "../../../src/modules/reminder/domain/gsi3-parse.js";

describe("document-chasing domain — GSI3 discriminator (D-046: shared index, non-overlapping SK shape)", () => {
  it("chasingGsi3Keys produces a GSI3SK shape that never matches the reminder parser", () => {
    const keys = chasingGsi3Keys({ tenantId: "t1", occurrenceId: "occ-1", scheduledAt: "2026-08-23T12:03:00.000Z", shardCount: 4 });
    expect(keys.GSI3SK).toBe("TENANT#t1#CHASING#occ-1");
    expect(() => parseGsi3Sk(keys.GSI3SK)).toThrow(/Malformed GSI3SK/);
  });

  it("parseChasingGsi3Sk round-trips a real chasing key and rejects a reminder-shaped one (never throws)", () => {
    const keys = chasingGsi3Keys({ tenantId: "t1", occurrenceId: "occ-1", scheduledAt: "2026-08-23T12:03:00.000Z", shardCount: 4 });
    expect(parseChasingGsi3Sk(keys.GSI3SK)).toEqual({ tenantId: "t1", occurrenceId: "occ-1" });
    expect(parseChasingGsi3Sk("TENANT#t1#OCCURRENCE#occ-1")).toBeUndefined();
    expect(parseChasingGsi3Sk("garbage")).toBeUndefined();
  });

  it("chasingGsi3Keys uses the same minute-bucket/shard formula as reminders (same GSI3PK shape) - same physical index, D-046", () => {
    const keys = chasingGsi3Keys({ tenantId: "t1", occurrenceId: "occ-1", scheduledAt: "2026-08-23T12:03:00.000Z", shardCount: 4 });
    expect(keys.GSI3PK).toMatch(/^DUE#202608231203#\d{2}$/);
  });

  it("buildChasingClaimGsi6Sk is ordered by claimExpiresAt (same sort-key discipline as reminders)", () => {
    const earlier = buildChasingClaimGsi6Sk("2026-08-23T12:00:00.000Z", "t1", "occ-1");
    const later = buildChasingClaimGsi6Sk("2026-08-23T13:00:00.000Z", "t1", "occ-2");
    expect(earlier < later).toBe(true);
  });

  it("documentChasingOccurrenceKey/documentChasingIntentKey co-locate under the subject partition, nested under assignment/documentRequest", () => {
    const occKey = documentChasingOccurrenceKey("t1", "s1", "a1", "d1", "2026-08-23T12:00:00.000Z", "occ-1");
    expect(occKey.PK).toBe("TENANT#t1#SUBJECT#s1");
    expect(occKey.SK).toBe("REQASSIGN#a1#DOCREQ#d1#CHASING#2026-08-23T12:00:00.000Z#occ-1");

    const intentKey = documentChasingIntentKey("t1", "s1", "a1", "d1", "intent-1");
    expect(intentKey.PK).toBe("TENANT#t1#SUBJECT#s1");
    expect(intentKey.SK).toBe("REQASSIGN#a1#DOCREQ#d1#CHASINGINTENT#intent-1");
  });
});
