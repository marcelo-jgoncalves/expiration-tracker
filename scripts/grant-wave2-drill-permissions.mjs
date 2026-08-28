/**
 * One-off setup script for the Pilot Readiness Program Wave 2 operational drills
 * (docs/engineering/pilot-readiness-program.md). Adds Bash permission rules to
 * .claude/settings.local.json (project-local, machine-specific, not committed) so
 * Claude Code's auto-mode classifier stops requiring a fresh interactive approval for
 * every AWS CLI *mutation* call against the `dev` account (profile `claude-dev`) needed
 * to run W2-03..W2-08 for real: flipping the AppConfig kill-switch config, DLQ redrive,
 * DynamoDB point-in-time restore (+ cleanup), and forcing a CloudWatch alarm state to
 * prove it actually notifies.
 *
 * Read-only AWS CLI calls (list/describe/get) are never gated by the classifier and are
 * NOT added here - only the specific mutating subcommands the drills actually need.
 *
 * Run once from the repo root: node scripts/grant-wave2-drill-permissions.mjs
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const claudeDir = path.join(repoRoot, ".claude");
const settingsPath = path.join(claudeDir, "settings.local.json");

const WAVE2_DRILL_PERMISSIONS = [
  // W2-03 - feature gate drill (AppConfig kill-switches: AI_EXTRACTION/OCR/WHATSAPP)
  "Bash(aws appconfig create-hosted-configuration-version:*)",
  "Bash(aws appconfig start-deployment:*)",
  "Bash(aws appconfig stop-deployment:*)",
  // W2-05 - DLQ/replay drill
  "Bash(aws sqs start-message-move-task:*)",
  "Bash(aws sqs send-message:*)",
  "Bash(aws sqs purge-queue:*)",
  // W2-06 - restore drill (DynamoDB PITR) + mandatory cleanup of the restored table
  "Bash(aws dynamodb restore-table-to-point-in-time:*)",
  "Bash(aws dynamodb delete-table:*)",
  // W2-08 - credential-compromise/alarm drill (force an alarm to ALARM state for real, no
  // credential exposure involved - this only exercises the SNS->e-mail notification path)
  "Bash(aws cloudwatch set-alarm-state:*)",
];

let settings = {};
if (existsSync(settingsPath)) {
  settings = JSON.parse(readFileSync(settingsPath, "utf8"));
}
settings.permissions ??= {};
settings.permissions.allow ??= [];

const before = new Set(settings.permissions.allow);
for (const rule of WAVE2_DRILL_PERMISSIONS) {
  if (!before.has(rule)) settings.permissions.allow.push(rule);
}

if (!existsSync(claudeDir)) mkdirSync(claudeDir, { recursive: true });
writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n", "utf8");

const added = WAVE2_DRILL_PERMISSIONS.filter((r) => !before.has(r));
console.log(`Wrote ${settingsPath}`);
console.log(added.length > 0 ? `Added ${added.length} new permission rule(s):\n  ${added.join("\n  ")}` : "All rules were already present - nothing changed.");
