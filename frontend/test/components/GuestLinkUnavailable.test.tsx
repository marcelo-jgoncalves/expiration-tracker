import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { GuestLinkUnavailable } from "../../src/components/GuestLinkUnavailable.js";

describe("GuestLinkUnavailable (SLF-05 remediation, D-2xx Block 0)", () => {
  it("renders the exact fixed title required by the anti-enumeration spec", () => {
    render(<GuestLinkUnavailable requestedItem="documento" />);
    expect(screen.getByText("Este link não está disponível")).toBeInTheDocument();
  });

  it("never renders an action button - the problem is the link itself, not something retryable", () => {
    render(<GuestLinkUnavailable requestedItem="documento" />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("varies only the requested-item wording (G01: documento)", () => {
    render(<GuestLinkUnavailable requestedItem="documento" />);
    expect(screen.getByText(/Solicite um novo link a quem pediu o documento\./)).toBeInTheDocument();
  });

  it("varies only the requested-item wording (G02: evidência)", () => {
    render(<GuestLinkUnavailable requestedItem="evidência" />);
    expect(screen.getByText(/Solicite um novo link a quem pediu a evidência\./)).toBeInTheDocument();
  });

  it("renders identical body copy up to the requested-item wording, for both callers (cross-screen coherence, V8)", () => {
    const { unmount } = render(<GuestLinkUnavailable requestedItem="documento" />);
    const documentoText = screen.getByText(/O link pode ter expirado/).textContent;
    unmount();

    render(<GuestLinkUnavailable requestedItem="evidência" />);
    const evidenciaText = screen.getByText(/O link pode ter expirado/).textContent;

    expect(documentoText?.replace("o documento", "X")).toBe(evidenciaText?.replace("a evidência", "X"));
  });

  it("marks the icon decorative (aria-hidden) so it never gets its own accessible name that could hint at a cause", () => {
    const { container } = render(<GuestLinkUnavailable requestedItem="documento" />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("aria-hidden", "true");
  });
});
