# WAF na frente do API Gateway — M10 (D-037, 04-domain-model-guest-upload.md): pré-requisito
# antes de expor a primeira rota pública do projeto (/guest/*), não item de M8/Hardening.

variable "name_prefix" {
  description = "Prefixo de nome (mesmo padrão dos outros módulos, local.name_prefix da raiz)."
  type        = string
}

variable "api_stage_arn" {
  description = "ARN do stage do API Gateway (aws_apigatewayv2_stage) a associar ao Web ACL."
  type        = string
}

variable "guest_path_rate_limit" {
  description = "Limite de requisições por IP em 5 minutos, escopado só a /guest/* (rate-based rule do WAFv2 usa janela fixa de 5min nativamente). Default conservador para o volume esperado de Stage 0-2."
  type        = number
  default     = 300
}

variable "tags" {
  description = "Tags aplicadas ao Web ACL."
  type        = map(string)
  default     = {}
}
