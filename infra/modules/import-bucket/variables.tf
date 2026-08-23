# Import raw CSV + validated plan JSONL bucket - M11 runtime design (D-042). A single bucket
# (not a quarantine/clean pair like document-buckets) because the design explicitly scoped CSV
# import OUT of malware scanning for v1 (DynamoDB never interprets a formula/script inside a
# CSV cell - the injection surface belongs to a future export boundary, not import). The
# `tenant/*/imports/*/raw.csv` and `tenant/*/imports/*/plan/*.jsonl` prefixes never collide, so
# one bucket safely serves both the parse worker's input and its output.

variable "name_prefix" {
  description = "Prefix for bucket/key names (e.g. exptrk-dev)."
  type        = string
}

variable "lifecycle_days" {
  description = "Lifecycle expiration for import objects - a buffer beyond ImportJob's own 7-day logical TTL (IMPORT_JOB_TTL_SECONDS), so a job never outlives the raw/plan objects it depends on."
  type        = number
  default     = 14
}

variable "tags" {
  description = "Tags applied to resources that support tagging."
  type        = map(string)
  default     = {}
}
