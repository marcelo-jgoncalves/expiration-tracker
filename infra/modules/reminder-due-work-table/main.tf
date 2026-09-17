resource "aws_dynamodb_table" "this" {
  name         = var.table_name
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "PK"
  range_key    = "SK"

  attribute {
    name = "PK"
    type = "S"
  }
  attribute {
    name = "SK"
    type = "S"
  }

  ttl {
    attribute_name = "purgeAfterTtl"
    enabled        = true
  }
  point_in_time_recovery {
    enabled = true
  }
  server_side_encryption {
    enabled = true
  }
  tags = var.tags
}

data "aws_iam_policy_document" "read" {
  statement {
    actions   = ["dynamodb:GetItem", "dynamodb:BatchGetItem", "dynamodb:Query"]
    resources = [aws_dynamodb_table.this.arn]
  }
}

data "aws_iam_policy_document" "write" {
  statement {
    actions   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:DeleteItem", "dynamodb:UpdateItem", "dynamodb:TransactWriteItems"]
    resources = [aws_dynamodb_table.this.arn]
  }
}
