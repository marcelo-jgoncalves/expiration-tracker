import { describe, expect, it } from "vitest";
import { planDocumentVersionValidityEffect, DOCUMENT_VERSION_VALIDITY_FIELD_NAME } from "../../../src/modules/extraction/domain/document-version-validity-effect.js";

describe("planDocumentVersionValidityEffect (D-193 item 4/9 — the one planner shared by manual confirm and auto-confirm)", () => {
  it("plans SET when confirming expirationDate against an eligible DocumentVersion with a different (or absent) validUntil", () => {
    const plan = planDocumentVersionValidityEffect({
      fieldName: DOCUMENT_VERSION_VALIDITY_FIELD_NAME,
      confirmedValue: "2027-03-31",
      documentVersion: { state: "RECEIVED", validUntil: undefined },
    });
    expect(plan).toEqual({ kind: "SET", validUntil: "2027-03-31" });
  });

  it("plans SET (overwrite) when the confirmed value differs from an existing validUntil", () => {
    const plan = planDocumentVersionValidityEffect({
      fieldName: DOCUMENT_VERSION_VALIDITY_FIELD_NAME,
      confirmedValue: "2027-03-31",
      documentVersion: { state: "ACCEPTED", validUntil: "2026-01-01" },
    });
    expect(plan).toEqual({ kind: "SET", validUntil: "2027-03-31" });
  });

  it("plans NO_CHANGE when the confirmed value is byte-identical to the current validUntil — this is what makes the outbox write genuinely conditional", () => {
    const plan = planDocumentVersionValidityEffect({
      fieldName: DOCUMENT_VERSION_VALIDITY_FIELD_NAME,
      confirmedValue: "2027-03-31",
      documentVersion: { state: "UNDER_REVIEW", validUntil: "2027-03-31" },
    });
    expect(plan).toEqual({ kind: "NO_CHANGE" });
  });

  it.each(["REJECTED", "SUPERSEDED", "WITHDRAWN", "DRAFT"] as const)("plans NO_CHANGE for an ineligible DocumentVersion state (%s), never resurrecting a terminal/pre-review version's validUntil", (state) => {
    const plan = planDocumentVersionValidityEffect({
      fieldName: DOCUMENT_VERSION_VALIDITY_FIELD_NAME,
      confirmedValue: "2027-03-31",
      documentVersion: { state, validUntil: undefined },
    });
    expect(plan).toEqual({ kind: "NO_CHANGE" });
  });

  it("plans NO_CHANGE for any field name other than expirationDate — nothing else has a DocumentVersion-facing effect", () => {
    const plan = planDocumentVersionValidityEffect({
      fieldName: "someOtherField",
      confirmedValue: "anything",
      documentVersion: { state: "RECEIVED", validUntil: undefined },
    });
    expect(plan).toEqual({ kind: "NO_CHANGE" });
  });
});
