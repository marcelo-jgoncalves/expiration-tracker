import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

/**
 * Unit tests for infra/modules/spa-hosting/spa-routing.js — the CloudFront Function
 * (viewer-request) associated ONLY to the SPA's default_cache_behavior (ADR-0011). Loaded via
 * `vm` because it's plain CloudFront-runtime JS (no module system, no npm dependency) - these
 * tests are the "suíte real de testes unitários" required by
 * docs/architecture/reviews/spa-hosting-cloudfront-bff/proposal-claude-v4.md Correção 3.
 */
function loadHandler(): (event: { request: { uri: string; method: string; querystring?: unknown } }) => { uri: string; method: string } {
  const code = readFileSync(new URL("../../../infra/modules/spa-hosting/spa-routing.js", import.meta.url), "utf-8");
  const context: Record<string, unknown> = {};
  runInNewContext(`${code}\nthis.handler = handler;`, context);
  return context.handler as ReturnType<typeof loadHandler>;
}

function request(uri: string, method = "GET") {
  return { request: { uri, method, headers: {}, querystring: {} } };
}

describe("spa-routing CloudFront Function", () => {
  const handler = loadHandler();

  it("rewrites the SPA root to index.html", () => {
    expect(handler(request("/")).uri).toBe("/index.html");
  });

  it("rewrites a client-side route without extension to index.html", () => {
    expect(handler(request("/items/123")).uri).toBe("/index.html");
    expect(handler(request("/subjects")).uri).toBe("/index.html");
  });

  it("leaves a hashed build asset untouched", () => {
    expect(handler(request("/assets/index-a1b2c3.js")).uri).toBe("/assets/index-a1b2c3.js");
    expect(handler(request("/assets/style-9f8e7d.css")).uri).toBe("/assets/style-9f8e7d.css");
  });

  it("never rewrites the exact /bff path", () => {
    expect(handler(request("/bff")).uri).toBe("/bff");
  });

  it("never rewrites /bff/ or any /bff/* route", () => {
    expect(handler(request("/bff/")).uri).toBe("/bff/");
    expect(handler(request("/bff/session")).uri).toBe("/bff/session");
    expect(handler(request("/bff/api/items")).uri).toBe("/bff/api/items");
  });

  it("never rewrites a /.well-known/ path", () => {
    expect(handler(request("/.well-known/acme-challenge/token")).uri).toBe("/.well-known/acme-challenge/token");
  });

  it("never rewrites a non-GET/HEAD method, even for an extension-less path", () => {
    expect(handler(request("/items", "POST")).uri).toBe("/items");
    expect(handler(request("/items", "DELETE")).uri).toBe("/items");
  });

  it("rewrites for HEAD the same way as GET", () => {
    expect(handler(request("/items/123", "HEAD")).uri).toBe("/index.html");
  });
});
