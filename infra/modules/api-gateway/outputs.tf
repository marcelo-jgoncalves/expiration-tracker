output "api_id" {
  value = aws_apigatewayv2_api.this.id
}

output "api_endpoint" {
  value = aws_apigatewayv2_api.this.api_endpoint
}

output "execution_arn" {
  value = aws_apigatewayv2_api.this.execution_arn
}

output "stage_arn" {
  description = "ARN do stage $default - usado pelo módulo waf (M10, D-037) para associar o Web ACL."
  value       = aws_apigatewayv2_stage.default.arn
}
