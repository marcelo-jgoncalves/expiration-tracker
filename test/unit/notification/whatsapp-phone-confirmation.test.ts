import { describe, expect, it } from "vitest";
import {
  buildWhatsAppPhoneConfirmation,
  generateWhatsAppConfirmationCode,
  isWhatsAppPhoneConfirmationExpired,
  isWhatsAppPhoneConfirmationInCooldown,
  whatsAppConfirmationCodeMatches,
  whatsAppPhoneConfirmationKey,
  WHATSAPP_PHONE_CONFIRMATION_TTL_SECONDS,
} from "../../../src/modules/notification/domain/whatsapp-phone-confirmation.js";
import { ValidationError } from "../../../src/shared/errors/app-error.js";

const NOW = "2026-09-23T00:00:00.000Z";
const PEPPER = "test-pepper";

describe("whatsAppPhoneConfirmationKey", () => {
  it("scopes by tenant/user/phone, same shape as whatsAppOptInKey", () => {
    const key = whatsAppPhoneConfirmationKey("t1", "u1", "+15551234567");
    expect(key.PK).toBe("TENANT#t1#USER#u1");
    expect(key.SK).toBe("WHATSAPP_PHONE_CONFIRMATION#+15551234567");
  });
});

describe("generateWhatsAppConfirmationCode", () => {
  it("always produces a 6-digit zero-padded string", () => {
    for (let i = 0; i < 200; i++) {
      const code = generateWhatsAppConfirmationCode();
      expect(code).toMatch(/^\d{6}$/);
    }
  });
});

describe("buildWhatsAppPhoneConfirmation", () => {
  it("builds a well-formed entity with a hashed code and a TTL-bound expiresAt", () => {
    const record = buildWhatsAppPhoneConfirmation({ tenantId: "t1", userId: "u1", phoneE164: "+15551234567", code: "123456", pepper: PEPPER, now: NOW, version: 1, challengeId: "challenge-1" });
    expect(record.entityType).toBe("WhatsAppPhoneConfirmation");
    expect(record.PK).toBe("TENANT#t1#USER#u1");
    expect(record.SK).toBe("WHATSAPP_PHONE_CONFIRMATION#+15551234567");
    expect(record.codeHash).not.toBe("123456"); // the raw code is never persisted.
    expect(record.attemptCount).toBe(0);
    expect(record.confirmedAt).toBeUndefined();
    expect(Date.parse(record.expiresAt) - Date.parse(NOW)).toBe(WHATSAPP_PHONE_CONFIRMATION_TTL_SECONDS * 1000);
    expect(record.purgeAfterTtl).toBe(Math.floor(Date.parse(record.expiresAt) / 1000));
  });

  it("throws ValidationError before constructing anything, given a malformed phone number", () => {
    expect(() => buildWhatsAppPhoneConfirmation({ tenantId: "t1", userId: "u1", phoneE164: "not-a-phone", code: "123456", pepper: PEPPER, now: NOW, version: 1, challengeId: "challenge-1" })).toThrow(
      ValidationError,
    );
  });
});

describe("whatsAppConfirmationCodeMatches", () => {
  it("matches the exact code used to build the record, and rejects any other", () => {
    const record = buildWhatsAppPhoneConfirmation({ tenantId: "t1", userId: "u1", phoneE164: "+15551234567", code: "123456", pepper: PEPPER, now: NOW, version: 1, challengeId: "challenge-1" });
    expect(whatsAppConfirmationCodeMatches(PEPPER, "123456", record.codeHash)).toBe(true);
    expect(whatsAppConfirmationCodeMatches(PEPPER, "654321", record.codeHash)).toBe(false);
    expect(whatsAppConfirmationCodeMatches("wrong-pepper", "123456", record.codeHash)).toBe(false);
  });
});

describe("isWhatsAppPhoneConfirmationExpired", () => {
  it("is false right at creation and true once the TTL has elapsed", () => {
    const record = buildWhatsAppPhoneConfirmation({ tenantId: "t1", userId: "u1", phoneE164: "+15551234567", code: "123456", pepper: PEPPER, now: NOW, version: 1, challengeId: "challenge-1" });
    expect(isWhatsAppPhoneConfirmationExpired(record, NOW)).toBe(false);
    const afterExpiry = new Date(Date.parse(record.expiresAt) + 1000).toISOString();
    expect(isWhatsAppPhoneConfirmationExpired(record, afterExpiry)).toBe(true);
  });
});

describe("isWhatsAppPhoneConfirmationInCooldown", () => {
  it("is true immediately after creation and false once the cooldown has passed", () => {
    const record = buildWhatsAppPhoneConfirmation({ tenantId: "t1", userId: "u1", phoneE164: "+15551234567", code: "123456", pepper: PEPPER, now: NOW, version: 1, challengeId: "challenge-1" });
    expect(isWhatsAppPhoneConfirmationInCooldown(record, NOW)).toBe(true);
    const afterCooldown = new Date(Date.parse(NOW) + 61_000).toISOString();
    expect(isWhatsAppPhoneConfirmationInCooldown(record, afterCooldown)).toBe(false);
  });
});
