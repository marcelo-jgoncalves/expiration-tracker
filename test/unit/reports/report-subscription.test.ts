import { describe, expect, it } from "vitest";
import {
  MAX_REPORT_SUBSCRIPTION_RECIPIENTS,
  reportSubscriptionGsi8Keys,
  reportSubscriptionKey,
  validateReportSubscriptionInput,
} from "../../../src/modules/reports/domain/report-subscription.js";
import { reportSubscriptionRunKey } from "../../../src/modules/reports/domain/report-subscription-run.js";
import { reportDeliveryAttemptKey } from "../../../src/modules/reports/domain/report-delivery-attempt.js";

describe("report-subscription domain (D-204)", () => {
  it("builds the ReportSubscription key from tenantId+subscriptionId", () => {
    expect(reportSubscriptionKey("t1", "sub1")).toEqual({ PK: "TENANT#t1#REPORTSUB#sub1", SK: "META" });
  });

  it("builds the GSI8 discovery pointer under the REPORT_SUBSCRIPTION worker namespace, due date first in the sort key", () => {
    const keys = reportSubscriptionGsi8Keys({ dueAtIso: "2026-09-12T04:00:00.000Z", tenantId: "t1", subscriptionId: "sub1" });
    expect(keys.GSI8PK).toBe("WORK#REPORT_SUBSCRIPTION");
    expect(keys.GSI8SK).toBe("2026-09-12T04:00:00.000Z#TENANT#t1#sub1");
  });

  it("builds the ReportSubscriptionRun key nested under the subscription's own PK", () => {
    expect(reportSubscriptionRunKey("t1", "sub1", "run1")).toEqual({ PK: "TENANT#t1#REPORTSUB#sub1", SK: "RUN#run1" });
  });

  it("builds the ReportDeliveryAttempt key nested under a run-specific PK, one per recipient", () => {
    expect(reportDeliveryAttemptKey("t1", "sub1", "run1", "user-a")).toEqual({ PK: "TENANT#t1#REPORTSUB#sub1#RUN#run1", SK: "ATTEMPT#user-a" });
  });

  describe("validateReportSubscriptionInput", () => {
    it("accepts a valid input", () => {
      expect(validateReportSubscriptionInput({ reportTypes: ["EXPIRED_ITEMS"], recipientUserIds: ["user-a"] })).toBeUndefined();
    });

    it("rejects an empty reportTypes array", () => {
      expect(validateReportSubscriptionInput({ reportTypes: [], recipientUserIds: ["user-a"] })).toBeDefined();
    });

    it("rejects an unknown reportType (not one of the 7 ReportsService already exposes)", () => {
      expect(validateReportSubscriptionInput({ reportTypes: ["NOT_A_REAL_REPORT"], recipientUserIds: ["user-a"] })).toBeDefined();
    });

    it("rejects an empty recipientUserIds array", () => {
      expect(validateReportSubscriptionInput({ reportTypes: ["EXPIRED_ITEMS"], recipientUserIds: [] })).toBeDefined();
    });

    it(`rejects recipientUserIds exceeding the cap of ${MAX_REPORT_SUBSCRIPTION_RECIPIENTS}`, () => {
      const tooMany = Array.from({ length: MAX_REPORT_SUBSCRIPTION_RECIPIENTS + 1 }, (_, i) => `user-${i}`);
      expect(validateReportSubscriptionInput({ reportTypes: ["EXPIRED_ITEMS"], recipientUserIds: tooMany })).toBeDefined();
    });

    it(`accepts recipientUserIds exactly at the cap of ${MAX_REPORT_SUBSCRIPTION_RECIPIENTS}`, () => {
      const atCap = Array.from({ length: MAX_REPORT_SUBSCRIPTION_RECIPIENTS }, (_, i) => `user-${i}`);
      expect(validateReportSubscriptionInput({ reportTypes: ["EXPIRED_ITEMS"], recipientUserIds: atCap })).toBeUndefined();
    });

    it("accepts all 7 real report types together", () => {
      const allTypes = ["EXPIRED_ITEMS", "EXPIRING_SOON_ITEMS", "RENEWED_ITEMS", "EXPIRATION_ITEMS_BY_ASSIGNEE", "MISSING_REQUIREMENTS", "REQUIREMENTS_BY_SUBJECT", "REQUIREMENTS_BY_ASSIGNEE"];
      expect(validateReportSubscriptionInput({ reportTypes: allTypes, recipientUserIds: ["user-a"] })).toBeUndefined();
    });
  });
});
