# SES Configuration Set -> SNS topic -> SQS (SesCallbackQueue). Events enabled: DELIVERY,
# BOUNCE, COMPLAINT (docs/architecture/m4-notification-engine-design.md §11.1 - REJECT and
# RENDERING_FAILURE are not wired to a matching attempt transition in M4, so left disabled
# rather than delivered and silently ignored).

resource "aws_sesv2_configuration_set" "this" {
  configuration_set_name = "${var.name_prefix}-notifications"
  tags                   = var.tags
}

resource "aws_sns_topic" "ses_events" {
  name = "${var.name_prefix}-ses-events"
  tags = var.tags
}

resource "aws_sesv2_configuration_set_event_destination" "sns" {
  configuration_set_name = aws_sesv2_configuration_set.this.configuration_set_name
  event_destination_name = "sns-callback"

  event_destination {
    enabled              = true
    matching_event_types = ["DELIVERY", "BOUNCE", "COMPLAINT"]

    sns_destination {
      topic_arn = aws_sns_topic.ses_events.arn
    }
  }
}

# Topic ARN constructed deterministically (not read from aws_sns_topic.ses_events.arn) for
# the same plan-time-known-policy-document rationale as dynamo-table/sqs-worker-queue.
locals {
  topic_arn = "arn:aws:sns:${var.aws_region}:${var.aws_account_id}:${var.name_prefix}-ses-events"
}

# SNS -> SQS subscription. raw_message_delivery = false (default): the SQS message body is
# the full SNS envelope (Type/MessageId/TopicArn/Message), which
# ses-callback-handler.ts's parseSesCallback() expects - never raw SES JSON directly, so the
# handler can validate the envelope's own MessageId/TopicArn before trusting the payload.
resource "aws_sns_topic_subscription" "callback_queue" {
  topic_arn = aws_sns_topic.ses_events.arn
  protocol  = "sqs"
  endpoint  = var.callback_queue_arn
}

# Queue policy allowing ONLY this specific SNS topic to publish - never a wildcard SNS
# principal (docs/architecture/reviews/m4-notification-engine-design/codex-proposal-round1.md
# §11.1: "a subscription SNS->SQS deve ter policy restrita ao topic ARN").
data "aws_iam_policy_document" "sns_to_queue" {
  statement {
    sid       = "AllowSesEventsTopicToSendMessage"
    effect    = "Allow"
    actions   = ["sqs:SendMessage"]
    resources = [var.callback_queue_arn]
    principals {
      type        = "Service"
      identifiers = ["sns.amazonaws.com"]
    }
    condition {
      test     = "ArnEquals"
      variable = "aws:SourceArn"
      values   = [local.topic_arn]
    }
  }
}
