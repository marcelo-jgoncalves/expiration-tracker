import { describe, expect, it } from "vitest";
import { renderEmailTemplate, sanitizeTenantText } from "../../../src/modules/notification/providers/email-templates.js";

describe("renderEmailTemplate", () => {
  it("renders the expiration-reminder v1 pt-BR template with the given context", () => {
    const result = renderEmailTemplate("expiration-reminder", 1, "pt-BR", {
      itemDisplayName: "Contrato de aluguel",
      dueDateLocal: "2026-09-01",
    });
    expect(result.subject).toBe("Lembrete de vencimento: Contrato de aluguel");
    expect(result.text).toContain("Contrato de aluguel");
    expect(result.text).toContain("2026-09-01");
    expect(result.html).toContain("<strong>Contrato de aluguel</strong>");
  });

  it("falls back to defaults when the render context is missing expected fields", () => {
    const result = renderEmailTemplate("expiration-reminder", 1, "pt-BR", {});
    expect(result.subject).toBe("Lembrete de vencimento: seu item");
  });

  it("escapes HTML-significant characters in the rendered context to prevent injection", () => {
    const result = renderEmailTemplate("expiration-reminder", 1, "pt-BR", {
      itemDisplayName: '<script>alert("x")</script>',
    });
    expect(result.html).not.toContain("<script>");
    expect(result.html).toContain("&lt;script&gt;");
  });

  it("fails closed on an unknown templateId/version/locale combination instead of guessing", () => {
    expect(() => renderEmailTemplate("expiration-reminder", 2, "pt-BR", {})).toThrow(/Unknown email template/);
    expect(() => renderEmailTemplate("expiration-reminder", 1, "en-US", {})).toThrow(/Unknown email template/);
    expect(() => renderEmailTemplate("unknown-template", 1, "pt-BR", {})).toThrow(/Unknown email template/);
  });
});

// ADR-0016 Decision A (2026-09-25) retired the "document-request-chasing"/
// "document-request-chasing-expired-internal"/"document-request-initial-invite" templates these
// suites used to cover (document-chasing/initial-invite features, fully removed). The surviving
// "guest-credential-delivery-invite" template (document-archive module) is covered end-to-end by
// test/unit/document-archive/guest-credential-delivery-worker.test.ts.

describe("sanitizeTenantText (D-049) — campo fornecido pelo tenant antes de interpolar em e-mail externo", () => {
  it("trims, collapses whitespace and caps at 80 characters", () => {
    expect(sanitizeTenantText("  Fornecedor   ACME  ", "fallback")).toBe("Fornecedor ACME");
    expect(sanitizeTenantText("a".repeat(200), "fallback")).toHaveLength(80);
  });

  it("strips control characters and CRLF (never lets the tenant inject a header/newline)", () => {
    expect(sanitizeTenantText("Fornecedor\r\nBcc: attacker@evil.example", "fallback")).toBe("Fornecedor Bcc: attacker@evil.example");
  });

  it("falls back when the input is undefined or becomes empty after sanitization", () => {
    expect(sanitizeTenantText(undefined, "fallback")).toBe("fallback");
    expect(sanitizeTenantText("   ", "fallback")).toBe("fallback");
    expect(sanitizeTenantText("\x00\x01\x02", "fallback")).toBe("fallback");
  });
});
