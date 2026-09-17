output "table_name" {
  value = aws_dynamodb_table.this.name
}
output "table_arn" {
  value = aws_dynamodb_table.this.arn
}
output "read_policy_json" {
  value = data.aws_iam_policy_document.read.json
}
output "write_policy_json" {
  value = data.aws_iam_policy_document.write.json
}
