# Dev environment values — ADR-0009 step 2. Adapted from (not copied verbatim from) the
# sibling ../event-discovery-platform/infrastructure/terraform/env/dev.tfvars pattern.
# aws_account_id intentionally left unset here — pass via -var or TF_VAR_aws_account_id
# (e.g. from `aws sts get-caller-identity` under AWS_PROFILE=claude-dev) rather than
# committing an account ID that only applies to one operator's environment.

environment       = "dev"
aws_region        = "us-east-1"
schedules_enabled = true
mfa_policy        = "OPTIONAL"

# Real finding from the first `terraform apply` against this account (2026-08-20): the
# claude-dev account's Lambda concurrent execution limit is only 10 total (new/unverified-
# account default), so reserving the CDK-parity values (summing to 17) fails outright -
# PutFunctionConcurrency requires the account to keep a minimum unreserved buffer that a
# 10-execution account can't spare. External impediment (AWS quota, not code) - revert to
# true (or remove this line) once AWS raises the account's quota. See variables.tf.
enable_reserved_concurrency = false

# M4 (2026-08-20): placeholder pending the real SES sandbox identity verification spike
# (docs/architecture/m4-notification-engine-design.md, item aberto do fechamento de rodada
# 3) - safe as a placeholder because this value is never used by any Terraform resource
# itself (SES identity verification is a manual, out-of-band step, not Terraform-managed
# here); it only becomes the EmailDelivery Lambda's SES_FROM_ADDRESS env var, so a
# `terraform plan`/`test` against this placeholder never actually attempts to send e-mail.
# Update to the real verified address before EmailDelivery is exercised against live SES.
ses_from_address = "noreply@example.com"
