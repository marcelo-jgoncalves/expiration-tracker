mock_provider "aws" {}

run "bucket_is_private_encrypted_and_versioned" {
  command = apply

  variables {
    bucket_name = "exptrk-test-deploy-manifests"
    tags        = { Project = "expiration-tracker", Environment = "test" }
  }

  assert {
    condition     = aws_s3_bucket_public_access_block.this.block_public_acls == true
    error_message = "Bucket must block public ACLs"
  }

  assert {
    condition     = aws_s3_bucket_public_access_block.this.block_public_policy == true
    error_message = "Bucket must block public bucket policies"
  }

  assert {
    condition     = aws_s3_bucket_public_access_block.this.restrict_public_buckets == true
    error_message = "Bucket must restrict public bucket access"
  }

  assert {
    condition     = aws_s3_bucket_ownership_controls.this.rule[0].object_ownership == "BucketOwnerEnforced"
    error_message = "Bucket must use BucketOwnerEnforced object ownership (no ACLs)"
  }

  assert {
    condition = anytrue([
      for r in aws_s3_bucket_server_side_encryption_configuration.this.rule :
      anytrue([for d in r.apply_server_side_encryption_by_default : d.sse_algorithm == "AES256"])
    ])
    error_message = "Bucket must use SSE-S3 server-side encryption by default"
  }

  assert {
    condition     = aws_s3_bucket_versioning.this.versioning_configuration[0].status == "Enabled"
    error_message = "Bucket must have versioning enabled"
  }

  assert {
    condition     = aws_s3_bucket.this.force_destroy == false
    error_message = "Bucket must never allow force_destroy (deploy history is operational evidence)"
  }
}

run "lifecycle_expires_historical_records_but_not_the_pointer_prefix" {
  command = apply

  variables {
    bucket_name             = "exptrk-test-deploy-manifests-2"
    manifest_retention_days = 90
    tags                    = { Project = "expiration-tracker", Environment = "test" }
  }

  assert {
    condition     = length(aws_s3_bucket_lifecycle_configuration.this.rule) == 2
    error_message = "Expected exactly 2 lifecycle rules (deployments/ and rollbacks/), pointers/ must have none"
  }

  assert {
    condition = anytrue([
      for r in aws_s3_bucket_lifecycle_configuration.this.rule : r.filter[0].prefix == "deployments/" && r.expiration[0].days == 90
    ])
    error_message = "deployments/ prefix must expire after manifest_retention_days"
  }

  assert {
    condition = anytrue([
      for r in aws_s3_bucket_lifecycle_configuration.this.rule : r.filter[0].prefix == "rollbacks/" && r.expiration[0].days == 90
    ])
    error_message = "rollbacks/ prefix must expire after manifest_retention_days"
  }

  assert {
    condition     = !anytrue([for r in aws_s3_bucket_lifecycle_configuration.this.rule : r.filter[0].prefix == "pointers/"])
    error_message = "pointers/ (current-healthy.json) must never be covered by an expiration rule"
  }
}
