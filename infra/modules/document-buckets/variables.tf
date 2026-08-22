# Document upload/malware boundary buckets — M6 runtime design
# (docs/architecture/reviews/m6-document-upload-design/codex-reconciliation-round2-final-design.md).
# Two physically separate buckets (quarantine/clean). D-016 originally approved a dedicated
# CMK per bucket; superseded 2026-08-22 (Marcelo direct cost decision, dev has near-zero real
# upload volume and CMKs bill ~US$1/mo/key just for existing) - both buckets now share the
# AWS-managed "aws/s3" key (see main.tf's data.aws_kms_key.s3_managed), which has no per-key
# monthly charge. The security boundary between quarantine/clean is the 2 physical buckets +
# IAM least-privilege (each Lambda's own capability policy), never a shared table-wide grant -
# that property is unaffected by which KMS key backs the encryption.

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
