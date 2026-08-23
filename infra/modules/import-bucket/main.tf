# --- KMS: same AWS-managed S3 key as document-buckets (2026-08-22 cost decision, no per-key
# monthly charge, security boundary is the bucket + IAM least-privilege, not the key). ---------
data "aws_kms_key" "s3_managed" {
  key_id = "alias/aws/s3"
}

resource "aws_s3_bucket" "import" {
  bucket        = "${var.name_prefix}-imports"
  force_destroy = false
  tags          = var.tags
}

resource "aws_s3_bucket_public_access_block" "import" {
  bucket                  = aws_s3_bucket.import.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "import" {
  bucket = aws_s3_bucket.import.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "import" {
  bucket = aws_s3_bucket.import.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = data.aws_kms_key.s3_managed.arn
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_versioning" "import" {
  bucket = aws_s3_bucket.import.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "import" {
  depends_on = [aws_s3_bucket_versioning.import]
  bucket     = aws_s3_bucket.import.id

  rule {
    id     = "expire-import-artifacts"
    status = "Enabled"

    filter {} # whole bucket is transient (raw CSV + plan JSONL, never a long-term store).

    expiration {
      days = var.lifecycle_days
    }

    noncurrent_version_expiration {
      noncurrent_days = var.lifecycle_days
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }
}

resource "aws_s3_bucket_policy" "import" {
  bucket = aws_s3_bucket.import.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "DenyInsecureTransport"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:*"
        Resource  = [aws_s3_bucket.import.arn, "${aws_s3_bucket.import.arn}/*"]
        Condition = { Bool = { "aws:SecureTransport" = "false" } }
      },
      {
        Sid       = "DenyWrongEncryption"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:PutObject"
        Resource  = "${aws_s3_bucket.import.arn}/*"
        Condition = { StringNotEquals = { "s3:x-amz-server-side-encryption" = "aws:kms" } }
      }
    ]
  })
}

# EventBridge notifications (S3 "Object Created") - required for the parse-trigger rule at
# root to match real events on this bucket (same pattern as document-buckets' quarantine).
resource "aws_s3_bucket_notification" "import" {
  bucket      = aws_s3_bucket.import.id
  eventbridge = true
}
