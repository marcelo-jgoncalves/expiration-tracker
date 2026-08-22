# --- KMS keys (one per bucket, per M6 design §4.1) -----------------------------------------

resource "aws_kms_key" "quarantine" {
  description             = "${var.name_prefix} document quarantine bucket encryption key"
  deletion_window_in_days = 30
  enable_key_rotation     = true
  tags                    = var.tags
}

resource "aws_kms_alias" "quarantine" {
  name          = "alias/${var.name_prefix}-documents-quarantine"
  target_key_id = aws_kms_key.quarantine.key_id
}

resource "aws_kms_key" "clean" {
  description             = "${var.name_prefix} document clean bucket encryption key"
  deletion_window_in_days = 30
  enable_key_rotation     = true
  tags                    = var.tags
}

resource "aws_kms_alias" "clean" {
  name          = "alias/${var.name_prefix}-documents-clean"
  target_key_id = aws_kms_key.clean.key_id
}

# --- Quarantine bucket -----------------------------------------------------------------------
# Real invokers: DocumentService signs a presigned PutObject scoped to a fresh key here;
# UploadFinalizerWorker/parser-sandbox read only the exact key/version they're told about;
# MalwareResultWorker reads + deletes on confirmed promotion. No business-facing Lambda role
# (items-handler etc.) ever receives any permission on this bucket.

resource "aws_s3_bucket" "quarantine" {
  bucket        = "${var.name_prefix}-documents-quarantine"
  force_destroy = false
  tags          = var.tags
}

resource "aws_s3_bucket_public_access_block" "quarantine" {
  bucket                  = aws_s3_bucket.quarantine.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "quarantine" {
  bucket = aws_s3_bucket.quarantine.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "quarantine" {
  bucket = aws_s3_bucket.quarantine.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.quarantine.arn
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_versioning" "quarantine" {
  bucket = aws_s3_bucket.quarantine.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "quarantine" {
  depends_on = [aws_s3_bucket_versioning.quarantine]
  bucket     = aws_s3_bucket.quarantine.id

  rule {
    id     = "expire-transient-quarantine-content"
    status = "Enabled"

    filter {} # applies to every object - the whole bucket is transient by design.

    expiration {
      days = var.quarantine_lifecycle_days
    }

    noncurrent_version_expiration {
      noncurrent_days = var.quarantine_lifecycle_days
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }
}

resource "aws_s3_bucket_policy" "quarantine" {
  bucket = aws_s3_bucket.quarantine.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "DenyInsecureTransport"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:*"
        Resource  = [aws_s3_bucket.quarantine.arn, "${aws_s3_bucket.quarantine.arn}/*"]
        Condition = { Bool = { "aws:SecureTransport" = "false" } }
      },
      {
        Sid       = "DenyWrongEncryption"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:PutObject"
        Resource  = "${aws_s3_bucket.quarantine.arn}/*"
        Condition = { StringNotEquals = { "s3:x-amz-server-side-encryption" = "aws:kms" } }
      }
    ]
  })
}

# --- Clean bucket ------------------------------------------------------------------------
# Real invokers: only MalwareResultWorker writes (the promotion copy). No M6 handler reads it
# (extraction/M7 will be the first real reader) - deliberately not wired to anything else yet.

resource "aws_s3_bucket" "clean" {
  bucket        = "${var.name_prefix}-documents-clean"
  force_destroy = false
  tags          = var.tags
}

resource "aws_s3_bucket_public_access_block" "clean" {
  bucket                  = aws_s3_bucket.clean.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "clean" {
  bucket = aws_s3_bucket.clean.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "clean" {
  bucket = aws_s3_bucket.clean.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.clean.arn
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_versioning" "clean" {
  bucket = aws_s3_bucket.clean.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_policy" "clean" {
  bucket = aws_s3_bucket.clean.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "DenyInsecureTransport"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:*"
        Resource  = [aws_s3_bucket.clean.arn, "${aws_s3_bucket.clean.arn}/*"]
        Condition = { Bool = { "aws:SecureTransport" = "false" } }
      },
      {
        Sid       = "DenyWrongEncryption"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:PutObject"
        Resource  = "${aws_s3_bucket.clean.arn}/*"
        Condition = { StringNotEquals = { "s3:x-amz-server-side-encryption" = "aws:kms" } }
      }
    ]
  })
}

# --- EventBridge notifications on the quarantine bucket (S3 "Object Created" -> EventBridge) --
# Required so document-malware-protection's rule (and the finalizer's own S3-event rule, wired
# at root) can match on this bucket's real events.

resource "aws_s3_bucket_notification" "quarantine" {
  bucket      = aws_s3_bucket.quarantine.id
  eventbridge = true
}
