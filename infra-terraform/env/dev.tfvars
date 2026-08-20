# Dev environment values — ADR-0009 step 2. Adapted from (not copied verbatim from) the
# sibling ../event-discovery-platform/infrastructure/terraform/env/dev.tfvars pattern.
# aws_account_id intentionally left unset here — pass via -var or TF_VAR_aws_account_id
# (e.g. from `aws sts get-caller-identity` under AWS_PROFILE=claude-dev) rather than
# committing an account ID that only applies to one operator's environment.

environment       = "dev"
aws_region        = "us-east-1"
schedules_enabled = true
mfa_policy        = "OPTIONAL"
