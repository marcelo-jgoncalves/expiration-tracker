mock_provider "aws" {}

run "bucket_is_private_kms_encrypted_and_versioned" {
  command = apply

  variables {
    name_prefix = "exptrk-test"
    tags        = { Project = "expiration-tracker", Environment = "test" }
  }

  assert {
    condition     = aws_s3_bucket_public_access_block.import.block_public_acls == true
    error_message = "Import bucket must block public ACLs"
  }

  assert {
    condition     = aws_s3_bucket_ownership_controls.import.rule[0].object_ownership == "BucketOwnerEnforced"
    error_message = "Import bucket must use BucketOwnerEnforced object ownership"
  }

  assert {
    condition = anytrue([
      for r in aws_s3_bucket_server_side_encryption_configuration.import.rule :
      anytrue([for d in r.apply_server_side_encryption_by_default : d.sse_algorithm == "aws:kms" && d.kms_master_key_id == data.aws_kms_key.s3_managed.arn])
    ])
    error_message = "Import bucket must use SSE-KMS with the AWS-managed S3 key"
  }

  assert {
    condition     = aws_s3_bucket_versioning.import.versioning_configuration[0].status == "Enabled"
    error_message = "Import bucket must have versioning enabled"
  }

  assert {
    condition     = aws_s3_bucket.import.force_destroy == false
    error_message = "Import bucket may not allow force_destroy"
  }

  assert {
    condition     = aws_s3_bucket_notification.import.eventbridge == true
    error_message = "Import bucket must forward S3 events to EventBridge (parse worker depends on it)"
  }
}

run "lifecycle_expires_import_artifacts_beyond_the_job_ttl" {
  command = apply

  variables {
    name_prefix    = "exptrk-test-2"
    lifecycle_days = 14
    tags           = { Project = "expiration-tracker", Environment = "test" }
  }

  assert {
    condition     = aws_s3_bucket_lifecycle_configuration.import.rule[0].expiration[0].days == 14
    error_message = "Import bucket must expire objects after lifecycle_days"
  }

  assert {
    condition     = aws_s3_bucket_lifecycle_configuration.import.rule[0].noncurrent_version_expiration[0].noncurrent_days == 14
    error_message = "Import bucket must expire noncurrent versions after lifecycle_days too"
  }
}
