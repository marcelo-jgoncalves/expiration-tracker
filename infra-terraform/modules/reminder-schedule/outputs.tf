output "reminder_producer_schedule_arn" {
  value = aws_scheduler_schedule.reminder_producer.arn
}

output "reminder_claim_reconciliation_schedule_arn" {
  value = aws_scheduler_schedule.reminder_claim_reconciliation.arn
}

output "reminder_dst_reconciliation_schedule_arn" {
  value = aws_scheduler_schedule.reminder_dst_reconciliation.arn
}

output "outbox_sweeper_schedule_arn" {
  value = aws_scheduler_schedule.outbox_sweeper.arn
}
