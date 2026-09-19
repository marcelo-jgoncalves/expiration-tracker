# D-303: outbox table dedicated to reminder-dispatch, isolated from the main table's shared
# DynamoDB Stream (docs/architecture/reviews/reminder-dispatch-control-plane/DECISION.md).
# Schema mirrors the shared OutboxRecord shape (src/shared/outbox/outbox.ts) exactly - PK/SK
# and GSI6PK/GSI6SK use the same names the generic DynamoDbOutboxRelayStore/relay.ts code
# already queries against (IndexName "GSI6"), so that code is reused unmodified, only pointed
# at this table instead of the main one via TABLE_NAME env var.
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
    name = "GSI6PK"
    type = "S"
  }
  attribute {
    name = "GSI6SK"
    type = "S"
  }

  global_secondary_index {
    name            = "GSI6"
    hash_key        = "GSI6PK"
    range_key       = "GSI6SK"
    projection_type = "ALL"
  }

  # Known gap, not a regression: src/shared/outbox/outbox.ts's buildOutboxRecord() does not set
  # a purgeAfterTtl attribute today (same on the main table for these records) - TTL is enabled
  # here as forward-looking hygiene, matching D-301/D-302's table pattern, but nothing writes
  # the attribute yet. Follow-up, not required for D-303's correctness.
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
    actions   = ["dynamodb:GetItem", "dynamodb:Query", "dynamodb:PutItem", "dynamodb:UpdateItem"]
    resources = [aws_dynamodb_table.this.arn, "${aws_dynamodb_table.this.arn}/index/GSI6"]
  }
}

# Separate from read_write: only reminder-claim-consumer's TransactWriteItems needs this, kept
# isolated so the relay/sweeper roles (read_write above) never get transact-write on this table
# they have no reason to need it for (same least-privilege discipline as the main table's
# per-worker IAM isolation, AGENTS.md #7).
data "aws_iam_policy_document" "transact_write" {
  statement {
    actions   = ["dynamodb:TransactWriteItems"]
    resources = [aws_dynamodb_table.this.arn]
  }
}

data "aws_iam_policy_document" "stream_read" {
  statement {
    actions   = ["dynamodb:GetRecords", "dynamodb:GetShardIterator", "dynamodb:DescribeStream", "dynamodb:ListStreams"]
    resources = [aws_dynamodb_table.this.stream_arn]
  }
}
