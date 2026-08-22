# --- KMS: the AWS-managed S3 key (alias/aws/s3), NOT a customer-managed key -----------------
# Real cost decision (2026-08-22, Marcelo direct call - dispensa o protocolo Claude<->Codex
# por ser simplificação por custo, não reabertura de arquitetura, ver decisions-log.md):
# a D-016 original (chaves separadas por bucket) previa 2 CMKs (~US$1/mês cada, ~US$2/mês fixo
# só por existirem, mesmo com zero uploads em dev). AWS-managed keys não têm a cobrança mensal
# de CMK - ambos os buckets agora compartilham a MESMA chave gerenciada pela AWS (só existe uma
# "aws/s3" por conta, não é possível ter uma por bucket sem voltar a ser uma CMK). A separação
# de segurança entre quarantine/clean continua vindo dos 2 buckets físicos distintos + IAM
# least-privilege (cada função só recebe permissão explícita no bucket que precisa) - o
# controle principal já era esse, a chave própria por bucket era uma camada extra, não a única.
data "aws_kms_key" "s3_managed" {
  key_id = "alias/aws/s3"
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
      kms_master_key_id = data.aws_kms_key.s3_managed.arn
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
      kms_master_key_id = data.aws_kms_key.s3_managed.arn
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
