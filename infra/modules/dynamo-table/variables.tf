variable "table_name" {
  description = "Name of the single-table DynamoDB table."
  type        = string
}

variable "tags" {
  description = "Tags applied to the table."
  type        = map(string)
  default     = {}
}

variable "aws_region" {
  description = "AWS region the table is deployed to. Used only to construct the table's ARN deterministically for IAM policy documents, so those documents don't depend on the table resource actually existing yet (keeps them plan-time-known and independently testable)."
  type        = string
}

variable "aws_account_id" {
  description = "AWS account ID the table is deployed to. Same rationale as aws_region: lets IAM policy ARNs be computed without depending on the live resource."
  type        = string
}
