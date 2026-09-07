# Dedicated guest-credential-delivery table — D-226 (`guest-credential-issuance-scoping/
# estado-final-consolidado.md`, decision central item 5), closes D-222 Achado 1. Deliberately
# NOT the main single-table aggregate (infra/modules/dynamo-table): that table's
# tenant_facing_read_write policy is already attached to ~20+ resource Lambda roles — this table
# holds the guest's RAW bearer token material (never just a hash, unlike everything else in the
# main table), so it must be reachable ONLY by the two roles the design names explicitly:
# PutItem by document-request-credential-issuance-handler (the guest Lambda, has the D-146
# pepper), and GetItem/Streams-read by a future delivery worker (not built yet — see
# NEXT_SESSION_PROMPT.md). Same isolation posture `bff-session-table` already establishes for a
# different sensitive-value reason (browser session pointer).
#
# No GSI - every access pattern is a point lookup by documentRequestId+issuanceGeneration
# (src/modules/document-archive/domain/guest-credential-delivery.ts's guestCredentialDeliveryKey),
# same "no index needed" reasoning as bff-session-table.
#
# Streams (NEW_IMAGE) enabled per the design ("DynamoDB Streams + Event Source Mapping aciona o
# worker de entrega — nunca Query/Scan/GSI") so the table is ready for that future worker without
# a destructive table replacement later (enabling Streams on an existing table is non-destructive,
# but wiring an Event Source Mapping today with no real consumer would be dead infrastructure) -
# no aws_lambda_event_source_mapping exists yet for this stream. The stream-read IAM policy below
# is declared but unattached to any role until that worker exists — same "attach when consumed"
# discipline infra/modules/dynamo-table/main.tf's header comment establishes for gsi3_read/
# gsi4_read/gsi6_read.

resource "aws_dynamodb_table" "guest_credential_delivery" {
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

  point_in_time_recovery {
    enabled = true
  }

  server_side_encryption {
    enabled = true
  }

  ttl {
    attribute_name = "purgeAfterTtl"
    enabled        = true
  }

  stream_enabled   = true
  stream_view_type = "NEW_IMAGE"

  tags = var.tags
}

# --- IAM -------------------------------------------------------------------------------------
# Never attached to any resource-facing Lambda role (document-archive-handler, etc.) - only the
# guest Lambda's issuance-consumer role may ever PutItem; only a future delivery worker's role
# may ever read (point or stream).

data "aws_iam_policy_document" "guest_credential_delivery_put" {
  statement {
    sid       = "GuestCredentialDeliveryPutOnly"
    effect    = "Allow"
    actions   = ["dynamodb:PutItem"]
    resources = [aws_dynamodb_table.guest_credential_delivery.arn]
  }
}

data "aws_iam_policy_document" "guest_credential_delivery_stream_read" {
  statement {
    sid    = "GuestCredentialDeliveryStreamRead"
    effect = "Allow"
    actions = [
      "dynamodb:GetItem",
      "dynamodb:GetRecords",
      "dynamodb:GetShardIterator",
      "dynamodb:DescribeStream",
      "dynamodb:ListStreams",
    ]
    resources = [aws_dynamodb_table.guest_credential_delivery.arn, aws_dynamodb_table.guest_credential_delivery.stream_arn]
  }
}
