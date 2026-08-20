# Passthrough for root-level acceptance-test assertions (module internals aren't
# addressable from a caller's .tftest.hcl).

output "schedule_count" {
  value = length([
    aws_scheduler_schedule.reminder_producer,
    aws_scheduler_schedule.reminder_claim_reconciliation,
    aws_scheduler_schedule.reminder_dst_reconciliation,
    aws_scheduler_schedule.outbox_sweeper,
  ])
}

output "schedule_inputs" {
  value = {
    reminder_producer             = aws_scheduler_schedule.reminder_producer.target[0].input
    reminder_claim_reconciliation = aws_scheduler_schedule.reminder_claim_reconciliation.target[0].input
    reminder_dst_reconciliation   = aws_scheduler_schedule.reminder_dst_reconciliation.target[0].input
    outbox_sweeper                = aws_scheduler_schedule.outbox_sweeper.target[0].input
  }
}
