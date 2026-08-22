# S3 bucket dedicated to CD deploy manifests and the rollback mechanism (rollback design
# entrega 1, docs/architecture/reviews/rollback-mechanism-design/codex-round2-final-design.md
# §3). Deliberately separate from the two tenant document buckets — this bucket never holds
# tenant data or PII, only operational deploy metadata (function names, published Lambda
# version numbers, commit SHAs, timestamps).

variable "bucket_name" {
  description = "Name of the deploy manifest bucket (e.g. exptrk-dev-deploy-manifests)."
  type        = string
}

variable "manifest_retention_days" {
  description = <<-EOT
    Lifecycle expiration for objects under deployments/ and rollbacks/ - historical records,
    not needed indefinitely. The pointers/current-healthy.json object is NOT covered by this
    rule (it is always the live pointer, never expired).
  EOT
  type        = number
  default     = 180
}

variable "tags" {
  description = "Tags applied to the bucket."
  type        = map(string)
  default     = {}
}
