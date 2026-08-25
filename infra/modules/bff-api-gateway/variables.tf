variable "api_name" {
  description = "Name of the BFF's dedicated HTTP API."
  type        = string
}

variable "bff_invoke_arn" {
  description = "Invoke ARN of the BFF Lambda - backs every /bff/* route."
  type        = string
}

variable "bff_function_name" {
  description = "Function name of the BFF Lambda, for the API Gateway invoke permission."
  type        = string
}

variable "app_origin" {
  description = "The CloudFront-fronted app origin (e.g. https://app.example.com) - allowed for CORS on the rare case the BFF is called cross-origin during development; production traffic is same-origin via CloudFront (D-054) and does not depend on this."
  type        = string
}

variable "tags" {
  description = "Tags applied to the API."
  type        = map(string)
  default     = {}
}
