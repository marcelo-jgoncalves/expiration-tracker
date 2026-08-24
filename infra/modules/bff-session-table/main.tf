# Dedicated BFF session table (D-054 amendment to D-053's Full BFF design) — deliberately
# NOT the main single-table aggregate (infra/modules/dynamo-table): that table's
# tenant_facing_read_write policy already grants GetItem/Query to ~20+ resource Lambda roles,
# exactly the over-broad exposure D-054 flagged for something as sensitive as a browser
# session pointer (which indirectly controls access to a cached Cognito access token). Only
# the BFF Lambda's role may ever read/write this table.
#
# Single item shape, no GSIs: both Session and LoginAttempt records live here as
# PK=SESSION#<selectorHash>/SK=POINTER and PK=LOGINATTEMPT#<selectorHash>/SK=POINTER
# respectively (src/modules/bff/domain/session.ts) — every access pattern is a point lookup
# by selectorHash, never a query, so no secondary index is needed (logoutAll's cross-session
# enforcement is via the EXISTING User.globalLogoutAfter watermark on the main table, already
# checked by resolveRequestContext for every Bearer-authenticated request - see
# src/modules/identity/application/resolve-request-context.ts).

resource "aws_dynamodb_table" "session" {
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
    enabled = true # AWS-managed key - the dedicated CMK below protects the refresh token
    # VALUE at the application layer (D-054's actual requirement), not the
    # table as a whole; a second layer of table-wide CMK encryption would be
    # redundant defense with real operational cost (key rotation, IAM for the
    # table's own encryption context) for no additional guarantee D-054 asked for.
  }

  ttl {
    attribute_name = "purgeAfterTtl"
    enabled        = true
  }

  tags = var.tags
}

# Dedicated CMK for refresh-token encryption at rest (D-054: "cripto obrigatória via CMK
# dedicada nova", explicitly not the AWS-managed key document-buckets already uses for S3 —
# that decision was made for a much less sensitive value, a document blob's storage
# encryption, not a live credential that can mint new API access on its own).
resource "aws_kms_key" "session_refresh_token" {
  description             = "CMK for BFF session refresh-token encryption at rest (D-054)"
  deletion_window_in_days = 30
  enable_key_rotation     = true
  tags                    = var.tags
}

resource "aws_kms_alias" "session_refresh_token" {
  name          = "alias/${var.table_name}-refresh-token"
  target_key_id = aws_kms_key.session_refresh_token.key_id
}

# --- IAM: scoped exclusively to this table + this CMK ------------------------------------
# Never attached to any resource-facing Lambda role (items-handler etc.) - only the BFF
# Lambda's own role may ever receive this policy.

data "aws_iam_policy_document" "bff_session_access" {
  statement {
    sid    = "BffSessionTableReadWrite"
    effect = "Allow"
    actions = [
      "dynamodb:GetItem",
      "dynamodb:PutItem",
    ]
    resources = [
      "arn:aws:dynamodb:${var.aws_region}:${var.aws_account_id}:table/${var.table_name}",
    ]
  }
  statement {
    sid    = "BffSessionRefreshTokenCrypto"
    effect = "Allow"
    actions = [
      "kms:Encrypt",
      "kms:Decrypt",
      "kms:GenerateDataKey",
    ]
    resources = [aws_kms_key.session_refresh_token.arn]
  }
}
