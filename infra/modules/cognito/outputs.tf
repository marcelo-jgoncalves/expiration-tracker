output "user_pool_id" {
  value = aws_cognito_user_pool.this.id
}

output "user_pool_arn" {
  value = aws_cognito_user_pool.this.arn
}

output "user_pool_client_id" {
  value = aws_cognito_user_pool_client.web_client.id
}

output "user_pool_client_secret" {
  value     = aws_cognito_user_pool_client.web_client.client_secret
  sensitive = true
}

output "hosted_ui_domain" {
  description = "The Cognito Hosted UI domain (<prefix>.auth.<region>.amazoncognito.com), without a protocol prefix."
  value       = aws_cognito_user_pool_domain.this.domain
}
