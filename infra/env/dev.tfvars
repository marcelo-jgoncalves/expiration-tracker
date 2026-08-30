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

# Wave B2B-14 (D-120, 2026-08-30): real verified SES identity, closing the M4 placeholder above -
# `create-email-identity` triggered via `aws sesv2 --profile claude-dev` for this exact address,
# verification completed by Marcelo clicking the confirmation e-mail. This was the real blocker
# for EVERY SES-dependent flow in this environment (EmailDeliveryWorker, DocumentChasingDispatch,
# now membership invitations too) - none of them could ever have sent real e-mail against the
# unverified placeholder, sandbox mode or not.
ses_from_address = "marcelo.mjgoncalves@gmail.com"

# Wave B2B-14 (D-120): kill switch for real invitation e-mail delivery - see variables.tf's
# membership_invite_email_enabled for the full rationale. Safe to enable in `dev` only after
# verifying both the sender above and the invited test recipient in SES (sandbox mode requires
# both sides verified).
membership_invite_email_enabled = true

# M5 (2026-08-21): ADOT Lambda layer for Node.js, us-east-1/x86_64, published AWS account
# 901920570463 (m5-observability-design.md §3). Verified real via
# `aws lambda get-layer-version --layer-name arn:...:layer:aws-otel-nodejs-amd64-ver-1-30-0
# --version-number <N> --profile claude-dev` (2026-08-21): versions 1-4 exist with identical
# CodeSha256/CodeSize, version 5 does not exist (AccessDeniedException on a nonexistent
# resource, distinct from the public resource-policy grant on 1-4). Pinned to the latest
# confirmed version (4), never "latest" resolved implicitly - reverify before any future
# `terraform apply` if the ADOT release train has moved on by then.
adot_layer_arn = "arn:aws:lambda:us-east-1:901920570463:layer:aws-otel-nodejs-amd64-ver-1-30-0:4"

# M5 (2026-08-21): real operator e-mail (Marcelo), confirmed for this environment. The SNS
# subscription this creates on a real `apply` stays PendingConfirmation until Marcelo clicks
# the AWS confirmation e-mail sent to this address - that manual step is the milestone's
# explicit acceptance criterion (m5-observability-design.md §4), not closed by `apply` alone.
alert_email = "tchelojg@gmail.com"

# Wave B2B-14 (Operational Evidence, 2026-08-30): the real, already-deployed CloudFront
# distribution fronting the SPA + Full BFF (ADR-0011) - "exptrk-dev SPA + Full BFF (ADR-0011)"
# comment, confirmed via `aws cloudfront list-distributions --profile claude-dev`
# (distribution E2XPYCT6NSP8R1, origins exptrk-dev-spa/4nl1x2vufc.execute-api...). This is
# exactly the "second apply, real distribution_domain_name now known" step main.tf's own
# spa_hosting comment anticipated - `app_origin` (and therefore Cognito's `callback_urls`/the
# BFF Lambda's `BFF_REDIRECT_URI`/`APP_ORIGIN`) had never been updated from the placeholder
# default since the distribution was first created, so no real OAuth login has ever completed
# against this environment (real finding, not hypothetical - Wave B2B-12's inventory already
# found zero Organization/Membership rows in dev, consistent with this).
app_origin = "https://d1mbs2t047qo9d.cloudfront.net"
