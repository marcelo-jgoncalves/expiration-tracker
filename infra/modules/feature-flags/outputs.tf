output "application_id" {
  description = "AppConfig application ID."
  value       = aws_appconfig_application.this.id
}

output "environment_id" {
  description = "AppConfig environment ID (the \"default\" environment)."
  value       = aws_appconfig_environment.this.environment_id
}

output "configuration_profile_id" {
  description = "AppConfig configuration profile ID for the kill-switches (AI_EXTRACTION/OCR/WHATSAPP) freeform config."
  value       = aws_appconfig_configuration_profile.kill_switches.configuration_profile_id
}

output "feature_flags_read_policy_json" {
  description = "IAM policy JSON (StartConfigurationSession + GetLatestConfiguration) to attach to any Lambda that needs to consult a kill switch before an expensive/external operation."
  value       = data.aws_iam_policy_document.read.json
}
