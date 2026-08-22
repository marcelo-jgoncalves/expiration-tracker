import { describe, expect, it } from "vitest";
import { renderEmailTemplate } from "../../../src/modules/notification/providers/email-templates.js";

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
