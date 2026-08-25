output "bucket_name" {
  value = aws_s3_bucket.spa.bucket
}

output "bucket_arn" {
  value = aws_s3_bucket.spa.arn
}

output "distribution_id" {
  value = aws_cloudfront_distribution.spa.id
}

output "distribution_arn" {
  value = aws_cloudfront_distribution.spa.arn
}

output "distribution_domain_name" {
  description = "The app's real origin (no custom domain yet, ADR-0011 defers ACM/domain to a later etapa) - this is what var.app_origin (infra/variables.tf) and Cognito's callback URL must eventually point at."
  value       = aws_cloudfront_distribution.spa.domain_name
}
