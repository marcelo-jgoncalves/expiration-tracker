output "table_name" {
  value = aws_dynamodb_table.session.name
}

output "table_arn" {
  value = aws_dynamodb_table.session.arn
}

output "kms_key_id" {
  value = aws_kms_key.session_refresh_token.key_id
}

output "kms_key_arn" {
  value = aws_kms_key.session_refresh_token.arn
}

# Attach only to the BFF Lambda's role - never to any resource-facing handler role.
output "bff_session_access_policy_json" {
  value = data.aws_iam_policy_document.bff_session_access.json
}
