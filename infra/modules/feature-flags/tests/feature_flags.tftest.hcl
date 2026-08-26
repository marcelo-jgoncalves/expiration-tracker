# Recreates D-035 §1.5/§1.6 and implementation-blueprint.md §17.3's acceptance criteria as
# native `terraform test` assertions. mock_provider — no real AWS credentials/resources
# needed. Uses `apply` (not `plan`) because the read policy's ARNs reference
# aws_appconfig_application.this.id/aws_appconfig_environment.this.environment_id/
# aws_appconfig_configuration_profile.kill_switches.configuration_profile_id, which are
# unknown until the (mocked) resources are created.
#
# data.aws_iam_policy_document.read's content is NOT asserted here — unlike dynamo-table's
# gsi3/gsi6 policies (built from plan-time-known variables), this module's read policy ARN is
# built from three resource IDs only known after the (mocked) AppConfig resources are
# created, and under mock_provider the rendered .json is replaced by an opaque mock string
# (same limitation documented in dynamo_table_policy.tftest.hcl's own header) — a real
# `terraform plan`/`apply` against dev is the actual verification for that ARN, same posture
# as spa-hosting's module-targeted plan check.

mock_provider "aws" {
  mock_resource "aws_appconfig_application" {
    defaults = { id = "app1234" }
  }
  mock_resource "aws_appconfig_environment" {
    defaults = { environment_id = "env1234" }
  }
  mock_resource "aws_appconfig_configuration_profile" {
    defaults = { configuration_profile_id = "prof123" }
  }
  mock_resource "aws_appconfig_deployment_strategy" {
    defaults = { id = "strat12" }
  }
}

run "defaults_are_all_fail_closed_false" {
  command = apply

  variables {
    name_prefix    = "exptrk-test"
    aws_region     = "us-east-1"
    aws_account_id = "123456789012"
  }

  assert {
    condition     = jsondecode(aws_appconfig_hosted_configuration_version.kill_switches.content).features.AI_EXTRACTION == false
    error_message = "AI_EXTRACTION must default to false — M7 external preconditions (RIPD, Bedrock model/region) are not closed yet"
  }

  assert {
    condition     = jsondecode(aws_appconfig_hosted_configuration_version.kill_switches.content).features.OCR == false
    error_message = "OCR must default to false, same rationale as AI_EXTRACTION"
  }

  assert {
    condition     = jsondecode(aws_appconfig_hosted_configuration_version.kill_switches.content).features.WHATSAPP == false
    error_message = "WHATSAPP must default to false — WhatsApp delivery is not implemented (M4 shipped e-mail only)"
  }

  assert {
    condition     = aws_appconfig_configuration_profile.kill_switches.type == "AWS.Freeform"
    error_message = "Configuration profile must be AWS.Freeform (no predefined schema type fits three arbitrary booleans)"
  }

  assert {
    condition     = aws_appconfig_deployment_strategy.instant.deployment_duration_in_minutes == 0
    error_message = "Kill switches must deploy instantly, not over a gradual bake window"
  }
}

run "overriding_a_flag_is_reflected_in_the_hosted_configuration" {
  command = apply

  variables {
    name_prefix           = "exptrk-test"
    aws_region            = "us-east-1"
    aws_account_id        = "123456789012"
    ai_extraction_enabled = true
    ocr_enabled           = true
  }

  assert {
    condition     = jsondecode(aws_appconfig_hosted_configuration_version.kill_switches.content).features.AI_EXTRACTION == true
    error_message = "AI_EXTRACTION override must be reflected in the hosted configuration content"
  }

  assert {
    condition     = jsondecode(aws_appconfig_hosted_configuration_version.kill_switches.content).features.WHATSAPP == false
    error_message = "WHATSAPP must stay false when not explicitly overridden"
  }
}

