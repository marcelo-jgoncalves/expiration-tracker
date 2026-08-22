output "quarantine_bucket_name" {
  value = aws_s3_bucket.quarantine.bucket
}

output "quarantine_bucket_arn" {
  value = aws_s3_bucket.quarantine.arn
}

output "quarantine_kms_key_arn" {
  description = "ARN of the AWS-managed S3 key (alias/aws/s3) - shared with the clean bucket, not a dedicated CMK. See main.tf for the 2026-08-22 cost decision."
  value       = data.aws_kms_key.s3_managed.arn
}

output "clean_bucket_name" {
  value = aws_s3_bucket.clean.bucket
}

output "clean_bucket_arn" {
  value = aws_s3_bucket.clean.arn
}

output "clean_kms_key_arn" {
  description = "Same AWS-managed key as quarantine_kms_key_arn - see main.tf."
  value       = data.aws_kms_key.s3_managed.arn
}
