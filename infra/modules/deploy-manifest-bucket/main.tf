# Deploy manifest bucket — rollback design entrega 1. Stores:
#   deployments/<deploymentId>.json      - one immutable record per CD run
#   pointers/current-healthy.json        - the most recent deployment that passed post-deploy
#                                           checks; only advanced after apply + alias
#                                           verification + shallow post-check all succeed
#   rollbacks/<rollbackId>.json           - one record per rollback.yml execution
#
# Never stores tenant data or PII - deliberately a separate bucket from the two document
# buckets (m4/expiration modules), per the explicit adjustment agreed in round 2 of the
# Claude<->Codex design review (mixing operational deploy metadata with tenant data in the
# same bucket would blur a classification boundary that the privacy/governance axis already
# treats as significant).

resource "aws_s3_bucket" "this" {
  bucket        = var.bucket_name
  force_destroy = false
  tags          = var.tags
}

resource "aws_s3_bucket_public_access_block" "this" {
  bucket = aws_s3_bucket.this.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "this" {
  bucket = aws_s3_bucket.this.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "this" {
  bucket = aws_s3_bucket.this.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_versioning" "this" {
  bucket = aws_s3_bucket.this.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "this" {
  # Requires versioning to be configured on the bucket first (aws provider ordering).
  depends_on = [aws_s3_bucket_versioning.this]
  bucket     = aws_s3_bucket.this.id

  rule {
    id     = "expire-historical-deployment-records"
    status = "Enabled"

    filter {
      prefix = "deployments/"
    }

    expiration {
      days = var.manifest_retention_days
    }

    noncurrent_version_expiration {
      noncurrent_days = var.manifest_retention_days
    }
  }

  rule {
    id     = "expire-historical-rollback-records"
    status = "Enabled"

    filter {
      prefix = "rollbacks/"
    }

    expiration {
      days = var.manifest_retention_days
    }

    noncurrent_version_expiration {
      noncurrent_days = var.manifest_retention_days
    }
  }

  # pointers/ (current-healthy.json) is deliberately NOT covered by any expiration rule - it
  # is always the live pointer the rollback workflow reads, never a historical record.
}
