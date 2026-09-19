output "table_name" {
  value = aws_dynamodb_table.this.name
}
output "table_arn" {
  value = aws_dynamodb_table.this.arn
}
output "stream_arn" {
  value = aws_dynamodb_table.this.stream_arn
}
output "read_write_policy_json" {
  value = data.aws_iam_policy_document.read_write.json
}
output "transact_write_policy_json" {
  value = data.aws_iam_policy_document.transact_write.json
}
output "stream_read_policy_json" {
  value = data.aws_iam_policy_document.stream_read.json
}
