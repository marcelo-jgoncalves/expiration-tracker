import { describe, expect, it } from "vitest";
import { decideNextAction } from "../../../src/modules/document/domain/document-state-machine.js";
import type { DocumentObjectReference } from "../../../src/modules/document/domain/document-object-reference.js";

const object: DocumentObjectReference = { bucket: "quarantine", key: "k1", versionId: "v1" };

describe("decideNextAction", () => {
  it("rejects on THREATS_FOUND regardless of upload validity", () => {
    const decision = decideNextAction({
      currentStatus: "SCANNING",
      uploadValid: true,
      malwareEvidence: { object, status: "THREATS_FOUND", scanResultId: "s1", observedAt: "2026-01-01T00:00:00.000Z" },
    });
    expect(decision).toEqual({ action: "REJECT", status: "REJECTED" });
  });

  it("rejects as UNSUPPORTED when GuardDuty reports UNSUPPORTED", () => {
    const decision = decideNextAction({
      currentStatus: "SCANNING",
      uploadValid: true,
      malwareEvidence: { object, status: "UNSUPPORTED", scanResultId: "s1", observedAt: "2026-01-01T00:00:00.000Z" },
    });
    expect(decision).toEqual({ action: "REJECT", status: "UNSUPPORTED" });
  });

  it("rejects when upload itself is invalid, even with no malware evidence yet", () => {
    const decision = decideNextAction({ currentStatus: "PENDING_UPLOAD", uploadValid: false });
    expect(decision).toEqual({ action: "REJECT", status: "REJECTED" });
  });

  it("awaits more evidence when upload is valid but malware result hasn't arrived", () => {
    const decision = decideNextAction({ currentStatus: "SCANNING", uploadValid: true });
    expect(decision).toEqual({ action: "AWAIT_MORE_EVIDENCE" });
  });

  it("awaits more evidence when malware is clean but upload evidence hasn't arrived yet (malware arrived first)", () => {
    const decision = decideNextAction({
      currentStatus: "PENDING_UPLOAD",
      malwareEvidence: { object, status: "NO_THREATS_FOUND", scanResultId: "s1", observedAt: "2026-01-01T00:00:00.000Z" },
    });
    expect(decision).toEqual({ action: "AWAIT_MORE_EVIDENCE" });
  });

  it("promotes only when upload is confirmed valid AND malware is clean (upload-then-malware order)", () => {
    const decision = decideNextAction({
      currentStatus: "SCANNING",
      uploadValid: true,
      malwareEvidence: { object, status: "NO_THREATS_FOUND", scanResultId: "s1", observedAt: "2026-01-01T00:00:00.000Z" },
    });
    expect(decision).toEqual({ action: "PROMOTE" });
  });

  it("promotes when malware evidence arrived before upload evidence, once both are present (malware-then-upload order)", () => {
    // Same final call as above, from the other worker's perspective - both orders converge to
    // the same action once both evidences are known, per M6 design's own acceptance criterion.
    const decision = decideNextAction({
      currentStatus: "SCANNING",
      uploadValid: true,
      malwareEvidence: { object, status: "NO_THREATS_FOUND", scanResultId: "s1", observedAt: "2026-01-01T00:00:00.000Z" },
    });
    expect(decision).toEqual({ action: "PROMOTE" });
  });

  it("never re-opens a terminal document (CLEAN/REJECTED/UNSUPPORTED/TIMEOUT/DELETED) for late/duplicate evidence", () => {
    for (const status of ["CLEAN", "REJECTED", "UNSUPPORTED", "TIMEOUT", "DELETED"] as const) {
      const decision = decideNextAction({
        currentStatus: status,
        uploadValid: true,
        malwareEvidence: { object, status: "THREATS_FOUND", scanResultId: "s1", observedAt: "2026-01-01T00:00:00.000Z" },
      });
      expect(decision).toEqual({ action: "IGNORE_STALE_EVENT" });
    }
  });

  it("never promotes on ACCESS_DENIED or FAILED - stays awaiting (adapter's retry/DLQ, then reconciler TIMEOUT, own the terminal decision)", () => {
    for (const status of ["ACCESS_DENIED", "FAILED"] as const) {
      const decision = decideNextAction({
        currentStatus: "SCANNING",
        uploadValid: true,
        malwareEvidence: { object, status, scanResultId: "s1", observedAt: "2026-01-01T00:00:00.000Z" },
      });
      expect(decision).toEqual({ action: "AWAIT_MORE_EVIDENCE" });
    }
  });
});
