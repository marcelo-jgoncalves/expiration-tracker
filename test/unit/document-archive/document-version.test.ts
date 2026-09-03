import { describe, expect, it } from "vitest";
import {
  canTransitionDocumentVersion,
  assertValidDocumentVersionTransition,
  InvalidDocumentVersionTransitionError,
  isRemovableDocumentVersionState,
  isTerminalDocumentVersionState,
  hasCleanFileScans,
  formatVersionSeq,
  documentVersionKey,
  reviewQueueGsi5Keys,
  versionLookupGsi5Keys,
  deriveDocumentVersionValidityState,
  type DocumentVersionState,
} from "../../../src/modules/document-archive/domain/document-version.js";

const ALL_STATES: DocumentVersionState[] = ["DRAFT", "RECEIVED", "UNDER_REVIEW", "ACCEPTED", "REJECTED", "SUPERSEDED", "WITHDRAWN"];
const NOW = new Date("2026-09-03T00:00:00.000Z");

describe("deriveDocumentVersionValidityState (D-194 fatia 1)", () => {
  it.each(["DRAFT", "REJECTED", "SUPERSEDED", "WITHDRAWN"] as const)("excludes state %s (undefined)", (state) => {
    expect(deriveDocumentVersionValidityState({ state, validUntil: undefined }, NOW)).toBeUndefined();
  });

  it.each(["RECEIVED", "UNDER_REVIEW"] as const)("state %s -> AGUARDANDO_REVISAO", (state) => {
    expect(deriveDocumentVersionValidityState({ state, validUntil: undefined }, NOW)).toBe("AGUARDANDO_REVISAO");
  });

  it("ACCEPTED with no validUntil -> PERMANENTE", () => {
    expect(deriveDocumentVersionValidityState({ state: "ACCEPTED", validUntil: undefined }, NOW)).toBe("PERMANENTE");
  });

  it("ACCEPTED with a future validUntil beyond the soon window -> VALIDO", () => {
    expect(deriveDocumentVersionValidityState({ state: "ACCEPTED", validUntil: "2027-01-01T00:00:00.000Z" }, NOW)).toBe("VALIDO");
  });

  it("ACCEPTED within the soon window -> VENCENDO", () => {
    expect(deriveDocumentVersionValidityState({ state: "ACCEPTED", validUntil: "2026-09-05T00:00:00.000Z" }, NOW)).toBe("VENCENDO");
  });

  it("ACCEPTED with a past validUntil -> VENCIDO", () => {
    expect(deriveDocumentVersionValidityState({ state: "ACCEPTED", validUntil: "2026-01-01T00:00:00.000Z" }, NOW)).toBe("VENCIDO");
  });
});

describe("DocumentVersion state machine (D-143 Decision 1)", () => {
  it.each([
    ["DRAFT", "RECEIVED"],
    ["DRAFT", "WITHDRAWN"],
    ["RECEIVED", "UNDER_REVIEW"],
    ["UNDER_REVIEW", "RECEIVED"],
    ["RECEIVED", "ACCEPTED"],
    ["UNDER_REVIEW", "ACCEPTED"],
    ["RECEIVED", "REJECTED"],
    ["UNDER_REVIEW", "REJECTED"],
    ["ACCEPTED", "SUPERSEDED"],
  ] as const)("allows %s -> %s", (from, to) => {
    expect(canTransitionDocumentVersion(from, to)).toBe(true);
    expect(() => assertValidDocumentVersionTransition(from, to)).not.toThrow();
  });

  it("rejects REJECTED as a source of any further transition — J9's 'stays in history' invariant", () => {
    for (const to of ALL_STATES) {
      expect(canTransitionDocumentVersion("REJECTED", to)).toBe(false);
    }
  });

  it("rejects DRAFT -> ACCEPTED directly (must pass through RECEIVED first, even in the compressed C3 flow which writes RECEIVED as an event, not a skip)", () => {
    expect(canTransitionDocumentVersion("DRAFT", "ACCEPTED")).toBe(false);
  });

  it("rejects WITHDRAWN/SUPERSEDED as a source of any further transition (terminal)", () => {
    for (const from of ["WITHDRAWN", "SUPERSEDED"] as const) {
      for (const to of ALL_STATES) {
        expect(canTransitionDocumentVersion(from, to)).toBe(false);
      }
    }
  });

  it("throws InvalidDocumentVersionTransitionError with the attempted from/to on an illegal transition", () => {
    expect(() => assertValidDocumentVersionTransition("REJECTED", "ACCEPTED")).toThrow(InvalidDocumentVersionTransitionError);
    try {
      assertValidDocumentVersionTransition("REJECTED", "ACCEPTED");
      expect.fail("expected throw");
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidDocumentVersionTransitionError);
      expect((error as InvalidDocumentVersionTransitionError).from).toBe("REJECTED");
      expect((error as InvalidDocumentVersionTransitionError).to).toBe("ACCEPTED");
    }
  });
});

