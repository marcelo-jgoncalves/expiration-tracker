import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");
const handlers = [
  "reminder-scan-enumerator-handler.ts",
  "reminder-scan-page-handler.ts",
  "reminder-scan-control-relay-handler.ts",
  "reminder-scan-control-reconciler-handler.ts",
];
const readHandler = (name: string) => readFileSync(path.join(root, "src/runtime/aws/handlers", name), "utf8");

describe("reminder scan v2 observability coverage", () => {
  it.each(handlers)("keeps %s inside structured correlation and error logging", (name) => {
    const source = readHandler(name);
    expect(source).toContain("SecureLogger");
    expect(source).toContain("runWithContext");
    expect(source).toMatch(/logger\.error\("reminder-scan-[^"]+ failed"/);
    expect(source).toContain("errorCode: appError.code");
  });

  it("emits an alarmable per-record metric because partial batch failures do not increment Lambda Errors", () => {
    const source = readHandler("reminder-scan-page-handler.ts");
    expect(source).toContain('name: "ScanPageOutcome"');
    expect(source).toContain('outcome: "HANDLER_ERROR"');
    const terraform = readFileSync(path.join(root, "infra/main.tf"), "utf8");
    expect(terraform).toContain('resource "aws_cloudwatch_metric_alarm" "reminder_scan_v2_page_handler_errors"');
    expect(terraform).toContain('namespace           = "ExpirationTracker/ReminderScanPageV2"');
  });

  it.each(["reminder-scan-control-relay-handler.ts", "reminder-scan-control-reconciler-handler.ts"])(
    "propagates correlationId across SQS in %s",
    (name) => expect(readHandler(name)).toContain("MessageAttributes: { correlationId:"),
  );
});
