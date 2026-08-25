output "api_id" {
  value = aws_apigatewayv2_api.bff.id
}

output "api_endpoint" {
  value = aws_apigatewayv2_api.bff.api_endpoint
}

output "execution_arn" {
  value = aws_apigatewayv2_api.bff.execution_arn
}
