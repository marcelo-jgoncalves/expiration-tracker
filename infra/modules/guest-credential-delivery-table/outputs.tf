output "table_name" {
  value = aws_dynamodb_table.guest_credential_delivery.name
}

output "table_arn" {
  value = aws_dynamodb_table.guest_credential_delivery.arn
}

output "stream_arn" {
  value = aws_dynamodb_table.guest_credential_delivery.stream_arn
}

# Attach only to document-request-credential-issuance-handler's role.
output "put_policy_json" {
  value = data.aws_iam_policy_document.guest_credential_delivery_put.json
}

# Not attached to any role yet - see main.tf's header comment (future delivery worker).
output "stream_read_policy_json" {
  value = data.aws_iam_policy_document.guest_credential_delivery_stream_read.json
}
