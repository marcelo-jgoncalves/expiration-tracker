output "table_name" {
  value = module.table.table_name
}

output "user_pool_id" {
  value = module.auth.user_pool_id
}

output "api_endpoint" {
  value = module.api.api_endpoint
}

output "dispatch_queue_url" {
  value = module.dispatch_queue.queue_url
}

output "dispatch_queue_dlq_url" {
  value = module.dispatch_queue.dlq_url
}

output "lambda_function_names" {
  value = [
    module.test_ping_handler.function_name,
    module.items_handler.function_name,
    module.reminders_handler.function_name,
    module.reminder_producer.function_name,
    module.reminder_dispatch.function_name,
    module.reminder_reconciliation.function_name,
    module.dispatch_outbox_relay.function_name,
    module.outbox_sweeper.function_name,
  ]
}
