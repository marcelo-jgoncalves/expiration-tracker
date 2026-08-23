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

describe("document-request-chasing v1 (M10 cluster 4, D-039/D-048) — reenvio T7/T3 ao destinatário externo", () => {
  it("includes the rotated guest link and deadline, never the original secret", () => {
    const result = renderEmailTemplate("document-request-chasing", 1, "pt-BR", {
      requirementName: "Certidão negativa",
      deadlineLocal: "2026-09-06",
      guestLink: "https://app.example.invalid/guest/document-requests?token=abc.def",
    });
    expect(result.subject).toContain("Certidão negativa");
    expect(result.text).toContain("https://app.example.invalid/guest/document-requests?token=abc.def");
    expect(result.html).toContain("https://app.example.invalid/guest/document-requests?token=abc.def");
    expect(result.text).toMatch(/Não encaminhe este link/);
  });

  it("escapes HTML-significant characters in tenant-supplied fields (anti-injection, D-049)", () => {
    const result = renderEmailTemplate("document-request-chasing", 1, "pt-BR", {
      requirementName: '<img src=x onerror=alert(1)>',
      guestLink: "https://app.example.invalid/guest/x",
    });
    expect(result.html).not.toContain("<img src=x");
    expect(result.html).toContain("&lt;img");
  });
});

describe("document-request-chasing-expired-internal v1 (D-048) — tier EXPIRED, nunca envia link externo", () => {
  it("never includes a link - only names the requirement and recipient for internal awareness", () => {
    const result = renderEmailTemplate("document-request-chasing-expired-internal", 1, "pt-BR", {
      requirementName: "Certidão negativa",
      recipientDisplayName: "Fornecedor ACME",
    });
    expect(result.text).not.toMatch(/https?:\/\//);
    expect(result.html).not.toMatch(/https?:\/\//);
    expect(result.text).toContain("Certidão negativa");
    expect(result.text).toContain("Fornecedor ACME");
  });
});

describe("document-request-initial-invite v1 (D-049)", () => {
  it("renders the initial invitation with the guest link", () => {
    const result = renderEmailTemplate("document-request-initial-invite", 1, "pt-BR", {
      requirementName: "Contrato assinado",
      guestLink: "https://app.example.invalid/guest/document-requests?token=xyz",
    });
    expect(result.subject).toContain("Contrato assinado");
    expect(result.text).toContain("https://app.example.invalid/guest/document-requests?token=xyz");
  });
});

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