describe("isRemovableDocumentVersionState (D-143 Decision 7)", () => {
  it("only DRAFT is removable — REJECTED must never be, per J9", () => {
    expect(isRemovableDocumentVersionState("DRAFT")).toBe(true);
    for (const state of ALL_STATES.filter((s) => s !== "DRAFT")) {
      expect(isRemovableDocumentVersionState(state)).toBe(false);
    }
  });
});

describe("isTerminalDocumentVersionState", () => {
  it("classifies ACCEPTED/REJECTED/SUPERSEDED/WITHDRAWN as terminal, DRAFT/RECEIVED/UNDER_REVIEW as not", () => {
    expect(isTerminalDocumentVersionState("ACCEPTED")).toBe(true);
    expect(isTerminalDocumentVersionState("REJECTED")).toBe(true);
    expect(isTerminalDocumentVersionState("SUPERSEDED")).toBe(true);
    expect(isTerminalDocumentVersionState("WITHDRAWN")).toBe(true);
    expect(isTerminalDocumentVersionState("DRAFT")).toBe(false);
    expect(isTerminalDocumentVersionState("RECEIVED")).toBe(false);
    expect(isTerminalDocumentVersionState("UNDER_REVIEW")).toBe(false);
  });
});

describe("hasCleanFileScans (D-143 Decision 6/Bloqueador 9)", () => {
  it("requires BOTH counters at zero — zero pending with one infected must not read as clean", () => {
    expect(hasCleanFileScans({ pendingFileScans: 0, infectedFileScans: 0 })).toBe(true);
    expect(hasCleanFileScans({ pendingFileScans: 1, infectedFileScans: 0 })).toBe(false);
    expect(hasCleanFileScans({ pendingFileScans: 0, infectedFileScans: 1 })).toBe(false);
    expect(hasCleanFileScans({ pendingFileScans: 1, infectedFileScans: 1 })).toBe(false);
  });
});

describe("key builders", () => {
  it("formatVersionSeq zero-pads to 6 digits so lexical SK ordering matches numeric order", () => {
    expect(formatVersionSeq(1)).toBe("000001");
    expect(formatVersionSeq(42)).toBe("000042");
    expect("000002" < "000010").toBe(true); // the exact property zero-padding buys
  });

  it("documentVersionKey co-locates versions under the Document's own PK (AP2 — no GSI needed)", () => {
    expect(documentVersionKey("tenant-1", "doc-1", 3)).toEqual({ PK: "TENANT#tenant-1#DOCUMENT#doc-1", SK: "VERSION#000003" });
  });

  it("reviewQueueGsi5Keys buckets RECEIVED and UNDER_REVIEW separately (AP5 — never a fixed literal for both)", () => {
    const received = reviewQueueGsi5Keys("t1", "RECEIVED", "2026-09-01T00:00:00.000Z", "v1");
    const underReview = reviewQueueGsi5Keys("t1", "UNDER_REVIEW", "2026-09-01T00:00:00.000Z", "v1");
    expect(received.GSI5PK).not.toBe(underReview.GSI5PK);
    expect(received.GSI5PK).toBe("TENANT#t1#REVIEWQUEUE#RECEIVED");
  });

  it("versionLookupGsi5Keys (AP11) is keyed by versionId alone, independent of documentId", () => {
    expect(versionLookupGsi5Keys("t1", "v1")).toEqual({ GSI5PK: "TENANT#t1#VERSIONLOOKUP", GSI5SK: "VERSION#v1" });
  });
});
