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

# Attached only to guest_credential_delivery_handler's role.
output "stream_read_policy_json" {
  value = data.aws_iam_policy_document.guest_credential_delivery_stream_read.json
}

# D-233: attached only to guest_credential_delivery_handler's role, alongside stream_read above.
output "marker_write_policy_json" {
  value = data.aws_iam_policy_document.guest_credential_delivery_marker_write.json
}
