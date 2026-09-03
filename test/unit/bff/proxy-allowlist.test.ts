import { describe, expect, it } from "vitest";
import { matchAllowlistedRoute } from "../../../src/modules/bff/domain/proxy-allowlist.js";

describe("proxy-allowlist", () => {
  it("matches an exact allowlisted route with a templated segment", () => {
    const route = matchAllowlistedRoute("GET", "/items/item-123");
    expect(route).toBeDefined();
    expect(route?.pathTemplate).toBe("/items/{itemId}");
  });

  it("matches method case-insensitively", () => {
    expect(matchAllowlistedRoute("get", "/items/dashboard")).toBeDefined();
  });

  it("does not match a route with the wrong method", () => {
    // Not "DELETE /items/dashboard" - "dashboard" is a syntactically valid {itemId} value
    // there (mirroring the real API Gateway's own template routing, which has the identical
    // ambiguity and would 404 on a nonexistent item id, not reject the shape of the request).
    expect(matchAllowlistedRoute("PATCH", "/items/item-1")).toBeUndefined(); // PUT is allowlisted for this path, PATCH never was
  });

  it("does not match a path with extra segments (no prefix matching, no wildcard passthrough)", () => {
    expect(matchAllowlistedRoute("GET", "/items/item-123/extra/nested")).toBeUndefined();
  });

  it("does not match a path with fewer segments than the template", () => {
    expect(matchAllowlistedRoute("GET", "/items")).toBeUndefined(); // /items is POST-only, GET /items is not allowlisted
  });

  it("never matches /guest/* - guest routes are public and outside the BFF's concern", () => {
    expect(matchAllowlistedRoute("GET", "/guest/document-requests/some-token")).toBeUndefined();
    expect(matchAllowlistedRoute("POST", "/guest/document-requests/some-token/uploads")).toBeUndefined();
  });

  it("never matches an arbitrary/unregistered path (the BFF is not a generic proxy)", () => {
    expect(matchAllowlistedRoute("GET", "/admin/secret-panel")).toBeUndefined();
    expect(matchAllowlistedRoute("GET", "/")).toBeUndefined();
    expect(matchAllowlistedRoute("GET", "")).toBeUndefined();
  });

  it("matches every nested subjects/requirements/document-requests route exactly", () => {
    expect(matchAllowlistedRoute("POST", "/subjects/subj-1/requirements/req-1/document-requests")).toBeDefined();
    expect(matchAllowlistedRoute("GET", "/subjects/subj-1/document-requests/dr-1")).toBeDefined();
    expect(matchAllowlistedRoute("POST", "/subjects/subj-1/document-requests/dr-1/revoke")).toBeDefined();
  });

  // BLOCKER-A (2026-08-25): these backend routes existed but were never allowlisted here -
  // the BFF would have rejected any frontend call to them, same class of gap the
  // document-request routes had before a prior session's fix (infra/modules/api-gateway/
  // main.tf's comment on that incident).
  it("matches the Document/DocumentSubmission read routes closed for BLOCKER-A", () => {
    expect(matchAllowlistedRoute("GET", "/items/item-1/documents")).toBeDefined();
    expect(matchAllowlistedRoute("GET", "/items/item-1/documents/doc-1")).toBeDefined();
    expect(matchAllowlistedRoute("GET", "/subjects/subj-1/requirements/req-1/submissions")).toBeDefined();
    expect(matchAllowlistedRoute("GET", "/subjects/subj-1/requirements/req-1/submissions/sub-1")).toBeDefined();
  });

  // D-178: reserveFiles() (D-163/D-167) existed as a resource-Lambda route but was never
  // allowlisted here - found during D-177's allowlist read. Same gap class as BLOCKER-A above.
  it("matches the DocumentVersion reserveFiles route closed for D-178", () => {
    expect(matchAllowlistedRoute("POST", "/document-archive/documents/doc-1/versions/1/files")).toBeDefined();
  });

  // P0.1 (RequirementTemplate): all 9 routes wired in infra/modules/api-gateway/main.tf must be
  // reachable through the BFF. A route present in Terraform but missing here is a Lambda nothing
  // can call - the exact D-117/D-120/D-178 gap class, asserted at the time of writing instead of
  // being found by a later session.
  it("matches every RequirementTemplate route (P0.1)", () => {
    expect(matchAllowlistedRoute("POST", "/document-archive/requirement-templates")).toBeDefined();
    expect(matchAllowlistedRoute("GET", "/document-archive/requirement-templates")).toBeDefined();
    expect(matchAllowlistedRoute("GET", "/document-archive/requirement-templates/tpl-1")).toBeDefined();
    expect(matchAllowlistedRoute("PATCH", "/document-archive/requirement-templates/tpl-1")).toBeDefined();
    expect(matchAllowlistedRoute("POST", "/document-archive/requirement-templates/tpl-1/duplicate")).toBeDefined();
    expect(matchAllowlistedRoute("POST", "/document-archive/requirement-templates/tpl-1/archive")).toBeDefined();
    expect(matchAllowlistedRoute("POST", "/document-archive/requirement-templates/tpl-1/unarchive")).toBeDefined();
    expect(matchAllowlistedRoute("POST", "/document-archive/requirement-templates/tpl-1/preview")).toBeDefined();
    expect(matchAllowlistedRoute("POST", "/document-archive/requirement-templates/tpl-1/apply")).toBeDefined();
  });

  it("does not allowlist a RequirementTemplate route that does not exist in Terraform", () => {
    expect(matchAllowlistedRoute("DELETE", "/document-archive/requirement-templates/tpl-1")).toBeUndefined();
  });
});
