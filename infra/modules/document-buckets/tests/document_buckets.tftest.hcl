mock_provider "aws" {}

run "buckets_are_private_kms_encrypted_and_versioned" {
  command = apply

  variables {
    name_prefix = "exptrk-test"
    tags        = { Project = "expiration-tracker", Environment = "test" }
  }

  assert {
    condition     = aws_s3_bucket_public_access_block.quarantine.block_public_acls == true
    error_message = "Quarantine bucket must block public ACLs"
  }

  assert {
    condition     = aws_s3_bucket_public_access_block.clean.block_public_acls == true
    error_message = "Clean bucket must block public ACLs"
  }

  assert {
    condition     = aws_s3_bucket_ownership_controls.quarantine.rule[0].object_ownership == "BucketOwnerEnforced"
    error_message = "Quarantine bucket must use BucketOwnerEnforced object ownership"
  }

  assert {
    condition     = aws_s3_bucket_ownership_controls.clean.rule[0].object_ownership == "BucketOwnerEnforced"
    error_message = "Clean bucket must use BucketOwnerEnforced object ownership"
  }

  # Cost decision 2026-08-22: both buckets use SSE-KMS with the AWS-managed "aws/s3" key
  # (data.aws_kms_key.s3_managed), not a dedicated CMK per bucket - see main.tf's comment for
  # the full rationale. Both buckets deliberately reference the SAME key ARN (there is only
  # one aws/s3 managed key per account); the security boundary between them is the 2 physical
  # buckets + IAM least-privilege, not a per-bucket key anymore.
  assert {
    condition = anytrue([
      for r in aws_s3_bucket_server_side_encryption_configuration.quarantine.rule :
      anytrue([for d in r.apply_server_side_encryption_by_default : d.sse_algorithm == "aws:kms" && d.kms_master_key_id == data.aws_kms_key.s3_managed.arn])
    ])
    error_message = "Quarantine bucket must use SSE-KMS with the AWS-managed S3 key"
  }

  assert {
    condition = anytrue([
      for r in aws_s3_bucket_server_side_encryption_configuration.clean.rule :
      anytrue([for d in r.apply_server_side_encryption_by_default : d.sse_algorithm == "aws:kms" && d.kms_master_key_id == data.aws_kms_key.s3_managed.arn])
    ])
    error_message = "Clean bucket must use SSE-KMS with the AWS-managed S3 key"
  }

  assert {
    condition     = aws_s3_bucket_versioning.quarantine.versioning_configuration[0].status == "Enabled"
    error_message = "Quarantine bucket must have versioning enabled"
  }

  assert {
    condition     = aws_s3_bucket_versioning.clean.versioning_configuration[0].status == "Enabled"
    error_message = "Clean bucket must have versioning enabled"
  }

  assert {
    condition     = aws_s3_bucket.quarantine.force_destroy == false && aws_s3_bucket.clean.force_destroy == false
    error_message = "Neither bucket may allow force_destroy"
  }

  assert {
    condition     = aws_s3_bucket_notification.quarantine.eventbridge == true
    error_message = "Quarantine bucket must forward S3 events to EventBridge (finalizer/malware-result workers depend on it)"
  }
}

run "quarantine_lifecycle_expires_transient_content" {
  command = apply

  variables {
    name_prefix               = "exptrk-test-2"
    quarantine_lifecycle_days = 1
    tags                      = { Project = "expiration-tracker", Environment = "test" }
  }

  assert {
    condition     = aws_s3_bucket_lifecycle_configuration.quarantine.rule[0].expiration[0].days == 1
    error_message = "Quarantine bucket must expire objects after quarantine_lifecycle_days"
  }

  assert {
    condition     = aws_s3_bucket_lifecycle_configuration.quarantine.rule[0].noncurrent_version_expiration[0].noncurrent_days == 1
    error_message = "Quarantine bucket must expire noncurrent versions after quarantine_lifecycle_days too"
  }
}
