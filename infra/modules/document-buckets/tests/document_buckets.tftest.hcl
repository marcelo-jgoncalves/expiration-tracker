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

  assert {
    condition = anytrue([
      for r in aws_s3_bucket_server_side_encryption_configuration.quarantine.rule :
      anytrue([for d in r.apply_server_side_encryption_by_default : d.sse_algorithm == "aws:kms" && d.kms_master_key_id == aws_kms_key.quarantine.arn])
    ])
    error_message = "Quarantine bucket must use SSE-KMS with its own dedicated key"
  }

  assert {
    condition = anytrue([
      for r in aws_s3_bucket_server_side_encryption_configuration.clean.rule :
      anytrue([for d in r.apply_server_side_encryption_by_default : d.sse_algorithm == "aws:kms" && d.kms_master_key_id == aws_kms_key.clean.arn])
    ])
    error_message = "Clean bucket must use SSE-KMS with its own dedicated key"
  }

  assert {
    condition     = aws_kms_key.quarantine.arn != aws_kms_key.clean.arn
    error_message = "Quarantine and clean buckets must use physically separate KMS keys"
  }

  assert {
    condition     = aws_kms_key.quarantine.enable_key_rotation == true
    error_message = "Quarantine KMS key must have rotation enabled"
  }

  assert {
    condition     = aws_kms_key.clean.enable_key_rotation == true
    error_message = "Clean KMS key must have rotation enabled"
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
