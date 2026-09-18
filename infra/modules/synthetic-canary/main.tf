data "archive_file" "code" {
  type        = "zip"
  output_path = "${path.module}/canary.zip"

  source {
    content  = file("${path.module}/canary/index.js")
    filename = "nodejs/node_modules/index.js"
  }
}

resource "aws_s3_bucket" "artifacts" {
  bucket        = "${var.name_prefix}-synthetics-${var.aws_account_id}"
  force_destroy = true
  tags          = var.tags
}

resource "aws_s3_bucket_public_access_block" "artifacts" {
  bucket                  = aws_s3_bucket.artifacts.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id
  rule {
    id     = "expire-canary-artifacts"
    status = "Enabled"
    expiration {
      days = 30
    }
  }
}

data "aws_iam_policy_document" "assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "canary" {
  name               = "${var.name_prefix}-synthetics-edge"
  assume_role_policy = data.aws_iam_policy_document.assume.json
  tags               = var.tags
}

data "aws_iam_policy_document" "canary" {
  statement {
    actions   = ["s3:GetObject", "s3:PutObject"]
    resources = ["${aws_s3_bucket.artifacts.arn}/*"]
  }
  statement {
    actions   = ["s3:GetBucketLocation"]
    resources = [aws_s3_bucket.artifacts.arn]
  }
  statement {
    actions   = ["logs:CreateLogGroup"]
    resources = ["arn:aws:logs:${var.aws_region}:${var.aws_account_id}:log-group:/aws/lambda/cwsyn-*"]
  }
  statement {
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["arn:aws:logs:${var.aws_region}:${var.aws_account_id}:log-group:/aws/lambda/cwsyn-*:*"]
  }
  statement {
    actions   = ["s3:ListAllMyBuckets", "xray:PutTraceSegments"]
    resources = ["*"]
  }
  statement {
    actions   = ["cloudwatch:PutMetricData"]
    resources = ["*"]
    condition {
      test     = "StringEquals"
      variable = "cloudwatch:namespace"
      values   = ["CloudWatchSynthetics"]
    }
  }
}

resource "aws_iam_role_policy" "canary" {
  name   = "${var.name_prefix}-synthetics-edge"
  role   = aws_iam_role.canary.id
  policy = data.aws_iam_policy_document.canary.json
}

resource "aws_synthetics_canary" "edge" {
  name                                       = substr("${var.name_prefix}-edge", 0, 21)
  artifact_s3_location                       = "s3://${aws_s3_bucket.artifacts.bucket}/"
  execution_role_arn                         = aws_iam_role.canary.arn
  handler                                    = "index.handler"
  zip_file                                   = data.archive_file.code.output_path
  runtime_version                            = "syn-nodejs-5.2"
  start_canary                               = true

  schedule {
    expression = "rate(5 minutes)"
  }
  run_config {
    timeout_in_seconds    = 30
    environment_variables = { APP_ORIGIN = var.app_origin }
  }
  tags = var.tags
}

resource "aws_cloudwatch_metric_alarm" "failed" {
  alarm_name          = "${var.name_prefix}-synthetic-edge-failed"
  namespace           = "CloudWatchSynthetics"
  metric_name         = "SuccessPercent"
  dimensions          = { CanaryName = aws_synthetics_canary.edge.name }
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 2
  datapoints_to_alarm = 2
  threshold           = 100
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "breaching"
  alarm_actions       = [var.alert_topic_arn]
  ok_actions          = [var.alert_topic_arn]
  tags                = var.tags
}
