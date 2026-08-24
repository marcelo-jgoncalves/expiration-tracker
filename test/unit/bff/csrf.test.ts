import { describe, expect, it } from "vitest";
import { checkCsrf, isSameSiteFetch, requiresCsrfCheck } from "../../../src/modules/bff/domain/csrf.js";

describe("csrf", () => {
  it("safe methods (GET/HEAD/OPTIONS) never require a CSRF check", () => {
    expect(requiresCsrfCheck("GET")).toBe(false);
    expect(requiresCsrfCheck("HEAD")).toBe(false);
    expect(requiresCsrfCheck("OPTIONS")).toBe(false);
    expect(requiresCsrfCheck("POST")).toBe(true);
    expect(requiresCsrfCheck("PUT")).toBe(true);
    expect(requiresCsrfCheck("PATCH")).toBe(true);
    expect(requiresCsrfCheck("DELETE")).toBe(true);
  });

  it("Sec-Fetch-Site: same-origin and none pass, everything else (including cross-site) fails", () => {
    expect(isSameSiteFetch("same-origin")).toBe(true);
    expect(isSameSiteFetch("none")).toBe(true);
    expect(isSameSiteFetch("cross-site")).toBe(false);
    expect(isSameSiteFetch("same-site")).toBe(false);
  });

  it("Sec-Fetch-Site absent (older browser) fails closed, never fail-open", () => {
    expect(isSameSiteFetch(undefined)).toBe(false);
  });

  it("GET requests always pass regardless of other fields", () => {
    expect(checkCsrf({ method: "GET", secFetchSite: undefined, headerToken: undefined, cookieToken: undefined, sessionCsrfSecret: "s" })).toBe(true);
  });

  it("passes when Sec-Fetch-Site is same-origin and header/cookie/session all match", () => {
    expect(checkCsrf({ method: "POST", secFetchSite: "same-origin", headerToken: "abc", cookieToken: "abc", sessionCsrfSecret: "abc" })).toBe(true);
  });

  it("fails when Sec-Fetch-Site is missing (not fail-open) even if header/cookie/session match", () => {
    expect(checkCsrf({ method: "POST", secFetchSite: undefined, headerToken: "abc", cookieToken: "abc", sessionCsrfSecret: "abc" })).toBe(false);
  });

  it("fails when Sec-Fetch-Site is cross-site", () => {
    expect(checkCsrf({ method: "POST", secFetchSite: "cross-site", headerToken: "abc", cookieToken: "abc", sessionCsrfSecret: "abc" })).toBe(false);
  });

  it("fails when header token is missing", () => {
    expect(checkCsrf({ method: "POST", secFetchSite: "same-origin", headerToken: undefined, cookieToken: "abc", sessionCsrfSecret: "abc" })).toBe(false);
  });

  it("fails when header and cookie disagree (classic double-submit forgery attempt)", () => {
    expect(checkCsrf({ method: "POST", secFetchSite: "same-origin", headerToken: "abc", cookieToken: "different", sessionCsrfSecret: "abc" })).toBe(false);
  });

  it("fails when header/cookie agree but neither matches the server-stored session secret (the extra layer D-053 adds over plain double-submit)", () => {
    expect(checkCsrf({ method: "POST", secFetchSite: "same-origin", headerToken: "abc", cookieToken: "abc", sessionCsrfSecret: "totally-different" })).toBe(false);
  });
});
