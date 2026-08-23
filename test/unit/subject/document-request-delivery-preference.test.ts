import { describe, expect, it } from "vitest";
import { resolveInitialInviteDeliveryMode, documentRequestDeliveryPreferenceKey } from "../../../src/modules/subject/domain/document-request-delivery-preference.js";

describe("resolveInitialInviteDeliveryMode (D-049)", () => {
  it("defaults to MANUAL when nothing is configured at any level", () => {
    expect(resolveInitialInviteDeliveryMode({})).toBe("MANUAL");
  });

  it("uses the tenant default when no override (or DEFAULT) is given", () => {
    expect(resolveInitialInviteDeliveryMode({ tenantDefault: "EMAIL" })).toBe("EMAIL");
    expect(resolveInitialInviteDeliveryMode({ override: "DEFAULT", tenantDefault: "EMAIL" })).toBe("EMAIL");
  });

  it("an explicit override always wins over the tenant default", () => {
    expect(resolveInitialInviteDeliveryMode({ override: "MANUAL", tenantDefault: "EMAIL" })).toBe("MANUAL");
    expect(resolveInitialInviteDeliveryMode({ override: "EMAIL", tenantDefault: "MANUAL" })).toBe("EMAIL");
  });
});

describe("documentRequestDeliveryPreferenceKey", () => {
  it("is a tenant-level settings key, never per-subject", () => {
    expect(documentRequestDeliveryPreferenceKey("tenant-1")).toEqual({ PK: "TENANT#tenant-1#SETTINGS", SK: "DOCUMENT_REQUEST_DELIVERY" });
  });
});
