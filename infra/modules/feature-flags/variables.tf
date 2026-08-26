# Transversal AWS AppConfig kill switches (M7 design D-035 §1.5, implementation-blueprint.md
# §17.3) — NOT scoped to extraction alone, hence "feature-flags" and not "extraction-appconfig"/
# "document-appconfig" (the schema already includes WHATSAPP, a Notification-module toggle).

variable "name_prefix" {
  description = "Prefix for AppConfig application/deployment-strategy names."
  type        = string
}

variable "aws_region" {
  description = "AWS region — used only to construct deterministic ARNs for the read IAM policy (StartConfigurationSession is resource-scoped)."
  type        = string
}

variable "aws_account_id" {
  description = "AWS account ID — used only to construct deterministic ARNs for the read IAM policy, same rationale as dynamo-table's own variable."
  type        = string
}

variable "ai_extraction_enabled" {
  description = <<-EOT
    Kill switch `AI_EXTRACTION` (implementation-blueprint.md §17.3). Default false — mirrors
    `extraction_pipeline_enabled`'s own default (root variables.tf, once added): M7 is a new
    feature with real per-call cost and personal-data processing whose external
    preconditions (RIPD, Bedrock model/region choice) are not closed yet. Fail-closed on read
    failure is enforced in the Lambda code, not here — this variable only sets the value
    AppConfig serves when reachable.
  EOT
  type        = bool
  default     = false
}

variable "ocr_enabled" {
  description = <<-EOT
    Kill switch `OCR` (implementation-blueprint.md §17.3, D-035 §1.5.1). `OCR=false` blocks
    only the Textract-dependent path, never the deterministic parser. Default false, same
    rationale as `ai_extraction_enabled`.
  EOT
  type        = bool
  default     = false
}

variable "whatsapp_enabled" {
  description = "Kill switch `WHATSAPP` (implementation-blueprint.md §17.3/§19 M4 scope) — a Notification-module toggle, included here because the AppConfig schema is shared/transversal, not because this module owns WhatsApp delivery. Default false: WhatsApp remains an unimplemented submilestone (M4 shipped e-mail only)."
  type        = bool
  default     = false
}

variable "tags" {
  description = "Tags applied to the AppConfig application/environment/deployment resources."
  type        = map(string)
  default     = {}
}
