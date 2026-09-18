variable "name_prefix" { type = string }
variable "aws_region" { type = string }
variable "aws_account_id" { type = string }
variable "app_origin" { type = string }
variable "alert_topic_arn" { type = string }
variable "tags" {
  type    = map(string)
  default = {}
}
