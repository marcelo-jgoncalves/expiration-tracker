# Document upload/malware boundary buckets — M6 runtime design
# (docs/architecture/reviews/m6-document-upload-design/codex-reconciliation-round2-final-design.md).
# Two physically separate buckets (quarantine/clean), each with its own KMS key - already
# approved (architecture-fase3-consolidada.md §7 / D-016, Type 1). Actual key USAGE grants
# happen via each Lambda's own IAM capability policy (kms:Decrypt/GenerateDataKey on the
# specific key ARN), not via this module's key policy - the default AWS key policy (root
# account delegates to IAM) is deliberately kept, avoiding a circular dependency between this
# module and the lambda-function modules that need these bucket/key ARNs first.

variable "name_prefix" {
  description = "Prefix for bucket/key names (e.g. exptrk-dev)."
  type        = string
}

variable "quarantine_lifecycle_days" {
  description = "Lifecycle expiration for any object left in quarantine (M6 design §4.1: 24h for transient content, defense in depth alongside the reconciler)."
  type        = number
  default     = 1
}

variable "tags" {
  description = "Tags applied to resources that support tagging."
  type        = map(string)
  default     = {}
}
