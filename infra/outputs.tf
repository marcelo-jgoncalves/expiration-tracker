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
    module.notification_router.function_name,
    module.notification_email_outbox_relay.function_name,
    module.email_delivery.function_name,
    module.ses_callback.function_name,
    module.notifications_handler.function_name,
  ]
}

# Rollback design entrega 1 (docs/architecture/reviews/rollback-mechanism-design/
# codex-round2-final-design.md): `cd.yml` reads this map to build the deploy manifest
# (function_name -> published version + live alias name) - not sensitive, no PII/secrets.
output "lambda_published_versions" {
  value = {
    (module.test_ping_handler.function_name)             = module.test_ping_handler.published_version
    (module.items_handler.function_name)                 = module.items_handler.published_version
    (module.reminders_handler.function_name)              = module.reminders_handler.published_version
    (module.reminder_producer.function_name)              = module.reminder_producer.published_version
    (module.reminder_dispatch.function_name)              = module.reminder_dispatch.published_version
    (module.reminder_reconciliation.function_name)        = module.reminder_reconciliation.published_version
    (module.dispatch_outbox_relay.function_name)          = module.dispatch_outbox_relay.published_version
    (module.outbox_sweeper.function_name)                 = module.outbox_sweeper.published_version
    (module.notification_router.function_name)            = module.notification_router.published_version
    (module.notification_email_outbox_relay.function_name) = module.notification_email_outbox_relay.published_version
    (module.email_delivery.function_name)                 = module.email_delivery.published_version
    (module.ses_callback.function_name)                   = module.ses_callback.published_version
    (module.notifications_handler.function_name)          = module.notifications_handler.published_version
  }
}

output "deploy_manifest_bucket_name" {
  value = module.deploy_manifests.bucket_name
}
