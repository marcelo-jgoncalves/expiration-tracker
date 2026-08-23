output "bucket_name" {
  value = aws_s3_bucket.import.bucket
}

output "bucket_arn" {
  value = aws_s3_bucket.import.arn
}

output "kms_key_arn" {
  description = "ARN of the AWS-managed S3 key (alias/aws/s3) - shared with document-buckets, not a dedicated CMK."
  value       = data.aws_kms_key.s3_managed.arn
}
