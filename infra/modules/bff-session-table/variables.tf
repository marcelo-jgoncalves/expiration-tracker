variable "table_name" {
  description = "Name of the dedicated BFF session table."
  type        = string
}

variable "aws_region" {
  description = "AWS region - used to construct the table ARN deterministically for IAM policy documents (same rationale as infra/modules/dynamo-table)."
  type        = string
}

variable "aws_account_id" {
  description = "AWS account ID - same rationale as aws_region."
  type        = string
}

variable "tags" {
  description = "Tags applied to the table and CMK."
  type        = map(string)
  default     = {}
}
