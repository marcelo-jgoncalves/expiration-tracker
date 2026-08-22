output "quarantine_bucket_name" {
  value = aws_s3_bucket.quarantine.bucket
}

output "quarantine_bucket_arn" {
  value = aws_s3_bucket.quarantine.arn
}

output "quarantine_kms_key_arn" {
  value = aws_kms_key.quarantine.arn
}

output "clean_bucket_name" {
  value = aws_s3_bucket.clean.bucket
}

output "clean_bucket_arn" {
  value = aws_s3_bucket.clean.arn
}

output "clean_kms_key_arn" {
  value = aws_kms_key.clean.arn
}
