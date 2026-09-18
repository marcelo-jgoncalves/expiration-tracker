resource "aws_dynamodb_table" "this" {
  name             = var.table_name
  billing_mode     = "PAY_PER_REQUEST"
  hash_key         = "PK"
  range_key        = "SK"
  stream_enabled   = true
  stream_view_type = "NEW_AND_OLD_IMAGES"

  attribute {
    name = "PK"
    type = "S"
  }
  attribute {
    name = "SK"
    type = "S"
  }
  attribute {
    name = "GSI1PK"
    type = "S"
  }
  attribute {
    name = "GSI1SK"
    type = "S"
  }

  global_secondary_index {
    name            = "GSI1"
    hash_key        = "GSI1PK"
    range_key       = "GSI1SK"
    projection_type = "ALL"
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

data "aws_iam_policy_document" "read_write" {
  statement {
    actions   = ["dynamodb:GetItem", "dynamodb:BatchGetItem", "dynamodb:Query", "dynamodb:PutItem", "dynamodb:DeleteItem", "dynamodb:UpdateItem", "dynamodb:TransactWriteItems"]
    resources = [aws_dynamodb_table.this.arn, "${aws_dynamodb_table.this.arn}/index/GSI1"]
  }
}

data "aws_iam_policy_document" "stream_read" {
  statement {
    actions   = ["dynamodb:GetRecords", "dynamodb:GetShardIterator", "dynamodb:DescribeStream", "dynamodb:ListStreams"]
    resources = [aws_dynamodb_table.this.stream_arn]
  }
}
