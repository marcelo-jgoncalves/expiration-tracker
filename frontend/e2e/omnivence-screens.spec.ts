import { test, expect, type Page } from "@playwright/test";

const org = { organizationId: "org-1", displayName: "Organização de validação", role: "OWNER", version: 3, defaultReminderLocalTime: "09:00" };
const member = { userId: "user-1", displayName: "Ana Silva", email: "ana@example.com", role: "OWNER", status: "ACTIVE", joinedAt: "2026-01-01T00:00:00Z", version: 1 };
const item = { itemId: "item-1", tenantId: "t1", name: "Licença ambiental — Unidade Norte", category: "Licenças", dueDate: "2026-09-20T00:00:00Z", status: "ACTIVE", tags: [], version: 1, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" };

async function fixture(page: Page, authenticated = true) {
  await page.route("**/bff/**", route => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    let json: unknown;
    if (path === "/bff/session") json = { authenticated, activeOrganizationId: authenticated ? "org-1" : undefined, displayName: member.displayName, email: member.email };
    else if (path === "/bff/organizations") json = { organizations: [org] };
    else if (path === "/bff/api/organizations/members") json = { members: [member, { ...member, userId: "user-2", email: "bruno@example.com", displayName: "Bruno Almeida", role: "MEMBER" }] };
    else if (path === "/bff/api/organizations/invitations") json = { invitations: [{ invitationId: "invite-1", emailNormalized: "carla@example.com", role: "VIEWER", status: "PENDING", expiresAt: "2026-10-01T00:00:00Z" }] };
    else if (path === "/bff/api/items/search") json = { items: [{ kind: "EXPIRATION_ITEM", item }], cursor: null, scanLimitReached: false };
    else if (path === "/bff/api/dashboard/summary") json = { summary: { activeItemsCount: 1, itemsOverdueCount: 1, itemsExpiringSoonCount: 0, approximate: false } };
    else if (path === "/bff/api/subjects/dashboard") json = { subjects: url.searchParams.get("status") === "ARCHIVED" ? [] : [{ subjectId: "subject-1", tenantId: "t1", displayName: "Fornecedor Alfa Ltda", type: "VENDOR", externalId: "12.345.678/0001-90", tags: ["Documentação", "Manutenção"], status: "ACTIVE", version: 1 }] };
    else if (path === "/bff/api/notifications/preferences") json = { preferences: { emailEnabled: true, locale: "pt-BR", quietHours: null, consentSource: "MIGRATED_DEFAULT", version: 1, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" } };
    else if (path === "/bff/api/document-archive/storage-usage") json = { usage: { limitBytes: 8589934592, usedBytes: 104857600, reservedBytes: 0, availableBytes: 8485076992, warningLevel: "OK", usedPercent: .012 } };
    else if (path === "/bff/api/activity") json = { entries: [{ auditEventId: "event-1", partition: "expiration", occurredAt: "2026-09-25T12:00:00Z", actor: { type: "USER", userId: member.userId }, action: "CREATE", resourceType: "ExpirationItem", resourceId: item.itemId, changes: {} }], cursor: null, hasMore: false };
    else return route.fulfill({ status: 404, json: { code: "NOT_FOUND", category: "NOT_FOUND", message: "Fixture not configured", retryable: false } });
    return route.fulfill({ json });
  });
}

const screens = [
  ["login", "/login", "Acesse sua conta"],
  ["overview", "/overview", "Visão geral"],
  ["items", "/items", "Vencimentos"],
  ["create", "/items/new", "Novo vencimento"],
  ["subjects", "/subjects", "Fornecedores"],
  ["notifications", "/settings/notifications", "Notificações"],
  ["settings", "/settings", "Configurações"],
  ["members", "/members", "Membros"],
  ["activity", "/activity", "Atividade"],
] as const;

for (const width of [1440, 768, 320]) {
  for (const [name, path, heading] of screens) {
    // Mutation: a fixed-width container or a runtime exception would overflow or prevent rendering.
    test(`OmniVence ${name} at ${width}px`, async ({ page }, info) => {
      const errors: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.setViewportSize({ width, height: 1000 });
      await fixture(page, name !== "login");
      await page.goto(path);
      await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
      await expect(page.getByText(/Carregando/)).toHaveCount(0);
      await page.evaluate(() => document.fonts.ready);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
      expect(errors).toEqual([]);
      if (name === "activity" && width === 1440) {
        const tops = await page.locator(".activity-filter input, .activity-filter select").evaluateAll(elements => elements.map(element => element.getBoundingClientRect().top));
        expect(Math.max(...tops) - Math.min(...tops)).toBeLessThanOrEqual(1);
      }
      await page.screenshot({ path: info.outputPath(`${name}-${width}.png`), fullPage: true, animations: "disabled" });
    });
  }
}

// Mutation: leaving main interactive or failing to restore focus would break the mobile menu journey.
test("mobile menu traps focus and restores it on Escape", async ({ page }) => {
  await fixture(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/members");
  const opener = page.getByRole("button", { name: /Abrir menu/ });
  await opener.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(page.locator("main")).toHaveAttribute("inert", "");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
});
