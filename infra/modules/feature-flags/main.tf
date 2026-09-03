# AWS AppConfig: real kill-switch delivery for AI/OCR/WhatsApp (D-035 §1.5, corrected module
# name — transversal, not extraction-specific, since the schema already includes WHATSAPP).
# Hosted configuration (no S3/SSM indirection) — the whole payload is three booleans, no case
# for an external config store yet.

resource "aws_appconfig_application" "this" {
  name = "${var.name_prefix}-feature-flags"
  tags = var.tags
}

resource "aws_appconfig_environment" "this" {
  application_id = aws_appconfig_application.this.id
  name           = "default"
  tags           = var.tags
}

resource "aws_appconfig_configuration_profile" "kill_switches" {
  application_id = aws_appconfig_application.this.id
  name           = "kill-switches"
  location_uri   = "hosted"
  type           = "AWS.Freeform"
  tags           = var.tags
}

# implementation-blueprint.md §17.3's exact schema. Every worker that reads this must fail
# closed (treat AI/OCR/WhatsApp as false) on any read error — enforced in application code,
# not here; this resource only controls the value served when AppConfig is reachable.
resource "aws_appconfig_hosted_configuration_version" "kill_switches" {
  application_id           = aws_appconfig_application.this.id
  configuration_profile_id = aws_appconfig_configuration_profile.kill_switches.configuration_profile_id
  content_type             = "application/json"
  content = jsonencode({
    features = {
      AI_EXTRACTION                               = var.ai_extraction_enabled
      OCR                                         = var.ocr_enabled
      WHATSAPP                                    = var.whatsapp_enabled
      EXTRACTION_DOCUMENT_ARCHIVE_TRIGGER_ENABLED = var.extraction_document_archive_trigger_enabled
      DOCUMENT_ARCHIVE_PROMOTION_ENABLED          = var.document_archive_promotion_enabled
    }
  })
}

# Instant/all-at-once — these are kill switches, not gradual feature rollouts; a deploy of a
# new flag value should take effect immediately, not over a bake window.
resource "aws_appconfig_deployment_strategy" "instant" {
  name                           = "${var.name_prefix}-feature-flags-instant"
  deployment_duration_in_minutes = 0
  growth_factor                  = 100
  replicate_to                   = "NONE"
  final_bake_time_in_minutes     = 0
}

resource "aws_appconfig_deployment" "kill_switches" {
  application_id           = aws_appconfig_application.this.id
  environment_id           = aws_appconfig_environment.this.environment_id
  configuration_profile_id = aws_appconfig_configuration_profile.kill_switches.configuration_profile_id
  configuration_version    = aws_appconfig_hosted_configuration_version.kill_switches.version_number
  deployment_strategy_id   = aws_appconfig_deployment_strategy.instant.id
  tags                     = var.tags
}

# Read-only IAM policy for any Lambda that needs to consult a kill switch before an expensive/
# external operation (implementation-blueprint.md principle 10). StartConfigurationSession is
# resource-scoped (application/environment/configuration-profile ARN triad);
# GetLatestConfiguration acts on the opaque session token returned by the former, not on an
# ARN-addressable resource, so it stays "*" per AWS's own documented action reference.
data "aws_iam_policy_document" "read" {
  statement {
    sid     = "StartFeatureFlagsConfigurationSession"
    effect  = "Allow"
    actions = ["appconfig:StartConfigurationSession"]
    resources = [
      "arn:aws:appconfig:${var.aws_region}:${var.aws_account_id}:application/${aws_appconfig_application.this.id}/environment/${aws_appconfig_environment.this.environment_id}/configuration/${aws_appconfig_configuration_profile.kill_switches.configuration_profile_id}",
    ]
  }
  statement {
    sid       = "GetLatestFeatureFlagsConfiguration"
    effect    = "Allow"
    actions   = ["appconfig:GetLatestConfiguration"]
    resources = ["*"]
  }
}
